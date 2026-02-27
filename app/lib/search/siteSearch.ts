import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTICLES, type ArticleBlock, type ArticleItem } from "../articlesCatalog";
import {
  COURSE_ITEMS,
  getCoursePremiumEntitlementCode,
  type CourseItem,
  type CourseMediaItem,
  type CourseTextItem,
} from "../coursesCatalog";
import { getPublishedEvents, type EventItem } from "../eventsCatalog";
import { MATERIAL_OFFERS, getMaterialOfferByEntitlementCode } from "../materialOffers";
import { SOUND_ITEMS, type SoundItem } from "../soundCatalog";
import { VIDEO_CATALOG_ITEMS } from "../videosCatalog";
import { normalizeForSearch, tokenize } from "./normalize";
import type { SearchResultItem, SearchSuggestResponse } from "./types";

type SearchDocument = {
  id: string;
  kind: SearchResultItem["kind"];
  title: string;
  href: string;
  snippets: string[];
  requiredEntitlement: string | null;
  facetRegion: string | null;
  facetEventDateIso: string | null;
  freshnessTs: number | null;
  normalizedTitle: string;
  normalizedBody: string;
};

type SearchIndex = {
  documents: SearchDocument[];
  popularDocuments: SearchDocument[];
  vocabulary: string[];
  tokenToDocumentIndexes: Map<string, number[]>;
};

type SuggestSearchOptions = {
  entitlements?: Iterable<string>;
  region?: string;
  timeWindow?: "all" | "upcoming" | "past";
};

type SearchSuggestCacheEntry = {
  expiresAt: number;
  payload: SearchSuggestResponse;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const MAX_SUGGESTIONS = 5;
const MAX_SNIPPET_LENGTH = 180;
const SEARCH_RESULT_CACHE_TTL_MS = resolvePositiveIntEnv("RR_SEARCH_SUGGEST_CACHE_TTL_MS", 15_000);
const SEARCH_RESULT_CACHE_MAX_ENTRIES = resolvePositiveIntEnv("RR_SEARCH_SUGGEST_CACHE_MAX_ENTRIES", 500);
const SEARCH_V2_RANKING_ENABLED = process.env.RR_SEARCH_V2_RANKING !== "0";
const SEARCH_SYNONYM_MAP: Record<string, string[]> = {
  многоголосие: ["ансамбл", "хор"],
  хор: ["ансамбл", "многоголос"],
  ансамбль: ["многоголос", "хор"],
  вокал: ["пение", "распев"],
  пение: ["вокал", "распев"],
  распевка: ["распев", "вокал"],
};

let searchIndexPromise: Promise<SearchIndex> | null = null;
const searchSuggestCache = new Map<string, SearchSuggestCacheEntry>();

export async function suggestSiteSearch(
  rawQuery: string,
  requestedLimit?: number,
  options?: SuggestSearchOptions
): Promise<SearchSuggestResponse> {
  const query = rawQuery.trim();
  const normalizedQuery = normalizeForSearch(query);
  const limit = normalizeLimit(requestedLimit);
  const index = await getSearchIndex();
  const entitlementSet = new Set<string>(Array.from(options?.entitlements ?? []).filter(Boolean));
  const activeRegion = options?.region?.trim() || "";
  const activeTimeWindow = options?.timeWindow && options.timeWindow !== "all" ? options.timeWindow : "all";

  if (!normalizedQuery) {
    return {
      query,
      results: [],
      suggestions: [],
      popular: index.popularDocuments
        .slice(0, limit)
        .map((item) => toResultItem(item, 100, item.snippets[0] ?? item.title, entitlementSet)),
      popularQueries: [],
    };
  }

  const tokens = tokenize(normalizedQuery);
  const expandedTokens = expandQueryTokens(tokens);
  const cacheKey = buildSearchSuggestCacheKey({
    normalizedQuery,
    limit,
    region: activeRegion,
    timeWindow: activeTimeWindow,
    entitlements: entitlementSet,
  });
  const cached = getCachedSearchSuggest(cacheKey, query);
  if (cached) return cached;

  const candidateDocuments = collectCandidateDocuments(index, expandedTokens);
  const ranked = candidateDocuments
    .map((document) => {
      if (!matchesFacetFilters(document, activeRegion, activeTimeWindow)) return null;
      const score = scoreDocument(document, normalizedQuery, expandedTokens);
      if (score <= 0) return null;
      return {
        item: toResultItem(document, score, pickBestSnippet(document, normalizedQuery, expandedTokens), entitlementSet),
        score,
      };
    })
    .filter((value): value is { item: SearchResultItem; score: number } => value !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);

  const suggestions = buildSuggestions(query, normalizedQuery, expandedTokens, ranked, index);

  const payload: SearchSuggestResponse = {
    query,
    results: ranked,
    suggestions,
    popular: index.popularDocuments
      .slice(0, limit)
      .map((item) => toResultItem(item, 100, item.snippets[0] ?? item.title, entitlementSet)),
    popularQueries: [],
  };
  setCachedSearchSuggest(cacheKey, payload);
  return payload;
}

function resolvePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < 0) return 0;
  return normalized;
}

