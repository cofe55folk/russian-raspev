import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { hashPassword } from "../../../../lib/auth/password";
import { attachAuthSessionCookie, createAuthSessionForUser } from "../../../../lib/auth/session";
import { buildPhoneShadowEmail, isPhoneAuthEnabled, normalizePhoneE164 } from "../../../../lib/auth/phone";
import { verifyPhoneOtpChallenge } from "../../../../lib/auth/phoneOtp";
import { findUserByEmail, upsertUserByEmail } from "../../../../lib/auth/store";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type PhoneVerifyPayload = {
  phone?: string;
  code?: string;
  name?: string;
};

function resolveVerifyFailureStatus(reason: "not_found" | "expired" | "too_many_attempts" | "invalid_code"): number {
  if (reason === "too_many_attempts") return 429;
  if (reason === "expired") return 410;
  return 401;
}

export async function POST(request: NextRequest) {
  if (!isPhoneAuthEnabled()) {
    return NextResponse.json({ error: "Phone auth is disabled" }, { status: 503 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`auth-phone-verify-ip:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: PhoneVerifyPayload = {};
  try {
    payload = (await request.json()) as PhoneVerifyPayload;
  } catch {}

  const phone = normalizePhoneE164(payload.phone);
  if (!phone) {
    return NextResponse.json({ error: "Invalid phone number (expected E.164)" }, { status: 400 });
  }

  const code = payload.code?.trim() || "";
  if (!/^\d{4,8}$/.test(code)) {
    return NextResponse.json({ error: "Invalid verification code format" }, { status: 400 });
  }

  const verifyResult = verifyPhoneOtpChallenge({ phone, code });
  if (!verifyResult.ok) {
    return NextResponse.json({ error: `Phone code verification failed: ${verifyResult.reason}` }, {
      status: resolveVerifyFailureStatus(verifyResult.reason),
    });
  }

  const shadowEmail = buildPhoneShadowEmail(phone);
  const existingUser = await findUserByEmail(shadowEmail);
  const user = await upsertUserByEmail({
    email: shadowEmail,
    name: payload.name?.trim() || existingUser?.name || `Phone ${phone}`,
    passwordHash: existingUser?.passwordHash || hashPassword(randomUUID()),
  });

  const sessionId = await createAuthSessionForUser(user.id);
  const response = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name || null,
      phone,
    },
  });
  attachAuthSessionCookie(response, sessionId);
  return response;
}
