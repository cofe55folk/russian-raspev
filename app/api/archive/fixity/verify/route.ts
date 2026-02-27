import { NextResponse, type NextRequest } from "next/server";
import {
  ArchiveFixityVerifyError,
  parseArchiveFixityVerifyInput,
  verifyArchiveFixity,
} from "../../../../lib/archive/fixity";
import { persistIdempotencyResult, resolveIdempotency } from "../../../../lib/security/idempotency";

type ApiErrorCode =
  | "invalid_json"
  | "invalid_asset_id"
  | "invalid_checksum_sha256"
  | "invalid_payload"
  | "invalid_idempotency_key"
  | "idempotency_key_payload_mismatch"
  | "verify_failed";

function errorResponse(status: number, code: ApiErrorCode, message: string, traceId: string) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        traceId,
      },
    },
    { status },
  );
}

export async function POST(request: NextRequest) {
  const requestTraceId = request.headers.get("x-request-id")?.trim() || `fixity_req_${Date.now()}`;

  let rawPayload: unknown;
  try {
    rawPayload = (await request.json()) as unknown;
  } catch {
    return errorResponse(400, "invalid_json", "Body must be valid JSON.", requestTraceId);
  }

  const idempotencyScope = "archive.fixity.verify.post";
  const idempotency = await resolveIdempotency({
    scope: idempotencyScope,
    idempotencyKeyHeader: request.headers.get("idempotency-key"),
    payload: rawPayload,
  });
  if (!idempotency.ok) {
    if (idempotency.error === "INVALID_IDEMPOTENCY_KEY") {
      return errorResponse(422, "invalid_idempotency_key", "Idempotency-Key format is invalid.", requestTraceId);
    }
    return errorResponse(
      409,
      "idempotency_key_payload_mismatch",
      "Idempotency-Key was already used with a different payload.",
      requestTraceId,
    );
  }
  if (idempotency.mode === "replay") {
    const replayBody =
      idempotency.responseBody &&
      typeof idempotency.responseBody === "object" &&
      "ok" in (idempotency.responseBody as Record<string, unknown>)
        ? { ...(idempotency.responseBody as Record<string, unknown>), idempotent: true }
        : idempotency.responseBody;
    return NextResponse.json(replayBody, { status: idempotency.responseStatus });
  }

  const respond = async (status: number, body: unknown) => {
    if (idempotency.mode === "new") {
      await persistIdempotencyResult({
        scope: idempotencyScope,
        resolved: idempotency,
        responseStatus: status,
        responseBody: body,
      });
    }
    return NextResponse.json(body, { status });
  };

  const parsed = parseArchiveFixityVerifyInput(rawPayload);
  if (!parsed.ok) {
    if (parsed.error === "INVALID_ASSET_ID") {
      return respond(422, {
        ok: false,
        error: {
          code: "invalid_asset_id",
          message: "assetId must be a non-empty string.",
          traceId: requestTraceId,
        },
      });
    }
    if (parsed.error === "INVALID_CHECKSUM_SHA256") {
      return respond(422, {
        ok: false,
        error: {
          code: "invalid_checksum_sha256",
          message: "checksumSha256 must be a lowercase or uppercase SHA-256 hex.",
          traceId: requestTraceId,
        },
      });
    }
    return respond(422, {
      ok: false,
      error: {
        code: "invalid_payload",
        message: "Payload must include assetId and checksumSha256.",
        traceId: requestTraceId,
      },
    });
  }

  try {
    const result = await verifyArchiveFixity({
      ...parsed.value,
      idempotencyKey: idempotency.mode === "new" ? idempotency.idempotencyKey : undefined,
    });
    const status = result.matched ? 200 : 409;

    return respond(status, {
      ok: result.ok,
      matched: result.matched,
      idempotent: result.idempotent,
      replayKey: result.replayKey,
      requestFingerprint: result.requestFingerprint,
      traceId: result.traceId,
      idempotencySource: result.idempotencySource,
      state: result.state,
      quarantinePath: result.quarantinePath,
      asset: result.asset,
      audit: result.audit,
    });
  } catch (error) {
    if (error instanceof ArchiveFixityVerifyError && error.code === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH") {
      return respond(409, {
        ok: false,
        error: {
          code: "idempotency_key_payload_mismatch",
          message: "Idempotency-Key was already used with a different payload.",
          traceId: requestTraceId,
        },
      });
    }
    return respond(500, {
      ok: false,
      error: {
        code: "verify_failed",
        message: "Fixity verification failed.",
        traceId: requestTraceId,
      },
    });
  }
}
