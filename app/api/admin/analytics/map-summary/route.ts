import { NextResponse, type NextRequest } from "next/server";

import { getMapProbeGlobalSummary } from "../../../../lib/analytics/map-summary";
import { validateAdminRateLimit, validateAdminSecret } from "../_shared";

export async function GET(request: NextRequest) {
  const rateLimitError = validateAdminRateLimit(request, {
    keyPrefix: "admin-analytics-map-summary:get",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimitError) return rateLimitError;

  const adminError = validateAdminSecret(request);
  if (adminError) return adminError;

  const summary = await getMapProbeGlobalSummary();
  return NextResponse.json({ summary });
}
