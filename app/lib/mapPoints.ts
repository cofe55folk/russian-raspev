import "server-only";

import { getLocalizedPublishedEvents } from "./eventsCatalog";
import type { Locale } from "./i18n/types";
import { SOUND_ITEMS } from "./soundCatalog";

type PointMeta = {
  id: string;
  title: string;
  subtitle: string;
  coords: [number, number];
  region: string;
  expedition: string;
  matchers: string[];
};

const POINT_META: PointMeta[] = [
  {
    id: "balman",
    title: "с. Балман",
    subtitle: "Куйбышевский район, Новосибирская область",
    coords: [55.43, 78.35],
    region: "Новосибирская область",
    expedition: "Балманский выезд",
    matchers: ["балман"],
  },
  {
    id: "kruticha",
    title: "с. Крутиха",
    subtitle: "Кыштовский район, Новосибирская область",
    coords: [56.55, 76.95],
    region: "Новосибирская область",
    expedition: "Кыштовский выезд",
    matchers: ["крутиха"],
  },
  {
    id: "talbakul",
    title: "с. Талбакуль",
    subtitle: "Колосовский район, Омская область",
    coords: [56.54, 73.95],
    region: "Омская область",
    expedition: "Талбакульский выезд",
    matchers: ["талбакул", "табакул"],
  },
  {
    id: "bogoslovka",
    title: "с. Богословка",
    subtitle: "Зырянский район, Томская область",
    coords: [56.68, 86.82],
    region: "Томская область",
    expedition: "Томский выезд",
    matchers: ["богословк"],
  },
  {
    id: "pervokamenka",
    title: "с. Первокаменка",
    subtitle: "Третьяковский район, Алтайский край",
    coords: [51.72, 82.08],
    region: "Алтайский край",
    expedition: "Алтайский выезд",
    matchers: ["первокаменка"],
  },
  {
    id: "bolshoy-kunaley",
    title: "с. Большой Куналей",
    subtitle: "Тарбагатайский район, Республика Бурятия",
    coords: [51.77, 107.56],
    region: "Республика Бурятия",
    expedition: "Бурятский выезд",
    matchers: ["большой куналей", "куналей"],
  },
  {
    id: "varyuhino",
    title: "с. Варюхино",
    subtitle: "Юргинский район, Кемеровская область",
    coords: [56.06, 84.34],
    region: "Кемеровская область",
    expedition: "Кузбасский выезд",
    matchers: ["варюхино"],
  },
  {
    id: "severnoe",
    title: "с. Северное",
    subtitle: "Северный район, Новосибирская область",
    coords: [56.35, 78.36],
    region: "Новосибирская область",
    expedition: "Северный выезд",
    matchers: ["северное"],
  },
  {
    id: "chervlennaya",
    title: "ст-ца Червлённая",
    subtitle: "Шелковской район, Чеченская Республика",
    coords: [43.77, 46.35],
    region: "Чеченская Республика",
    expedition: "Терский выезд",
    matchers: ["червл", "терек"],
  },
];

const EVENT_CITY_COORDS: Record<string, [number, number]> = {
  Москва: [55.7558, 37.6176],
  "Санкт-Петербург": [59.9343, 30.3351],
  Казань: [55.7961, 49.1064],
  Moscow: [55.7558, 37.6176],
  "Saint Petersburg": [59.9343, 30.3351],
  Kazan: [55.7961, 49.1064],
};

const EVENT_CITY_TO_REGION: Record<string, string> = {
  Москва: "Новосибирская область",
  "Санкт-Петербург": "Томская область",
  Казань: "Омская область",
  Moscow: "Новосибирская область",
  "Saint Petersburg": "Томская область",
  Kazan: "Омская область",
};

export type MapArchivePoint = {
  id: string;
  type: "archive";
  title: string;
  subtitle: string;
  region: string;
  expedition: string;
  coords: [number, number];
  genres: string[];
  songs: Array<{ title: string; href: string }>;
  hasEvents: boolean;
};

