"use client";

import type { RecordingV2Codec } from "./recording-v2-contract";

const QUEUE_STORAGE_KEY = "rr_recording_v2_upload_queue_v1";
const DEFAULT_CHUNK_BYTES = 256 * 1024;
const DEFAULT_SAMPLE_RATE = 48_000;

export type RecordingV2UploadMeta = {
  takeId: string;
  sampleRate?: number;
  channels?: number;
  codec?: RecordingV2Codec;
};

type RecordingV2UploadQueueItem = RecordingV2UploadMeta & {
  attempts: number;
  updatedAt: string;
};

function normalizeText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  return trimmed;
}

function normalizePositiveInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const normalized = Math.floor(num);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
}

function normalizeCodec(value: unknown): RecordingV2Codec {
  if (value === "pcm_s16le") return "pcm_s16le";
  return "pcm_f32le";
}

function normalizeQueueItem(input: unknown): RecordingV2UploadQueueItem | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<RecordingV2UploadQueueItem>;
  const takeId = normalizeText(raw.takeId, 8, 120);
  if (!takeId) return null;
  return {
    takeId,
    sampleRate: normalizePositiveInt(raw.sampleRate, 8000, 192000, DEFAULT_SAMPLE_RATE),
    channels: normalizePositiveInt(raw.channels, 1, 2, 1),
    codec: normalizeCodec(raw.codec),
    attempts: normalizePositiveInt(raw.attempts, 0, 99, 0),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function readQueue(): RecordingV2UploadQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeQueueItem).filter((item): item is RecordingV2UploadQueueItem => !!item);
  } catch {
    return [];
  }
}

