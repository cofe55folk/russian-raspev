import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { isCommunityUserPairBlocked } from "./match-store";
import { getCommunityProjectById, listCommunityProjects } from "./project-store";

const COMMUNITY_SOCIAL_DB_PATH = path.join(process.cwd(), "data", "community", "social-db.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type CommunityConversationType = "dm" | "project";
export type CommunityPublicationType = "multitrack" | "room" | "article" | "podcast" | "photo";
export type CommunityPublicationVisibility = "public" | "followers" | "private";

export class SocialConversationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialConversationValidationError";
  }
}

export class SocialConversationAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialConversationAccessError";
  }
}

export class SocialConversationNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialConversationNotFoundError";
  }
}

export class SocialConversationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialConversationBlockedError";
  }
}

export type CommunityConversationMember = {
  userId: string;
  role?: "owner" | "editor" | "viewer" | "member";
  lastReadAt?: string;
  muted?: boolean;
};

export type CommunityConversationRecord = {
  id: string;
  type: CommunityConversationType;
  title?: string;
  projectId?: string;
  members: CommunityConversationMember[];
  lastMessageAt?: string;
  lastMessagePreview?: string;
};

export type CommunityMessageRecord = {
  id: string;
  conversationId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
};

export type CommunityPublicationRecord = {
  id: string;
  authorUserId: string;
  authorHandle: string;
  authorName: string;
  type: CommunityPublicationType;
  title: string;
  href: string;
  createdAt: string;
  rankScore: number;
  visibility: CommunityPublicationVisibility;
  region?: string;
  tags?: string[];
};

type CommunitySocialDb = {
  conversations: CommunityConversationRecord[];
  messages: CommunityMessageRecord[];
  publications: CommunityPublicationRecord[];
};

export type CommunityInboxItem = {
  conversationId: string;
  type: CommunityConversationType;
  title: string;
  projectId?: string;
  participantCount: number;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  muted: boolean;
};

export type CommunityConversationPage = {
  conversation: CommunityConversationRecord;
  items: CommunityMessageRecord[];
  nextCursor: string | null;
  total: number;
};

export type CreateConversationResult = {
  conversation: CommunityConversationRecord;
  idempotent: boolean;
};

type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

const EMPTY_DB: CommunitySocialDb = {
  conversations: [],
  messages: [],
  publications: [],
};

function normalizeIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeUserId(value: unknown): string | null {
  return normalizeText(value, 2, 120);
}

function normalizePublicationType(value: unknown): CommunityPublicationType | null {
  if (value === "multitrack" || value === "room" || value === "article" || value === "podcast" || value === "photo") {
    return value;
  }
  return null;
}

function normalizeConversationType(value: unknown): CommunityConversationType | null {
  if (value === "dm" || value === "project") return value;
  return null;
}

function normalizeVisibility(value: unknown): CommunityPublicationVisibility {
  if (value === "followers") return "followers";
  if (value === "private") return "private";
  return "public";
}

function normalizeConversationMember(input: unknown): CommunityConversationMember | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<CommunityConversationMember>;
  const userId = normalizeUserId(raw.userId);
  if (!userId) return null;
  const role =
    raw.role === "owner" || raw.role === "editor" || raw.role === "viewer" || raw.role === "member"
      ? raw.role
      : undefined;
  const lastReadAt = normalizeIsoOrNull(raw.lastReadAt ?? null) ?? undefined;
  const muted = typeof raw.muted === "boolean" ? raw.muted : undefined;
  return { userId, role, lastReadAt, muted };
}

