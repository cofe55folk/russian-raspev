import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const DEAD_LETTER_PATH = path.join(process.cwd(), "data", "billing", "webhook-dead-letter.jsonl");
let writeQueue: Promise<void> = Promise.resolve();

type BillingWebhookDeadLetterParams = {
  reason: string;
  ip?: string;
  provider?: string;
  providerRef?: string;
  action?: string;
  entitlementCode?: string;
  userId?: string;
  email?: string;
  rawPayload?: string;
};

type PayloadMeta = {
  payloadDigest?: string;
  payloadBytes?: number;
  payloadTopLevelKeys?: string[];
};

function sanitizeText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function extractPayloadMeta(rawPayload: string | undefined): PayloadMeta {
  const payload = sanitizeText(rawPayload, 200_000);
  if (!payload) return {};
  const payloadBytes = Buffer.byteLength(payload, "utf8");
  const payloadDigest = createHash("sha256").update(payload).digest("hex");

  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { payloadDigest, payloadBytes };
    }
    const payloadTopLevelKeys = Object.keys(parsed as Record<string, unknown>)
      .slice(0, 24)
      .map((key) => sanitizeText(key, 64))
      .filter((key): key is string => !!key);
    return { payloadDigest, payloadBytes, payloadTopLevelKeys };
  } catch {
    return { payloadDigest, payloadBytes };
  }
}

export async function appendBillingWebhookDeadLetter(params: BillingWebhookDeadLetterParams): Promise<void> {
  const payloadMeta = extractPayloadMeta(params.rawPayload);
  const entry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    reason: sanitizeText(params.reason, 120) || "unknown",
    ip: sanitizeText(params.ip, 80),
    provider: sanitizeText(params.provider, 60),
    providerRef: sanitizeText(params.providerRef, 120),
    action: sanitizeText(params.action, 24),
    entitlementCode: sanitizeText(params.entitlementCode, 120),
    userId: sanitizeText(params.userId, 120),
    email: sanitizeText(params.email, 180),
    ...payloadMeta,
  };

  writeQueue = writeQueue
    .then(async () => {
      await fs.mkdir(path.dirname(DEAD_LETTER_PATH), { recursive: true });
      await fs.appendFile(DEAD_LETTER_PATH, `${JSON.stringify(entry)}\n`, "utf8");
    })
    .catch(() => undefined);

  await writeQueue;
}
