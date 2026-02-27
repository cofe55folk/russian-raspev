"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { emitAnalyticsClientEvent } from "../lib/analytics/emitClientEvent";
import type { I18nKey } from "../lib/i18n/messages";
import { getSearchHref, localizeHref } from "../lib/i18n/routing";
import { ensureAnalyticsSessionId, ensureVisitorId } from "../lib/analytics/clientIdentity";
import type { SearchResultItem, SearchSuggestResponse } from "../lib/search/types";
import { useI18n } from "./i18n/I18nProvider";

const SEARCH_LIMIT = 8;

function getResultKindLabel(kind: SearchResultItem["kind"], t: (key: I18nKey) => string) {
  if (kind === "sound") return t("header.searchKind.sound");
  if (kind === "article") return t("header.searchKind.article");
  if (kind === "video") return t("header.searchKind.video");
  if (kind === "event") return t("header.searchKind.event");
  return t("header.searchKind.education");
}

type HeaderSearchResultListProps = {
  title: string;
  items: SearchResultItem[];
  locale: "ru" | "en";
  onSelect: () => void;
  onResultClick: (item: SearchResultItem) => void;
  t: (key: I18nKey) => string;
  testId: string;
};

function HeaderSearchResultList({ title, items, locale, onSelect, onResultClick, t, testId }: HeaderSearchResultListProps) {
  if (!items.length) return null;
  return (
    <section className="space-y-2" data-testid={testId}>
      <h4 className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">{title}</h4>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={localizeHref(item.href, locale)}
              onClick={() => {
                onResultClick(item);
                onSelect();
              }}
              className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 transition hover:border-[#7ea4cd] hover:bg-white/10"
              data-testid={`header-search-result-${item.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9fc4ef]">
                  {getResultKindLabel(item.kind, t)}
                </div>
                <div
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    item.accessStatus === "unlocked" ? "bg-[#1f5b3b] text-[#b9f7d3]" : "bg-[#5d3a23] text-[#ffd9b5]"
                  }`}
                >
                  {item.accessStatus === "unlocked" ? t("search.access.unlocked") : t("search.access.locked")}
                </div>
              </div>
              <div className="text-sm font-medium text-white">{item.title}</div>
              <p className="line-clamp-2 text-xs text-white/70">{item.snippet}</p>
              {item.accessStatus === "locked" ? (
                <div className="mt-1 text-xs text-[#9fc4ef]">{t("search.openCard")}</div>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function HeaderSearch() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [data, setData] = useState<SearchSuggestResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const searchSubmitSeqRef = useRef(0);

  const hasQuery = query.trim().length > 0;
  const popularItems = data?.popular ?? [];
  const popularQueries = data?.popularQueries ?? [];
  const results = data?.results ?? [];
  const suggestions = data?.suggestions ?? [];
  const showEmpty = submittedQuery.length > 0 && !isLoading && results.length === 0;

  const loadSuggestions = useCallback(
    async (nextQuery: string) => {
      const currentReq = ++requestRef.current;
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/search/suggest?q=${encodeURIComponent(nextQuery)}&limit=${SEARCH_LIMIT}`,
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error("search_request_failed");
        const payload = (await response.json()) as SearchSuggestResponse;
        if (requestRef.current === currentReq) {
          setData(payload);
        }
      } catch {
        if (requestRef.current === currentReq) {
          setData({
            query: nextQuery,
            results: [],
            suggestions: [],
            popular: [],
            popularQueries: [],
          });
        }
      } finally {
        if (requestRef.current === currentReq) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  const openSearch = () => {
    setIsOpen(true);
  };

  const closeSearch = () => {
    setIsOpen(false);
    setQuery("");
    setSubmittedQuery("");
  };

  const openSearchPageForQuery = (rawQuery: string) => {
    const normalized = rawQuery.trim();
    const base = getSearchHref(locale);
    const href = normalized ? `${base}?q=${encodeURIComponent(normalized)}` : base;
    closeSearch();
    router.push(href);
  };

  const runSearch = async () => {
    const normalized = query.trim();
    setSubmittedQuery(normalized);
    if (normalized) {
      const visitorId = ensureVisitorId();
      const sessionId = ensureAnalyticsSessionId();
      const dedupeBucket = Math.floor(Date.now() / 2000);
      const dedupeKey = `search-submit:${visitorId}:${sessionId}:${normalized}:${dedupeBucket}:${searchSubmitSeqRef.current}`;
      searchSubmitSeqRef.current += 1;
      emitAnalyticsClientEvent({
        eventType: "search_submit",
        contentType: "search",
        contentId: normalized.slice(0, 180),
        dedupeKey,
      });
    }
    await loadSuggestions(normalized);
  };

  const trackSearchClick = useCallback((item: SearchResultItem) => {
    const visitorId = ensureVisitorId();
    const sessionId = ensureAnalyticsSessionId();
    const dedupeKey = `search-click:${visitorId}:${sessionId}:${item.id}`;
    emitAnalyticsClientEvent({
      eventType: "search_click",
      contentType: "search",
      contentId: item.id.slice(0, 180),
      dedupeKey,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    void loadSuggestions("");
  }, [isOpen, loadSuggestions]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      closeSearch();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSearch();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={rootRef} data-testid="header-search-root">
      <button
        type="button"
        aria-label={t("header.searchAria")}
        aria-expanded={isOpen}
        aria-controls="header-search-panel"
        onClick={openSearch}
        className={`text-sm text-white/90 transition hover:text-white ${isOpen ? "pointer-events-none opacity-0" : ""}`}
        data-testid="header-search-toggle"
      >
        {t("header.search")}
      </button>

      {isOpen ? (
        <div
          id="header-search-panel"
          className="absolute right-0 top-[calc(100%+10px)] z-[90] w-[min(96vw,1020px)] rounded-[28px] border border-white/15 bg-[#1b1f28]/95 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          data-testid="header-search-panel"
        >
          <div className="flex h-16 items-center gap-2 rounded-full border border-white/10 bg-[#232833] px-2.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSubmittedQuery("");
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void runSearch();
              }}
              placeholder={t("header.searchPlaceholder")}
              aria-label={t("header.searchAria")}
              className="h-12 w-full rounded-full bg-transparent px-1 text-base text-white outline-none placeholder:text-white/45"
              data-testid="header-search-input"
            />
            <button
              type="button"
              onClick={() => {
                void runSearch();
              }}
              className="h-11 rounded-full bg-[#ef765f] px-6 text-base font-semibold text-white transition hover:bg-[#f08a76]"
              aria-label={t("header.searchSubmitAria")}
              data-testid="header-search-submit"
            >
              {t("header.searchSubmit")}
            </button>
            <button
              type="button"
              onClick={closeSearch}
              className="h-11 rounded-full border border-white/15 bg-transparent px-4 text-xs text-white/75 transition hover:bg-white/10"
              aria-label={t("header.searchClose")}
              data-testid="header-search-close"
            >
              {t("header.searchClose")}
            </button>
          </div>

          <div className="mt-2 max-h-[52vh] space-y-3 overflow-y-auto rounded-[24px] border border-white/10 bg-[#232833] p-3">
            {isLoading && !data ? <p className="px-1 text-xs text-white/65">{t("header.searchLoading")}</p> : null}

            {!hasQuery && popularQueries.length ? (
              <section className="space-y-2" data-testid="header-search-popular-queries">
                <h4 className="px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/45">
                  {t("header.searchPopularQueries")}
                </h4>
                <ul className="space-y-1 rounded-2xl border border-white/6 bg-[#1d212b] p-2">
                  {popularQueries.map((item) => (
                    <li key={item}>
                      <button
                        type="button"
                        onClick={() => setQuery(item)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-lg text-white/90 transition hover:bg-white/8"
                        data-testid={`header-search-popular-query-${item}`}
                      >
                        <span className="text-xl text-white/45">◷</span>
                        <span>{item}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {!hasQuery ? (
              <HeaderSearchResultList
                title={t("header.searchPopular")}
                items={popularItems}
                locale={locale}
                onSelect={closeSearch}
                onResultClick={trackSearchClick}
                t={t}
                testId="header-search-popular"
              />
            ) : null}

            {submittedQuery.length > 0 && suggestions.length ? (
              <section className="space-y-2" data-testid="header-search-suggestions">
                <h4 className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">
                  {t("header.searchSuggestions")}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setQuery(item);
                        setSubmittedQuery(item);
                        void loadSuggestions(item);
                      }}
                      className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-[#b8d5f7] transition hover:bg-white/10"
                      data-testid={`header-search-suggestion-${item}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {submittedQuery.length > 0 ? (
              <HeaderSearchResultList
                title={t("header.searchResults")}
                items={results}
                locale={locale}
                onSelect={closeSearch}
                onResultClick={trackSearchClick}
                t={t}
                testId="header-search-results"
              />
            ) : null}

            {showEmpty ? (
              <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70" data-testid="header-search-empty">
                {t("header.searchEmpty")}
              </p>
            ) : null}

            {submittedQuery.length > 0 ? (
              <div className="px-1 pt-1">
                <button
                  type="button"
                  onClick={() => openSearchPageForQuery(submittedQuery)}
                  className="text-xs font-medium text-[#9fc4ef] underline-offset-4 hover:underline"
                  data-testid="header-search-open-full"
                >
                  {t("header.searchOpenFull")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
