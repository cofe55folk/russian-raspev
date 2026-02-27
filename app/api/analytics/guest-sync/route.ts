import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { allowRateLimit } from "../../../lib/security/rateLimit";

export const runtime = "nodejs";

type GuestSyncTelemetryPayload = {
  trackScopeId?: unknown;
  reason?: unknown;
  sampleCount?: unknown;
  avgAbsDriftMs?: unknown;
  maxAbsDriftMs?: unknown;
  softCorrections?: unknown;
  hardCorrections?: unknown;
  route?: unknown;
  locale?: unknown;
  userAgent?: unknown;
};

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, limit);
}

function normalizeNonNegativeInt(value: unknown, max: number): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(max, Math.floor(num)));
}

function normalizeNonNegativeFloat(value: unknown, max: number): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(max, Number(num.toFixed(2))));
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`analytics-guest-sync:post:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: GuestSyncTelemetryPayload = {};
  try {
    payload = (await request.json()) as GuestSyncTelemetryPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const trackScopeId = normalizeText(payload.trackScopeId, 220);
  const sampleCount = normalizeNonNegativeInt(payload.sampleCount, 100_000);
  if (!trackScopeId || !sampleCount || sampleCount <= 0) {
    return NextResponse.json({ error: "trackScopeId and sampleCount are required" }, { status: 400 });
  }

  const session = await readAuthSessionFromRequest(request);

  const row = {
    track_scope_id: trackScopeId,
    reason: normalizeText(payload.reason, 64) || "periodic",
    sample_count: sampleCount,
    avg_abs_drift_ms: normalizeNonNegativeFloat(payload.avgAbsDriftMs, 20_000) ?? 0,
    max_abs_drift_ms: normalizeNonNegativeFloat(payload.maxAbsDriftMs, 20_000) ?? 0,
    soft_corrections: normalizeNonNegativeInt(payload.softCorrections, 100_000) ?? 0,
    hard_corrections: normalizeNonNegativeInt(payload.hardCorrections, 100_000) ?? 0,
    route: normalizeText(payload.route, 220) || "",
    locale: normalizeText(payload.locale, 12) || "",
    user_agent:
      normalizeText(payload.userAgent, 220) || normalizeText(request.headers.get("user-agent"), 220) || "",
    user_id: session?.userId || "",
    ingested_at: new Date().toISOString(),
  };

  const logDir = join(process.cwd(), "data", "analytics");
  const logPath = join(logDir, "guest-sync-events.ndjson");
  await mkdir(logDir, { recursive: true });
  await appendFile(logPath, `${JSON.stringify(row)}\n`, "utf8");

  return NextResponse.json({ ok: true }, { status: 201 });
}
