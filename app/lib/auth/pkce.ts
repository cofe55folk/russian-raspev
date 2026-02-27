import { createHash, randomBytes } from "crypto";

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function generatePkceVerifier(byteLength = 48): string {
  return toBase64Url(randomBytes(byteLength));
}

export function generatePkceChallenge(verifier: string): string {
  return toBase64Url(createHash("sha256").update(verifier).digest());
}
