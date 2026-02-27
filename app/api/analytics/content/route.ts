import { NextResponse, type NextRequest } from "next/server";
import { getContentView3sCount, isAnalyticsContentType } from "../../../lib/analytics/store-file";
import { allowRateLimit } from "../../../lib/security/rateLimit";

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`analytics-content:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const contentType = request.nextUrl.searchParams.get("contentType");
  const contentId = request.nextUrl.searchParams.get("contentId")?.trim() || "";
  if (!isAnalyticsContentType(contentType) || !contentId) {
    return NextResponse.json({ error: "Invalid contentType or contentId" }, { status: 400 });
  }

  const view3sCount = await getContentView3sCount({
    contentType,
    contentId,
  });

  return NextResponse.json({
    contentType,
    contentId,
    view3sCount,
  });
}
