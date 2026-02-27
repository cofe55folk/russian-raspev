import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest, sessionHasEntitlement } from "../../../../lib/auth/session";
import { isLocale, LOCALE_COOKIE_NAME, type Locale } from "../../../../lib/i18n/types";
import { issueMediaAccessToken } from "../../../../lib/media/accessToken";
import { allowRateLimit } from "../../../../lib/security/rateLimit";
import { getSoundBySlug, getSoundDisplayTitle, getSoundTrackAccess } from "../../../../lib/soundCatalog";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

function resolveRouteLocale(request: NextRequest): Locale {
  const fromHeader = request.headers.get("x-rr-locale");
  if (isLocale(fromHeader)) return fromHeader;
  const fromCookie = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return "ru";
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  const locale = resolveRouteLocale(request);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`tracks:${ip}:${slug}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const sound = getSoundBySlug(slug);
  if (!sound) {
    return NextResponse.json({ error: "Sound not found" }, { status: 404 });
  }

  const access = getSoundTrackAccess(sound, locale);
  const session = await readAuthSessionFromRequest(request);
  const premiumUnlocked = sessionHasEntitlement(session, access.entitlementCode);
  const signedPremiumTracks = premiumUnlocked && access.entitlementCode
    ? access.premiumTracks.map((track) => {
        const exp = Date.now() + 5 * 60 * 1000;
        const token = issueMediaAccessToken({
          src: track.src,
          exp,
          entitlementCode: access.entitlementCode ?? undefined,
        });
        return {
          ...track,
          src: `/api/media/stream?token=${encodeURIComponent(token)}`,
        };
      })
    : access.premiumTracks;
  const tracks = premiumUnlocked ? [...access.freeTracks, ...signedPremiumTracks] : access.freeTracks;
  const premiumTracks = premiumUnlocked
    ? signedPremiumTracks
    : access.premiumTracks.map((track) => ({ name: track.name, src: "" }));

  return NextResponse.json({
    slug: sound.slug,
    title: getSoundDisplayTitle(sound, locale),
    requiredEntitlement: access.entitlementCode,
    premiumUnlocked,
    freeTracks: access.freeTracks,
    premiumTracks,
    tracks,
    counts: {
      free: access.freeTracks.length,
      premium: access.premiumTracks.length,
      total: access.allTracks.length,
      available: tracks.length,
    },
  });
}
