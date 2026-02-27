import { createHash } from "crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_PATH = path.join(process.cwd(), "data", "billing", "webhook-replay-store.json");
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

type ReplayStore = {
  version: 1;
  updatedAt: string;
  seen: Record<string, string>;
};

let writeQueue: Promise<void> = Promise.resolve();

export async function consumeBillingWebhookReplayKey(rawKey: string): Promise<{ duplicate: boolean }> {
  const key = normalizeKey(rawKey);
  if (!key) return { duplicate: false };

  let duplicate = false;
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    const nowTs = Date.now();
    pruneExpired(store, nowTs);
    if (store.seen[key]) {
      duplicate = true;
      store.updatedAt = new Date(nowTs).toISOString();
      await writeStore(store);
      return;
    }
    store.seen[key] = new Date(nowTs).toISOString();
    store.updatedAt = new Date(nowTs).toISOString();
    await writeStore(store);
  });

  await writeQueue;
  return { duplicate };
}

function normalizeKey(rawKey: string): string | null {
  const trimmed = rawKey.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed).digest("hex");
}

async function readStore(): Promise<ReplayStore> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ReplayStore>;
    if (!parsed || typeof parsed !== "object") return createEmptyStore();
    const seen = parsed.seen && typeof parsed.seen === "object" ? normalizeSeen(parsed.seen as Record<string, unknown>) : {};
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      seen,
    };
  } catch {
    return createEmptyStore();
  }
}

function normalizeSeen(raw: Record<string, unknown>): Record<string, string> {
  const seen: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[a-f0-9]{64}$/.test(key)) continue;
    if (typeof value !== "string") continue;
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) continue;
    seen[key] = new Date(ts).toISOString();
  }
  return seen;
}

function pruneExpired(store: ReplayStore, nowTs: number): void {
  for (const [key, value] of Object.entries(store.seen)) {
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts) || nowTs - ts > MAX_AGE_MS) {
      delete store.seen[key];
    }
  }
}

async function writeStore(store: ReplayStore): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, STORE_PATH);
}

function createEmptyStore(): ReplayStore {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    seen: {},
  };
}
