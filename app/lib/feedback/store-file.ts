import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const FEEDBACK_ROOT_DIR = path.join(process.cwd(), "data", "feedback");
const FEEDBACK_DB_PATH = path.join(FEEDBACK_ROOT_DIR, "feedback-db.json");
const FEEDBACK_UPLOADS_DIR = path.join(FEEDBACK_ROOT_DIR, "uploads");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type FeedbackSenderRole = "user" | "admin";
export type FeedbackThreadStatus = "open" | "closed";
export type FeedbackThreadChannel = "general" | "curator";
export type FeedbackContextType = "general" | "course_video" | "course_audio" | "course_text" | "material_offer";
export type FeedbackAttachmentKind = "audio";

export type FeedbackMessageAttachment = {
  id: string;
  kind: FeedbackAttachmentKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
};

export type FeedbackThreadRecord = {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  subject: string;
  status: FeedbackThreadStatus;
  channel: FeedbackThreadChannel;
  contextType: FeedbackContextType;
  contextId?: string;
  contextTitle?: string;
  contextSlug?: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

export type FeedbackMessageRecord = {
  id: string;
  threadId: string;
  senderRole: FeedbackSenderRole;
  senderUserId?: string;
  senderName: string;
  body: string;
  attachments: FeedbackMessageAttachment[];
  createdAt: string;
};

export type FeedbackUploadRecord = {
  id: string;
  userId: string;
  kind: FeedbackAttachmentKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageRelPath: string;
  createdAt: string;
  threadId?: string;
  messageId?: string;
};

export type FeedbackThreadSummary = FeedbackThreadRecord & {
  messageCount: number;
  lastMessagePreview: string;
  lastSenderRole: FeedbackSenderRole | null;
};

type FeedbackDb = {
  threads: FeedbackThreadRecord[];
  messages: FeedbackMessageRecord[];
  uploads: FeedbackUploadRecord[];
};

const EMPTY_DB: FeedbackDb = {
  threads: [],
  messages: [],
  uploads: [],
};

function buildAttachmentDownloadUrl(uploadId: string): string {
  return `/api/feedback/attachments/${encodeURIComponent(uploadId)}`;
}

function normalizeThreadChannel(input: unknown): FeedbackThreadChannel {
  return input === "curator" ? "curator" : "general";
}

function normalizeContextType(input: unknown): FeedbackContextType {
  if (input === "course_video") return "course_video";
  if (input === "course_audio") return "course_audio";
  if (input === "course_text") return "course_text";
  if (input === "material_offer") return "material_offer";
  return "general";
}

function normalizeThreadStatus(input: unknown): FeedbackThreadStatus {
  return input === "closed" ? "closed" : "open";
}

function normalizeString(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  return value || undefined;
}

function normalizeAttachment(input: unknown): FeedbackMessageAttachment | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<FeedbackMessageAttachment>;
  const id = normalizeString(raw.id);
  const originalName = normalizeString(raw.originalName);
  const mimeType = normalizeString(raw.mimeType);
  const kind = raw.kind === "audio" ? "audio" : null;
  const sizeBytes = typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes) ? raw.sizeBytes : 0;
  if (!id || !originalName || !mimeType || !kind || sizeBytes < 0) return null;
  return {
    id,
    kind,
    originalName,
    mimeType,
    sizeBytes,
    downloadUrl: typeof raw.downloadUrl === "string" && raw.downloadUrl.trim()
      ? raw.downloadUrl
      : buildAttachmentDownloadUrl(id),
  };
}

