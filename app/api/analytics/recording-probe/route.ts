import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { allowRateLimit } from "../../../lib/security/rateLimit";

export const runtime = "nodejs";

type RecordingProbePayload = {
  trackScopeId?: unknown;
  reason?: unknown;
  recordingEngine?: unknown;
  recordingV2FlagEnabled?: unknown;
  mimeType?: unknown;
  mediaRecorderSupported?: unknown;
  audioWorkletSupported?: unknown;
  opfsSupported?: unknown;
  baseLatencyMs?: unknown;
  outputLatencyMs?: unknown;
  inputLatencyMs?: unknown;
  inputSampleRate?: unknown;
  inputSampleSize?: unknown;
  inputChannelCount?: unknown;
  inputEchoCancellation?: unknown;
  inputNoiseSuppression?: unknown;
  inputAutoGainControl?: unknown;
  dropoutCount?: unknown;
  recoveryCount?: unknown;
  workletTapActive?: unknown;
  workletFramesCaptured?: unknown;
  workletChunkReports?: unknown;
  workletTapErrors?: unknown;
  opfsWriterActive?: unknown;
  opfsBytesWritten?: unknown;
  opfsChunkCount?: unknown;
  opfsWriteErrors?: unknown;
  uploadState?: unknown;
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

function normalizeNonNegativeInt(value: unknown, max: number): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(max, Math.floor(num)));
}

function normalizeBool(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null;
  return value;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`analytics-recording-probe:post:${ip}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: RecordingProbePayload = {};
  try {
    payload = (await request.json()) as RecordingProbePayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const trackScopeId = normalizeText(payload.trackScopeId, 220);
  const reason = normalizeText(payload.reason, 64);
  if (!trackScopeId || !reason) {
    return NextResponse.json({ error: "trackScopeId and reason are required" }, { status: 400 });
  }

  const session = await readAuthSessionFromRequest(request);

  const row = {
    track_scope_id: trackScopeId,
    reason,
    recording_engine: normalizeText(payload.recordingEngine, 64) || "",
    recording_v2_flag_enabled: normalizeBool(payload.recordingV2FlagEnabled),
    mime_type: normalizeText(payload.mimeType, 120) || "",
    media_recorder_supported: normalizeBool(payload.mediaRecorderSupported),
    audio_worklet_supported: normalizeBool(payload.audioWorkletSupported),
    opfs_supported: normalizeBool(payload.opfsSupported),
    base_latency_ms: normalizeNonNegativeInt(payload.baseLatencyMs, 20_000),
    output_latency_ms: normalizeNonNegativeInt(payload.outputLatencyMs, 20_000),
    input_latency_ms: normalizeNonNegativeInt(payload.inputLatencyMs, 20_000),
    input_sample_rate: normalizeNonNegativeInt(payload.inputSampleRate, 192_000),
    input_sample_size: normalizeNonNegativeInt(payload.inputSampleSize, 64),
    input_channel_count: normalizeNonNegativeInt(payload.inputChannelCount, 16),
    input_echo_cancellation: normalizeBool(payload.inputEchoCancellation),
    input_noise_suppression: normalizeBool(payload.inputNoiseSuppression),
    input_auto_gain_control: normalizeBool(payload.inputAutoGainControl),
    dropout_count: normalizeNonNegativeInt(payload.dropoutCount, 100_000) ?? 0,
    recovery_count: normalizeNonNegativeInt(payload.recoveryCount, 100_000) ?? 0,
    worklet_tap_active: normalizeBool(payload.workletTapActive),
    worklet_frames_captured: normalizeNonNegativeInt(payload.workletFramesCaptured, 10_000_000_000) ?? 0,
    worklet_chunk_reports: normalizeNonNegativeInt(payload.workletChunkReports, 10_000_000) ?? 0,
    worklet_tap_errors: normalizeNonNegativeInt(payload.workletTapErrors, 100_000) ?? 0,
    opfs_writer_active: normalizeBool(payload.opfsWriterActive),
    opfs_bytes_written: normalizeNonNegativeInt(payload.opfsBytesWritten, 50_000_000_000) ?? 0,
    opfs_chunk_count: normalizeNonNegativeInt(payload.opfsChunkCount, 10_000_000) ?? 0,
    opfs_write_errors: normalizeNonNegativeInt(payload.opfsWriteErrors, 100_000) ?? 0,
    upload_state: normalizeText(payload.uploadState, 32) || "",
    route: normalizeText(payload.route, 220) || "",
    locale: normalizeText(payload.locale, 12) || "",
    user_agent:
      normalizeText(payload.userAgent, 220) || normalizeText(request.headers.get("user-agent"), 220) || "",
    user_id: session?.userId || "",
    captured_at: normalizeText(payload.capturedAt, 40) || new Date().toISOString(),
    ingested_at: new Date().toISOString(),
  };

  const logDir = join(process.cwd(), "data", "analytics");
  const logPath = join(logDir, "recording-probe-events.ndjson");
  await mkdir(logDir, { recursive: true });
  await appendFile(logPath, `${JSON.stringify(row)}\n`, "utf8");

  return NextResponse.json({ ok: true }, { status: 201 });
}