function buildSearchSuggestCacheKey(params: {
  normalizedQuery: string;
  limit: number;
  region: string;
  timeWindow: "all" | "upcoming" | "past";
  entitlements: Set<string>;
}): string {
  const entitlementKey = Array.from(params.entitlements).sort().join(",");
  return `${params.normalizedQuery}|${params.limit}|${params.region}|${params.timeWindow}|${entitlementKey}`;
}

function cloneSearchSuggestResponse(payload: SearchSuggestResponse, queryOverride?: string): SearchSuggestResponse {
  return {
    query: queryOverride ?? payload.query,
    results: payload.results.map((item) => ({ ...item })),
    suggestions: [...payload.suggestions],
    popular: payload.popular.map((item) => ({ ...item })),
    popularQueries: [...payload.popularQueries],
  };
}

function getCachedSearchSuggest(cacheKey: string, queryOverride: string): SearchSuggestResponse | null {
  if (SEARCH_RESULT_CACHE_TTL_MS <= 0 || SEARCH_RESULT_CACHE_MAX_ENTRIES <= 0) return null;
  const now = Date.now();
  const cached = searchSuggestCache.get(cacheKey);
  if (!cached) return null;
  if (now >= cached.expiresAt) {
    searchSuggestCache.delete(cacheKey);
    return null;
  }

  // Refresh insertion order to keep frequently used entries when we prune.
  searchSuggestCache.delete(cacheKey);
  searchSuggestCache.set(cacheKey, cached);
  return cloneSearchSuggestResponse(cached.payload, queryOverride);
}

function setCachedSearchSuggest(cacheKey: string, payload: SearchSuggestResponse): void {
  if (SEARCH_RESULT_CACHE_TTL_MS <= 0 || SEARCH_RESULT_CACHE_MAX_ENTRIES <= 0) return;
  const now = Date.now();
  pruneSearchSuggestCache(now);
  searchSuggestCache.set(cacheKey, {
    expiresAt: now + SEARCH_RESULT_CACHE_TTL_MS,
    payload: cloneSearchSuggestResponse(payload),
  });
  while (searchSuggestCache.size > SEARCH_RESULT_CACHE_MAX_ENTRIES) {
    const oldestKey = searchSuggestCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    searchSuggestCache.delete(oldestKey);
  }
}

function pruneSearchSuggestCache(now: number): void {
  for (const [cacheKey, value] of searchSuggestCache.entries()) {
    if (now >= value.expiresAt) {
      searchSuggestCache.delete(cacheKey);
    }
  }
}

function collectCandidateDocuments(index: SearchIndex, tokens: string[]): SearchDocument[] {
  const candidateIndexes = new Set<number>();
  for (const token of tokens) {
    if (token.length < 2) continue;
    const docIndexes = index.tokenToDocumentIndexes.get(token);
    if (!docIndexes?.length) continue;
    for (const docIndex of docIndexes) {
      candidateIndexes.add(docIndex);
    }
  }

  if (!candidateIndexes.size) {
    return index.documents;
  }

  const result: SearchDocument[] = [];
  for (const docIndex of candidateIndexes) {
    const document = index.documents[docIndex];
    if (document) result.push(document);
  }
  return result;
}

async function getSearchIndex(): Promise<SearchIndex> {
  if (!searchIndexPromise) {
    searchIndexPromise = buildSearchIndex();
  }
  return searchIndexPromise;
}

