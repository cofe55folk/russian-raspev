import type { Locale } from "./i18n/types";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export type EventStatus = "draft" | "published" | "archived" | "canceled";

export type EventOccurrence = {
  id: string;
  startIso: string;
  endIso: string | null;
  timezone: string;
  recurring: boolean;
};

export type EventVenue = {
  id: string;
  city: string;
  coordinates: [number, number];
};

export type EventContent = {
  title: string;
  description: string;
  venue: string;
  city: string;
  ticketLabel: string;
};

export type EventItem = {
  slug: string;
  status: EventStatus;
  dateIso: string;
  coverSrc: string;
  ticketUrl: string;
  tags: string[];
  venue: EventVenue;
  occurrences: EventOccurrence[];
  translations: Record<Locale, EventContent>;
};

export type LocalizedEventItem = EventItem & {
  content: EventContent;
  dateLabel: string;
  primaryOccurrence: EventOccurrence | null;
  coordinates: [number, number];
};

const MOSCOW_TIMEZONE = "Europe/Moscow";
const EVENTS_DATA_DIR = path.join(process.cwd(), "data", "events");
const CATALOG_STORE_PATH = path.join(EVENTS_DATA_DIR, "catalog.json");
const AUDIT_LOG_PATH = path.join(EVENTS_DATA_DIR, "audit-log.jsonl");
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;
const SLUG_RE = /^[a-z0-9-]{3,120}$/;
const VALID_STATUSES: EventStatus[] = ["draft", "published", "archived", "canceled"];

export const EVENTS_CATALOG_SEED: EventItem[] = [
  {
    slug: "vesennyaya-raspevka-2026",
    status: "published",
    dateIso: "2026-03-12T19:00:00+03:00",
    coverSrc: "/hero.jpg",
    ticketUrl: "https://t.me/russian_raspev",
    tags: ["meetup", "vocal", "community"],
    venue: {
      id: "raspev-center-msk",
      city: "Москва",
      coordinates: [55.7558, 37.6176],
    },
    occurrences: [
      {
        id: "vesennyaya-raspevka-2026-occ-1",
        startIso: "2026-03-12T19:00:00+03:00",
        endIso: "2026-03-12T21:00:00+03:00",
        timezone: MOSCOW_TIMEZONE,
        recurring: false,
      },
    ],
    translations: {
      ru: {
        title: "Весенняя распевка сообщества",
        description: "Живой разбор партий, дыхательные практики и совместное пение с куратором.",
        venue: "Культурный центр «Распев»",
        city: "Москва",
        ticketLabel: "Записаться",
      },
      en: {
        title: "Spring Community Warm-up",
        description: "Live part rehearsal, breathing drills, and guided group singing.",
        venue: "Raspev Cultural Center",
        city: "Moscow",
        ticketLabel: "Join event",
      },
    },
  },
  {
    slug: "arkhivnye-golosa-2026",
    status: "published",
    dateIso: "2026-04-05T18:30:00+03:00",
    coverSrc: "/hero.jpg",
    ticketUrl: "https://t.me/russian_raspev",
    tags: ["archive", "lecture", "practice"],
    venue: {
      id: "dom-folklora-spb",
      city: "Санкт-Петербург",
      coordinates: [59.9343, 30.3351],
    },
    occurrences: [
      {
        id: "arkhivnye-golosa-2026-occ-1",
        startIso: "2026-04-05T18:30:00+03:00",
        endIso: "2026-04-05T20:30:00+03:00",
        timezone: MOSCOW_TIMEZONE,
        recurring: true,
      },
      {
        id: "arkhivnye-golosa-2026-occ-2",
        startIso: "2026-04-19T18:30:00+03:00",
        endIso: "2026-04-19T20:30:00+03:00",
        timezone: MOSCOW_TIMEZONE,
        recurring: true,
      },
    ],
    translations: {
      ru: {
        title: "Архивные голоса: вечер с полевыми записями",
        description: "Слушаем архивные материалы, разбираем стиль и пробуем партию в медленном темпе.",
        venue: "Дом фольклора",
        city: "Санкт-Петербург",
        ticketLabel: "Зарегистрироваться",
      },
      en: {
        title: "Archive Voices: Field Recording Evening",
        description: "We listen to archive recordings, break down style, and rehearse lines in slow tempo.",
        venue: "Folklore House",
        city: "Saint Petersburg",
        ticketLabel: "Register",
      },
    },
  },
  {
    slug: "ansambl-praktika-mai-2026",
    status: "published",
    dateIso: "2026-05-16T17:00:00+03:00",
    coverSrc: "/hero.jpg",
    ticketUrl: "https://t.me/russian_raspev",
    tags: ["ensemble", "workshop"],
    venue: {
      id: "voice-mode-kazan",
      city: "Казань",
      coordinates: [55.7961, 49.1064],
    },
    occurrences: [
      {
        id: "ansambl-praktika-mai-2026-occ-1",
        startIso: "2026-05-16T17:00:00+03:00",
        endIso: "2026-05-16T19:00:00+03:00",
        timezone: MOSCOW_TIMEZONE,
        recurring: false,
      },
    ],
    translations: {
      ru: {
        title: "Ансамблевая практика: майский интенсив",
        description: "Работаем над балансом голосов, вступлениями и устойчивым строем в ансамбле.",
        venue: "Студия «Голос и лад»",
        city: "Казань",
        ticketLabel: "Участвовать",
      },
      en: {
        title: "Ensemble Practice: May Intensive",
        description: "Focused work on voice balance, entrances, and stable tuning in ensemble singing.",
        venue: "Voice and Mode Studio",
        city: "Kazan",
        ticketLabel: "Participate",
      },
    },
  },
];
export const EVENTS_CATALOG: EventItem[] = EVENTS_CATALOG_SEED;

