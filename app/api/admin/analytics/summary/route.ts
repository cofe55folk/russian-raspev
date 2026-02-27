import { NextResponse, type NextRequest } from "next/server";
import { getGlobalAnalyticsSummary } from "../../../../lib/analytics/store-file";
import { validateAdminRateLimit, validateAdminSecret } from "../_shared";

export async function GET(request: NextRequest) {
  const rateLimitError = validateAdminRateLimit(request, {
    keyPrefix: "admin-analytics-summary:get",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimitError) return rateLimitError;

  const adminError = validateAdminSecret(request);
  if (adminError) return adminError;

  const summary = await getGlobalAnalyticsSummary();
  return NextResponse.json({ summary });
}
