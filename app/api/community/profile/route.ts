import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import {
  ProfileHandleTakenError,
  getCommunityUserProfile,
  upsertCommunityUserProfile,
  type ProfileVisibility,
  type UserRingStyle,
} from "../../../lib/community/profiles";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type UpdateProfilePayload = {
  displayName?: string;
  handle?: string;
  bio?: string;
  visibility?: ProfileVisibility;
  avatarUrl?: string;
  ringStyle?: UserRingStyle;
};

function normalizeRingStyle(value: unknown): UserRingStyle {
  if (value === "sky") return "sky";
  if (value === "emerald") return "emerald";
  if (value === "gold") return "gold";
  return "none";
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 80);
}

function normalizeHandle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeBio(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 500);
}

function normalizeVisibility(value: unknown): ProfileVisibility {
  return value === "public" ? "public" : "private";
}

function normalizeAvatar(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 500);
}

function canUsePremiumRing(entitlementsCount: number): boolean {
  return entitlementsCount > 0;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-profile:get:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getCommunityUserProfile(session.userId);
  const premiumRings = canUsePremiumRing(session.entitlements.length);

  return NextResponse.json({
    profile: {
      displayName: profile?.displayName || session.name || "",
      handle: profile?.handle || "",
      bio: profile?.bio || "",
      visibility: profile?.visibility || "private",
      avatarUrl: profile?.avatarUrl || "",
      ringStyle: profile?.ringStyle || "none",
      updatedAt: profile?.updatedAt || null,
    },
    premiumRings,
  });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-profile:post:${ip}`, 80, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: UpdateProfilePayload = {};
  try {
    payload = (await request.json()) as UpdateProfilePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const ringStyle = normalizeRingStyle(payload.ringStyle);
  if (ringStyle !== "none" && !canUsePremiumRing(session.entitlements.length)) {
    return NextResponse.json({ error: "Premium ring is not available for this account" }, { status: 403 });
  }

  const handle = normalizeHandle(payload.handle);
  const visibility = normalizeVisibility(payload.visibility);
  if (payload.handle !== undefined && !handle && String(payload.handle).trim()) {
    return NextResponse.json(
      { error: "Handle must contain 3-30 chars: latin letters, digits, '_' or '-'" },
      { status: 422 }
    );
  }
  if (visibility === "public" && !handle) {
    return NextResponse.json({ error: "Public profile requires a valid handle" }, { status: 422 });
  }

  try {
    const saved = await upsertCommunityUserProfile({
      userId: session.userId,
      displayName: normalizeName(payload.displayName),
      handle,
      bio: normalizeBio(payload.bio),
      visibility,
      avatarUrl: normalizeAvatar(payload.avatarUrl),
      ringStyle,
    });

    return NextResponse.json({
      ok: true,
      profile: {
        displayName: saved.displayName || session.name || "",
        handle: saved.handle || "",
        bio: saved.bio || "",
        visibility: saved.visibility,
        avatarUrl: saved.avatarUrl || "",
        ringStyle: saved.ringStyle,
        updatedAt: saved.updatedAt,
      },
      premiumRings: canUsePremiumRing(session.entitlements.length),
    });
  } catch (error) {
    if (error instanceof ProfileHandleTakenError) {
      return NextResponse.json({ error: "Handle is already taken" }, { status: 409 });
    }
    throw error;
  }
}