export function getPrimaryOccurrence(event: EventItem): EventOccurrence | null {
  if (!event.occurrences.length) return null;
  return [...event.occurrences].sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime())[0] ?? null;
}

export type AdminEventInput = {
  slug: string;
  status: EventStatus;
  coverSrc: string;
  ticketUrl: string;
  tags: string[];
  venue: EventVenue;
  occurrences: EventOccurrence[];
  translations: Record<Locale, EventContent>;
};

type AuditRecord = {
  at: string;
  action: "create" | "update" | "status";
  slug: string;
  actor: string;
  source: string;
  beforeStatus?: EventStatus | null;
  afterStatus?: EventStatus;
  payloadHash: string;
};

export type EventValidationResult =
  | { ok: true; event: EventItem }
  | { ok: false; error: string };

function ensureEventsDir(): void {
  mkdirSync(EVENTS_DATA_DIR, { recursive: true });
}

function writeCatalog(events: EventItem[]): void {
  ensureEventsDir();
  const payload = `${JSON.stringify(events, null, 2)}\n`;
  const tmpPath = `${CATALOG_STORE_PATH}.tmp-${Date.now()}`;
  writeFileSync(tmpPath, payload, "utf8");
  renameSync(tmpPath, CATALOG_STORE_PATH);
}

function appendAudit(record: AuditRecord): void {
  ensureEventsDir();
  appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tags = raw
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean)
    .slice(0, 12);
  return Array.from(new Set(tags));
}

