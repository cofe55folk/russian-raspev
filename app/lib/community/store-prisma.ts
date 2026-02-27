import { prisma } from "../db/prisma";
import {
  CommentStatus as PrismaCommentStatus,
  CommunityContentType as PrismaCommunityContentType,
} from "@prisma/client";
import type {
  BookmarkRecord,
  CommentRecord,
  CommunityContentType,
  CommentStatus,
  ListCommentsParams,
  UserModerationRestriction,
} from "./store-file";

function toCommentStatus(value: CommentStatus): "visible" | "hidden" {
  return value === "hidden" ? "hidden" : "visible";
}

function toPrismaContentType(value: CommunityContentType): PrismaCommunityContentType {
  return value as PrismaCommunityContentType;
}

function toPrismaCommentStatus(value: CommentStatus): PrismaCommentStatus {
  return toCommentStatus(value) as PrismaCommentStatus;
}

function toCommentRecord(input: {
  id: string;
  contentType: string;
  contentId: string;
  parentId: string | null;
  userId: string;
  userName: string;
  userEmail: string | null;
  body: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): CommentRecord {
  return {
    id: input.id,
    contentType: input.contentType as CommunityContentType,
    contentId: input.contentId,
    parentId: input.parentId ?? undefined,
    userId: input.userId,
    userName: input.userName,
    userEmail: input.userEmail ?? undefined,
    body: input.body,
    status: input.status === "hidden" ? "hidden" : "visible",
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
  };
}

function toBookmarkRecord(input: {
  id: string;
  userId: string;
  contentType: string;
  contentId: string;
  title: string | null;
  href: string | null;
  createdAt: Date;
}): BookmarkRecord {
  return {
    id: input.id,
    userId: input.userId,
    contentType: input.contentType as CommunityContentType,
    contentId: input.contentId,
    title: input.title ?? undefined,
    href: input.href ?? undefined,
    createdAt: input.createdAt.toISOString(),
  };
}

function toRestrictionRecord(input: {
  userId: string;
  canComment: boolean;
  linksAllowed: boolean;
  commentCooldownSec: number;
  bannedUntil: Date | null;
  updatedAt: Date;
  source: string;
}): UserModerationRestriction {
  return {
    userId: input.userId,
    canComment: input.canComment,
    linksAllowed: input.linksAllowed,
    commentCooldownSec: Math.max(0, Math.min(3600, Math.floor(input.commentCooldownSec || 0))),
    bannedUntil: input.bannedUntil ? input.bannedUntil.toISOString() : null,
    updatedAt: input.updatedAt.toISOString(),
    source: input.source,
  };
}

function parseIsoDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function normalizeCooldown(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(3600, Math.floor(value)));
}

export async function listCommentsByContent(params: ListCommentsParams): Promise<{
  totalVisible: number;
  items: CommentRecord[];
}> {
  const where = {
    contentType: toPrismaContentType(params.contentType),
    contentId: params.contentId,
    status: "visible" as PrismaCommentStatus,
  };
  const [totalVisible, items] = await prisma.$transaction([
    prisma.communityComment.count({ where }),
    prisma.communityComment.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: params.offset,
      take: params.limit,
    }),
  ]);
  return {
    totalVisible,
    items: items.map(toCommentRecord),
  };
}

export async function getCommentById(commentId: string): Promise<CommentRecord | null> {
  const comment = await prisma.communityComment.findUnique({
    where: { id: commentId },
  });
  return comment ? toCommentRecord(comment) : null;
}

export async function createComment(params: {
  contentType: CommunityContentType;
  contentId: string;
  parentId?: string;
  userId: string;
  userName: string;
  userEmail?: string;
  body: string;
}): Promise<CommentRecord> {
  const created = await prisma.communityComment.create({
    data: {
      contentType: toPrismaContentType(params.contentType),
      contentId: params.contentId,
      parentId: params.parentId ?? null,
      userId: params.userId,
      userName: params.userName,
      userEmail: params.userEmail ?? null,
      body: params.body,
      status: "visible",
    },
  });
  return toCommentRecord(created);
}

export async function setCommentVisibility(params: {
  commentId: string;
  status: CommentStatus;
}): Promise<CommentRecord | null> {
  try {
    const updated = await prisma.communityComment.update({
      where: { id: params.commentId },
      data: { status: toPrismaCommentStatus(params.status) },
    });
    return toCommentRecord(updated);
  } catch {
    return null;
  }
}

export async function getUserRestriction(userId: string): Promise<UserModerationRestriction | null> {
  const restriction = await prisma.communityUserRestriction.findUnique({
    where: { userId },
  });
  return restriction ? toRestrictionRecord(restriction) : null;
}

