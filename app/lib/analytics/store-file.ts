import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const ANALYTICS_DB_PATH = path.join(process.cwd(), "data", "analytics", "engagement-db.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type AnalyticsContentType = "article" | "video" | "sound" | "education" | "search" | "paywall" | "commerce";
export type AnalyticsEventType =
  | "view_3s"
  | "progress_25"
  | "progress_50"
  | "progress_75"
  | "progress_100"
  | "time_spent"
  | "search_submit"
  | "search_click"
  | "search_zero_results_view"
  | "search_recovery_click"
  | "paywall_seen"
  | "paywall_click"
  | "purchase"
  | "donate_view"
  | "donate_amount_select"
  | "donate_checkout_start"
  | "donate_checkout_success"
  | "donate_checkout_fail";

export type AnalyticsEventRecord = {
  id: string;
  contentType: AnalyticsContentType;
  contentId: string;
  eventType: AnalyticsEventType;
  progressPercent?: 25 | 50 | 75 | 100;
  timeSpentSec?: number;
  userId?: string;
  visitorId?: string;
  sessionId?: string;
  route?: string;
  locale?: string;
  source?: string;
  dedupeKey?: string;
  createdAt: string;
};

type AnalyticsDb = {
  events: AnalyticsEventRecord[];
};

const EMPTY_DB: AnalyticsDb = {
  events: [],
};

export type UserAnalyticsSummary = {
  totalReadSec: number;
  totalWatchSec: number;
  totalListenSec: number;
  totalEducationSec: number;
  totalView3s: number;
  progressReached25: number;
  progressReached50: number;
  progressReached75: number;
  progressReached100: number;
  favoriteSoundId: string | null;
};

export type GlobalAnalyticsTopContentItem = {
  contentType: AnalyticsContentType;
  contentId: string;
  view3sCount: number;
};

export type GlobalAnalyticsSummary = {
  generatedAt: string;
  totalEvents: number;
  totalView3s: number;
  totalReadSec: number;
  totalWatchSec: number;
  totalListenSec: number;
  totalEducationSec: number;
  uniqueUsers: number;
  uniqueVisitors: number;
  progressReached25: number;
  progressReached50: number;
  progressReached75: number;
  progressReached100: number;
  searchSubmitCount: number;
  searchClickCount: number;
  searchZeroResultsViewCount: number;
  searchRecoveryClickCount: number;
  searchCtr: number;
  searchRecoveryCtr: number;
  avgSearchTimeToClickSec: number;
  paywallSeenCount: number;
  paywallClickCount: number;
  purchaseCount: number;
  donateViewCount: number;
  donateAmountSelectCount: number;
  donateCheckoutStartCount: number;
  donateCheckoutSuccessCount: number;
  donateCheckoutFailCount: number;
  topContentByView3s: GlobalAnalyticsTopContentItem[];
};

function normalizeContentType(value: unknown): AnalyticsContentType | null {
  if (value === "article") return "article";
  if (value === "video") return "video";
  if (value === "sound") return "sound";
  if (value === "education") return "education";
  if (value === "search") return "search";
  if (value === "paywall") return "paywall";
  if (value === "commerce") return "commerce";
  return null;
}

function normalizeEventType(value: unknown): AnalyticsEventType | null {
  if (value === "view_3s") return "view_3s";
  if (value === "progress_25") return "progress_25";
  if (value === "progress_50") return "progress_50";
  if (value === "progress_75") return "progress_75";
  if (value === "progress_100") return "progress_100";
  if (value === "time_spent") return "time_spent";
  if (value === "search_submit") return "search_submit";
  if (value === "search_click") return "search_click";
  if (value === "search_zero_results_view") return "search_zero_results_view";
  if (value === "search_recovery_click") return "search_recovery_click";
  if (value === "paywall_seen") return "paywall_seen";
  if (value === "paywall_click") return "paywall_click";
  if (value === "purchase") return "purchase";
  if (value === "donate_view") return "donate_view";
  if (value === "donate_amount_select") return "donate_amount_select";
  if (value === "donate_checkout_start") return "donate_checkout_start";
  if (value === "donate_checkout_success") return "donate_checkout_success";
  if (value === "donate_checkout_fail") return "donate_checkout_fail";
  return null;
}

function normalizeEventRecord(input: unknown): AnalyticsEventRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<AnalyticsEventRecord>;
  const contentType = normalizeContentType(raw.contentType);
  const eventType = normalizeEventType(raw.eventType);
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (!contentType || !eventType) return null;
  if (typeof raw.contentId !== "string" || !raw.contentId.trim()) return null;
  if (typeof raw.createdAt !== "string" || !raw.createdAt.trim()) return null;

  return {
    id: raw.id,
    contentType,
    contentId: raw.contentId,
    eventType,
    progressPercent:
      raw.progressPercent === 25 || raw.progressPercent === 50 || raw.progressPercent === 75 || raw.progressPercent === 100
        ? raw.progressPercent
        : undefined,
    timeSpentSec: typeof raw.timeSpentSec === "number" && Number.isFinite(raw.timeSpentSec) ? raw.timeSpentSec : undefined,
    userId: typeof raw.userId === "string" && raw.userId.trim() ? raw.userId : undefined,
    visitorId: typeof raw.visitorId === "string" && raw.visitorId.trim() ? raw.visitorId : undefined,
    sessionId: typeof raw.sessionId === "string" && raw.sessionId.trim() ? raw.sessionId.trim().slice(0, 96) : undefined,
    route: typeof raw.route === "string" && raw.route.trim() ? raw.route.trim().slice(0, 220) : undefined,
    locale: typeof raw.locale === "string" && raw.locale.trim() ? raw.locale.trim().slice(0, 8) : undefined,
    source: typeof raw.source === "string" && raw.source.trim() ? raw.source.trim().slice(0, 64) : undefined,
    dedupeKey: typeof raw.dedupeKey === "string" && raw.dedupeKey.trim() ? raw.dedupeKey.trim().slice(0, 220) : undefined,
    createdAt: raw.createdAt,
  };
}

