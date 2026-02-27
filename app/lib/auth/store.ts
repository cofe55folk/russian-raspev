import type {
  AuthEntitlementRecord,
  AuthOrderRecord,
  AuthSessionRecord,
  AuthUserRecord,
} from "./store-file";

export type {
  AuthEntitlementRecord,
  AuthOrderRecord,
  AuthSessionRecord,
  AuthUserRecord,
} from "./store-file";

type StoreModule = {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserById(userId: string): Promise<AuthUserRecord | null>;
  upsertUserByEmail(params: {
    email: string;
    name?: string;
    passwordHash?: string;
  }): Promise<AuthUserRecord>;
  createUser(params: {
    email: string;
    passwordHash: string;
    name?: string;
  }): Promise<AuthUserRecord>;
  updateUserCredentials(params: {
    userId: string;
    passwordHash?: string;
    name?: string;
  }): Promise<AuthUserRecord | null>;
  ensureUserForWebhook(params: {
    userId?: string;
    email?: string;
    name?: string;
  }): Promise<AuthUserRecord | null>;
  createSession(userId: string, ttlDays?: number): Promise<AuthSessionRecord>;
  getSessionById(sessionId: string): Promise<AuthSessionRecord | null>;
  touchSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  deleteSessionsByUser(userId: string): Promise<void>;
  listEntitlementsByUser(userId: string): Promise<AuthEntitlementRecord[]>;
  grantEntitlement(params: {
    userId: string;
    code: string;
    source: string;
    expiresAt?: string | null;
  }): Promise<AuthEntitlementRecord>;
  revokeEntitlement(params: {
    userId: string;
    code: string;
  }): Promise<void>;
  upsertOrder(params: {
    userId: string;
    provider: string;
    providerRef: string;
    status: string;
    amountMinor?: number;
    currency?: string;
  }): Promise<AuthOrderRecord>;
  listOrdersByUser(userId: string): Promise<AuthOrderRecord[]>;
};

type StoreMode = "file" | "prisma";

const preferPrisma = process.env.RR_AUTH_STORE === "prisma" && !!process.env.DATABASE_URL;
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
        console.warn("[auth-store] Prisma backend unavailable, fallback to file backend.", error);
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

export function getAuthStoreMode(): StoreMode {
  return getDesiredStoreMode();
}

export async function findUserByEmail(email: string): Promise<AuthUserRecord | null> {
  return callStore("findUserByEmail", email);
}

export async function findUserById(userId: string): Promise<AuthUserRecord | null> {
  return callStore("findUserById", userId);
}

export async function upsertUserByEmail(params: {
  email: string;
  name?: string;
  passwordHash?: string;
}): Promise<AuthUserRecord> {
  return callStore("upsertUserByEmail", params);
}

export async function createUser(params: {
  email: string;
  passwordHash: string;
  name?: string;
}): Promise<AuthUserRecord> {
  return callStore("createUser", params);
}

export async function updateUserCredentials(params: {
  userId: string;
  passwordHash?: string;
  name?: string;
}): Promise<AuthUserRecord | null> {
  return callStore("updateUserCredentials", params);
}

export async function ensureUserForWebhook(params: {
  userId?: string;
  email?: string;
  name?: string;
}): Promise<AuthUserRecord | null> {
  return callStore("ensureUserForWebhook", params);
}

export async function createSession(userId: string, ttlDays = 14): Promise<AuthSessionRecord> {
  return callStore("createSession", userId, ttlDays);
}

export async function getSessionById(sessionId: string): Promise<AuthSessionRecord | null> {
  return callStore("getSessionById", sessionId);
}

export async function touchSession(sessionId: string): Promise<void> {
  return callStore("touchSession", sessionId);
}

export async function deleteSession(sessionId: string): Promise<void> {
  return callStore("deleteSession", sessionId);
}

export async function deleteSessionsByUser(userId: string): Promise<void> {
  return callStore("deleteSessionsByUser", userId);
}

export async function listEntitlementsByUser(userId: string): Promise<AuthEntitlementRecord[]> {
  return callStore("listEntitlementsByUser", userId);
}

export async function grantEntitlement(params: {
  userId: string;
  code: string;
  source: string;
  expiresAt?: string | null;
}): Promise<AuthEntitlementRecord> {
  return callStore("grantEntitlement", params);
}

export async function revokeEntitlement(params: { userId: string; code: string }): Promise<void> {
  return callStore("revokeEntitlement", params);
}

export async function upsertOrder(params: {
  userId: string;
  provider: string;
  providerRef: string;
  status: string;
  amountMinor?: number;
  currency?: string;
}): Promise<AuthOrderRecord> {
  return callStore("upsertOrder", params);
}

export async function listOrdersByUser(userId: string): Promise<AuthOrderRecord[]> {
  return callStore("listOrdersByUser", userId);
}
