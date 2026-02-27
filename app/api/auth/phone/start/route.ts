import { NextResponse, type NextRequest } from "next/server";
import {
  allowPhoneDebugCode,
  getPhoneAuthProvider,
  getPhoneOtpCodeLength,
  getPhoneOtpMaxAttempts,
  getPhoneOtpTtlSec,
  isPhoneAuthEnabled,
  normalizePhoneE164,
} from "../../../../lib/auth/phone";
import { createPhoneOtpChallenge, generateNumericCode } from "../../../../lib/auth/phoneOtp";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type PhoneStartPayload = {
  phone?: string;
};

export async function POST(request: NextRequest) {
  if (!isPhoneAuthEnabled()) {
    return NextResponse.json({ error: "Phone auth is disabled" }, { status: 503 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`auth-phone-start-ip:${ip}`, 12, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: PhoneStartPayload = {};
  try {
    payload = (await request.json()) as PhoneStartPayload;
  } catch {}

  const phone = normalizePhoneE164(payload.phone);
  if (!phone) {
    return NextResponse.json({ error: "Invalid phone number (expected E.164)" }, { status: 400 });
  }
  if (!allowRateLimit(`auth-phone-start-phone:${phone}`, 5, 5 * 60_000)) {
    return NextResponse.json({ error: "Too many OTP requests for this phone" }, { status: 429 });
  }

  const provider = getPhoneAuthProvider();
  if (provider !== "mock") {
    return NextResponse.json({ error: "Phone provider is not implemented yet" }, { status: 501 });
  }

  const code = generateNumericCode(getPhoneOtpCodeLength());
  const challenge = createPhoneOtpChallenge({
    phone,
    code,
    ttlSec: getPhoneOtpTtlSec(),
    maxAttempts: getPhoneOtpMaxAttempts(),
  });

  return NextResponse.json({
    ok: true,
    provider,
    phone,
    expiresAt: challenge.expiresAt,
    ...(allowPhoneDebugCode() ? { debugCode: code } : {}),
  });
}
