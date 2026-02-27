import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_LOCALE, isLocale } from "../../../../../lib/i18n/types";
import { getSearchFailedQueriesCsv } from "../../../../../lib/search/queryStats";
import { validateAdminRateLimit, validateAdminSecret } from "../../_shared";

export async function GET(request: NextRequest) {
  const rateLimitError = validateAdminRateLimit(request, {
    keyPrefix: "admin-analytics-search-quality-export:get",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimitError) return rateLimitError;

  const adminError = validateAdminSecret(request);
  if (adminError) return adminError;

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;
  const localeRaw = url.searchParams.get("locale");
  const locale = isLocale(localeRaw) ? localeRaw : DEFAULT_LOCALE;
  const csv = await getSearchFailedQueriesCsv(limit, locale);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="search-failed-queries-${locale}.csv"`,
      "cache-control": "no-store",
    },
  });
}
