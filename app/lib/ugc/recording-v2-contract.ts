export type RecordingV2Codec = "pcm_s16le" | "pcm_f32le";

export type RecordingV2ChunkPayload = {
  takeId: string;
  chunkIndex: number;
  sampleRate: number;
  channels: number;
  codec: RecordingV2Codec;
  byteLength: number;
  checksumSha256: string;
  startedAtFrame: number;
  idempotencyKey: string;
  uploadedAt?: string;
};

export type RecordingV2FinalizePayload = {
  takeId: string;
  totalChunks: number;
  totalBytes: number;
  finalChecksumSha256: string;
  idempotencyKey: string;
  finalizedAt?: string;
};

export type RecordingV2NormalizeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const HEX_SHA256_RE = /^[a-f0-9]{64}$/i;

function normalizeText(value: unknown, min: number, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return undefined;
  return trimmed;
}

function normalizeNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  if (normalized < 0) return undefined;
  return normalized;
}

function normalizeIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function normalizeCodec(value: unknown): RecordingV2Codec | undefined {
  if (value === "pcm_s16le") return "pcm_s16le";
  if (value === "pcm_f32le") return "pcm_f32le";
  return undefined;
}

function normalizeChecksum(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const checksum = value.trim().toLowerCase();
  if (!HEX_SHA256_RE.test(checksum)) return undefined;
  return checksum;
}

export function normalizeRecordingV2ChunkPayload(payload: unknown): RecordingV2NormalizeResult<RecordingV2ChunkPayload> {
  const raw = payload && typeof payload === "object" ? (payload as Partial<RecordingV2ChunkPayload>) : {};
  const takeId = normalizeText(raw.takeId, 8, 120);
  if (!takeId) return { ok: false, error: "INVALID_TAKE_ID" };

  const idempotencyKey = normalizeText(raw.idempotencyKey, 8, 160);
  if (!idempotencyKey) return { ok: false, error: "INVALID_IDEMPOTENCY_KEY" };

  const chunkIndex = normalizeNonNegativeInt(raw.chunkIndex);
  if (chunkIndex == null) return { ok: false, error: "INVALID_CHUNK_INDEX" };

  const sampleRate = normalizeNonNegativeInt(raw.sampleRate);
  if (sampleRate == null || sampleRate < 8000 || sampleRate > 192000) {
    return { ok: false, error: "INVALID_SAMPLE_RATE" };
  }

  const channels = normalizeNonNegativeInt(raw.channels);
  if (channels == null || ![1, 2].includes(channels)) {
    return { ok: false, error: "INVALID_CHANNELS" };
  }

  const codec = normalizeCodec(raw.codec);
  if (!codec) return { ok: false, error: "INVALID_CODEC" };

  const byteLength = normalizeNonNegativeInt(raw.byteLength);
  if (byteLength == null || byteLength < 1 || byteLength > MAX_CHUNK_BYTES) {
    return { ok: false, error: "INVALID_CHUNK_SIZE" };
  }

  const startedAtFrame = normalizeNonNegativeInt(raw.startedAtFrame);
  if (startedAtFrame == null) return { ok: false, error: "INVALID_STARTED_AT_FRAME" };

  const checksumSha256 = normalizeChecksum(raw.checksumSha256);
  if (!checksumSha256) return { ok: false, error: "INVALID_CHECKSUM_SHA256" };

  return {
    ok: true,
    value: {
      takeId,
      chunkIndex,
      sampleRate,
      channels,
      codec,
      byteLength,
      checksumSha256,
      startedAtFrame,
      idempotencyKey,
      uploadedAt: normalizeIso(raw.uploadedAt),
    },
  };
}

export function normalizeRecordingV2FinalizePayload(
  payload: unknown
): RecordingV2NormalizeResult<RecordingV2FinalizePayload> {
  const raw = payload && typeof payload === "object" ? (payload as Partial<RecordingV2FinalizePayload>) : {};
  const takeId = normalizeText(raw.takeId, 8, 120);
  if (!takeId) return { ok: false, error: "INVALID_TAKE_ID" };

  const idempotencyKey = normalizeText(raw.idempotencyKey, 8, 160);
  if (!idempotencyKey) return { ok: false, error: "INVALID_IDEMPOTENCY_KEY" };

  const totalChunks = normalizeNonNegativeInt(raw.totalChunks);
  if (totalChunks == null || totalChunks < 1) return { ok: false, error: "INVALID_TOTAL_CHUNKS" };

  const totalBytes = normalizeNonNegativeInt(raw.totalBytes);
  if (totalBytes == null || totalBytes < 1 || totalBytes > MAX_TOTAL_BYTES) {
    return { ok: false, error: "INVALID_TOTAL_BYTES" };
  }

  const finalChecksumSha256 = normalizeChecksum(raw.finalChecksumSha256);
  if (!finalChecksumSha256) return { ok: false, error: "INVALID_FINAL_CHECKSUM_SHA256" };

  return {
    ok: true,
    value: {
      takeId,
      totalChunks,
      totalBytes,
      finalChecksumSha256,
      idempotencyKey,
      finalizedAt: normalizeIso(raw.finalizedAt),
    },
  };
}