export async function upsertUserRestriction(params: {
  userId: string;
  canComment?: boolean;
  linksAllowed?: boolean;
  commentCooldownSec?: number;
  bannedUntil?: string | null;
  source: string;
}): Promise<UserModerationRestriction> {
  const updated = await prisma.communityUserRestriction.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      canComment: typeof params.canComment === "boolean" ? params.canComment : true,
      linksAllowed: typeof params.linksAllowed === "boolean" ? params.linksAllowed : false,
      commentCooldownSec: normalizeCooldown(params.commentCooldownSec) ?? 15,
      bannedUntil: parseIsoDateOrNull(params.bannedUntil),
      source: params.source,
    },
    update: {
      canComment: typeof params.canComment === "boolean" ? params.canComment : undefined,
      linksAllowed: typeof params.linksAllowed === "boolean" ? params.linksAllowed : undefined,
      commentCooldownSec: normalizeCooldown(params.commentCooldownSec),
      bannedUntil: params.bannedUntil === undefined ? undefined : parseIsoDateOrNull(params.bannedUntil),
      source: params.source,
    },
  });
  return toRestrictionRecord(updated);
}

export async function getUserLastCommentAt(userId: string): Promise<string | null> {
  const comment = await prisma.communityComment.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return comment ? comment.createdAt.toISOString() : null;
}

export async function toggleContentLike(params: {
  userId: string;
  contentType: CommunityContentType;
  contentId: string;
}): Promise<{ liked: boolean; likeCount: number }> {
  const existing = await prisma.communityContentLike.findUnique({
    where: {
      userId_contentType_contentId: {
        userId: params.userId,
        contentType: toPrismaContentType(params.contentType),
        contentId: params.contentId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.communityContentLike.delete({ where: { id: existing.id } });
    const likeCount = await prisma.communityContentLike.count({
      where: {
        contentType: toPrismaContentType(params.contentType),
        contentId: params.contentId,
      },
    });
    return { liked: false, likeCount };
  }

  await prisma.communityContentLike.create({
    data: {
      userId: params.userId,
      contentType: toPrismaContentType(params.contentType),
      contentId: params.contentId,
    },
  });
  const likeCount = await prisma.communityContentLike.count({
    where: {
      contentType: toPrismaContentType(params.contentType),
      contentId: params.contentId,
    },
  });
  return { liked: true, likeCount };
}

export async function toggleBookmark(params: {
  userId: string;
  contentType: CommunityContentType;
  contentId: string;
  title?: string;
  href?: string;
}): Promise<{ bookmarked: boolean }> {
  const existing = await prisma.communityBookmark.findUnique({
    where: {
      userId_contentType_contentId: {
        userId: params.userId,
        contentType: toPrismaContentType(params.contentType),
        contentId: params.contentId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.communityBookmark.delete({ where: { id: existing.id } });
    return { bookmarked: false };
  }

  await prisma.communityBookmark.create({
    data: {
      userId: params.userId,
      contentType: toPrismaContentType(params.contentType),
      contentId: params.contentId,
      title: params.title ?? null,
      href: params.href ?? null,
    },
  });
  return { bookmarked: true };
}

export async function getContentReactionsSummary(params: {
  userId?: string;
  contentType: CommunityContentType;
  contentId: string;
}): Promise<{ likeCount: number; liked: boolean; bookmarked: boolean }> {
  const likeCount = await prisma.communityContentLike.count({
    where: {
      contentType: toPrismaContentType(params.contentType),
      contentId: params.contentId,
    },
  });

  if (!params.userId) {
    return { likeCount, liked: false, bookmarked: false };
  }

  const [likedRecord, bookmarkedRecord] = await Promise.all([
    prisma.communityContentLike.findUnique({
      where: {
        userId_contentType_contentId: {
          userId: params.userId,
          contentType: toPrismaContentType(params.contentType),
          contentId: params.contentId,
        },
      },
      select: { id: true },
    }),
    prisma.communityBookmark.findUnique({
      where: {
        userId_contentType_contentId: {
          userId: params.userId,
          contentType: toPrismaContentType(params.contentType),
          contentId: params.contentId,
        },
      },
      select: { id: true },
    }),
  ]);

  return { likeCount, liked: !!likedRecord, bookmarked: !!bookmarkedRecord };
}

export async function listBookmarksByUser(userId: string): Promise<BookmarkRecord[]> {
  const bookmarks = await prisma.communityBookmark.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return bookmarks.map(toBookmarkRecord);
}
