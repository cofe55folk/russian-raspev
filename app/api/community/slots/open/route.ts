import { NextResponse, type NextRequest } from "next/server";
import { listOpenCollabSlots } from "../../../../lib/community/collab-store";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

function parseOffset(value: string | null): number {
  const num = Number(value || "0");
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function parseLimit(value: string | null): number {
  const num = Number(value || "20");
  if (!Number.isFinite(num)) return 20;
  return Math.max(1, Math.min(100, Math.floor(num)));
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-open-slots:get:${ip}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const listed = await listOpenCollabSlots({ offset, limit });
  const nextOffset = offset + limit < listed.total ? offset + limit : null;

  return NextResponse.json({
    total: listed.total,
    offset,
    limit,
    nextOffset,
    items: listed.items,
  });
}
