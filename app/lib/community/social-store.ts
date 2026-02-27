import type {
  CommunityConversationPage,
  CommunityInboxItem,
  CommunityPublicationRecord,
  CommunityPublicationType,
  CreateConversationResult,
} from "./social-store-file";

export type {
  CommunityConversationPage,
  CommunityInboxItem,
  CommunityPublicationRecord,
  CommunityPublicationType,
  CreateConversationResult,
} from "./social-store-file";
export {
  SocialConversationAccessError,
  SocialConversationBlockedError,
  SocialConversationNotFoundError,
  SocialConversationValidationError,
} from "./social-store-file";

type StoreModule = {
  listCommunityInbox(params: {
    userId: string;
    limit: number;
    cursor?: string;
  }): Promise<{ items: CommunityInboxItem[]; nextCursor: string | null; total: number }>;
  createCommunityConversation(params: {
    initiatorUserId: string;
    type: "dm" | "project";
    title?: string;
    targetUserId?: string;
    projectId?: string;
  }): Promise<CreateConversationResult>;
  getCommunityConversationForUser(params: {
    conversationId: string;
    userId: string;
    limit: number;
    cursor?: string;
  }): Promise<CommunityConversationPage>;
  createCommunityMessage(params: {
    conversationId: string;
    senderUserId: string;
    body: string;
  }): Promise<{
    message: { id: string; conversationId: string; senderUserId: string; body: string; createdAt: string };
    conversation: { id: string; type: "dm" | "project"; title?: string; projectId?: string };
  }>;
  markCommunityConversationRead(params: {
    conversationId: string;
    userId: string;
  }): Promise<{ conversationId: string; lastReadAt: string }>;
  listCommunityProfileFeedByHandle(params: {
    handle: string;
    limit: number;
    cursor?: string;
    viewerUserId?: string;
    type?: CommunityPublicationType;
  }): Promise<{ foundHandle: boolean; items: CommunityPublicationRecord[]; nextCursor: string | null; total: number }>;
  listCommunityGlobalFeed(params: {
    sort: "fresh" | "best";
    limit: number;
    cursor?: string;
    type?: CommunityPublicationType;
    region?: string;
  }): Promise<{ items: CommunityPublicationRecord[]; nextCursor: string | null; total: number }>;
};

let backendPromise: Promise<StoreModule> | null = null;

async function loadBackend(): Promise<StoreModule> {
  if (backendPromise) return backendPromise;
  backendPromise = import("./social-store-file") as Promise<StoreModule>;
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

export async function listCommunityInbox(params: {
  userId: string;
  limit: number;
  cursor?: string;
}): Promise<{ items: CommunityInboxItem[]; nextCursor: string | null; total: number }> {
  return callStore("listCommunityInbox", params);
}

export async function createCommunityConversation(params: {
  initiatorUserId: string;
  type: "dm" | "project";
  title?: string;
  targetUserId?: string;
  projectId?: string;
}): Promise<CreateConversationResult> {
  return callStore("createCommunityConversation", params);
}

export async function getCommunityConversationForUser(params: {
  conversationId: string;
  userId: string;
  limit: number;
  cursor?: string;
}): Promise<CommunityConversationPage> {
  return callStore("getCommunityConversationForUser", params);
}

export async function createCommunityMessage(params: {
  conversationId: string;
  senderUserId: string;
  body: string;
}): Promise<{
  message: { id: string; conversationId: string; senderUserId: string; body: string; createdAt: string };
  conversation: { id: string; type: "dm" | "project"; title?: string; projectId?: string };
}> {
  return callStore("createCommunityMessage", params);
}

export async function markCommunityConversationRead(params: {
  conversationId: string;
  userId: string;
}): Promise<{ conversationId: string; lastReadAt: string }> {
  return callStore("markCommunityConversationRead", params);
}

export async function listCommunityProfileFeedByHandle(params: {
  handle: string;
  limit: number;
  cursor?: string;
  viewerUserId?: string;
  type?: CommunityPublicationType;
}): Promise<{ foundHandle: boolean; items: CommunityPublicationRecord[]; nextCursor: string | null; total: number }> {
  return callStore("listCommunityProfileFeedByHandle", params);
}

export async function listCommunityGlobalFeed(params: {
  sort: "fresh" | "best";
  limit: number;
  cursor?: string;
  type?: CommunityPublicationType;
  region?: string;
}): Promise<{ items: CommunityPublicationRecord[]; nextCursor: string | null; total: number }> {
  return callStore("listCommunityGlobalFeed", params);
}
