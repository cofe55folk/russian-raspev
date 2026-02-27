import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, REQUEST_LOCALE_HEADER_NAME, isLocale, type Locale } from "../../../lib/i18n/types";
import { getPopularQueries, registerSearchQuery, registerSearchQueryOutcome } from "../../../lib/search/queryStats";
import { suggestSiteSearch } from "../../../lib/search/siteSearch";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fireAndForget(task: Promise<unknown>): void {
  void task.catch(() => {});
}

function resolveRequestLocale(request: NextRequest): Locale {
  const fromHeader = request.headers.get(REQUEST_LOCALE_HEADER_NAME);
  if (isLocale(fromHeader)) return fromHeader;
  const fromCookie = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return DEFAULT_LOCALE;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const region = (url.searchParams.get("region") ?? "").trim();
  const timeWindowRaw = url.searchParams.get("timeWindow") ?? "";
  const timeWindow = timeWindowRaw === "upcoming" || timeWindowRaw === "past" ? timeWindowRaw : "all";
  const limitRaw = Number(url.searchParams.get("limit"));
  const normalizedLimit = Number.isNaN(limitRaw) ? undefined : limitRaw;
  const locale = resolveRequestLocale(request);
  const session = await readAuthSessionFromRequest(request);
  const userEntitlements = session?.entitlements.map((item) => item.code) ?? [];

  if (query.trim()) {
    fireAndForget(registerSearchQuery(query, locale));
  }

  const [payload, popularQueries] = await Promise.all([
    suggestSiteSearch(query, normalizedLimit, {
      entitlements: userEntitlements,
      region: region || undefined,
      timeWindow,
    }),
    getPopularQueries(normalizedLimit ?? 8, locale),
  ]);

  if (query.trim()) {
    fireAndForget(
      registerSearchQueryOutcome(query, {
        locale,
        resultCount: payload.results.length,
      })
    );
  }

  return NextResponse.json(
    {
      ...payload,
      popularQueries,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}
