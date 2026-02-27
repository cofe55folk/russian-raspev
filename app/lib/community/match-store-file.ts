import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const MATCH_DB_PATH = path.join(process.cwd(), "data", "community", "match-db.json");
const MAX_COOLDOWN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SAFETY_COOLDOWN_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_QUEUE_AGE_MS = 30 * 60 * 1000;
const MAX_MATCH_HISTORY = 500;
const MAX_REPORT_HISTORY = 4000;
const MAX_BLOCK_HISTORY = 4000;

let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type MatchQueueEntry = {
  userId: string;
  name?: string;
  optedInAt: string;
  updatedAt: string;
};

export type MatchCooldownEntry = {
  userId: string;
  cooldownUntil: string;
  matchId: string;
  updatedAt: string;
};

export type MatchSafetyCooldownEntry = {
  userId: string;
  cooldownUntil: string;
  reason: "abuse-report";
  reportsCount: number;
  lastReportAt: string;
  updatedAt: string;
};

export type MatchBlockEntry = {
  blockerUserId: string;
  blockedUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type MatchReportEntry = {
  id: string;
  requestHash: string;
  reporterUserId: string;
  offenderUserId: string;
  reason?: string;
  createdAt: string;
};

export type MatchRoomDraftPayload = {
  title: string;
  description: string;
  source: "community-matchmaking";
  participantUserIds: [string, string];
};

export type MatchPairRecord = {
  id: string;
  createdAt: string;
  cooldownUntil: string;
  userAId: string;
  userAName?: string;
  userBId: string;
  userBName?: string;
  roomDraft: MatchRoomDraftPayload;
};

type MatchDb = {
  queue: MatchQueueEntry[];
  cooldowns: MatchCooldownEntry[];
  safetyCooldowns: MatchSafetyCooldownEntry[];
  blocks: MatchBlockEntry[];
  reports: MatchReportEntry[];
  matches: MatchPairRecord[];
};

const EMPTY_DB: MatchDb = {
  queue: [],
  cooldowns: [],
  safetyCooldowns: [],
  blocks: [],
  reports: [],
  matches: [],
};

export type MatchOptInResult = {
  optedIn: boolean;
  queueSize: number;
  cooldownUntil: string | null;
};

export type MatchNextResult =
  | { ok: false; error: "NOT_OPTED_IN" }
  | { ok: true; status: "cooldown"; cooldownUntil: string; queueSize: number }
  | { ok: true; status: "waiting"; queueSize: number }
  | {
      ok: true;
      status: "matched";
      queueSize: number;
      match: MatchPairRecord;
      counterpart: { userId: string; name?: string };
      roomDraftParams: Record<string, string>;
      transition: {
        type: "room_draft";
        method: "POST";
        pathname: "/api/community/rooms";
      };
    };

export type MatchBlockResult = {
  blocked: boolean;
  idempotent: boolean;
};

export type MatchReportResult = {
  accepted: boolean;
  idempotent: boolean;
  cooldownUntil: string | null;
};

function normalizeName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  return normalized.slice(0, 120);
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, 200);
}

function normalizeReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  return normalized.slice(0, 500);
}