function normalizeCoords(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const lat = Number(raw[0]);
  const lon = Number(raw[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lat, lon];
}

function normalizeStatus(raw: unknown): EventStatus | null {
  if (typeof raw !== "string") return null;
  return VALID_STATUSES.find((item) => item === raw) || null;
}

function normalizeOccurrence(raw: unknown): EventOccurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<EventOccurrence>;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.startIso !== "string" || !ISO_DATE_RE.test(value.startIso)) return null;
  const startTs = new Date(value.startIso).getTime();
  if (!Number.isFinite(startTs)) return null;
  const endIso = typeof value.endIso === "string" && value.endIso.trim() ? value.endIso : null;
  if (endIso) {
    if (!ISO_DATE_RE.test(endIso)) return null;
    const endTs = new Date(endIso).getTime();
    if (!Number.isFinite(endTs) || endTs < startTs) return null;
  }
  const timezone = typeof value.timezone === "string" && value.timezone.trim() ? value.timezone.trim() : MOSCOW_TIMEZONE;
  return {
    id: value.id.trim().slice(0, 120),
    startIso: new Date(startTs).toISOString(),
    endIso: endIso ? new Date(endIso).toISOString() : null,
    timezone,
    recurring: Boolean(value.recurring),
  };
}

function normalizeContent(raw: unknown): EventContent | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<EventContent>;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const venue = typeof value.venue === "string" ? value.venue.trim() : "";
  const city = typeof value.city === "string" ? value.city.trim() : "";
  const ticketLabel = typeof value.ticketLabel === "string" ? value.ticketLabel.trim() : "";
  if (!title || !description || !venue || !city || !ticketLabel) return null;
  return { title, description, venue, city, ticketLabel };
}

function normalizeVenue(raw: unknown, fallbackCity = ""): EventVenue | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<EventVenue>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const city = typeof value.city === "string" ? value.city.trim() : fallbackCity;
  const coords = normalizeCoords(value.coordinates);
  if (!id || !city || !coords) return null;
  return {
    id: id.slice(0, 120),
    city,
    coordinates: coords,
  };
}

export function validateEventInput(input: unknown): EventValidationResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid event payload" };
  const raw = input as Partial<AdminEventInput>;
  const slug = typeof raw.slug === "string" ? raw.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug)) return { ok: false, error: "Invalid slug format" };

  const status = normalizeStatus(raw.status);
  if (!status) return { ok: false, error: "Invalid status" };

  const coverSrc = typeof raw.coverSrc === "string" ? raw.coverSrc.trim() : "";
  if (!coverSrc.startsWith("/")) return { ok: false, error: "coverSrc must be a local path" };

  const ticketUrl = typeof raw.ticketUrl === "string" ? raw.ticketUrl.trim() : "";
  try {
    const parsed = new URL(ticketUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "Invalid ticketUrl protocol" };
  } catch {
    return { ok: false, error: "Invalid ticketUrl" };
  }

  const tags = normalizeTags(raw.tags);
  if (!tags.length) return { ok: false, error: "At least one tag is required" };

  const ru = normalizeContent(raw.translations?.ru);
  const en = normalizeContent(raw.translations?.en);
  if (!ru || !en) return { ok: false, error: "Both ru/en translations are required" };

  const occurrences = Array.isArray(raw.occurrences)
    ? raw.occurrences.map(normalizeOccurrence).filter((item): item is EventOccurrence => !!item)
    : [];
  if (!occurrences.length) return { ok: false, error: "At least one valid occurrence is required" };
  occurrences.sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());

  const venue = normalizeVenue(raw.venue, ru.city);
  if (!venue) return { ok: false, error: "Venue coordinates are required" };
  const dateIso = occurrences[0].startIso;

  const event: EventItem = {
    slug,
    status,
    dateIso,
    coverSrc,
    ticketUrl,
    tags,
    venue,
    occurrences,
    translations: {
      ru,
      en,
    },
  };

  return { ok: true, event };
}

function normalizeStoredEvent(input: unknown): EventItem | null {
  const validation = validateEventInput(input);
  return validation.ok ? validation.event : null;
}

