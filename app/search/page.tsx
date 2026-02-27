import Link from "next/link";
import AnalyticsTrackedLink from "../components/analytics/AnalyticsTrackedLink";
import SearchZeroResultsBeacon from "../components/analytics/SearchZeroResultsBeacon";
import PageHero from "../components/PageHero";
import { createAnalyticsEvent } from "../lib/analytics/store-file";
import { readAuthSessionFromCookieStore } from "../lib/auth/session";
import { getLocalizedPublishedEvents } from "../lib/eventsCatalog";
import { I18N_MESSAGES, type I18nKey } from "../lib/i18n/messages";
import { getEventHref, getSearchHref, localizeHref } from "../lib/i18n/routing";
import { readRequestLocale } from "../lib/i18n/server";
import { getPopularQueries, registerSearchQuery, registerSearchQueryOutcome } from "../lib/search/queryStats";
import { suggestSiteSearch } from "../lib/search/siteSearch";
import type { SearchResultItem } from "../lib/search/types";

type PageProps = {
  searchParams: Promise<{ q?: string; kind?: string; region?: string; timeWindow?: string }>;
};

type SearchFilter = "all" | SearchResultItem["kind"];
type SearchTimeWindow = "all" | "upcoming" | "past";

const SEARCH_FILTERS: SearchFilter[] = ["all", "sound", "article", "video", "education", "event"];

function fireAndForget(task: Promise<unknown>): void {
  void task.catch(() => {});
}

function normalizeFilter(raw: string | undefined): SearchFilter {
  if (raw === "sound" || raw === "article" || raw === "video" || raw === "education" || raw === "event") return raw;
  return "all";
}

function normalizeTimeWindow(raw: string | undefined): SearchTimeWindow {
  if (raw === "upcoming" || raw === "past") return raw;
  return "all";
}

function filterLabel(filter: SearchFilter, t: (key: I18nKey) => string): string {
  if (filter === "all") return t("search.filter.all");
  if (filter === "sound") return t("header.searchKind.sound");
  if (filter === "article") return t("header.searchKind.article");
  if (filter === "video") return t("header.searchKind.video");
  if (filter === "event") return t("header.searchKind.event");
  return t("header.searchKind.education");
}

function resultKindLabel(kind: SearchResultItem["kind"], t: (key: I18nKey) => string): string {
  if (kind === "sound") return t("header.searchKind.sound");
  if (kind === "article") return t("header.searchKind.article");
  if (kind === "video") return t("header.searchKind.video");
  if (kind === "event") return t("header.searchKind.event");
  return t("header.searchKind.education");
}

