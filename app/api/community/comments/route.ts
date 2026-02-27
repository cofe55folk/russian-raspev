import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import {
  canCommentByRestriction,
  canSessionPostLinks,
  getEffectiveCooldownSec,
  hasProfanity,
  hasUrl,
  isUserBannedNow,
  normalizeCommentBody,
} from "../../../lib/community/moderation";
import {
  createComment,
  getCommentById,
  getUserLastCommentAt,
  getUserRestriction,
  listCommentsByContent,
} from "../../../lib/community/store";
import {
  getCommunityUserProfile,
  listCommunityUserProfilesByIds,
} from "../../../lib/community/profiles";
import { isCommunityContentType } from "../../../lib/community/types";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type CreateCommentPayload = {
  contentType?: string;
  contentId?: string;
  parentId?: string;
  body?: string;
};

type CommentResponseItem = {
  id: string;
  parentId?: string;
  userId: string;
  userName: string;
  userHandle?: string;
  userAvatarUrl?: string;
  userRingStyle?: "none" | "sky" | "emerald" | "gold";
  body: string;
  createdAt: string;
  updatedAt: string;
};

function parseOffset(value: string | null): number {
  const num = Number(value || "0");
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function parseLimit(value: string | null): number {
  const num = Number(value || "20");
  if (!Number.isFinite(num)) return 20;
  return Math.max(1, Math.min(50, Math.floor(num)));
}

function paginateWithReplies(
  items: CommentResponseItem[],
  offset: number,
  limit: number
): { pageItems: CommentResponseItem[]; topLevelTotal: number; nextOffset: number | null } {
  const byParent = new Map<string, CommentResponseItem[]>();
  const roots: CommentResponseItem[] = [];
  for (const item of items) {
    if (!item.parentId) {
      roots.push(item);
      continue;
    }
    const bucket = byParent.get(item.parentId) ?? [];
    bucket.push(item);
    byParent.set(item.parentId, bucket);
  }
  const pageRoots = roots.slice(offset, offset + limit);
  const pageItems: CommentResponseItem[] = [];
  const appendTree = (node: CommentResponseItem) => {
    pageItems.push(node);
    for (const child of byParent.get(node.id) ?? []) {
      appendTree(child);
    }
  };
  for (const root of pageRoots) {
    appendTree(root);
  }
  const nextOffset = offset + limit < roots.length ? offset + limit : null;
  return {
    pageItems,
    topLevelTotal: roots.length,
    nextOffset,
  };
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-comments:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const contentTypeRaw = request.nextUrl.searchParams.get("contentType")?.trim();
  const contentId = request.nextUrl.searchParams.get("contentId")?.trim() || "";
  if (!isCommunityContentType(contentTypeRaw) || !contentId) {
    return NextResponse.json({ error: "Invalid contentType or contentId" }, { status: 400 });
  }

  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const listed = await listCommentsByContent({
    contentType: contentTypeRaw,
    contentId,
    offset: 0,
    limit: 1000,
  });
  const profilesByUser = await listCommunityUserProfilesByIds(listed.items.map((item) => item.userId));
  const mapped: CommentResponseItem[] = listed.items.map((item) => {
    const profile = profilesByUser.get(item.userId);
    return {
      id: item.id,
      parentId: item.parentId,
      userId: item.userId,
      userName: profile?.displayName || item.userName,
      userHandle: profile?.handle,
      userAvatarUrl: profile?.avatarUrl,
      userRingStyle: profile?.ringStyle || "none",
      body: item.body,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });
  const paged = paginateWithReplies(mapped, offset, limit);
  return NextResponse.json({
    totalComments: listed.totalVisible,
    totalTopLevel: paged.topLevelTotal,
    offset,
    limit,
    nextOffset: paged.nextOffset,
    items: paged.pageItems,
  });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-comments:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: CreateCommentPayload = {};
  try {
    payload = (await request.json()) as CreateCommentPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const contentTypeRaw = payload.contentType?.trim();
  const contentId = payload.contentId?.trim() || "";
  if (!isCommunityContentType(contentTypeRaw) || !contentId) {
    return NextResponse.json({ error: "Invalid contentType or contentId" }, { status: 400 });
  }

  const body = normalizeCommentBody(payload.body);
  if (!body) return NextResponse.json({ error: "Comment text is required" }, { status: 400 });
  if (hasProfanity(body)) {
    return NextResponse.json({ error: "Message blocked by moderation filter" }, { status: 422 });
  }

  const restriction = await getUserRestriction(session.userId);
  if (!canCommentByRestriction(restriction) || isUserBannedNow(restriction)) {
    return NextResponse.json({ error: "User is not allowed to comment" }, { status: 403 });
  }

  const linksAllowed = canSessionPostLinks(session, restriction);
  if (!linksAllowed && hasUrl(body)) {
    return NextResponse.json({ error: "Links are not allowed for this account" }, { status: 422 });
  }

  const cooldownSec = getEffectiveCooldownSec(restriction);
  if (cooldownSec > 0) {
    const lastCommentAt = await getUserLastCommentAt(session.userId);
    if (lastCommentAt) {
      const elapsedSec = Math.floor((Date.now() - new Date(lastCommentAt).getTime()) / 1000);
      if (Number.isFinite(elapsedSec) && elapsedSec < cooldownSec) {
        return NextResponse.json(
          { error: `Please wait ${cooldownSec - elapsedSec}s before next comment` },
          { status: 429 }
        );
      }
    }
  }

  const parentId = payload.parentId?.trim();
  if (parentId) {
    const parent = await getCommentById(parentId);
    if (!parent || parent.status !== "visible") {
      return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
    }
    if (parent.contentType !== contentTypeRaw || parent.contentId !== contentId) {
      return NextResponse.json({ error: "Parent comment belongs to another content item" }, { status: 400 });
    }
  }

  const profile = await getCommunityUserProfile(session.userId);
  const created = await createComment({
    contentType: contentTypeRaw,
    contentId,
    parentId: parentId || undefined,
    userId: session.userId,
    userName: profile?.displayName || session.name || session.email || session.userId,
    userEmail: session.email,
    body,
  });
  return NextResponse.json({ ok: true, comment: created }, { status: 201 });
}
