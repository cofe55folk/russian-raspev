import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_LOCALE, LOCALES, getLocaleMeta, isLocale, type Locale } from "../i18n/types";
import { normalizeForSearch } from "./normalize";

type QueryCountMap = Record<string, number>;
type QueryOutcomeRecord = {
  total: number;
  zero: number;
};
type QueryOutcomeMap = Record<string, QueryOutcomeRecord>;

type QueryStatsStore = {
  version: 3;
  updatedAt: string;
  counts: QueryCountMap;
  countsByLocale: Record<Locale, QueryCountMap>;
  outcomesByLocale: Record<Locale, QueryOutcomeMap>;
};

const STORE_PATH = join(process.cwd(), "data", "logs", "search-query-stats.json");
const MIN_QUERY_LEN = 2;

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.catch(() => {}).then(task);
  return writeQueue;
}

export async function registerSearchQuery(rawQuery: string, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const query = normalizeForSearch(rawQuery);
  if (query.length < MIN_QUERY_LEN) return;
  const activeLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;

  return enqueueWrite(async () => {
    const store = await readStore();
    store.counts[query] = (store.counts[query] ?? 0) + 1;
    const bucket = store.countsByLocale[activeLocale];
    bucket[query] = (bucket[query] ?? 0) + 1;
    store.updatedAt = new Date().toISOString();
    await writeStore(store);
  });
}

export async function registerSearchQueryOutcome(
  rawQuery: string,
  params: {
    locale?: Locale;
    resultCount: number;
  }
): Promise<void> {
  const query = normalizeForSearch(rawQuery);
  if (query.length < MIN_QUERY_LEN) return;
  const activeLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const resultCount = Number.isFinite(params.resultCount) ? Math.max(0, Math.floor(params.resultCount)) : 0;
  const isZeroResult = resultCount === 0;

  return enqueueWrite(async () => {
    const store = await readStore();
    const bucket = store.outcomesByLocale[activeLocale];
    const current = bucket[query] ?? { total: 0, zero: 0 };
    bucket[query] = {
      total: current.total + 1,
      zero: current.zero + (isZeroResult ? 1 : 0),
    };
    store.updatedAt = new Date().toISOString();
    await writeStore(store);
  });
}

export async function getPopularQueries(limit = 8, locale: Locale = DEFAULT_LOCALE): Promise<string[]> {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)));
  const activeLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const store = await readStore();
  const localeCounts = store.countsByLocale[activeLocale];
  const sourceCounts = Object.keys(localeCounts).length ? localeCounts : store.counts;
  const collatorLocale = getLocaleMeta(activeLocale).intl;

  return Object.entries(sourceCounts)
    .sort((a, b) => {
      if (b[1] === a[1]) return a[0].localeCompare(b[0], collatorLocale, { sensitivity: "base" });
      return b[1] - a[1];
    })
    .slice(0, safeLimit)
    .map(([query]) => query);
}

export type SearchQualityFailedQuery = {
  query: string;
  totalCount: number;
  zeroResultCount: number;
  zeroResultRate: number;
};

export type SearchQualitySummary = {
  generatedAt: string;
  updatedAt: string;
  totalQueries: number;
  zeroResultQueries: number;
  zeroResultRate: number;
  failedQueries: SearchQualityFailedQuery[];
};

export async function getSearchQualitySummary(limit = 20, locale: Locale = DEFAULT_LOCALE): Promise<SearchQualitySummary> {
  const safeLimit = Math.max(1, Math.min(300, Math.floor(limit)));
  const activeLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const store = await readStore();
  const localeOutcomes = store.outcomesByLocale[activeLocale];
  const sourceOutcomes = Object.keys(localeOutcomes).length ? localeOutcomes : mergeLocaleOutcomes(store.outcomesByLocale);

  let totalQueries = 0;
  let zeroResultQueries = 0;
  const failedQueries: SearchQualityFailedQuery[] = [];

  for (const [query, outcome] of Object.entries(sourceOutcomes)) {
    totalQueries += outcome.total;
    zeroResultQueries += outcome.zero;
    if (outcome.zero === 0) continue;
    const zeroResultRate = outcome.total > 0 ? outcome.zero / outcome.total : 0;
    failedQueries.push({
      query,
      totalCount: outcome.total,
      zeroResultCount: outcome.zero,
      zeroResultRate,
    });
  }

  failedQueries.sort((a, b) => {
    if (b.zeroResultCount !== a.zeroResultCount) return b.zeroResultCount - a.zeroResultCount;
    if (b.zeroResultRate !== a.zeroResultRate) return b.zeroResultRate - a.zeroResultRate;
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    return a.query.localeCompare(b.query, getLocaleMeta(activeLocale).intl, { sensitivity: "base" });
  });

  return {
    generatedAt: new Date().toISOString(),
    updatedAt: store.updatedAt,
    totalQueries,
    zeroResultQueries,
    zeroResultRate: totalQueries > 0 ? zeroResultQueries / totalQueries : 0,
    failedQueries: failedQueries.slice(0, safeLimit),
  };
}

export async function getSearchFailedQueriesCsv(limit = 200, locale: Locale = DEFAULT_LOCALE): Promise<string> {
  const summary = await getSearchQualitySummary(limit, locale);
  const rows = [
    "query,total_count,zero_result_count,zero_result_rate",
    ...summary.failedQueries.map((item) => {
      const escapedQuery = escapeCsv(item.query);
      const rate = item.zeroResultRate.toFixed(4);
      return `${escapedQuery},${item.totalCount},${item.zeroResultCount},${rate}`;
    }),
  ];
  return `${rows.join("\n")}\n`;
}

