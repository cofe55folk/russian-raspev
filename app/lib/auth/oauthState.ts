import { createHmac, randomUUID, timingSafeEqual } from "crypto";

export type OAuthStateProvider = "yandex" | "vk";

type OAuthStatePayload = {
  provider: OAuthStateProvider;
  exp: number;
  nonce: string;
};

const OAUTH_STATE_TTL_SEC = 60 * 10;

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function getOAuthStateSecret(): string {
  const fromEnv = process.env.RR_AUTH_OAUTH_STATE_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== "production") {
    return "dev-oauth-state-secret-change-me";
  }
  throw new Error("RR_AUTH_OAUTH_STATE_SECRET is required in production");
}

function signPayload(rawPayload: string): string {
  return toBase64Url(createHmac("sha256", getOAuthStateSecret()).update(rawPayload).digest());
}

export function issueOAuthState(provider: OAuthStateProvider, ttlSec = OAUTH_STATE_TTL_SEC): string {
  const payload: OAuthStatePayload = {
    provider,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    nonce: randomUUID(),
  };
  const rawPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(rawPayload);
  return `${rawPayload}.${signature}`;
}

export function verifyOAuthState(token: string | null | undefined, provider: OAuthStateProvider): boolean {
  if (!token || typeof token !== "string") return false;
  const [rawPayload, signature] = token.split(".");
  if (!rawPayload || !signature) return false;

  const expected = signPayload(rawPayload);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  if (!timingSafeEqual(actualBuf, expectedBuf)) return false;

  try {
    const payload = JSON.parse(fromBase64Url(rawPayload).toString("utf8")) as OAuthStatePayload;
    if (payload.provider !== provider) return false;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}
