import { NextResponse, type NextRequest } from "next/server";
import { getPrimaryOccurrence, getPublishedEventBySlug, type EventContent } from "../../../../lib/eventsCatalog";
import { getEventHref } from "../../../../lib/i18n/routing";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../../../../lib/i18n/types";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

const FALLBACK_SITE_URL = "http://localhost:3000";

function resolveLocale(request: NextRequest): Locale {
  const fromQuery = request.nextUrl.searchParams.get("locale");
  if (isLocale(fromQuery)) return fromQuery;
  const fromHeader = request.headers.get("x-rr-locale");
  if (isLocale(fromHeader)) return fromHeader;
  return DEFAULT_LOCALE;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildIcsPayload(params: {
  slug: string;
  content: EventContent;
  startAt: Date;
  endAt: Date;
  eventUrl: string;
}): string {
  const now = toIcsUtc(new Date());
  const dtStart = toIcsUtc(params.startAt);
  const dtEnd = toIcsUtc(params.endAt);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Russian Raspev//Events//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${params.slug}@russian-raspev`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(params.content.title)}`,
    `DESCRIPTION:${escapeIcsText(params.content.description)}`,
    `LOCATION:${escapeIcsText(`${params.content.venue}, ${params.content.city}`)}`,
    `URL:${params.eventUrl}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export async function GET(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`events-ics:get:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { slug } = await context.params;
  const event = getPublishedEventBySlug(slug);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const locale = resolveLocale(request);
  const content = event.translations[locale] ?? event.translations.ru;
  const primaryOccurrence = getPrimaryOccurrence(event);
  const startAt = new Date(primaryOccurrence?.startIso ?? event.dateIso);
  if (Number.isNaN(startAt.getTime())) {
    return NextResponse.json({ error: "Invalid event date" }, { status: 500 });
  }
  const endAt = primaryOccurrence?.endIso ? new Date(primaryOccurrence.endIso) : new Date(startAt.getTime() + 2 * 60 * 60 * 1000);
  const siteBase = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL);
  const eventUrl = new URL(getEventHref(locale, slug), siteBase).toString();

  const body = buildIcsPayload({
    slug,
    content,
    startAt,
    endAt,
    eventUrl,
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename=\"${slug}.ics\"`,
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
