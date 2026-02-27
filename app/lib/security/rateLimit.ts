import fs from "node:fs";
import path from "node:path";

type Bucket = {
  count: number;
  resetAt: number;
};

type PersistedRateLimitStore = {
  version: 1;
  updatedAt: number;
  buckets: Record<string, Bucket>;
};

const GLOBAL_BUCKETS_KEY = "__rr_rate_limit_buckets_v1__";
const DEFAULT_SHARED_FILE_PATH = path.join(process.cwd(), "tmp", "rate-limit-store.json");
const FILE_LOCK_SUFFIX = ".lockdir";
const STORE_VERSION = 1 as const;
const MAX_BUCKETS = 25_000;
const DEFAULT_LOCK_WAIT_MS = 8;

type RateLimitBackend = "memory" | "file";

function getBackend(): RateLimitBackend {
  return process.env.RR_RATE_LIMIT_BACKEND === "file" ? "file" : "memory";
}

function getBuckets(): Map<string, Bucket> {
  const globalAny = globalThis as { [GLOBAL_BUCKETS_KEY]?: Map<string, Bucket> };
  if (!globalAny[GLOBAL_BUCKETS_KEY]) {
    globalAny[GLOBAL_BUCKETS_KEY] = new Map<string, Bucket>();
  }
  return globalAny[GLOBAL_BUCKETS_KEY] as Map<string, Bucket>;
}

function applyRateLimitToMap(map: Map<string, Bucket>, key: string, limit: number, windowMs: number, now: number): boolean {
  const current = map.get(key);
  if (!current || now >= current.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  map.set(key, { count: current.count + 1, resetAt: current.resetAt });
  return true;
}

function allowRateLimitMemory(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const buckets = getBuckets();
  return applyRateLimitToMap(buckets, key, limit, windowMs, now);
}

function normalizeBucket(input: unknown): Bucket | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<Bucket>;
  const count = Number(raw.count);
  const resetAt = Number(raw.resetAt);
  if (!Number.isFinite(count) || count < 0) return null;
  if (!Number.isFinite(resetAt) || resetAt <= 0) return null;
  return {
    count: Math.floor(count),
    resetAt: Math.floor(resetAt),
  };
}

function readPersistedStore(filePath: string): PersistedRateLimitStore {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedRateLimitStore>;
    const bucketsRaw =
      parsed && typeof parsed === "object" && parsed.buckets && typeof parsed.buckets === "object"
        ? (parsed.buckets as Record<string, unknown>)
        : {};
    const buckets: Record<string, Bucket> = {};
    for (const [k, v] of Object.entries(bucketsRaw)) {
      const normalized = normalizeBucket(v);
      if (!normalized) continue;
      buckets[k] = normalized;
    }
    return {
      version: STORE_VERSION,
      updatedAt: Date.now(),
      buckets,
    };
  } catch {
    return {
      version: STORE_VERSION,
      updatedAt: Date.now(),
      buckets: {},
    };
  }
}

function writePersistedStore(filePath: string, store: PersistedRateLimitStore): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(store)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function sleepMsBusy(waitMs: number): void {
  const end = Date.now() + Math.max(0, waitMs);
  while (Date.now() < end) {
    // busy wait for a very short bounded window
  }
}

function withFileLock<T>(lockPath: string, run: () => T): T | null {
  const waitMsRaw = Number(process.env.RR_RATE_LIMIT_LOCK_WAIT_MS);
  const waitMs = Number.isFinite(waitMsRaw) ? Math.max(0, Math.floor(waitMsRaw)) : DEFAULT_LOCK_WAIT_MS;
  const deadline = Date.now() + waitMs;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch {
      if (Date.now() >= deadline) return null;
      sleepMsBusy(1);
    }
  }

  try {
    return run();
  } finally {
    try {
      fs.rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // ignore lock cleanup failures
    }
  }
}

function allowRateLimitFile(key: string, limit: number, windowMs: number): boolean | null {
  const filePath = process.env.RR_RATE_LIMIT_FILE_PATH?.trim() || DEFAULT_SHARED_FILE_PATH;
  const lockPath = `${filePath}${FILE_LOCK_SUFFIX}`;
  const locked = withFileLock(lockPath, () => {
    const now = Date.now();
    const store = readPersistedStore(filePath);
    const buckets = new Map<string, Bucket>(Object.entries(store.buckets));

    for (const [bucketKey, bucket] of buckets.entries()) {
      if (now >= bucket.resetAt) buckets.delete(bucketKey);
    }

    const allowed = applyRateLimitToMap(buckets, key, limit, windowMs, now);

    // Prevent unbounded growth in case of key-cardinality spikes.
    if (buckets.size > MAX_BUCKETS) {
      const entries = Array.from(buckets.entries()).sort((a, b) => a[1].resetAt - b[1].resetAt);
      const toDrop = entries.length - MAX_BUCKETS;
      for (let i = 0; i < toDrop; i += 1) {
        buckets.delete(entries[i][0]);
      }
    }

    store.updatedAt = now;
    store.buckets = Object.fromEntries(buckets.entries());
    writePersistedStore(filePath, store);
    return allowed;
  });

  return locked;
}

function normalizeRateLimitKey(input: string): string {
  const normalized = String(input || "").trim();
  if (!normalized) return "__empty__";
  return normalized.slice(0, 240);
}

export function allowRateLimit(key: string, limit: number, windowMs: number): boolean {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  const safeWindowMs = Number.isFinite(windowMs) ? Math.max(1, Math.floor(windowMs)) : 1;
  const normalizedKey = normalizeRateLimitKey(key);

  if (getBackend() === "file") {
    const sharedResult = allowRateLimitFile(normalizedKey, safeLimit, safeWindowMs);
    if (typeof sharedResult === "boolean") return sharedResult;
  }
  return allowRateLimitMemory(normalizedKey, safeLimit, safeWindowMs);
}
