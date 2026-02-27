import { NextResponse, type NextRequest } from "next/server";
import {
  attachAuthSessionCookie,
  createAuthSessionForUser,
} from "../../../lib/auth/session";
import { verifyPassword } from "../../../lib/auth/password";
import { findUserByEmail } from "../../../lib/auth/store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type LoginPayload = {
  email?: string;
  password?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`auth-login:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: LoginPayload = {};
  try {
    payload = (await request.json()) as LoginPayload;
  } catch {}

  const email = payload.email?.trim().toLowerCase() || "";
  const password = payload.password || "";
  if (!EMAIL_RE.test(email) || !password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const sessionId = await createAuthSessionForUser(user.id);
  const response = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name || null,
    },
  });
  attachAuthSessionCookie(response, sessionId);
  return response;
}
