import { NextResponse, type NextRequest } from "next/server";

import { getGlobalAnalyticsSummary } from "../../../../lib/analytics/store-file";
import { DEFAULT_LOCALE, isLocale } from "../../../../lib/i18n/types";
import { getSearchQualitySummary } from "../../../../lib/search/queryStats";
import { validateAdminRateLimit, validateAdminSecret } from "../_shared";

export async function GET(request: NextRequest) {
  const rateLimitError = validateAdminRateLimit(request, {
    keyPrefix: "admin-analytics-search-quality:get",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimitError) return rateLimitError;

  const adminError = validateAdminSecret(request);
  if (adminError) return adminError;

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
  const localeRaw = url.searchParams.get("locale");
  const locale = isLocale(localeRaw) ? localeRaw : DEFAULT_LOCALE;

  const [qualitySummary, globalSummary] = await Promise.all([
    getSearchQualitySummary(limit, locale),
    getGlobalAnalyticsSummary(),
  ]);

  return NextResponse.json({
    summary: {
      ...qualitySummary,
      searchSubmitCount: globalSummary.searchSubmitCount,
      searchClickCount: globalSummary.searchClickCount,
      searchCtr: globalSummary.searchCtr,
      avgTimeToClickSec: globalSummary.avgSearchTimeToClickSec,
      searchZeroResultsViewCount: globalSummary.searchZeroResultsViewCount,
      searchRecoveryClickCount: globalSummary.searchRecoveryClickCount,
      searchRecoveryCtr: globalSummary.searchRecoveryCtr,
    },
  });
}
