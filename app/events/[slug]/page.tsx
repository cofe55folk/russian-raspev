import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageHero from "../../components/PageHero";
import { getLocalizedEventBySlug, getPrimaryOccurrence, getPublishedEventBySlug } from "../../lib/eventsCatalog";
import { I18N_MESSAGES, type I18nKey } from "../../lib/i18n/messages";
import { getEventHref, getEventsHref } from "../../lib/i18n/routing";
import { readRequestLocale } from "../../lib/i18n/server";
import { LOCALES, getLocaleMeta } from "../../lib/i18n/types";

export const dynamic = "force-dynamic";

type EventDetailPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ reminder?: string }>;
};

const FALLBACK_SITE_URL = "http://localhost:3000";

export async function generateMetadata({ params }: EventDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const locale = await readRequestLocale();
  const event = getLocalizedEventBySlug(slug, locale);
  const metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL);
  if (!event) {
    return {
      metadataBase,
      title: "Event not found",
      description: "Event page is unavailable.",
    };
  }

  const languages = Object.fromEntries(LOCALES.map((item) => [getLocaleMeta(item).intl, getEventHref(item, slug)]));
  const canonical = getEventHref(locale, slug);
  return {
    metadataBase,
    title: event.content.title,
    description: event.content.description,
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      title: event.content.title,
      description: event.content.description,
      type: "website",
      url: canonical,
    },
  };
}

export default async function EventDetailPage({ params, searchParams }: EventDetailPageProps) {
  const { slug } = await params;
  const query = searchParams ? await searchParams : undefined;
  const locale = await readRequestLocale();
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];

  const event = getLocalizedEventBySlug(slug, locale);
  if (!event) {
    notFound();
  }
  const sourceEvent = getPublishedEventBySlug(slug);
  const primaryOccurrence = sourceEvent ? getPrimaryOccurrence(sourceEvent) : null;
  const metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL);
  const canonicalUrl = new URL(getEventHref(locale, slug), metadataBase).toString();
  const eventJsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.content.title,
    description: event.content.description,
    startDate: primaryOccurrence?.startIso ?? sourceEvent?.dateIso ?? null,
    endDate: primaryOccurrence?.endIso ?? null,
    eventStatus:
      sourceEvent?.status === "canceled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: event.content.venue,
      address: {
        "@type": "PostalAddress",
        addressLocality: event.content.city,
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: sourceEvent?.venue.coordinates[0] ?? event.coordinates[0],
        longitude: sourceEvent?.venue.coordinates[1] ?? event.coordinates[1],
      },
    },
    offers: {
      "@type": "Offer",
      url: sourceEvent?.ticketUrl ?? event.ticketUrl,
      availability: "https://schema.org/InStock",
    },
    url: canonicalUrl,
  };
  const reminderState = query?.reminder;
  const reminderStateCode =
    reminderState === "subscribed" || reminderState === "revoked" || reminderState === "failed" ? reminderState : null;
  const reminderNotice =
    reminderStateCode === "subscribed"
      ? t("events.reminderStatusSubscribed") || "Reminder saved"
      : reminderStateCode === "revoked"
        ? t("events.reminderStatusRevoked") || "Reminder revoked"
        : reminderStateCode === "failed"
          ? t("events.reminderStatusFailed") || "Reminder failed"
          : "";

  return (
    <main className="rr-main">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(eventJsonLd) }} />
      <PageHero title={event.content.title} subtitle={event.content.description} />
      <section className="rr-container mt-10 grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="rr-panel space-y-5 p-6">
          <div className="relative h-72 overflow-hidden rounded-md">
            <Image
              src={event.coverSrc}
              alt={event.content.title}
              fill
              sizes="(max-width: 1024px) 100vw, 860px"
              className="object-cover"
              style={{ pointerEvents: "none" }}
            />
          </div>
          <p className="rr-card-text text-lg">{event.content.description}</p>
        </article>

        <aside className="rr-panel h-fit space-y-4 p-6">
          <div className="space-y-1" data-testid="event-detail-date">
            <div className="text-xs uppercase tracking-[0.08em] text-zinc-400">{t("events.dateLabel")}</div>
            <div className="text-base font-medium text-white">{event.dateLabel}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-[0.08em] text-zinc-400">{t("events.venueLabel")}</div>
            <div className="text-base text-zinc-100">{event.content.venue}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-[0.08em] text-zinc-400">{t("events.cityLabel")}</div>
            <div className="text-base text-zinc-100">{event.content.city}</div>
          </div>
          <a
            href={`/api/events/${slug}/ticket`}
            target="_blank"
            rel="noreferrer"
            className="rr-primary-btn inline-flex w-full justify-center px-6 py-3"
            data-testid="event-ticket-link"
          >
            {event.content.ticketLabel || t("events.ticketDefault")}
          </a>
          <a
            href={`/api/events/${slug}/ics?locale=${locale}`}
            className="inline-flex w-full justify-center rounded-sm border border-[#3b3f47] px-4 py-2 text-sm text-zinc-100 hover:border-[#5f82aa] hover:text-white"
            data-testid="event-calendar-link"
          >
            {t("events.addToCalendar")}
          </a>
          <form
            action={`/api/events/${slug}/reminders?redirect=1`}
            method="post"
            className="space-y-2 rounded-sm border border-[#3b3f47] bg-[#1a1f2c] p-3"
            data-testid="event-reminder-form"
          >
            <div className="text-xs uppercase tracking-[0.08em] text-zinc-400">{t("events.reminderTitle")}</div>
            <p className="text-xs text-zinc-300">{t("events.reminderHint")}</p>
            <input type="hidden" name="locale" value={locale} />
            <label className="block space-y-1">
              <span className="text-[11px] text-zinc-300">{t("events.reminderChannelLabel")}</span>
              <select
                name="channel"
                defaultValue="telegram"
                className="w-full rounded-sm border border-[#3b3f47] bg-[#111522] px-2 py-1.5 text-xs text-zinc-100"
                data-testid="event-reminder-channel"
              >
                <option value="telegram">{t("events.reminderChannelTelegram")}</option>
                <option value="email">{t("events.reminderChannelEmail")}</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-zinc-300">{t("events.reminderContactLabel")}</span>
              <input
                name="contact"
                placeholder="@russian_raspev"
                className="w-full rounded-sm border border-[#3b3f47] bg-[#111522] px-2 py-1.5 text-xs text-zinc-100"
                data-testid="event-reminder-contact"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="submit"
                name="action"
                value="subscribe"
                className="rounded-sm bg-[#355f8d] px-2 py-1.5 text-xs text-white hover:bg-[#4274ab]"
                data-testid="event-reminder-subscribe"
              >
                {t("events.reminderSubscribe")}
              </button>
              <button
                type="submit"
                name="action"
                value="revoke"
                className="rounded-sm bg-zinc-700 px-2 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600"
                data-testid="event-reminder-revoke"
              >
                {t("events.reminderRevoke")}
              </button>
            </div>
            {reminderStateCode ? (
              <div
                className="rounded-sm bg-[#0f172a] px-2 py-1.5 text-[11px] text-[#c5d4f4]"
                data-testid="event-reminder-status"
                data-reminder-state={reminderStateCode}
              >
                {reminderNotice}
              </div>
            ) : null}
          </form>
          <Link href={getEventsHref(locale)} className="inline-flex text-sm text-[#9cc4ff] hover:underline" data-testid="event-back-link">
            {t("events.backToList")}
          </Link>
        </aside>
      </section>
    </main>
  );
}
