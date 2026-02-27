import { createHmac, timingSafeEqual } from "crypto";
import { isAllowedMediaSourcePath } from "./sourcePolicy";

type MediaTokenPayload = {
  src: string;
  exp: number;
  entitlementCode?: string;
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function getSigningSecret(): string {
  return process.env.RR_MEDIA_TOKEN_SECRET || process.env.NEXTAUTH_SECRET || "rr-dev-media-secret";
}

function signRaw(payloadEncoded: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadEncoded).digest("base64url");
}

export function issueMediaAccessToken(payload: MediaTokenPayload): string {
  const secret = getSigningSecret();
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const sig = signRaw(payloadEncoded, secret);
  return `${payloadEncoded}.${sig}`;
}

export function verifyMediaAccessToken(token: string): MediaTokenPayload | null {
  const secret = getSigningSecret();
  const [payloadEncoded, providedSig] = token.split(".");
  if (!payloadEncoded || !providedSig) return null;

  const expectedSig = signRaw(payloadEncoded, secret);
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payloadEncoded)) as Partial<MediaTokenPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.src !== "string" || !isAllowedMediaSourcePath(parsed.src)) return null;
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
    if (parsed.entitlementCode != null && typeof parsed.entitlementCode !== "string") return null;
    return {
      src: parsed.src,
      exp: parsed.exp,
      entitlementCode: parsed.entitlementCode,
    };
  } catch {
    return null;
  }
}
