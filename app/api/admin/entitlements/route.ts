import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  ensureUserForWebhook,
  findUserByEmail,
  findUserById,
  grantEntitlement,
  listEntitlementsByUser,
  revokeEntitlement,
} from "../../../lib/auth/store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type EntitlementsPayload = {
  action?: "grant" | "revoke";
  userId?: string;
  email?: string;
  name?: string;
  code?: string;
  expiresAt?: string | null;
  source?: string;
};

function safeSecretCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function parseIsoOrNull(input: string | null | undefined): string | null {
  if (!input) return null;
  const ts = new Date(input).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`admin-entitlements:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const configuredSecret = process.env.RR_ADMIN_API_SECRET?.trim() || "";
  if (!configuredSecret) {
    return NextResponse.json({ error: "Admin API secret is not configured" }, { status: 503 });
  }
  const providedSecret = request.headers.get("x-rr-admin-secret")?.trim() || "";
  if (!providedSecret || !safeSecretCompare(providedSecret, configuredSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: EntitlementsPayload = {};
  try {
    payload = (await request.json()) as EntitlementsPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const action = payload.action;
  const code = payload.code?.trim();
  if ((action !== "grant" && action !== "revoke") || !code) {
    return NextResponse.json({ error: "Invalid action or code" }, { status: 400 });
  }

  const userById = payload.userId?.trim() ? await findUserById(payload.userId.trim()) : null;
  const userByEmail = payload.email?.trim() ? await findUserByEmail(payload.email.trim()) : null;
  const resolvedUser = userById || userByEmail;

  if (action === "grant") {
    const user = resolvedUser
      ? resolvedUser
      : await ensureUserForWebhook({
          userId: payload.userId?.trim(),
          email: payload.email?.trim(),
          name: payload.name?.trim(),
        });
    if (!user) {
      return NextResponse.json({ error: "User not found (provide userId or email)" }, { status: 400 });
    }

    await grantEntitlement({
      userId: user.id,
      code,
      source: payload.source?.trim() || "admin-api",
      expiresAt: parseIsoOrNull(payload.expiresAt),
    });
    const entitlements = await listEntitlementsByUser(user.id);
    return NextResponse.json({
      ok: true,
      action,
      user: {
        id: user.id,
        email: user.email,
      },
      entitlements,
    });
  }

  if (!resolvedUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await revokeEntitlement({
    userId: resolvedUser.id,
    code,
  });
  const entitlements = await listEntitlementsByUser(resolvedUser.id);
  return NextResponse.json({
    ok: true,
    action,
    user: {
      id: resolvedUser.id,
      email: resolvedUser.email,
    },
    entitlements,
  });
}
