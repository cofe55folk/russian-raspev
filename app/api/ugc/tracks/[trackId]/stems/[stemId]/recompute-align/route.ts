import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../../../lib/auth/session";
import { isPreviewFeatureEnabledForRequest } from "../../../../../../../lib/feature-flags/preview";
import { allowRateLimit } from "../../../../../../../lib/security/rateLimit";
import { recomputeCreatorTrackStemAlignment } from "../../../../../../../lib/ugc/tracks-store";

type RouteContext = {
  params: Promise<{ trackId: string; stemId: string }>;
};

type RecomputePayload = {
  referenceStemId?: string;
};

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, limit);
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isPreviewFeatureEnabledForRequest(request, "ugc_creator_tracks")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`ugc-track-stem-align:post:${ip}`, 40, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: RecomputePayload = {};
  try {
    payload = (await request.json()) as RecomputePayload;
  } catch {
    payload = {};
  }

  const { trackId, stemId } = await context.params;
  try {
    const result = await recomputeCreatorTrackStemAlignment({
      ownerId: session.userId,
      trackId,
      stemId,
      referenceStemId: normalizeText(payload.referenceStemId, 120),
    });
    return NextResponse.json({
      ok: true,
      track: result.track,
      stem: result.stem,
      usedReferenceStemId: result.usedReferenceStemId,
    });
  } catch (error) {
    if (error instanceof Error && (error.message === "TRACK_NOT_FOUND" || error.message === "STEM_NOT_FOUND")) {
      return NextResponse.json({ error: "Track/stem not found" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "TRACK_FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (
      error instanceof Error &&
      [
        "REFERENCE_STEM_NOT_FOUND",
        "STEM_ASSET_MISSING",
        "REFERENCE_ASSET_MISSING",
        "ALIGNMENT_UNSUPPORTED_FORMAT",
      ].includes(error.message)
    ) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof Error && error.message === "ALIGNMENT_RECOMPUTE_NOT_SUPPORTED") {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    if (error instanceof Error && ["ASSET_NOT_FOUND", "ASSET_BYTES_NOT_FOUND"].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
