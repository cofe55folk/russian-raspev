import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const METRICS_PATH = path.join(process.cwd(), "data", "billing", "webhook-observability.json");

type BillingWebhookAuthMode = "signature" | "legacy-secret" | "unknown";

type BillingWebhookMetricsStore = {
  version: 1;
  updatedAt: string;
  totals: {
    requests: number;
    replayDuplicates: number;
    signatureFailures: number;
  };
  rates: {
    replayDuplicateRate: number;
    signatureFailRate: number;
  };
  reasonCounts: Record<string, number>;
  authModeCounts: Record<BillingWebhookAuthMode, number>;
};

const SIGNATURE_FAILURE_REASON_CODES = new Set([
  "auth_invalid_signature_format",
  "auth_invalid_signature_timestamp",
  "auth_signature_timestamp_out_of_window",
  "auth_signature_mismatch",
]);

let writeQueue: Promise<void> = Promise.resolve();

export async function recordBillingWebhookMetric(params: {
  reasonCode: string;
  authMode?: BillingWebhookAuthMode;
}): Promise<void> {
  const reasonCode = normalizeReasonCode(params.reasonCode);
  if (!reasonCode) return;
  const authMode = normalizeAuthMode(params.authMode);

  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    store.totals.requests += 1;
    store.reasonCounts[reasonCode] = (store.reasonCounts[reasonCode] || 0) + 1;
    store.authModeCounts[authMode] = (store.authModeCounts[authMode] || 0) + 1;

    if (reasonCode === "replay_duplicate") {
      store.totals.replayDuplicates += 1;
    }
    if (SIGNATURE_FAILURE_REASON_CODES.has(reasonCode)) {
      store.totals.signatureFailures += 1;
    }

    store.rates.replayDuplicateRate = roundRate(store.totals.replayDuplicates, store.totals.requests);
    store.rates.signatureFailRate = roundRate(store.totals.signatureFailures, store.totals.requests);
    store.updatedAt = new Date().toISOString();
    await writeStore(store);
  });

  await writeQueue;
}

function normalizeReasonCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  return value.slice(0, 80);
}

function normalizeAuthMode(raw: BillingWebhookAuthMode | undefined): BillingWebhookAuthMode {
  if (raw === "signature") return "signature";
  if (raw === "legacy-secret") return "legacy-secret";
  return "unknown";
}

function roundRate(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1_000_000) / 1_000_000;
}

async function readStore(): Promise<BillingWebhookMetricsStore> {
  try {
    const raw = await readFile(METRICS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<BillingWebhookMetricsStore>;
    if (!parsed || typeof parsed !== "object") return createEmptyStore();
    const requests = sanitizeCount(parsed.totals?.requests);
    const replayDuplicates = sanitizeCount(parsed.totals?.replayDuplicates);
    const signatureFailures = sanitizeCount(parsed.totals?.signatureFailures);
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      totals: {
        requests,
        replayDuplicates,
        signatureFailures,
      },
      rates: {
        replayDuplicateRate: roundRate(replayDuplicates, requests),
        signatureFailRate: roundRate(signatureFailures, requests),
      },
      reasonCounts: normalizeReasonCounts(parsed.reasonCounts),
      authModeCounts: normalizeAuthModeCounts(parsed.authModeCounts),
    };
  } catch {
    return createEmptyStore();
  }
}

async function writeStore(store: BillingWebhookMetricsStore): Promise<void> {
  await mkdir(path.dirname(METRICS_PATH), { recursive: true });
  const tmp = `${METRICS_PATH}.tmp-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, METRICS_PATH);
}

function sanitizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normalizeReasonCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    const reason = normalizeReasonCode(key);
    if (!reason) continue;
    const normalizedCount = sanitizeCount(count);
    if (normalizedCount <= 0) continue;
    output[reason] = normalizedCount;
  }
  return output;
}

function normalizeAuthModeCounts(value: unknown): Record<BillingWebhookAuthMode, number> {
  const defaults: Record<BillingWebhookAuthMode, number> = {
    signature: 0,
    "legacy-secret": 0,
    unknown: 0,
  };
  if (!value || typeof value !== "object") return defaults;
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    const authMode = normalizeAuthMode(key as BillingWebhookAuthMode);
    defaults[authMode] += sanitizeCount(count);
  }
  return defaults;
}

function createEmptyStore(): BillingWebhookMetricsStore {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    totals: {
      requests: 0,
      replayDuplicates: 0,
      signatureFailures: 0,
    },
    rates: {
      replayDuplicateRate: 0,
      signatureFailRate: 0,
    },
    reasonCounts: {},
    authModeCounts: {
      signature: 0,
      "legacy-secret": 0,
      unknown: 0,
    },
  };
}