function normalizeConversation(input: unknown): CommunityConversationRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<CommunityConversationRecord>;
  const id = normalizeText(raw.id, 2, 160);
  const type = normalizeConversationType(raw.type);
  if (!id || !type) return null;
  const members = Array.isArray(raw.members)
    ? raw.members.map(normalizeConversationMember).filter((item): item is CommunityConversationMember => !!item)
    : [];
  if (!members.length) return null;
  return {
    id,
    type,
    title: normalizeText(raw.title, 1, 180) ?? undefined,
    projectId: normalizeText(raw.projectId, 2, 160) ?? undefined,
    members,
    lastMessageAt: normalizeIsoOrNull(raw.lastMessageAt ?? null) ?? undefined,
    lastMessagePreview: normalizeText(raw.lastMessagePreview, 1, 1000) ?? undefined,
  };
}

function normalizeMessage(input: unknown): CommunityMessageRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<CommunityMessageRecord>;
  const id = normalizeText(raw.id, 2, 160);
  const conversationId = normalizeText(raw.conversationId, 2, 160);
  const senderUserId = normalizeText(raw.senderUserId, 2, 120);
  const body = normalizeText(raw.body, 1, 4000);
  const createdAt = normalizeIsoOrNull(raw.createdAt);
  if (!id || !conversationId || !senderUserId || !body || !createdAt) return null;
  return { id, conversationId, senderUserId, body, createdAt };
}

function normalizePublication(input: unknown): CommunityPublicationRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<CommunityPublicationRecord>;
  const id = normalizeText(raw.id, 2, 160);
  const authorUserId = normalizeText(raw.authorUserId, 2, 120);
  const authorName = normalizeText(raw.authorName, 1, 180);
  const authorHandle = normalizeText(raw.authorHandle, 2, 60)?.toLowerCase();
  const type = normalizePublicationType(raw.type);
  const title = normalizeText(raw.title, 1, 300);
  const href = normalizeText(raw.href, 1, 1000);
  const createdAt = normalizeIsoOrNull(raw.createdAt);
  const rankScore = Number(raw.rankScore ?? 0);
  if (!id || !authorUserId || !authorName || !authorHandle || !type || !title || !href || !createdAt) return null;
  return {
    id,
    authorUserId,
    authorHandle,
    authorName,
    type,
    title,
    href,
    createdAt,
    rankScore: Number.isFinite(rankScore) ? Math.max(0, Math.floor(rankScore)) : 0,
    visibility: normalizeVisibility(raw.visibility),
    region: normalizeText(raw.region, 2, 120)?.toLowerCase(),
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((item) => normalizeText(item, 1, 80)?.toLowerCase()).filter((item): item is string => !!item)
      : undefined,
  };
}

function normalizeDb(input: unknown): CommunitySocialDb {
  if (!input || typeof input !== "object") {
    return { ...EMPTY_DB, conversations: [], messages: [], publications: [] };
  }
  const raw = input as Partial<CommunitySocialDb>;
  return {
    conversations: Array.isArray(raw.conversations)
      ? raw.conversations.map(normalizeConversation).filter((item): item is CommunityConversationRecord => !!item)
      : [],
    messages: Array.isArray(raw.messages)
      ? raw.messages.map(normalizeMessage).filter((item): item is CommunityMessageRecord => !!item)
      : [],
    publications: Array.isArray(raw.publications)
      ? raw.publications.map(normalizePublication).filter((item): item is CommunityPublicationRecord => !!item)
      : [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(COMMUNITY_SOCIAL_DB_PATH), { recursive: true });
}

async function readDb(): Promise<CommunitySocialDb> {
  try {
    const raw = await fs.readFile(COMMUNITY_SOCIAL_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, conversations: [], messages: [], publications: [] };
  }
}

async function writeDb(db: CommunitySocialDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${COMMUNITY_SOCIAL_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, COMMUNITY_SOCIAL_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: CommunitySocialDb) => Promise<T> | T): Promise<T> {
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

function sortByDateDesc<T extends { createdAt: string; id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const delta = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (delta !== 0) return delta;
    return right.id.localeCompare(left.id);
  });
}