async function buildSearchIndex(): Promise<SearchIndex> {
  const soundDocuments = await Promise.all(SOUND_ITEMS.map((item) => buildSoundDocument(item)));
  const articleDocuments = ARTICLES.map((item) => buildArticleDocument(item));
  const videoDocuments = VIDEO_CATALOG_ITEMS.map((item) => buildVideoDocument(item));
  const eventDocuments = getPublishedEvents().map((item) => buildEventDocument(item));
  const courseDocuments = COURSE_ITEMS.flatMap((item) => buildCourseDocuments(item));
  const offerDocuments = MATERIAL_OFFERS.map((item) => buildMaterialOfferDocument(item));
  const documents = [...soundDocuments, ...articleDocuments, ...videoDocuments, ...eventDocuments, ...courseDocuments, ...offerDocuments];

  const popularDocuments = soundDocuments.slice(0, 6);
  const tokenToDocumentIndexes = new Map<string, number[]>();
  const vocabularySet = new Set<string>();
  for (let documentIndex = 0; documentIndex < documents.length; documentIndex += 1) {
    const doc = documents[documentIndex];
    const docTokens = new Set<string>([...tokenize(doc.normalizedTitle), ...tokenize(doc.normalizedBody)]);
    for (const token of docTokens) {
      if (token.length >= 3) vocabularySet.add(token);
      if (token.length < 2) continue;
      const current = tokenToDocumentIndexes.get(token);
      if (current) {
        current.push(documentIndex);
      } else {
        tokenToDocumentIndexes.set(token, [documentIndex]);
      }
    }
  }

  return {
    documents,
    popularDocuments,
    vocabulary: Array.from(vocabularySet),
    tokenToDocumentIndexes,
  };
}

async function buildSoundDocument(item: SoundItem): Promise<SearchDocument> {
  const lyrics = await readTeleprompterLines(item.teleprompterSourceUrl);
  const titleVariants = [item.title, item.titleTranslations?.ru, item.titleTranslations?.en].filter(Boolean).join(" ");
  const genreVariants = [item.genre, item.genreTranslations?.ru, item.genreTranslations?.en].filter(Boolean).join(" ");
  const archiveVariants = [item.archiveInfo, item.archiveInfoTranslations?.ru, item.archiveInfoTranslations?.en]
    .filter(Boolean)
    .join(" ");
  const snippets = uniqueSnippets([
    ...lyrics,
    genreVariants,
    item.modernPerformer ?? "",
    item.authenticPerformer ?? "",
    item.leadSinger ?? "",
    archiveVariants,
    item.recordingAuthor ?? "",
  ]);

  const body = [
    titleVariants,
    genreVariants,
    item.modernPerformer,
    item.authenticPerformer,
    item.leadSinger,
    archiveVariants,
    item.recordingAuthor,
    ...lyrics,
  ]
    .filter(Boolean)
    .join(" ");

  return createSearchDocument({
    id: `sound:${item.slug}`,
    kind: "sound",
    title: item.title,
    href: `/sound/${item.slug}`,
    body,
    snippets: snippets.length ? snippets : [item.title],
    requiredEntitlement: null,
  });
}

function buildArticleDocument(item: ArticleItem): SearchDocument {
  const allTitles = [item.title, item.titleTranslations?.ru, item.titleTranslations?.en].filter(Boolean).join(" ");
  const allSubtitles = [item.subtitle, item.subtitleTranslations?.ru, item.subtitleTranslations?.en]
    .filter(Boolean)
    .join(" ");
  const sectionSnippets = item.sections.flatMap((section) => [
    section.heading ?? "",
    ...section.paragraphs,
    ...(section.audios ?? []).flatMap((audio) => [audio.title, audio.note ?? ""]),
  ]);
  const blockSnippets = (item.blocks ?? []).flatMap(extractBlockSnippets);
  const bodyParts = [
    allTitles,
    allSubtitles,
    item.sourceLabel ?? "",
    ...sectionSnippets,
    ...blockSnippets,
  ];

  return createSearchDocument({
    id: `article:${item.slug}`,
    kind: "article",
    title: item.title,
    href: `/articles/${item.slug}`,
    body: bodyParts.join(" "),
    snippets: uniqueSnippets([item.subtitle, ...sectionSnippets, ...blockSnippets]),
    requiredEntitlement: null,
  });
}

function buildVideoDocument(item: (typeof VIDEO_CATALOG_ITEMS)[number]): SearchDocument {
  return createSearchDocument({
    id: `video:${item.id}`,
    kind: "video",
    title: item.title,
    href: "/video",
    body: `${item.title} ${item.description}`,
    snippets: uniqueSnippets([item.description, item.title]),
    requiredEntitlement: null,
  });
}

