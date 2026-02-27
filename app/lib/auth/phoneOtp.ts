import { createHash, randomInt, timingSafeEqual } from "crypto";

type PhoneOtpEntry = {
  phone: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
};

const PHONE_OTP_STORE_KEY = "__rr_phone_otp_store_v1__";

function getStore(): Map<string, PhoneOtpEntry> {
  const globalAny = globalThis as { [PHONE_OTP_STORE_KEY]?: Map<string, PhoneOtpEntry> };
  if (!globalAny[PHONE_OTP_STORE_KEY]) {
    globalAny[PHONE_OTP_STORE_KEY] = new Map<string, PhoneOtpEntry>();
  }
  return globalAny[PHONE_OTP_STORE_KEY] as Map<string, PhoneOtpEntry>;
}

function getPhoneOtpSecret(): string {
  const fromEnv = process.env.RR_AUTH_PHONE_OTP_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const fallback = process.env.RR_AUTH_OAUTH_STATE_SECRET?.trim();
  if (fallback) return fallback;
  return "dev-phone-otp-secret-change-me";
}

function hashPhoneCode(phone: string, code: string): string {
  return createHash("sha256")
    .update(`${phone}:${code}:${getPhoneOtpSecret()}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function generateNumericCode(length: number): string {
  const size = Number.isFinite(length) && length > 0 ? Math.floor(length) : 6;
  let output = "";
  for (let index = 0; index < size; index += 1) {
    output += String(randomInt(0, 10));
  }
  return output;
}

export function createPhoneOtpChallenge(params: {
  phone: string;
  code: string;
  ttlSec: number;
  maxAttempts: number;
}): { expiresAt: string } {
  const ttlSec = Number.isFinite(params.ttlSec) && params.ttlSec > 0 ? Math.floor(params.ttlSec) : 300;
  const maxAttempts = Number.isFinite(params.maxAttempts) && params.maxAttempts > 0
    ? Math.floor(params.maxAttempts)
    : 5;
  const expiresAtTs = Date.now() + ttlSec * 1000;
  const entry: PhoneOtpEntry = {
    phone: params.phone,
    codeHash: hashPhoneCode(params.phone, params.code),
    expiresAt: expiresAtTs,
    attempts: 0,
    maxAttempts,
  };
  getStore().set(params.phone, entry);
  return {
    expiresAt: new Date(expiresAtTs).toISOString(),
  };
}

export function verifyPhoneOtpChallenge(params: {
  phone: string;
  code: string;
}): { ok: true } | { ok: false; reason: "not_found" | "expired" | "too_many_attempts" | "invalid_code" } {
  const store = getStore();
  const entry = store.get(params.phone);
  if (!entry) return { ok: false, reason: "not_found" };

  if (Date.now() > entry.expiresAt) {
    store.delete(params.phone);
    return { ok: false, reason: "expired" };
  }
  if (entry.attempts >= entry.maxAttempts) {
    store.delete(params.phone);
    return { ok: false, reason: "too_many_attempts" };
  }

  const incomingHash = hashPhoneCode(params.phone, params.code);
  if (!safeEqual(incomingHash, entry.codeHash)) {
    entry.attempts += 1;
    store.set(params.phone, entry);
    if (entry.attempts >= entry.maxAttempts) {
      store.delete(params.phone);
      return { ok: false, reason: "too_many_attempts" };
    }
    return { ok: false, reason: "invalid_code" };
  }

  store.delete(params.phone);
  return { ok: true };
}
