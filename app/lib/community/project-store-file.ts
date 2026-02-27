import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const PROJECT_DB_PATH = path.join(process.cwd(), "data", "community", "project-db.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type CommunityProjectRole = "owner" | "editor" | "viewer";

export type CommunityProjectMember = {
  userId: string;
  role: CommunityProjectRole;
};

export type CommunityProjectRecord = {
  id: string;
  name: string;
  description?: string;
  createdByUserId: string;
  members: CommunityProjectMember[];
  createdAt: string;
  updatedAt: string;
};

export type CommunityProjectRoomLinkRecord = {
  id: string;
  projectId: string;
  roomId: string;
  role: CommunityProjectRole;
  linkedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type CommunityProjectTaskStatus = "todo" | "in_progress" | "done";
export type CommunityProjectTaskKind =
  | "transcription"
  | "translation"
  | "notation"
  | "article"
  | "multitrack"
  | "other";

export type CommunityProjectTaskRecord = {
  id: string;
  projectId: string;
  title: string;
  kind: CommunityProjectTaskKind;
  status: CommunityProjectTaskStatus;
  assigneeUserId?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type CommunityProjectEventType =
  | "PROJECT_CREATED"
  | "ROOM_LINKED"
  | "ROOM_LINK_UPDATED"
  | "TASK_CREATED"
  | "TASK_UPDATED";

export type CommunityProjectEventRecord = {
  id: string;
  projectId: string;
  type: CommunityProjectEventType;
  actorUserId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type ProjectDb = {
  projects: CommunityProjectRecord[];
  roomLinks: CommunityProjectRoomLinkRecord[];
  tasks: CommunityProjectTaskRecord[];
  events: CommunityProjectEventRecord[];
};

const EMPTY_DB: ProjectDb = {
  projects: [],
  roomLinks: [],
  tasks: [],
  events: [],
};

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeRole(value: unknown): CommunityProjectRole | null {
  if (value === "owner" || value === "editor" || value === "viewer") return value;
  return null;
}

function normalizeTaskStatus(value: unknown): CommunityProjectTaskStatus | null {
  if (value === "todo" || value === "in_progress" || value === "done") return value;
  return null;
}

function normalizeTaskKind(value: unknown): CommunityProjectTaskKind | null {
  if (
    value === "transcription" ||
    value === "translation" ||
    value === "notation" ||
    value === "article" ||
    value === "multitrack" ||
    value === "other"
  ) {
    return value;
  }
  return null;
}

function normalizeMembers(value: unknown): CommunityProjectMember[] {
  if (!Array.isArray(value)) return [];
  const out: CommunityProjectMember[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<CommunityProjectMember>;
    const userId = normalizeText(raw.userId, 2, 120);
    const role = normalizeRole(raw.role);
    if (!userId || !role) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push({ userId, role });
  }
  return out;
}

function normalizeProjectRecord(value: unknown): CommunityProjectRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CommunityProjectRecord>;
  const id = normalizeText(raw.id, 10, 120);
  const name = normalizeText(raw.name, 2, 120);
  const createdByUserId = normalizeText(raw.createdByUserId, 2, 120);
  const createdAt = normalizeText(raw.createdAt, 8, 40);
  const updatedAt = normalizeText(raw.updatedAt, 8, 40);
  if (!id || !name || !createdByUserId || !createdAt || !updatedAt) return null;
  const members = normalizeMembers(raw.members);
  if (!members.length) return null;
  const description = raw.description == null ? undefined : normalizeText(raw.description, 1, 500) || undefined;
  return {
    id,
    name,
    description,
    createdByUserId,
    members,
    createdAt,
    updatedAt,
  };
}

function normalizeRoomLinkRecord(value: unknown): CommunityProjectRoomLinkRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CommunityProjectRoomLinkRecord>;
  const id = normalizeText(raw.id, 10, 120);
  const projectId = normalizeText(raw.projectId, 10, 120);
  const roomId = normalizeText(raw.roomId, 2, 120);
  const role = normalizeRole(raw.role);
  const linkedByUserId = normalizeText(raw.linkedByUserId, 2, 120);
  const createdAt = normalizeText(raw.createdAt, 8, 40);
  const updatedAt = normalizeText(raw.updatedAt, 8, 40);
  if (!id || !projectId || !roomId || !role || !linkedByUserId || !createdAt || !updatedAt) return null;
  return {
    id,
    projectId,
    roomId,
    role,
    linkedByUserId,
    createdAt,
    updatedAt,
  };
}

function normalizeProjectTaskRecord(value: unknown): CommunityProjectTaskRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CommunityProjectTaskRecord>;
  const id = normalizeText(raw.id, 10, 120);
  const projectId = normalizeText(raw.projectId, 10, 120);
  const title = normalizeText(raw.title, 2, 180);
  const kind = normalizeTaskKind(raw.kind);
  const status = normalizeTaskStatus(raw.status);
  const createdByUserId = normalizeText(raw.createdByUserId, 2, 120);
  const assigneeUserId = raw.assigneeUserId == null ? undefined : normalizeText(raw.assigneeUserId, 2, 120) || undefined;
  const createdAt = normalizeText(raw.createdAt, 8, 40);
  const updatedAt = normalizeText(raw.updatedAt, 8, 40);
  const completedAt = raw.completedAt == null ? undefined : normalizeText(raw.completedAt, 8, 40) || undefined;
  if (!id || !projectId || !title || !kind || !status || !createdByUserId || !createdAt || !updatedAt) return null;
  return {
    id,
    projectId,
    title,
    kind,
    status,
    assigneeUserId,
    createdByUserId,
    createdAt,
    updatedAt,
    completedAt,
  };
}

function normalizeProjectEventRecord(value: unknown): CommunityProjectEventRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CommunityProjectEventRecord>;
  const id = normalizeText(raw.id, 10, 120);
  const projectId = normalizeText(raw.projectId, 10, 120);
  const type =
    raw.type === "PROJECT_CREATED" ||
    raw.type === "ROOM_LINKED" ||
    raw.type === "ROOM_LINK_UPDATED" ||
    raw.type === "TASK_CREATED" ||
    raw.type === "TASK_UPDATED"
      ? raw.type
      : null;
  const actorUserId = normalizeText(raw.actorUserId, 2, 120);
  const createdAt = normalizeText(raw.createdAt, 8, 40);
  if (!id || !projectId || !type || !actorUserId || !createdAt) return null;
  const payload =
    raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload) ? (raw.payload as Record<string, unknown>) : {};
  return {
    id,
    projectId,
    type,
    actorUserId,
    payload,
    createdAt,
  };
}