function buildEventDocument(event: EventItem): SearchDocument {
  const ru = event.translations.ru;
  const en = event.translations.en;
  const title = ru?.title || en?.title || event.slug;
  const body = [
    ru?.title,
    en?.title,
    ru?.description,
    en?.description,
    ru?.venue,
    en?.venue,
    ru?.city,
    en?.city,
    ...event.tags,
  ]
    .filter(Boolean)
    .join(" ");

  return createSearchDocument({
    id: `event:${event.slug}`,
    kind: "event",
    title,
    href: `/events/${event.slug}`,
    body,
    snippets: uniqueSnippets([ru?.description, en?.description, ru?.venue, en?.venue, ru?.city, en?.city]),
    facetRegion: ru?.city ?? en?.city ?? null,
    facetEventDateIso: event.dateIso,
    freshnessTs: Number.isFinite(new Date(event.dateIso).getTime()) ? new Date(event.dateIso).getTime() : null,
    requiredEntitlement: null,
  });
}

function buildCourseDocuments(course: CourseItem): SearchDocument[] {
  const premiumEntitlementCode = getCoursePremiumEntitlementCode(course);
  const premiumOffer = premiumEntitlementCode ? getMaterialOfferByEntitlementCode(premiumEntitlementCode) : null;
  const premiumOfferHref = premiumOffer ? `/materials/${premiumOffer.slug}` : null;
  const courseTitle = [course.title, course.titleTranslations?.ru, course.titleTranslations?.en].filter(Boolean).join(" ");
  const courseSubtitle = [course.subtitle, course.subtitleTranslations?.ru, course.subtitleTranslations?.en]
    .filter(Boolean)
    .join(" ");
  const moduleTexts = course.modules.flatMap((module) => [module.title, module.summary, ...module.lessons.map((item) => item.title)]);
  const courseHref = `/education/${course.slug}`;
  const baseDocs: SearchDocument[] = [
    createSearchDocument({
      id: `education:${course.slug}`,
      kind: "education",
      title: course.title,
      href: courseHref,
      body: [
        courseTitle,
        courseSubtitle,
        course.description ?? "",
        course.tagline ?? "",
        course.scheduleLabel ?? "",
        course.durationLabel ?? "",
        course.formatLabel ?? "",
        ...course.audience,
        ...course.outcomes,
        ...moduleTexts,
        ...course.bonuses,
        ...(course.author
          ? [
              course.author.name,
              course.author.bio,
              course.author.experienceLabel ?? "",
              course.author.geographyLabel ?? "",
              course.author.educationLabel ?? "",
            ]
          : []),
        ...course.faq,
      ].join(" "),
      snippets: uniqueSnippets([course.subtitle, course.description, ...moduleTexts.slice(0, 6)]),
      requiredEntitlement: null,
    }),
  ];

  const mediaDocs = [
    ...toCourseMediaDocs(course, "Видео", course.freeVideos, null, null),
    ...toCourseMediaDocs(course, "Видео", course.premiumVideos, premiumEntitlementCode, premiumOfferHref),
    ...toCourseMediaDocs(course, "Аудио", course.freeAudios, null, null),
    ...toCourseMediaDocs(course, "Аудио", course.premiumAudios, premiumEntitlementCode, premiumOfferHref),
    ...toCourseTextDocs(course, "Текст", course.freeTexts, null, null),
    ...toCourseTextDocs(course, "Текст", course.premiumTexts, premiumEntitlementCode, premiumOfferHref),
  ];

  return [...baseDocs, ...mediaDocs];
}

function toCourseMediaDocs(
  course: CourseItem,
  sectionLabel: string,
  items: CourseMediaItem[],
  requiredEntitlement: string | null,
  offerHref: string | null
): SearchDocument[] {
  return items.map((item) =>
    createSearchDocument({
      id: `education:${course.slug}:${sectionLabel}:${item.id}`,
      kind: "education",
      title: `${course.title}: ${item.title}`,
      href: requiredEntitlement && offerHref ? offerHref : `/education/${course.slug}`,
      body: `${course.title} ${item.title} ${item.description ?? ""} ${sectionLabel}`,
      snippets: uniqueSnippets([`${sectionLabel}: ${item.title}`, item.description]),
      requiredEntitlement,
    })
  );
}