function normalizeThreadRecord(input: unknown): FeedbackThreadRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<FeedbackThreadRecord>;
  const id = normalizeString(raw.id);
  const userId = normalizeString(raw.userId);
  const userEmail = normalizeString(raw.userEmail);
  const subject = normalizeString(raw.subject);
  const createdAt = normalizeString(raw.createdAt);
  const updatedAt = normalizeString(raw.updatedAt);
  const lastMessageAt = normalizeString(raw.lastMessageAt);
  if (!id || !userId || !userEmail || !subject || !createdAt || !updatedAt || !lastMessageAt) return null;

  return {
    id,
    userId,
    userEmail,
    userName: normalizeString(raw.userName),
    subject,
    status: normalizeThreadStatus(raw.status),
    channel: normalizeThreadChannel(raw.channel),
    contextType: normalizeContextType(raw.contextType),
    contextId: normalizeString(raw.contextId),
    contextTitle: normalizeString(raw.contextTitle),
    contextSlug: normalizeString(raw.contextSlug),
    createdAt,
    updatedAt,
    lastMessageAt,
  };
}

function normalizeMessageRecord(input: unknown): FeedbackMessageRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<FeedbackMessageRecord>;
  const id = normalizeString(raw.id);
  const threadId = normalizeString(raw.threadId);
  const senderName = normalizeString(raw.senderName);
  const body = typeof raw.body === "string" ? raw.body : "";
  const createdAt = normalizeString(raw.createdAt);
  if (!id || !threadId || !senderName || !createdAt) return null;

  return {
    id,
    threadId,
    senderRole: raw.senderRole === "admin" ? "admin" : "user",
    senderUserId: normalizeString(raw.senderUserId),
    senderName,
    body,
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map(normalizeAttachment).filter((item): item is FeedbackMessageAttachment => !!item)
      : [],
    createdAt,
  };
}

function normalizeUploadRecord(input: unknown): FeedbackUploadRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<FeedbackUploadRecord>;
  const id = normalizeString(raw.id);
  const userId = normalizeString(raw.userId);
  const originalName = normalizeString(raw.originalName);
  const mimeType = normalizeString(raw.mimeType);
  const storageRelPath = normalizeString(raw.storageRelPath);
  const createdAt = normalizeString(raw.createdAt);
  const sizeBytes = typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes) ? raw.sizeBytes : -1;
  if (!id || !userId || !originalName || !mimeType || !storageRelPath || !createdAt || sizeBytes < 0) return null;

  return {
    id,
    userId,
    kind: raw.kind === "audio" ? "audio" : "audio",
    originalName,
    mimeType,
    sizeBytes,
    storageRelPath,
    createdAt,
    threadId: normalizeString(raw.threadId),
    messageId: normalizeString(raw.messageId),
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(FEEDBACK_DB_PATH), { recursive: true });
  await fs.mkdir(FEEDBACK_UPLOADS_DIR, { recursive: true });
}

function normalizeDb(input: unknown): FeedbackDb {
  if (!input || typeof input !== "object") return EMPTY_DB;
  const raw = input as Partial<FeedbackDb>;
  return {
    threads: Array.isArray(raw.threads)
      ? raw.threads.map(normalizeThreadRecord).filter((item): item is FeedbackThreadRecord => !!item)
      : [],
    messages: Array.isArray(raw.messages)
      ? raw.messages.map(normalizeMessageRecord).filter((item): item is FeedbackMessageRecord => !!item)
      : [],
    uploads: Array.isArray(raw.uploads)
      ? raw.uploads.map(normalizeUploadRecord).filter((item): item is FeedbackUploadRecord => !!item)
      : [],
  };
}

async function readDb(): Promise<FeedbackDb> {
  try {
    const raw = await fs.readFile(FEEDBACK_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, threads: [], messages: [], uploads: [] };
  }
}

