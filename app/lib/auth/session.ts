import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  deleteSession,
  findUserById,
  getSessionById,
  listEntitlementsByUser,
  touchSession,
} from "./store";

export const AUTH_SESSION_COOKIE = "rr_auth_session_v1";
const AUTH_SESSION_TTL_SEC = 60 * 60 * 24 * 14;

export type AuthEntitlement = {
  code: string;
  expiresAt?: string | null;
};

export type AuthSession = {
  sessionId?: string;
  userId: string;
  email?: string;
  name?: string;
  entitlements: AuthEntitlement[];
};

type SessionResolveOptions = {
  touch?: boolean;
};

function normalizeEntitlement(input: unknown): AuthEntitlement | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { code?: unknown; expiresAt?: unknown };
  if (typeof raw.code !== "string" || !raw.code.trim()) return null;
  if (raw.expiresAt == null) return { code: raw.code };
  if (typeof raw.expiresAt === "string") return { code: raw.code, expiresAt: raw.expiresAt };
  return null;
}

function normalizeSession(input: unknown): AuthSession | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as {
    sessionId?: unknown;
    userId?: unknown;
    email?: unknown;
    name?: unknown;
    entitlements?: unknown;
  };
  if (typeof raw.userId !== "string" || !raw.userId.trim()) return null;
  const entitlements = Array.isArray(raw.entitlements)
    ? raw.entitlements.map(normalizeEntitlement).filter((item): item is AuthEntitlement => !!item)
    : [];
  return {
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    userId: raw.userId,
    email: typeof raw.email === "string" ? raw.email : undefined,
    name: typeof raw.name === "string" ? raw.name : undefined,
    entitlements,
  };
}

function parseLegacySessionRaw(raw: string | undefined): AuthSession | null {
  if (!raw || !raw.startsWith("{")) return null;
  try {
    return normalizeSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function isEntitlementActive(item: AuthEntitlement): boolean {
  if (!item.expiresAt) return true;
  const ts = new Date(item.expiresAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return ts > Date.now();
}

async function resolveSessionById(sessionId: string, options?: SessionResolveOptions): Promise<AuthSession | null> {
  const trimmed = sessionId.trim();
  if (!trimmed) return null;

  const session = await getSessionById(trimmed);
  if (!session) return null;

  const user = await findUserById(session.userId);
  if (!user) {
    await deleteSession(trimmed);
    return null;
  }

  if (options?.touch !== false) {
    await touchSession(trimmed);
  }

  const entitlements = (await listEntitlementsByUser(user.id))
    .map((item) => ({
      code: item.code,
      expiresAt: item.expiresAt ?? null,
    }))
    .filter((item) => isEntitlementActive(item));

  return {
    sessionId: trimmed,
    userId: user.id,
    email: user.email || undefined,
    name: user.name || undefined,
    entitlements,
  };
}

export function readAuthSessionIdFromRequest(request: NextRequest): string | null {
  const raw = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  if (!raw || raw.startsWith("{")) return null;
  return raw;
}

export async function readAuthSessionIdFromCookieStore(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(AUTH_SESSION_COOKIE)?.value;
  if (!raw || raw.startsWith("{")) return null;
  return raw;
}

export async function readAuthSessionFromRequest(request: NextRequest): Promise<AuthSession | null> {
  const raw = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  const legacy = parseLegacySessionRaw(raw);
  if (legacy) return legacy;
  if (!raw) return null;
  return resolveSessionById(raw);
}

export async function readAuthSessionFromCookieStore(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(AUTH_SESSION_COOKIE)?.value;
  const legacy = parseLegacySessionRaw(raw);
  if (legacy) return legacy;
  if (!raw) return null;
  return resolveSessionById(raw, { touch: false });
}

export async function createAuthSessionForUser(userId: string): Promise<string> {
  const session = await createSession(userId);
  return session.id;
}

export function attachAuthSessionCookie(response: NextResponse, sessionId: string): void {
  response.cookies.set(AUTH_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_SESSION_TTL_SEC,
  });
}

export function clearAuthSessionCookie(response: NextResponse): void {
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function revokeAuthSessionFromRequest(request: NextRequest): Promise<void> {
  const sessionId = readAuthSessionIdFromRequest(request);
  if (!sessionId) return;
  await deleteSession(sessionId);
}

export function sessionHasEntitlement(session: AuthSession | null, entitlementCode: string | null): boolean {
  if (!entitlementCode) return true;
  if (!session) return false;
  return session.entitlements.some((item) => item.code === entitlementCode && isEntitlementActive(item));
}
