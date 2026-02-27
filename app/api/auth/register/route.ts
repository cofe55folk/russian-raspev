import { NextResponse, type NextRequest } from "next/server";
import {
  attachAuthSessionCookie,
  createAuthSessionForUser,
} from "../../../lib/auth/session";
import { hashPassword } from "../../../lib/auth/password";
import {
  createUser,
  findUserByEmail,
  updateUserCredentials,
} from "../../../lib/auth/store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type RegisterPayload = {
  email?: string;
  password?: string;
  name?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`auth-register:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: RegisterPayload = {};
  try {
    payload = (await request.json()) as RegisterPayload;
  } catch {}

  const email = payload.email?.trim().toLowerCase() || "";
  const password = payload.password || "";
  const name = payload.name?.trim() || undefined;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await findUserByEmail(email);
  const passwordHash = hashPassword(password);

  let userId: string;
  if (existing) {
    if (existing.passwordHash) {
      return NextResponse.json({ error: "Email is already registered" }, { status: 409 });
    }
    const updated = await updateUserCredentials({
      userId: existing.id,
      passwordHash,
      name,
    });
    if (!updated) {
      return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
    userId = updated.id;
  } else {
    const created = await createUser({
      email,
      passwordHash,
      name,
    });
    userId = created.id;
  }

  const sessionId = await createAuthSessionForUser(userId);
  const response = NextResponse.json({
    ok: true,
    user: {
      id: userId,
      email,
      name: name || null,
    },
  });
  attachAuthSessionCookie(response, sessionId);
  return response;
}
