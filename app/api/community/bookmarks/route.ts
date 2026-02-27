import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { listBookmarksByUser } from "../../../lib/community/store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-bookmarks:get:${ip}`, 200, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bookmarks = await listBookmarksByUser(session.userId);
  return NextResponse.json({ bookmarks });
}
