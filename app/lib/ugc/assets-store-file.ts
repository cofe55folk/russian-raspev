import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const UGC_ROOT_DIR = path.join(process.cwd(), "data", "ugc");
const UGC_ASSETS_DB_PATH = path.join(UGC_ROOT_DIR, "assets-db.json");
const UGC_ASSETS_DIR = path.join(UGC_ROOT_DIR, "assets");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type UgcAssetKind = "audio";

export type UgcAssetRecord = {
  id: string;
  ownerId: string;
  kind: UgcAssetKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageRelPath: string;
  createdAt: string;
  updatedAt: string;
};

type UgcAssetsDb = {
  assets: UgcAssetRecord[];
};

const EMPTY_DB: UgcAssetsDb = {
  assets: [],
};

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, limit);
}

function normalizeAssetRecord(input: unknown): UgcAssetRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<UgcAssetRecord>;
  const id = normalizeText(raw.id, 120);
  const ownerId = normalizeText(raw.ownerId, 120);
  const originalName = normalizeText(raw.originalName, 180);
  const mimeType = normalizeText(raw.mimeType, 120);
  const storageRelPath = normalizeText(raw.storageRelPath, 300);
  const createdAt = normalizeText(raw.createdAt, 60);
  const updatedAt = normalizeText(raw.updatedAt, 60);
  const sizeBytes = typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes) ? raw.sizeBytes : -1;
  if (!id || !ownerId || !originalName || !mimeType || !storageRelPath || !createdAt || !updatedAt || sizeBytes < 0) {
    return null;
  }

  return {
    id,
    ownerId,
    kind: raw.kind === "audio" ? "audio" : "audio",
    originalName,
    mimeType,
    sizeBytes,
    storageRelPath,
    createdAt,
    updatedAt,
  };
}

function normalizeDb(input: unknown): UgcAssetsDb {
  if (!input || typeof input !== "object") return EMPTY_DB;
  const raw = input as Partial<UgcAssetsDb>;
  return {
    assets: Array.isArray(raw.assets)
      ? raw.assets.map(normalizeAssetRecord).filter((item): item is UgcAssetRecord => !!item)
      : [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(UGC_ASSETS_DB_PATH), { recursive: true });
  await fs.mkdir(UGC_ASSETS_DIR, { recursive: true });
}

async function readDb(): Promise<UgcAssetsDb> {
  try {
    const raw = await fs.readFile(UGC_ASSETS_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, assets: [] };
  }
}

async function writeDb(db: UgcAssetsDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${UGC_ASSETS_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, UGC_ASSETS_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: UgcAssetsDb) => Promise<T> | T): Promise<T> {
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

function safeExtFromName(fileName: string): string {
  const ext = path.extname(fileName || "").toLowerCase();
  if (!ext || ext.length > 10) return "";
  if (!/^[.][a-z0-9]+$/.test(ext)) return "";
  return ext;
}

function absPathForStorage(storageRelPath: string): string {
  const fileName = path.basename(storageRelPath || "").trim();
  if (!fileName || fileName === "." || fileName === "..") {
    throw new Error("INVALID_UGC_ASSET_STORAGE_PATH");
  }
  return path.join(UGC_ASSETS_DIR, fileName);
}

export async function createUgcAssetUpload(params: {
  ownerId: string;
  kind?: UgcAssetKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}): Promise<UgcAssetRecord> {
  const ownerId = normalizeText(params.ownerId, 120);
  const originalName = normalizeText(params.originalName, 180);
  const mimeType = normalizeText(params.mimeType, 120);
  if (!ownerId || !originalName || !mimeType) throw new Error("INVALID_UGC_ASSET_PAYLOAD");
  if (!Number.isFinite(params.sizeBytes) || params.sizeBytes < 0) throw new Error("INVALID_UGC_ASSET_SIZE");
  if (!(params.bytes instanceof Uint8Array) || params.bytes.byteLength !== params.sizeBytes) {
    throw new Error("INVALID_UGC_ASSET_BYTES");
  }

  const kind: UgcAssetKind = params.kind === "audio" ? "audio" : "audio";
  const id = randomUUID();
  const ext = safeExtFromName(originalName);
  const fileName = `${id}${ext || ".bin"}`;
  const storageRelPath = path.join("data", "ugc", "assets", fileName);
  const absPath = absPathForStorage(storageRelPath);
  const now = new Date().toISOString();

  await ensureDir();
  const tmpPath = `${absPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, Buffer.from(params.bytes));
  await fs.rename(tmpPath, absPath);

  const record: UgcAssetRecord = {
    id,
    ownerId,
    kind,
    originalName,
    mimeType,
    sizeBytes: params.sizeBytes,
    storageRelPath,
    createdAt: now,
    updatedAt: now,
  };

  await withDbMutation(async (db) => {
    db.assets.push(record);
  });

  return record;
}

export async function getUgcAssetById(assetId: string): Promise<UgcAssetRecord | null> {
  const db = await readDb();
  return db.assets.find((item) => item.id === assetId) ?? null;
}

export async function readUgcAssetBytes(asset: UgcAssetRecord): Promise<Uint8Array | null> {
  try {
    const buf = await fs.readFile(absPathForStorage(asset.storageRelPath));
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}
