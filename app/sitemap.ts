import type { MetadataRoute } from "next";
import { getPublishedEvents } from "./lib/eventsCatalog";
import { buildLocalePathname } from "./lib/i18n/routing";
import { LOCALES } from "./lib/i18n/types";

const FALLBACK_SITE_URL = "http://localhost:3000";
const DEFAULT_PAST_WINDOW_DAYS = 120;
const DEFAULT_FUTURE_WINDOW_DAYS = 365;
const DAY_MS = 1000 * 60 * 60 * 24;

const BASE_PATHS = ["/", "/video", "/sound", "/education", "/articles", "/events", "/map", "/donate"];

function normalizeSiteUrl(raw: string | undefined): string {
  const candidate = raw?.trim();
  if (!candidate) return FALLBACK_SITE_URL;
  try {
    return new URL(candidate).toString().replace(/\/$/, "");
  } catch {
    return FALLBACK_SITE_URL;
  }
}

function normalizeWindowDays(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(3650, Math.trunc(parsed)));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  const now = Date.now();
  const pastWindowMs = normalizeWindowDays(process.env.RR_SITEMAP_EVENTS_PAST_DAYS, DEFAULT_PAST_WINDOW_DAYS) * DAY_MS;
  const futureWindowMs =
    normalizeWindowDays(process.env.RR_SITEMAP_EVENTS_FUTURE_DAYS, DEFAULT_FUTURE_WINDOW_DAYS) * DAY_MS;

  const baseEntries: MetadataRoute.Sitemap = [];
  for (const locale of LOCALES) {
    for (const path of BASE_PATHS) {
      baseEntries.push({
        url: `${siteUrl}${buildLocalePathname(path, locale)}`,
        changeFrequency: "weekly",
        priority: path === "/" ? 1 : 0.7,
      });
    }
  }

  const eventEntries: MetadataRoute.Sitemap = [];
  for (const event of getPublishedEvents()) {
    const eventTs = new Date(event.dateIso).getTime();
    if (!Number.isFinite(eventTs)) continue;
    if (eventTs < now - pastWindowMs) continue;
    if (eventTs > now + futureWindowMs) continue;

    for (const locale of LOCALES) {
      eventEntries.push({
        url: `${siteUrl}${buildLocalePathname(`/events/${event.slug}`, locale)}`,
        lastModified: new Date(eventTs),
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
  }

  return [...baseEntries, ...eventEntries];
}
