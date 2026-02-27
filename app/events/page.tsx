import Image from "next/image";
import Link from "next/link";
import PageHero from "../components/PageHero";
import { I18N_MESSAGES, type I18nKey } from "../lib/i18n/messages";
import { getEventHref, getEventsHref } from "../lib/i18n/routing";
import { readRequestLocale } from "../lib/i18n/server";
import { getLocalizedPublishedEvents } from "../lib/eventsCatalog";

export const dynamic = "force-dynamic";

const EVENTS_PER_PAGE = 6;
const NOW_TS = Date.now();
type EventStatusFilter = "all" | "upcoming" | "past";

type EventsPageProps = {
  searchParams?: Promise<{ page?: string; city?: string; tag?: string; status?: string }>;
};

function parsePage(raw: string | undefined, maxPage: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(maxPage, Math.trunc(parsed)));
}

function normalizeStatus(raw: string | undefined): EventStatusFilter {
  if (raw === "upcoming" || raw === "past") return raw;
  return "all";
}

function buildEventsHref(
  locale: "ru" | "en",
  filters: { page?: number; city?: string; tag?: string; status?: EventStatusFilter }
): string {
  const params = new URLSearchParams();
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  if (filters.city) params.set("city", filters.city);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  const query = params.toString();
  return query ? `${getEventsHref(locale)}?${query}` : getEventsHref(locale);
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const locale = await readRequestLocale();
  const query = searchParams ? await searchParams : undefined;
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];
  const status = normalizeStatus(query?.status);
  const allEvents = getLocalizedPublishedEvents(locale);
  const cityOptions = Array.from(new Set(allEvents.map((item) => item.content.city))).sort();
  const tagOptions = Array.from(new Set(allEvents.flatMap((item) => item.tags))).sort();
  const cityFilter = query?.city && cityOptions.includes(query.city) ? query.city : "";
  const tagFilter = query?.tag && tagOptions.includes(query.tag) ? query.tag : "";

  const filteredEvents = allEvents.filter((event) => {
    if (cityFilter && event.content.city !== cityFilter) return false;
    if (tagFilter && !event.tags.includes(tagFilter)) return false;
    const eventTs = new Date(event.dateIso).getTime();
    if (status === "upcoming") return eventTs >= NOW_TS;
    if (status === "past") return eventTs < NOW_TS;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / EVENTS_PER_PAGE));
  const currentPage = parsePage(query?.page, totalPages);
  const offset = (currentPage - 1) * EVENTS_PER_PAGE;
  const events = filteredEvents.slice(offset, offset + EVENTS_PER_PAGE);

  const prevHref = buildEventsHref(locale, {
    page: Math.max(1, currentPage - 1),
    city: cityFilter || undefined,
    tag: tagFilter || undefined,
    status,
  });
  const nextHref = buildEventsHref(locale, {
    page: Math.min(totalPages, currentPage + 1),
    city: cityFilter || undefined,
    tag: tagFilter || undefined,
    status,
  });

  return (
    <main className="rr-main">
      <PageHero title={t("events.pageTitle")} />
      <section className="rr-container mt-10">
        <form action={getEventsHref(locale)} method="get" className="rr-panel mb-7 grid gap-3 p-4 md:grid-cols-4" data-testid="events-filters">
          <label className="block text-sm text-zinc-100">
            <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-zinc-400">{t("events.filterCity")}</span>
            <select name="city" defaultValue={cityFilter} className="rr-input h-10" data-testid="events-filter-city">
              <option value="">{t("events.filterAny")}</option>
              {cityOptions.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-zinc-100">
            <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-zinc-400">{t("events.filterTag")}</span>
            <select name="tag" defaultValue={tagFilter} className="rr-input h-10" data-testid="events-filter-tag">
              <option value="">{t("events.filterAny")}</option>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-zinc-100">
            <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-zinc-400">{t("events.filterStatus")}</span>
            <select name="status" defaultValue={status} className="rr-input h-10" data-testid="events-filter-status">
              <option value="all">{t("events.filterStatusAll")}</option>
              <option value="upcoming">{t("events.filterStatusUpcoming")}</option>
              <option value="past">{t("events.filterStatusPast")}</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <button type="submit" className="rr-primary-btn h-10 px-5 text-sm" data-testid="events-filter-apply">
              {t("events.filterApply")}
            </button>
            <Link href={getEventsHref(locale)} className="rr-pagination-btn h-10 px-4 text-xs" data-testid="events-filter-reset">
              {t("events.filterReset")}
            </Link>
          </div>
        </form>

        {events.length === 0 ? (
          <div className="rr-panel p-8 text-base text-zinc-100">{t("events.empty")}</div>
        ) : (
          <>
            <div className="grid gap-x-7 gap-y-10 md:grid-cols-3" data-testid="events-cards-grid">
              {events.map((event) => (
                <article key={event.slug} className="space-y-4" data-testid={`events-card-${event.slug}`}>
                  <div className="relative h-56 overflow-hidden rounded-sm">
                    <Image
                      src={event.coverSrc}
                      alt={event.content.title}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover"
                      style={{ pointerEvents: "none" }}
                    />
                  </div>
                  <div className="text-sm font-medium text-[#5f82aa]">{event.dateLabel}</div>
                  <h3 className="rr-card-title">{event.content.title}</h3>
                  <p className="rr-card-text">{event.content.description}</p>
                  <Link
                    href={getEventHref(locale, event.slug)}
                    className="rr-primary-btn inline-flex px-8 py-3"
                    data-testid={`events-card-link-${event.slug}`}
                  >
                    {t("events.more")}
                  </Link>
                </article>
              ))}
            </div>

            {totalPages > 1 ? (
              <div className="mt-10 flex items-center justify-center gap-2">
                <Link
                  href={prevHref}
                  className={`rr-pagination-btn ${currentPage === 1 ? "pointer-events-none opacity-50" : ""}`}
                  aria-disabled={currentPage === 1}
                >
                  {t("events.prev")}
                </Link>
                {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((page) => (
                  <Link
                    key={page}
                    href={buildEventsHref(locale, {
                      page,
                      city: cityFilter || undefined,
                      tag: tagFilter || undefined,
                      status,
                    })}
                    className={`rr-pagination-btn ${page === currentPage ? "rr-pagination-btn-active" : ""}`}
                    aria-label={`${t("events.pageLabel")} ${page}`}
                  >
                    {page}
                  </Link>
                ))}
                <Link
                  href={nextHref}
                  className={`rr-pagination-btn ${currentPage === totalPages ? "pointer-events-none opacity-50" : ""}`}
                  aria-disabled={currentPage === totalPages}
                >
                  {t("events.next")}
                </Link>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
