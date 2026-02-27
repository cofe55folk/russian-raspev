import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../../lib/auth/session";
import { isPreviewFeatureEnabledForRequest } from "../../../../../../lib/feature-flags/preview";
import { allowRateLimit } from "../../../../../../lib/security/rateLimit";
import { normalizeRecordingV2ChunkPayload } from "../../../../../../lib/ugc/recording-v2-contract";
import { appendRecordingV2Chunk } from "../../../../../../lib/ugc/recording-v2-store-file";

type RouteContext = {
  params: Promise<{ takeId: string }>;
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type ParsedChunkBody =
  | { ok: true; payloadRaw: unknown; chunkBytes: Uint8Array | null }
  | { ok: false; status: number; error: string };

function isBinaryFormPart(value: FormDataEntryValue | null): value is File {
  return !!value && typeof value === "object" && typeof (value as File).arrayBuffer === "function";
}

async function parseChunkBody(request: NextRequest): Promise<ParsedChunkBody> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return { ok: false, status: 400, error: "INVALID_FORM_DATA" };
    }

    const metaRaw = form.get("meta") ?? form.get("payload");
    if (typeof metaRaw !== "string") {
      return { ok: false, status: 422, error: "MISSING_CHUNK_META" };
    }

    let payloadRaw: unknown = {};
    try {
      payloadRaw = JSON.parse(metaRaw);
    } catch {
      return { ok: false, status: 400, error: "INVALID_CHUNK_META_JSON" };
    }

    const chunkPart = form.get("chunk");
    if (!isBinaryFormPart(chunkPart)) {
      return { ok: false, status: 422, error: "MISSING_CHUNK_BINARY" };
    }

    const chunkBytes = new Uint8Array(await chunkPart.arrayBuffer());
    return { ok: true, payloadRaw, chunkBytes };
  }

  let payloadRaw: unknown = {};
  try {
    payloadRaw = await request.json();
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON payload" };
  }
  return { ok: true, payloadRaw, chunkBytes: null };
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isPreviewFeatureEnabledForRequest(request, "recording_engine_v2")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await readAuthSessionFromRequest(request);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const rateScope = session?.userId ? `user:${session.userId}` : `ip:${ip}`;
  const rateLimitPerMinute = session?.userId ? 1200 : 360;
  if (!allowRateLimit(`ugc-recording-v2:chunk:post:${rateScope}`, rateLimitPerMinute, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsedBody = await parseChunkBody(request);
  if (!parsedBody.ok) {
    return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
  }

  const normalized = normalizeRecordingV2ChunkPayload(parsedBody.payloadRaw);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 422 });
  }

  if (parsedBody.chunkBytes) {
    const binaryByteLength = parsedBody.chunkBytes.byteLength;
    if (binaryByteLength !== normalized.value.byteLength) {
      return NextResponse.json(
        {
          error: "CHUNK_BINARY_SIZE_MISMATCH",
          expectedByteLength: normalized.value.byteLength,
          actualByteLength: binaryByteLength,
        },
        { status: 422 }
      );
    }
    const binaryChecksum = sha256Hex(parsedBody.chunkBytes);
    if (binaryChecksum !== normalized.value.checksumSha256) {
      return NextResponse.json(
        {
          error: "CHUNK_BINARY_CHECKSUM_MISMATCH",
          expectedChecksumSha256: normalized.value.checksumSha256,
          actualChecksumSha256: binaryChecksum,
        },
        { status: 422 }
      );
    }
  }

  const { takeId } = await context.params;
  if (normalized.value.takeId !== takeId) {
    return NextResponse.json({ error: "TAKE_ID_MISMATCH" }, { status: 422 });
  }

  const result = await appendRecordingV2Chunk({
    ownerId: session.userId,
    payload: normalized.value,
    chunkBytes: parsedBody.chunkBytes,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        existingChunk: result.existingChunk,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    idempotent: result.idempotent,
    chunk: result.chunk,
  });
}
