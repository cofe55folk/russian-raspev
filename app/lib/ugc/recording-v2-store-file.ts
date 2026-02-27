import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { RecordingV2ChunkPayload, RecordingV2FinalizePayload } from "./recording-v2-contract";

const RECORDING_V2_DB_PATH = path.join(process.cwd(), "data", "ugc", "recording-v2-db.json");
const RECORDING_V2_CHUNKS_DIR = path.join(process.cwd(), "data", "ugc", "recording-v2-chunks");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type RecordingV2ChunkRecord = RecordingV2ChunkPayload & {
  ownerId: string;
  receivedAt: string;
  binaryObjectPath?: string;
  binaryByteLength?: number;
  binaryStoredAt?: string;
};

export type RecordingV2FinalizeRecord = RecordingV2FinalizePayload & {
  ownerId: string;
  receivedAt: string;
};

type AppendRecordingV2ChunkConflict =
  | "IDEMPOTENCY_KEY_REUSE_MISMATCH"
  | "CHUNK_CHECKSUM_MISMATCH"
  | "CHUNK_METADATA_MISMATCH";

export type AppendRecordingV2ChunkResult =
  | { ok: true; chunk: RecordingV2ChunkRecord; idempotent: boolean }
  | {
      ok: false;
      error: AppendRecordingV2ChunkConflict;
      existingChunk: RecordingV2ChunkRecord;
    };

type RecordingV2Db = {
  chunks: RecordingV2ChunkRecord[];
  finalizations: RecordingV2FinalizeRecord[];
};

const EMPTY_DB: RecordingV2Db = {
  chunks: [],
  finalizations: [],
};

function normalizeText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
}

function normalizeNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  if (normalized < 0) return undefined;
  return normalized;
}

function normalizeChunkRecord(input: unknown): RecordingV2ChunkRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<RecordingV2ChunkRecord>;
  const takeId = normalizeText(raw.takeId, 120);
  const ownerId = normalizeText(raw.ownerId, 120);
  const idempotencyKey = normalizeText(raw.idempotencyKey, 160);
  const checksumSha256 = normalizeText(raw.checksumSha256, 64);
  const codec = raw.codec === "pcm_s16le" || raw.codec === "pcm_f32le" ? raw.codec : undefined;
  const chunkIndex = normalizeNonNegativeInt(raw.chunkIndex);
  const sampleRate = normalizeNonNegativeInt(raw.sampleRate);
  const channels = normalizeNonNegativeInt(raw.channels);
  const byteLength = normalizeNonNegativeInt(raw.byteLength);
  const startedAtFrame = normalizeNonNegativeInt(raw.startedAtFrame);
  const receivedAt = normalizeText(raw.receivedAt, 40);
  if (
    !takeId ||
    !ownerId ||
    !idempotencyKey ||
    !checksumSha256 ||
    !codec ||
    chunkIndex == null ||
    sampleRate == null ||
    channels == null ||
    byteLength == null ||
    startedAtFrame == null ||
    !receivedAt
  ) {
    return null;
  }
  return {
    takeId,
    chunkIndex,
    sampleRate,
    channels,
    codec,
    byteLength,
    checksumSha256,
    startedAtFrame,
    idempotencyKey,
    uploadedAt: normalizeText(raw.uploadedAt, 40),
    ownerId,
    receivedAt,
    binaryObjectPath: normalizeText(raw.binaryObjectPath, 400),
    binaryByteLength: normalizeNonNegativeInt(raw.binaryByteLength),
    binaryStoredAt: normalizeText(raw.binaryStoredAt, 40),
  };
}

function normalizeFinalizeRecord(input: unknown): RecordingV2FinalizeRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<RecordingV2FinalizeRecord>;
  const takeId = normalizeText(raw.takeId, 120);
  const ownerId = normalizeText(raw.ownerId, 120);
  const idempotencyKey = normalizeText(raw.idempotencyKey, 160);
  const finalChecksumSha256 = normalizeText(raw.finalChecksumSha256, 64);
  const totalChunks = normalizeNonNegativeInt(raw.totalChunks);
  const totalBytes = normalizeNonNegativeInt(raw.totalBytes);
  const receivedAt = normalizeText(raw.receivedAt, 40);
  if (!takeId || !ownerId || !idempotencyKey || !finalChecksumSha256 || totalChunks == null || totalBytes == null || !receivedAt) {
    return null;
  }
  return {
    takeId,
    totalChunks,
    totalBytes,
    finalChecksumSha256,
    idempotencyKey,
    finalizedAt: normalizeText(raw.finalizedAt, 40),
    ownerId,
    receivedAt,
  };
}

