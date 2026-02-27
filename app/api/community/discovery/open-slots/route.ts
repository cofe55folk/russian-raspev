import { NextResponse, type NextRequest } from "next/server";
import { listOpenCollabSlots, type CollabReferenceContentType } from "../../../../lib/community/collab-store";
import { rankOpenSlots } from "../../../../lib/community/discovery-ranking";
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

function parseContentType(value: string | null): CollabReferenceContentType | undefined {
  if (!value) return undefined;
  if (value === "sound" || value === "article" || value === "video" || value === "education") {
    return value;
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-discovery-open-slots:get:${ip}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const role = request.nextUrl.searchParams.get("role") || undefined;
  const referenceContentType = parseContentType(request.nextUrl.searchParams.get("referenceContentType"));
  const referenceContentId = request.nextUrl.searchParams.get("referenceContentId") || undefined;
  const now = request.nextUrl.searchParams.get("now") || undefined;

  const probe = await listOpenCollabSlots({ offset: 0, limit: 1 });
  const full =
    probe.total > 0 ? await listOpenCollabSlots({ offset: 0, limit: probe.total }) : { total: 0, items: [] as typeof probe.items };

  const ranked = rankOpenSlots(full.items, {
    role,
    referenceContentType,
    referenceContentId,
    now,
  });

  const items = ranked.slice(offset, offset + limit);
  const nextOffset = offset + limit < ranked.length ? offset + limit : null;

  return NextResponse.json({
    total: ranked.length,
    offset,
    limit,
    nextOffset,
    items,
  });
}
