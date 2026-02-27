import { createHash } from "crypto";
import {
  IdempotencyStoreError,
  getIdempotencyReplay,
  saveIdempotencyResult,
} from "./idempotency-store-file";

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;

export type IdempotencyResolveResult =
  | { ok: true; mode: "none" }
  | { ok: true; mode: "replay"; responseStatus: number; responseBody: unknown }
  | {
      ok: true;
      mode: "new";
      idempotencyKey: string;
      keyHash: string;
      requestFingerprint: string;
    }
  | { ok: false; error: "INVALID_IDEMPOTENCY_KEY" | "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" };

function normalizeScope(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 300) return null;
  return normalized;
}

function normalizeIdempotencyKey(value: string | null): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (!IDEMPOTENCY_KEY_RE.test(normalized)) return "__invalid__";
  return normalized;
}

function stableNormalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item));
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = stableNormalize(obj[key]);
  }
  return out;
}

function buildRequestFingerprint(payload: unknown): string {
  const normalized = stableNormalize(payload);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function buildKeyHash(scope: string, idempotencyKey: string): string {
  return createHash("sha256").update(`${scope}\n${idempotencyKey}`).digest("hex");
}

export async function resolveIdempotency(params: {
  scope: string;
  idempotencyKeyHeader: string | null;
  payload: unknown;
}): Promise<IdempotencyResolveResult> {
  const scope = normalizeScope(params.scope);
  if (!scope) return { ok: true, mode: "none" };

  const maybeKey = normalizeIdempotencyKey(params.idempotencyKeyHeader);
  if (!maybeKey) return { ok: true, mode: "none" };
  if (maybeKey === "__invalid__") return { ok: false, error: "INVALID_IDEMPOTENCY_KEY" };

  const requestFingerprint = buildRequestFingerprint(params.payload);
  const keyHash = buildKeyHash(scope, maybeKey);

  try {
    const replay = await getIdempotencyReplay({
      scope,
      keyHash,
      requestFingerprint,
    });
    if (replay.status === "conflict") {
      return { ok: false, error: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" };
    }
    if (replay.status === "replay") {
      return {
        ok: true,
        mode: "replay",
        responseStatus: replay.responseStatus,
        responseBody: replay.responseBody,
      };
    }
    return {
      ok: true,
      mode: "new",
      idempotencyKey: maybeKey,
      keyHash,
      requestFingerprint,
    };
  } catch (error) {
    if (error instanceof IdempotencyStoreError && error.code === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH") {
      return { ok: false, error: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" };
    }
    return { ok: true, mode: "none" };
  }
}

export async function persistIdempotencyResult(params: {
  scope: string;
  resolved: Extract<IdempotencyResolveResult, { ok: true; mode: "new" }>;
  responseStatus: number;
  responseBody: unknown;
}): Promise<void> {
  await saveIdempotencyResult({
    scope: params.scope,
    keyHash: params.resolved.keyHash,
    requestFingerprint: params.resolved.requestFingerprint,
    responseStatus: params.responseStatus,
    responseBody: params.responseBody,
  });
}
