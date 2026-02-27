"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState, useSyncExternalStore } from "react";
import PageHero from "../components/PageHero";
import { useI18n } from "../components/i18n/I18nProvider";
import { ARTICLES, estimateArticleReadMinutes, getArticleSubtitle, getArticleTitle } from "../lib/articlesCatalog";
import {
  DRAFT_KEY,
  PUBLISH_REGISTRY_KEY,
  loadPublishRegistryFromStorage,
  parseStoredDraft,
  type PublishRegistryEntry,
} from "../lib/articlesDraft";
import { getArticleCreateHref, getArticleHref, getArticlePreviewHref } from "../lib/i18n/routing";
import { toIntlLocale } from "../lib/i18n/format";

type LocalDraftMeta = {
  exists: boolean;
  title: string;
  slug: string;
  status: "draft" | "ready" | "scheduled" | "published";
};

type StorageState = {
  localDraft: LocalDraftMeta;
  publishRegistry: Record<string, PublishRegistryEntry>;
};

const EMPTY_LOCAL_DRAFT: LocalDraftMeta = {
  exists: false,
  title: "",
  slug: "",
  status: "draft",
};
const EMPTY_PUBLISH_REGISTRY: Record<string, PublishRegistryEntry> = {};
const SERVER_STORAGE_STATE: StorageState = {
  localDraft: EMPTY_LOCAL_DRAFT,
  publishRegistry: EMPTY_PUBLISH_REGISTRY,
};

let lastDraftRaw: string | null | undefined;
let lastRegistryRaw: string | null | undefined;
let lastFallbackTitle: string | undefined;
let lastClientSnapshot: StorageState = SERVER_STORAGE_STATE;

function loadLocalDraftFromStorage(
  registry: Record<string, PublishRegistryEntry>,
  draftRaw: string | null,
  fallbackTitle: string
): LocalDraftMeta {
  try {
    if (!draftRaw) return EMPTY_LOCAL_DRAFT;
    const parsed = parseStoredDraft(draftRaw);
    if (!parsed || !parsed.blocks.length) return EMPTY_LOCAL_DRAFT;
    const title = parsed.title.trim() || fallbackTitle;
    const slug = parsed.slug.trim().toLowerCase() || "";
    const slugTaken = !!slug && ARTICLES.some((article) => article.slug.toLowerCase() === slug);
    const ready = !!title && !!slug && !slugTaken;
    const status = slug ? registry[slug]?.status : undefined;
    return {
      exists: true,
      title,
      slug,
      status: status === "published" ? "published" : status === "scheduled" ? "scheduled" : ready ? "ready" : "draft",
    };
  } catch {
    return EMPTY_LOCAL_DRAFT;
  }
}

function getCachedClientStorageSnapshot(fallbackTitle: string): StorageState {
  if (typeof window === "undefined") return SERVER_STORAGE_STATE;

  const draftRaw = localStorage.getItem(DRAFT_KEY);
  const registryRaw = localStorage.getItem(PUBLISH_REGISTRY_KEY);

  if (draftRaw === lastDraftRaw && registryRaw === lastRegistryRaw && fallbackTitle === lastFallbackTitle) {
    return lastClientSnapshot;
  }

  const registry = loadPublishRegistryFromStorage();
  const localDraft = loadLocalDraftFromStorage(registry, draftRaw, fallbackTitle);

  lastDraftRaw = draftRaw;
  lastRegistryRaw = registryRaw;
  lastFallbackTitle = fallbackTitle;
  lastClientSnapshot = { localDraft, publishRegistry: registry };
  return lastClientSnapshot;
}

