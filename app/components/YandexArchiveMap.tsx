"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DivIcon, LayerGroup, Map as LeafletMap, Marker, TileLayer } from "leaflet";
import { emitMapProbeTelemetry } from "../lib/analytics/emitMapProbeTelemetry";
import { getEventHref } from "../lib/i18n/routing";
import { SOUND_ITEMS } from "../lib/soundCatalog";

type SongLink = {
  title: string;
  href: string;
  genres: string[];
};

type VillagePoint = {
  id: string;
  title: string;
  subtitle: string;
  coords: [number, number];
  region: string;
  expedition: string;
  songs: SongLink[];
};

type EventPoint = {
  id: string;
  slug: string;
  title: string;
  dateLabel: string;
  city: string;
  tags: string[];
  coords: [number, number];
  href: string;
  dateIso: string;
};

export type MapEventSeed = {
  slug: string;
  title: string;
  dateLabel: string;
  city: string;
  tags: string[];
  dateIso: string;
  coordinates: [number, number] | null;
};

type LayerMode = "genre" | "region" | "expedition";
type ViewMode = "points" | "clusters";
type MobilePanel = "filters" | "points";
type MapDataset = "archive" | "events" | "mixed";

type PointMeta = Omit<VillagePoint, "songs"> & { matchers: string[] };

type YandexArchiveMapProps = {
  locale: "ru" | "en";
  initialDataset?: MapDataset;
  initialLayerMode?: LayerMode;
  initialViewMode?: ViewMode;
  initialSelectedValues?: string[];
  initialEventItems?: MapEventSeed[];
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

function normalizeGenreToken(raw: string): string {
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
    .map((part) => normalizeGenreToken(part))
    .filter(Boolean);
}

function resolvePointMeta(item: { slug: string; title: string; archiveInfo?: string }): PointMeta | null {
  const haystack = `${item.slug} ${item.title} ${item.archiveInfo ?? ""}`.toLowerCase();
  return POINT_META.find((meta) => meta.matchers.some((matcher) => haystack.includes(matcher))) ?? null;
}

function deriveLabelsFromArchive(archiveInfo: string | undefined, fallbackTitle: string, fallbackSubtitle: string) {
  const raw = (archiveInfo ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { title: fallbackTitle, subtitle: fallbackSubtitle };

  const settlementMatch = raw.match(/(с\.|село|станица|ст-ца)\s*[А-Яа-яЁёA-Za-z-]+(?:\s+[А-Яа-яЁёA-Za-z-]+)?/i);
  const title = settlementMatch ? settlementMatch[0].replace(/\s+/g, " ").trim() : fallbackTitle;

  let subtitle = raw;
  if (settlementMatch) {
    subtitle = raw.replace(settlementMatch[0], "");
  }
  subtitle = subtitle.replace(/^[,\s]+/, "").replace(/[,\s]+$/, "").trim();
  if (!subtitle) subtitle = fallbackSubtitle;

  return { title, subtitle };
}

const genreColorMap: Record<string, string> = {
  хороводная: "#3a7bd5",
  лирическая: "#0f9d58",
  вечерочная: "#d97706",
  плясовая: "#e07a1f",
  былинная: "#7c3aed",
};

const regionColorMap: Record<string, string> = {
  "Новосибирская область": "#3a7bd5",
  "Омская область": "#0f9d58",
  "Томская область": "#8e44ad",
  "Алтайский край": "#d97706",
  "Республика Бурятия": "#2f855a",
  "Кемеровская область": "#2563eb",
  "Чеченская Республика": "#c2410c",
};

const expeditionColorMap: Record<string, string> = {
  "Балманский выезд": "#3a7bd5",
  "Кыштовский выезд": "#1f8a70",
  "Талбакульский выезд": "#d97706",
  "Томский выезд": "#8e44ad",
  "Алтайский выезд": "#d97706",
  "Бурятский выезд": "#2f855a",
  "Кузбасский выезд": "#2563eb",
  "Северный выезд": "#1f8a70",
  "Терский выезд": "#c2410c",
};

const EVENT_CITY_COORDS: Record<string, [number, number]> = {
  Москва: [55.7558, 37.6176],
  "Санкт-Петербург": [59.9343, 30.3351],
  Казань: [55.7961, 49.1064],
  Moscow: [55.7558, 37.6176],
  "Saint Petersburg": [59.9343, 30.3351],
  Kazan: [55.7961, 49.1064],
};
const NOW_TS = Date.now();
const MAP_TILE_FALLBACK_ERROR_THRESHOLD = 2;

function createMapScopeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `map:${crypto.randomUUID()}`;
  }
  return `map:${Math.random().toString(36).slice(2)}:${Math.random().toString(36).slice(2)}`;
}

