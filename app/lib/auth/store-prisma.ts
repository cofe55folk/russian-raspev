import { randomUUID } from "crypto";
import { prisma } from "../db/prisma";
import type {
  AuthEntitlementRecord,
  AuthOrderRecord,
  AuthSessionRecord,
  AuthUserRecord,
} from "./store-file";

function toUserRecord(input: {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AuthUserRecord {
  return {
    id: input.id,
    email: input.email,
    passwordHash: input.passwordHash,
    name: input.name ?? undefined,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
  };
}

function toSessionRecord(input: {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
}): AuthSessionRecord {
  return {
    id: input.id,
    userId: input.userId,
    createdAt: input.createdAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    lastSeenAt: input.lastSeenAt.toISOString(),
  };
}

function toEntitlementRecord(input: {
  id: string;
  userId: string;
  code: string;
  source: string;
  createdAt: Date;
  expiresAt: Date | null;
}): AuthEntitlementRecord {
  return {
    id: input.id,
    userId: input.userId,
    code: input.code,
    source: input.source,
    createdAt: input.createdAt.toISOString(),
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
  };
}

function toOrderRecord(input: {
  id: string;
  userId: string;
  provider: string;
  providerRef: string;
  status: string;
  amountMinor: number | null;
  currency: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AuthOrderRecord {
  return {
    id: input.id,
    userId: input.userId,
    provider: input.provider,
    providerRef: input.providerRef,
    status: input.status,
    amountMinor: input.amountMinor ?? undefined,
    currency: input.currency ?? undefined,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
  };
}

function parseIsoDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

export async function findUserByEmail(email: string): Promise<AuthUserRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.authUser.findUnique({
    where: { email: normalizedEmail },
  });
  return user ? toUserRecord(user) : null;
}

export async function findUserById(userId: string): Promise<AuthUserRecord | null> {
  const user = await prisma.authUser.findUnique({
    where: { id: userId },
  });
  return user ? toUserRecord(user) : null;
}

export async function upsertUserByEmail(params: {
  email: string;
  name?: string;
  passwordHash?: string;
}): Promise<AuthUserRecord> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const user = await prisma.authUser.upsert({
    where: { email: normalizedEmail },
    create: {
      email: normalizedEmail,
      passwordHash: params.passwordHash ?? "",
      name: params.name?.trim() || null,
    },
    update: {
      name: params.name?.trim() || undefined,
      passwordHash: params.passwordHash ?? undefined,
    },
  });
  return toUserRecord(user);
}

export async function createUser(params: {
  email: string;
  passwordHash: string;
  name?: string;
}): Promise<AuthUserRecord> {
  const user = await prisma.authUser.create({
    data: {
      email: params.email.trim().toLowerCase(),
      passwordHash: params.passwordHash,
      name: params.name?.trim() || null,
    },
  });
  return toUserRecord(user);
}

export async function updateUserCredentials(params: {
  userId: string;
  passwordHash?: string;
  name?: string;
}): Promise<AuthUserRecord | null> {
  const found = await prisma.authUser.findUnique({
    where: { id: params.userId },
    select: { id: true },
  });
  if (!found) return null;
  const user = await prisma.authUser.update({
    where: { id: params.userId },
    data: {
      passwordHash: params.passwordHash ?? undefined,
      name: params.name?.trim() || undefined,
    },
  });
  return toUserRecord(user);
}

export async function ensureUserForWebhook(params: {
  userId?: string;
  email?: string;
  name?: string;
}): Promise<AuthUserRecord | null> {
  if (params.userId) {
    const byId = await prisma.authUser.findUnique({
      where: { id: params.userId },
    });
    if (byId) return toUserRecord(byId);
  }
  if (params.email) {
    const normalizedEmail = params.email.trim().toLowerCase();
    const byEmail = await prisma.authUser.findUnique({
      where: { email: normalizedEmail },
    });
    if (byEmail) return toUserRecord(byEmail);
  }
  if (!params.email) return null;

  const created = await prisma.authUser.create({
    data: {
      id: params.userId?.trim() || randomUUID(),
      email: params.email.trim().toLowerCase(),
      passwordHash: "",
      name: params.name?.trim() || null,
    },
  });
  return toUserRecord(created);
}

export async function createSession(userId: string, ttlDays = 14): Promise<AuthSessionRecord> {
  const now = new Date();
  const created = await prisma.authSession.create({
    data: {
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000),
    },
  });
  return toSessionRecord(created);
}

export async function getSessionById(sessionId: string): Promise<AuthSessionRecord | null> {
  await prisma.authSession.deleteMany({
    where: {
      expiresAt: {
        lte: new Date(),
      },
    },
  });
  const session = await prisma.authSession.findUnique({
    where: { id: sessionId },
  });
  return session ? toSessionRecord(session) : null;
}

export async function touchSession(sessionId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId },
    data: { lastSeenAt: new Date() },
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { id: sessionId },
  });
}

export async function deleteSessionsByUser(userId: string): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { userId },
  });
}

export async function listEntitlementsByUser(userId: string): Promise<AuthEntitlementRecord[]> {
  const entitlements = await prisma.authEntitlement.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
  });
  return entitlements.map(toEntitlementRecord);
}

export async function grantEntitlement(params: {
  userId: string;
  code: string;
  source: string;
  expiresAt?: string | null;
}): Promise<AuthEntitlementRecord> {
  const entitlement = await prisma.authEntitlement.upsert({
    where: {
      userId_code: {
        userId: params.userId,
        code: params.code,
      },
    },
    create: {
      userId: params.userId,
      code: params.code,
      source: params.source,
      expiresAt: parseIsoDateOrNull(params.expiresAt),
    },
    update: {
      source: params.source,
      expiresAt: parseIsoDateOrNull(params.expiresAt),
    },
  });
  return toEntitlementRecord(entitlement);
}

export async function revokeEntitlement(params: { userId: string; code: string }): Promise<void> {
  await prisma.authEntitlement.deleteMany({
    where: {
      userId: params.userId,
      code: params.code,
    },
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
  const order = await prisma.authOrder.upsert({
    where: {
      userId_provider_providerRef: {
        userId: params.userId,
        provider: params.provider,
        providerRef: params.providerRef,
      },
    },
    create: {
      userId: params.userId,
      provider: params.provider,
      providerRef: params.providerRef,
      status: params.status,
      amountMinor: params.amountMinor ?? null,
      currency: params.currency ?? null,
    },
    update: {
      status: params.status,
      amountMinor: params.amountMinor ?? undefined,
      currency: params.currency ?? undefined,
    },
  });
  return toOrderRecord(order);
}

export async function listOrdersByUser(userId: string): Promise<AuthOrderRecord[]> {
  const orders = await prisma.authOrder.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }],
  });
  return orders.map(toOrderRecord);
}