function sortFeedForBest(items: CommunityPublicationRecord[]): CommunityPublicationRecord[] {
  return [...items].sort((left, right) => {
    const scoreDelta = right.rankScore - left.rankScore;
    if (scoreDelta !== 0) return scoreDelta;
    const dateDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (dateDelta !== 0) return dateDelta;
    return right.id.localeCompare(left.id);
  });
}

function paginateByCursor<T>(
  items: T[],
  limit: number,
  cursor: string | undefined,
  cursorForItem: (item: T) => string
): CursorPage<T> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit || 20)));
  let start = 0;
  if (cursor) {
    const idx = items.findIndex((item) => cursorForItem(item) === cursor);
    if (idx >= 0) start = idx + 1;
  }
  const page = items.slice(start, start + safeLimit);
  const nextCursor = start + safeLimit < items.length && page.length ? cursorForItem(page[page.length - 1]) : null;
  return { items: page, nextCursor };
}

function parseProjectConversationId(conversationId: string): string | null {
  if (!conversationId.startsWith("project:")) return null;
  const projectId = conversationId.slice("project:".length).trim();
  return projectId || null;
}

function canonicalDmConversationId(userAId: string, userBId: string): string {
  const sorted = [userAId, userBId].sort((left, right) => left.localeCompare(right));
  return `dm:${sorted[0]}:${sorted[1]}`;
}

function buildProjectConversationFromRecord(project: {
  id: string;
  name: string;
  members: Array<{ userId: string; role: "owner" | "editor" | "viewer" }>;
  createdAt: string;
  updatedAt: string;
}): CommunityConversationRecord {
  return {
    id: `project:${project.id}`,
    type: "project",
    projectId: project.id,
    title: project.name,
    members: project.members.map((member) => ({
      userId: member.userId,
      role: member.role,
    })),
    lastMessageAt: project.updatedAt || project.createdAt,
    lastMessagePreview: "Проектный чат запущен",
  };
}

function upsertConversationRecord(db: CommunitySocialDb, nextConversation: CommunityConversationRecord): CommunityConversationRecord {
  const idx = db.conversations.findIndex((item) => item.id === nextConversation.id);
  if (idx >= 0) {
    db.conversations[idx] = {
      ...db.conversations[idx],
      ...nextConversation,
      members: nextConversation.members,
    };
    return db.conversations[idx];
  }
  db.conversations.push(nextConversation);
  return nextConversation;
}

function setMemberLastRead(conversation: CommunityConversationRecord, userId: string, iso: string): CommunityConversationRecord {
  const members = [...conversation.members];
  const idx = members.findIndex((item) => item.userId === userId);
  if (idx >= 0) {
    members[idx] = { ...members[idx], lastReadAt: iso };
  } else {
    members.push({ userId, role: "member", lastReadAt: iso });
  }
  return { ...conversation, members };
}

function getLastMessageTimestamp(conversation: CommunityConversationRecord, messages: CommunityMessageRecord[]): string {
  const latestMessage = messages
    .filter((item) => item.conversationId === conversation.id)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  const fromConversation = normalizeIsoOrNull(conversation.lastMessageAt) ?? null;
  if (latestMessage?.createdAt && fromConversation) {
    return Date.parse(latestMessage.createdAt) > Date.parse(fromConversation) ? latestMessage.createdAt : fromConversation;
  }
  return latestMessage?.createdAt || fromConversation || new Date(0).toISOString();
}

function getLastMessagePreview(conversation: CommunityConversationRecord, messages: CommunityMessageRecord[]): string {
  const latestMessage = messages
    .filter((item) => item.conversationId === conversation.id)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  if (latestMessage?.body) return latestMessage.body.slice(0, 280);
  if (conversation.lastMessagePreview) return conversation.lastMessagePreview.slice(0, 280);
  if (conversation.type === "project") return "Проектный чат запущен";
  return "Новый диалог";
}