function ensureMapScopeId(ref: { current: string }): string {
  if (!ref.current) {
    ref.current = createMapScopeId();
  }
  return ref.current;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((item, index) => item === bSorted[index]);
}

function resolvePointColor(point: VillagePoint, layerMode: LayerMode, selectedValues: string[]) {
  if (layerMode === "region") return regionColorMap[point.region] ?? "#5f82aa";
  if (layerMode === "expedition") return expeditionColorMap[point.expedition] ?? "#5f82aa";
  const matchedGenre = selectedValues.length
    ? point.songs.flatMap((s) => s.genres).find((g) => selectedValues.includes(g))
    : point.songs[0]?.genres?.[0];
  const bucket = matchedGenre?.includes("былин")
    ? "былинная"
    : matchedGenre?.includes("хоровод")
      ? "хороводная"
      : matchedGenre?.includes("лирическ")
        ? "лирическая"
        : matchedGenre?.includes("плясов")
          ? "плясовая"
          : matchedGenre?.includes("вечероч")
            ? "вечерочная"
            : matchedGenre ?? "";
  return genreColorMap[bucket] ?? "#5f82aa";
}

function buildPopupHtml(point: VillagePoint, songs: SongLink[]) {
  const rows = songs
    .map((song) => `<a href="${song.href}" style="color:#2b5f97;text-decoration:none;">${song.title}</a>`)
    .join("<br/>");
  return `
    <div style="min-width:220px;">
      <div style="font-weight:600;margin-bottom:4px;">${point.title}</div>
      <div style="font-size:12px;color:#666;margin-bottom:8px;">${point.subtitle}</div>
      <div style="font-size:13px;line-height:1.5;">${rows}</div>
    </div>
  `;
}

function buildEventPopupHtml(event: EventPoint) {
  return `
    <div style="min-width:220px;">
      <div style="font-weight:600;margin-bottom:4px;">${event.title}</div>
      <div style="font-size:12px;color:#666;margin-bottom:8px;">${event.dateLabel} · ${event.city}</div>
      <a href="${event.href}" style="color:#2b5f97;text-decoration:none;">Открыть событие</a>
    </div>
  `;
}

