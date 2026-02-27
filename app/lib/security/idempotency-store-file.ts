import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

type IdempotencyRecord = {
  id: string;
  scope: string;
  keyHash: string;
  requestFingerprint: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: string;
  updatedAt: string;
};

type IdempotencyDb = {
  version: 1;
  updatedAt: string;
  records: IdempotencyRecord[];
};

type IdempotencyReplayLookup =
  | { status: "none" }
  | { status: "replay"; responseStatus: number; responseBody: unknown }
  | { status: "conflict" };

export class IdempotencyStoreError extends Error {
  code: "INVALID_IDEMPOTENCY_PARAMS" | "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH";

  constructor(code: "INVALID_IDEMPOTENCY_PARAMS" | "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH") {
    super(code);
    this.code = code;
  }
}

const IDEMPOTENCY_DB_PATH = path.join(process.cwd(), "data", "security", "idempotency-store.json");
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

function createEmptyDb(): IdempotencyDb {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    records: [],
  };
}

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(normalized)) return null;
  return normalized;
}

function normalizeStatusCode(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const normalized = Math.floor(num);
  if (normalized < 100 || normalized > 599) return null;
  return normalized;
}

function toSerializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { error: "NON_SERIALIZABLE_RESPONSE_BODY" };
  }
}

function normalizeRecord(value: unknown): IdempotencyRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IdempotencyRecord>;
  const id = normalizeText(raw.id, 1, 120);
  const scope = normalizeText(raw.scope, 1, 300);
  const keyHash = normalizeHash(raw.keyHash);
  const requestFingerprint = normalizeHash(raw.requestFingerprint);
  const responseStatus = normalizeStatusCode(raw.responseStatus);
  const createdAt = normalizeText(raw.createdAt, 8, 80);
  const updatedAt = normalizeText(raw.updatedAt, 8, 80);
  if (!id || !scope || !keyHash || !requestFingerprint || responseStatus == null || !createdAt || !updatedAt) {
    return null;
  }
  return {
    id,
    scope,
    keyHash,
    requestFingerprint,
    responseStatus,
    responseBody: toSerializable(raw.responseBody),
    createdAt,
    updatedAt,
  };
}

function normalizeDb(value: unknown): IdempotencyDb {
  const empty = createEmptyDb();
  if (!value || typeof value !== "object") return empty;
  const raw = value as Partial<IdempotencyDb>;
  const records = Array.isArray(raw.records)
    ? raw.records.map(normalizeRecord).filter((item): item is IdempotencyRecord => !!item)
    : [];
  return {
    version: 1,
    updatedAt: normalizeText(raw.updatedAt, 8, 80) || empty.updatedAt,
    records,
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(IDEMPOTENCY_DB_PATH), { recursive: true });
}

async function readDb(): Promise<IdempotencyDb> {
  try {
    const raw = await fs.readFile(IDEMPOTENCY_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw) as unknown);
  } catch {
    return createEmptyDb();
  }
}

async function writeDb(db: IdempotencyDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tmpPath = `${IDEMPOTENCY_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, IDEMPOTENCY_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: IdempotencyDb) => Promise<T> | T): Promise<T> {
  const previous = mutationQueue;
  let unlock: () => void = () => {};
  mutationQueue = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  try {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  } finally {
    unlock();
  }
}

function findRecord(db: IdempotencyDb, scope: string, keyHash: string): IdempotencyRecord | undefined {
  return db.records.find((item) => item.scope === scope && item.keyHash === keyHash);
}

function validateParams(params: { scope: string; keyHash: string; requestFingerprint: string }) {
  const scope = normalizeText(params.scope, 1, 300);
  const keyHash = normalizeHash(params.keyHash);
  const requestFingerprint = normalizeHash(params.requestFingerprint);
  if (!scope || !keyHash || !requestFingerprint) {
    throw new IdempotencyStoreError("INVALID_IDEMPOTENCY_PARAMS");
  }
  return { scope, keyHash, requestFingerprint };
}

export async function getIdempotencyReplay(params: {
  scope: string;
  keyHash: string;
  requestFingerprint: string;
}): Promise<IdempotencyReplayLookup> {
  const normalized = validateParams(params);
  const db = await readDb();
  const found = findRecord(db, normalized.scope, normalized.keyHash);
  if (!found) return { status: "none" };
  if (found.requestFingerprint !== normalized.requestFingerprint) return { status: "conflict" };
  return {
    status: "replay",
    responseStatus: found.responseStatus,
    responseBody: found.responseBody,
  };
}

export async function saveIdempotencyResult(params: {
  scope: string;
  keyHash: string;
  requestFingerprint: string;
  responseStatus: number;
  responseBody: unknown;
}): Promise<void> {
  const normalized = validateParams(params);
  const responseStatus = normalizeStatusCode(params.responseStatus);
  if (responseStatus == null) {
    throw new IdempotencyStoreError("INVALID_IDEMPOTENCY_PARAMS");
  }

  return withDbMutation(async (db) => {
    const now = new Date().toISOString();
    const found = findRecord(db, normalized.scope, normalized.keyHash);
    if (found) {
      if (found.requestFingerprint !== normalized.requestFingerprint) {
        throw new IdempotencyStoreError("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
      }
      return;
    }

    db.records.push({
      id: `idempotency_${randomUUID()}`,
      scope: normalized.scope,
      keyHash: normalized.keyHash,
      requestFingerprint: normalized.requestFingerprint,
      responseStatus,
      responseBody: toSerializable(params.responseBody),
      createdAt: now,
      updatedAt: now,
    });
    db.updatedAt = now;
  });
}
