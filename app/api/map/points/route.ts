import { NextResponse, type NextRequest } from "next/server";
import { getMapPoints } from "../../../lib/mapPoints";
import { allowRateLimit } from "../../../lib/security/rateLimit";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../../../lib/i18n/types";

function parseBoolean(raw: string | null): boolean | undefined {
  if (raw === null) return undefined;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return undefined;
}

function normalizeLocale(request: NextRequest): Locale {
  const fromHeader = request.headers.get("x-rr-locale");
  if (isLocale(fromHeader)) return fromHeader;
  return DEFAULT_LOCALE;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`map-points:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const search = request.nextUrl.searchParams;
  const points = getMapPoints({
    locale: normalizeLocale(request),
    genre: search.get("genre") || undefined,
    region: search.get("region") || undefined,
    expedition: search.get("expedition") || undefined,
    city: search.get("city") || undefined,
    hasEvents: parseBoolean(search.get("hasEvents")),
  });

  return NextResponse.json(points, {
    headers: {
      "cache-control": "public, max-age=60, stale-while-revalidate=600",
    },
  });
}
