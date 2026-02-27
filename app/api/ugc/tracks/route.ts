import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { isPreviewFeatureEnabledForRequest } from "../../../lib/feature-flags/preview";
import {
  createCreatorTrackDraft,
  type UgcStemAlignMethod,
  type UgcStemAlignStatus,
  listCreatorTracksByOwner,
  UgcTrackSlugTakenError,
  type UgcStemAccessTier,
  type UgcTrackStatus,
  type UgcTrackVisibility,
} from "../../../lib/ugc/tracks-store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type CreateTrackPayload = {
  slug?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  language?: string;
  visibility?: UgcTrackVisibility;
  status?: UgcTrackStatus;
  entitlementCode?: string;
  stems?: Array<{
    label?: string;
    sortOrder?: number;
    accessTier?: UgcStemAccessTier;
    entitlementCode?: string;
    durationSec?: number;
    referenceStemId?: string;
    alignmentOffsetMs?: number;
    alignmentScore?: number;
    alignmentStatus?: UgcStemAlignStatus;
    alignmentMethod?: UgcStemAlignMethod;
    alignmentMeasuredAt?: string;
  }>;
};

function normalizeSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const slug = value.trim().toLowerCase();
  if (!slug) return undefined;
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug)) return undefined;
  return slug;
}

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, limit);
}

function normalizeVisibility(value: unknown): UgcTrackVisibility {
  if (value === "public") return "public";
  if (value === "unlisted") return "unlisted";
  return "private";
}

function normalizeStatus(value: unknown): UgcTrackStatus {
  return value === "published" ? "published" : "draft";
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

export async function GET(request: NextRequest) {
  if (!isPreviewFeatureEnabledForRequest(request, "ugc_creator_tracks")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`ugc-tracks:get:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tracks = await listCreatorTracksByOwner(session.userId);
  return NextResponse.json({ tracks });
}

export async function POST(request: NextRequest) {
  if (!isPreviewFeatureEnabledForRequest(request, "ugc_creator_tracks")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`ugc-tracks:post:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: CreateTrackPayload = {};
  try {
    payload = (await request.json()) as CreateTrackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const slug = normalizeSlug(payload.slug);
  const title = normalizeText(payload.title, 140);
  if (!slug || !title) {
    return NextResponse.json(
      { error: "slug/title are required. slug: latin letters, digits and dashes (3-60 chars)." },
      { status: 422 }
    );
  }

  const stemsInput = Array.isArray(payload.stems) ? payload.stems.slice(0, 24) : [];

  try {
    const track = await createCreatorTrackDraft({
      ownerId: session.userId,
      slug,
      title,
      subtitle: normalizeText(payload.subtitle, 180),
      description: normalizeText(payload.description, 1000),
      language: normalizeText(payload.language, 12),
      visibility: normalizeVisibility(payload.visibility),
      status: normalizeStatus(payload.status),
      entitlementCode: normalizeText(payload.entitlementCode, 160),
      stems: stemsInput.map((item, index) => ({
        label: normalizeText(item?.label, 120),
        sortOrder: typeof item?.sortOrder === "number" && Number.isFinite(item.sortOrder) ? item.sortOrder : index,
        accessTier: normalizeStemAccessTier(item?.accessTier),
        entitlementCode: normalizeText(item?.entitlementCode, 160),
        durationSec:
          typeof item?.durationSec === "number" && Number.isFinite(item.durationSec)
            ? Math.max(0, Math.floor(item.durationSec))
            : undefined,
        referenceStemId: normalizeText(item?.referenceStemId, 120),
        alignmentOffsetMs: normalizeAlignmentOffsetMs(item?.alignmentOffsetMs),
        alignmentScore: normalizeAlignmentScore(item?.alignmentScore),
        alignmentStatus: normalizeStemAlignStatus(item?.alignmentStatus),
        alignmentMethod: normalizeStemAlignMethod(item?.alignmentMethod),
        alignmentMeasuredAt: normalizeText(item?.alignmentMeasuredAt, 40),
      })),
    });
    return NextResponse.json({ ok: true, track }, { status: 201 });
  } catch (error) {
    if (error instanceof UgcTrackSlugTakenError) {
      return NextResponse.json({ error: "Track slug already exists for this account" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "INVALID_TRACK_PAYLOAD") {
      return NextResponse.json({ error: "Invalid track payload" }, { status: 422 });
    }
    throw error;
  }
}
