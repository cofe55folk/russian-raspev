import { NextResponse, type NextRequest } from "next/server";
import { listCommunityGlobalFeed, type CommunityPublicationType } from "../../../lib/community/social-store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

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

function parseSort(value: string | null): "fresh" | "best" {
  return value === "best" ? "best" : "fresh";
}

function parseType(value: string | null): CommunityPublicationType | undefined {
  if (!value) return undefined;
  if (value === "multitrack" || value === "room" || value === "article" || value === "podcast" || value === "photo") {
    return value;
  }
  return undefined;
}

function parseRegion(value: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized.slice(0, 120);
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-global-feed:get:${ip}`, 360, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const cursor = parseCursor(request.nextUrl.searchParams.get("cursor"));
  const sort = parseSort(request.nextUrl.searchParams.get("sort"));
  const type = parseType(request.nextUrl.searchParams.get("type"));
  if (request.nextUrl.searchParams.get("type") && !type) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  const region = parseRegion(request.nextUrl.searchParams.get("region"));

  const listed = await listCommunityGlobalFeed({
    sort,
    limit,
    cursor,
    type,
    region,
  });

  return NextResponse.json({
    sort,
    total: listed.total,
    limit,
    cursor: cursor || null,
    nextCursor: listed.nextCursor,
    items: listed.items,
  });
}
