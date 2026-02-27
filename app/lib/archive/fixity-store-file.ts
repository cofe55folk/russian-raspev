import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type FixityState = "normal" | "quarantine";
export type FixityAuditResult = "match" | "mismatch";
export type FixityIdempotencySource = "header" | "derived";
export type FixityAuditEvent = "verify.match" | "verify.mismatch";

export type FixityAuditRecord = {
  id: string;
  traceId: string;
  replayKey: string;
  requestFingerprint: string;
  idempotencySource: FixityIdempotencySource;
  expectedChecksumSha256: string;
  observedChecksumSha256: string;
  result: FixityAuditResult;
  event: FixityAuditEvent;
  stateAfter: FixityState;
  quarantinePath?: string;
  createdAt: string;
};

export type FixityAssetRecord = {
  assetId: string;
  checksumSha256: string;
  state: FixityState;
  quarantinePath?: string;
  lastVerifiedAt: string;
  audit: FixityAuditRecord[];
};

type FixityReplayRecord = {
  assetId: string;
  auditId: string;
  matched: boolean;
  state: FixityState;
  replayKey: string;
  requestFingerprint: string;
  traceId: string;
  idempotencySource: FixityIdempotencySource;
  verifiedAt: string;
};

type FixityDb = {
  version: 1;
  updatedAt: string;
  assets: FixityAssetRecord[];
  replayByKey: Record<string, FixityReplayRecord>;
};

const FIXITY_DB_PATH = path.join(process.cwd(), "data", "archive", "fixity-store.json");
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type FixityStoreErrorCode = "INVALID_FIXITY_VERIFY_PARAMS" | "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH";

export class FixityStoreError extends Error {
  code: FixityStoreErrorCode;

  constructor(code: FixityStoreErrorCode) {
    super(code);
    this.code = code;
  }
}

function createEmptyDb(): FixityDb {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    assets: [],
    replayByKey: {},
  };
}

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeChecksum(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(normalized)) return null;
  return normalized;
}

function normalizeState(value: unknown): FixityState | null {
  if (value === "normal" || value === "quarantine") return value;
  return null;
}

function normalizeIdempotencySource(value: unknown): FixityIdempotencySource | null {
  if (value === "header" || value === "derived") return value;
  return null;
}

function normalizeAuditEvent(value: unknown): FixityAuditEvent | null {
  if (value === "verify.match" || value === "verify.mismatch") return value;
  return null;
}

function normalizeQuarantinePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 300);
}

function buildQuarantinePath(assetId: string): string {
  const safeAssetId = assetId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `archive/quarantine/${safeAssetId || "asset"}`;
}

function normalizeAuditRecord(value: unknown): FixityAuditRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<FixityAuditRecord>;
  const id = normalizeText(raw.id, 1, 120);
  const traceId = normalizeText(raw.traceId, 1, 120);
  const replayKey = normalizeChecksum(raw.replayKey);
  const requestFingerprint = normalizeChecksum(raw.requestFingerprint);
  const idempotencySource = normalizeIdempotencySource(raw.idempotencySource);
  const expectedChecksumSha256 = normalizeChecksum(raw.expectedChecksumSha256);
  const observedChecksumSha256 = normalizeChecksum(raw.observedChecksumSha256);
  const result = raw.result === "match" || raw.result === "mismatch" ? raw.result : null;
  const event = normalizeAuditEvent(raw.event) || (result === "mismatch" ? "verify.mismatch" : "verify.match");
  const stateAfter = normalizeState(raw.stateAfter);
  const quarantinePath = normalizeQuarantinePath(raw.quarantinePath);
  const createdAt = normalizeText(raw.createdAt, 8, 80);
  if (
    !id ||
    !traceId ||
    !replayKey ||
    !requestFingerprint ||
    !idempotencySource ||
    !expectedChecksumSha256 ||
    !observedChecksumSha256 ||
    !result ||
    !stateAfter ||
    !createdAt
  ) {
    return null;
  }
  return {
    id,
    traceId,
    replayKey,
    requestFingerprint,
    idempotencySource,
    expectedChecksumSha256,
    observedChecksumSha256,
    result,
    event,
    stateAfter,
    quarantinePath,
    createdAt,
  };
}

function normalizeAssetRecord(value: unknown): FixityAssetRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<FixityAssetRecord>;
  const assetId = normalizeText(raw.assetId, 1, 200);
  const checksumSha256 = normalizeChecksum(raw.checksumSha256);
  const state = normalizeState(raw.state);
  const quarantinePath =
    normalizeQuarantinePath(raw.quarantinePath) || (state === "quarantine" && assetId ? buildQuarantinePath(assetId) : undefined);
  const lastVerifiedAt = normalizeText(raw.lastVerifiedAt, 8, 80);
  if (!assetId || !checksumSha256 || !state || !lastVerifiedAt) return null;
  const audit = Array.isArray(raw.audit)
    ? raw.audit.map(normalizeAuditRecord).filter((item): item is FixityAuditRecord => !!item)
    : [];
  return {
    assetId,
    checksumSha256,
    state,
    quarantinePath,
    lastVerifiedAt,
    audit,
  };
}

