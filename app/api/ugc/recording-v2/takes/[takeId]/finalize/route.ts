import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../../lib/auth/session";
import { isPreviewFeatureEnabledForRequest } from "../../../../../../lib/feature-flags/preview";
import { allowRateLimit } from "../../../../../../lib/security/rateLimit";
import { normalizeRecordingV2FinalizePayload } from "../../../../../../lib/ugc/recording-v2-contract";
import { finalizeRecordingV2Take, getRecordingV2TakeChunkStats } from "../../../../../../lib/ugc/recording-v2-store-file";

type RouteContext = {
  params: Promise<{ takeId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isPreviewFeatureEnabledForRequest(request, "recording_engine_v2")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await readAuthSessionFromRequest(request);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const rateScope = session?.userId ? `user:${session.userId}` : `ip:${ip}`;
  const rateLimitPerMinute = session?.userId ? 240 : 120;
  if (!allowRateLimit(`ugc-recording-v2:finalize:post:${rateScope}`, rateLimitPerMinute, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payloadRaw: unknown = {};
  try {
    payloadRaw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const normalized = normalizeRecordingV2FinalizePayload(payloadRaw);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 422 });
  }

  const { takeId } = await context.params;
  if (normalized.value.takeId !== takeId) {
    return NextResponse.json({ error: "TAKE_ID_MISMATCH" }, { status: 422 });
  }

  const chunkStats = await getRecordingV2TakeChunkStats({ ownerId: session.userId, takeId });
  if (normalized.value.totalChunks < chunkStats.chunkCount) {
    return NextResponse.json({ error: "TOTAL_CHUNKS_BELOW_RECEIVED" }, { status: 422 });
  }
  if (normalized.value.totalChunks !== chunkStats.uniqueChunkCount) {
    return NextResponse.json(
      {
        error: "TOTAL_CHUNKS_MISMATCH",
        chunkStats,
      },
      { status: 422 }
    );
  }
  if (chunkStats.minChunkIndex !== 0 || chunkStats.maxChunkIndex !== normalized.value.totalChunks - 1 || chunkStats.hasSequenceGap) {
    return NextResponse.json(
      {
        error: "CHUNK_SEQUENCE_INCOMPLETE",
        chunkStats,
      },
      { status: 422 }
    );
  }

  const result = await finalizeRecordingV2Take({
    ownerId: session.userId,
    payload: normalized.value,
  });
  return NextResponse.json({
    ok: true,
    idempotent: result.idempotent,
    finalize: result.finalize,
    chunkStats,
  });
}