function writeQueue(queue: RecordingV2UploadQueueItem[]) {
  if (typeof window === "undefined") return;
  try {
    if (!queue.length) {
      window.localStorage.removeItem(QUEUE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // ignore localStorage failures
  }
}

async function sha256Hex(arrayBuffer: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) return "0".repeat(64);
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendWithRetry(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) return res;
      lastError = new Error(`HTTP_${res.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxAttempts) {
      const backoffMs = 300 * attempt;
      await new Promise((resolve) => window.setTimeout(resolve, backoffMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("UPLOAD_RETRY_FAILED");
}

async function postJsonWithRetry(url: string, body: unknown, maxAttempts = 3): Promise<Response> {
  return sendWithRetry(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    },
    maxAttempts
  );
}

async function postMultipartWithRetry(url: string, body: FormData, maxAttempts = 3): Promise<Response> {
  return sendWithRetry(
    url,
    {
      method: "POST",
      body,
      credentials: "same-origin",
    },
    maxAttempts
  );
}

async function readTakeFileFromOpfs(takeId: string): Promise<File> {
  const navWithStorage = navigator as Navigator & { storage?: { getDirectory?: () => Promise<unknown> } };
  if (typeof navWithStorage.storage?.getDirectory !== "function") {
    throw new Error("OPFS_UNSUPPORTED");
  }
  const root = (await navWithStorage.storage.getDirectory()) as FileSystemDirectoryHandle;
  const dir = await root.getDirectoryHandle("rr-recording-v2");
  const handle = await dir.getFileHandle(`${takeId}.pcm`);
  return handle.getFile();
}

function normalizeUploadMeta(meta: RecordingV2UploadMeta): RecordingV2UploadMeta | null {
  const takeId = normalizeText(meta.takeId, 8, 120);
  if (!takeId) return null;
  return {
    takeId,
    sampleRate: normalizePositiveInt(meta.sampleRate, 8000, 192000, DEFAULT_SAMPLE_RATE),
    channels: normalizePositiveInt(meta.channels, 1, 2, 1),
    codec: normalizeCodec(meta.codec),
  };
}

export async function uploadRecordingV2TakeFromOpfs(meta: RecordingV2UploadMeta): Promise<{
  takeId: string;
  chunkCount: number;
  totalBytes: number;
}> {
  const normalized = normalizeUploadMeta(meta);
  if (!normalized) throw new Error("INVALID_UPLOAD_META");
  const file = await readTakeFileFromOpfs(normalized.takeId);
  const totalBytes = file.size;
  const chunkCount = Math.max(1, Math.ceil(totalBytes / DEFAULT_CHUNK_BYTES));

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const start = chunkIndex * DEFAULT_CHUNK_BYTES;
    const end = Math.min(totalBytes, start + DEFAULT_CHUNK_BYTES);
    const chunkBlob = file.slice(start, end);
    const chunkBuffer = await chunkBlob.arrayBuffer();
    const chunkChecksum = await sha256Hex(chunkBuffer);
    const chunkPayload = {
      takeId: normalized.takeId,
      chunkIndex,
      sampleRate: normalized.sampleRate ?? DEFAULT_SAMPLE_RATE,
      channels: normalized.channels ?? 1,
      codec: normalized.codec ?? "pcm_f32le",
      byteLength: chunkBlob.size,
      checksumSha256: chunkChecksum,
      startedAtFrame: chunkIndex * 1024,
      idempotencyKey: `${normalized.takeId}:chunk:${chunkIndex}:v1`,
      uploadedAt: new Date().toISOString(),
    };
    const chunkForm = new FormData();
    chunkForm.set("meta", JSON.stringify(chunkPayload));
    chunkForm.set(
      "chunk",
      new Blob([chunkBuffer], { type: "application/octet-stream" }),
      `${normalized.takeId}-${chunkIndex}.bin`
    );
    const chunkRes = await postMultipartWithRetry(
      `/api/ugc/recording-v2/takes/${encodeURIComponent(normalized.takeId)}/chunks`,
      chunkForm
    );
    if (!chunkRes.ok) {
      throw new Error(`CHUNK_UPLOAD_FAILED_${chunkRes.status}`);
    }
  }

  const finalBuffer = await file.arrayBuffer();
  const finalChecksum = await sha256Hex(finalBuffer);
  const finalizePayload = {
    takeId: normalized.takeId,
    totalChunks: chunkCount,
    totalBytes,
    finalChecksumSha256: finalChecksum,
    idempotencyKey: `${normalized.takeId}:finalize:v1`,
    finalizedAt: new Date().toISOString(),
  };
  const finalizeRes = await postJsonWithRetry(
    `/api/ugc/recording-v2/takes/${encodeURIComponent(normalized.takeId)}/finalize`,
    finalizePayload
  );
  if (!finalizeRes.ok) {
    throw new Error(`FINALIZE_UPLOAD_FAILED_${finalizeRes.status}`);
  }
  return {
    takeId: normalized.takeId,
    chunkCount,
    totalBytes,
  };
}

export function enqueueRecordingV2Upload(meta: RecordingV2UploadMeta): void {
  const normalized = normalizeUploadMeta(meta);
  if (!normalized) return;
  const queue = readQueue();
  const existing = queue.find((item) => item.takeId === normalized.takeId);
  const next: RecordingV2UploadQueueItem = {
    ...normalized,
    attempts: existing?.attempts ?? 0,
    updatedAt: new Date().toISOString(),
  };
  const merged = existing
    ? queue.map((item) => (item.takeId === normalized.takeId ? next : item))
    : [...queue, next];
  writeQueue(merged);
}

export async function drainRecordingV2UploadQueue(maxItems = 2): Promise<{ completed: number; failed: number }> {
  const queue = readQueue();
  if (!queue.length) return { completed: 0, failed: 0 };
  const keep: RecordingV2UploadQueueItem[] = [];
  let completed = 0;
  let failed = 0;
  const limit = Math.max(1, Math.min(maxItems, 20));

  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    if (i >= limit) {
      keep.push(item);
      continue;
    }
    try {
      await uploadRecordingV2TakeFromOpfs(item);
      completed += 1;
    } catch {
      failed += 1;
      if (item.attempts < 5) {
        keep.push({
          ...item,
          attempts: item.attempts + 1,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  writeQueue(keep);
  return { completed, failed };
}