function normalizeDb(input: unknown): MatchDb {
  if (!input || typeof input !== "object") return EMPTY_DB;
  const raw = input as Partial<MatchDb>;
  return {
    queue: Array.isArray(raw.queue) ? (raw.queue.filter(Boolean) as MatchQueueEntry[]) : [],
    cooldowns: Array.isArray(raw.cooldowns) ? (raw.cooldowns.filter(Boolean) as MatchCooldownEntry[]) : [],
    safetyCooldowns: Array.isArray(raw.safetyCooldowns)
      ? (raw.safetyCooldowns.filter(Boolean) as MatchSafetyCooldownEntry[])
      : [],
    blocks: Array.isArray(raw.blocks) ? (raw.blocks.filter(Boolean) as MatchBlockEntry[]) : [],
    reports: Array.isArray(raw.reports) ? (raw.reports.filter(Boolean) as MatchReportEntry[]) : [],
    matches: Array.isArray(raw.matches) ? (raw.matches.filter(Boolean) as MatchPairRecord[]) : [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(MATCH_DB_PATH), { recursive: true });
}

async function readDb(): Promise<MatchDb> {
  try {
    const raw = await fs.readFile(MATCH_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, queue: [], cooldowns: [], safetyCooldowns: [], blocks: [], reports: [], matches: [] };
  }
}

async function writeDb(db: MatchDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${MATCH_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, MATCH_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: MatchDb) => Promise<T> | T): Promise<T> {
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

function pruneCooldowns(db: MatchDb, nowTs: number): void {
  db.cooldowns = db.cooldowns.filter((item) => {
    const untilTs = new Date(item.cooldownUntil).getTime();
    const updatedTs = new Date(item.updatedAt).getTime();
    if (!Number.isFinite(untilTs)) return false;
    if (untilTs > nowTs) return true;
    if (!Number.isFinite(updatedTs)) return false;
    return nowTs - updatedTs <= MAX_COOLDOWN_AGE_MS;
  });
}

function pruneSafetyCooldowns(db: MatchDb, nowTs: number): void {
  db.safetyCooldowns = db.safetyCooldowns.filter((item) => {
    const untilTs = new Date(item.cooldownUntil).getTime();
    const updatedTs = new Date(item.updatedAt).getTime();
    if (!Number.isFinite(untilTs)) return false;
    if (untilTs > nowTs) return true;
    if (!Number.isFinite(updatedTs)) return false;
    return nowTs - updatedTs <= MAX_SAFETY_COOLDOWN_AGE_MS;
  });
}

function pruneQueue(db: MatchDb, nowTs: number): void {
  db.queue = db.queue.filter((item) => {
    const updatedTs = new Date(item.updatedAt || item.optedInAt).getTime();
    if (!Number.isFinite(updatedTs)) return false;
    return nowTs - updatedTs <= MAX_QUEUE_AGE_MS;
  });
}

function pruneReports(db: MatchDb): void {
  if (db.reports.length > MAX_REPORT_HISTORY) {
    db.reports = db.reports.slice(db.reports.length - MAX_REPORT_HISTORY);
  }
}

function pruneBlocks(db: MatchDb): void {
  if (db.blocks.length > MAX_BLOCK_HISTORY) {
    db.blocks = db.blocks.slice(db.blocks.length - MAX_BLOCK_HISTORY);
  }
}

function getActiveCooldownMap(db: MatchDb, nowTs: number): Map<string, string> {
  const output = new Map<string, string>();

  for (const item of db.cooldowns) {
    const untilTs = new Date(item.cooldownUntil).getTime();
    if (!Number.isFinite(untilTs) || untilTs <= nowTs) continue;
    const current = output.get(item.userId);
    if (!current || new Date(current).getTime() < untilTs) {
      output.set(item.userId, item.cooldownUntil);
    }
  }

  for (const item of db.safetyCooldowns) {
    const untilTs = new Date(item.cooldownUntil).getTime();
    if (!Number.isFinite(untilTs) || untilTs <= nowTs) continue;
    const current = output.get(item.userId);
    if (!current || new Date(current).getTime() < untilTs) {
      output.set(item.userId, item.cooldownUntil);
    }
  }

  return output;
}

function isBlockedPair(db: MatchDb, userAId: string, userBId: string): boolean {
  return db.blocks.some(
    (item) =>
      (item.blockerUserId === userAId && item.blockedUserId === userBId) ||
      (item.blockerUserId === userBId && item.blockedUserId === userAId),
  );
}

function buildRoomDraft(params: {
  userAId: string;
  userAName?: string;
  userBId: string;
  userBName?: string;
  matchId: string;
}): MatchRoomDraftPayload {
  const userALabel = params.userAName || "Participant A";
  const userBLabel = params.userBName || "Participant B";
  return {
    title: `Match duet: ${userALabel} × ${userBLabel}`,
    description: `Auto-generated room draft for match ${params.matchId}`,
    source: "community-matchmaking",
    participantUserIds: [params.userAId, params.userBId],
  };
}

function buildRoomDraftParams(match: MatchPairRecord): Record<string, string> {
  return {
    source: "community-matchmaking",
    matchId: match.id,
    title: match.roomDraft.title,
    description: match.roomDraft.description,
    participantA: match.userAId,
    participantB: match.userBId,
  };
}

function upsertQueueEntry(db: MatchDb, params: { userId: string; name?: string; nowIso: string }): void {
  const idx = db.queue.findIndex((item) => item.userId === params.userId);
  if (idx >= 0) {
    db.queue[idx] = {
      ...db.queue[idx],
      name: params.name ?? db.queue[idx].name,
      updatedAt: params.nowIso,
    };
    return;
  }
  db.queue.push({
    userId: params.userId,
    name: params.name,
    optedInAt: params.nowIso,
    updatedAt: params.nowIso,
  });
}

function computeEscalatedCooldownSec(reportsCount: number): number {
  if (reportsCount <= 1) return 15 * 60;
  if (reportsCount === 2) return 60 * 60;
  if (reportsCount === 3) return 6 * 60 * 60;
  return 24 * 60 * 60;
}

function buildReportRequestHash(params: {
  reporterUserId: string;
  offenderUserId: string;
  reason?: string;
  clientRequestId?: string;
}): string {
  const key = [
    params.reporterUserId,
    params.offenderUserId,
    params.reason ?? "",
    params.clientRequestId ?? "",
  ].join("\n");
  return createHash("sha256").update(key).digest("hex");
}

function upsertSafetyCooldown(
  db: MatchDb,
  params: { userId: string; cooldownUntil: string; reportsCount: number; nowIso: string },
): void {
  const idx = db.safetyCooldowns.findIndex((item) => item.userId === params.userId);
  if (idx < 0) {
    db.safetyCooldowns.push({
      userId: params.userId,
      cooldownUntil: params.cooldownUntil,
      reason: "abuse-report",
      reportsCount: params.reportsCount,
      lastReportAt: params.nowIso,
      updatedAt: params.nowIso,
    });
    return;
  }

  const existing = db.safetyCooldowns[idx];
  const existingUntilTs = new Date(existing.cooldownUntil).getTime();
  const nextUntilTs = new Date(params.cooldownUntil).getTime();
  const finalUntil = Number.isFinite(existingUntilTs) && existingUntilTs > nextUntilTs ? existing.cooldownUntil : params.cooldownUntil;

  db.safetyCooldowns[idx] = {
    ...existing,
    cooldownUntil: finalUntil,
    reportsCount: Math.max(existing.reportsCount || 0, params.reportsCount),
    lastReportAt: params.nowIso,
    updatedAt: params.nowIso,
  };
}

export async function setCommunityMatchOptIn(params: {
  userId: string;
  name?: string;
  optIn: boolean;
  now?: Date;
}): Promise<MatchOptInResult> {
  return withDbMutation(async (db) => {
    const now = params.now ?? new Date();
    const nowTs = now.getTime();
    const nowIso = now.toISOString();

    pruneQueue(db, nowTs);
    pruneCooldowns(db, nowTs);
    pruneSafetyCooldowns(db, nowTs);

    if (params.optIn) {
      upsertQueueEntry(db, {
        userId: params.userId,
        name: normalizeName(params.name),
        nowIso,
      });
    } else {
      db.queue = db.queue.filter((item) => item.userId !== params.userId);
    }

    const cooldown = getActiveCooldownMap(db, nowTs).get(params.userId);

    return {
      optedIn: params.optIn,
      queueSize: db.queue.length,
      cooldownUntil: cooldown ?? null,
    };
  });
}

export async function takeNextCommunityMatch(params: {
  requesterUserId: string;
  requesterName?: string;
  cooldownSec: number;
  now?: Date;
}): Promise<MatchNextResult> {
  return withDbMutation(async (db) => {
    const now = params.now ?? new Date();
    const nowTs = now.getTime();
    const nowIso = now.toISOString();

    pruneQueue(db, nowTs);
    pruneCooldowns(db, nowTs);
    pruneSafetyCooldowns(db, nowTs);

    const cooldownMap = getActiveCooldownMap(db, nowTs);
    const requesterCooldown = cooldownMap.get(params.requesterUserId);
    if (requesterCooldown) {
      return {
        ok: true,
        status: "cooldown",
        cooldownUntil: requesterCooldown,
        queueSize: db.queue.length,
      };
    }

    const requesterEntry = db.queue.find((item) => item.userId === params.requesterUserId);
    if (!requesterEntry) {
      return { ok: false, error: "NOT_OPTED_IN" };
    }

    requesterEntry.updatedAt = nowIso;
    const normalizedRequesterName = normalizeName(params.requesterName);
    if (normalizedRequesterName) {
      requesterEntry.name = normalizedRequesterName;
    }

    const counterpart = db.queue.find(
      (item) =>
        item.userId !== params.requesterUserId &&
        !cooldownMap.has(item.userId) &&
        !isBlockedPair(db, params.requesterUserId, item.userId),
    );
    if (!counterpart) {
      return {
        ok: true,
        status: "waiting",
        queueSize: db.queue.length,
      };
    }

    const cooldownUntilIso = new Date(nowTs + Math.max(1, Math.trunc(params.cooldownSec)) * 1000).toISOString();
    const matchId = randomUUID();
    const roomDraft = buildRoomDraft({
      userAId: requesterEntry.userId,
      userAName: requesterEntry.name,
      userBId: counterpart.userId,
      userBName: counterpart.name,
      matchId,
    });

    const match: MatchPairRecord = {
      id: matchId,
      createdAt: nowIso,
      cooldownUntil: cooldownUntilIso,
      userAId: requesterEntry.userId,
      userAName: requesterEntry.name,
      userBId: counterpart.userId,
      userBName: counterpart.name,
      roomDraft,
    };

    db.matches.push(match);
    if (db.matches.length > MAX_MATCH_HISTORY) {
      db.matches = db.matches.slice(db.matches.length - MAX_MATCH_HISTORY);
    }

    db.queue = db.queue.filter((item) => item.userId !== requesterEntry.userId && item.userId !== counterpart.userId);

    db.cooldowns = db.cooldowns.filter((item) => item.userId !== requesterEntry.userId && item.userId !== counterpart.userId);
    db.cooldowns.push({
      userId: requesterEntry.userId,
      cooldownUntil: cooldownUntilIso,
      matchId,
      updatedAt: nowIso,
    });
    db.cooldowns.push({
      userId: counterpart.userId,
      cooldownUntil: cooldownUntilIso,
      matchId,
      updatedAt: nowIso,
    });

    return {
      ok: true,
      status: "matched",
      queueSize: db.queue.length,
      match,
      counterpart: {
        userId: counterpart.userId,
        name: counterpart.name,
      },
      roomDraftParams: buildRoomDraftParams(match),
      transition: {
        type: "room_draft",
        method: "POST",
        pathname: "/api/community/rooms",
      },
    };
  });
}

export async function blockCommunityMatchUser(params: {
  blockerUserId: string;
  blockedUserId: string;
  now?: Date;
}): Promise<MatchBlockResult> {
  return withDbMutation(async (db) => {
    const blockerUserId = normalizeUserId(params.blockerUserId);
    const blockedUserId = normalizeUserId(params.blockedUserId);
    if (!blockerUserId || !blockedUserId) {
      throw new Error("INVALID_BLOCK_PAYLOAD");
    }
    if (blockerUserId === blockedUserId) {
      return { blocked: false, idempotent: true };
    }

    const now = params.now ?? new Date();
    const nowIso = now.toISOString();

    const existing = db.blocks.find(
      (item) => item.blockerUserId === blockerUserId && item.blockedUserId === blockedUserId,
    );
    if (existing) {
      existing.updatedAt = nowIso;
      return { blocked: true, idempotent: true };
    }

    db.blocks.push({
      blockerUserId,
      blockedUserId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    pruneBlocks(db);

    return { blocked: true, idempotent: false };
  });
}

export async function reportCommunityMatchUser(params: {
  reporterUserId: string;
  offenderUserId: string;
  reason?: string;
  clientRequestId?: string;
  now?: Date;
}): Promise<MatchReportResult> {
  return withDbMutation(async (db) => {
    const reporterUserId = normalizeUserId(params.reporterUserId);
    const offenderUserId = normalizeUserId(params.offenderUserId);
    if (!reporterUserId || !offenderUserId) {
      throw new Error("INVALID_REPORT_PAYLOAD");
    }
    if (reporterUserId === offenderUserId) {
      return { accepted: false, idempotent: true, cooldownUntil: null };
    }

    const reason = normalizeReason(params.reason);
    const clientRequestId = normalizeUserId(params.clientRequestId);
    const requestHash = buildReportRequestHash({
      reporterUserId,
      offenderUserId,
      reason,
      clientRequestId: clientRequestId ?? undefined,
    });

    const existing = db.reports.find((item) => item.requestHash === requestHash);
    if (existing) {
      const nowTs = (params.now ?? new Date()).getTime();
      const cooldownUntil = getActiveCooldownMap(db, nowTs).get(offenderUserId) ?? null;
      return {
        accepted: true,
        idempotent: true,
        cooldownUntil,
      };
    }

    const now = params.now ?? new Date();
    const nowTs = now.getTime();
    const nowIso = now.toISOString();

    pruneQueue(db, nowTs);
    pruneCooldowns(db, nowTs);
    pruneSafetyCooldowns(db, nowTs);

    const reportEntry: MatchReportEntry = {
      id: randomUUID(),
      requestHash,
      reporterUserId,
      offenderUserId,
      reason,
      createdAt: nowIso,
    };

    db.reports.push(reportEntry);
    pruneReports(db);

    const reportsCount = db.reports.filter((item) => item.offenderUserId === offenderUserId).length;
    const cooldownSec = computeEscalatedCooldownSec(reportsCount);
    const cooldownUntil = new Date(nowTs + cooldownSec * 1000).toISOString();

    upsertSafetyCooldown(db, {
      userId: offenderUserId,
      cooldownUntil,
      reportsCount,
      nowIso,
    });

    return {
      accepted: true,
      idempotent: false,
      cooldownUntil: getActiveCooldownMap(db, nowTs).get(offenderUserId) ?? cooldownUntil,
    };
  });
}

export async function isCommunityUserOptedIn(userId: string): Promise<boolean> {
  const db = await readDb();
  const nowTs = Date.now();
  pruneQueue(db, nowTs);
  return db.queue.some((item) => item.userId === userId);
}

export async function isCommunityUserPairBlocked(params: {
  userAId: string;
  userBId: string;
}): Promise<boolean> {
  const userAId = normalizeUserId(params.userAId);
  const userBId = normalizeUserId(params.userBId);
  if (!userAId || !userBId) return false;
  if (userAId === userBId) return false;
  const db = await readDb();
  return isBlockedPair(db, userAId, userBId);
}
