import { promises as fs } from "node:fs";
import path from "node:path";

const MAP_PROBE_LOG_PATH = path.join(process.cwd(), "data", "analytics", "map-probe-events.ndjson");

type MapProbeRow = {
  reason?: unknown;
  map_init_time_ms?: unknown;
  map_filter_time_ms?: unknown;
  tile_error_count?: unknown;
  fallback_active?: unknown;
};

export type MapProbeGlobalSummary = {
  generatedAt: string;
  totalReports: number;
  mapInitReports: number;
  mapFilterReports: number;
  tileErrorReports: number;
  fallbackActivations: number;
  avgMapInitTimeMs: number;
  p95MapInitTimeMs: number;
  avgMapFilterTimeMs: number;
  p95MapFilterTimeMs: number;
  tileErrorRate: number;
};

function asFinite(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function percentile95(samples: number[]): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
  return Math.round(sorted[index] ?? 0);
}

export async function getMapProbeGlobalSummary(): Promise<MapProbeGlobalSummary> {
  let raw = "";
  try {
    raw = await fs.readFile(MAP_PROBE_LOG_PATH, "utf8");
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      totalReports: 0,
      mapInitReports: 0,
      mapFilterReports: 0,
      tileErrorReports: 0,
      fallbackActivations: 0,
      avgMapInitTimeMs: 0,
      p95MapInitTimeMs: 0,
      avgMapFilterTimeMs: 0,
      p95MapFilterTimeMs: 0,
      tileErrorRate: 0,
    };
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let totalReports = 0;
  let mapInitReports = 0;
  let mapFilterReports = 0;
  let tileErrorReports = 0;
  let fallbackActivations = 0;

  const mapInitTimes: number[] = [];
  const mapFilterTimes: number[] = [];

  for (const line of lines) {
    let parsed: MapProbeRow;
    try {
      parsed = JSON.parse(line) as MapProbeRow;
    } catch {
      continue;
    }
    totalReports += 1;
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
    if (reason === "map_init_time") {
      mapInitReports += 1;
      const ms = Math.max(0, Math.floor(asFinite(parsed.map_init_time_ms)));
      if (ms > 0) mapInitTimes.push(ms);
    }
    if (reason === "map_filter_time") {
      mapFilterReports += 1;
      const ms = Math.max(0, Math.floor(asFinite(parsed.map_filter_time_ms)));
      if (ms > 0) mapFilterTimes.push(ms);
    }
    if (reason === "tile_error_rate") {
      tileErrorReports += 1;
      if (parsed.fallback_active === true || asFinite(parsed.tile_error_count) > 0) {
        fallbackActivations += 1;
      }
    }
  }

  const avgMapInitTimeMs = mapInitTimes.length
    ? Math.round(mapInitTimes.reduce((acc, item) => acc + item, 0) / mapInitTimes.length)
    : 0;
  const avgMapFilterTimeMs = mapFilterTimes.length
    ? Math.round(mapFilterTimes.reduce((acc, item) => acc + item, 0) / mapFilterTimes.length)
    : 0;
  const tileErrorRateBase = mapInitReports || totalReports;
  const tileErrorRate = tileErrorRateBase > 0 ? Number((tileErrorReports / tileErrorRateBase).toFixed(4)) : 0;

  return {
    generatedAt: new Date().toISOString(),
    totalReports,
    mapInitReports,
    mapFilterReports,
    tileErrorReports,
    fallbackActivations,
    avgMapInitTimeMs,
    p95MapInitTimeMs: percentile95(mapInitTimes),
    avgMapFilterTimeMs,
    p95MapFilterTimeMs: percentile95(mapFilterTimes),
    tileErrorRate,
  };
}
