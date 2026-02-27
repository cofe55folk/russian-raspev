import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../lib/auth/session";
import { listCommunityInbox } from "../../../../lib/community/social-store";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

function parseLimit(value: string | null): number {
  const num = Number(value || "20");
  if (!Number.isFinite(num)) return 20;
  return Math.max(1, Math.min(50, Math.floor(num)));
}

function parseCursor(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 160) : undefined;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-messages-inbox:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const cursor = parseCursor(request.nextUrl.searchParams.get("cursor"));
  const listed = await listCommunityInbox({
    userId: session.userId,
    limit,
    cursor,
  });

  return NextResponse.json({
    total: listed.total,
    limit,
    cursor: cursor || null,
    nextCursor: listed.nextCursor,
    items: listed.items,
  });
}