export function getEventCatalogSnapshot(): EventItem[] {
  try {
    if (!existsSync(CATALOG_STORE_PATH)) {
      return EVENTS_CATALOG_SEED.slice();
    }
    const raw = readFileSync(CATALOG_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EVENTS_CATALOG_SEED.slice();
    const normalized = parsed.map(normalizeStoredEvent).filter((item): item is EventItem => !!item);
    return normalized.length ? normalized : EVENTS_CATALOG_SEED.slice();
  } catch {
    return EVENTS_CATALOG_SEED.slice();
  }
}

export function upsertEventByAdmin(params: {
  input: unknown;
  actor: string;
  source: string;
}): EventValidationResult & { created?: boolean } {
  const normalized = validateEventInput(params.input);
  if (!normalized.ok) return normalized;

  const snapshot = getEventCatalogSnapshot();
  const existingIndex = snapshot.findIndex((item) => item.slug === normalized.event.slug);
  const previous = existingIndex >= 0 ? snapshot[existingIndex] : null;
  const next = snapshot.slice();
  if (existingIndex >= 0) {
    next[existingIndex] = normalized.event;
  } else {
    next.push(normalized.event);
  }
  next.sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime());
  writeCatalog(next);

  const payloadHash = createHash("sha256").update(JSON.stringify(normalized.event)).digest("hex");
  appendAudit({
    at: new Date().toISOString(),
    action: previous ? "update" : "create",
    slug: normalized.event.slug,
    actor: params.actor,
    source: params.source,
    beforeStatus: previous?.status ?? null,
    afterStatus: normalized.event.status,
    payloadHash,
  });

  return {
    ok: true,
    event: normalized.event,
    created: !previous,
  };
}

export function setEventStatusByAdmin(params: {
  slug: string;
  status: EventStatus;
  actor: string;
  source: string;
}): { ok: true; event: EventItem } | { ok: false; error: string } {
  const slug = params.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return { ok: false, error: "Invalid slug format" };
  const status = normalizeStatus(params.status);
  if (!status) return { ok: false, error: "Invalid status" };

  const snapshot = getEventCatalogSnapshot();
  const index = snapshot.findIndex((item) => item.slug === slug);
  if (index < 0) return { ok: false, error: "Event not found" };

  const previous = snapshot[index];
  if (previous.status === status) {
    return { ok: true, event: previous };
  }
  const updated: EventItem = {
    ...previous,
    status,
  };
  const next = snapshot.slice();
  next[index] = updated;
  writeCatalog(next);

  const payloadHash = createHash("sha256").update(JSON.stringify(updated)).digest("hex");
  appendAudit({
    at: new Date().toISOString(),
    action: "status",
    slug: updated.slug,
    actor: params.actor,
    source: params.source,
    beforeStatus: previous.status,
    afterStatus: updated.status,
    payloadHash,
  });

  return { ok: true, event: updated };
}

export function listEventsForAdmin(locale: Locale): LocalizedEventItem[] {
  return getEventCatalogSnapshot()
    .slice()
    .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime())
    .map((event) => localizeEvent(event, locale));
}

export function formatEventDate(locale: Locale, dateIso: string, timezone?: string): string {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone || undefined,
  }).format(date);
}

export function getPublishedEvents(): EventItem[] {
  return getEventCatalogSnapshot()
    .filter((event) => event.status === "published")
    .slice()
    .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime());
}

export function localizeEvent(event: EventItem, locale: Locale): LocalizedEventItem {
  const primaryOccurrence = getPrimaryOccurrence(event);
  return {
    ...event,
    content: event.translations[locale] ?? event.translations.ru,
    dateLabel: formatEventDate(locale, event.dateIso, primaryOccurrence?.timezone),
    primaryOccurrence,
    coordinates: event.venue.coordinates,
  };
}

export function getLocalizedPublishedEvents(locale: Locale): LocalizedEventItem[] {
  return getPublishedEvents().map((event) => localizeEvent(event, locale));
}

export function getPublishedEventBySlug(slug: string): EventItem | null {
  return getPublishedEvents().find((item) => item.slug === slug) ?? null;
}

export function getLocalizedEventBySlug(slug: string, locale: Locale): LocalizedEventItem | null {
  const event = getPublishedEventBySlug(slug);
  return event ? localizeEvent(event, locale) : null;
}
