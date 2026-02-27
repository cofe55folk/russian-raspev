import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const DONATION_DB_PATH = path.join(process.cwd(), "data", "donations", "ledger.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type DonationStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | "refunded";
export type DonationInterval = "once" | "monthly";

export type DonationStatusTransition = {
  status: DonationStatus;
  source: string;
  reason?: string;
  at: string;
};

export type DonationRecord = {
  id: string;
  provider: string;
  providerRef: string;
  status: DonationStatus;
  amountMinor: number;
  currency: string;
  interval: DonationInterval;
  userId?: string;
  anonymousId?: string;
  source: string;
  returnPath?: string;
  checkoutUrl?: string;
  createdAt: string;
  updatedAt: string;
  history: DonationStatusTransition[];
};

type DonationDb = {
  records: DonationRecord[];
};

const EMPTY_DB: DonationDb = {
  records: [],
};

function normalizeStatus(value: unknown): DonationStatus | null {
  if (value === "pending") return "pending";
  if (value === "requires_action") return "requires_action";
  if (value === "succeeded") return "succeeded";
  if (value === "failed") return "failed";
  if (value === "canceled") return "canceled";
  if (value === "refunded") return "refunded";
  return null;
}

function normalizeInterval(value: unknown): DonationInterval | null {
  if (value === "once") return "once";
  if (value === "monthly") return "monthly";
  return null;
}

function normalizeRecord(value: unknown): DonationRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DonationRecord>;
  const status = normalizeStatus(raw.status);
  const interval = normalizeInterval(raw.interval);
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.provider !== "string" ||
    !raw.provider ||
    typeof raw.providerRef !== "string" ||
    !raw.providerRef ||
    !status ||
    !interval ||
    typeof raw.amountMinor !== "number" ||
    !Number.isFinite(raw.amountMinor) ||
    typeof raw.currency !== "string" ||
    !raw.currency ||
    typeof raw.source !== "string" ||
    !raw.source ||
    typeof raw.createdAt !== "string" ||
    !raw.createdAt ||
    typeof raw.updatedAt !== "string" ||
    !raw.updatedAt ||
    !Array.isArray(raw.history)
  ) {
    return null;
  }
  const history = raw.history
    .map((row): DonationStatusTransition | null => {
      if (!row || typeof row !== "object") return null;
      const transition = row as Partial<DonationStatusTransition>;
      const nextStatus = normalizeStatus(transition.status);
      if (!nextStatus || typeof transition.source !== "string" || typeof transition.at !== "string") return null;
      return {
        status: nextStatus,
        source: transition.source,
        reason: typeof transition.reason === "string" && transition.reason.trim() ? transition.reason : undefined,
        at: transition.at,
      };
    })
    .filter((item): item is DonationStatusTransition => item !== null);

  return {
    id: raw.id,
    provider: raw.provider,
    providerRef: raw.providerRef,
    status,
    amountMinor: Math.max(0, Math.floor(raw.amountMinor)),
    currency: raw.currency.trim().toUpperCase() || "RUB",
    interval,
    userId: typeof raw.userId === "string" && raw.userId.trim() ? raw.userId : undefined,
    anonymousId: typeof raw.anonymousId === "string" && raw.anonymousId.trim() ? raw.anonymousId : undefined,
    source: raw.source,
    returnPath: typeof raw.returnPath === "string" && raw.returnPath.trim() ? raw.returnPath : undefined,
    checkoutUrl: typeof raw.checkoutUrl === "string" && raw.checkoutUrl.trim() ? raw.checkoutUrl : undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    history,
  };
}

