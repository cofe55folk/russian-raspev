import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const COLLAB_DB_PATH = path.join(process.cwd(), "data", "community", "collab-db.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type CollabReferenceContentType = "sound" | "article" | "video" | "education";
export type CollabRoomStatus = "active" | "archived";
export type CollabSlotStatus = "open" | "filled";

export type CollabRoomRecord = {
  id: string;
  title: string;
  description?: string;
  referenceContentType?: CollabReferenceContentType;
  referenceContentId?: string;
  status: CollabRoomStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type CollabSlotRecord = {
  id: string;
  roomId: string;
  title: string;
  role?: string;
  status: CollabSlotStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  filledTakeId?: string;
  filledByUserId?: string;
  filledAt?: string;
};

export type CollabTakeRecord = {
  id: string;
  roomId: string;
  slotId: string;
  submittedByUserId: string;
  sourceTakeId: string;
  note?: string;
  createdAt: string;
};

export type CollabFeedbackRecord = {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  body: string;
  atMs: number;
  takeId?: string;
  section?: string;
  createdAt: string;
  updatedAt: string;
};

type CollabDb = {
  rooms: CollabRoomRecord[];
  slots: CollabSlotRecord[];
  takes: CollabTakeRecord[];
  feedbacks: CollabFeedbackRecord[];
};

const EMPTY_DB: CollabDb = {
  rooms: [],
  slots: [],
  takes: [],
  feedbacks: [],
};

async function ensureDir() {
  await fs.mkdir(path.dirname(COLLAB_DB_PATH), { recursive: true });
}

function normalizeDb(input: unknown): CollabDb {
  if (!input || typeof input !== "object") return EMPTY_DB;
  const raw = input as Partial<CollabDb>;
  return {
    rooms: Array.isArray(raw.rooms) ? (raw.rooms.filter(Boolean) as CollabRoomRecord[]) : [],
    slots: Array.isArray(raw.slots) ? (raw.slots.filter(Boolean) as CollabSlotRecord[]) : [],
    takes: Array.isArray(raw.takes) ? (raw.takes.filter(Boolean) as CollabTakeRecord[]) : [],
    feedbacks: Array.isArray(raw.feedbacks) ? (raw.feedbacks.filter(Boolean) as CollabFeedbackRecord[]) : [],
  };
}

async function readDb(): Promise<CollabDb> {
  try {
    const raw = await fs.readFile(COLLAB_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, rooms: [], slots: [], takes: [] };
  }
}

async function writeDb(db: CollabDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${COLLAB_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, COLLAB_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: CollabDb) => Promise<T> | T): Promise<T> {
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

export async function getCollabRoomById(roomId: string): Promise<CollabRoomRecord | null> {
  const db = await readDb();
  return db.rooms.find((item) => item.id === roomId) ?? null;
}

export async function listCollabRooms(params: {
  offset: number;
  limit: number;
  status?: CollabRoomStatus;
}): Promise<{ total: number; items: CollabRoomRecord[] }> {
  const db = await readDb();
  const filtered = db.rooms
    .filter((item) => !params.status || item.status === params.status)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return {
    total: filtered.length,
    items: filtered.slice(params.offset, params.offset + params.limit),
  };
}

export async function createCollabRoom(params: {
  title: string;
  description?: string;
  referenceContentType?: CollabReferenceContentType;
  referenceContentId?: string;
  createdByUserId: string;
}): Promise<CollabRoomRecord> {
  return withDbMutation(async (db) => {
    const now = new Date().toISOString();
    const created: CollabRoomRecord = {
      id: randomUUID(),
      title: params.title,
      description: params.description,
      referenceContentType: params.referenceContentType,
      referenceContentId: params.referenceContentId,
      status: "active",
      createdByUserId: params.createdByUserId,
      createdAt: now,
      updatedAt: now,
    };
    db.rooms.push(created);
    return created;
  });
}

export async function listCollabSlotsByRoom(roomId: string): Promise<CollabSlotRecord[]> {
  const db = await readDb();
  return db.slots
    .filter((item) => item.roomId === roomId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

export async function listOpenCollabSlots(params: {
  offset: number;
  limit: number;
}): Promise<{ total: number; items: Array<CollabSlotRecord & { room?: CollabRoomRecord | null }> }> {
  const db = await readDb();
  const roomById = new Map(db.rooms.map((room) => [room.id, room]));
  const openSlots = db.slots
    .filter((slot) => slot.status === "open")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const page = openSlots.slice(params.offset, params.offset + params.limit);
  return {
    total: openSlots.length,
    items: page.map((slot) => ({
      ...slot,
      room: roomById.get(slot.roomId) ?? null,
    })),
  };
}

export async function createCollabSlot(params: {
  roomId: string;
  title: string;
  role?: string;
  createdByUserId: string;
}): Promise<CollabSlotRecord | null> {
  return withDbMutation(async (db) => {
    const room = db.rooms.find((item) => item.id === params.roomId && item.status === "active");
    if (!room) return null;
    const now = new Date().toISOString();
    const created: CollabSlotRecord = {
      id: randomUUID(),
      roomId: params.roomId,
      title: params.title,
      role: params.role,
      status: "open",
      createdByUserId: params.createdByUserId,
      createdAt: now,
      updatedAt: now,
    };
    db.slots.push(created);
    room.updatedAt = now;
    return created;
  });
}

export async function attachTakeToCollabSlot(params: {
  slotId: string;
  submittedByUserId: string;
  sourceTakeId: string;
  note?: string;
}): Promise<
  | { ok: true; slot: CollabSlotRecord; take: CollabTakeRecord; room: CollabRoomRecord }
  | { ok: false; error: "SLOT_NOT_FOUND" | "SLOT_ALREADY_FILLED" | "ROOM_NOT_FOUND" }
> {
  return withDbMutation(async (db) => {
    const slot = db.slots.find((item) => item.id === params.slotId);
    if (!slot) return { ok: false as const, error: "SLOT_NOT_FOUND" as const };
    if (slot.status !== "open") return { ok: false as const, error: "SLOT_ALREADY_FILLED" as const };

    const room = db.rooms.find((item) => item.id === slot.roomId);
    if (!room) return { ok: false as const, error: "ROOM_NOT_FOUND" as const };

    const now = new Date().toISOString();
    const take: CollabTakeRecord = {
      id: randomUUID(),
      roomId: room.id,
      slotId: slot.id,
      submittedByUserId: params.submittedByUserId,
      sourceTakeId: params.sourceTakeId,
      note: params.note,
      createdAt: now,
    };
    db.takes.push(take);

    const nextSlot: CollabSlotRecord = {
      ...slot,
      status: "filled",
      filledTakeId: take.id,
      filledByUserId: params.submittedByUserId,
      filledAt: now,
      updatedAt: now,
    };
    const slotIndex = db.slots.findIndex((item) => item.id === slot.id);
    db.slots[slotIndex] = nextSlot;

    room.updatedAt = now;

    return {
      ok: true as const,
      slot: nextSlot,
      take,
      room,
    };
  });
}

export async function listCollabFeedbackByRoom(params: {
  roomId: string;
  offset: number;
  limit: number;
  takeId?: string;
}): Promise<{ total: number; items: CollabFeedbackRecord[] }> {
  const db = await readDb();
  const filtered = db.feedbacks
    .filter((item) => item.roomId === params.roomId)
    .filter((item) => !params.takeId || item.takeId === params.takeId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  return {
    total: filtered.length,
    items: filtered.slice(params.offset, params.offset + params.limit),
  };
}

export async function createCollabFeedback(params: {
  roomId: string;
  userId: string;
  userName: string;
  body: string;
  atMs: number;
  takeId?: string;
  section?: string;
}): Promise<
  | { ok: true; feedback: CollabFeedbackRecord; room: CollabRoomRecord }
  | { ok: false; error: "ROOM_NOT_FOUND" | "TAKE_NOT_FOUND_IN_ROOM" }
> {
  return withDbMutation(async (db) => {
    const room = db.rooms.find((item) => item.id === params.roomId);
    if (!room) return { ok: false as const, error: "ROOM_NOT_FOUND" as const };
    if (params.takeId) {
      const takeExists = db.takes.some((item) => item.id === params.takeId && item.roomId === params.roomId);
      if (!takeExists) {
        return { ok: false as const, error: "TAKE_NOT_FOUND_IN_ROOM" as const };
      }
    }
    const now = new Date().toISOString();
    const feedback: CollabFeedbackRecord = {
      id: randomUUID(),
      roomId: params.roomId,
      userId: params.userId,
      userName: params.userName,
      body: params.body,
      atMs: params.atMs,
      takeId: params.takeId,
      section: params.section,
      createdAt: now,
      updatedAt: now,
    };
    db.feedbacks.push(feedback);
    room.updatedAt = now;
    return { ok: true as const, feedback, room };
  });
}
