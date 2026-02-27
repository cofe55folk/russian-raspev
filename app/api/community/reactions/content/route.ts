import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../lib/auth/session";
import {
  getContentReactionsSummary,
  toggleBookmark,
  toggleContentLike,
} from "../../../../lib/community/store";
import { isCommunityContentType } from "../../../../lib/community/types";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type TogglePayload = {
  action?: "toggleLike" | "toggleBookmark";
  contentType?: string;
  contentId?: string;
  title?: string;
  href?: string;
};

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-reactions:get:${ip}`, 360, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const contentTypeRaw = request.nextUrl.searchParams.get("contentType")?.trim();
  const contentId = request.nextUrl.searchParams.get("contentId")?.trim() || "";
  if (!isCommunityContentType(contentTypeRaw) || !contentId) {
    return NextResponse.json({ error: "Invalid contentType or contentId" }, { status: 400 });
  }

  const session = await readAuthSessionFromRequest(request);
  const summary = await getContentReactionsSummary({
    userId: session?.userId,
    contentType: contentTypeRaw,
    contentId,
  });
  return NextResponse.json(summary);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-reactions:post:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: TogglePayload = {};
  try {
    payload = (await request.json()) as TogglePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const contentTypeRaw = payload.contentType?.trim();
  const contentId = payload.contentId?.trim() || "";
  if (!isCommunityContentType(contentTypeRaw) || !contentId) {
    return NextResponse.json({ error: "Invalid contentType or contentId" }, { status: 400 });
  }

  if (payload.action === "toggleLike") {
    const result = await toggleContentLike({
      userId: session.userId,
      contentType: contentTypeRaw,
      contentId,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (payload.action === "toggleBookmark") {
    const result = await toggleBookmark({
      userId: session.userId,
      contentType: contentTypeRaw,
      contentId,
      title: payload.title?.trim() || undefined,
      href: payload.href?.trim() || undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
