import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { isMiniPlayerAction, isMiniPlayerEndStreamReason } from "../../../lib/analytics/miniplayerContract";
import { allowRateLimit } from "../../../lib/security/rateLimit";

export const runtime = "nodejs";

type MiniPlayerPayload = {
  controllerId?: unknown;
  action?: unknown;
  endStreamReason?: unknown;
  playing?: unknown;
  currentSec?: unknown;
  durationSec?: unknown;
  loopOn?: unknown;
  playlistIndex?: unknown;
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

function normalizeBool(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null;
  return value;
}

function normalizeInt(value: unknown, max: number): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(max, Math.floor(num)));
}

function normalizeFloat(value: unknown, max: number): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(max, Number(num.toFixed(3))));
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`analytics-miniplayer:post:${ip}`, 360, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: MiniPlayerPayload = {};
  try {
    payload = (await request.json()) as MiniPlayerPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const controllerId = normalizeText(payload.controllerId, 120);
  const action = normalizeText(payload.action, 64);
  if (!controllerId || !action) {
    return NextResponse.json({ error: "controllerId and action are required" }, { status: 400 });
  }
  if (!isMiniPlayerAction(action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const endStreamReason = normalizeText(payload.endStreamReason, 64);
  if (endStreamReason && !isMiniPlayerEndStreamReason(endStreamReason)) {
    return NextResponse.json({ error: "invalid_end_stream_reason" }, { status: 400 });
  }

  const session = await readAuthSessionFromRequest(request);
  const row = {
    controller_id: controllerId,
    action,
    end_stream_reason: endStreamReason || "",
    playing: normalizeBool(payload.playing),
    current_sec: normalizeFloat(payload.currentSec, 60 * 60 * 8) ?? 0,
    duration_sec: normalizeFloat(payload.durationSec, 60 * 60 * 8) ?? 0,
    loop_on: normalizeBool(payload.loopOn),
    playlist_index: normalizeInt(payload.playlistIndex, 5000) ?? 0,
    route: normalizeText(payload.route, 220) || "",
    locale: normalizeText(payload.locale, 8) || "",
    user_agent:
      normalizeText(payload.userAgent, 220) || normalizeText(request.headers.get("user-agent"), 220) || "",
    user_id: session?.userId || "",
    ingested_at: new Date().toISOString(),
  };

  const logDir = join(process.cwd(), "data", "analytics");
  const logPath = join(logDir, "miniplayer-events.ndjson");
  await mkdir(logDir, { recursive: true });
  await appendFile(logPath, `${JSON.stringify(row)}\n`, "utf8");

  return NextResponse.json({ ok: true }, { status: 201 });
}
