import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const COMMUNITY_DB_PATH = path.join(process.cwd(), "data", "community", "community-db.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type CommunityContentType = "article" | "video" | "sound" | "education";
export type CommentStatus = "visible" | "hidden";

export type CommentRecord = {
  id: string;
  contentType: CommunityContentType;
  contentId: string;
  parentId?: string;
  userId: string;
  userName: string;
  userEmail?: string;
  body: string;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
};

export type ContentLikeRecord = {
  id: string;
  userId: string;
  contentType: CommunityContentType;
  contentId: string;
  createdAt: string;
};

export type BookmarkRecord = {
  id: string;
  userId: string;
  contentType: CommunityContentType;
  contentId: string;
  title?: string;
  href?: string;
  createdAt: string;
};

export type UserModerationRestriction = {
  userId: string;
  canComment: boolean;
  linksAllowed: boolean;
  commentCooldownSec: number;
  bannedUntil?: string | null;
  updatedAt: string;
  source: string;
};

type UserPostMeta = {
  userId: string;
  lastCommentAt?: string;
};

type CommunityDb = {
  comments: CommentRecord[];
  likes: ContentLikeRecord[];
  bookmarks: BookmarkRecord[];
  userRestrictions: UserModerationRestriction[];
  userPostMeta: UserPostMeta[];
};

const EMPTY_DB: CommunityDb = {
  comments: [],
  likes: [],
  bookmarks: [],
  userRestrictions: [],
  userPostMeta: [],
};

async function ensureDir() {
  await fs.mkdir(path.dirname(COMMUNITY_DB_PATH), { recursive: true });
}

function normalizeDb(input: unknown): CommunityDb {
  if (!input || typeof input !== "object") return EMPTY_DB;
  const raw = input as Partial<CommunityDb>;
  return {
    comments: Array.isArray(raw.comments) ? (raw.comments.filter(Boolean) as CommentRecord[]) : [],
    likes: Array.isArray(raw.likes) ? (raw.likes.filter(Boolean) as ContentLikeRecord[]) : [],
    bookmarks: Array.isArray(raw.bookmarks) ? (raw.bookmarks.filter(Boolean) as BookmarkRecord[]) : [],
    userRestrictions: Array.isArray(raw.userRestrictions)
      ? (raw.userRestrictions.filter(Boolean) as UserModerationRestriction[])
      : [],
    userPostMeta: Array.isArray(raw.userPostMeta) ? (raw.userPostMeta.filter(Boolean) as UserPostMeta[]) : [],
  };
}

async function readDb(): Promise<CommunityDb> {
  try {
    const raw = await fs.readFile(COMMUNITY_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, comments: [], likes: [], bookmarks: [], userRestrictions: [], userPostMeta: [] };
  }
}

async function writeDb(db: CommunityDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${COMMUNITY_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, COMMUNITY_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: CommunityDb) => Promise<T> | T): Promise<T> {
  const previous = mutationQueue;
  let unlock: () => void = () => {};
  mutationQueue = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  try {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  } finally {
    unlock();
  }
}

export type ListCommentsParams = {
  contentType: CommunityContentType;
  contentId: string;
  offset: number;
  limit: number;
};

export async function listCommentsByContent(params: ListCommentsParams): Promise<{
  totalVisible: number;
  items: CommentRecord[];
}> {
  const db = await readDb();
  const visible = db.comments
    .filter(
      (item) =>
        item.contentType === params.contentType &&
        item.contentId === params.contentId &&
        item.status === "visible"
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const items = visible.slice(params.offset, params.offset + params.limit);
  return {
    totalVisible: visible.length,
    items,
  };
}

export async function getCommentById(commentId: string): Promise<CommentRecord | null> {
  const db = await readDb();
  return db.comments.find((item) => item.id === commentId) ?? null;
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
  return withDbMutation(async (db) => {
    const now = new Date().toISOString();
    const created: CommentRecord = {
      id: randomUUID(),
      contentType: params.contentType,
      contentId: params.contentId,
      parentId: params.parentId,
      userId: params.userId,
      userName: params.userName,
      userEmail: params.userEmail,
      body: params.body,
      status: "visible",
      createdAt: now,
      updatedAt: now,
    };
    db.comments.push(created);

    const postMetaIdx = db.userPostMeta.findIndex((item) => item.userId === params.userId);
    if (postMetaIdx >= 0) {
      db.userPostMeta[postMetaIdx] = { ...db.userPostMeta[postMetaIdx], lastCommentAt: now };
    } else {
      db.userPostMeta.push({ userId: params.userId, lastCommentAt: now });
    }

    return created;
  });
}

export async function setCommentVisibility(params: {
  commentId: string;
  status: CommentStatus;
}): Promise<CommentRecord | null> {
  return withDbMutation(async (db) => {
    const idx = db.comments.findIndex((item) => item.id === params.commentId);
    if (idx < 0) return null;
    const updated: CommentRecord = {
      ...db.comments[idx],
      status: params.status,
      updatedAt: new Date().toISOString(),
    };
    db.comments[idx] = updated;
    return updated;
  });
}

export async function getUserRestriction(userId: string): Promise<UserModerationRestriction | null> {
  const db = await readDb();
  return db.userRestrictions.find((item) => item.userId === userId) ?? null;
}

export async function upsertUserRestriction(params: {
  userId: string;
  canComment?: boolean;
  linksAllowed?: boolean;
  commentCooldownSec?: number;
  bannedUntil?: string | null;
  source: string;
}): Promise<UserModerationRestriction> {
  return withDbMutation(async (db) => {
    const idx = db.userRestrictions.findIndex((item) => item.userId === params.userId);
    const now = new Date().toISOString();
    if (idx >= 0) {
      const current = db.userRestrictions[idx];
      const updated: UserModerationRestriction = {
        ...current,
        canComment: typeof params.canComment === "boolean" ? params.canComment : current.canComment,
        linksAllowed: typeof params.linksAllowed === "boolean" ? params.linksAllowed : current.linksAllowed,
        commentCooldownSec:
          typeof params.commentCooldownSec === "number"
            ? Math.max(0, Math.min(3600, Math.floor(params.commentCooldownSec)))
            : current.commentCooldownSec,
        bannedUntil: params.bannedUntil === undefined ? current.bannedUntil : params.bannedUntil,
        source: params.source || current.source,
        updatedAt: now,
      };
      db.userRestrictions[idx] = updated;
      return updated;
    }

    const created: UserModerationRestriction = {
      userId: params.userId,
      canComment: typeof params.canComment === "boolean" ? params.canComment : true,
      linksAllowed: typeof params.linksAllowed === "boolean" ? params.linksAllowed : false,
      commentCooldownSec:
        typeof params.commentCooldownSec === "number"
          ? Math.max(0, Math.min(3600, Math.floor(params.commentCooldownSec)))
          : 15,
      bannedUntil: params.bannedUntil ?? null,
      source: params.source,
      updatedAt: now,
    };
    db.userRestrictions.push(created);
    return created;
  });
}

export async function getUserLastCommentAt(userId: string): Promise<string | null> {
  const db = await readDb();
  return db.userPostMeta.find((item) => item.userId === userId)?.lastCommentAt ?? null;
}

export async function toggleContentLike(params: {
  userId: string;
  contentType: CommunityContentType;
  contentId: string;
}): Promise<{ liked: boolean; likeCount: number }> {
  return withDbMutation(async (db) => {
    const idx = db.likes.findIndex(
      (item) =>
        item.userId === params.userId &&
        item.contentType === params.contentType &&
        item.contentId === params.contentId
    );
    if (idx >= 0) {
      db.likes.splice(idx, 1);
    } else {
      db.likes.push({
        id: randomUUID(),
        userId: params.userId,
        contentType: params.contentType,
        contentId: params.contentId,
        createdAt: new Date().toISOString(),
      });
    }
    const likeCount = db.likes.filter(
      (item) => item.contentType === params.contentType && item.contentId === params.contentId
    ).length;
    return {
      liked: idx < 0,
      likeCount,
    };
  });
}

export async function toggleBookmark(params: {
  userId: string;
  contentType: CommunityContentType;
  contentId: string;
  title?: string;
  href?: string;
}): Promise<{ bookmarked: boolean }> {
  return withDbMutation(async (db) => {
    const idx = db.bookmarks.findIndex(
      (item) =>
        item.userId === params.userId &&
        item.contentType === params.contentType &&
        item.contentId === params.contentId
    );
    if (idx >= 0) {
      db.bookmarks.splice(idx, 1);
      return { bookmarked: false };
    }
    db.bookmarks.push({
      id: randomUUID(),
      userId: params.userId,
      contentType: params.contentType,
      contentId: params.contentId,
      title: params.title,
      href: params.href,
      createdAt: new Date().toISOString(),
    });
    return { bookmarked: true };
  });
}

export async function getContentReactionsSummary(params: {
  userId?: string;
  contentType: CommunityContentType;
  contentId: string;
}): Promise<{ likeCount: number; liked: boolean; bookmarked: boolean }> {
  const db = await readDb();
  const likeCount = db.likes.filter(
    (item) => item.contentType === params.contentType && item.contentId === params.contentId
  ).length;
  const liked = params.userId
    ? db.likes.some(
        (item) =>
          item.userId === params.userId &&
          item.contentType === params.contentType &&
          item.contentId === params.contentId
      )
    : false;
  const bookmarked = params.userId
    ? db.bookmarks.some(
        (item) =>
          item.userId === params.userId &&
          item.contentType === params.contentType &&
          item.contentId === params.contentId
      )
    : false;
  return { likeCount, liked, bookmarked };
}

export async function listBookmarksByUser(userId: string): Promise<BookmarkRecord[]> {
  const db = await readDb();
  return db.bookmarks
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