function toCourseTextDocs(
  course: CourseItem,
  sectionLabel: string,
  items: CourseTextItem[],
  requiredEntitlement: string | null,
  offerHref: string | null
): SearchDocument[] {
  return items.map((item) =>
    createSearchDocument({
      id: `education:${course.slug}:${sectionLabel}:${item.id}`,
      kind: "education",
      title: `${course.title}: ${item.title}`,
      href: requiredEntitlement && offerHref ? offerHref : `/education/${course.slug}`,
      body: `${course.title} ${item.title} ${item.description ?? ""} ${sectionLabel}`,
      snippets: uniqueSnippets([`${sectionLabel}: ${item.title}`, item.description]),
      requiredEntitlement,
    })
  );
}

function buildMaterialOfferDocument(offer: (typeof MATERIAL_OFFERS)[number]): SearchDocument {
  return createSearchDocument({
    id: `offer:${offer.slug}`,
    kind: "education",
    title: offer.title,
    href: `/materials/${offer.slug}`,
    body: [
      offer.subtitle,
      offer.description,
      ...offer.previewBullets,
      ...offer.searchKeywords,
      ...offer.includes.flatMap((item) => [item.title, item.description]),
    ].join(" "),
    snippets: uniqueSnippets([
      offer.subtitle,
      offer.description,
      ...offer.includes.map((item) => `${item.title}: ${item.description}`),
    ]),
    requiredEntitlement: offer.entitlementCode,
  });
}

function createSearchDocument(params: {
  id: string;
  kind: SearchResultItem["kind"];
  title: string;
  href: string;
  body: string;
  snippets: string[];
  requiredEntitlement: string | null;
  facetRegion?: string | null;
  facetEventDateIso?: string | null;
  freshnessTs?: number | null;
}): SearchDocument {
  const snippets = uniqueSnippets(params.snippets);
  const normalizedTitle = normalizeForSearch(params.title);
  const normalizedBody = normalizeForSearch([params.title, params.body, ...snippets].join(" "));
  return {
    id: params.id,
    kind: params.kind,
    title: params.title,
    href: params.href,
    snippets,
    requiredEntitlement: params.requiredEntitlement,
    facetRegion: params.facetRegion?.trim() || null,
    facetEventDateIso: params.facetEventDateIso?.trim() || null,
    freshnessTs: typeof params.freshnessTs === "number" && Number.isFinite(params.freshnessTs) ? params.freshnessTs : null,
    normalizedTitle,
    normalizedBody,
  };
}

function scoreDocument(document: SearchDocument, query: string, tokens: string[]): number {
  let score = 0;
  const queryLength = query.length;
  if (!queryLength) return score;

  if (document.normalizedTitle.includes(query)) {
    score += 130;
    if (SEARCH_V2_RANKING_ENABLED && document.normalizedTitle.startsWith(query)) {
      score += 24;
    }
  }
  if (document.normalizedBody.includes(query)) {
    score += 100;
  }

  let tokenHits = 0;
  for (const token of tokens) {
    if (token.length < 2) continue;
    const inTitle = document.normalizedTitle.includes(token);
    const inBody = document.normalizedBody.includes(token);
    if (inTitle) score += 24;
    if (inBody) score += 10;
    if (inTitle || inBody) tokenHits += 1;
  }

  if (tokens.length > 1) {
    score += tokenHits * 8;
    if (tokenHits === tokens.length) score += 26;
  }

  if (score === 0) {
    const fuzzy = bestTitleSimilarity(query, document.normalizedTitle);
    if (fuzzy >= 0.72) {
      score += Math.round(fuzzy * 60);
    }
  }

  if (SEARCH_V2_RANKING_ENABLED && document.freshnessTs) {
    const now = Date.now();
    const distanceDays = Math.abs(document.freshnessTs - now) / (24 * 60 * 60 * 1000);
    if (document.freshnessTs >= now) {
      score += Math.max(0, 24 - Math.min(24, distanceDays));
    } else {
      score += Math.max(0, 8 - Math.min(8, distanceDays / 2));
    }
  }

  return score;
}

function expandQueryTokens(tokens: string[]): string[] {
  if (!SEARCH_V2_RANKING_ENABLED) return tokens;
  const expanded = new Set<string>(tokens);
  for (const token of tokens) {
    const synonyms = SEARCH_SYNONYM_MAP[token];
    if (!synonyms?.length) continue;
    for (const synonym of synonyms) {
      expanded.add(synonym);
    }
  }
  return Array.from(expanded);
}

