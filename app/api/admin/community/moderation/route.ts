import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  setCommentVisibility,
  upsertUserRestriction,
} from "../../../../lib/community/store";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type ModerationPayload = {
  action?: "hideComment" | "showComment" | "setUserRestriction";
  commentId?: string;
  userId?: string;
  canComment?: boolean;
  linksAllowed?: boolean;
  commentCooldownSec?: number;
  bannedUntil?: string | null;
  source?: string;
};

function safeSecretCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function parseIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`admin-community-moderation:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const configuredSecret = process.env.RR_ADMIN_API_SECRET?.trim() || "";
  if (!configuredSecret) {
    return NextResponse.json({ error: "Admin API secret is not configured" }, { status: 503 });
  }
  const providedSecret = request.headers.get("x-rr-admin-secret")?.trim() || "";
  if (!providedSecret || !safeSecretCompare(providedSecret, configuredSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ModerationPayload = {};
  try {
    payload = (await request.json()) as ModerationPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (payload.action === "hideComment" || payload.action === "showComment") {
    const commentId = payload.commentId?.trim() || "";
    if (!commentId) return NextResponse.json({ error: "commentId is required" }, { status: 400 });
    const updated = await setCommentVisibility({
      commentId,
      status: payload.action === "hideComment" ? "hidden" : "visible",
    });
    if (!updated) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    return NextResponse.json({ ok: true, comment: updated });
  }

  if (payload.action === "setUserRestriction") {
    const userId = payload.userId?.trim() || "";
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
    const updated = await upsertUserRestriction({
      userId,
      canComment: payload.canComment,
      linksAllowed: payload.linksAllowed,
      commentCooldownSec: payload.commentCooldownSec,
      bannedUntil: parseIsoOrNull(payload.bannedUntil),
      source: payload.source?.trim() || "admin-moderation-api",
    });
    return NextResponse.json({ ok: true, restriction: updated });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
