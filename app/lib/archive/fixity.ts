import { createHash, randomUUID } from "crypto";
import {
  FixityStoreError,
  verifyAndPersistFixityResult,
  type FixityAssetRecord,
  type FixityAuditRecord,
  type FixityIdempotencySource,
  type FixityState,
} from "./fixity-store-file";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;

type RawVerifyPayload = {
  assetId?: unknown;
  checksumSha256?: unknown;
};

export type ArchiveFixityVerifyInput = {
  assetId: string;
  checksumSha256: string;
  idempotencyKey?: string;
};

export type ArchiveFixityVerifyParseError = "INVALID_PAYLOAD" | "INVALID_ASSET_ID" | "INVALID_CHECKSUM_SHA256";

export type ArchiveFixityVerifyHeaderError = "INVALID_IDEMPOTENCY_KEY";

export type ArchiveFixityVerifyErrorCode =
  | ArchiveFixityVerifyHeaderError
  | "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"
  | "VERIFY_FAILED";

export class ArchiveFixityVerifyError extends Error {
  code: ArchiveFixityVerifyErrorCode;

  constructor(code: ArchiveFixityVerifyErrorCode) {
    super(code);
    this.code = code;
  }
}

export type ArchiveFixityVerifyResult = {
  ok: boolean;
  matched: boolean;
  idempotent: boolean;
  replayKey: string;
  requestFingerprint: string;
  traceId: string;
  idempotencySource: FixityIdempotencySource;
  state: FixityState;
  quarantinePath?: string;
  asset: FixityAssetRecord;
  audit: FixityAuditRecord;
};

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

function buildRequestFingerprint(input: Pick<ArchiveFixityVerifyInput, "assetId" | "checksumSha256">): string {
  return createHash("sha256")
    .update(`${input.assetId}\n${input.checksumSha256}`)
    .digest("hex");
}

function buildReplayKey(input: ArchiveFixityVerifyInput): { replayKey: string; idempotencySource: FixityIdempotencySource } {
  if (input.idempotencyKey) {
    return {
      replayKey: createHash("sha256").update(`idempotency-key\n${input.idempotencyKey}`).digest("hex"),
      idempotencySource: "header",
    };
  }
  return {
    replayKey: buildRequestFingerprint(input),
    idempotencySource: "derived",
  };
}

export function parseArchiveFixityVerifyInput(
  raw: unknown,
): { ok: true; value: Omit<ArchiveFixityVerifyInput, "idempotencyKey"> } | { ok: false; error: ArchiveFixityVerifyParseError } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "INVALID_PAYLOAD" };

  const payload = raw as RawVerifyPayload;
  const assetId = normalizeText(payload.assetId, 1, 200);
  if (!assetId) return { ok: false, error: "INVALID_ASSET_ID" };

  const checksumSha256 = normalizeChecksum(payload.checksumSha256);
  if (!checksumSha256) return { ok: false, error: "INVALID_CHECKSUM_SHA256" };

  return {
    ok: true,
    value: {
      assetId,
      checksumSha256,
    },
  };
}

export function parseArchiveFixityIdempotencyKey(
  raw: string | null,
): { ok: true; value: string | undefined } | { ok: false; error: ArchiveFixityVerifyHeaderError } {
  if (raw == null) return { ok: true, value: undefined };
  const normalized = raw.trim();
  if (!normalized) return { ok: true, value: undefined };
  if (!IDEMPOTENCY_KEY_RE.test(normalized)) {
    return { ok: false, error: "INVALID_IDEMPOTENCY_KEY" };
  }
  return { ok: true, value: normalized };
}

export async function verifyArchiveFixity(input: ArchiveFixityVerifyInput): Promise<ArchiveFixityVerifyResult> {
  const requestFingerprint = buildRequestFingerprint(input);
  const { replayKey, idempotencySource } = buildReplayKey(input);
  const traceId = `fixity_trace_${randomUUID()}`;

  try {
    const persisted = await verifyAndPersistFixityResult({
      assetId: input.assetId,
      checksumSha256: input.checksumSha256,
      replayKey,
      requestFingerprint,
      traceId,
      idempotencySource,
    });

    return {
      ok: persisted.matched,
      matched: persisted.matched,
      idempotent: persisted.idempotent,
      replayKey,
      requestFingerprint,
      traceId: persisted.audit.traceId,
      idempotencySource,
      state: persisted.state,
      quarantinePath: persisted.quarantinePath,
      asset: persisted.asset,
      audit: persisted.audit,
    };
  } catch (error) {
    if (error instanceof FixityStoreError && error.code === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH") {
      throw new ArchiveFixityVerifyError("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
    }
    throw new ArchiveFixityVerifyError("VERIFY_FAILED");
  }
}
