import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SCRYPT_KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEY_LEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algo, salt, storedHash] = encoded.split(":");
  if (algo !== "scrypt" || !salt || !storedHash) return false;
  const computedHash = scryptSync(password, salt, SCRYPT_KEY_LEN).toString("hex");
  const storedBuf = Buffer.from(storedHash, "hex");
  const computedBuf = Buffer.from(computedHash, "hex");
  if (storedBuf.length !== computedBuf.length) return false;
  return timingSafeEqual(storedBuf, computedBuf);
}
