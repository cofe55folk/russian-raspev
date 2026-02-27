import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../../lib/auth/session";
import { allowRateLimit } from "../../../../../../lib/security/rateLimit";
import { persistIdempotencyResult, resolveIdempotency } from "../../../../../../lib/security/idempotency";
import { publishPhotoArchiveAsset, type PhotoArchiveErrorCode } from "../../../../../../lib/photo/archive-contract";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

type ApiErrorCode =
  | PhotoArchiveErrorCode
  | "UNAUTHORIZED"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"
  | "TOO_MANY_REQUESTS";

function errorResponse(status: number, code: ApiErrorCode, message: string, traceId: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        traceId,
        ...(details == null ? {} : { details }),
      },
    },
    { status },
  );
}

function statusForContractCode(code: PhotoArchiveErrorCode): number {
  if (code === "ASSET_NOT_FOUND") return 404;
  if (code === "CONTEXT_INCOMPLETE" || code === "RIGHTS_INCOMPLETE") return 422;
  if (code === "RIGHTS_DISPUTED") return 409;
  if (code === "INVALID_JSON" || code === "INVALID_MULTIPART") return 400;
  if (code === "FILE_REQUIRED" || code === "FILE_INVALID_TYPE" || code === "FILE_TOO_LARGE") return 400;
  return 422;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const traceId = request.headers.get("x-request-id")?.trim() || `photo_publish_${Date.now()}`;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`photo-archive-publish:post:${ip}`, 120, 60_000)) {
    return errorResponse(429, "TOO_MANY_REQUESTS", "Too many requests", traceId);
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return errorResponse(401, "UNAUTHORIZED", "Unauthorized", traceId);

  const { assetId } = await context.params;
  let payload: unknown = {};
  try {
    payload = (await request.json()) as unknown;
  } catch {
    payload = {};
  }

  const idempotencyScope = `photo.archive.assets.publish:user:${session.userId}:asset:${assetId}`;
  const idempotency = await resolveIdempotency({
    scope: idempotencyScope,
    idempotencyKeyHeader: request.headers.get("idempotency-key"),
    payload,
  });
  if (!idempotency.ok) {
    if (idempotency.error === "INVALID_IDEMPOTENCY_KEY") {
      return errorResponse(422, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key format is invalid", traceId);
    }
    return errorResponse(
      409,
      "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
      "Idempotency-Key was already used with a different payload",
      traceId,
    );
  }
  if (idempotency.mode === "replay") {
    return NextResponse.json(idempotency.responseBody, { status: idempotency.responseStatus });
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

  const published = await publishPhotoArchiveAsset(assetId);
  if (!published.ok) {
    return respond(statusForContractCode(published.code), {
      ok: false,
      error: {
        code: published.code,
        message: published.message,
        traceId,
      },
    });
  }

  return respond(200, {
    ok: true,
    traceId,
    asset: {
      id: published.asset.id,
      publishStatus: published.asset.publishStatus,
      visibility: published.asset.visibility,
      publishedAt: published.asset.publishedAt,
      updatedAt: published.asset.updatedAt,
    },
  });
}
