import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { allowRateLimit } from "../../../lib/security/rateLimit";

export const runtime = "nodejs";

type MapProbePayload = {
  mapScopeId?: unknown;
  reason?: unknown;
  mapInitTimeMs?: unknown;
  mapFilterTimeMs?: unknown;
  tileErrorCount?: unknown;
  fallbackActive?: unknown;
  dataset?: unknown;
  layerMode?: unknown;
  viewMode?: unknown;
  selectedFiltersCount?: unknown;
  visibleArchiveCount?: unknown;
  visibleEventCount?: unknown;
  provider?: unknown;
  route?: unknown;
  locale?: unknown;
  userAgent?: unknown;
  capturedAt?: unknown;
};

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, limit);
}

function normalizeReason(value: unknown): string | null {
  const normalized = normalizeText(value, 64);
  if (!normalized) return null;
  if (normalized === "map_init_time") return normalized;
  if (normalized === "map_filter_time") return normalized;
  if (normalized === "tile_error_rate") return normalized;
  if (normalized === "map_event_click") return normalized;
  return null;
}

function normalizeNonNegativeInt(value: unknown, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(max, Math.floor(num)));
}

function normalizeBool(value: unknown): boolean {
  return value === true;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`analytics-map-probe:post:${ip}`, 360, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: MapProbePayload = {};
  try {
    payload = (await request.json()) as MapProbePayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const mapScopeId = normalizeText(payload.mapScopeId, 220);
  const reason = normalizeReason(payload.reason);
  if (!mapScopeId || !reason) {
    return NextResponse.json({ error: "mapScopeId and reason are required" }, { status: 400 });
  }

  const session = await readAuthSessionFromRequest(request);
  const row = {
    map_scope_id: mapScopeId,
    reason,
    map_init_time_ms: normalizeNonNegativeInt(payload.mapInitTimeMs, 60_000),
    map_filter_time_ms: normalizeNonNegativeInt(payload.mapFilterTimeMs, 60_000),
    tile_error_count: normalizeNonNegativeInt(payload.tileErrorCount, 100_000),
    fallback_active: normalizeBool(payload.fallbackActive),
    dataset: normalizeText(payload.dataset, 24) || "",
    layer_mode: normalizeText(payload.layerMode, 24) || "",
    view_mode: normalizeText(payload.viewMode, 24) || "",
    selected_filters_count: normalizeNonNegativeInt(payload.selectedFiltersCount, 1000),
    visible_archive_count: normalizeNonNegativeInt(payload.visibleArchiveCount, 20_000),
    visible_event_count: normalizeNonNegativeInt(payload.visibleEventCount, 20_000),
    provider: normalizeText(payload.provider, 48) || "",
    route: normalizeText(payload.route, 220) || "",
    locale: normalizeText(payload.locale, 8) || "",
    user_agent:
      normalizeText(payload.userAgent, 220) || normalizeText(request.headers.get("user-agent"), 220) || "",
    user_id: session?.userId || "",
    captured_at: normalizeText(payload.capturedAt, 40) || new Date().toISOString(),
    ingested_at: new Date().toISOString(),
  };

  const logDir = join(process.cwd(), "data", "analytics");
  const logPath = join(logDir, "map-probe-events.ndjson");
  await mkdir(logDir, { recursive: true });
  await appendFile(logPath, `${JSON.stringify(row)}\n`, "utf8");

  return NextResponse.json({ ok: true }, { status: 201 });
}