async function resolveConversationById(db: CommunitySocialDb, conversationId: string): Promise<CommunityConversationRecord | null> {
  const explicit = db.conversations.find((item) => item.id === conversationId);
  if (explicit) return explicit;
  const projectId = parseProjectConversationId(conversationId);
  if (!projectId) return null;
  const project = await getCommunityProjectById(projectId);
  if (!project) return null;
  return buildProjectConversationFromRecord(project);
}

async function buildEffectiveConversations(
  userId: string,
  db: CommunitySocialDb
): Promise<CommunityConversationRecord[]> {
  const explicit = db.conversations.filter((item) => item.members.some((member) => member.userId === userId));
  const byId = new Map(explicit.map((item) => [item.id, item]));

  const projects = await listCommunityProjects({
    offset: 0,
    limit: 500,
    memberUserId: userId,
  });

  for (const project of projects.items) {
    const id = `project:${project.id}`;
    if (byId.has(id)) continue;
    byId.set(id, buildProjectConversationFromRecord(project));
  }

  return Array.from(byId.values());
}

export async function listCommunityInbox(params: {
  userId: string;
  limit: number;
  cursor?: string;
}): Promise<{ items: CommunityInboxItem[]; nextCursor: string | null; total: number }> {
  const db = await readDb();
  const conversations = await buildEffectiveConversations(params.userId, db);
  const items: CommunityInboxItem[] = conversations.map((conversation) => {
    const member = conversation.members.find((item) => item.userId === params.userId);
    const lastReadAt = member?.lastReadAt ? Date.parse(member.lastReadAt) : Number.NEGATIVE_INFINITY;
    const unreadCount = db.messages.filter((msg) => {
      if (msg.conversationId !== conversation.id) return false;
      if (msg.senderUserId === params.userId) return false;
      return Date.parse(msg.createdAt) > lastReadAt;
    }).length;

    return {
      conversationId: conversation.id,
      type: conversation.type,
      title: conversation.title || (conversation.type === "project" ? "Проектный чат" : "Личный диалог"),
      projectId: conversation.projectId,
      participantCount: conversation.members.length,
      unreadCount,
      lastMessageAt: getLastMessageTimestamp(conversation, db.messages),
      lastMessagePreview: getLastMessagePreview(conversation, db.messages),
      muted: !!member?.muted,
    };
  });

  items.sort((left, right) => {
    const delta = Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt);
    if (delta !== 0) return delta;
    return right.conversationId.localeCompare(left.conversationId);
  });

  const page = paginateByCursor(items, params.limit, params.cursor, (item) => item.conversationId);
  return {
    total: items.length,
    items: page.items,
    nextCursor: page.nextCursor,
  };
}