export type MapEventPoint = {
  id: string;
  type: "event";
  slug: string;
  title: string;
  city: string;
  dateIso: string;
  coords: [number, number];
  href: string;
};

export type MapPointsResult = {
  archive: MapArchivePoint[];
  events: MapEventPoint[];
};

type MapPointsFilter = {
  locale: Locale;
  genre?: string;
  region?: string;
  expedition?: string;
  city?: string;
  hasEvents?: boolean;
};

function normalizeToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.;:!?]+$/g, "");
}

function splitGenres(genre: string | undefined): string[] {
  if (!genre) return [];
  return genre
    .split(",")
    .map((part) => normalizeToken(part))
    .filter(Boolean);
}

function resolvePointMeta(item: { slug: string; title: string; archiveInfo?: string }): PointMeta | null {
  const haystack = `${item.slug} ${item.title} ${item.archiveInfo ?? ""}`.toLowerCase();
  return POINT_META.find((meta) => meta.matchers.some((matcher) => haystack.includes(matcher))) ?? null;
}

function buildArchivePoints(locale: Locale): MapArchivePoint[] {
  const byPoint = new Map<
    string,
    {
      meta: PointMeta;
      songs: Array<{ title: string; href: string; genres: string[] }>;
    }
  >();

  for (const item of SOUND_ITEMS) {
    const meta = resolvePointMeta(item);
    if (!meta) continue;

    const row = byPoint.get(meta.id) ?? { meta, songs: [] };
    row.songs.push({
      title: item.titleTranslations?.[locale] || item.title,
      href: `/sound/${item.slug}`,
      genres: splitGenres(item.genre),
    });
    byPoint.set(meta.id, row);
  }

  return Array.from(byPoint.values()).map((row) => {
    const genres = Array.from(new Set(row.songs.flatMap((song) => song.genres))).sort();
    return {
      id: row.meta.id,
      type: "archive",
      title: row.meta.title,
      subtitle: row.meta.subtitle,
      region: row.meta.region,
      expedition: row.meta.expedition,
      coords: row.meta.coords,
      genres,
      songs: row.songs.map((song) => ({ title: song.title, href: song.href })),
      hasEvents: false,
    };
  });
}

function buildEventPoints(locale: Locale): MapEventPoint[] {
  return getLocalizedPublishedEvents(locale)
    .map((event) => {
      const coords = event.coordinates || EVENT_CITY_COORDS[event.content.city];
      if (!coords) return null;
      return {
        id: `event-${event.slug}`,
        type: "event",
        slug: event.slug,
        title: event.content.title,
        city: event.content.city,
        dateIso: event.dateIso,
        coords,
        href: `/events/${event.slug}`,
      };
    })
    .filter((item): item is MapEventPoint => !!item);
}

export function getMapPoints(filter: MapPointsFilter): MapPointsResult {
  const genre = filter.genre ? normalizeToken(filter.genre) : "";
  const region = filter.region?.trim() || "";
  const expedition = filter.expedition?.trim() || "";
  const city = filter.city?.trim() || "";

  const events = buildEventPoints(filter.locale).filter((item) => (city ? item.city === city : true));
  const regionsWithEvents = new Set(events.map((event) => EVENT_CITY_TO_REGION[event.city]).filter(Boolean));

  const archive = buildArchivePoints(filter.locale)
    .map((item) => ({
      ...item,
      hasEvents: regionsWithEvents.has(item.region),
    }))
    .filter((item) => {
      if (genre && !item.genres.some((bucket) => bucket.includes(genre))) return false;
      if (region && item.region !== region) return false;
      if (expedition && item.expedition !== expedition) return false;
      if (typeof filter.hasEvents === "boolean" && item.hasEvents !== filter.hasEvents) return false;
      if (city) {
        const cityRegion = EVENT_CITY_TO_REGION[city];
        if (cityRegion && item.region !== cityRegion) return false;
      }
      return true;
    });

  return {
    archive,
    events,
  };
}