function normalizeDb(input: unknown): RecordingV2Db {
  if (!input || typeof input !== "object") return { ...EMPTY_DB, chunks: [], finalizations: [] };
  const raw = input as Partial<RecordingV2Db>;
  return {
    chunks: Array.isArray(raw.chunks) ? raw.chunks.map(normalizeChunkRecord).filter((item): item is RecordingV2ChunkRecord => !!item) : [],
    finalizations: Array.isArray(raw.finalizations)
      ? raw.finalizations.map(normalizeFinalizeRecord).filter((item): item is RecordingV2FinalizeRecord => !!item)
      : [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(RECORDING_V2_DB_PATH), { recursive: true });
}

function normalizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 160) || "unknown";
}

function getChunkBinaryObjectPath(params: {
  ownerId: string;
  takeId: string;
  chunkIndex: number;
  checksumSha256: string;
}): string {
  const owner = normalizePathSegment(params.ownerId);
  const take = normalizePathSegment(params.takeId);
  return path.join(owner, take, `${params.chunkIndex}-${params.checksumSha256}.bin`);
}

async function persistChunkBinary(params: {
  ownerId: string;
  payload: RecordingV2ChunkPayload;
  chunkBytes: Uint8Array;
}): Promise<{ objectPath: string; byteLength: number; storedAt: string }> {
  if (params.chunkBytes.byteLength !== params.payload.byteLength) {
    throw new Error("CHUNK_BINARY_SIZE_MISMATCH");
  }
  const objectPath = getChunkBinaryObjectPath({
    ownerId: params.ownerId,
    takeId: params.payload.takeId,
    chunkIndex: params.payload.chunkIndex,
    checksumSha256: params.payload.checksumSha256,
  });
  const absolutePath = path.join(RECORDING_V2_CHUNKS_DIR, objectPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, Buffer.from(params.chunkBytes));
  await fs.rename(tempPath, absolutePath);
  return {
    objectPath,
    byteLength: params.chunkBytes.byteLength,
    storedAt: new Date().toISOString(),
  };
}

async function readDb(): Promise<RecordingV2Db> {
  try {
    const raw = await fs.readFile(RECORDING_V2_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, chunks: [], finalizations: [] };
  }
}

