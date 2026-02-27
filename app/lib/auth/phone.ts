export type PhoneAuthProvider = "mock" | "twilio" | "smsc" | "other";

const E164_RE = /^\+[1-9]\d{9,14}$/;

function readPositiveInt(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function isPhoneAuthEnabled(): boolean {
  return process.env.RR_AUTH_PHONE_ENABLED === "true";
}

export function getPhoneAuthProvider(): PhoneAuthProvider {
  const raw = process.env.RR_AUTH_PHONE_PROVIDER?.trim().toLowerCase();
  if (raw === "mock" || raw === "twilio" || raw === "smsc") return raw;
  return "other";
}

export function getPhoneOtpTtlSec(): number {
  return readPositiveInt("RR_AUTH_PHONE_OTP_TTL_SEC", 300);
}

export function getPhoneOtpCodeLength(): number {
  return readPositiveInt("RR_AUTH_PHONE_CODE_LENGTH", 6);
}

export function getPhoneOtpMaxAttempts(): number {
  return readPositiveInt("RR_AUTH_PHONE_MAX_ATTEMPTS", 5);
}

export function allowPhoneDebugCode(): boolean {
  return process.env.RR_AUTH_PHONE_ALLOW_DEBUG_CODE === "true" && process.env.NODE_ENV !== "production";
}

export function normalizePhoneE164(rawPhone: string | undefined | null): string | null {
  if (!rawPhone) return null;
  let value = rawPhone.trim();
  value = value.replace(/[()\-\s]/g, "");
  if (!value) return null;

  // Russian local format fallback: 8XXXXXXXXXX -> +7XXXXXXXXXX
  if (/^8\d{10}$/.test(value)) {
    value = `+7${value.slice(1)}`;
  } else if (/^\d{10,15}$/.test(value)) {
    value = `+${value}`;
  }

  if (!E164_RE.test(value)) return null;
  return value;
}

export function buildPhoneShadowEmail(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  return `phone+${digits}@phone.local`;
}