function normalizeReplayRecord(value: unknown, replayKeyFallback: string): FixityReplayRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<FixityReplayRecord>;
  const assetId = normalizeText(raw.assetId, 1, 200);
  const auditId = normalizeText(raw.auditId, 1, 120);
  const matched = typeof raw.matched === "boolean" ? raw.matched : null;
  const state = normalizeState(raw.state);
  const replayKey = normalizeChecksum(raw.replayKey) || replayKeyFallback;
  const requestFingerprint = normalizeChecksum(raw.requestFingerprint) || replayKeyFallback;
  const traceId = normalizeText(raw.traceId, 1, 120) || `fixity_trace_${randomUUID()}`;
  const idempotencySource = normalizeIdempotencySource(raw.idempotencySource) || "derived";
  const verifiedAt = normalizeText(raw.verifiedAt, 8, 80);
  if (!assetId || !auditId || matched == null || !state || !replayKey || !requestFingerprint || !verifiedAt) return null;
  return {
    assetId,
    auditId,
    matched,
    state,
    replayKey,
    requestFingerprint,
    traceId,
    idempotencySource,
    verifiedAt,
  };
}

function normalizeDb(value: unknown): FixityDb {
  const empty = createEmptyDb();
  if (!value || typeof value !== "object") return empty;
  const raw = value as Partial<FixityDb>;
  const assets = Array.isArray(raw.assets)
    ? raw.assets.map(normalizeAssetRecord).filter((item): item is FixityAssetRecord => !!item)
    : [];
  const replayByKey: Record<string, FixityReplayRecord> = {};
  if (raw.replayByKey && typeof raw.replayByKey === "object") {
    for (const [key, item] of Object.entries(raw.replayByKey as Record<string, unknown>)) {
      const replayKey = normalizeChecksum(key);
      if (!replayKey) continue;
      const normalized = normalizeReplayRecord(item, replayKey);
      if (!normalized) continue;
      replayByKey[replayKey] = normalized;
    }
  }
  return {
    version: 1,
    updatedAt: normalizeText(raw.updatedAt, 8, 80) || empty.updatedAt,
    assets,
    replayByKey,
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(FIXITY_DB_PATH), { recursive: true });
}

async function readDb(): Promise<FixityDb> {
  try {
    const raw = await fs.readFile(FIXITY_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw) as unknown);
  } catch {
    return createEmptyDb();
  }
}

async function writeDb(db: FixityDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tmpPath = `${FIXITY_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, FIXITY_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: FixityDb) => Promise<T> | T): Promise<T> {
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

export type VerifyFixityResultParams = {
  assetId: string;
  checksumSha256: string;
  replayKey: string;
  requestFingerprint: string;
  traceId: string;
  idempotencySource: FixityIdempotencySource;
};

export type VerifyFixityResult = {
  matched: boolean;
  idempotent: boolean;
  state: FixityState;
  quarantinePath?: string;
  asset: FixityAssetRecord;
  audit: FixityAuditRecord;
};

export async function verifyAndPersistFixityResult(params: VerifyFixityResultParams): Promise<VerifyFixityResult> {
  const assetId = normalizeText(params.assetId, 1, 200);
  const checksumSha256 = normalizeChecksum(params.checksumSha256);
  const replayKey = normalizeChecksum(params.replayKey);
  const requestFingerprint = normalizeChecksum(params.requestFingerprint);
  const traceId = normalizeText(params.traceId, 1, 120);
  const idempotencySource = normalizeIdempotencySource(params.idempotencySource);
  if (!assetId || !checksumSha256 || !replayKey || !requestFingerprint || !traceId || !idempotencySource) {
    throw new FixityStoreError("INVALID_FIXITY_VERIFY_PARAMS");
  }

  return withDbMutation(async (db) => {
    const replay = db.replayByKey[replayKey];
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) {
        throw new FixityStoreError("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
      }
      const replayAsset = db.assets.find((item) => item.assetId === replay.assetId);
      if (replayAsset) {
        const replayAudit = replayAsset.audit.find((item) => item.id === replay.auditId);
        if (replayAudit) {
          return {
            matched: replay.matched,
            idempotent: true,
            state: replay.state,
            quarantinePath: replayAsset.quarantinePath,
            asset: replayAsset,
            audit: replayAudit,
          };
        }
      }
    }

    const now = new Date().toISOString();
    let asset = db.assets.find((item) => item.assetId === assetId);
    if (!asset) {
      asset = {
        assetId,
        checksumSha256,
        state: "normal",
        quarantinePath: undefined,
        lastVerifiedAt: now,
        audit: [],
      };
      db.assets.push(asset);
    }

    const matched = asset.checksumSha256 === checksumSha256;
    const nextState: FixityState = matched ? asset.state : "quarantine";
    const quarantinePath = nextState === "quarantine" ? asset.quarantinePath || buildQuarantinePath(asset.assetId) : asset.quarantinePath;

    const audit: FixityAuditRecord = {
      id: `fixity_audit_${randomUUID()}`,
      traceId,
      replayKey,
      requestFingerprint,
      idempotencySource,
      expectedChecksumSha256: asset.checksumSha256,
      observedChecksumSha256: checksumSha256,
      result: matched ? "match" : "mismatch",
      event: matched ? "verify.match" : "verify.mismatch",
      stateAfter: nextState,
      quarantinePath,
      createdAt: now,
    };

    asset.state = nextState;
    asset.lastVerifiedAt = now;
    asset.quarantinePath = quarantinePath;
    asset.audit.push(audit);
    db.updatedAt = now;

    db.replayByKey[replayKey] = {
      assetId: asset.assetId,
      auditId: audit.id,
      matched,
      state: nextState,
      replayKey,
      requestFingerprint,
      traceId,
      idempotencySource,
      verifiedAt: now,
    };

    return {
      matched,
      idempotent: false,
      state: nextState,
      quarantinePath,
      asset,
      audit,
    };
  });
}

export async function getFixityAssetById(assetIdRaw: string): Promise<FixityAssetRecord | null> {
  const assetId = normalizeText(assetIdRaw, 1, 200);
  if (!assetId) return null;
  const db = await readDb();
  return db.assets.find((item) => item.assetId === assetId) || null;
}