export async function createCommunityConversation(params: {
  initiatorUserId: string;
  type: CommunityConversationType;
  title?: string;
  targetUserId?: string;
  projectId?: string;
}): Promise<CreateConversationResult> {
  const initiatorUserId = normalizeUserId(params.initiatorUserId);
  if (!initiatorUserId) throw new SocialConversationValidationError("invalid_initiator");

  if (params.type === "dm") {
    const targetUserId = normalizeUserId(params.targetUserId);
    if (!targetUserId) throw new SocialConversationValidationError("invalid_target_user");
    if (targetUserId === initiatorUserId) throw new SocialConversationValidationError("self_dm_not_allowed");
    const blocked = await isCommunityUserPairBlocked({ userAId: initiatorUserId, userBId: targetUserId });
    if (blocked) throw new SocialConversationBlockedError("dm_blocked_pair");

    return withDbMutation(async (db) => {
      const conversationId = canonicalDmConversationId(initiatorUserId, targetUserId);
      const existing = db.conversations.find((item) => item.id === conversationId);
      if (existing) {
        const patched = upsertConversationRecord(db, {
          ...existing,
          title: existing.title || params.title || "Личный диалог",
          members: [
            { userId: initiatorUserId, role: "member" },
            { userId: targetUserId, role: "member" },
          ],
        });
        return { conversation: patched, idempotent: true };
      }

      const created: CommunityConversationRecord = {
        id: conversationId,
        type: "dm",
        title: normalizeText(params.title, 1, 180) ?? "Личный диалог",
        members: [
          { userId: initiatorUserId, role: "member" },
          { userId: targetUserId, role: "member" },
        ],
      };
      upsertConversationRecord(db, created);
      return { conversation: created, idempotent: false };
    });
  }

  const projectId = normalizeText(params.projectId, 2, 160);
  if (!projectId) throw new SocialConversationValidationError("invalid_project_id");
  const project = await getCommunityProjectById(projectId);
  if (!project) throw new SocialConversationNotFoundError("project_not_found");
  if (!project.members.some((member) => member.userId === initiatorUserId)) {
    throw new SocialConversationAccessError("project_membership_required");
  }

  return withDbMutation(async (db) => {
    const conversationId = `project:${project.id}`;
    const existing = db.conversations.find((item) => item.id === conversationId);
    const nextConversation: CommunityConversationRecord = {
      ...(existing || buildProjectConversationFromRecord(project)),
      id: conversationId,
      type: "project",
      projectId: project.id,
      title: normalizeText(params.title, 1, 180) ?? project.name,
      members: project.members.map((member) => ({
        userId: member.userId,
        role: member.role,
        lastReadAt: existing?.members.find((item) => item.userId === member.userId)?.lastReadAt,
        muted: existing?.members.find((item) => item.userId === member.userId)?.muted,
      })),
      lastMessageAt: existing?.lastMessageAt || project.updatedAt || project.createdAt,
      lastMessagePreview: existing?.lastMessagePreview || "Проектный чат запущен",
    };
    upsertConversationRecord(db, nextConversation);
    return { conversation: nextConversation, idempotent: !!existing };
  });
}

export async function getCommunityConversationForUser(params: {
  conversationId: string;
  userId: string;
  limit: number;
  cursor?: string;
}): Promise<CommunityConversationPage> {
  const conversationId = normalizeText(params.conversationId, 2, 160);
  const userId = normalizeUserId(params.userId);
  if (!conversationId || !userId) throw new SocialConversationValidationError("invalid_input");

  const db = await readDb();
  const conversation = await resolveConversationById(db, conversationId);
  if (!conversation) throw new SocialConversationNotFoundError("conversation_not_found");
  if (!conversation.members.some((member) => member.userId === userId)) {
    throw new SocialConversationAccessError("conversation_membership_required");
  }

  const sortedMessages = [...db.messages]
    .filter((item) => item.conversationId === conversation.id)
    .sort((left, right) => {
      const delta = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (delta !== 0) return delta;
      return left.id.localeCompare(right.id);
    });
  const page = paginateByCursor(sortedMessages, params.limit, params.cursor, (item) => item.id);
  return {
    conversation,
    items: page.items,
    nextCursor: page.nextCursor,
    total: sortedMessages.length,
  };
}

export async function createCommunityMessage(params: {
  conversationId: string;
  senderUserId: string;
  body: string;
}): Promise<{ message: CommunityMessageRecord; conversation: CommunityConversationRecord }> {
  const conversationId = normalizeText(params.conversationId, 2, 160);
  const senderUserId = normalizeUserId(params.senderUserId);
  const body = normalizeText(params.body, 1, 2000);
  if (!conversationId || !senderUserId || !body) {
    throw new SocialConversationValidationError("invalid_message_payload");
  }

  return withDbMutation(async (db) => {
    let conversation = await resolveConversationById(db, conversationId);
    if (!conversation) throw new SocialConversationNotFoundError("conversation_not_found");

    if (conversation.type === "project") {
      const projectId = parseProjectConversationId(conversation.id);
      if (!projectId) throw new SocialConversationValidationError("invalid_project_conversation");
      const project = await getCommunityProjectById(projectId);
      if (!project) throw new SocialConversationNotFoundError("project_not_found");
      conversation = upsertConversationRecord(db, {
        ...conversation,
        title: project.name,
        members: project.members.map((member) => ({
          userId: member.userId,
          role: member.role,
          lastReadAt: conversation?.members.find((item) => item.userId === member.userId)?.lastReadAt,
          muted: conversation?.members.find((item) => item.userId === member.userId)?.muted,
        })),
      });
    }

    if (!conversation.members.some((member) => member.userId === senderUserId)) {
      throw new SocialConversationAccessError("conversation_membership_required");
    }

    const nowIso = new Date().toISOString();
    const message: CommunityMessageRecord = {
      id: randomUUID(),
      conversationId: conversation.id,
      senderUserId,
      body,
      createdAt: nowIso,
    };
    db.messages.push(message);

    const updatedConversation = setMemberLastRead(
      {
        ...conversation,
        lastMessageAt: nowIso,
        lastMessagePreview: body.slice(0, 280),
      },
      senderUserId,
      nowIso
    );
    upsertConversationRecord(db, updatedConversation);

    return { message, conversation: updatedConversation };
  });
}