function pickBestSnippet(document: SearchDocument, query: string, tokens: string[]): string {
  let bestSnippet = document.snippets[0] ?? document.title;
  let bestScore = -1;

  for (const rawSnippet of document.snippets) {
    const snippet = rawSnippet.trim();
    if (!snippet) continue;
    const normalizedSnippet = normalizeForSearch(snippet);
    let score = 0;
    if (query && normalizedSnippet.includes(query)) score += 120;
    const tokenHits = tokens.filter((token) => token.length >= 2 && normalizedSnippet.includes(token)).length;
    score += tokenHits * 18;
    if (tokens.length > 1 && tokenHits === tokens.length) score += 25;
    if (score > bestScore) {
      bestScore = score;
      bestSnippet = snippet;
    }
  }

  return compactSnippet(bestSnippet, tokens);
}

function compactSnippet(snippet: string, tokens: string[]): string {
  const clean = snippet.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_SNIPPET_LENGTH) return clean;

  const markerToken = tokens.find((token) => token.length >= 3);
  if (!markerToken) return `${clean.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;

  const lowered = clean.toLowerCase().replace(/ё/g, "е");
  const markerIndex = lowered.indexOf(markerToken);
  if (markerIndex < 0) return `${clean.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;

  const windowStart = Math.max(0, markerIndex - 70);
  const windowEnd = Math.min(clean.length, windowStart + MAX_SNIPPET_LENGTH);
  const withPrefix = windowStart > 0 ? `…${clean.slice(windowStart, windowEnd).trim()}` : clean.slice(windowStart, windowEnd).trim();
  return windowEnd < clean.length ? `${withPrefix}…` : withPrefix;
}

function toResultItem(
  document: SearchDocument,
  score: number,
  snippet: string,
  entitlementSet: Set<string>
): SearchResultItem {
  const accessStatus = hasSearchAccess(document.requiredEntitlement, entitlementSet) ? "unlocked" : "locked";
  return {
    id: document.id,
    kind: document.kind,
    title: document.title,
    href: document.href,
    snippet,
    score,
    accessStatus,
    requiredEntitlement: document.requiredEntitlement,
    region: document.facetRegion,
    eventDateIso: document.facetEventDateIso,
  };
}

function matchesFacetFilters(document: SearchDocument, activeRegion: string, timeWindow: "all" | "upcoming" | "past"): boolean {
  if (activeRegion) {
    if (!document.facetRegion) return false;
    if (document.facetRegion !== activeRegion) return false;
  }
  if (timeWindow === "all") return true;
  if (document.kind !== "event" || !document.facetEventDateIso) return false;
  const ts = new Date(document.facetEventDateIso).getTime();
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  if (timeWindow === "upcoming") return ts >= now;
  return ts < now;
}

function hasSearchAccess(requiredEntitlement: string | null, entitlementSet: Set<string>): boolean {
  if (!requiredEntitlement) return true;
  return entitlementSet.has(requiredEntitlement);
}

function buildSuggestions(
  rawQuery: string,
  normalizedQuery: string,
  tokens: string[],
  results: SearchResultItem[],
  index: SearchIndex
): string[] {
  const suggestions = new Set<string>();
  const normalizedOriginal = normalizeForSearch(rawQuery);

  const maybeCorrected = replaceLikelyTypos(tokens, index.vocabulary);
  if (maybeCorrected && normalizeForSearch(maybeCorrected) !== normalizedOriginal) {
    suggestions.add(maybeCorrected);
  }

  if (!results.length) {
    for (const candidate of suggestByTitleSimilarity(normalizedQuery, index.documents, 3)) {
      if (normalizeForSearch(candidate) !== normalizedOriginal) {
        suggestions.add(candidate);
      }
      if (suggestions.size >= MAX_SUGGESTIONS) break;
    }
  } else {
    for (const item of results.slice(0, 3)) {
      if (normalizeForSearch(item.title) !== normalizedOriginal) {
        suggestions.add(item.title);
      }
      if (suggestions.size >= MAX_SUGGESTIONS) break;
    }
  }

  return Array.from(suggestions).slice(0, MAX_SUGGESTIONS);
}

function replaceLikelyTypos(tokens: string[], vocabulary: string[]): string | null {
  if (!tokens.length) return null;
  let changed = false;
  const rewritten = tokens.map((token) => {
    if (token.length < 3) return token;
    if (vocabulary.includes(token)) return token;
    const suggested = findClosestToken(token, vocabulary);
    if (!suggested || suggested === token) return token;
    changed = true;
    return suggested;
  });
  if (!changed) return null;
  return rewritten.join(" ");
}