function normalizeDb(input: unknown): ProjectDb {
  if (!input || typeof input !== "object") {
    return { ...EMPTY_DB, projects: [], roomLinks: [], tasks: [], events: [] };
  }
  const raw = input as Partial<ProjectDb>;
  return {
    projects: Array.isArray(raw.projects)
      ? raw.projects.map(normalizeProjectRecord).filter((item): item is CommunityProjectRecord => !!item)
      : [],
    roomLinks: Array.isArray(raw.roomLinks)
      ? raw.roomLinks.map(normalizeRoomLinkRecord).filter((item): item is CommunityProjectRoomLinkRecord => !!item)
      : [],
    tasks: Array.isArray(raw.tasks)
      ? raw.tasks.map(normalizeProjectTaskRecord).filter((item): item is CommunityProjectTaskRecord => !!item)
      : [],
    events: Array.isArray(raw.events)
      ? raw.events.map(normalizeProjectEventRecord).filter((item): item is CommunityProjectEventRecord => !!item)
      : [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(PROJECT_DB_PATH), { recursive: true });
}

async function readDb(): Promise<ProjectDb> {
  try {
    const raw = await fs.readFile(PROJECT_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, projects: [], roomLinks: [], tasks: [], events: [] };
  }
}

async function writeDb(db: ProjectDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${PROJECT_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, PROJECT_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: ProjectDb) => Promise<T> | T): Promise<T> {
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

function buildProjectMembers(
  createdByUserId: string,
  members: Array<{ userId: string; role: CommunityProjectRole }>
): CommunityProjectMember[] {
  const map = new Map<string, CommunityProjectRole>();
  map.set(createdByUserId, "owner");
  for (const item of members) {
    if (item.userId === createdByUserId) continue;
    map.set(item.userId, item.role);
  }
  return Array.from(map.entries())
    .map(([userId, role]) => ({ userId, role }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
}

function appendProjectEvent(
  db: ProjectDb,
  params: {
    projectId: string;
    type: CommunityProjectEventType;
    actorUserId: string;
    payload?: Record<string, unknown>;
    createdAt?: string;
  }
) {
  db.events.push({
    id: randomUUID(),
    projectId: params.projectId,
    type: params.type,
    actorUserId: params.actorUserId,
    payload: params.payload || {},
    createdAt: params.createdAt || new Date().toISOString(),
  });
}

export async function getCommunityProjectById(projectId: string): Promise<CommunityProjectRecord | null> {
  const db = await readDb();
  return db.projects.find((item) => item.id === projectId) ?? null;
}

export async function listCommunityProjects(params: {
  offset: number;
  limit: number;
  memberUserId?: string;
}): Promise<{ total: number; items: CommunityProjectRecord[] }> {
  const db = await readDb();
  const filtered = db.projects
    .filter((item) => !params.memberUserId || item.members.some((member) => member.userId === params.memberUserId))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return {
    total: filtered.length,
    items: filtered.slice(params.offset, params.offset + params.limit),
  };
}

export async function createCommunityProject(params: {
  name: string;
  description?: string;
  createdByUserId: string;
  members?: Array<{ userId: string; role: CommunityProjectRole }>;
}): Promise<CommunityProjectRecord> {
  return withDbMutation(async (db) => {
    const now = new Date().toISOString();
    const created: CommunityProjectRecord = {
      id: randomUUID(),
      name: params.name,
      description: params.description,
      createdByUserId: params.createdByUserId,
      members: buildProjectMembers(params.createdByUserId, params.members || []),
      createdAt: now,
      updatedAt: now,
    };
    db.projects.push(created);
    appendProjectEvent(db, {
      projectId: created.id,
      type: "PROJECT_CREATED",
      actorUserId: params.createdByUserId,
      payload: {
        name: created.name,
      },
      createdAt: now,
    });
    return created;
  });
}

export async function listCommunityProjectRoomLinks(projectId: string): Promise<CommunityProjectRoomLinkRecord[]> {
  const db = await readDb();
  return db.roomLinks
    .filter((item) => item.projectId === projectId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

export async function linkRoomToCommunityProject(params: {
  projectId: string;
  roomId: string;
  role: CommunityProjectRole;
  linkedByUserId: string;
}): Promise<
  | { ok: true; idempotent: boolean; link: CommunityProjectRoomLinkRecord }
  | { ok: false; error: "PROJECT_NOT_FOUND" }
> {
  return withDbMutation(async (db) => {
    const project = db.projects.find((item) => item.id === params.projectId);
    if (!project) return { ok: false as const, error: "PROJECT_NOT_FOUND" as const };

    const existing = db.roomLinks.find((item) => item.projectId === params.projectId && item.roomId === params.roomId);
    if (existing) {
      if (existing.role !== params.role) {
        existing.role = params.role;
        existing.updatedAt = new Date().toISOString();
        appendProjectEvent(db, {
          projectId: params.projectId,
          type: "ROOM_LINK_UPDATED",
          actorUserId: params.linkedByUserId,
          payload: {
            roomId: params.roomId,
            role: params.role,
          },
        });
      }
      return { ok: true as const, idempotent: true, link: existing };
    }

    const now = new Date().toISOString();
    const created: CommunityProjectRoomLinkRecord = {
      id: randomUUID(),
      projectId: params.projectId,
      roomId: params.roomId,
      role: params.role,
      linkedByUserId: params.linkedByUserId,
      createdAt: now,
      updatedAt: now,
    };
    db.roomLinks.push(created);
    project.updatedAt = now;
    appendProjectEvent(db, {
      projectId: params.projectId,
      type: "ROOM_LINKED",
      actorUserId: params.linkedByUserId,
      payload: {
        roomId: params.roomId,
        role: params.role,
      },
      createdAt: now,
    });
    return { ok: true as const, idempotent: false, link: created };
  });
}

export async function listCommunityProjectTasks(projectId: string): Promise<CommunityProjectTaskRecord[]> {
  const db = await readDb();
  return db.tasks
    .filter((item) => item.projectId === projectId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

export async function upsertCommunityProjectTask(params: {
  projectId: string;
  actorUserId: string;
  taskId?: string;
  title?: string;
  kind?: CommunityProjectTaskKind;
  status?: CommunityProjectTaskStatus;
  assigneeUserId?: string;
}): Promise<
  | { ok: true; created: boolean; task: CommunityProjectTaskRecord }
  | { ok: false; error: "PROJECT_NOT_FOUND" | "TASK_NOT_FOUND" | "INVALID_TASK_TITLE" }
> {
  return withDbMutation(async (db) => {
    const project = db.projects.find((item) => item.id === params.projectId);
    if (!project) return { ok: false as const, error: "PROJECT_NOT_FOUND" as const };

    const now = new Date().toISOString();
    if (!params.taskId) {
      const title = normalizeText(params.title, 2, 180);
      if (!title) return { ok: false as const, error: "INVALID_TASK_TITLE" as const };
      const created: CommunityProjectTaskRecord = {
        id: randomUUID(),
        projectId: params.projectId,
        title,
        kind: params.kind || "other",
        status: params.status || "todo",
        assigneeUserId: params.assigneeUserId,
        createdByUserId: params.actorUserId,
        createdAt: now,
        updatedAt: now,
        completedAt: params.status === "done" ? now : undefined,
      };
      db.tasks.push(created);
      project.updatedAt = now;
      appendProjectEvent(db, {
        projectId: params.projectId,
        type: "TASK_CREATED",
        actorUserId: params.actorUserId,
        payload: {
          taskId: created.id,
          title: created.title,
          kind: created.kind,
          status: created.status,
        },
        createdAt: now,
      });
      return { ok: true as const, created: true, task: created };
    }

    const existing = db.tasks.find((item) => item.projectId === params.projectId && item.id === params.taskId);
    if (!existing) return { ok: false as const, error: "TASK_NOT_FOUND" as const };

    if (params.title != null) {
      const title = normalizeText(params.title, 2, 180);
      if (!title) return { ok: false as const, error: "INVALID_TASK_TITLE" as const };
      existing.title = title;
    }
    if (params.kind) existing.kind = params.kind;
    if (params.status) existing.status = params.status;
    if (params.assigneeUserId !== undefined) {
      existing.assigneeUserId = params.assigneeUserId || undefined;
    }
    existing.updatedAt = now;
    existing.completedAt = existing.status === "done" ? now : undefined;
    project.updatedAt = now;

    appendProjectEvent(db, {
      projectId: params.projectId,
      type: "TASK_UPDATED",
      actorUserId: params.actorUserId,
      payload: {
        taskId: existing.id,
        title: existing.title,
        kind: existing.kind,
        status: existing.status,
        assigneeUserId: existing.assigneeUserId || null,
      },
      createdAt: now,
    });

    return { ok: true as const, created: false, task: existing };
  });
}

export async function listCommunityProjectEvents(params: {
  projectId: string;
  limit: number;
}): Promise<CommunityProjectEventRecord[]> {
  const db = await readDb();
  const normalizedLimit = Math.max(1, Math.min(200, Math.floor(params.limit || 20)));
  return db.events
    .filter((item) => item.projectId === params.projectId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, normalizedLimit);
}
