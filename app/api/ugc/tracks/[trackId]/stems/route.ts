import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import { isPreviewFeatureEnabledForRequest } from "../../../../../lib/feature-flags/preview";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";
import {
  appendCreatorTrackStem,
  getCreatorTrackByIdForOwner,
  type UgcStemAlignMethod,
  type UgcStemAlignStatus,
  type UgcStemAccessTier,
} from "../../../../../lib/ugc/tracks-store";
import { getUgcAssetById } from "../../../../../lib/ugc/assets-store-file";

type RouteContext = {
  params: Promise<{ trackId: string }>;
};

type AttachStemPayload = {
  label?: string;
  sortOrder?: number;
  accessTier?: UgcStemAccessTier;
  entitlementCode?: string;
  durationSec?: number;
  assetUploadId?: string;
  referenceStemId?: string;
  alignmentOffsetMs?: number;
  alignmentScore?: number;
  alignmentStatus?: UgcStemAlignStatus;
  alignmentMethod?: UgcStemAlignMethod;
  alignmentMeasuredAt?: string;
};

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, limit);
}

function normalizeStemAccessTier(value: unknown): UgcStemAccessTier {
  return value === "premium" ? "premium" : "free";
}

function normalizeStemAlignStatus(value: unknown): UgcStemAlignStatus {
  if (value === "aligned") return "aligned";
  if (value === "needs_review") return "needs_review";
  return "pending";
}

function normalizeStemAlignMethod(value: unknown): UgcStemAlignMethod | undefined {
  if (value === "manual") return "manual";
  if (value === "rms_correlation") return "rms_correlation";
  if (value === "transient_anchor") return "transient_anchor";
  return undefined;
}

function normalizeAlignmentOffsetMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(-5000, Math.min(5000, Math.round(value)));
}

function normalizeAlignmentScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isPreviewFeatureEnabledForRequest(request, "ugc_creator_tracks")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`ugc-track-stems:post:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { trackId } = await context.params;
  const ownerTrack = await getCreatorTrackByIdForOwner(session.userId, trackId);
  if (!ownerTrack) return NextResponse.json({ error: "Track not found" }, { status: 404 });

  let payload: AttachStemPayload = {};
  try {
    payload = (await request.json()) as AttachStemPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const label = normalizeText(payload.label, 120);
  const assetUploadId = normalizeText(payload.assetUploadId, 120);
  if (!label || !assetUploadId) {
    return NextResponse.json({ error: "label and assetUploadId are required" }, { status: 422 });
  }

  const asset = await getUgcAssetById(assetUploadId);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (asset.ownerId !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await appendCreatorTrackStem({
      ownerId: session.userId,
      trackId,
      stem: {
        label,
        sortOrder:
          typeof payload.sortOrder === "number" && Number.isFinite(payload.sortOrder)
            ? Math.max(0, Math.floor(payload.sortOrder))
            : undefined,
        accessTier: normalizeStemAccessTier(payload.accessTier),
        entitlementCode: normalizeText(payload.entitlementCode, 160),
        durationSec:
          typeof payload.durationSec === "number" && Number.isFinite(payload.durationSec)
            ? Math.max(0, Math.floor(payload.durationSec))
            : undefined,
        assetUploadId: asset.id,
        assetMimeType: asset.mimeType,
        assetSizeBytes: asset.sizeBytes,
        referenceStemId: normalizeText(payload.referenceStemId, 120),
        alignmentOffsetMs: normalizeAlignmentOffsetMs(payload.alignmentOffsetMs),
        alignmentScore: normalizeAlignmentScore(payload.alignmentScore),
        alignmentStatus: normalizeStemAlignStatus(payload.alignmentStatus),
        alignmentMethod: normalizeStemAlignMethod(payload.alignmentMethod),
        alignmentMeasuredAt: normalizeText(payload.alignmentMeasuredAt, 40),
      },
    });
    return NextResponse.json({ ok: true, track: result.track, stem: result.stem }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "TRACK_NOT_FOUND") {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "INVALID_STEM_PAYLOAD") {
      return NextResponse.json({ error: "Invalid stem payload" }, { status: 422 });
    }
    throw error;
  }
}