function findClosestToken(token: string, vocabulary: string[]): string | null {
  let bestToken: string | null = null;
  let bestScore = 0;
  for (const candidate of vocabulary) {
    if (Math.abs(candidate.length - token.length) > 2) continue;
    if (candidate[0] !== token[0]) continue;
    const distance = levenshtein(token, candidate);
    if (distance > 2) continue;
    const similarity = 1 - distance / Math.max(token.length, candidate.length);
    if (similarity > bestScore) {
      bestScore = similarity;
      bestToken = candidate;
    }
  }
  return bestScore >= 0.66 ? bestToken : null;
}

function suggestByTitleSimilarity(query: string, documents: SearchDocument[], limit: number): string[] {
  return documents
    .map((item) => ({
      title: item.title,
      score: bestTitleSimilarity(query, item.normalizedTitle),
    }))
    .filter((item) => item.score >= 0.42)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.title);
}

function bestTitleSimilarity(query: string, title: string): number {
  if (!query || !title) return 0;
  if (title.includes(query) || query.includes(title)) return 0.95;

  const queryTokens = tokenize(query).filter((token) => token.length >= 3);
  const titleTokens = tokenize(title).filter((token) => token.length >= 3);
  if (!queryTokens.length || !titleTokens.length) {
    return stringSimilarity(query, title);
  }

  const tokenScore =
    queryTokens.reduce((acc, token) => {
      let best = 0;
      for (const titleToken of titleTokens) {
        const score = stringSimilarity(token, titleToken);
        if (score > best) best = score;
      }
      return acc + best;
    }, 0) / queryTokens.length;

  const phraseScore = stringSimilarity(query, title);
  return Math.max(tokenScore, phraseScore);
}

function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distance = levenshtein(a, b);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, idx) => idx);
  const curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    const ca = a[i - 1];
    for (let j = 1; j <= b.length; j += 1) {
      const cb = b[j - 1];
      const cost = ca === cb ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function normalizeLimit(requestedLimit?: number): number {
  if (!requestedLimit || Number.isNaN(requestedLimit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(requestedLimit)));
}

function uniqueSnippets(values: Array<string | undefined | null>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    if (unique.has(clean)) continue;
    unique.add(clean);
  }
  return Array.from(unique);
}

function extractBlockSnippets(block: ArticleBlock): string[] {
  if (block.type === "text") {
    return splitSentences(stripHtml(block.html));
  }
  if (block.type === "quote") {
    return uniqueSnippets([block.text, block.author]);
  }
  if (block.type === "audio") {
    return uniqueSnippets([`Аудио: ${block.title}`, block.caption]);
  }
  if (block.type === "video") {
    return uniqueSnippets([`Видео: ${block.title ?? ""}`, block.caption]);
  }
  if (block.type === "table") {
    return splitSentences([block.caption ?? "", ...block.rows.flat()].join(" "));
  }
  if (block.type === "playlist") {
    return uniqueSnippets([`Плейлист: ${block.title ?? ""}`, ...block.songSlugs]);
  }
  if (block.type === "ordered_list") {
    return uniqueSnippets(block.items);
  }
  return uniqueSnippets([block.caption]);
}

function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 48);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function readTeleprompterLines(sourceUrl?: string | null): Promise<string[]> {
  if (!sourceUrl) return [];
  const normalizedPath = sourceUrl.startsWith("/") ? sourceUrl.slice(1) : sourceUrl;
  const absolutePath = join(process.cwd(), "public", normalizedPath);

  try {
    const raw = await readFile(absolutePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return uniqueSnippets(extractTextLines(parsed)).slice(0, 120);
  } catch {
    return [];
  }
}

function extractTextLines(payload: unknown): string[] {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    return payload.flatMap((item) => extractTextLines(item));
  }

  if (typeof payload === "string") return [payload];
  if (typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  const lines: string[] = [];

  for (const key of ["text", "line", "lyrics", "rawText"]) {
    const value = record[key];
    if (typeof value === "string") lines.push(value);
  }

  for (const key of ["anchors", "lines", "items", "segments", "results"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      lines.push(...value.flatMap((item) => extractTextLines(item)));
    }
  }

  return lines;
}