function normalizeDb(input: unknown): AnalyticsDb {
  if (!input || typeof input !== "object") return EMPTY_DB;
  const raw = input as Partial<AnalyticsDb>;
  return {
    events: Array.isArray(raw.events)
      ? raw.events.map(normalizeEventRecord).filter((item): item is AnalyticsEventRecord => !!item)
      : [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(ANALYTICS_DB_PATH), { recursive: true });
}

async function readDb(): Promise<AnalyticsDb> {
  try {
    const raw = await fs.readFile(ANALYTICS_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, events: [] };
  }
}

async function writeDb(db: AnalyticsDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await ensureDir();
    const tempPath = `${ANALYTICS_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, ANALYTICS_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: AnalyticsDb) => Promise<T> | T): Promise<T> {
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

export async function createAnalyticsEvent(params: {
  contentType: AnalyticsContentType;
  contentId: string;
  eventType: AnalyticsEventType;
  progressPercent?: 25 | 50 | 75 | 100;
  timeSpentSec?: number;
  userId?: string;
  visitorId?: string;
  sessionId?: string;
  route?: string;
  locale?: string;
  source?: string;
  dedupeKey?: string;
}): Promise<{ event: AnalyticsEventRecord; deduped: boolean }> {
  return withDbMutation(async (db) => {
    const normalizedDedupeKey = params.dedupeKey?.trim().slice(0, 220);
    if (normalizedDedupeKey) {
      const existing = db.events.find((item) => item.dedupeKey && item.dedupeKey === normalizedDedupeKey);
      if (existing) {
        return {
          event: existing,
          deduped: true,
        };
      }
    }

    const created: AnalyticsEventRecord = {
      id: randomUUID(),
      contentType: params.contentType,
      contentId: params.contentId,
      eventType: params.eventType,
      progressPercent: params.progressPercent,
      timeSpentSec:
        typeof params.timeSpentSec === "number" && Number.isFinite(params.timeSpentSec)
          ? Math.max(0, Math.min(24 * 60 * 60, Math.floor(params.timeSpentSec)))
          : undefined,
      userId: params.userId,
      visitorId: params.visitorId,
      sessionId: params.sessionId?.trim().slice(0, 96) || undefined,
      route: params.route?.trim().slice(0, 220) || undefined,
      locale: params.locale?.trim().slice(0, 8) || undefined,
      source: params.source?.trim().slice(0, 64) || undefined,
      dedupeKey: normalizedDedupeKey || undefined,
      createdAt: new Date().toISOString(),
    };
    db.events.push(created);
    return {
      event: created,
      deduped: false,
    };
  });
}

export async function getContentView3sCount(params: {
  contentType: AnalyticsContentType;
  contentId: string;
}): Promise<number> {
  const db = await readDb();
  return db.events.filter(
    (item) => item.contentType === params.contentType && item.contentId === params.contentId && item.eventType === "view_3s"
  ).length;
}

export async function getUserAnalyticsSummary(userId: string): Promise<UserAnalyticsSummary> {
  const db = await readDb();
  const userEvents = db.events.filter((item) => item.userId === userId);

  let totalReadSec = 0;
  let totalWatchSec = 0;
  let totalListenSec = 0;
  let totalEducationSec = 0;
  let totalView3s = 0;

  const progressByContent = new Map<string, number>();
  const soundTimeByContent = new Map<string, number>();

  for (const event of userEvents) {
    if (event.eventType === "view_3s") {
      totalView3s += 1;
    }

    if (event.eventType === "time_spent") {
      const sec = typeof event.timeSpentSec === "number" ? Math.max(0, event.timeSpentSec) : 0;
      if (event.contentType === "article") totalReadSec += sec;
      if (event.contentType === "video") totalWatchSec += sec;
      if (event.contentType === "sound") {
        totalListenSec += sec;
        const prev = soundTimeByContent.get(event.contentId) || 0;
        soundTimeByContent.set(event.contentId, prev + sec);
      }
      if (event.contentType === "education") totalEducationSec += sec;
    }

    if (
      event.eventType === "progress_25" ||
      event.eventType === "progress_50" ||
      event.eventType === "progress_75" ||
      event.eventType === "progress_100"
    ) {
      const progress = event.progressPercent || (event.eventType === "progress_25"
        ? 25
        : event.eventType === "progress_50"
          ? 50
          : event.eventType === "progress_75"
            ? 75
            : 100);
      const key = `${event.contentType}:${event.contentId}`;
      const prev = progressByContent.get(key) || 0;
      if (progress > prev) progressByContent.set(key, progress);
    }
  }

  let favoriteSoundId: string | null = null;
  let favoriteSoundSec = -1;
  for (const [soundId, sec] of soundTimeByContent.entries()) {
    if (sec > favoriteSoundSec) {
      favoriteSoundSec = sec;
      favoriteSoundId = soundId;
    }
  }

  let progressReached25 = 0;
  let progressReached50 = 0;
  let progressReached75 = 0;
  let progressReached100 = 0;

  for (const value of progressByContent.values()) {
    if (value >= 25) progressReached25 += 1;
    if (value >= 50) progressReached50 += 1;
    if (value >= 75) progressReached75 += 1;
    if (value >= 100) progressReached100 += 1;
  }

  return {
    totalReadSec,
    totalWatchSec,
    totalListenSec,
    totalEducationSec,
    totalView3s,
    progressReached25,
    progressReached50,
    progressReached75,
    progressReached100,
    favoriteSoundId,
  };
}

function resolveProgressPercent(event: AnalyticsEventRecord): 25 | 50 | 75 | 100 | null {
  if (event.progressPercent === 25 || event.progressPercent === 50 || event.progressPercent === 75 || event.progressPercent === 100) {
    return event.progressPercent;
  }
  if (event.eventType === "progress_25") return 25;
  if (event.eventType === "progress_50") return 50;
  if (event.eventType === "progress_75") return 75;
  if (event.eventType === "progress_100") return 100;
  return null;
}

export async function getGlobalAnalyticsSummary(): Promise<GlobalAnalyticsSummary> {
  const db = await readDb();
  const events = db.events;

  let totalEvents = 0;
  let totalView3s = 0;
  let totalReadSec = 0;
  let totalWatchSec = 0;
  let totalListenSec = 0;
  let totalEducationSec = 0;
  let searchSubmitCount = 0;
  let searchClickCount = 0;
  let searchZeroResultsViewCount = 0;
  let searchRecoveryClickCount = 0;
  let searchTimeToClickTotalSec = 0;
  let searchTimeToClickSamples = 0;
  let paywallSeenCount = 0;
  let paywallClickCount = 0;
  let purchaseCount = 0;
  let donateViewCount = 0;
  let donateAmountSelectCount = 0;
  let donateCheckoutStartCount = 0;
  let donateCheckoutSuccessCount = 0;
  let donateCheckoutFailCount = 0;
  const uniqueUsers = new Set<string>();
  const uniqueVisitors = new Set<string>();
  const view3sByContent = new Map<string, number>();
  const actorProgressByContent = new Map<string, number>();

  for (const event of events) {
    totalEvents += 1;
    if (event.userId) uniqueUsers.add(event.userId);
    if (event.visitorId) uniqueVisitors.add(event.visitorId);

    if (event.eventType === "view_3s") {
      totalView3s += 1;
      const contentKey = `${event.contentType}:${event.contentId}`;
      view3sByContent.set(contentKey, (view3sByContent.get(contentKey) || 0) + 1);
    }
    if (event.eventType === "search_submit") searchSubmitCount += 1;
    if (event.eventType === "search_click") searchClickCount += 1;
    if (event.eventType === "search_zero_results_view") searchZeroResultsViewCount += 1;
    if (event.eventType === "search_recovery_click") searchRecoveryClickCount += 1;
    if (event.eventType === "search_click" || event.eventType === "search_recovery_click") {
      if (typeof event.timeSpentSec === "number" && Number.isFinite(event.timeSpentSec) && event.timeSpentSec >= 0) {
        searchTimeToClickTotalSec += event.timeSpentSec;
        searchTimeToClickSamples += 1;
      }
    }
    if (event.eventType === "paywall_seen") paywallSeenCount += 1;
    if (event.eventType === "paywall_click") paywallClickCount += 1;
    if (event.eventType === "purchase") purchaseCount += 1;
    if (event.eventType === "donate_view") donateViewCount += 1;
    if (event.eventType === "donate_amount_select") donateAmountSelectCount += 1;
    if (event.eventType === "donate_checkout_start") donateCheckoutStartCount += 1;
    if (event.eventType === "donate_checkout_success") donateCheckoutSuccessCount += 1;
    if (event.eventType === "donate_checkout_fail") donateCheckoutFailCount += 1;

    if (event.eventType === "time_spent") {
      const sec = typeof event.timeSpentSec === "number" ? Math.max(0, event.timeSpentSec) : 0;
      if (event.contentType === "article") totalReadSec += sec;
      if (event.contentType === "video") totalWatchSec += sec;
      if (event.contentType === "sound") totalListenSec += sec;
      if (event.contentType === "education") totalEducationSec += sec;
    }

    const progress = resolveProgressPercent(event);
    if (progress == null) continue;

    const actorKey = event.userId ? `u:${event.userId}` : event.visitorId ? `v:${event.visitorId}` : `anon:${event.id}`;
    const contentActorKey = `${actorKey}:${event.contentType}:${event.contentId}`;
    const prev = actorProgressByContent.get(contentActorKey) || 0;
    if (progress > prev) actorProgressByContent.set(contentActorKey, progress);
  }

  let progressReached25 = 0;
  let progressReached50 = 0;
  let progressReached75 = 0;
  let progressReached100 = 0;

  for (const maxProgress of actorProgressByContent.values()) {
    if (maxProgress >= 25) progressReached25 += 1;
    if (maxProgress >= 50) progressReached50 += 1;
    if (maxProgress >= 75) progressReached75 += 1;
    if (maxProgress >= 100) progressReached100 += 1;
  }

  const topContentByView3s = Array.from(view3sByContent.entries())
    .map(([contentKey, view3sCount]) => {
      const [contentTypeRaw, ...contentIdParts] = contentKey.split(":");
      const contentType = normalizeContentType(contentTypeRaw) || "article";
      return {
        contentType,
        contentId: contentIdParts.join(":"),
        view3sCount,
      };
    })
    .sort((a, b) => b.view3sCount - a.view3sCount)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    totalEvents,
    totalView3s,
    totalReadSec,
    totalWatchSec,
    totalListenSec,
    totalEducationSec,
    uniqueUsers: uniqueUsers.size,
    uniqueVisitors: uniqueVisitors.size,
    progressReached25,
    progressReached50,
    progressReached75,
    progressReached100,
    searchSubmitCount,
    searchClickCount,
    searchZeroResultsViewCount,
    searchRecoveryClickCount,
    searchCtr: searchSubmitCount > 0 ? searchClickCount / searchSubmitCount : 0,
    searchRecoveryCtr: searchZeroResultsViewCount > 0 ? searchRecoveryClickCount / searchZeroResultsViewCount : 0,
    avgSearchTimeToClickSec: searchTimeToClickSamples > 0 ? searchTimeToClickTotalSec / searchTimeToClickSamples : 0,
    paywallSeenCount,
    paywallClickCount,
    purchaseCount,
    donateViewCount,
    donateAmountSelectCount,
    donateCheckoutStartCount,
    donateCheckoutSuccessCount,
    donateCheckoutFailCount,
    topContentByView3s,
  };
}

export function isAnalyticsContentType(value: string | null | undefined): value is AnalyticsContentType {
  return (
    value === "article" ||
    value === "video" ||
    value === "sound" ||
    value === "education" ||
    value === "search" ||
    value === "paywall" ||
    value === "commerce"
  );
}
