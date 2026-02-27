import { NextResponse, type NextRequest } from "next/server";

import { getGuestSyncGlobalSummary } from "../../../../lib/analytics/guest-sync-summary";
import { validateAdminRateLimit, validateAdminSecret } from "../_shared";

export async function GET(request: NextRequest) {
  const rateLimitError = validateAdminRateLimit(request, {
    keyPrefix: "admin-analytics-guest-sync-summary:get",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimitError) return rateLimitError;

  const adminError = validateAdminSecret(request);
  if (adminError) return adminError;

  const summary = await getGuestSyncGlobalSummary();
  return NextResponse.json({ summary });
}
