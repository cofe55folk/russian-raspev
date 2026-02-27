import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";
import { persistIdempotencyResult, resolveIdempotency } from "../../../../../lib/security/idempotency";
import {
  createPhotoArchiveAssetUpload,
  getPhotoArchiveUploadLimitBytes,
  parsePhotoArchiveUploadForm,
  type PhotoArchiveErrorCode,
} from "../../../../../lib/photo/archive-contract";

type ApiErrorCode = PhotoArchiveErrorCode | "UNAUTHORIZED" | "INVALID_IDEMPOTENCY_KEY" | "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH";
type ExtendedApiErrorCode = ApiErrorCode | "TOO_MANY_REQUESTS" | "UPLOAD_FAILED";

function errorResponse(status: number, code: ExtendedApiErrorCode, message: string, traceId: string, details?: unknown) {
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
  if (code === "CONTEXT_INCOMPLETE" || code === "RIGHTS_INCOMPLETE" || code === "INVALID_JSON") return 422;
  if (code === "FILE_REQUIRED" || code === "FILE_INVALID_TYPE" || code === "FILE_TOO_LARGE") return 400;
  if (code === "RIGHTS_DISPUTED") return 409;
  if (code === "ASSET_NOT_FOUND") return 404;
  return 400;
}

export async function POST(request: NextRequest) {
  const traceId = request.headers.get("x-request-id")?.trim() || `photo_upload_${Date.now()}`;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`photo-archive-upload:post:${ip}`, 40, 60_000)) {
    return errorResponse(429, "TOO_MANY_REQUESTS", "Too many requests", traceId);
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return errorResponse(401, "UNAUTHORIZED", "Unauthorized", traceId);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, "INVALID_MULTIPART", "Body must be valid multipart/form-data", traceId);
  }

  const parsed = await parsePhotoArchiveUploadForm(formData);
  if (!parsed.ok) {
    return errorResponse(statusForContractCode(parsed.code), parsed.code, parsed.message, traceId, {
      maxBytes: getPhotoArchiveUploadLimitBytes(),
    });
  }

  const requestChecksum = createHash("sha256").update(parsed.bytes).digest("hex");
  const idempotencyPayload = {
    fileName: parsed.file.name,
    mimeType: parsed.file.type || "application/octet-stream",
    byteSize: parsed.bytes.byteLength,
    checksumSha256: requestChecksum,
    context: parsed.context,
    rights: parsed.rights,
  };

  const idempotencyScope = `photo.archive.assets.upload:user:${session.userId}`;
  const idempotency = await resolveIdempotency({
    scope: idempotencyScope,
    idempotencyKeyHeader: request.headers.get("idempotency-key"),
    payload: idempotencyPayload,
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

  try {
    const asset = await createPhotoArchiveAssetUpload({
      ownerId: session.userId,
      fileName: parsed.file.name || `photo-${Date.now()}.bin`,
      mimeType: parsed.file.type || "application/octet-stream",
      bytes: parsed.bytes,
      context: parsed.context,
      rights: parsed.rights,
    });

    return respond(201, {
      ok: true,
      traceId,
      asset: {
        id: asset.id,
        objectKey: asset.objectKey,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        checksumSha256: asset.checksumSha256,
        state: asset.state,
        visibility: asset.visibility,
        publishStatus: asset.publishStatus,
        context: asset.context,
        rights: asset.rights,
        createdAt: asset.createdAt,
      },
      links: {
        publish: `/api/photo/archive/assets/${encodeURIComponent(asset.id)}/publish`,
      },
    });
  } catch {
    return respond(500, {
      ok: false,
      error: {
        code: "UPLOAD_FAILED",
        message: "Photo asset upload failed",
        traceId,
      },
    });
  }
}