export default function YandexArchiveMap({
  locale,
  initialDataset = "mixed",
  initialLayerMode = "genre",
  initialViewMode = "points",
  initialSelectedValues = [],
  initialEventItems = [],
}: YandexArchiveMapProps) {
  const points = useMemo<VillagePoint[]>(() => {
    const byPoint = new Map<string, { meta: PointMeta; songs: SongLink[]; archives: string[] }>();

    for (const item of SOUND_ITEMS) {
      const meta = resolvePointMeta(item);
      if (!meta) continue;

      const existing = byPoint.get(meta.id) ?? { meta, songs: [], archives: [] };
      existing.songs.push({
        title: item.title,
        href: `/sound/${item.slug}`,
        genres: splitGenres(item.genre),
      });
      if (item.archiveInfo) existing.archives.push(item.archiveInfo);
      byPoint.set(meta.id, existing);
    }

    return POINT_META.map((meta) => {
      const row = byPoint.get(meta.id);
      if (!row || !row.songs.length) return null;
      const labels = deriveLabelsFromArchive(row.archives[0], meta.title, meta.subtitle);
      return {
        id: meta.id,
        title: labels.title,
        subtitle: labels.subtitle,
        coords: meta.coords,
        region: meta.region,
        expedition: meta.expedition,
        songs: row.songs,
      };
    }).filter((item): item is VillagePoint => !!item);
  }, []);

  const eventPoints = useMemo<EventPoint[]>(() => {
    return initialEventItems
      .map((event) => {
        const coords = event.coordinates || EVENT_CITY_COORDS[event.city];
        if (!coords) return null;
        return {
          id: `event-${event.slug}`,
          slug: event.slug,
          title: event.title,
          dateLabel: event.dateLabel,
          city: event.city,
          tags: event.tags,
          coords,
          href: getEventHref(locale, event.slug),
          dateIso: event.dateIso,
        };
      })
      .filter((item): item is EventPoint => !!item);
  }, [initialEventItems, locale]);

  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileRef = useRef<TileLayer | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const markerByIdRef = useRef<Record<string, Marker>>({});
  const mapScopeIdRef = useRef<string>("");
  const tileErrorCountRef = useRef(0);
  const lastFilterTelemetryKeyRef = useRef<string>("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string>("");
  const [providerNote, setProviderNote] = useState<string>("");
  const [dataset, setDataset] = useState<MapDataset>(initialDataset);
  const [layerMode, setLayerMode] = useState<LayerMode>(initialLayerMode);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [selectedValues, setSelectedValues] = useState<string[]>(initialSelectedValues);
  const [activeId, setActiveId] = useState<string>("");
  const [activeEventId, setActiveEventId] = useState<string>("");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("filters");

  const filterOptions = useMemo(() => {
    if (dataset === "events") {
      if (layerMode === "region") return Array.from(new Set(eventPoints.map((item) => item.city))).sort();
      if (layerMode === "expedition") return Array.from(new Set(eventPoints.flatMap((item) => item.tags))).sort();
      return ["upcoming", "past"];
    }
    if (layerMode === "genre") return Array.from(new Set(points.flatMap((p) => p.songs.flatMap((s) => s.genres)))).sort();
    if (layerMode === "region") return Array.from(new Set(points.map((p) => p.region))).sort();
    return Array.from(new Set(points.map((p) => p.expedition))).sort();
  }, [dataset, eventPoints, layerMode, points]);

  useEffect(() => {
    setSelectedValues((prev) => {
      const validatedFilters = prev.filter((item) => filterOptions.includes(item));
      return sameStringSet(validatedFilters, prev) ? prev : validatedFilters;
    });
  }, [filterOptions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (dataset === "mixed") params.delete("dataset");
    else params.set("dataset", dataset);
    if (layerMode === "genre") params.delete("layer");
    else params.set("layer", layerMode);
    if (viewMode === "points") params.delete("view");
    else params.set("view", viewMode);
    if (selectedValues.length) params.set("filters", selectedValues.join(","));
    else params.delete("filters");

    const next = params.toString();
    const current = window.location.search.replace(/^\?/, "");
    if (next === current) return;

    const href = next ? `${window.location.pathname}?${next}` : window.location.pathname;
    window.history.replaceState(window.history.state, "", href);
  }, [dataset, layerMode, selectedValues, viewMode]);

  const visiblePoints = useMemo(() => {
    if (!selectedValues.length) return points;
    if (layerMode === "region") return points.filter((p) => selectedValues.includes(p.region));
    if (layerMode === "expedition") return points.filter((p) => selectedValues.includes(p.expedition));
    return points.filter((p) => p.songs.some((s) => s.genres.some((g) => selectedValues.includes(g))));
  }, [layerMode, points, selectedValues]);

  const visibleEventPoints = useMemo(() => {
    if (!selectedValues.length) return eventPoints;
    if (layerMode === "region") {
      return eventPoints.filter((event) => selectedValues.includes(event.city));
    }
    if (layerMode === "expedition") {
      return eventPoints.filter((event) => event.tags.some((tag) => selectedValues.includes(tag)));
    }
    return eventPoints.filter((event) => {
      const eventTs = new Date(event.dateIso).getTime();
      const bucket = eventTs >= NOW_TS ? "upcoming" : "past";
      return selectedValues.includes(bucket);
    });
  }, [eventPoints, layerMode, selectedValues]);

  const filterTelemetryKey = useMemo(() => {
    const selected = [...selectedValues].sort().join(",");
    return `${dataset}|${layerMode}|${viewMode}|${selected}|${visiblePoints.length}|${visibleEventPoints.length}`;
  }, [dataset, layerMode, selectedValues, viewMode, visibleEventPoints.length, visiblePoints.length]);

  const activePoint = useMemo(
    () => visiblePoints.find((item) => item.id === activeId) ?? visiblePoints[0] ?? null,
    [activeId, visiblePoints]
  );

  const activeEventPoint = useMemo(
    () => visibleEventPoints.find((item) => item.id === activeEventId) ?? visibleEventPoints[0] ?? null,
    [activeEventId, visibleEventPoints]
  );

  const activeSongs = useMemo(() => {
    if (!activePoint) return [];
    if (layerMode !== "genre" || !selectedValues.length) return activePoint.songs;
    return activePoint.songs.filter((song) => song.genres.some((g) => selectedValues.includes(g)));
  }, [activePoint, layerMode, selectedValues]);

  useEffect(() => {
    if (!points.length) {
      setActiveId("");
      return;
    }
    if (!activeId || !points.some((p) => p.id === activeId)) {
      setActiveId(points[0].id);
    }
  }, [activeId, points]);

  useEffect(() => {
    if (!eventPoints.length) {
      setActiveEventId("");
      return;
    }
    if (!activeEventId || !eventPoints.some((event) => event.id === activeEventId)) {
      setActiveEventId(eventPoints[0].id);
    }
  }, [activeEventId, eventPoints]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      if (!mapHostRef.current) return;
      const initStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
      const L = await import("leaflet");
      if (!mounted || !mapHostRef.current) return;

      const map = L.map(mapHostRef.current, {
        center: [56.25, 80.2],
        zoom: 5,
        zoomControl: true,
      });
      mapRef.current = map;
      map.attributionControl.setPrefix("");

      markerLayerRef.current = L.layerGroup().addTo(map);

      const key = (process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY || "").trim();
      const yandexUrl = `https://tiles.api-maps.yandex.ru/v1/tiles/?x={x}&y={y}&z={z}&l=map&lang=ru_RU&apikey=${key}`;
      const cartoLightUrl = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

      const applyNeutralFallback = (reason: "missing_key" | "tile_errors") => {
        if (!mapRef.current) return;
        tileRef.current?.remove();
        tileRef.current = L.tileLayer(cartoLightUrl, {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          maxZoom: 19,
        }).addTo(mapRef.current);
        setProviderNote("Провайдер подложки: CARTO Light (нейтральный fallback)");
        emitMapProbeTelemetry({
          mapScopeId: ensureMapScopeId(mapScopeIdRef),
          reason: "tile_error_rate",
          tileErrorCount: tileErrorCountRef.current,
          fallbackActive: true,
          provider: "carto",
        });
        if (reason === "missing_key") {
          tileErrorCountRef.current = 1;
        }
      };

      if (!key) {
        setLoadError("Не задан ключ Tiles API Яндекса. Временно включен нейтральный fallback.");
        applyNeutralFallback("missing_key");
      } else {
        tileErrorCountRef.current = 0;
        tileRef.current = L.tileLayer(yandexUrl, {
          attribution: '&copy; <a href="https://yandex.ru/maps-api/">Yandex</a>',
          maxZoom: 19,
        }).addTo(map);
        setProviderNote("Провайдер подложки: Yandex Tiles API");
        tileRef.current.on("tileerror", () => {
          tileErrorCountRef.current += 1;
          emitMapProbeTelemetry({
            mapScopeId: ensureMapScopeId(mapScopeIdRef),
            reason: "tile_error_rate",
            tileErrorCount: tileErrorCountRef.current,
            fallbackActive: false,
            provider: "yandex",
          });
          if (tileErrorCountRef.current > MAP_TILE_FALLBACK_ERROR_THRESHOLD) {
            setLoadError("Tiles API Яндекса недоступен или ключ невалиден. Включен нейтральный fallback.");
            applyNeutralFallback("tile_errors");
          }
        });
      }

      setReady(true);
      const initElapsedMs =
        initStartedAt > 0 && typeof performance !== "undefined" ? Math.max(0, Math.round(performance.now() - initStartedAt)) : 0;
      emitMapProbeTelemetry({
        mapScopeId: ensureMapScopeId(mapScopeIdRef),
        reason: "map_init_time",
        mapInitTimeMs: initElapsedMs,
        tileErrorCount: tileErrorCountRef.current,
        fallbackActive: !key,
        provider: key ? "yandex" : "carto",
      });
      window.setTimeout(() => map.invalidateSize(), 120);
    };

    init().catch(() => {
      setReady(false);
      setLoadError("Карта не загрузилась. Проверь подключение и ключ Tiles API.");
    });

    return () => {
      mounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !markerLayerRef.current) return;
    const filterStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
    import("leaflet").then((L) => {
      if (!mapRef.current || !markerLayerRef.current) return;
      markerLayerRef.current.clearLayers();
      markerByIdRef.current = {};

      const pointsForBounds: [number, number][] = [];
      if (dataset !== "events") {
        for (const point of visiblePoints) {
          const songs =
            layerMode === "genre" && selectedValues.length
              ? point.songs.filter((song) => song.genres.some((g) => selectedValues.includes(g)))
              : point.songs;
          if (!songs.length) continue;
          const color = resolvePointColor(point, layerMode, selectedValues);
          const isActive = point.id === activeId;

          if (viewMode === "clusters") {
            const count = songs.length;
            const icon: DivIcon = L.divIcon({
              className: "rr-cluster-icon",
              html: `<div style="height:34px;width:34px;border-radius:999px;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 10px rgba(0,0,0,0.25)">${count}</div>`,
              iconSize: [34, 34],
              iconAnchor: [17, 17],
            });
            const marker = L.marker(point.coords, { icon });
            marker.bindPopup(buildPopupHtml(point, songs));
            marker.on("click", () => setActiveId(point.id));
            markerLayerRef.current.addLayer(marker);
            markerByIdRef.current[point.id] = marker;
            pointsForBounds.push(point.coords);
            continue;
          }

          const icon: DivIcon = L.divIcon({
            className: "rr-point-icon",
            html: `<div style="height:20px;width:20px;border-radius:999px;background:${isActive ? "#1f4f7f" : color};border:3px solid rgba(255,255,255,0.9);box-shadow:0 2px 9px rgba(0,0,0,0.22)"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });
          const marker = L.marker(point.coords, { icon });
          marker.bindPopup(buildPopupHtml(point, songs));
          marker.on("click", () => setActiveId(point.id));
          markerLayerRef.current.addLayer(marker);
          markerByIdRef.current[point.id] = marker;
          pointsForBounds.push(point.coords);
        }
      }

      if (dataset !== "archive") {
        for (const event of visibleEventPoints) {
          const isActive = event.id === activeEventId;
          const icon: DivIcon = L.divIcon({
            className: "rr-event-icon",
            html:
              viewMode === "clusters"
                ? `<div style="height:32px;width:32px;border-radius:999px;background:${isActive ? "#c95540" : "#ef765f"};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid rgba(255,255,255,0.9);box-shadow:0 2px 9px rgba(0,0,0,0.22)">E</div>`
                : `<div style="height:22px;width:22px;border-radius:6px;background:${isActive ? "#c95540" : "#ef765f"};border:2px solid rgba(255,255,255,0.9);box-shadow:0 2px 9px rgba(0,0,0,0.22)"></div>`,
            iconSize: viewMode === "clusters" ? [32, 32] : [22, 22],
            iconAnchor: viewMode === "clusters" ? [16, 16] : [11, 11],
          });
          const marker = L.marker(event.coords, { icon });
          marker.bindPopup(buildEventPopupHtml(event));
          marker.on("click", () => setActiveEventId(event.id));
          markerLayerRef.current.addLayer(marker);
          markerByIdRef.current[`event:${event.id}`] = marker;
          pointsForBounds.push(event.coords);
        }
      }

      if (lastFilterTelemetryKeyRef.current === filterTelemetryKey) return;
      lastFilterTelemetryKeyRef.current = filterTelemetryKey;
      const filterLatencyMs =
        filterStartedAt > 0 && typeof performance !== "undefined"
          ? Math.max(0, Math.round(performance.now() - filterStartedAt))
          : 0;
      emitMapProbeTelemetry({
        mapScopeId: ensureMapScopeId(mapScopeIdRef),
        reason: "map_filter_time",
        mapFilterTimeMs: filterLatencyMs,
        tileErrorCount: tileErrorCountRef.current,
        fallbackActive: providerNote.toLowerCase().includes("fallback"),
        provider: providerNote.toLowerCase().includes("carto") ? "carto" : "yandex",
        dataset,
        layerMode,
        viewMode,
        selectedFiltersCount: selectedValues.length,
        visibleArchiveCount: visiblePoints.length,
        visibleEventCount: visibleEventPoints.length,
      });

      if (!pointsForBounds.length) return;
      if (pointsForBounds.length === 1) {
        mapRef.current.setView(pointsForBounds[0], 8, { animate: true });
      } else {
        mapRef.current.fitBounds(pointsForBounds, { padding: [28, 28], animate: true });
      }
    });
  }, [
    activeEventId,
    activeId,
    dataset,
    filterTelemetryKey,
    layerMode,
    providerNote,
    ready,
    selectedValues,
    viewMode,
    visibleEventPoints,
    visiblePoints,
  ]);

  useEffect(() => {
    if (dataset === "events") return;
    if (!visiblePoints.length) return;
    if (!visiblePoints.some((p) => p.id === activeId)) setActiveId(visiblePoints[0].id);
  }, [activeId, dataset, visiblePoints]);

  useEffect(() => {
    if (dataset === "archive") return;
    if (!visibleEventPoints.length) return;
    if (!visibleEventPoints.some((event) => event.id === activeEventId)) {
      setActiveEventId(visibleEventPoints[0].id);
    }
  }, [activeEventId, dataset, visibleEventPoints]);

  const focusPoint = (point: VillagePoint) => {
    setActiveId(point.id);
    if (!mapRef.current) return;
    mapRef.current.setView(point.coords, 8, { animate: true });
    const marker = markerByIdRef.current[point.id];
    if (marker) marker.openPopup();
  };

  const focusEvent = (event: EventPoint) => {
    setActiveEventId(event.id);
    if (!mapRef.current) return;
    mapRef.current.setView(event.coords, 7, { animate: true });
    const marker = markerByIdRef.current[`event:${event.id}`];
    if (marker) marker.openPopup();
  };

  const toggleFilter = (value: string) => {
    setSelectedValues((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="map-root">
      <div className="relative h-[420px] overflow-hidden rounded-sm border border-black/10 bg-zinc-200 sm:h-[560px] lg:h-[680px] xl:h-[740px]">
        <div ref={mapHostRef} className="h-full w-full" data-testid="map-canvas" />
        {!ready ? (
          <div className="absolute left-4 top-4 rounded-sm bg-white/90 px-3 py-2 text-xs text-zinc-700 shadow">Загрузка карты...</div>
        ) : null}
        {loadError ? (
          <div className="absolute left-4 top-4 max-w-[70%] rounded-sm bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow">
            {loadError}
          </div>
        ) : null}
        <div className="absolute bottom-4 left-4 rounded-sm bg-white/90 px-3 py-2 text-xs text-zinc-700 shadow">
          Точки кликабельны. В режиме «Кластеры» число в круге = количество песен.
        </div>
        {providerNote ? (
          <div className="absolute bottom-4 right-4 hidden rounded-sm bg-white/90 px-3 py-2 text-[11px] text-zinc-600 shadow sm:block">
            {providerNote}
          </div>
        ) : null}
      </div>

      <aside className="rounded-sm border border-black/10 bg-white p-3" data-testid="map-controls">
        <div className="mb-3 grid grid-cols-2 gap-1 lg:hidden">
          <button
            onClick={() => setMobilePanel("filters")}
            className={`rounded-sm px-2 py-1 text-xs ${mobilePanel === "filters" ? "bg-[#5f82aa] text-white" : "bg-zinc-100 text-zinc-700"}`}
            data-testid="map-mobile-tab-filters"
          >
            Фильтры
          </button>
          <button
            onClick={() => setMobilePanel("points")}
            className={`rounded-sm px-2 py-1 text-xs ${mobilePanel === "points" ? "bg-[#5f82aa] text-white" : "bg-zinc-100 text-zinc-700"}`}
            data-testid="map-mobile-tab-points"
          >
            Точки и песни
          </button>
        </div>

        <div className={`${mobilePanel === "filters" ? "block" : "hidden"} mb-3 border-b border-zinc-200 pb-3 lg:block`}>
          <div className="mb-2 text-sm font-semibold text-zinc-900">Источник</div>
          <div className="mb-3 grid grid-cols-3 gap-1">
            {[
              { id: "archive", label: "Архив" },
              { id: "events", label: "События" },
              { id: "mixed", label: "Смешанный" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setDataset(item.id as MapDataset);
                  setSelectedValues([]);
                  if (item.id === "events") setLayerMode("region");
                }}
                className={`rounded-sm px-2 py-1 text-xs ${dataset === item.id ? "bg-[#5f82aa] text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
                data-testid={`map-dataset-${item.id}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mb-2 text-sm font-semibold text-zinc-900">Вид карты</div>
          <div className="mb-3 grid grid-cols-2 gap-1">
            <button
              onClick={() => setViewMode("points")}
              className={`rounded-sm px-2 py-1 text-xs ${viewMode === "points" ? "bg-[#5f82aa] text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
              data-testid="map-view-points"
            >
              Точки
            </button>
            <button
              onClick={() => setViewMode("clusters")}
              className={`rounded-sm px-2 py-1 text-xs ${viewMode === "clusters" ? "bg-[#5f82aa] text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
              data-testid="map-view-clusters"
            >
              Кластеры
            </button>
          </div>

          <div className="mb-2 text-sm font-semibold text-zinc-900">Слои карты</div>
          <div className="mb-2 grid grid-cols-3 gap-1">
            {[
              { id: "genre", label: "Жанры" },
              { id: "region", label: "Регионы" },
              { id: "expedition", label: "Экспедиции" },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => {
                  setLayerMode(mode.id as LayerMode);
                  setSelectedValues([]);
                }}
                className={`rounded-sm px-2 py-1 text-xs ${layerMode === mode.id ? "bg-[#5f82aa] text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
                data-testid={`map-layer-${mode.id}`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-1" data-testid="map-filter-options">
            {filterOptions.map((option) => {
              const selected = selectedValues.includes(option);
              return (
                <button
                  key={option}
                  onClick={() => toggleFilter(option)}
                  className={`rounded-sm border px-2 py-1 text-[11px] ${selected ? "border-[#5f82aa] bg-[#eef4fb] text-[#264767]" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"}`}
                  data-testid={`map-filter-option-${option}`}
                >
                  {option}
                </button>
              );
            })}
          </div>
          {selectedValues.length ? (
            <button
              onClick={() => setSelectedValues([])}
              className="rounded-sm bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-200"
              data-testid="map-filter-clear"
            >
              Сбросить фильтр
            </button>
          ) : null}
        </div>

        <div className={`${mobilePanel === "points" ? "block" : "hidden"} lg:block`}>
          {dataset !== "events" ? (
            <>
              <div className="mb-2 text-sm font-semibold text-zinc-900">Населённые пункты</div>
              <div className="space-y-2">
                {visiblePoints.map((point) => (
                  <button
                    key={point.id}
                    onClick={() => focusPoint(point)}
                    className={`w-full rounded-sm border px-2 py-2 text-left ${point.id === activeId ? "border-[#5f82aa] bg-[#eef4fb]" : "border-zinc-200 bg-white hover:bg-zinc-50"}`}
                    data-testid={`map-point-item-${point.id}`}
                  >
                    <div className="text-sm font-medium text-zinc-900">{point.title}</div>
                    <div className="text-xs text-zinc-600">{point.subtitle}</div>
                  </button>
                ))}
                {!visiblePoints.length ? (
                  <div className="rounded-sm bg-zinc-100 px-2 py-2 text-xs text-zinc-600">По текущему фильтру точки не найдены.</div>
                ) : null}
              </div>

              <div className="mt-4 border-t border-zinc-200 pt-3">
                <div className="mb-2 text-sm font-semibold text-zinc-900">Песни точки</div>
                <div className="space-y-1">
                  {(activeSongs.length ? activeSongs : activePoint?.songs ?? []).map((song) => (
                    <Link
                      key={`${activePoint?.id ?? "none"}-${song.href}`}
                      href={song.href}
                      className="block rounded-sm bg-zinc-100 px-2 py-1.5 text-xs text-zinc-800 hover:bg-zinc-200"
                    >
                      {song.title}
                    </Link>
                  ))}
                  {!activePoint ? (
                    <div className="rounded-sm bg-zinc-100 px-2 py-2 text-xs text-zinc-600">Выбери точку на карте</div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {dataset !== "archive" ? (
            <div className={`${dataset !== "events" ? "mt-4 border-t border-zinc-200 pt-3" : ""}`}>
              <div className="mb-2 text-sm font-semibold text-zinc-900">События на карте</div>
              <div className="space-y-2">
                {visibleEventPoints.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => focusEvent(event)}
                    className={`w-full rounded-sm border px-2 py-2 text-left ${event.id === activeEventId ? "border-[#ef765f] bg-[#fff1ed]" : "border-zinc-200 bg-white hover:bg-zinc-50"}`}
                    data-testid={`map-event-item-${event.slug}`}
                  >
                    <div className="text-sm font-medium text-zinc-900">{event.title}</div>
                    <div className="text-xs text-zinc-600">
                      {event.dateLabel} · {event.city}
                    </div>
                  </button>
                ))}
                {!visibleEventPoints.length ? (
                  <div className="rounded-sm bg-zinc-100 px-2 py-2 text-xs text-zinc-600">События по текущему фильтру не найдены.</div>
                ) : null}
              </div>
              {activeEventPoint ? (
                <Link
                  href={activeEventPoint.href}
                  onClick={() =>
                    emitMapProbeTelemetry({
                      mapScopeId: ensureMapScopeId(mapScopeIdRef),
                      reason: "map_event_click",
                      tileErrorCount: tileErrorCountRef.current,
                      fallbackActive: providerNote.toLowerCase().includes("fallback"),
                      provider: providerNote.toLowerCase().includes("carto") ? "carto" : "yandex",
                      dataset,
                      layerMode,
                      viewMode,
                      selectedFiltersCount: selectedValues.length,
                      visibleArchiveCount: visiblePoints.length,
                      visibleEventCount: visibleEventPoints.length,
                    })
                  }
                  className="mt-2 inline-flex rounded-sm bg-[#ffe3dc] px-2 py-1.5 text-xs text-[#8b3928] hover:bg-[#ffd6cb]"
                >
                  Открыть карточку события
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