function buildFilterHref(
  locale: "ru" | "en",
  query: string,
  filter: SearchFilter,
  region: string,
  timeWindow: SearchTimeWindow
): string {
  const base = getSearchHref(locale);
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (filter !== "all") params.set("kind", filter);
  if (region.trim()) params.set("region", region.trim());
  if (timeWindow !== "all") params.set("timeWindow", timeWindow);
  const queryString = params.toString();
  return queryString ? `${base}?${queryString}` : base;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const locale = await readRequestLocale();
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];
  const session = await readAuthSessionFromCookieStore();
  const entitlements = session?.entitlements.map((item) => item.code) ?? [];

  const query = (params.q ?? "").trim();
  const activeFilter = normalizeFilter(params.kind);
  const activeRegion = (params.region ?? "").trim();
  const activeTimeWindow = normalizeTimeWindow(params.timeWindow);
  if (query) {
    fireAndForget(registerSearchQuery(query, locale));
    fireAndForget(
      createAnalyticsEvent({
        contentType: "search",
        contentId: query.slice(0, 180),
        eventType: "search_submit",
        userId: session?.userId,
        source: "web",
      })
    );
  }
  const [searchPayload, popularQueries, localizedEvents] = await Promise.all([
    suggestSiteSearch(query, 48, {
      entitlements,
      region: activeRegion || undefined,
      timeWindow: activeTimeWindow,
    }),
    getPopularQueries(12, locale),
    Promise.resolve(getLocalizedPublishedEvents(locale)),
  ]);
  const availableRegions = Array.from(
    new Set(
      localizedEvents
        .map((item) => item.content.city?.trim() || "")
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, locale === "ru" ? "ru-RU" : "en-US"));

  const filteredResults =
    activeFilter === "all" ? searchPayload.results : searchPayload.results.filter((item) => item.kind === activeFilter);

  if (query) {
    fireAndForget(
      registerSearchQueryOutcome(query, {
        locale,
        resultCount: filteredResults.length,
      })
    );
  }

  return (
    <main className="rr-main pb-12">
      <PageHero title={t("search.pageTitle")} subtitle={t("search.pageSubtitle")} />

      <section className="rr-container mt-8 space-y-5">
        <form method="get" action={getSearchHref(locale)} className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 md:flex-row">
          <input
            name="q"
            defaultValue={query}
            placeholder={t("search.inputPlaceholder")}
            className="h-12 w-full rounded-lg border border-black/15 px-3 text-sm outline-none focus:border-[#5f82aa]"
            data-testid="search-page-input"
          />
          {activeFilter !== "all" ? <input type="hidden" name="kind" value={activeFilter} /> : null}
          <select
            name="region"
            defaultValue={activeRegion}
            className="h-12 rounded-lg border border-black/15 px-3 text-sm text-zinc-700 outline-none focus:border-[#5f82aa]"
            data-testid="search-page-region"
          >
            <option value="">{t("search.filter.regionAny")}</option>
            {availableRegions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
          <select
            name="timeWindow"
            defaultValue={activeTimeWindow}
            className="h-12 rounded-lg border border-black/15 px-3 text-sm text-zinc-700 outline-none focus:border-[#5f82aa]"
            data-testid="search-page-time-window"
          >
            <option value="all">{t("search.filter.timeAny")}</option>
            <option value="upcoming">{t("search.filter.timeUpcoming")}</option>
            <option value="past">{t("search.filter.timePast")}</option>
          </select>
          <button
            type="submit"
            className="h-12 rounded-lg bg-[#5f82aa] px-5 text-sm font-semibold text-white hover:bg-[#7398c2]"
            data-testid="search-page-submit"
          >
            {t("search.submit")}
          </button>
        </form>

        <div className="flex flex-wrap gap-2" data-testid="search-page-filters">
          {SEARCH_FILTERS.map((filter) => {
            const isActive = filter === activeFilter;
            return (
              <Link
                key={filter}
                href={buildFilterHref(locale, query, filter, activeRegion, activeTimeWindow)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  isActive
                    ? "border-[#5f82aa] bg-[#5f82aa] text-white"
                    : "border-black/15 bg-white text-zinc-700 hover:border-[#5f82aa] hover:text-[#5f82aa]"
                }`}
                data-testid={`search-page-filter-${filter}`}
              >
                {filterLabel(filter, t)}
              </Link>
            );
          })}
        </div>

        {!query ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-black/10 bg-white p-4" data-testid="search-page-popular-songs">
              <h3 className="mb-2 text-base font-semibold text-zinc-900">{t("header.searchPopular")}</h3>
              <div className="grid gap-2 md:grid-cols-2">
                {searchPayload.popular.map((item) => (
                  <AnalyticsTrackedLink
                    key={item.id}
                    href={localizeHref(item.href, locale)}
                    analyticsEventType="search_click"
                    analyticsContentType="search"
                    analyticsContentId={item.id}
                    className="rounded-lg border border-black/10 bg-[#f8f9fb] px-3 py-2 hover:border-[#5f82aa]"
                  >
                    <div className="text-[11px] uppercase tracking-[0.08em] text-[#5f82aa]">{resultKindLabel(item.kind, t)}</div>
                    <div className="text-sm font-medium text-zinc-900">{item.title}</div>
                  </AnalyticsTrackedLink>
                ))}
              </div>
            </div>

            {popularQueries.length ? (
              <div className="rounded-xl border border-black/10 bg-white p-4" data-testid="search-page-popular-queries">
                <h3 className="mb-2 text-base font-semibold text-zinc-900">{t("header.searchPopularQueries")}</h3>
                <div className="flex flex-wrap gap-2">
                  {popularQueries.map((item) => (
                    <Link
                      key={item}
                      href={`${getSearchHref(locale)}?q=${encodeURIComponent(item)}`}
                      className="rounded-full border border-black/15 bg-[#f8f9fb] px-3 py-1.5 text-sm text-zinc-700 hover:border-[#5f82aa] hover:text-[#5f82aa]"
                    >
                      {item}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {query ? (
          <div className="space-y-3" data-testid="search-page-results">
            {filteredResults.length ? (
              filteredResults.map((item) => (
                <AnalyticsTrackedLink
                  key={item.id}
                  href={localizeHref(item.href, locale)}
                  analyticsEventType="search_click"
                  analyticsContentType="search"
                  analyticsContentId={item.id}
                  className="block rounded-xl border border-black/10 bg-white p-4 hover:border-[#5f82aa]"
                  data-testid={`search-page-result-${item.id}`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-[11px] uppercase tracking-[0.08em] text-[#5f82aa]">{resultKindLabel(item.kind, t)}</div>
                    <div
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        item.accessStatus === "unlocked" ? "bg-[#d8f3e1] text-[#1b6942]" : "bg-[#ffe4cf] text-[#7b4216]"
                      }`}
                    >
                      {item.accessStatus === "unlocked" ? t("search.access.unlocked") : t("search.access.locked")}
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-900">{item.title}</h3>
                  <p className="mt-1 text-sm text-zinc-600">{item.snippet}</p>
                  {item.accessStatus === "locked" ? (
                    <div className="mt-2 text-sm text-[#5f82aa]">{t("search.openCard")}</div>
                  ) : null}
                </AnalyticsTrackedLink>
              ))
            ) : (
              <div className="space-y-3" data-testid="search-page-empty">
                <SearchZeroResultsBeacon query={query} />
                <p className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-zinc-600">{t("search.empty")}</p>
                <div className="rounded-xl border border-[#d6e2f0] bg-[#f6f9fd] p-4" data-testid="search-page-recovery">
                  <h3 className="text-sm font-semibold text-zinc-900" data-testid="search-page-recovery-title">
                    {t("search.recoveryTitle")}
                  </h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="space-y-2" data-testid="search-page-recovery-column-popular">
                      <div className="text-xs uppercase tracking-[0.08em] text-[#4f6e95]">{t("search.recoveryPopular")}</div>
                      <div className="space-y-1.5" data-testid="search-page-recovery-list-popular">
                        {searchPayload.popular.slice(0, 3).map((item) => (
                          <AnalyticsTrackedLink
                            key={`recovery-popular-${item.id}`}
                            href={localizeHref(item.href, locale)}
                            analyticsEventType="search_recovery_click"
                            analyticsContentType="search"
                            analyticsContentId={`${query.slice(0, 80)}::popular:${item.id}`}
                            className="block rounded-lg border border-[#d3deeb] bg-white px-3 py-2 text-sm text-zinc-800 hover:border-[#5f82aa]"
                            dataTestId={`search-page-recovery-popular-${item.id}`}
                          >
                            {item.title}
                          </AnalyticsTrackedLink>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2" data-testid="search-page-recovery-column-event">
                      <div className="text-xs uppercase tracking-[0.08em] text-[#4f6e95]">{t("search.recoveryEvents")}</div>
                      <div className="space-y-1.5" data-testid="search-page-recovery-list-event">
                        {localizedEvents.slice(0, 3).map((event) => (
                          <AnalyticsTrackedLink
                            key={`recovery-event-${event.slug}`}
                            href={getEventHref(locale, event.slug)}
                            analyticsEventType="search_recovery_click"
                            analyticsContentType="search"
                            analyticsContentId={`${query.slice(0, 80)}::event:${event.slug}`}
                            className="block rounded-lg border border-[#d3deeb] bg-white px-3 py-2 text-sm text-zinc-800 hover:border-[#5f82aa]"
                            dataTestId={`search-page-recovery-event-${event.slug}`}
                          >
                            {event.content.title}
                          </AnalyticsTrackedLink>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {searchPayload.suggestions.length ? (
              <div className="rounded-xl border border-black/10 bg-white p-4" data-testid="search-page-suggestions">
                <h3 className="mb-2 text-base font-semibold text-zinc-900">{t("header.searchSuggestions")}</h3>
                <div className="flex flex-wrap gap-2">
                  {searchPayload.suggestions.map((item) => (
                    <Link
                      key={item}
                      href={`${getSearchHref(locale)}?q=${encodeURIComponent(item)}`}
                      className="rounded-full border border-black/15 bg-[#f8f9fb] px-3 py-1.5 text-sm text-zinc-700 hover:border-[#5f82aa] hover:text-[#5f82aa]"
                    >
                      {item}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
