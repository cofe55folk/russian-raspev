import type {
  BookmarkRecord,
  CommentRecord,
  CommunityContentType,
  CommentStatus,
  ListCommentsParams,
  UserModerationRestriction,
} from "./store-file";

export type {
  BookmarkRecord,
  CommentRecord,
  CommunityContentType,
  CommentStatus,
  ListCommentsParams,
  UserModerationRestriction,
} from "./store-file";

type StoreModule = {
  listCommentsByContent(params: ListCommentsParams): Promise<{
    totalVisible: number;
    items: CommentRecord[];
  }>;
  getCommentById(commentId: string): Promise<CommentRecord | null>;
  createComment(params: {
    contentType: CommunityContentType;
    contentId: string;
    parentId?: string;
    userId: string;
    userName: string;
    userEmail?: string;
    body: string;
  }): Promise<CommentRecord>;
  setCommentVisibility(params: {
    commentId: string;
    status: CommentStatus;
  }): Promise<CommentRecord | null>;
  getUserRestriction(userId: string): Promise<UserModerationRestriction | null>;
  upsertUserRestriction(params: {
    userId: string;
    canComment?: boolean;
    linksAllowed?: boolean;
    commentCooldownSec?: number;
    bannedUntil?: string | null;
    source: string;
  }): Promise<UserModerationRestriction>;
  getUserLastCommentAt(userId: string): Promise<string | null>;
  toggleContentLike(params: {
    userId: string;
    contentType: CommunityContentType;
    contentId: string;
  }): Promise<{ liked: boolean; likeCount: number }>;
  toggleBookmark(params: {
    userId: string;
    contentType: CommunityContentType;
    contentId: string;
    title?: string;
    href?: string;
  }): Promise<{ bookmarked: boolean }>;
  getContentReactionsSummary(params: {
    userId?: string;
    contentType: CommunityContentType;
    contentId: string;
  }): Promise<{ likeCount: number; liked: boolean; bookmarked: boolean }>;
  listBookmarksByUser(userId: string): Promise<BookmarkRecord[]>;
};

type StoreMode = "file" | "prisma";

const preferPrisma = process.env.RR_COMMUNITY_STORE === "prisma" && !!process.env.DATABASE_URL;
let backendPromise: Promise<StoreModule> | null = null;

function getDesiredStoreMode(): StoreMode {
  return preferPrisma ? "prisma" : "file";
}

async function loadBackend(): Promise<StoreModule> {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    if (getDesiredStoreMode() === "prisma") {
      try {
        return (await import("./store-prisma")) as StoreModule;
      } catch (error) {
        console.warn("[community-store] Prisma backend unavailable, fallback to file backend.", error);
      }
    }
    return (await import("./store-file")) as StoreModule;
  })();
  return backendPromise;
}

async function callStore<K extends keyof StoreModule>(
  method: K,
  ...args: Parameters<StoreModule[K]>
): Promise<Awaited<ReturnType<StoreModule[K]>>> {
  const backend = await loadBackend();
  const fn = backend[method] as (...methodArgs: Parameters<StoreModule[K]>) => ReturnType<StoreModule[K]>;
  return await fn(...args);
}

export function getCommunityStoreMode(): StoreMode {
  return getDesiredStoreMode();
}

export async function listCommentsByContent(params: ListCommentsParams): Promise<{
  totalVisible: number;
  items: CommentRecord[];
}> {
  return callStore("listCommentsByContent", params);
}

export async function getCommentById(commentId: string): Promise<CommentRecord | null> {
  return callStore("getCommentById", commentId);
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
  return callStore("createComment", params);
}

export async function setCommentVisibility(params: {
  commentId: string;
  status: CommentStatus;
}): Promise<CommentRecord | null> {
  return callStore("setCommentVisibility", params);
}

export async function getUserRestriction(userId: string): Promise<UserModerationRestriction | null> {
  return callStore("getUserRestriction", userId);
}

export async function upsertUserRestriction(params: {
  userId: string;
  canComment?: boolean;
  linksAllowed?: boolean;
  commentCooldownSec?: number;
  bannedUntil?: string | null;
  source: string;
}): Promise<UserModerationRestriction> {
  return callStore("upsertUserRestriction", params);
}

export async function getUserLastCommentAt(userId: string): Promise<string | null> {
  return callStore("getUserLastCommentAt", userId);
}

export async function toggleContentLike(params: {
  userId: string;
  contentType: CommunityContentType;
  contentId: string;
}): Promise<{ liked: boolean; likeCount: number }> {
  return callStore("toggleContentLike", params);
}

export async function toggleBookmark(params: {
  userId: string;
  contentType: CommunityContentType;
  contentId: string;
  title?: string;
  href?: string;
}): Promise<{ bookmarked: boolean }> {
  return callStore("toggleBookmark", params);
}

export async function getContentReactionsSummary(params: {
  userId?: string;
  contentType: CommunityContentType;
  contentId: string;
}): Promise<{ likeCount: number; liked: boolean; bookmarked: boolean }> {
  return callStore("getContentReactionsSummary", params);
}

export async function listBookmarksByUser(userId: string): Promise<BookmarkRecord[]> {
  return callStore("listBookmarksByUser", userId);
}