function normalizeDb(value: unknown): DonationDb {
  if (!value || typeof value !== "object") return { ...EMPTY_DB, records: [] };
  const raw = value as Partial<DonationDb>;
  return {
    records: Array.isArray(raw.records)
      ? raw.records.map(normalizeRecord).filter((item): item is DonationRecord => !!item)
      : [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(DONATION_DB_PATH), { recursive: true });
}

async function readDb(): Promise<DonationDb> {
  try {
    const raw = await fs.readFile(DONATION_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, records: [] };
  }
}

async function writeDb(db: DonationDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${DONATION_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, DONATION_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: DonationDb) => Promise<T> | T): Promise<T> {
  const previous = mutationQueue;
  let unlock: () => void = () => {};
  mutationQueue = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  try {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  } finally {
    unlock();
  }
}

export async function createDonationIntent(params: {
  provider: string;
  providerRef: string;
  amountMinor: number;
  currency?: string;
  interval: DonationInterval;
  userId?: string;
  anonymousId?: string;
  source: string;
  returnPath?: string;
  checkoutUrl?: string;
  status?: DonationStatus;
}): Promise<DonationRecord> {
  return withDbMutation((db) => {
    const now = new Date().toISOString();
    const provider = params.provider.trim().slice(0, 64) || "unknown";
    const providerRef = params.providerRef.trim().slice(0, 220);
    const source = params.source.trim().slice(0, 64) || "unknown";
    const desiredStatus = params.status ?? "pending";
    const existing = db.records.find((row) => row.provider === provider && row.providerRef === providerRef);
    if (existing) {
      existing.amountMinor = Math.max(0, Math.floor(params.amountMinor));
      existing.currency = (params.currency?.trim().toUpperCase() || existing.currency || "RUB").slice(0, 8);
      existing.interval = params.interval;
      existing.userId = params.userId?.trim() || existing.userId;
      existing.anonymousId = params.anonymousId?.trim() || existing.anonymousId;
      existing.returnPath = params.returnPath?.trim() || existing.returnPath;
      existing.checkoutUrl = params.checkoutUrl?.trim() || existing.checkoutUrl;
      existing.updatedAt = now;
      if (existing.status !== desiredStatus) {
        existing.status = desiredStatus;
        existing.history.push({
          status: desiredStatus,
          source,
          at: now,
        });
      }
      return existing;
    }

    const created: DonationRecord = {
      id: randomUUID(),
      provider,
      providerRef,
      status: desiredStatus,
      amountMinor: Math.max(0, Math.floor(params.amountMinor)),
      currency: (params.currency?.trim().toUpperCase() || "RUB").slice(0, 8),
      interval: params.interval,
      userId: params.userId?.trim() || undefined,
      anonymousId: params.anonymousId?.trim() || undefined,
      source,
      returnPath: params.returnPath?.trim() || undefined,
      checkoutUrl: params.checkoutUrl?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      history: [
        {
          status: desiredStatus,
          source,
          at: now,
        },
      ],
    };
    db.records.push(created);
    return created;
  });
}

export async function transitionDonationStatus(params: {
  provider: string;
  providerRef: string;
  nextStatus: DonationStatus;
  source: string;
  reason?: string;
  userId?: string;
  amountMinor?: number;
  currency?: string;
}): Promise<{ record: DonationRecord; changed: boolean }> {
  return withDbMutation((db) => {
    const now = new Date().toISOString();
    const provider = params.provider.trim().slice(0, 64) || "unknown";
    const providerRef = params.providerRef.trim().slice(0, 220);
    const source = params.source.trim().slice(0, 64) || "unknown";
    const existing = db.records.find((row) => row.provider === provider && row.providerRef === providerRef);

    if (!existing) {
      const created: DonationRecord = {
        id: randomUUID(),
        provider,
        providerRef,
        status: params.nextStatus,
        amountMinor: Math.max(0, Math.floor(params.amountMinor ?? 0)),
        currency: (params.currency?.trim().toUpperCase() || "RUB").slice(0, 8),
        interval: "once",
        userId: params.userId?.trim() || undefined,
        source,
        createdAt: now,
        updatedAt: now,
        history: [
          {
            status: params.nextStatus,
            source,
            reason: params.reason?.trim() || undefined,
            at: now,
          },
        ],
      };
      db.records.push(created);
      return { record: created, changed: true };
    }

    if (params.userId?.trim() && !existing.userId) existing.userId = params.userId.trim();
    if (typeof params.amountMinor === "number" && Number.isFinite(params.amountMinor)) {
      existing.amountMinor = Math.max(0, Math.floor(params.amountMinor));
    }
    if (params.currency?.trim()) existing.currency = params.currency.trim().toUpperCase().slice(0, 8);

    const sameStatus = existing.status === params.nextStatus;
    const last = existing.history[existing.history.length - 1];
    const sameAsLast = sameStatus && last?.status === params.nextStatus && last?.source === source;
    if (sameAsLast) {
      existing.updatedAt = now;
      return { record: existing, changed: false };
    }

    existing.status = params.nextStatus;
    existing.updatedAt = now;
    existing.history.push({
      status: params.nextStatus,
      source,
      reason: params.reason?.trim() || undefined,
      at: now,
    });
    return { record: existing, changed: true };
  });
}

export async function listDonationsByUser(userId: string): Promise<DonationRecord[]> {
  const db = await readDb();
  return db.records
    .filter((item) => item.userId === userId)
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
