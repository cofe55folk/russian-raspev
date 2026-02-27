import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { getCollabSummarySnapshot } from "../../../lib/community/collab-analytics";
import { allowRateLimit } from "../../../lib/security/rateLimit";

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`analytics-collab-summary:get:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const summary = await getCollabSummarySnapshot();
  return NextResponse.json({ summary });
}