async function writeDb(db: FeedbackDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tmp = `${FEEDBACK_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, FEEDBACK_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: FeedbackDb) => Promise<T> | T): Promise<T> {
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

function toSortedMessages(items: FeedbackMessageRecord[]): FeedbackMessageRecord[] {
  return [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function toThreadSummaries(db: FeedbackDb, threads: FeedbackThreadRecord[]): FeedbackThreadSummary[] {
  const messagesByThread = new Map<string, FeedbackMessageRecord[]>();
  for (const message of db.messages) {
    const bucket = messagesByThread.get(message.threadId) ?? [];
    bucket.push(message);
    messagesByThread.set(message.threadId, bucket);
  }

  return threads
    .map((thread) => {
      const messages = toSortedMessages(messagesByThread.get(thread.id) ?? []);
      const lastMessage = messages[messages.length - 1];
      return {
        ...thread,
        messageCount: messages.length,
        lastMessagePreview: lastMessage?.body.slice(0, 160) ?? "",
        lastSenderRole: lastMessage?.senderRole ?? null,
      };
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function getUploadExtension(mimeType: string, originalName: string): string {
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.includes("webm")) return "webm";
  if (normalizedMime.includes("ogg")) return "ogg";
  if (normalizedMime.includes("wav")) return "wav";
  if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3")) return "mp3";
  if (normalizedMime.includes("mp4") || normalizedMime.includes("aac")) return "m4a";

  const ext = path.extname(originalName).replace(/\./g, "").trim().toLowerCase();
  return ext || "bin";
}

function getUploadAbsPath(upload: FeedbackUploadRecord): string {
  const fileName = path.basename(upload.storageRelPath || "").trim();
  if (!fileName || fileName === "." || fileName === "..") {
    throw new Error("FEEDBACK_UPLOAD_PATH_INVALID");
  }
  return path.join(FEEDBACK_UPLOADS_DIR, fileName);
}

function claimAttachments(
  db: FeedbackDb,
  params: { userId: string; attachmentIds: string[]; threadId: string; messageId: string }
): FeedbackMessageAttachment[] {
  const uniqueIds = Array.from(new Set(params.attachmentIds.map((item) => item.trim()).filter(Boolean))).slice(0, 5);
  if (!uniqueIds.length) return [];

  const results: FeedbackMessageAttachment[] = [];
  for (const attachmentId of uniqueIds) {
    const upload = db.uploads.find((item) => item.id === attachmentId);
    if (!upload) throw new Error("FEEDBACK_ATTACHMENT_NOT_FOUND");
    if (upload.userId !== params.userId) throw new Error("FEEDBACK_ATTACHMENT_OWNER_MISMATCH");
    if (upload.messageId || upload.threadId) throw new Error("FEEDBACK_ATTACHMENT_ALREADY_USED");

    upload.threadId = params.threadId;
    upload.messageId = params.messageId;

    results.push({
      id: upload.id,
      kind: upload.kind,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      downloadUrl: buildAttachmentDownloadUrl(upload.id),
    });
  }

  return results;
}

export async function getFeedbackThreadById(threadId: string): Promise<FeedbackThreadRecord | null> {
  const db = await readDb();
  return db.threads.find((item) => item.id === threadId) ?? null;
}

export async function listFeedbackThreadsByUser(userId: string): Promise<FeedbackThreadSummary[]> {
  const db = await readDb();
  const threads = db.threads.filter((item) => item.userId === userId);
  return toThreadSummaries(db, threads);
}

export async function listFeedbackThreadsForAdmin(): Promise<FeedbackThreadSummary[]> {
  const db = await readDb();
  return toThreadSummaries(db, db.threads);
}

export async function listFeedbackMessagesByThread(threadId: string): Promise<FeedbackMessageRecord[]> {
  const db = await readDb();
  return toSortedMessages(db.messages.filter((item) => item.threadId === threadId));
}

export async function createFeedbackUpload(params: {
  userId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}): Promise<FeedbackUploadRecord> {
  await ensureDir();

  const id = randomUUID();
  const ext = getUploadExtension(params.mimeType, params.originalName);
  const fileName = `${id}.${ext}`;
  const absPath = path.join(FEEDBACK_UPLOADS_DIR, fileName);
  await fs.writeFile(absPath, Buffer.from(params.bytes));

  const now = new Date().toISOString();
  const uploadRecord: FeedbackUploadRecord = {
    id,
    userId: params.userId,
    kind: "audio",
    originalName: params.originalName,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    storageRelPath: path.join("data", "feedback", "uploads", fileName),
    createdAt: now,
  };

  await withDbMutation((db) => {
    db.uploads.push(uploadRecord);
  });

  return uploadRecord;
}

export async function getFeedbackUploadById(uploadId: string): Promise<FeedbackUploadRecord | null> {
  const db = await readDb();
  return db.uploads.find((item) => item.id === uploadId) ?? null;
}

export async function readFeedbackUploadBytes(upload: FeedbackUploadRecord): Promise<Uint8Array | null> {
  try {
    const buf = await fs.readFile(getUploadAbsPath(upload));
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export async function createFeedbackThread(params: {
  userId: string;
  userEmail: string;
  userName?: string;
  subject: string;
  firstMessageBody: string;
  channel?: FeedbackThreadChannel;
  contextType?: FeedbackContextType;
  contextId?: string;
  contextTitle?: string;
  contextSlug?: string;
  attachmentIds?: string[];
}): Promise<{ thread: FeedbackThreadRecord; message: FeedbackMessageRecord }> {
  return withDbMutation(async (db) => {
    const now = new Date().toISOString();
    const thread: FeedbackThreadRecord = {
      id: randomUUID(),
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName?.trim() || undefined,
      subject: params.subject,
      status: "open",
      channel: params.channel === "curator" ? "curator" : "general",
      contextType: normalizeContextType(params.contextType),
      contextId: normalizeString(params.contextId),
      contextTitle: normalizeString(params.contextTitle),
      contextSlug: normalizeString(params.contextSlug),
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    };

    const messageId = randomUUID();
    const attachments = claimAttachments(db, {
      userId: params.userId,
      attachmentIds: Array.isArray(params.attachmentIds) ? params.attachmentIds : [],
      threadId: thread.id,
      messageId,
    });

    const message: FeedbackMessageRecord = {
      id: messageId,
      threadId: thread.id,
      senderRole: "user",
      senderUserId: params.userId,
      senderName: params.userName?.trim() || params.userEmail,
      body: params.firstMessageBody,
      attachments,
      createdAt: now,
    };

    db.threads.push(thread);
    db.messages.push(message);
    return { thread, message };
  });
}

export async function addFeedbackMessage(params: {
  threadId: string;
  senderRole: FeedbackSenderRole;
  senderUserId?: string;
  senderName: string;
  body: string;
  attachmentIds?: string[];
}): Promise<{ thread: FeedbackThreadRecord; message: FeedbackMessageRecord } | null> {
  return withDbMutation(async (db) => {
    const idx = db.threads.findIndex((item) => item.id === params.threadId);
    if (idx < 0) return null;

    const now = new Date().toISOString();
    const thread = db.threads[idx];
    const updatedThread: FeedbackThreadRecord = {
      ...thread,
      updatedAt: now,
      lastMessageAt: now,
    };

    const attachmentIds = Array.isArray(params.attachmentIds) ? params.attachmentIds : [];
    if (attachmentIds.length && (!params.senderUserId || params.senderRole !== "user")) {
      throw new Error("FEEDBACK_ATTACHMENT_NOT_ALLOWED");
    }

    const messageId = randomUUID();
    const attachments = params.senderUserId
      ? claimAttachments(db, {
          userId: params.senderUserId,
          attachmentIds,
          threadId: params.threadId,
          messageId,
        })
      : [];

    const message: FeedbackMessageRecord = {
      id: messageId,
      threadId: params.threadId,
      senderRole: params.senderRole,
      senderUserId: params.senderUserId,
      senderName: params.senderName,
      body: params.body,
      attachments,
      createdAt: now,
    };

    db.threads[idx] = updatedThread;
    db.messages.push(message);
    return { thread: updatedThread, message };
  });
}

export async function setFeedbackThreadStatus(params: {
  threadId: string;
  status: FeedbackThreadStatus;
}): Promise<FeedbackThreadRecord | null> {
  return withDbMutation(async (db) => {
    const idx = db.threads.findIndex((item) => item.id === params.threadId);
    if (idx < 0) return null;
    const updated: FeedbackThreadRecord = {
      ...db.threads[idx],
      status: params.status,
      updatedAt: new Date().toISOString(),
    };
    db.threads[idx] = updated;
    return updated;
  });
}
