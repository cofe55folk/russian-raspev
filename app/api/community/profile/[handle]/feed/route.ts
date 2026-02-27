import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import { listCommunityProfileFeedByHandle, type CommunityPublicationType } from "../../../../../lib/community/social-store";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";

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

function parsePublicationType(value: string | null): CommunityPublicationType | undefined {
  if (!value) return undefined;
  if (value === "multitrack" || value === "room" || value === "article" || value === "podcast" || value === "photo") {
    return value;
  }
  return undefined;
}

export async function GET(request: NextRequest, context: { params: Promise<{ handle: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-profile-feed:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { handle } = await context.params;
  const normalizedHandle = handle.trim().toLowerCase();
  if (!normalizedHandle || !/^[a-z0-9][a-z0-9_-]{2,29}$/.test(normalizedHandle)) {
    return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
  }

  const session = await readAuthSessionFromRequest(request);
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const cursor = parseCursor(request.nextUrl.searchParams.get("cursor"));
  const type = parsePublicationType(request.nextUrl.searchParams.get("type"));
  if (request.nextUrl.searchParams.get("type") && !type) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const listed = await listCommunityProfileFeedByHandle({
    handle: normalizedHandle,
    limit,
    cursor,
    viewerUserId: session?.userId,
    type,
  });

  if (!listed.foundHandle) {
    return NextResponse.json({ error: "Profile feed not found" }, { status: 404 });
  }

  return NextResponse.json({
    handle: normalizedHandle,
    total: listed.total,
    limit,
    cursor: cursor || null,
    nextCursor: listed.nextCursor,
    items: listed.items,
  });
}
