import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  attachAuthSessionCookie,
  createAuthSessionForUser,
} from "../../../lib/auth/session";
import { hashPassword } from "../../../lib/auth/password";
import { findUserByEmail, grantEntitlement, upsertUserByEmail } from "../../../lib/auth/store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type DevLoginPayload = {
  userId?: string;
  email?: string;
  name?: string;
  entitlements?: string[];
  premiumTrackSlugs?: string[];
};

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`dev-login:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let payload: DevLoginPayload = {};
  try {
    payload = (await request.json()) as DevLoginPayload;
  } catch {}

  const explicitEntitlements = Array.isArray(payload.entitlements)
    ? payload.entitlements.filter((item): item is string => typeof item === "string" && !!item.trim())
    : [];
  const premiumTrackEntitlements = Array.isArray(payload.premiumTrackSlugs)
    ? payload.premiumTrackSlugs
        .filter((item): item is string => typeof item === "string" && !!item.trim())
        .map((slug) => `sound:${slug}:premium-tracks`)
    : [];
  const dedupedCodes = Array.from(new Set([...explicitEntitlements, ...premiumTrackEntitlements]));

  const email = payload.email?.trim() || `dev-${Date.now()}@example.com`;
  const existingUser = await findUserByEmail(email);
  const user = await upsertUserByEmail({
    email,
    name: payload.name?.trim() || "Dev User",
    passwordHash: existingUser?.passwordHash || hashPassword(randomUUID()),
  });

  await Promise.all(
    dedupedCodes.map((code) =>
      grantEntitlement({
        userId: user.id,
        code,
        source: "dev-login",
      })
    )
  );

  const sessionId = await createAuthSessionForUser(user.id);
  const response = NextResponse.json({
    ok: true,
    sessionId,
    user: {
      id: user.id,
      email: user.email,
      name: user.name || null,
    },
    grantedEntitlements: dedupedCodes,
  });
  attachAuthSessionCookie(response, sessionId);
  return response;
}
