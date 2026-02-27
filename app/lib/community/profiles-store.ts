import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const COMMUNITY_PROFILES_DB_PATH = path.join(process.cwd(), "data", "community", "profiles-db.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type UserRingStyle = "none" | "sky" | "emerald" | "gold";
export type ProfileVisibility = "private" | "public";

export class ProfileHandleTakenError extends Error {
  constructor() {
    super("HANDLE_TAKEN");
    this.name = "ProfileHandleTakenError";
  }
}

export type CommunityUserProfile = {
  id: string;
  userId: string;
  displayName?: string;
  handle?: string;
  bio?: string;
  visibility: ProfileVisibility;
  avatarUrl?: string;
  ringStyle: UserRingStyle;
  updatedAt: string;
};

type CommunityProfilesDb = {
  profiles: CommunityUserProfile[];
};

const EMPTY_DB: CommunityProfilesDb = {
  profiles: [],
};

function normalizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.toString().slice(0, 500);
  } catch {
    return undefined;
  }
}

function normalizeRingStyle(value: unknown): UserRingStyle {
  if (value === "sky") return "sky";
  if (value === "emerald") return "emerald";
  if (value === "gold") return "gold";
  return "none";
}

function normalizeVisibility(value: unknown): ProfileVisibility {
  return value === "public" ? "public" : "private";
}

function normalizeHandle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeBio(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 500);
}

function normalizeProfile(input: unknown): CommunityUserProfile | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<CommunityUserProfile>;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (typeof raw.userId !== "string" || !raw.userId.trim()) return null;
  if (typeof raw.updatedAt !== "string" || !raw.updatedAt.trim()) return null;
  return {
    id: raw.id,
    userId: raw.userId,
    displayName: typeof raw.displayName === "string" && raw.displayName.trim() ? raw.displayName.trim() : undefined,
    handle: normalizeHandle(raw.handle),
    bio: normalizeBio(raw.bio),
    visibility: normalizeVisibility(raw.visibility),
    avatarUrl: normalizeUrl(typeof raw.avatarUrl === "string" ? raw.avatarUrl : undefined),
    ringStyle: normalizeRingStyle(raw.ringStyle),
    updatedAt: raw.updatedAt,
  };
}

function normalizeDb(input: unknown): CommunityProfilesDb {
  if (!input || typeof input !== "object") return EMPTY_DB;
  const raw = input as Partial<CommunityProfilesDb>;
  return {
    profiles: Array.isArray(raw.profiles)
      ? raw.profiles.map(normalizeProfile).filter((item): item is CommunityUserProfile => !!item)
      : [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(COMMUNITY_PROFILES_DB_PATH), { recursive: true });
}

async function readDb(): Promise<CommunityProfilesDb> {
  try {
    const raw = await fs.readFile(COMMUNITY_PROFILES_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, profiles: [] };
  }
}

async function writeDb(db: CommunityProfilesDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${COMMUNITY_PROFILES_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, COMMUNITY_PROFILES_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: CommunityProfilesDb) => Promise<T> | T): Promise<T> {
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

export async function getCommunityUserProfile(userId: string): Promise<CommunityUserProfile | null> {
  const db = await readDb();
  return db.profiles.find((item) => item.userId === userId) ?? null;
}

export async function getCommunityUserProfileByHandle(handle: string): Promise<CommunityUserProfile | null> {
  const normalized = normalizeHandle(handle);
  if (!normalized) return null;
  const db = await readDb();
  return db.profiles.find((item) => item.handle === normalized) ?? null;
}

export async function listCommunityUserProfilesByIds(userIds: string[]): Promise<Map<string, CommunityUserProfile>> {
  const uniqueIds = Array.from(new Set(userIds.map((item) => item.trim()).filter(Boolean)));
  const uniqueSet = new Set(uniqueIds);
  const out = new Map<string, CommunityUserProfile>();
  if (!uniqueIds.length) return out;
  const db = await readDb();
  for (const profile of db.profiles) {
    if (uniqueSet.has(profile.userId)) out.set(profile.userId, profile);
  }
  return out;
}

export async function upsertCommunityUserProfile(params: {
  userId: string;
  displayName?: string;
  handle?: string;
  bio?: string;
  visibility?: ProfileVisibility;
  avatarUrl?: string;
  ringStyle?: UserRingStyle;
}): Promise<CommunityUserProfile> {
  return withDbMutation(async (db) => {
    const idx = db.profiles.findIndex((item) => item.userId === params.userId);
    const now = new Date().toISOString();
    const nextDisplayName = params.displayName?.trim() ? params.displayName.trim().slice(0, 80) : undefined;
    const nextHandle = normalizeHandle(params.handle);
    const nextBio = normalizeBio(params.bio);
    const nextVisibility = normalizeVisibility(params.visibility);
    const nextAvatarUrl = normalizeUrl(params.avatarUrl);
    const nextRingStyle = normalizeRingStyle(params.ringStyle);

    if (nextHandle) {
      const conflict = db.profiles.find((item) => item.handle === nextHandle && item.userId !== params.userId);
      if (conflict) throw new ProfileHandleTakenError();
    }

    if (idx >= 0) {
      const current = db.profiles[idx];
      const updated: CommunityUserProfile = {
        ...current,
        displayName: nextDisplayName,
        handle: nextHandle,
        bio: nextBio,
        visibility: params.visibility === undefined ? current.visibility : nextVisibility,
        avatarUrl: nextAvatarUrl,
        ringStyle: nextRingStyle,
        updatedAt: now,
      };
      db.profiles[idx] = updated;
      return updated;
    }

    const created: CommunityUserProfile = {
      id: randomUUID(),
      userId: params.userId,
      displayName: nextDisplayName,
      handle: nextHandle,
      bio: nextBio,
      visibility: nextVisibility,
      avatarUrl: nextAvatarUrl,
      ringStyle: nextRingStyle,
      updatedAt: now,
    };
    db.profiles.push(created);
    return created;
  });
}
