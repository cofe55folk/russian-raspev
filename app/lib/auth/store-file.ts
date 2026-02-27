import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const AUTH_DB_PATH = path.join(process.cwd(), "data", "auth", "auth-db.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type AuthUserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthSessionRecord = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

export type AuthEntitlementRecord = {
  id: string;
  userId: string;
  code: string;
  source: string;
  createdAt: string;
  expiresAt?: string | null;
};

export type AuthOrderRecord = {
  id: string;
  userId: string;
  provider: string;
  providerRef: string;
  status: string;
  amountMinor?: number;
  currency?: string;
  createdAt: string;
  updatedAt: string;
};

type AuthDb = {
  users: AuthUserRecord[];
  sessions: AuthSessionRecord[];
  entitlements: AuthEntitlementRecord[];
  orders: AuthOrderRecord[];
};

const EMPTY_DB: AuthDb = {
  users: [],
  sessions: [],
  entitlements: [],
  orders: [],
};

async function ensureDir() {
  await fs.mkdir(path.dirname(AUTH_DB_PATH), { recursive: true });
}

function normalizeDb(input: unknown): AuthDb {
  if (!input || typeof input !== "object") return EMPTY_DB;
  const raw = input as Partial<AuthDb>;
  return {
    users: Array.isArray(raw.users) ? (raw.users.filter(Boolean) as AuthUserRecord[]) : [],
    sessions: Array.isArray(raw.sessions) ? (raw.sessions.filter(Boolean) as AuthSessionRecord[]) : [],
    entitlements: Array.isArray(raw.entitlements) ? (raw.entitlements.filter(Boolean) as AuthEntitlementRecord[]) : [],
    orders: Array.isArray(raw.orders) ? (raw.orders.filter(Boolean) as AuthOrderRecord[]) : [],
  };
}

async function readDb(): Promise<AuthDb> {
  try {
    const raw = await fs.readFile(AUTH_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, users: [], sessions: [], entitlements: [], orders: [] };
  }
}

async function writeDb(db: AuthDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${AUTH_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, AUTH_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: AuthDb) => Promise<T> | T): Promise<T> {
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

function isSessionExpired(item: AuthSessionRecord): boolean {
  const ts = new Date(item.expiresAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return ts <= Date.now();
}

export async function findUserByEmail(email: string): Promise<AuthUserRecord | null> {
  const db = await readDb();
  const normalizedEmail = email.trim().toLowerCase();
  return db.users.find((item) => item.email.toLowerCase() === normalizedEmail) ?? null;
}

export async function findUserById(userId: string): Promise<AuthUserRecord | null> {
  const db = await readDb();
  return db.users.find((item) => item.id === userId) ?? null;
}

export async function upsertUserByEmail(params: {
  email: string;
  name?: string;
  passwordHash?: string;
}): Promise<AuthUserRecord> {
  return withDbMutation(async (db) => {
    const normalizedEmail = params.email.trim().toLowerCase();
    const idx = db.users.findIndex((item) => item.email.toLowerCase() === normalizedEmail);
    const now = new Date().toISOString();

    if (idx >= 0) {
      const current = db.users[idx];
      const updated: AuthUserRecord = {
        ...current,
        email: normalizedEmail,
        name: params.name?.trim() || current.name,
        passwordHash: params.passwordHash ?? current.passwordHash,
        updatedAt: now,
      };
      db.users[idx] = updated;
      return updated;
    }

    const created: AuthUserRecord = {
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash: params.passwordHash ?? "",
      name: params.name?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    db.users.push(created);
    return created;
  });
}

export async function createUser(params: { email: string; passwordHash: string; name?: string }): Promise<AuthUserRecord> {
  return withDbMutation(async (db) => {
    const now = new Date().toISOString();
    const user: AuthUserRecord = {
      id: randomUUID(),
      email: params.email.trim().toLowerCase(),
      passwordHash: params.passwordHash,
      name: params.name?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    db.users.push(user);
    return user;
  });
}

export async function updateUserCredentials(params: {
  userId: string;
  passwordHash?: string;
  name?: string;
}): Promise<AuthUserRecord | null> {
  return withDbMutation(async (db) => {
    const idx = db.users.findIndex((item) => item.id === params.userId);
    if (idx < 0) return null;
    const current = db.users[idx];
    const updated: AuthUserRecord = {
      ...current,
      passwordHash: params.passwordHash ?? current.passwordHash,
      name: params.name?.trim() || current.name,
      updatedAt: new Date().toISOString(),
    };
    db.users[idx] = updated;
    return updated;
  });
}

export async function ensureUserForWebhook(params: { userId?: string; email?: string; name?: string }): Promise<AuthUserRecord | null> {
  return withDbMutation(async (db) => {
    if (params.userId) {
      const byId = db.users.find((item) => item.id === params.userId);
      if (byId) return byId;
    }
    if (params.email) {
      const email = params.email.trim().toLowerCase();
      const byEmail = db.users.find((item) => item.email === email);
      if (byEmail) return byEmail;
    }
    if (!params.email) return null;

    const now = new Date().toISOString();
    const user: AuthUserRecord = {
      id: params.userId?.trim() || randomUUID(),
      email: params.email.trim().toLowerCase(),
      passwordHash: "",
      name: params.name?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    db.users.push(user);
    return user;
  });
}

export async function createSession(userId: string, ttlDays = 14): Promise<AuthSessionRecord> {
  return withDbMutation(async (db) => {
    const now = new Date();
    const session: AuthSessionRecord = {
      id: randomUUID(),
      userId,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    };
    db.sessions.push(session);
    return session;
  });
}

export async function getSessionById(sessionId: string): Promise<AuthSessionRecord | null> {
  const db = await readDb();
  const hasExpired = db.sessions.some((item) => isSessionExpired(item));
  if (!hasExpired) {
    return db.sessions.find((item) => item.id === sessionId) ?? null;
  }

  return withDbMutation(async (state) => {
    state.sessions = state.sessions.filter((item) => !isSessionExpired(item));
    return state.sessions.find((item) => item.id === sessionId) ?? null;
  });
}

export async function touchSession(sessionId: string): Promise<void> {
  await withDbMutation(async (db) => {
    const idx = db.sessions.findIndex((item) => item.id === sessionId);
    if (idx < 0) return;
    db.sessions[idx] = {
      ...db.sessions[idx],
      lastSeenAt: new Date().toISOString(),
    };
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await withDbMutation(async (db) => {
    db.sessions = db.sessions.filter((item) => item.id !== sessionId);
  });
}

export async function deleteSessionsByUser(userId: string): Promise<void> {
  await withDbMutation(async (db) => {
    db.sessions = db.sessions.filter((item) => item.userId !== userId);
  });
}

export async function listEntitlementsByUser(userId: string): Promise<AuthEntitlementRecord[]> {
  const db = await readDb();
  return db.entitlements.filter((item) => item.userId === userId);
}

export async function grantEntitlement(params: {
  userId: string;
  code: string;
  source: string;
  expiresAt?: string | null;
}): Promise<AuthEntitlementRecord> {
  return withDbMutation(async (db) => {
    const existingIndex = db.entitlements.findIndex(
      (item) => item.userId === params.userId && item.code === params.code
    );
    if (existingIndex >= 0) {
      const existing = db.entitlements[existingIndex];
      const updated: AuthEntitlementRecord = {
        ...existing,
        source: params.source || existing.source,
        expiresAt: params.expiresAt ?? existing.expiresAt ?? null,
      };
      db.entitlements[existingIndex] = updated;
      return updated;
    }

    const created: AuthEntitlementRecord = {
      id: randomUUID(),
      userId: params.userId,
      code: params.code,
      source: params.source,
      createdAt: new Date().toISOString(),
      expiresAt: params.expiresAt ?? null,
    };
    db.entitlements.push(created);
    return created;
  });
}

export async function revokeEntitlement(params: { userId: string; code: string }): Promise<void> {
  await withDbMutation(async (db) => {
    db.entitlements = db.entitlements.filter((item) => !(item.userId === params.userId && item.code === params.code));
  });
}

export async function upsertOrder(params: {
  userId: string;
  provider: string;
  providerRef: string;
  status: string;
  amountMinor?: number;
  currency?: string;
}): Promise<AuthOrderRecord> {
  return withDbMutation(async (db) => {
    const now = new Date().toISOString();
    const idx = db.orders.findIndex(
      (item) => item.userId === params.userId && item.provider === params.provider && item.providerRef === params.providerRef
    );
    if (idx >= 0) {
      const updated: AuthOrderRecord = {
        ...db.orders[idx],
        status: params.status,
        amountMinor: params.amountMinor ?? db.orders[idx].amountMinor,
        currency: params.currency ?? db.orders[idx].currency,
        updatedAt: now,
      };
      db.orders[idx] = updated;
      return updated;
    }

    const created: AuthOrderRecord = {
      id: randomUUID(),
      userId: params.userId,
      provider: params.provider,
      providerRef: params.providerRef,
      status: params.status,
      amountMinor: params.amountMinor,
      currency: params.currency,
      createdAt: now,
      updatedAt: now,
    };
    db.orders.push(created);
    return created;
  });
}

export async function listOrdersByUser(userId: string): Promise<AuthOrderRecord[]> {
  const db = await readDb();
  return db.orders.filter((item) => item.userId === userId);
}