async function readStore(): Promise<QueryStatsStore> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<QueryStatsStore>;
    if (!parsed || typeof parsed !== "object") return createDefaultStore();
    const normalizedCounts = normalizeCountMap(parsed.counts);
    const normalizedByLocale = createLocaleBuckets();

    if (parsed.countsByLocale && typeof parsed.countsByLocale === "object") {
      for (const locale of LOCALES) {
        const rawBucket = (parsed.countsByLocale as Partial<Record<Locale, unknown>>)[locale];
        normalizedByLocale[locale] = normalizeCountMap(rawBucket);
      }
    }

    const hasAnyLocaleBucket = LOCALES.some((locale) => Object.keys(normalizedByLocale[locale]).length > 0);
    if (!hasAnyLocaleBucket && Object.keys(normalizedCounts).length > 0) {
      normalizedByLocale[DEFAULT_LOCALE] = { ...normalizedCounts };
    }

    const mergedCounts = hasAnyLocaleBucket ? mergeLocaleCounts(normalizedByLocale) : normalizedCounts;

    const normalizedOutcomesByLocale = createOutcomeBuckets();
    if (parsed.outcomesByLocale && typeof parsed.outcomesByLocale === "object") {
      for (const locale of LOCALES) {
        const rawBucket = (parsed.outcomesByLocale as Partial<Record<Locale, unknown>>)[locale];
        normalizedOutcomesByLocale[locale] = normalizeOutcomeMap(rawBucket);
      }
    }

    return {
      version: 3,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      counts: mergedCounts,
      countsByLocale: normalizedByLocale,
      outcomesByLocale: normalizedOutcomesByLocale,
    };
  } catch {
    return createDefaultStore();
  }
}

async function writeStore(store: QueryStatsStore): Promise<void> {
  const dir = dirname(STORE_PATH);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${STORE_PATH}.tmp-${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmpPath, STORE_PATH);
}

function createDefaultStore(): QueryStatsStore {
  return {
    version: 3,
    updatedAt: new Date().toISOString(),
    counts: {},
    countsByLocale: createLocaleBuckets(),
    outcomesByLocale: createOutcomeBuckets(),
  };
}

function createLocaleBuckets(): Record<Locale, QueryCountMap> {
  const buckets = {} as Record<Locale, QueryCountMap>;
  for (const locale of LOCALES) {
    buckets[locale] = {};
  }
  return buckets;
}

function normalizeCountMap(rawCounts: unknown): QueryCountMap {
  if (!rawCounts || typeof rawCounts !== "object") return {};
  const normalizedCounts: QueryCountMap = {};

  for (const [query, value] of Object.entries(rawCounts as Record<string, unknown>)) {
    const normalizedQuery = normalizeForSearch(query);
    const normalizedValue = typeof value === "number" ? Math.max(0, Math.floor(value)) : 0;
    if (!normalizedQuery || !normalizedValue) continue;
    normalizedCounts[normalizedQuery] = (normalizedCounts[normalizedQuery] ?? 0) + normalizedValue;
  }

  return normalizedCounts;
}

function createOutcomeBuckets(): Record<Locale, QueryOutcomeMap> {
  const buckets = {} as Record<Locale, QueryOutcomeMap>;
  for (const locale of LOCALES) {
    buckets[locale] = {};
  }
  return buckets;
}

function normalizeOutcomeMap(rawOutcomes: unknown): QueryOutcomeMap {
  if (!rawOutcomes || typeof rawOutcomes !== "object") return {};
  const normalized: QueryOutcomeMap = {};

  for (const [query, value] of Object.entries(rawOutcomes as Record<string, unknown>)) {
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) continue;
    if (!value || typeof value !== "object") continue;
    const rawRecord = value as Partial<QueryOutcomeRecord>;
    const total = typeof rawRecord.total === "number" ? Math.max(0, Math.floor(rawRecord.total)) : 0;
    const zero = typeof rawRecord.zero === "number" ? Math.max(0, Math.floor(rawRecord.zero)) : 0;
    if (total <= 0 && zero <= 0) continue;
    normalized[normalizedQuery] = {
      total: Math.max(total, zero),
      zero: Math.min(Math.max(zero, 0), Math.max(total, zero)),
    };
  }

  return normalized;
}

function mergeLocaleCounts(countsByLocale: Record<Locale, QueryCountMap>): QueryCountMap {
  const merged: QueryCountMap = {};
  for (const locale of LOCALES) {
    for (const [query, value] of Object.entries(countsByLocale[locale])) {
      merged[query] = (merged[query] ?? 0) + value;
    }
  }
  return merged;
}

function mergeLocaleOutcomes(outcomesByLocale: Record<Locale, QueryOutcomeMap>): QueryOutcomeMap {
  const merged: QueryOutcomeMap = {};
  for (const locale of LOCALES) {
    for (const [query, value] of Object.entries(outcomesByLocale[locale])) {
      const current = merged[query] ?? { total: 0, zero: 0 };
      merged[query] = {
        total: current.total + value.total,
        zero: current.zero + value.zero,
      };
    }
  }
  return merged;
}

function escapeCsv(value: string): string {
  const normalized = value.replace(/"/g, "\"\"");
  return `"${normalized}"`;
}
