"use client";

type MapProbeReason = "map_init_time" | "map_filter_time" | "tile_error_rate" | "map_event_click";

type EmitMapProbePayload = {
  mapScopeId: string;
  reason: MapProbeReason;
  mapInitTimeMs?: number;
  mapFilterTimeMs?: number;
  tileErrorCount?: number;
  fallbackActive?: boolean;
  dataset?: string;
  layerMode?: string;
  viewMode?: string;
  selectedFiltersCount?: number;
  visibleArchiveCount?: number;
  visibleEventCount?: number;
  provider?: string;
  route?: string;
  locale?: string;
};

function normalizeText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, limit);
}

function normalizeInt(value: unknown, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(max, Math.floor(num)));
}

function normalizeBool(value: unknown): boolean {
  return value === true;
}

export function emitMapProbeTelemetry(payload: EmitMapProbePayload): void {
  const mapScopeId = normalizeText(payload.mapScopeId, 220);
  const reason = normalizeText(payload.reason, 64);
  if (!mapScopeId || !reason) return;

  const body = {
    mapScopeId,
    reason,
    mapInitTimeMs: normalizeInt(payload.mapInitTimeMs, 60_000),
    mapFilterTimeMs: normalizeInt(payload.mapFilterTimeMs, 60_000),
    tileErrorCount: normalizeInt(payload.tileErrorCount, 100_000),
    fallbackActive: normalizeBool(payload.fallbackActive),
    dataset: normalizeText(payload.dataset, 24),
    layerMode: normalizeText(payload.layerMode, 24),
    viewMode: normalizeText(payload.viewMode, 24),
    selectedFiltersCount: normalizeInt(payload.selectedFiltersCount, 1000),
    visibleArchiveCount: normalizeInt(payload.visibleArchiveCount, 20_000),
    visibleEventCount: normalizeInt(payload.visibleEventCount, 20_000),
    provider: normalizeText(payload.provider, 48),
    route: normalizeText(payload.route, 220) || (typeof window !== "undefined" ? window.location.pathname : ""),
    locale: normalizeText(payload.locale, 8) || (typeof document !== "undefined" ? document.documentElement.lang.slice(0, 2) : ""),
    userAgent: normalizeText(typeof navigator !== "undefined" ? navigator.userAgent : "", 220),
    capturedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(body);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([json], { type: "application/json" });
      if (navigator.sendBeacon("/api/analytics/map-probe", blob)) return;
    } catch {
      // fallback to fetch
    }
  }

  void fetch("/api/analytics/map-probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: json,
    keepalive: true,
  });
}