async function writeDb(db: RecordingV2Db): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${RECORDING_V2_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, RECORDING_V2_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: RecordingV2Db) => Promise<T> | T): Promise<T> {
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

function isChunkPayloadEquivalent(left: RecordingV2ChunkPayload, right: RecordingV2ChunkPayload): boolean {
  return (
    left.takeId === right.takeId &&
    left.chunkIndex === right.chunkIndex &&
    left.sampleRate === right.sampleRate &&
    left.channels === right.channels &&
    left.codec === right.codec &&
    left.byteLength === right.byteLength &&
    left.checksumSha256 === right.checksumSha256 &&
    left.startedAtFrame === right.startedAtFrame
  );
}

export async function appendRecordingV2Chunk(params: {
  ownerId: string;
  payload: RecordingV2ChunkPayload;
  chunkBytes?: Uint8Array | null;
}): Promise<AppendRecordingV2ChunkResult> {
  return withDbMutation(async (db) => {
    const existingByIdempotency = db.chunks.find(
      (item) =>
        item.ownerId === params.ownerId &&
        item.takeId === params.payload.takeId &&
        item.idempotencyKey === params.payload.idempotencyKey
    );
    if (existingByIdempotency) {
      if (!isChunkPayloadEquivalent(existingByIdempotency, params.payload)) {
        return {
          ok: false,
          error: "IDEMPOTENCY_KEY_REUSE_MISMATCH",
          existingChunk: existingByIdempotency,
        };
      }
      return { ok: true, chunk: existingByIdempotency, idempotent: true };
    }

    const existingByChunkIndex = db.chunks.find(
      (item) =>
        item.ownerId === params.ownerId &&
        item.takeId === params.payload.takeId &&
        item.chunkIndex === params.payload.chunkIndex
    );
    if (existingByChunkIndex) {
      if (existingByChunkIndex.checksumSha256 !== params.payload.checksumSha256) {
        return {
          ok: false,
          error: "CHUNK_CHECKSUM_MISMATCH",
          existingChunk: existingByChunkIndex,
        };
      }
      if (!isChunkPayloadEquivalent(existingByChunkIndex, params.payload)) {
        return {
          ok: false,
          error: "CHUNK_METADATA_MISMATCH",
          existingChunk: existingByChunkIndex,
        };
      }
      return { ok: true, chunk: existingByChunkIndex, idempotent: true };
    }

    const nowIso = new Date().toISOString();
    const persistedBinary =
      params.chunkBytes && params.chunkBytes.byteLength > 0
        ? await persistChunkBinary({
            ownerId: params.ownerId,
            payload: params.payload,
            chunkBytes: params.chunkBytes,
          })
        : null;
    const chunk: RecordingV2ChunkRecord = {
      ...params.payload,
      ownerId: params.ownerId,
      receivedAt: nowIso,
      uploadedAt: params.payload.uploadedAt || nowIso,
      binaryObjectPath: persistedBinary?.objectPath,
      binaryByteLength: persistedBinary?.byteLength,
      binaryStoredAt: persistedBinary?.storedAt,
    };
    db.chunks.push(chunk);
    return { ok: true, chunk, idempotent: false };
  });
}

export async function finalizeRecordingV2Take(params: {
  ownerId: string;
  payload: RecordingV2FinalizePayload;
}): Promise<{ finalize: RecordingV2FinalizeRecord; idempotent: boolean }> {
  return withDbMutation(async (db) => {
    const existing = db.finalizations.find(
      (item) =>
        item.ownerId === params.ownerId &&
        item.takeId === params.payload.takeId &&
        item.idempotencyKey === params.payload.idempotencyKey
    );
    if (existing) return { finalize: existing, idempotent: true };

    const nowIso = new Date().toISOString();
    const finalize: RecordingV2FinalizeRecord = {
      ...params.payload,
      ownerId: params.ownerId,
      receivedAt: nowIso,
      finalizedAt: params.payload.finalizedAt || nowIso,
    };
    db.finalizations.push(finalize);
    return { finalize, idempotent: false };
  });
}

export async function countRecordingV2Chunks(params: { ownerId: string; takeId: string }): Promise<number> {
  const db = await readDb();
  return db.chunks.filter((item) => item.ownerId === params.ownerId && item.takeId === params.takeId).length;
}

export type RecordingV2TakeChunkStats = {
  chunkCount: number;
  uniqueChunkCount: number;
  minChunkIndex: number | null;
  maxChunkIndex: number | null;
  hasSequenceGap: boolean;
};

export async function getRecordingV2TakeChunkStats(params: {
  ownerId: string;
  takeId: string;
}): Promise<RecordingV2TakeChunkStats> {
  const db = await readDb();
  const chunks = db.chunks.filter((item) => item.ownerId === params.ownerId && item.takeId === params.takeId);
  if (!chunks.length) {
    return {
      chunkCount: 0,
      uniqueChunkCount: 0,
      minChunkIndex: null,
      maxChunkIndex: null,
      hasSequenceGap: false,
    };
  }

  const indexSet = new Set<number>();
  let minChunkIndex = Number.POSITIVE_INFINITY;
  let maxChunkIndex = Number.NEGATIVE_INFINITY;
  for (const chunk of chunks) {
    indexSet.add(chunk.chunkIndex);
    if (chunk.chunkIndex < minChunkIndex) minChunkIndex = chunk.chunkIndex;
    if (chunk.chunkIndex > maxChunkIndex) maxChunkIndex = chunk.chunkIndex;
  }
  const uniqueChunkCount = indexSet.size;
  let hasSequenceGap = false;
  for (let idx = minChunkIndex; idx <= maxChunkIndex; idx += 1) {
    if (!indexSet.has(idx)) {
      hasSequenceGap = true;
      break;
    }
  }

  return {
    chunkCount: chunks.length,
    uniqueChunkCount,
    minChunkIndex: Number.isFinite(minChunkIndex) ? minChunkIndex : null,
    maxChunkIndex: Number.isFinite(maxChunkIndex) ? maxChunkIndex : null,
    hasSequenceGap,
  };
}
