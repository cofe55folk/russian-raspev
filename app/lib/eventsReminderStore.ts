import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const REMINDER_DB_PATH = path.join(process.cwd(), "data", "events", "reminder-consents.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type ReminderChannel = "telegram" | "email";

export type ReminderConsentRecord = {
  id: string;
  eventSlug: string;
  channel: ReminderChannel;
  contact: string;
  locale: "ru" | "en";
  consentGivenAt: string;
  revokedAt?: string;
  updatedAt: string;
};

type ReminderDb = {
  records: ReminderConsentRecord[];
};

const EMPTY_DB: ReminderDb = {
  records: [],
};

function normalizeDb(input: unknown): ReminderDb {
  if (!input || typeof input !== "object") return { ...EMPTY_DB, records: [] };
  const raw = input as Partial<ReminderDb>;
  if (!Array.isArray(raw.records)) return { ...EMPTY_DB, records: [] };
  return {
    records: raw.records.filter((item): item is ReminderConsentRecord => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<ReminderConsentRecord>;
      const hasCore =
        typeof row.id === "string" &&
        typeof row.eventSlug === "string" &&
        (row.channel === "telegram" || row.channel === "email") &&
        typeof row.contact === "string" &&
        (row.locale === "ru" || row.locale === "en") &&
        typeof row.consentGivenAt === "string" &&
        typeof row.updatedAt === "string";
      return hasCore;
    }),
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(REMINDER_DB_PATH), { recursive: true });
}

async function readDb(): Promise<ReminderDb> {
  try {
    const raw = await fs.readFile(REMINDER_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, records: [] };
  }
}

async function writeDb(db: ReminderDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${REMINDER_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, REMINDER_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: ReminderDb) => Promise<T> | T): Promise<T> {
  const prev = mutationQueue;
  let unlock: () => void = () => {};
  mutationQueue = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await prev;
  try {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  } finally {
    unlock();
  }
}

function normalizeContact(channel: ReminderChannel, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (channel === "email") return trimmed.toLowerCase();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export async function upsertReminderConsent(params: {
  eventSlug: string;
  channel: ReminderChannel;
  contact: string;
  locale: "ru" | "en";
}): Promise<{ record: ReminderConsentRecord; created: boolean }> {
  return withDbMutation((db) => {
    const now = new Date().toISOString();
    const normalizedContact = normalizeContact(params.channel, params.contact);
    const existing = db.records.find(
      (row) =>
        row.eventSlug === params.eventSlug && row.channel === params.channel && row.contact.toLowerCase() === normalizedContact.toLowerCase()
    );
    if (existing) {
      existing.locale = params.locale;
      existing.revokedAt = undefined;
      existing.updatedAt = now;
      return { record: existing, created: false };
    }

    const created: ReminderConsentRecord = {
      id: randomUUID(),
      eventSlug: params.eventSlug,
      channel: params.channel,
      contact: normalizedContact,
      locale: params.locale,
      consentGivenAt: now,
      updatedAt: now,
    };
    db.records.push(created);
    return { record: created, created: true };
  });
}

export async function revokeReminderConsent(params: {
  eventSlug: string;
  channel: ReminderChannel;
  contact: string;
}): Promise<{ record: ReminderConsentRecord | null; revoked: boolean }> {
  return withDbMutation((db) => {
    const normalizedContact = normalizeContact(params.channel, params.contact);
    const existing = db.records.find(
      (row) =>
        row.eventSlug === params.eventSlug && row.channel === params.channel && row.contact.toLowerCase() === normalizedContact.toLowerCase()
    );
    if (!existing) return { record: null, revoked: false };
    const now = new Date().toISOString();
    existing.revokedAt = now;
    existing.updatedAt = now;
    return { record: existing, revoked: true };
  });
}