export async function markCommunityConversationRead(params: {
  conversationId: string;
  userId: string;
}): Promise<{ conversationId: string; lastReadAt: string }> {
  const conversationId = normalizeText(params.conversationId, 2, 160);
  const userId = normalizeUserId(params.userId);
  if (!conversationId || !userId) throw new SocialConversationValidationError("invalid_read_payload");

  return withDbMutation(async (db) => {
    const conversation = await resolveConversationById(db, conversationId);
    if (!conversation) throw new SocialConversationNotFoundError("conversation_not_found");
    if (!conversation.members.some((member) => member.userId === userId)) {
      throw new SocialConversationAccessError("conversation_membership_required");
    }
    const nowIso = new Date().toISOString();
    const updatedConversation = setMemberLastRead(conversation, userId, nowIso);
    upsertConversationRecord(db, updatedConversation);
    return {
      conversationId: updatedConversation.id,
      lastReadAt: nowIso,
    };
  });
}

export async function listCommunityProfileFeedByHandle(params: {
  handle: string;
  limit: number;
  cursor?: string;
  viewerUserId?: string;
  type?: CommunityPublicationType;
}): Promise<{
  foundHandle: boolean;
  items: CommunityPublicationRecord[];
  nextCursor: string | null;
  total: number;
}> {
  const db = await readDb();
  const normalizedHandle = params.handle.trim().toLowerCase();
  const allByHandle = db.publications.filter((item) => item.authorHandle === normalizedHandle);
  const foundHandle = allByHandle.length > 0;
  const visible = allByHandle.filter((item) => {
    if (item.visibility === "public") return true;
    if (!params.viewerUserId) return false;
    return item.authorUserId === params.viewerUserId;
  });
  const typeFiltered = params.type ? visible.filter((item) => item.type === params.type) : visible;
  const sorted = sortByDateDesc(typeFiltered);
  const page = paginateByCursor(sorted, params.limit, params.cursor, (item) => item.id);
  return {
    foundHandle,
    items: page.items,
    nextCursor: page.nextCursor,
    total: sorted.length,
  };
}

export async function listCommunityGlobalFeed(params: {
  sort: "fresh" | "best";
  limit: number;
  cursor?: string;
  type?: CommunityPublicationType;
  region?: string;
}): Promise<{ items: CommunityPublicationRecord[]; nextCursor: string | null; total: number }> {
  const db = await readDb();
  const normalizedRegion = params.region?.trim().toLowerCase();
  let filtered = db.publications.filter((item) => item.visibility === "public");
  if (params.type) filtered = filtered.filter((item) => item.type === params.type);
  if (normalizedRegion) filtered = filtered.filter((item) => item.region === normalizedRegion);
  const sorted = params.sort === "best" ? sortFeedForBest(filtered) : sortByDateDesc(filtered);
  const page = paginateByCursor(sorted, params.limit, params.cursor, (item) => item.id);
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    total: sorted.length,
  };
}