function subscribeStorage(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === DRAFT_KEY || event.key === PUBLISH_REGISTRY_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export default function ArticlesPage() {
  const { locale, t } = useI18n();
  const intlLocale = toIntlLocale(locale);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"new" | "old" | "title">("new");
  const [scope, setScope] = useState<"all" | "published" | "scheduled" | "unpublished">("all");
  const clientStorageState = useSyncExternalStore<StorageState>(
    subscribeStorage,
    () => getCachedClientStorageSnapshot(t("articles.draft.fallbackTitle")),
    () => SERVER_STORAGE_STATE
  );
  const localDraft = clientStorageState.localDraft;
  const publishRegistry = clientStorageState.publishRegistry;

  const visibleArticles = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(intlLocale);
    const filteredByQuery = !q
      ? ARTICLES
      : ARTICLES.filter((article) =>
          `${getArticleTitle(article, locale)} ${getArticleSubtitle(article, locale)} ${article.publishedAt ?? ""}`
            .toLocaleLowerCase(intlLocale)
            .includes(q)
        );
    const filteredByScope = filteredByQuery.filter((article) => {
      const entry = publishRegistry[article.slug.toLowerCase()];
      const isPublished = entry?.status === "published" || (!!article.publishedAt && !entry);
      const isScheduled = entry?.status === "scheduled";
      if (scope === "published") return isPublished;
      if (scope === "scheduled") return isScheduled;
      if (scope === "unpublished") return !isPublished;
      return true;
    });
    return [...filteredByScope].sort((a, b) => {
      if (sortBy === "title") return getArticleTitle(a, locale).localeCompare(getArticleTitle(b, locale), intlLocale);
      const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return sortBy === "old" ? aTime - bTime : bTime - aTime;
    });
  }, [intlLocale, locale, publishRegistry, query, scope, sortBy]);

  const articleCounters = useMemo(() => {
    const published = ARTICLES.filter((article) => {
      const entry = publishRegistry[article.slug.toLowerCase()];
      return entry?.status === "published" || (!!article.publishedAt && !entry);
    }).length;
    const scheduled = ARTICLES.filter((article) => publishRegistry[article.slug.toLowerCase()]?.status === "scheduled").length;
    const unpublished = ARTICLES.length - published - scheduled;
    return { all: ARTICLES.length, published, scheduled, unpublished };
  }, [publishRegistry]);

  return (
    <main className="rr-article-main">
      <PageHero title={t("articles.title")} subtitle={t("articles.subtitle")} />

      <section className="rr-article-shell mt-8 space-y-5">
        <div className="rr-article-panel flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <input
              data-testid="articles-search-input"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              className="rr-article-input max-w-[340px]"
              placeholder={t("articles.searchPlaceholder")}
            />
            <select
              data-testid="articles-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.currentTarget.value as "new" | "old" | "title")}
              className="rr-article-input max-w-[220px]"
            >
              <option value="new">{t("articles.sort.new")}</option>
              <option value="old">{t("articles.sort.old")}</option>
              <option value="title">{t("articles.sort.title")}</option>
            </select>
            <div className="flex flex-wrap items-center gap-2">
              <button
                data-testid="articles-scope-all"
                onClick={() => setScope("all")}
                className={`rounded-md px-2.5 py-1 text-xs ${scope === "all" ? "bg-[#3b669e] text-white" : "bg-[#34363d] text-[#c8cdd6]"}`}
              >
                {t("articles.scope.all")} ({articleCounters.all})
              </button>
              <button
                data-testid="articles-scope-published"
                onClick={() => setScope("published")}
                className={`rounded-md px-2.5 py-1 text-xs ${scope === "published" ? "bg-[#3b669e] text-white" : "bg-[#34363d] text-[#c8cdd6]"}`}
              >
                {t("articles.scope.published")} ({articleCounters.published})
              </button>
              <button
                data-testid="articles-scope-unpublished"
                onClick={() => setScope("unpublished")}
                className={`rounded-md px-2.5 py-1 text-xs ${scope === "unpublished" ? "bg-[#3b669e] text-white" : "bg-[#34363d] text-[#c8cdd6]"}`}
              >
                {t("articles.scope.unpublished")} ({articleCounters.unpublished})
              </button>
              <button
                data-testid="articles-scope-scheduled"
                onClick={() => setScope("scheduled")}
                className={`rounded-md px-2.5 py-1 text-xs ${scope === "scheduled" ? "bg-[#3b669e] text-white" : "bg-[#34363d] text-[#c8cdd6]"}`}
              >
                {t("articles.scope.scheduled")} ({articleCounters.scheduled})
              </button>
            </div>
          </div>
          <Link
            data-testid="articles-create-link"
            href={getArticleCreateHref(locale)}
            className="rr-article-btn-accent px-4 py-2 text-sm font-semibold"
          >
            {t("articles.create")}
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {localDraft.exists && scope !== "published" ? (
            <article data-testid="articles-draft-card" className="rr-article-panel overflow-hidden border-[#3f6ba7]">
              <div className="p-4">
                <div
                  className={`inline-block rounded-sm px-2 py-1 text-xs font-semibold text-white ${
                    localDraft.status === "published"
                      ? "bg-[#2e7d50]"
                      : localDraft.status === "scheduled"
                        ? "bg-[#6f5f3b]"
                      : localDraft.status === "ready"
                        ? "bg-[#3b669e]"
                        : "bg-[#6f5f3b]"
                  }`}
                >
                  {localDraft.status === "published"
                    ? t("articles.draft.badge.published")
                    : localDraft.status === "scheduled"
                      ? t("articles.draft.badge.scheduled")
                    : localDraft.status === "ready"
                      ? t("articles.draft.badge.ready")
                      : t("articles.draft.badge.draft")}
                </div>
                <h2 className="mt-3 line-clamp-2 text-xl font-semibold text-white">{localDraft.title}</h2>
                <p className="mt-2 line-clamp-3 text-[15px] leading-6 text-[#aab0bb]">
                  {t("articles.draft.description")}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link href={getArticleCreateHref(locale)} className="rr-article-btn-accent px-3 py-1.5 text-sm">
                    {t("articles.draft.continue")}
                  </Link>
                  <Link href={getArticlePreviewHref(locale)} className="rr-article-btn px-3 py-1.5 text-sm">
                    {t("articles.draft.preview")}
                  </Link>
                </div>
              </div>
            </article>
          ) : null}
          {visibleArticles.map((article) => (
            <article key={article.slug} data-testid={`article-card-${article.slug}`} className="rr-article-panel overflow-hidden">
            {article.coverImage ? (
              <div className="relative h-48">
                <Image src={article.coverImage} alt={getArticleTitle(article, locale)} fill sizes="100vw" className="object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-3">
                  <h2 className="line-clamp-2 text-xl font-semibold text-white">{getArticleTitle(article, locale)}</h2>
                </div>
              </div>
            ) : null}
              <div className="p-4">
                {!article.coverImage ? <h2 className="line-clamp-2 text-xl font-semibold text-white">{getArticleTitle(article, locale)}</h2> : null}
                <p className="mt-2 line-clamp-3 text-[15px] leading-6 text-[#aab0bb]">{getArticleSubtitle(article, locale)}</p>
                <div className="mt-2 text-xs text-[#9aa3b2]">
                  {t("articles.card.reading")}: ~{estimateArticleReadMinutes(article)} {t("common.minutesShort")}
                </div>
                {publishRegistry[article.slug.toLowerCase()]?.status === "published" ? (
                  <div className="mt-2 inline-block rounded-sm bg-[#2e7d50] px-2 py-1 text-[11px] font-semibold text-white">
                    {t("articles.draft.badge.published")}
                  </div>
                ) : publishRegistry[article.slug.toLowerCase()]?.status === "scheduled" ? (
                  <div className="mt-2 inline-block rounded-sm bg-[#6f5f3b] px-2 py-1 text-[11px] font-semibold text-white">
                    {t("articles.draft.badge.scheduled")}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link
                    data-testid={`article-open-link-${article.slug}`}
                    href={getArticleHref(locale, article.slug)}
                    className="rr-article-btn-accent px-3 py-1.5 text-sm"
                  >
                    {t("articles.card.open")}
                  </Link>
                  {article.sourceUrl ? (
                    <a
                      href={article.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rr-article-btn px-3 py-1.5 text-sm"
                    >
                      {article.sourceLabel ?? t("common.source")}
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
        {!visibleArticles.length ? (
          <div data-testid="articles-empty-state" className="rr-article-panel p-6 text-center text-sm text-[#aab0bb]">
            {t("articles.empty")}
          </div>
        ) : null}
      </section>
    </main>
  );
}
