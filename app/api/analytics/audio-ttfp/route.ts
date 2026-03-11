import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse, type NextRequest } from "next/server"

import { readAuthSessionFromRequest } from "../../../lib/auth/session"
import { allowRateLimit } from "../../../lib/security/rateLimit"

export const runtime = "nodejs"

type AudioTtfpPayload = {
  trackScopeId?: unknown
  trigger?: unknown
  finalStage?: unknown
  ttfpMs?: unknown
  sampleCount?: unknown
  p50Ms?: unknown
  p95Ms?: unknown
  clickToPlayMs?: unknown
  playToCtxResumeMs?: unknown
  ctxResumeToSeekMs?: unknown
  seekToEngineStartMs?: unknown
  engineStartToGateOpenMs?: unknown
  gateOpenToPlayingMs?: unknown
  route?: unknown
  locale?: unknown
  userAgent?: unknown
  startedAt?: unknown
}

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, limit)
}

function normalizeNonNegativeFloat(value: unknown, max: number): number | undefined {
  const num = Number(value)
  if (!Number.isFinite(num)) return undefined
  return Math.max(0, Math.min(max, Number(num.toFixed(1))))
}

function normalizeNonNegativeInt(value: unknown, max: number): number | undefined {
  const num = Number(value)
  if (!Number.isFinite(num)) return undefined
  return Math.max(0, Math.min(max, Math.floor(num)))
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  if (!allowRateLimit(`analytics-audio-ttfp:post:${ip}`, 360, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  let payload: AudioTtfpPayload = {}
  try {
    payload = (await request.json()) as AudioTtfpPayload
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const trackScopeId = normalizeText(payload.trackScopeId, 220)
  const ttfpMs = normalizeNonNegativeFloat(payload.ttfpMs, 120_000)
  if (!trackScopeId || typeof ttfpMs !== "number" || ttfpMs <= 0) {
    return NextResponse.json({ error: "trackScopeId and ttfpMs are required" }, { status: 400 })
  }

  const session = await readAuthSessionFromRequest(request)

  const row = {
    track_scope_id: trackScopeId,
    trigger: normalizeText(payload.trigger, 80) || "auto",
    final_stage: normalizeText(payload.finalStage, 40) || "playing_state",
    ttfp_ms: ttfpMs,
    sample_count: normalizeNonNegativeInt(payload.sampleCount, 10_000) ?? 0,
    p50_ms: normalizeNonNegativeFloat(payload.p50Ms, 120_000) ?? 0,
    p95_ms: normalizeNonNegativeFloat(payload.p95Ms, 120_000) ?? 0,
    click_to_play_ms: normalizeNonNegativeFloat(payload.clickToPlayMs, 120_000) ?? null,
    play_to_ctx_resume_ms: normalizeNonNegativeFloat(payload.playToCtxResumeMs, 120_000) ?? null,
    ctx_resume_to_seek_ms: normalizeNonNegativeFloat(payload.ctxResumeToSeekMs, 120_000) ?? null,
    seek_to_engine_start_ms: normalizeNonNegativeFloat(payload.seekToEngineStartMs, 120_000) ?? null,
    engine_start_to_gate_open_ms: normalizeNonNegativeFloat(payload.engineStartToGateOpenMs, 120_000) ?? null,
    gate_open_to_playing_ms: normalizeNonNegativeFloat(payload.gateOpenToPlayingMs, 120_000) ?? null,
    route: normalizeText(payload.route, 220) || "",
    locale: normalizeText(payload.locale, 12) || "",
    user_agent:
      normalizeText(payload.userAgent, 220) || normalizeText(request.headers.get("user-agent"), 220) || "",
    started_at: normalizeText(payload.startedAt, 40) || "",
    user_id: session?.userId || "",
    ingested_at: new Date().toISOString(),
  }

  const logDir = join(process.cwd(), "data", "analytics")
  const logPath = join(logDir, "audio-ttfp-events.ndjson")
  await mkdir(logDir, { recursive: true })
  await appendFile(logPath, `${JSON.stringify(row)}\n`, "utf8")

  return NextResponse.json({ ok: true }, { status: 201 })
}
