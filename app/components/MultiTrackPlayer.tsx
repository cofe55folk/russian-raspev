"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { createSoundTouchEngine, type SoundTouchEngine } from "./audio/soundtouchEngine"
import { clearGlobalAudio, requestGlobalAudio, type GlobalAudioController } from "../lib/globalAudioManager"
import { emitMiniPlayerTelemetry } from "../lib/analytics/emitMiniPlayerTelemetry"
import { I18N_MESSAGES, type I18nKey } from "../lib/i18n/messages"
import { createRecordingV2OpfsWriter, type RecordingV2OpfsWriter } from "../lib/ugc/recording-v2-opfs-client"
import { drainRecordingV2UploadQueue, enqueueRecordingV2Upload, uploadRecordingV2TakeFromOpfs } from "../lib/ugc/recording-v2-upload-client"

export type TrackDef = { name: string; src: string; defaultVolume?: number }
type WavePeaks = { min: Float32Array; max: Float32Array }
type TeleprompterLine = { time: number; text: string }
type TeleprompterAnchorMap = Record<number, number>
type TeleprompterTextOverrideMap = Record<number, string>
type TeleprompterDraftState = {
  savedAt: string
  lines: TeleprompterLine[]
  anchors: TeleprompterAnchorMap
  textOverrides: TeleprompterTextOverrideMap
}
type TeleprompterBackupPayload = {
  draft_saved_at?: unknown
  lines_raw?: unknown
  lines?: unknown
  lines_effective?: unknown
  anchors?: unknown
  text_overrides?: unknown
  textOverrides?: unknown
}
type ExportFormat = "m4a" | "mp3" | "wav"
type UiLang = "ru" | "en"
type RecordingMode = "compatibility" | "local_master"
type NavHandoffState = {
  trackScopeId: string
  positionSec: number
  loopOn: boolean
  playing: boolean
  ts: number
}
type GuestTakeMeta = {
  id: string
  title: string
  createdAt: string
  sourceKey: string
  referenceTrackIndex: number
  deviceProfileId?: string
  offsetSec?: number
  score?: number | null
  syncQuality?: GuestSyncQuality
  durationSec?: number
}
type GuestTakesState = {
  activeTakeId: string | null
  takes: GuestTakeMeta[]
}
type DeviceLatencyProfile = {
  id: string
  label: string
  offsetSec: number
  updatedAt: string
}
type GuestDriftTelemetrySnapshot = {
  sampleCount: number
  avgAbsDriftMs: number
  maxAbsDriftMs: number
  softCorrections: number
  hardCorrections: number
}
type RecorderCapabilitySnapshot = {
  capturedAt: string
  recordingEngine: "media_recorder_v1" | "recording_v2_preview"
  recordingV2FlagEnabled: boolean
  mimeType: string
  mediaRecorderSupported: boolean
  audioWorkletSupported: boolean
  opfsSupported: boolean
  baseLatencyMs: number | null
  outputLatencyMs: number | null
  inputLatencyMs: number | null
  inputSampleRate: number | null
  inputSampleSize: number | null
  inputChannelCount: number | null
  inputEchoCancellation: boolean | null
  inputNoiseSuppression: boolean | null
  inputAutoGainControl: boolean | null
  dropoutCount: number
  recoveryCount: number
  workletTapActive: boolean
  workletFramesCaptured: number
  workletChunkReports: number
  workletTapErrors: number
  opfsWriterActive: boolean
  opfsBytesWritten: number
  opfsChunkCount: number
  opfsWriteErrors: number
  uploadState: string
}
type RecorderV2TapStats = {
  framesCaptured: number
  chunkReports: number
  errors: number
}
const TELEPROMPTER_LEAD_SEC = 0.18
const COUNT_IN_BEATS = 3
const COUNT_IN_BPM = 72
const DEFAULT_REVERB_AMOUNT = 0.2
const DEFAULT_SPEED = 1
const DEFAULT_PITCH_SEMITONES = 0
const DEFAULT_GUEST_SYNC_SEC = 0.22
const GLOBAL_GUEST_SYNC_STORAGE_KEY = "rr_guest_sync_offset_sec:global_v1"
const NAV_HANDOFF_STORAGE_KEY = "rr_multitrack_nav_handoff_v1"
const NAV_HANDOFF_TTL_MS = 20_000
const FORCE_AUTOPLAY_STORAGE_KEY = "rr_force_autoplay_next_mount"
const GUEST_TAKES_MAX = 12
const GUEST_DEVICE_PROFILE_STORAGE_KEY = "rr_guest_device_latency_profile_v1"
const GUEST_STARTUP_BIAS_SEC = 0
const GUEST_STARTUP_BIAS_DECAY_SEC = 3.5
const GUEST_SYNC_MIN_SEC = -2.5
const GUEST_SYNC_MAX_SEC = 2.5
const GUEST_DRIFT_SOFT_FIX_SEC = 0.024
const GUEST_DRIFT_HARD_FIX_SEC = 0.095
const GUEST_DRIFT_RATE_NUDGE_LIMIT = 0.025
const GUEST_DRIFT_RATE_GAIN = 0.35
const GUEST_DRIFT_SAMPLE_THROTTLE_MS = 120
const GUEST_DRIFT_HARD_FIX_COOLDOWN_MS = 1100
const GUEST_DRIFT_TELEMETRY_FLUSH_MS = 20_000
const RECORD_HEADPHONES_STORAGE_KEY = "rr_record_headphones_confirmed_v1"
const PLAYER_LONGTASK_UI_FLUSH_MIN_MS = 250
const GUEST_CALIBRATE_MAX_ABS_SEC = 1.4
const GUEST_CALIBRATE_SEARCH_SWING_SEC = 0.55
const GUEST_CALIBRATE_MAX_JUMP_SEC = 0.65
const GUEST_CALIBRATE_FINE_BIN_SEC = 0.01
const GUEST_CALIBRATE_FINE_WINDOW_SEC = 0.18
const PREVIEW_FLAGS_COOKIE = "rr_preview_flags_v1"
const PROGRESSIVE_LOAD_PREVIEW_FLAG = "multitrack_progressive_load"
const RECORDING_ENGINE_V2_PREVIEW_FLAG = "recording_engine_v2"
const TRACK_DECODE_MAX_ATTEMPTS = 2
const LARGE_TRACK_BYTES_THRESHOLD = 16 * 1024 * 1024
const TEMPO_PITCH_SMOOTH_MS = 140
const RECORD_STREAM_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
  },
}

type PianoKey = {
  note: string
  freq: number
  isBlack?: boolean
  kbd?: string
  kbdRu?: string
  left?: number
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const
const PIANO_WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23] as const
const PIANO_BLACK_OFFSETS = [
  { semi: 1, afterWhiteIndex: 0 },
  { semi: 3, afterWhiteIndex: 1 },
  { semi: 6, afterWhiteIndex: 3 },
  { semi: 8, afterWhiteIndex: 4 },
  { semi: 10, afterWhiteIndex: 5 },
  { semi: 13, afterWhiteIndex: 7 },
  { semi: 15, afterWhiteIndex: 8 },
  { semi: 18, afterWhiteIndex: 10 },
  { semi: 20, afterWhiteIndex: 11 },
  { semi: 22, afterWhiteIndex: 12 },
] as const
const PIANO_WHITE_KEYS_EN = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "z", "x", "c", "v"] as const
const PIANO_WHITE_KEYS_RU = ["ф", "ы", "в", "а", "п", "р", "о", "л", "д", "ж", "я", "ч", "с", "м"] as const
const PIANO_BLACK_KEYS_EN = ["w", "e", "t", "y", "u", "o", "p", "1", "2", "3"] as const
const PIANO_BLACK_KEYS_RU = ["ц", "у", "е", "н", "г", "щ", "з", "1", "2", "3"] as const
const OCTAVE_NAMES = ["Субконтр", "Контр", "Большая", "Малая", "1-я", "2-я", "3-я", "4-я"] as const

const MULTITRACK_LEGACY_MESSAGES: Record<UiLang, Record<string, string>> = {
  ru: {
    "multitrack.volume": "Громкость",
    "multitrack.reverb": "Реверб",
    "multitrack.speed": "Скорость",
    "multitrack.pitch": "Высота",
    "multitrack.pan": "Пан",
    "multitrack.solo": "Соло",
    "multitrack.mute": "Выкл",
    "multitrack.save": "Скачать",
    "multitrack.export": "Экспорт...",
    "multitrack.soloFmtM4a": "Соло · m4a",
    "multitrack.soloFmtMp3": "Соло · mp3 320",
    "multitrack.soloFmtWav": "Соло · wav",
    "multitrack.guestPanelTitle": "Гостевая дорожка",
    "multitrack.loadingAudio": "Загрузка аудио...",
    "multitrack.goToStartAria": "В начало",
    "multitrack.goToStartTitle": "В начало (без воспроизведения)",
    "multitrack.playAria": "Воспроизвести",
    "multitrack.pauseAria": "Пауза",
    "multitrack.playButton": "▶ Воспроизвести",
    "multitrack.pauseButton": "Пауза",
    "multitrack.repeatTrackAria": "Повтор трека",
    "multitrack.repeatTrackTitle": "Повтор трека",
    "multitrack.recordGuestStartAria": "Записать гостевую дорожку",
    "multitrack.recordGuestStopAria": "Остановить запись гостевой дорожки",
    "multitrack.recordGuestStartTitle": "Записать гостевую дорожку",
    "multitrack.recordGuestStopTitle": "Стоп записи",
    "multitrack.recSoloHint": "Выберите один голос Solo для записи",
    "multitrack.trackPositionAria": "Позиция трека",
    "multitrack.masterVolumeAria": "Громкость мастер-канала",
    "multitrack.speedAria": "Скорость воспроизведения",
    "multitrack.calibrating": "Подбор...",
    "multitrack.delayDetected": "Задержка подобрана",
    "multitrack.delayPending": "Ожидает подбора",
    "multitrack.syncCheck": "Проверка синхронизации",
    "multitrack.countInPrefix": "Отсчёт",
    "multitrack.left": "Л",
    "multitrack.right": "П",
    "multitrack.volShort": "Гр.",
    "multitrack.tempoLocked": "Нельзя менять скорость в текущем режиме",
    "multitrack.pitchLocked": "Нельзя менять высоту в текущем режиме",
    "multitrack.teleprompterTitle": "Суфлёр",
    "multitrack.teleprompterEmptyHint": "Подключи таймкоды для суфлёра",
    "multitrack.syncUnknown": "Нет данных",
    "multitrack.delay": "Задержка",
    "multitrack.recordChecklist": "Чек-лист записи",
    "multitrack.guestGoToStartAria": "К началу гостевой",
    "multitrack.guestWithTrackStart": "Гость + трек",
    "multitrack.guestWithTrackStop": "Остановить Гость + трек",
    "multitrack.guestRepeatFragmentTitle": "Повтор фрагмента",
    "multitrack.guestPanAria": "Панорама гостя",
    "multitrack.guestVolumeAria": "Громкость гостя",
    "multitrack.guestDelayAria": "Задержка гостя",
    "multitrack.takes": "Дубли",
    "multitrack.activateTake": "Активировать дубль",
    "multitrack.pianoShow": "Показать фортепиано",
    "multitrack.pianoHide": "Скрыть фортепиано",
    "multitrack.teleprompterSettingsShow": "Показать настройки суфлёра",
  },
  en: {
    "multitrack.volume": "Volume",
    "multitrack.reverb": "Reverb",
    "multitrack.speed": "Speed",
    "multitrack.pitch": "Pitch",
    "multitrack.pan": "Pan",
    "multitrack.solo": "Solo",
    "multitrack.mute": "Mute",
    "multitrack.save": "Save",
    "multitrack.export": "Export...",
    "multitrack.soloFmtM4a": "Solo · m4a",
    "multitrack.soloFmtMp3": "Solo · mp3 320",
    "multitrack.soloFmtWav": "Solo · wav",
    "multitrack.guestPanelTitle": "Guest track",
    "multitrack.loadingAudio": "Loading audio...",
    "multitrack.goToStartAria": "Go to start",
    "multitrack.goToStartTitle": "Go to start (without playback)",
    "multitrack.playAria": "Play",
    "multitrack.pauseAria": "Pause",
    "multitrack.playButton": "▶ Play",
    "multitrack.pauseButton": "Pause",
    "multitrack.repeatTrackAria": "Repeat track",
    "multitrack.repeatTrackTitle": "Repeat track",
    "multitrack.recordGuestStartAria": "Record guest track",
    "multitrack.recordGuestStopAria": "Stop guest track recording",
    "multitrack.recordGuestStartTitle": "Record guest track",
    "multitrack.recordGuestStopTitle": "Stop recording",
    "multitrack.recSoloHint": "Select one solo voice for recording",
    "multitrack.trackPositionAria": "Track position",
    "multitrack.masterVolumeAria": "Master volume",
    "multitrack.speedAria": "Playback speed",
    "multitrack.calibrating": "Calibrating...",
    "multitrack.delayDetected": "Delay calibrated",
    "multitrack.delayPending": "Calibration pending",
    "multitrack.syncCheck": "Sync check",
    "multitrack.countInPrefix": "Count-in",
    "multitrack.left": "L",
    "multitrack.right": "R",
    "multitrack.volShort": "Vol",
    "multitrack.tempoLocked": "Tempo is locked in this mode",
    "multitrack.pitchLocked": "Pitch is locked in this mode",
    "multitrack.teleprompterTitle": "Teleprompter",
    "multitrack.teleprompterEmptyHint": "Attach timed lyrics for teleprompter",
    "multitrack.syncUnknown": "Unknown",
    "multitrack.delay": "Delay",
    "multitrack.recordChecklist": "Recording checklist",
    "multitrack.guestGoToStartAria": "Go to guest start",
    "multitrack.guestWithTrackStart": "Guest + track",
    "multitrack.guestWithTrackStop": "Stop Guest + track",
    "multitrack.guestRepeatFragmentTitle": "Repeat fragment",
    "multitrack.guestPanAria": "Guest pan",
    "multitrack.guestVolumeAria": "Guest volume",
    "multitrack.guestDelayAria": "Guest delay",
    "multitrack.takes": "Takes",
    "multitrack.activateTake": "Activate take",
    "multitrack.pianoShow": "Show piano",
    "multitrack.pianoHide": "Hide piano",
    "multitrack.teleprompterSettingsShow": "Show teleprompter settings",
  },
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}
function formatTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s < 10 ? "0" : ""}${s}`
}

function hasClientPreviewFlag(flagKey: string): boolean {
  if (typeof document === "undefined") return false
  const prefix = `${PREVIEW_FLAGS_COOKIE}=`
  const rawCookie = document.cookie
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(prefix))
  if (!rawCookie) return false
  const rawValue = rawCookie.slice(prefix.length)
  let decoded = rawValue
  try {
    decoded = decodeURIComponent(rawValue)
  } catch {}
  return decoded
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(flagKey)
}

function shouldPreferProgressiveLoad(trackList: TrackDef[]): boolean {
  if (typeof navigator === "undefined") return false
  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
  if (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4) return true
  return trackList.length >= 6
}

function buildGuestTakeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `take-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function resolveUiLangFromDocument(): UiLang {
  if (typeof window !== "undefined") {
    const pathname = window.location.pathname.toLowerCase()
    if (pathname === "/en" || pathname.startsWith("/en/")) return "en"
    return "ru"
  }
  if (typeof document === "undefined") return "ru"
  const langAttr = document.documentElement.lang?.toLowerCase() || "ru"
  return langAttr.startsWith("en") ? "en" : "ru"
}

function midiToFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function midiToNote(midi: number) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

function buildTrackScopeId(trackList: TrackDef[]): string {
  const raw = trackList.map((t) => t.src).join("|")
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return normalized.slice(0, 180) || "default"
}

function toLatencyMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value * 1000))
}

function toTrackSettingNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

function toTrackSettingBool(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null
  return value
}

function isOpfsAvailable(): boolean {
  if (typeof navigator === "undefined") return false
  const navWithStorage = navigator as Navigator & { storage?: { getDirectory?: () => Promise<unknown> } }
  return typeof navWithStorage.storage?.getDirectory === "function"
}

function buildRecorderCapabilitySnapshot(params: {
  ctx: AudioContext | null
  stream: MediaStream | null
  mimeType: string
  recordingV2FlagEnabled: boolean
  dropoutCount: number
  recoveryCount: number
  workletTapActive?: boolean
  workletFramesCaptured?: number
  workletChunkReports?: number
  workletTapErrors?: number
  opfsWriterActive?: boolean
  opfsBytesWritten?: number
  opfsChunkCount?: number
  opfsWriteErrors?: number
  uploadState?: string
}): RecorderCapabilitySnapshot {
  const inputTrack = params.stream?.getAudioTracks?.()?.[0]
  const inputSettings = inputTrack?.getSettings?.() as
    | (MediaTrackSettings & {
        latency?: number
        echoCancellation?: boolean
        noiseSuppression?: boolean
        autoGainControl?: boolean
      })
    | undefined
  const ctxWithOutput = params.ctx as AudioContext & { outputLatency?: number }
  const hasAudioWorklet = Boolean(params.ctx?.audioWorklet) || typeof AudioWorkletNode !== "undefined"
  return {
    capturedAt: new Date().toISOString(),
    recordingEngine: params.recordingV2FlagEnabled ? "recording_v2_preview" : "media_recorder_v1",
    recordingV2FlagEnabled: params.recordingV2FlagEnabled,
    mimeType: params.mimeType || "default",
    mediaRecorderSupported: typeof MediaRecorder !== "undefined",
    audioWorkletSupported: hasAudioWorklet,
    opfsSupported: isOpfsAvailable(),
    baseLatencyMs: toLatencyMs(params.ctx?.baseLatency),
    outputLatencyMs: toLatencyMs(ctxWithOutput?.outputLatency),
    inputLatencyMs: toLatencyMs(inputSettings?.latency),
    inputSampleRate: toTrackSettingNumber(inputSettings?.sampleRate),
    inputSampleSize: toTrackSettingNumber(inputSettings?.sampleSize),
    inputChannelCount: toTrackSettingNumber(inputSettings?.channelCount),
    inputEchoCancellation: toTrackSettingBool(inputSettings?.echoCancellation),
    inputNoiseSuppression: toTrackSettingBool(inputSettings?.noiseSuppression),
    inputAutoGainControl: toTrackSettingBool(inputSettings?.autoGainControl),
    dropoutCount: Math.max(0, Math.floor(params.dropoutCount)),
    recoveryCount: Math.max(0, Math.floor(params.recoveryCount)),
    workletTapActive: !!params.workletTapActive,
    workletFramesCaptured: Math.max(0, Math.floor(params.workletFramesCaptured ?? 0)),
    workletChunkReports: Math.max(0, Math.floor(params.workletChunkReports ?? 0)),
    workletTapErrors: Math.max(0, Math.floor(params.workletTapErrors ?? 0)),
    opfsWriterActive: !!params.opfsWriterActive,
    opfsBytesWritten: Math.max(0, Math.floor(params.opfsBytesWritten ?? 0)),
    opfsChunkCount: Math.max(0, Math.floor(params.opfsChunkCount ?? 0)),
    opfsWriteErrors: Math.max(0, Math.floor(params.opfsWriteErrors ?? 0)),
    uploadState: typeof params.uploadState === "string" ? params.uploadState : "idle",
  }
}

const CYRILLIC_VOWEL = "[АЕЁИОУЫЭЮЯаеёиоуыэюя]"
const MELISMA_GROUP_RE = /\(([^()]*)\)/g
const MELISMA_UNDERSCORE_RE = new RegExp(`^_(${CYRILLIC_VOWEL})_$`, "u")
const MELISMA_HTML_U_RE = new RegExp(`^<u>\\s*(${CYRILLIC_VOWEL})\\s*<\\/u>$`, "iu")
const MELISMA_COMBINING_RE = new RegExp(`^(${CYRILLIC_VOWEL})[\\u0331\\u0332]+$`, "u")

function extractMarkedMelismaVowel(rawInner: string): string | null {
  const inner = rawInner.trim()
  const byUnderscore = inner.match(MELISMA_UNDERSCORE_RE)?.[1]
  if (byUnderscore) return byUnderscore
  const byHtmlUnderline = inner.match(MELISMA_HTML_U_RE)?.[1]
  if (byHtmlUnderline) return byHtmlUnderline
  const byCombining = inner.match(MELISMA_COMBINING_RE)?.[1]
  if (byCombining) return byCombining
  return null
}

function renderTeleprompterLineText(text: string) {
  if (!text) return text
  MELISMA_GROUP_RE.lastIndex = 0
  const matches = Array.from(text.matchAll(MELISMA_GROUP_RE))
  if (!matches.length) return text

  const out: React.ReactNode[] = []
  let cursor = 0
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const start = match.index ?? 0
    if (start > cursor) out.push(text.slice(cursor, start))

    const vowel = extractMarkedMelismaVowel(match[1] ?? "")
    if (vowel) {
      out.push("(")
      out.push(
        <span key={`melisma-${start}-${i}`} className="underline decoration-[1.5px] underline-offset-[2px]">
          {vowel}
        </span>
      )
      out.push(")")
    } else {
      out.push(match[0])
    }
    cursor = start + match[0].length
  }
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

function normalizeTeleprompterLines(input: unknown): TeleprompterLine[] {
  if (!Array.isArray(input)) return []
  return input.map((line, idx) => {
    const candidate = line as Partial<TeleprompterLine> | null
    const rawTime = Number(candidate?.time)
    return {
      time: Number.isFinite(rawTime) ? Math.max(0, Number(rawTime.toFixed(3))) : idx * 2,
      text: typeof candidate?.text === "string" ? candidate.text : "",
    }
  })
}

function normalizeTeleprompterAnchors(input: unknown): TeleprompterAnchorMap {
  if (!input || typeof input !== "object") return {}
  const normalized: TeleprompterAnchorMap = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const idx = Number(k)
    const t = Number(v)
    if (Number.isFinite(idx) && Number.isFinite(t) && idx >= 0 && t >= 0) normalized[idx] = Number(t.toFixed(3))
  }
  return normalized
}

function normalizeTeleprompterTextOverrides(input: unknown): TeleprompterTextOverrideMap {
  if (!input || typeof input !== "object") return {}
  const normalized: TeleprompterTextOverrideMap = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const idx = Number(k)
    if (Number.isFinite(idx) && idx >= 0 && typeof v === "string") normalized[idx] = v
  }
  return normalized
}

function parseTeleprompterDraftState(raw: string | null): TeleprompterDraftState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TeleprompterDraftState> | null
    if (!parsed || typeof parsed !== "object") return null
    return {
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
      lines: normalizeTeleprompterLines(parsed.lines),
      anchors: normalizeTeleprompterAnchors(parsed.anchors),
      textOverrides: normalizeTeleprompterTextOverrides(parsed.textOverrides),
    }
  } catch {
    return null
  }
}

function buildTeleprompterLinesSignature(lines: TeleprompterLine[]): string {
  if (!lines.length) return ""
  return lines.map((line) => `${line.time.toFixed(3)}\u0001${line.text}`).join("\u0002")
}

function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return ""
  const candidates = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ]
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return ""
}

function mimeByExportFormat(format: ExportFormat): string {
  if (format === "m4a") return "audio/mp4;codecs=mp4a.40.2"
  if (format === "mp3") return "audio/mpeg"
  return "audio/wav"
}

function estimateLatencyCompensationSec(ctx: AudioContext | null, stream: MediaStream | null): number {
  const baseLatency = ctx?.baseLatency ?? 0
  const outputLatency = typeof (ctx as AudioContext & { outputLatency?: number })?.outputLatency === "number"
    ? ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0)
    : 0
  const inputTrack = stream?.getAudioTracks?.()?.[0]
  const inputSettings = inputTrack?.getSettings?.() as (MediaTrackSettings & { latency?: number }) | undefined
  const inputLatency = typeof inputSettings?.latency === "number" ? inputSettings.latency : 0
  const raw = baseLatency + outputLatency + inputLatency
  return clamp(raw, 0, 0.35)
}

function encodeStereoWav(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
  const frames = Math.min(left.length, right.length)
  const bytesPerSample = 2
  const channels = 2
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]))
    const r = Math.max(-1, Math.min(1, right[i]))
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true)
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true)
    offset += 4
  }

  return new Blob([buffer], { type: "audio/wav" })
}

async function normalizeRecordedBlobToStereoWav(input: Blob): Promise<Blob> {
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return input

  const arr = await input.arrayBuffer()
  const ctx = new AudioContextCtor()
  try {
    const decoded = await ctx.decodeAudioData(arr.slice(0))
    const left = decoded.getChannelData(0)
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0)
    return encodeStereoWav(left, right, decoded.sampleRate)
  } catch {
    return input
  } finally {
    void ctx.close()
  }
}

/** =========================
 *  PEAKS + WAVE DRAW
 *  ========================= */
function computePeaks(buffer: AudioBuffer, buckets: number): WavePeaks {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const safeBuckets = Math.max(1, Math.min(buckets, length))

  const min = new Float32Array(safeBuckets)
  const max = new Float32Array(safeBuckets)
  for (let i = 0; i < safeBuckets; i++) {
    min[i] = 1
    max[i] = -1
  }

  const samplesPerBucket = Math.max(1, Math.floor(length / safeBuckets))
  for (let b = 0; b < safeBuckets; b++) {
    const start = b * samplesPerBucket
    const end = Math.min(length, start + samplesPerBucket)

    let localMin = 1
    let localMax = -1

    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c)
      for (let i = start; i < end; i++) {
        const v = data[i]
        if (v < localMin) localMin = v
        if (v > localMax) localMax = v
      }
    }

    min[b] = localMin
    max[b] = localMax
  }

  return { min, max }
}

function makeFlatPeaks(buckets = 1200): WavePeaks {
  const min = new Float32Array(buckets)
  const max = new Float32Array(buckets)
  for (let i = 0; i < buckets; i++) {
    min[i] = -0.02
    max[i] = 0.02
  }
  return { min, max }
}

function drawWaveform(canvas: HTMLCanvasElement, peaks: WavePeaks, progress01: number) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  const W = Math.max(1, Math.floor(cssW * dpr))
  const H = Math.max(1, Math.floor(cssH * dpr))
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = "rgba(255,255,255,0.05)"
  ctx.fillRect(0, 0, W, H)

  const mid = H / 2
  const amp = H * 0.42
  const peaksLen = peaks.min.length
  const idxAt = (x: number) => Math.min(peaksLen - 1, Math.floor((x / (W - 1)) * peaksLen))

  // base
  ctx.lineWidth = 1
  ctx.strokeStyle = "rgba(255,255,255,0.32)"
  ctx.beginPath()
  for (let x = 0; x < W; x++) {
    const idx = idxAt(x)
    const y1 = mid + peaks.min[idx] * amp
    const y2 = mid + peaks.max[idx] * amp
    ctx.moveTo(x + 0.5, y1)
    ctx.lineTo(x + 0.5, y2)
  }
  ctx.stroke()

  // progress overlay
  const progX = Math.floor(W * clamp(progress01, 0, 1))
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, progX, H)
  ctx.clip()

  ctx.strokeStyle = "rgba(255,255,255,0.9)"
  ctx.beginPath()
  for (let x = 0; x < W; x++) {
    const idx = idxAt(x)
    const y1 = mid + peaks.min[idx] * amp
    const y2 = mid + peaks.max[idx] * amp
    ctx.moveTo(x + 0.5, y1)
    ctx.lineTo(x + 0.5, y2)
  }
  ctx.stroke()
  ctx.restore()

  // playhead
  ctx.fillStyle = "rgba(255,255,255,0.85)"
  ctx.fillRect(progX, 0, Math.max(1, Math.floor(1 * dpr)), H)
}

function buildRmsEnvelopeByTime(buffer: AudioBuffer, binSec = 0.02, maxSec = 60): Float32Array {
  const channels = buffer.numberOfChannels
  const totalSamples = buffer.length
  const sampleRate = buffer.sampleRate
  const maxSamples = Math.min(totalSamples, Math.floor(sampleRate * maxSec))
  const binSamples = Math.max(64, Math.floor(sampleRate * binSec))
  const bins = Math.max(1, Math.floor(maxSamples / binSamples))
  const env = new Float32Array(bins)

  const chData: Float32Array[] = []
  for (let c = 0; c < channels; c++) chData.push(buffer.getChannelData(c))

  for (let b = 0; b < bins; b++) {
    const start = b * binSamples
    const end = Math.min(maxSamples, start + binSamples)
    let acc = 0
    let count = 0
    for (let i = start; i < end; i++) {
      let v = 0
      for (let c = 0; c < channels; c++) v += chData[c][i]
      v /= channels
      acc += v * v
      count += 1
    }
    env[b] = count > 0 ? Math.sqrt(acc / count) : 0
  }
  return env
}

function estimateOffsetByCorrelation(
  mainEnv: Float32Array,
  guestEnv: Float32Array,
  maxLagBins: number,
  preferredLagBins = 0
) {
  return estimateOffsetByCorrelationInRange(mainEnv, guestEnv, -Math.max(1, maxLagBins), Math.max(1, maxLagBins), preferredLagBins)
}

function estimateOffsetByCorrelationInRange(
  mainEnv: Float32Array,
  guestEnv: Float32Array,
  minLagBins: number,
  maxLagBins: number,
  preferredLagBins = 0
) {
  const low = Math.min(minLagBins, maxLagBins)
  const high = Math.max(minLagBins, maxLagBins)
  const range = Math.max(1, high - low)
  let bestLag = 0
  let bestScore = -Infinity

  for (let lag = low; lag <= high; lag++) {
    const startMain = lag < 0 ? -lag : 0
    const startGuest = lag > 0 ? lag : 0
    const n = Math.min(mainEnv.length - startMain, guestEnv.length - startGuest)
    if (n < 40) continue

    let sumX = 0
    let sumY = 0
    for (let i = 0; i < n; i++) {
      sumX += mainEnv[startMain + i]
      sumY += guestEnv[startGuest + i]
    }
    const meanX = sumX / n
    const meanY = sumY / n

    let sumXY = 0
    let sumXX = 0
    let sumYY = 0
    for (let i = 0; i < n; i++) {
      const x = mainEnv[startMain + i] - meanX
      const y = guestEnv[startGuest + i] - meanY
      sumXY += x * y
      sumXX += x * x
      sumYY += y * y
    }
    if (sumXX <= 1e-12 || sumYY <= 1e-12) continue
    const corr = sumXY / Math.sqrt(sumXX * sumYY)
    const lagPenalty = 0.06 * (Math.abs(lag - preferredLagBins) / Math.max(1, range))
    const score = corr - lagPenalty
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  return { lagBins: bestLag, score: bestScore }
}

type GuestSyncQuality = "unknown" | "low" | "ok" | "good"

function classifyGuestSyncQuality(score: number): GuestSyncQuality {
  if (!Number.isFinite(score)) return "unknown"
  if (score >= 0.34) return "good"
  if (score >= 0.2) return "ok"
  return "low"
}

function createSilentBuffer(ctx: AudioContext, durationSec: number, sampleRate = 44_100) {
  const safeDuration = clamp(durationSec, 1, 60 * 20)
  const frameCount = Math.max(1, Math.floor(sampleRate * safeDuration))
  return ctx.createBuffer(2, frameCount, sampleRate)
}

/** =========================
 *  REVERB
 *  ========================= */
function makeImpulseResponse(ctx: AudioContext) {
  const seconds = 2.0
  const decay = 4.8
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const impulse = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const t = i / length
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay)
    }
  }
  return impulse
}

/** =========================
 *  SLIDER WITH CENTER MARK
 *  ========================= */
function CenterMarkedSlider(props: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  ariaLabel?: string
  className?: string
  title?: string
  leftLabel?: string
  rightLabel?: string
}) {
  const { value, min, max, step, onChange, ariaLabel, className, title, leftLabel, rightLabel } = props
  const centerPct = min === max ? 50 : clamp(((0 - min) / (max - min)) * 100, 0, 100)

  return (
    <div className={`relative ${className ?? ""}`} title={title}>
      {leftLabel ? <span className="pointer-events-none absolute -left-3 top-1/2 -translate-y-1/2 text-[10px] text-white/60">{leftLabel}</span> : null}
      {rightLabel ? <span className="pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/60">{rightLabel}</span> : null}
      <div
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/45"
        style={{ left: `${centerPct}%` }}
      />
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="w-full range-thin"
      />
    </div>
  )
}

type MultiTrackPlayerProps = {
  tracks?: TrackDef[]
  onTimeChange?: (timeSec: number) => void
  seekToSeconds?: number | null
  teleprompterSourceUrl?: string | null
  teleprompterExpandedText?: string[]
  onControllerReady?: (controller: GlobalAudioController | null) => void
  onPlaybackStateChange?: (playing: boolean) => void
  onTrackSetReady?: (trackScopeId: string) => void
  registerGlobalAudio?: boolean
  persistOnUnmount?: boolean
  showDetailedSections?: boolean
  showControlsBeforeReady?: boolean
  topStatusBanner?: { href: string; text: string } | null
}

export default function MultiTrackPlayer({
  tracks: inputTracks,
  onTimeChange,
  seekToSeconds,
  teleprompterSourceUrl,
  teleprompterExpandedText,
  onControllerReady,
  onPlaybackStateChange,
  onTrackSetReady,
  registerGlobalAudio = true,
  persistOnUnmount = false,
  showDetailedSections = true,
  showControlsBeforeReady = false,
  topStatusBanner = null,
}: MultiTrackPlayerProps = {}) {
  const tracks: TrackDef[] = useMemo(
    () => [
      { name: "Селезень 01", src: "/audio/selezen/selezen-01.m4a" },
      { name: "Селезень 02", src: "/audio/selezen/selezen-02.m4a" },
      { name: "Селезень 03", src: "/audio/selezen/selezen-03.m4a" },
    ],
    []
  )
  const trackList = inputTracks?.length ? inputTracks : tracks
  const trackScopeId = useMemo(() => buildTrackScopeId(trackList), [trackList])
  const initialTrackVolumes = useMemo(
    () => trackList.map((track) => clamp(track.defaultVolume ?? 1, 0, 1.5)),
    [trackList]
  )
  const guestSyncStorageKey = useMemo(() => `rr_guest_sync_offset_sec:${trackScopeId}`, [trackScopeId])
  const guestRecordStorageKey = useMemo(() => `guest:${trackScopeId}`, [trackScopeId])
  const guestTakesStorageKey = useMemo(() => `rr_guest_takes:${trackScopeId}:v1`, [trackScopeId])
  const guestSyncMetricsStorageKey = useMemo(() => `rr_guest_sync_metrics:${trackScopeId}:v1`, [trackScopeId])
  const guestDriftMetricsStorageKey = useMemo(() => `rr_guest_drift_metrics:${trackScopeId}:v1`, [trackScopeId])

  const ctxRef = useRef<AudioContext | null>(null)
  const globalControllerRef = useRef<GlobalAudioController | null>(null)
  const globalControllerIdRef = useRef(`rr-multitrack:${Math.random().toString(36).slice(2)}`)
  const enginesRef = useRef<(SoundTouchEngine | null)[]>(trackList.map(() => null))

  // gate (anti-cascade + clean start/stop)
  const engineGateRef = useRef<GainNode[]>([])

  // per-track nodes
  const trackGainRef = useRef<GainNode[]>([])
  const panRef = useRef<StereoPannerNode[]>([])

  // master
  const masterInRef = useRef<GainNode | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const wetGainRef = useRef<GainNode | null>(null)
  const dryGainRef = useRef<GainNode | null>(null)

  // transport
  const rafRef = useRef<number | null>(null)
  const pendingRafRef = useRef<number | null>(null)
  const pendingLastFrameMsRef = useRef(0)
  const isPlayingRef = useRef(false)
  const positionSecRef = useRef(0)
  const pendingPlayRef = useRef(false)
  const readyRef = useRef(false)
  const navResumePositionRef = useRef<number | null>(null)
  const navResumePlayRef = useRef(false)

  // params
  const tempoRef = useRef(1)
  const pitchSemiRef = useRef(0)

  // UI
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [mainPlayPending, setMainPlayPending] = useState(false)
  const [loopOn, setLoopOn] = useState(false)
  const [progressiveLoadEnabled, setProgressiveLoadEnabled] = useState(false)
  const [recordingEngineV2Enabled, setRecordingEngineV2Enabled] = useState(false)
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("compatibility")

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const [muted, setMuted] = useState<boolean[]>(trackList.map(() => false))
  const [solo, setSolo] = useState<boolean[]>(trackList.map(() => false))
  const [panUI, setPanUI] = useState<number[]>(trackList.map(() => 0))
  const [volUI, setVolUI] = useState<number[]>(initialTrackVolumes)

  const [masterVol, setMasterVol] = useState(1)
  const [reverbAmount, setReverbAmount] = useState(DEFAULT_REVERB_AMOUNT)

  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [pitchSemi, setPitchSemi] = useState(DEFAULT_PITCH_SEMITONES)

  // waveform
  const waveCanvasesRef = useRef<(HTMLCanvasElement | null)[]>([])
  const peaksRef = useRef<(WavePeaks | null)[]>(trackList.map(() => null))
  const [waveReady, setWaveReady] = useState(false)
  const lastExternalSeekRef = useRef<number | null>(null)
  const [teleprompterLines, setTeleprompterLines] = useState<TeleprompterLine[]>([])
  const [teleprompterLoadState, setTeleprompterLoadState] = useState<"idle" | "loading" | "ready" | "missing" | "empty" | "error">("idle")
  const [teleprompterAnchorEditMode, setTeleprompterAnchorEditMode] = useState(false)
  const [teleprompterAnchors, setTeleprompterAnchors] = useState<TeleprompterAnchorMap>({})
  const [teleprompterTextEditMode, setTeleprompterTextEditMode] = useState(false)
  const [teleprompterTextOverrides, setTeleprompterTextOverrides] = useState<TeleprompterTextOverrideMap>({})
  const [teleprompterAutoCollect, setTeleprompterAutoCollect] = useState(false)
  const [teleprompterSettingsOpen, setTeleprompterSettingsOpen] = useState(false)
  const [teleprompterCollectState, setTeleprompterCollectState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [teleprompterCollectInfo, setTeleprompterCollectInfo] = useState("")
  const [teleprompterPreviewSaveState, setTeleprompterPreviewSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [teleprompterPreviewSaveInfo, setTeleprompterPreviewSaveInfo] = useState("")
  const [teleprompterPreviewAutoSave, setTeleprompterPreviewAutoSave] = useState(true)
  const [teleprompterBulkTextEditOpen, setTeleprompterBulkTextEditOpen] = useState(false)
  const [teleprompterBulkTextValue, setTeleprompterBulkTextValue] = useState("")
  const [teleprompterBulkTextInfo, setTeleprompterBulkTextInfo] = useState("")
  const [teleprompterBackupInfo, setTeleprompterBackupInfo] = useState("")
  const [teleprompterDraftDirty, setTeleprompterDraftDirty] = useState(false)
  const [teleprompterDraftSavedAt, setTeleprompterDraftSavedAt] = useState("")
  const [showPiano, setShowPiano] = useState(false)
  const [pianoVolume, setPianoVolume] = useState(0.95)
  const [pianoBaseOctave, setPianoBaseOctave] = useState(3)
  const [recording, setRecording] = useState(false)
  const [countInBeat, setCountInBeat] = useState<number | null>(null)
  const [guestTrackUrl, setGuestTrackUrl] = useState<string | null>(null)
  const [guestTakes, setGuestTakes] = useState<GuestTakeMeta[]>([])
  const [activeGuestTakeId, setActiveGuestTakeId] = useState<string | null>(null)
  const [recordHeadphonesConfirmed, setRecordHeadphonesConfirmed] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return window.localStorage.getItem(RECORD_HEADPHONES_STORAGE_KEY) === "1"
    } catch {
      return false
    }
  })
  const [referenceLockEnabled, setReferenceLockEnabled] = useState(true)
  const [recordReferenceIndex, setRecordReferenceIndex] = useState<number | null>(null)
  const [recordChecklistOpen, setRecordChecklistOpen] = useState(false)
  const [guestSyncRuns, setGuestSyncRuns] = useState(0)
  const [guestLowConfidenceRuns, setGuestLowConfidenceRuns] = useState(0)
  const [playerLongTaskCount, setPlayerLongTaskCount] = useState(0)
  const [playerLongTaskMaxMs, setPlayerLongTaskMaxMs] = useState(0)
  const [recordDropoutCount, setRecordDropoutCount] = useState(0)
  const [recordRecoveryCount, setRecordRecoveryCount] = useState(0)
  const [recordingCapabilitySnapshot, setRecordingCapabilitySnapshot] = useState<RecorderCapabilitySnapshot | null>(null)
  const [recordingV2OpfsActive, setRecordingV2OpfsActive] = useState(false)
  const [recordingV2OpfsBytes, setRecordingV2OpfsBytes] = useState(0)
  const [recordingV2OpfsChunks, setRecordingV2OpfsChunks] = useState(0)
  const [recordingV2OpfsErrors, setRecordingV2OpfsErrors] = useState(0)
  const [recordingV2UploadState, setRecordingV2UploadState] = useState<"idle" | "uploading" | "uploaded" | "queued" | "failed">("idle")
  const [guestDriftSampleCount, setGuestDriftSampleCount] = useState(0)
  const [guestDriftAvgMs, setGuestDriftAvgMs] = useState(0)
  const [guestDriftMaxMs, setGuestDriftMaxMs] = useState(0)
  const [guestDriftSoftCorrections, setGuestDriftSoftCorrections] = useState(0)
  const [guestDriftHardCorrections, setGuestDriftHardCorrections] = useState(0)
  const [deviceLatencyProfile, setDeviceLatencyProfile] = useState<DeviceLatencyProfile | null>(null)
  const [bluetoothRouteRisk, setBluetoothRouteRisk] = useState(false)
  const guestTrackUrlRef = useRef<string | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingV2TapNodeRef = useRef<AudioWorkletNode | null>(null)
  const recordingV2TapSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const recordingV2TapSinkRef = useRef<GainNode | null>(null)
  const recordingV2TapModuleLoadedRef = useRef(false)
  const recordingV2TapStatsRef = useRef<RecorderV2TapStats>({
    framesCaptured: 0,
    chunkReports: 0,
    errors: 0,
  })
  const recordChunksRef = useRef<BlobPart[]>([])
  const recordStreamRef = useRef<MediaStream | null>(null)
  const countInTimerRef = useRef<number | null>(null)
  const recordArmingRef = useRef(false)
  const tempoPitchRealignTimerRef = useRef<number | null>(null)
  const tempoPitchSmoothRafRef = useRef<number | null>(null)
  const tempoAppliedRef = useRef(DEFAULT_SPEED)
  const pitchAppliedRef = useRef(DEFAULT_PITCH_SEMITONES)
  const tempoPitchSmoothFromRef = useRef({ tempo: DEFAULT_SPEED, pitch: DEFAULT_PITCH_SEMITONES })
  const tempoPitchSmoothStartedAtRef = useRef(0)
  const guestAudioRef = useRef<HTMLAudioElement | null>(null)
  const guestCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const guestPeaksRef = useRef<WavePeaks | null>(null)
  const guestScrubRef = useRef(false)
  const guestSyncGuardRef = useRef(false)
  const guestTransportLinkedRef = useRef(false)
  const guestNeedsRecalibrateRef = useRef(false)
  const guestLastDriftFixAtRef = useRef(0)
  const guestRateNudgeRef = useRef(1)
  const guestDriftSampleAbsTotalMsRef = useRef(0)
  const guestDriftSampleCountRef = useRef(0)
  const guestDriftMaxMsRef = useRef(0)
  const playerLongTaskCountRef = useRef(0)
  const playerLongTaskMaxMsRef = useRef(0)
  const playerLongTaskUiFlushAtRef = useRef(0)
  const recordDropoutCountRef = useRef(0)
  const recordRecoveryCountRef = useRef(0)
  const recordingCapabilitySnapshotRef = useRef<RecorderCapabilitySnapshot | null>(null)
  const recordingV2OpfsWriterRef = useRef<RecordingV2OpfsWriter | null>(null)
  const recordingV2TakeSessionIdRef = useRef<string | null>(null)
  const recordingV2ChunkSeqRef = useRef(0)
  const recordingV2WriteChainRef = useRef<Promise<void>>(Promise.resolve())
  const recordingV2OpfsStatsRef = useRef({
    bytes: 0,
    chunks: 0,
    errors: 0,
  })
  const guestDriftSoftFixRef = useRef(0)
  const guestDriftHardFixRef = useRef(0)
  const guestDriftLastSampleAtRef = useRef(0)
  const guestDriftUiUpdateAtRef = useRef(0)
  const guestDriftTelemetryPendingRef = useRef<GuestDriftTelemetrySnapshot>({
    sampleCount: 0,
    avgAbsDriftMs: 0,
    maxAbsDriftMs: 0,
    softCorrections: 0,
    hardCorrections: 0,
  })
  const guestDriftTelemetryLastFlushAtRef = useRef(0)
  const guestDriftTelemetryTimerRef = useRef<number | null>(null)
  const guestStartGuardTimerRef = useRef<number | null>(null)
  const [guestWaveReady, setGuestWaveReady] = useState(false)
  const [guestCurrentTime, setGuestCurrentTime] = useState(0)
  const [guestDuration, setGuestDuration] = useState(0)
  const [guestIsPlaying, setGuestIsPlaying] = useState(false)
  const [guestSoloMode, setGuestSoloMode] = useState(false)
  const [guestMuted, setGuestMuted] = useState(false)
  const [guestLoop, setGuestLoop] = useState(false)
  const [guestPanelOpen, setGuestPanelOpen] = useState(false)
  const [guestPan, setGuestPan] = useState(0)
  const [guestVolume, setGuestVolume] = useState(1)
  const [guestDownloadMenuOpen, setGuestDownloadMenuOpen] = useState(false)
  const [guestDuetMixOpen, setGuestDuetMixOpen] = useState(false)
  const [duetGuestLevel, setDuetGuestLevel] = useState(100)
  const [duetSoloLevel, setDuetSoloLevel] = useState(100)
  const [duetFormat, setDuetFormat] = useState<ExportFormat>("wav")
  const [guestExportingDuet, setGuestExportingDuet] = useState(false)
  const [guestSyncOffsetSec, setGuestSyncOffsetSec] = useState(0)
  const guestSyncOffsetRef = useRef(0)
  const guestSyncLoadedRef = useRef(false)
  const guestStartupBiasStartedAtRef = useRef(0)
  const guestStartupBiasSecRef = useRef(0)
  const guestCalibrateTimerRef = useRef<number | null>(null)
  const [guestCalibrating, setGuestCalibrating] = useState(false)
  const guestCalibratingRef = useRef(false)
  const [guestCalibrateReady, setGuestCalibrateReady] = useState(false)
  const [guestCalibrateScore, setGuestCalibrateScore] = useState<number | null>(null)
  const guestCalibrateScoreRef = useRef<number | null>(null)
  const [guestSyncQuality, setGuestSyncQuality] = useState<GuestSyncQuality>("unknown")
  const guestSyncQualityRef = useRef<GuestSyncQuality>("unknown")
  const calibrationMutedRef = useRef(false)
  const guestActionBusyRef = useRef(false)
  const [guestActionBusy, setGuestActionBusy] = useState(false)
  const recordReferenceIndexRef = useRef<number | null>(null)
  const lastManualOffsetRef = useRef<number | null>(null)
  const effectiveTeleprompterSourceUrl = useMemo(
    () => teleprompterSourceUrl ?? null,
    [teleprompterSourceUrl]
  )
  const teleprompterLinesStorageKey = useMemo(
    () => `rr_teleprompter_lines:${trackScopeId}:${effectiveTeleprompterSourceUrl ?? "local_only"}`,
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterStateStorageKey = useMemo(
    () => `rr_teleprompter_state:${trackScopeId}:${effectiveTeleprompterSourceUrl ?? "local_only"}`,
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterAnchorStorageKey = useMemo(
    () => (effectiveTeleprompterSourceUrl ? `rr_teleprompter_anchors:${trackScopeId}:${effectiveTeleprompterSourceUrl}` : null),
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterTextStorageKey = useMemo(
    () => (effectiveTeleprompterSourceUrl ? `rr_teleprompter_text_overrides:${trackScopeId}:${effectiveTeleprompterSourceUrl}` : null),
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterAutoCollectStorageKey = useMemo(
    () => (effectiveTeleprompterSourceUrl ? `rr_teleprompter_auto_collect:${trackScopeId}:${effectiveTeleprompterSourceUrl}` : null),
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterPreviewAutoSaveStorageKey = useMemo(
    () => (effectiveTeleprompterSourceUrl ? `rr_teleprompter_preview_auto_save:${trackScopeId}:${effectiveTeleprompterSourceUrl}` : null),
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterAutoCollectPrimedRef = useRef(false)
  const teleprompterPreviewAutoSavePrimedRef = useRef(false)
  const teleprompterPreviewKnownSignatureRef = useRef("")
  const teleprompterDraftDirtyRef = useRef(false)
  const teleprompterSkipDirtyMarkRef = useRef(false)
  const calibrationGuestVolumeRef = useRef(1)
  const calibrationGuestGainRef = useRef(1)
  const guestTogetherFirstStartRef = useRef(true)
  const guestPanNodeRef = useRef<StereoPannerNode | null>(null)
  const guestGainNodeRef = useRef<GainNode | null>(null)
  const guestSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const [recSoloHint, setRecSoloHint] = useState(false)
  const [uiLang, setUiLang] = useState<UiLang>("ru")
  const [isHydrated, setIsHydrated] = useState(false)
  const teleprompterLinesRef = useRef<TeleprompterLine[]>([])
  const teleprompterAnchorsRef = useRef<TeleprompterAnchorMap>({})
  const teleprompterTextOverridesRef = useRef<TeleprompterTextOverrideMap>({})
  const teleprompterBackupInputRef = useRef<HTMLInputElement | null>(null)

  const setMainPlayingState = useCallback(
    (playing: boolean) => {
      isPlayingRef.current = playing
      setIsPlaying(playing)
      setMainPlayPending(false)
      onPlaybackStateChange?.(playing)
    },
    [onPlaybackStateChange]
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      if (window.sessionStorage.getItem(FORCE_AUTOPLAY_STORAGE_KEY) === "1") {
        pendingPlayRef.current = true
        window.sessionStorage.removeItem(FORCE_AUTOPLAY_STORAGE_KEY)
      }
      const raw = window.sessionStorage.getItem(NAV_HANDOFF_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as NavHandoffState
      if (!parsed || typeof parsed !== "object") return
      if (parsed.trackScopeId !== trackScopeId) return
      if (!parsed.playing) return
      if (!Number.isFinite(parsed.positionSec)) return
      if (Date.now() - parsed.ts > NAV_HANDOFF_TTL_MS) return

      navResumePositionRef.current = Math.max(0, parsed.positionSec)
      navResumePlayRef.current = true
      setLoopOn(!!parsed.loopOn)
      window.sessionStorage.removeItem(NAV_HANDOFF_STORAGE_KEY)
    } catch {}
  }, [trackScopeId])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(RECORD_HEADPHONES_STORAGE_KEY, recordHeadphonesConfirmed ? "1" : "0")
    } catch {}
  }, [recordHeadphonesConfirmed])

  const t = useMemo(() => {
    const msg = (key: I18nKey) => {
      const legacyLocalized = MULTITRACK_LEGACY_MESSAGES[uiLang][key]
      const legacyRu = MULTITRACK_LEGACY_MESSAGES.ru[key]
      const localized = I18N_MESSAGES[uiLang][key]
      const enLocalized = I18N_MESSAGES.en[key]
      if (key.startsWith("multitrack.") && uiLang === "ru") {
        if (localized === key || localized === enLocalized) {
          return legacyRu ?? localized
        }
      }
      if (localized !== key) return localized
      const ruFallback = I18N_MESSAGES.ru[key]
      if (ruFallback !== key) return ruFallback
      return legacyLocalized ?? legacyRu ?? key
    }
    return {
      volume: msg("multitrack.volume"),
      reverb: msg("multitrack.reverb"),
      speed: msg("multitrack.speed"),
      pitch: msg("multitrack.pitch"),
      pan: msg("multitrack.pan"),
      solo: msg("multitrack.solo"),
      mute: msg("multitrack.mute"),
      save: msg("multitrack.save"),
      export: msg("multitrack.export"),
      soloFmtM4a: msg("multitrack.soloFmtM4a"),
      soloFmtMp3: msg("multitrack.soloFmtMp3"),
      soloFmtWav: msg("multitrack.soloFmtWav"),
      duet: msg("multitrack.duet"),
      duetGuest: msg("multitrack.duetGuest"),
      duetSoloTrack: msg("multitrack.duetSoloTrack"),
      duetFormat: msg("multitrack.duetFormat"),
      saveDuet: msg("multitrack.saveDuet"),
      delay: msg("multitrack.delay"),
      syncCheck: msg("multitrack.syncCheck"),
      syncGood: msg("multitrack.syncGood"),
      syncOk: msg("multitrack.syncOk"),
      syncLow: msg("multitrack.syncLow"),
      syncUnknown: msg("multitrack.syncUnknown"),
      recordChecklist: msg("multitrack.recordChecklist"),
      referenceLock: msg("multitrack.referenceLock"),
      headphonesCheck: msg("multitrack.headphonesCheck"),
      selectReference: msg("multitrack.selectReference"),
      referenceAutoSolo: msg("multitrack.referenceAutoSolo"),
      referenceLockActive: msg("multitrack.referenceLockActive"),
      takes: msg("multitrack.takes"),
      activateTake: msg("multitrack.activateTake"),
      syncRuns: msg("multitrack.syncRuns"),
      lowConfidenceRuns: msg("multitrack.lowConfidenceRuns"),
      longTaskCount: "long_task_count",
      longTaskMax: "max_long_task_ms",
      progressiveLoadFlag: "multitrack_progressive_load",
      recordingV2Flag: "recording_engine_v2",
      recordingEngine: "recording_engine",
      recorderDropouts: "input_dropouts",
      recorderRecoveries: "input_recoveries",
      recorderBaseLatency: "base_latency_ms",
      recorderOutputLatency: "output_latency_ms",
      recorderInputLatency: "input_latency_ms",
      recorderInputSettings: "input_settings",
      recorderCapabilities: "capabilities",
      recorderTapActive: "worklet_tap_active",
      recorderTapFrames: "worklet_frames",
      recorderTapChunks: "worklet_chunks",
      recorderTapErrors: "worklet_tap_errors",
      recorderOpfsActive: "opfs_writer_active",
      recorderOpfsBytes: "opfs_bytes",
      recorderOpfsChunks: "opfs_chunks",
      recorderOpfsErrors: "opfs_errors",
      recorderUploadState: "upload_state",
      recordingModeLabel: msg("multitrack.recordingModeLabel"),
      recordingModeCompatibility: msg("multitrack.recordingModeCompatibility"),
      recordingModeLocalMaster: msg("multitrack.recordingModeLocalMaster"),
      recordingModeFallbackHint: msg("multitrack.recordingModeFallbackHint"),
      driftSamples: msg("multitrack.driftSamples"),
      driftAvg: msg("multitrack.driftAvg"),
      driftMax: msg("multitrack.driftMax"),
      softDriftFixes: msg("multitrack.softDriftFixes"),
      hardDriftFixes: msg("multitrack.hardDriftFixes"),
      deviceProfile: msg("multitrack.deviceProfile"),
      bluetoothRisk: msg("multitrack.bluetoothRisk"),
      left: msg("multitrack.left"),
      right: msg("multitrack.right"),
      volShort: msg("multitrack.volShort"),
      loadingAudio: msg("multitrack.loadingAudio"),
      goToStartAria: msg("multitrack.goToStartAria"),
      goToStartTitle: msg("multitrack.goToStartTitle"),
      playAria: msg("multitrack.playAria"),
      pauseAria: msg("multitrack.pauseAria"),
      playButton: msg("multitrack.playButton"),
      pauseButton: msg("multitrack.pauseButton"),
      repeatTrackAria: msg("multitrack.repeatTrackAria"),
      repeatTrackTitle: msg("multitrack.repeatTrackTitle"),
      recordGuestStartAria: msg("multitrack.recordGuestStartAria"),
      recordGuestStopAria: msg("multitrack.recordGuestStopAria"),
      recordGuestStartTitle: msg("multitrack.recordGuestStartTitle"),
      recordGuestStopTitle: msg("multitrack.recordGuestStopTitle"),
      recSoloHint: msg("multitrack.recSoloHint"),
      trackPositionAria: msg("multitrack.trackPositionAria"),
      masterVolumeAria: msg("multitrack.masterVolumeAria"),
      speedAria: msg("multitrack.speedAria"),
      guestPanelTitle: msg("multitrack.guestPanelTitle"),
      calibrating: msg("multitrack.calibrating"),
      delayDetected: msg("multitrack.delayDetected"),
      delayPending: msg("multitrack.delayPending"),
      countInPrefix: msg("multitrack.countInPrefix"),
      guestGoToStartAria: msg("multitrack.guestGoToStartAria"),
      guestGoToStartTitle: msg("multitrack.guestGoToStartTitle"),
      guestWithTrackStart: msg("multitrack.guestWithTrackStart"),
      guestWithTrackStop: msg("multitrack.guestWithTrackStop"),
      guestRepeatFragmentTitle: msg("multitrack.guestRepeatFragmentTitle"),
      guestPanAria: msg("multitrack.guestPanAria"),
      guestVolumeAria: msg("multitrack.guestVolumeAria"),
      guestDelayAria: msg("multitrack.guestDelayAria"),
      guestWaveformTitle: msg("multitrack.guestWaveformTitle"),
      trackWaveformTitle: msg("multitrack.trackWaveformTitle"),
      pianoShow: msg("multitrack.pianoShow"),
      pianoHide: msg("multitrack.pianoHide"),
      pianoVolumeLabel: msg("multitrack.pianoVolumeLabel"),
      pianoVolumeAria: msg("multitrack.pianoVolumeAria"),
      pianoOctaveRangeLabel: msg("multitrack.pianoOctaveRangeLabel"),
      pianoOctaveRangeAria: msg("multitrack.pianoOctaveRangeAria"),
      pianoHint: msg("multitrack.pianoHint"),
      songFallbackTitle: msg("multitrack.songFallbackTitle"),
      songFallbackSubtitle: msg("multitrack.songFallbackSubtitle"),
      safePanFallback: msg("multitrack.safePanFallback"),
      guestStartSyncFailed: msg("multitrack.guestStartSyncFailed"),
      recordStartInProgress: msg("multitrack.recordStartInProgress"),
      recordRequireSingleSolo: msg("multitrack.recordRequireSingleSolo"),
      recordRequireHeadphones: msg("multitrack.recordRequireHeadphones"),
      recordMicDisconnected: msg("multitrack.recordMicDisconnected"),
      recordMicError: msg("multitrack.recordMicError"),
      recordTooShort: msg("multitrack.recordTooShort"),
      recordSyncAutoCheckFailed: msg("multitrack.recordSyncAutoCheckFailed"),
      recordSyncUnstable: msg("multitrack.recordSyncUnstable"),
      recordAlreadyRunning: msg("multitrack.recordAlreadyRunning"),
      recordStartFailed: msg("multitrack.recordStartFailed"),
      recordMicPermissionDenied: msg("multitrack.recordMicPermissionDenied"),
      recordTakeLoadFailed: msg("multitrack.recordTakeLoadFailed"),
      guestPlaybackFailed: msg("multitrack.guestPlaybackFailed"),
      guestTrackModeRequireSolo: msg("multitrack.guestTrackModeRequireSolo"),
      referenceLockRequireSoloBeforeStart: msg("multitrack.referenceLockRequireSoloBeforeStart"),
      calibrateRequireSolo: msg("multitrack.calibrateRequireSolo"),
      calibrateRequireTake: msg("multitrack.calibrateRequireTake"),
      audioEngineNotReady: msg("multitrack.audioEngineNotReady"),
      calibrateMeasureFailed: msg("multitrack.calibrateMeasureFailed"),
      exportRequireTake: msg("multitrack.exportRequireTake"),
      exportFallbackWav: msg("multitrack.exportFallbackWav"),
      exportMp3Unavailable: msg("multitrack.exportMp3Unavailable"),
      exportM4aUnavailable: msg("multitrack.exportM4aUnavailable"),
      exportSoloFailed: msg("multitrack.exportSoloFailed"),
      exportDuetRequireSolo: msg("multitrack.exportDuetRequireSolo"),
      exportDuetUnsupported: msg("multitrack.exportDuetUnsupported"),
      exportDuetCalibrateFailed: msg("multitrack.exportDuetCalibrateFailed"),
      exportDuetTrackLoadFailed: msg("multitrack.exportDuetTrackLoadFailed"),
      exportDuetFallbackWav: msg("multitrack.exportDuetFallbackWav"),
      exportDuetFailed: msg("multitrack.exportDuetFailed"),
      tempoLocked: msg("multitrack.tempoLocked"),
      pitchLocked: msg("multitrack.pitchLocked"),
      referenceLockTrackChangeBlocked: msg("multitrack.referenceLockTrackChangeBlocked"),
      referenceLockSoloRequired: msg("multitrack.referenceLockSoloRequired"),
      guestFilePlaybackFailed: msg("multitrack.guestFilePlaybackFailed"),
      teleprompterTitle: msg("multitrack.teleprompterTitle"),
      teleprompterEmptyHint: msg("multitrack.teleprompterEmptyHint"),
      teleprompterLoadLoading: msg("multitrack.teleprompterLoadLoading"),
      teleprompterLoadMissing: msg("multitrack.teleprompterLoadMissing"),
      teleprompterLoadEmpty: msg("multitrack.teleprompterLoadEmpty"),
      teleprompterLoadError: msg("multitrack.teleprompterLoadError"),
      teleprompterLoadIdle: msg("multitrack.teleprompterLoadIdle"),
      teleprompterLineAriaPrefix: msg("multitrack.teleprompterLineAriaPrefix"),
      teleprompterSettingsShow: msg("multitrack.teleprompterSettingsShow"),
      teleprompterSettingsHide: msg("multitrack.teleprompterSettingsHide"),
      teleprompterMarkupShow: msg("multitrack.teleprompterMarkupShow"),
      teleprompterMarkupHide: msg("multitrack.teleprompterMarkupHide"),
      teleprompterEditorShow: msg("multitrack.teleprompterEditorShow"),
      teleprompterEditorHide: msg("multitrack.teleprompterEditorHide"),
      teleprompterPasteBulk: msg("multitrack.teleprompterPasteBulk"),
      teleprompterAnchorCurrent: msg("multitrack.teleprompterAnchorCurrent"),
      teleprompterCopyJson: msg("multitrack.teleprompterCopyJson"),
      teleprompterDownloadJson: msg("multitrack.teleprompterDownloadJson"),
      teleprompterBackupDownload: msg("multitrack.teleprompterBackupDownload"),
      teleprompterBackupRestore: msg("multitrack.teleprompterBackupRestore"),
      teleprompterCopyDatasetJsonl: msg("multitrack.teleprompterCopyDatasetJsonl"),
      teleprompterDownloadDatasetJsonl: msg("multitrack.teleprompterDownloadDatasetJsonl"),
      teleprompterSaveDataset: msg("multitrack.teleprompterSaveDataset"),
      teleprompterRewritePreview: msg("multitrack.teleprompterRewritePreview"),
      teleprompterAutoPreviewOn: msg("multitrack.teleprompterAutoPreviewOn"),
      teleprompterAutoPreviewOff: msg("multitrack.teleprompterAutoPreviewOff"),
      teleprompterAutoCollectOn: msg("multitrack.teleprompterAutoCollectOn"),
      teleprompterAutoCollectOff: msg("multitrack.teleprompterAutoCollectOff"),
      teleprompterResetAnchors: msg("multitrack.teleprompterResetAnchors"),
      teleprompterResetText: msg("multitrack.teleprompterResetText"),
      teleprompterDatasetStatus: msg("multitrack.teleprompterDatasetStatus"),
      teleprompterDraftStatus: msg("multitrack.teleprompterDraftStatus"),
      teleprompterDraftDirty: msg("multitrack.teleprompterDraftDirty"),
      teleprompterDraftSaved: msg("multitrack.teleprompterDraftSaved"),
      teleprompterPreviewStatus: msg("multitrack.teleprompterPreviewStatus"),
      teleprompterBackupStatus: msg("multitrack.teleprompterBackupStatus"),
      teleprompterBulkHint: msg("multitrack.teleprompterBulkHint"),
      teleprompterApply: msg("multitrack.teleprompterApply"),
      teleprompterCancel: msg("multitrack.teleprompterCancel"),
      teleprompterBackupImporting: msg("multitrack.teleprompterBackupImporting"),
      teleprompterBackupImportedPrefix: msg("multitrack.teleprompterBackupImportedPrefix"),
      teleprompterLinesWord: msg("multitrack.teleprompterLinesWord"),
      teleprompterImportErrorPrefix: msg("multitrack.teleprompterImportErrorPrefix"),
      teleprompterCollectSaving: msg("multitrack.teleprompterCollectSaving"),
      teleprompterCollectSavedPrefix: msg("multitrack.teleprompterCollectSavedPrefix"),
      teleprompterErrorPrefix: msg("multitrack.teleprompterErrorPrefix"),
      teleprompterBulkCreatedPrefix: msg("multitrack.teleprompterBulkCreatedPrefix"),
      teleprompterBulkAppliedPrefix: msg("multitrack.teleprompterBulkAppliedPrefix"),
      teleprompterPreviewPathMissing: msg("multitrack.teleprompterPreviewPathMissing"),
      teleprompterPreviewAutosaving: msg("multitrack.teleprompterPreviewAutosaving"),
      teleprompterPreviewSaving: msg("multitrack.teleprompterPreviewSaving"),
      teleprompterPreviewAutosavedPrefix: msg("multitrack.teleprompterPreviewAutosavedPrefix"),
      teleprompterPreviewSavedPrefix: msg("multitrack.teleprompterPreviewSavedPrefix"),
    }
  }, [uiLang])

  const localMasterCapable = recordingEngineV2Enabled && isOpfsAvailable() && typeof AudioWorkletNode !== "undefined"

  const pianoKeys = useMemo<PianoKey[]>(() => {
    const baseMidi = 12 * (pianoBaseOctave + 1)
    const white: PianoKey[] = PIANO_WHITE_OFFSETS.map((semi, i) => {
      const midi = baseMidi + semi
      return {
        note: midiToNote(midi),
        freq: midiToFreq(midi),
        kbd: PIANO_WHITE_KEYS_EN[i],
        kbdRu: PIANO_WHITE_KEYS_RU[i],
      }
    })
    const black: PianoKey[] = PIANO_BLACK_OFFSETS.map((entry, i) => {
      const midi = baseMidi + entry.semi
      return {
        note: midiToNote(midi),
        freq: midiToFreq(midi),
        isBlack: true,
        kbd: PIANO_BLACK_KEYS_EN[i],
        kbdRu: PIANO_BLACK_KEYS_RU[i],
        left: ((entry.afterWhiteIndex + 1) / 14) * 100,
      }
    })
    return [...white, ...black]
  }, [pianoBaseOctave])

  useEffect(() => {
    const syncLang = () => {
      setUiLang(resolveUiLangFromDocument())
    }
    syncLang()
    const observer = new MutationObserver(syncLang)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] })
    window.addEventListener("popstate", syncLang)
    return () => {
      observer.disconnect()
      window.removeEventListener("popstate", syncLang)
    }
  }, [])

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  const beginGuestProgrammaticAction = () => {
    guestSyncGuardRef.current = true
  }
  const endGuestProgrammaticAction = () => {
    guestSyncGuardRef.current = false
  }

  const getStartupBiasSec = () => {
    if (guestCalibratingRef.current) return 0
    const base = guestStartupBiasSecRef.current
    if (!base) return 0
    const elapsed = (Date.now() - guestStartupBiasStartedAtRef.current) / 1000
    if (elapsed <= 0) return base
    if (elapsed >= GUEST_STARTUP_BIAS_DECAY_SEC) return 0
    return base * (1 - elapsed / GUEST_STARTUP_BIAS_DECAY_SEC)
  }

  const flushRecorderCapabilityTelemetry = useCallback(
    (reason: "start" | "stop" | "error" | "unmount", snapshotOverride?: RecorderCapabilitySnapshot | null) => {
      const snapshot = snapshotOverride ?? recordingCapabilitySnapshotRef.current
      if (!snapshot) return
      const payload = {
        trackScopeId,
        reason,
        ...snapshot,
        route: typeof window !== "undefined" ? window.location.pathname : undefined,
        locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }
      const json = JSON.stringify(payload)
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
          const blob = new Blob([json], { type: "application/json" })
          navigator.sendBeacon("/api/analytics/recording-probe", blob)
          return
        } catch {
          // fallback below
        }
      }
      void fetch("/api/analytics/recording-probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
        keepalive: true,
      })
    },
    [trackScopeId]
  )

  const buildCurrentRecorderSnapshot = useCallback(
    (params: { mimeType: string; stream: MediaStream | null }): RecorderCapabilitySnapshot => {
      return buildRecorderCapabilitySnapshot({
        ctx: ctxRef.current,
        stream: params.stream,
        mimeType: params.mimeType,
        recordingV2FlagEnabled: recordingEngineV2Enabled && recordingMode === "local_master",
        dropoutCount: recordDropoutCountRef.current,
        recoveryCount: recordRecoveryCountRef.current,
        workletTapActive: !!recordingV2TapNodeRef.current,
        workletFramesCaptured: recordingV2TapStatsRef.current.framesCaptured,
        workletChunkReports: recordingV2TapStatsRef.current.chunkReports,
        workletTapErrors: recordingV2TapStatsRef.current.errors,
        opfsWriterActive: !!recordingV2OpfsWriterRef.current,
        opfsBytesWritten: recordingV2OpfsStatsRef.current.bytes,
        opfsChunkCount: recordingV2OpfsStatsRef.current.chunks,
        opfsWriteErrors: recordingV2OpfsStatsRef.current.errors,
        uploadState: recordingV2UploadState,
      })
    },
    [recordingEngineV2Enabled, recordingMode, recordingV2UploadState]
  )

  const flushGuestSyncTelemetry = useCallback(
    async (reason: "periodic" | "pause" | "hard_stop" | "unmount", force = false) => {
      const pending = guestDriftTelemetryPendingRef.current
      if (!force && pending.sampleCount <= 0) return
      if (pending.sampleCount <= 0) return

      const payload = {
        trackScopeId,
        reason,
        sampleCount: pending.sampleCount,
        avgAbsDriftMs: Number(pending.avgAbsDriftMs.toFixed(2)),
        maxAbsDriftMs: Number(pending.maxAbsDriftMs.toFixed(2)),
        softCorrections: pending.softCorrections,
        hardCorrections: pending.hardCorrections,
        route: typeof window !== "undefined" ? window.location.pathname : undefined,
        locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }
      const json = JSON.stringify(payload)

      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
          const blob = new Blob([json], { type: "application/json" })
          navigator.sendBeacon("/api/analytics/guest-sync", blob)
        } catch {
          // fallback below
          void fetch("/api/analytics/guest-sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: json,
            keepalive: true,
          })
        }
      } else {
        void fetch("/api/analytics/guest-sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json,
          keepalive: true,
        })
      }

      guestDriftTelemetryPendingRef.current = {
        sampleCount: 0,
        avgAbsDriftMs: 0,
        maxAbsDriftMs: 0,
        softCorrections: 0,
        hardCorrections: 0,
      }
      guestDriftTelemetryLastFlushAtRef.current = Date.now()
    },
    [trackScopeId]
  )

  const commitGuestDriftUiSnapshot = useCallback((force = false) => {
    const now = Date.now()
    if (!force && now - guestDriftUiUpdateAtRef.current < 320) return
    guestDriftUiUpdateAtRef.current = now
    const sampleCount = guestDriftSampleCountRef.current
    const avg = sampleCount > 0 ? guestDriftSampleAbsTotalMsRef.current / sampleCount : 0
    setGuestDriftSampleCount(sampleCount)
    setGuestDriftAvgMs(Number(avg.toFixed(1)))
    setGuestDriftMaxMs(Math.round(guestDriftMaxMsRef.current))
    setGuestDriftSoftCorrections(guestDriftSoftFixRef.current)
    setGuestDriftHardCorrections(guestDriftHardFixRef.current)
  }, [])

  const registerGuestDriftSample = useCallback(
    (driftSec: number, correction: "none" | "soft" | "hard") => {
      const absDriftMs = Math.abs(driftSec * 1000)
      guestDriftSampleCountRef.current += 1
      guestDriftSampleAbsTotalMsRef.current += absDriftMs
      guestDriftMaxMsRef.current = Math.max(guestDriftMaxMsRef.current, absDriftMs)
      if (correction === "soft") guestDriftSoftFixRef.current += 1
      if (correction === "hard") guestDriftHardFixRef.current += 1

      const pending = guestDriftTelemetryPendingRef.current
      const nextCount = pending.sampleCount + 1
      pending.avgAbsDriftMs = (pending.avgAbsDriftMs * pending.sampleCount + absDriftMs) / nextCount
      pending.sampleCount = nextCount
      pending.maxAbsDriftMs = Math.max(pending.maxAbsDriftMs, absDriftMs)
      if (correction === "soft") pending.softCorrections += 1
      if (correction === "hard") pending.hardCorrections += 1
      commitGuestDriftUiSnapshot(correction !== "none")
    },
    [commitGuestDriftUiSnapshot]
  )

  const getGuestTargetSec = useCallback(
    (mainPosSec: number) => {
      const hardwareBias = 0
      const startupBias = getStartupBiasSec()
      const offset = guestSyncOffsetRef.current + hardwareBias + startupBias
      return clamp(mainPosSec + offset, 0, guestDuration || mainPosSec + offset)
    },
    [guestDuration]
  )

  const syncGuestToMain = (mainPosSec: number, force = false) => {
    if (!guestTransportLinkedRef.current) return
    const guestAudio = guestAudioRef.current
    if (!guestAudio) return
    if (!force && guestAudio.paused) return
    const target = getGuestTargetSec(mainPosSec)
    const drift = guestAudio.currentTime - target
    const now = Date.now()
    const absDrift = Math.abs(drift)
    const canHardFix = now - guestLastDriftFixAtRef.current >= GUEST_DRIFT_HARD_FIX_COOLDOWN_MS
    if (force || (absDrift >= GUEST_DRIFT_HARD_FIX_SEC && canHardFix)) {
      guestLastDriftFixAtRef.current = now
      beginGuestProgrammaticAction()
      guestAudio.currentTime = target
      setGuestCurrentTime(target)
      endGuestProgrammaticAction()
      guestAudio.playbackRate = 1
      guestRateNudgeRef.current = 1
      registerGuestDriftSample(drift, "hard")
      return
    }

    if (absDrift >= GUEST_DRIFT_SOFT_FIX_SEC && !guestAudio.paused) {
      const nudgeRate = clamp(1 - drift * GUEST_DRIFT_RATE_GAIN, 1 - GUEST_DRIFT_RATE_NUDGE_LIMIT, 1 + GUEST_DRIFT_RATE_NUDGE_LIMIT)
      guestAudio.playbackRate = nudgeRate
      guestRateNudgeRef.current = nudgeRate
      registerGuestDriftSample(drift, "soft")
      return
    }

    if (absDrift <= 0.008 && Math.abs(guestRateNudgeRef.current - 1) > 0.0005) {
      guestAudio.playbackRate = 1
      guestRateNudgeRef.current = 1
    }
    registerGuestDriftSample(drift, "none")
  }

  const seekGuestAudioForStart = async (mainPosSec: number) => {
    const guestAudio = guestAudioRef.current
    if (!guestAudio) return
    const target = getGuestTargetSec(mainPosSec)

    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        guestAudio.removeEventListener("seeked", onSeeked)
        window.clearTimeout(timer)
        resolve()
      }
      const onSeeked = () => finish()
      const timer = window.setTimeout(finish, 160)
      guestAudio.addEventListener("seeked", onSeeked, { once: true })
      beginGuestProgrammaticAction()
      guestAudio.currentTime = target
      setGuestCurrentTime(target)
      endGuestProgrammaticAction()
    })
  }

  const waitForGuestAudioReady = async (audio: HTMLAudioElement, timeoutMs = 900) => {
    if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        audio.removeEventListener("loadeddata", onReady)
        audio.removeEventListener("canplay", onReady)
        window.clearTimeout(timer)
        resolve()
      }
      const onReady = () => finish()
      const timer = window.setTimeout(finish, timeoutMs)
      audio.addEventListener("loadeddata", onReady)
      audio.addEventListener("canplay", onReady)
    })
  }

  const clearGuestStartGuardTimer = () => {
    if (guestStartGuardTimerRef.current != null) {
      window.clearTimeout(guestStartGuardTimerRef.current)
      guestStartGuardTimerRef.current = null
    }
  }

  const guardGuestStart = () => {
    const guestGain = guestGainNodeRef.current
    if (!guestGain) return
    const ctx = guestGain.context
    const now = ctx.currentTime
    guestGain.gain.cancelScheduledValues(now)
    guestGain.gain.setValueAtTime(0, now)
    guestStartGuardTimerRef.current = window.setTimeout(() => {
      const now2 = ctx.currentTime
      guestGain.gain.cancelScheduledValues(now2)
      guestGain.gain.setValueAtTime(0, now2)
      guestGain.gain.linearRampToValueAtTime(1, now2 + 0.08)
      guestStartGuardTimerRef.current = null
    }, 120)
  }

  const ensureGuestPlaybackGraph = async () => {
    const ctx = ctxRef.current
    const audio = guestAudioRef.current
    if (!ctx || !audio) return false
    await ctx.resume()
    if (guestSourceNodeRef.current && guestPanNodeRef.current && guestGainNodeRef.current) return true

    try {
      const source = ctx.createMediaElementSource(audio)
      const merger = ctx.createChannelMerger(2)
      const pan = ctx.createStereoPanner()
      const gain = ctx.createGain()
      pan.pan.value = guestPan
      gain.gain.value = guestMuted ? 0 : guestVolume

      // Duplicate channel 0 to both L/R before panning to avoid one-ear playback on mono/left-only sources.
      source.connect(merger, 0, 0)
      source.connect(merger, 0, 1)
      merger.connect(pan)
      pan.connect(gain)
      gain.connect(ctx.destination)

      guestSourceNodeRef.current = source
      guestPanNodeRef.current = pan
      guestGainNodeRef.current = gain
      // Safari may suspend muted media elements; keep element unmuted but with zero direct volume.
      audio.muted = false
      audio.volume = 0
      return true
    } catch {
      return false
    }
  }

  const primeGuestAudioAutoplay = async () => {
    const audio = guestAudioRef.current
    if (!audio || !audio.src || !audio.paused) return
    const prevMuted = audio.muted
    const prevVolume = audio.volume
    try {
      audio.muted = true
      audio.volume = 0
      await audio.play()
      audio.pause()
    } catch {
      // ignore: prime best-effort only
    } finally {
      audio.muted = prevMuted
      audio.volume = prevVolume
    }
  }

  /** =========================
   *  CLICK-FREE RAMP HELPERS
   *  ========================= */
  const rampGainTo = (node: GainNode | null | undefined, target: number, rampSec = 0.045) => {
    if (!node) return
    const ctx = node.context
    const now = ctx.currentTime
    const g = node.gain
    const from = g.value
    if (Math.abs(from - target) < 0.0005) return

    try {
      g.cancelScheduledValues(now)
      g.setValueAtTime(from, now)
      g.linearRampToValueAtTime(target, now + rampSec)
    } catch {
      g.value = target
    }
  }

  const applyTempoPitchToEngines = useCallback((tempo: number, pitchSemi: number) => {
    tempoAppliedRef.current = tempo
    pitchAppliedRef.current = pitchSemi
    enginesRef.current.forEach((eng) => {
      eng?.setTempo(tempo)
      eng?.setPitchSemitones(pitchSemi)
    })
  }, [])

  const cancelTempoPitchSmoothing = useCallback(() => {
    if (tempoPitchSmoothRafRef.current == null) return
    window.cancelAnimationFrame(tempoPitchSmoothRafRef.current)
    tempoPitchSmoothRafRef.current = null
  }, [])

  const scheduleTempoPitchSmoothing = useCallback(
    (targetTempo: number, targetPitchSemi: number) => {
      cancelTempoPitchSmoothing()
      const startTempo = tempoAppliedRef.current
      const startPitch = pitchAppliedRef.current
      if (Math.abs(startTempo - targetTempo) < 0.0005 && Math.abs(startPitch - targetPitchSemi) < 0.0005) {
        applyTempoPitchToEngines(targetTempo, targetPitchSemi)
        return
      }
      tempoPitchSmoothFromRef.current = { tempo: startTempo, pitch: startPitch }
      tempoPitchSmoothStartedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now()
      const tick = () => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now()
        const elapsed = now - tempoPitchSmoothStartedAtRef.current
        const progress = clamp(elapsed / TEMPO_PITCH_SMOOTH_MS, 0, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        const tempo = tempoPitchSmoothFromRef.current.tempo + (targetTempo - tempoPitchSmoothFromRef.current.tempo) * eased
        const pitch = tempoPitchSmoothFromRef.current.pitch + (targetPitchSemi - tempoPitchSmoothFromRef.current.pitch) * eased
        applyTempoPitchToEngines(tempo, pitch)
        if (progress >= 1) {
          tempoPitchSmoothRafRef.current = null
          return
        }
        tempoPitchSmoothRafRef.current = window.requestAnimationFrame(tick)
      }
      tempoPitchSmoothRafRef.current = window.requestAnimationFrame(tick)
    },
    [applyTempoPitchToEngines, cancelTempoPitchSmoothing]
  )

  useEffect(() => {
    guestSyncOffsetRef.current = guestSyncOffsetSec
  }, [guestSyncOffsetSec])

  useEffect(() => {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return
    const supportedEntryTypes = (PerformanceObserver as typeof PerformanceObserver & { supportedEntryTypes?: string[] }).supportedEntryTypes
    if (!Array.isArray(supportedEntryTypes) || !supportedEntryTypes.includes("longtask")) return

    let rafId: number | null = null
    const flushLongTaskUi = () => {
      rafId = null
      setPlayerLongTaskCount(playerLongTaskCountRef.current)
      setPlayerLongTaskMaxMs(Math.round(playerLongTaskMaxMsRef.current))
      playerLongTaskUiFlushAtRef.current = performance.now()
    }
    const scheduleUiFlush = () => {
      if (rafId != null) return
      rafId = window.requestAnimationFrame(flushLongTaskUi)
    }

    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries()
      if (!entries.length) return
      for (const entry of entries) {
        const dur = Number(entry.duration)
        if (!Number.isFinite(dur) || dur <= 0) continue
        playerLongTaskCountRef.current += 1
        if (dur > playerLongTaskMaxMsRef.current) playerLongTaskMaxMsRef.current = dur
      }
      const now = performance.now()
      if (now - playerLongTaskUiFlushAtRef.current >= PLAYER_LONGTASK_UI_FLUSH_MIN_MS) {
        scheduleUiFlush()
      }
    })

    observer.observe({ entryTypes: ["longtask"] })
    flushLongTaskUi()
    return () => {
      observer.disconnect()
      if (rafId != null) window.cancelAnimationFrame(rafId)
    }
  }, [])

  useEffect(() => {
    recordingCapabilitySnapshotRef.current = recordingCapabilitySnapshot
  }, [recordingCapabilitySnapshot])

  useEffect(() => {
    guestTrackUrlRef.current = guestTrackUrl
  }, [guestTrackUrl])

  useEffect(() => {
    guestCalibratingRef.current = guestCalibrating
  }, [guestCalibrating])

  useEffect(() => {
    guestCalibrateScoreRef.current = guestCalibrateScore
  }, [guestCalibrateScore])

  useEffect(() => {
    guestSyncQualityRef.current = guestSyncQuality
  }, [guestSyncQuality])

  useEffect(() => {
    recordReferenceIndexRef.current = recordReferenceIndex
  }, [recordReferenceIndex])

  useEffect(() => {
    const currentOffset = guestSyncOffsetSec
    const prev = lastManualOffsetRef.current
    if (prev == null) {
      lastManualOffsetRef.current = currentOffset
      return
    }
    if (!guestCalibratingRef.current && Math.abs(currentOffset - prev) >= 0.004) {
      guestNeedsRecalibrateRef.current = true
    }
    lastManualOffsetRef.current = currentOffset
  }, [guestSyncOffsetSec])

  useEffect(() => {
    setGuestTrackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setGuestTakes([])
    setActiveGuestTakeId(null)
    setGuestWaveReady(false)
    setGuestCurrentTime(0)
    setGuestDuration(0)
    setGuestIsPlaying(false)
    setGuestCalibrateScore(null)
    setGuestSyncQuality("unknown")
    setRecordReferenceIndex(null)
    setRecordHeadphonesConfirmed(false)
    setGuestSyncRuns(0)
    setGuestLowConfidenceRuns(0)
    setGuestDriftSampleCount(0)
    setGuestDriftAvgMs(0)
    setGuestDriftMaxMs(0)
    setGuestDriftSoftCorrections(0)
    setGuestDriftHardCorrections(0)
    setBluetoothRouteRisk(false)
    guestDriftSampleCountRef.current = 0
    guestDriftSampleAbsTotalMsRef.current = 0
    guestDriftMaxMsRef.current = 0
    guestDriftSoftFixRef.current = 0
    guestDriftHardFixRef.current = 0
    guestDriftLastSampleAtRef.current = 0
    guestDriftUiUpdateAtRef.current = 0
    guestDriftTelemetryPendingRef.current = {
      sampleCount: 0,
      avgAbsDriftMs: 0,
      maxAbsDriftMs: 0,
      softCorrections: 0,
      hardCorrections: 0,
    }

    try {
      const stored = localStorage.getItem(guestSyncStorageKey)
      const globalStored = localStorage.getItem(GLOBAL_GUEST_SYNC_STORAGE_KEY)
      if (stored) {
        const parsed = Number(stored)
        if (Number.isFinite(parsed)) setGuestSyncOffsetSec(clamp(parsed, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC))
        else setGuestSyncOffsetSec(DEFAULT_GUEST_SYNC_SEC)
      } else if (globalStored) {
        const parsedGlobal = Number(globalStored)
        if (Number.isFinite(parsedGlobal)) setGuestSyncOffsetSec(clamp(parsedGlobal, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC))
        else setGuestSyncOffsetSec(DEFAULT_GUEST_SYNC_SEC)
      } else {
        setGuestSyncOffsetSec(DEFAULT_GUEST_SYNC_SEC)
      }
    } catch {
      setGuestSyncOffsetSec(DEFAULT_GUEST_SYNC_SEC)
    }

    try {
      const rawMetrics = localStorage.getItem(guestSyncMetricsStorageKey)
      if (rawMetrics) {
        const parsed = JSON.parse(rawMetrics) as { syncRuns?: unknown; lowConfidenceRuns?: unknown }
        const syncRunsValue = Number(parsed?.syncRuns)
        const lowRunsValue = Number(parsed?.lowConfidenceRuns)
        setGuestSyncRuns(Number.isFinite(syncRunsValue) ? Math.max(0, Math.floor(syncRunsValue)) : 0)
        setGuestLowConfidenceRuns(Number.isFinite(lowRunsValue) ? Math.max(0, Math.floor(lowRunsValue)) : 0)
      }
    } catch {}
    try {
      const rawDriftMetrics = localStorage.getItem(guestDriftMetricsStorageKey)
      if (rawDriftMetrics) {
        const parsed = JSON.parse(rawDriftMetrics) as Partial<GuestDriftTelemetrySnapshot>
        const sampleCount = Math.max(0, Math.floor(Number(parsed.sampleCount) || 0))
        const avgAbsDriftMs = Math.max(0, Number(parsed.avgAbsDriftMs) || 0)
        const maxAbsDriftMs = Math.max(0, Number(parsed.maxAbsDriftMs) || 0)
        const softCorrections = Math.max(0, Math.floor(Number(parsed.softCorrections) || 0))
        const hardCorrections = Math.max(0, Math.floor(Number(parsed.hardCorrections) || 0))
        guestDriftSampleCountRef.current = sampleCount
        guestDriftSampleAbsTotalMsRef.current = avgAbsDriftMs * sampleCount
        guestDriftMaxMsRef.current = maxAbsDriftMs
        guestDriftSoftFixRef.current = softCorrections
        guestDriftHardFixRef.current = hardCorrections
        setGuestDriftSampleCount(sampleCount)
        setGuestDriftAvgMs(Number(avgAbsDriftMs.toFixed(1)))
        setGuestDriftMaxMs(Math.round(maxAbsDriftMs))
        setGuestDriftSoftCorrections(softCorrections)
        setGuestDriftHardCorrections(hardCorrections)
      }
    } catch {}

    guestSyncLoadedRef.current = true

    loadGuestRecording().catch(() => {})
    // loadGuestRecording depends only on guestRecordStorageKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestDriftMetricsStorageKey, guestSyncStorageKey, guestRecordStorageKey, guestSyncMetricsStorageKey])

  useEffect(() => {
    if (!guestSyncLoadedRef.current) return
    try {
      localStorage.setItem(guestSyncStorageKey, String(guestSyncOffsetSec))
      localStorage.setItem(GLOBAL_GUEST_SYNC_STORAGE_KEY, String(guestSyncOffsetSec))
    } catch {}
  }, [guestSyncOffsetSec, guestSyncStorageKey])

  useEffect(() => {
    if (!guestTrackUrl && guestTakes.length === 0) return
    setGuestPanelOpen(true)
  }, [guestTakes.length, guestTrackUrl])

  useEffect(() => {
    try {
      const payload: GuestTakesState = {
        activeTakeId: activeGuestTakeId,
        takes: guestTakes.slice(0, GUEST_TAKES_MAX),
      }
      localStorage.setItem(guestTakesStorageKey, JSON.stringify(payload))
    } catch {}
  }, [activeGuestTakeId, guestTakes, guestTakesStorageKey])

  useEffect(() => {
    try {
      localStorage.setItem(
        guestSyncMetricsStorageKey,
        JSON.stringify({
          syncRuns: guestSyncRuns,
          lowConfidenceRuns: guestLowConfidenceRuns,
        })
      )
    } catch {}
  }, [guestLowConfidenceRuns, guestSyncMetricsStorageKey, guestSyncRuns])

  useEffect(() => {
    try {
      localStorage.setItem(
        guestDriftMetricsStorageKey,
        JSON.stringify({
          sampleCount: guestDriftSampleCount,
          avgAbsDriftMs: Number(guestDriftAvgMs.toFixed(1)),
          maxAbsDriftMs: guestDriftMaxMs,
          softCorrections: guestDriftSoftCorrections,
          hardCorrections: guestDriftHardCorrections,
        } satisfies GuestDriftTelemetrySnapshot)
      )
    } catch {}
  }, [
    guestDriftAvgMs,
    guestDriftHardCorrections,
    guestDriftMaxMs,
    guestDriftMetricsStorageKey,
    guestDriftSampleCount,
    guestDriftSoftCorrections,
  ])

  useEffect(() => {
    if (guestDriftTelemetryTimerRef.current != null) {
      window.clearInterval(guestDriftTelemetryTimerRef.current)
      guestDriftTelemetryTimerRef.current = null
    }
    guestDriftTelemetryTimerRef.current = window.setInterval(() => {
      if (guestDriftTelemetryPendingRef.current.sampleCount <= 0) return
      void flushGuestSyncTelemetry("periodic")
    }, GUEST_DRIFT_TELEMETRY_FLUSH_MS)
    return () => {
      if (guestDriftTelemetryTimerRef.current != null) {
        window.clearInterval(guestDriftTelemetryTimerRef.current)
        guestDriftTelemetryTimerRef.current = null
      }
      void flushGuestSyncTelemetry("unmount", true)
    }
  }, [flushGuestSyncTelemetry])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(GUEST_DEVICE_PROFILE_STORAGE_KEY)
      if (!raw) {
        setDeviceLatencyProfile(null)
        return
      }
      const parsed = JSON.parse(raw) as Partial<DeviceLatencyProfile> | null
      const offset = Number(parsed?.offsetSec)
      if (
        !parsed ||
        typeof parsed.id !== "string" ||
        typeof parsed.label !== "string" ||
        !Number.isFinite(offset) ||
        typeof parsed.updatedAt !== "string"
      ) {
        setDeviceLatencyProfile(null)
        return
      }
      setDeviceLatencyProfile({
        id: parsed.id,
        label: parsed.label,
        offsetSec: Math.max(-1, Math.min(1, offset)),
        updatedAt: parsed.updatedAt,
      })
    } catch {
      setDeviceLatencyProfile(null)
    }
  }, [])

  useEffect(() => {
    try {
      if (!deviceLatencyProfile) {
        localStorage.removeItem(GUEST_DEVICE_PROFILE_STORAGE_KEY)
        return
      }
      localStorage.setItem(GUEST_DEVICE_PROFILE_STORAGE_KEY, JSON.stringify(deviceLatencyProfile))
    } catch {}
  }, [deviceLatencyProfile])

  useEffect(() => {
    setProgressiveLoadEnabled(
      hasClientPreviewFlag(PROGRESSIVE_LOAD_PREVIEW_FLAG) || shouldPreferProgressiveLoad(trackList)
    )
  }, [trackList])

  useEffect(() => {
    setRecordingEngineV2Enabled(hasClientPreviewFlag(RECORDING_ENGINE_V2_PREVIEW_FLAG))
  }, [])

  useEffect(() => {
    if (!recordingEngineV2Enabled) return
    void (async () => {
      try {
        const drained = await drainRecordingV2UploadQueue(2)
        if (drained.completed > 0) setRecordingV2UploadState("uploaded")
      } catch {
        // ignore background queue drain errors
      }
    })()
  }, [recordingEngineV2Enabled])

  useEffect(() => {
    if (!recordingEngineV2Enabled || !localMasterCapable) {
      setRecordingMode("compatibility")
    }
  }, [localMasterCapable, recordingEngineV2Enabled])

  useEffect(() => {
    const node = guestPanNodeRef.current
    if (!node) return
    try {
      const now = node.context.currentTime
      node.pan.cancelScheduledValues(now)
      node.pan.setValueAtTime(node.pan.value, now)
      node.pan.linearRampToValueAtTime(guestPan, now + 0.03)
    } catch {
      // Fallback to direct element output if pan node becomes unstable.
      const audio = guestAudioRef.current
      if (audio) {
        audio.volume = 1
        audio.muted = false
      }
      setRecordError(t.safePanFallback)
    }
  }, [guestPan, t.safePanFallback])

  useEffect(() => {
    const gain = guestGainNodeRef.current
    const audio = guestAudioRef.current
    if (gain) {
      const now = gain.context.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(guestMuted ? 0 : guestVolume, now + 0.03)
      return
    }
    if (audio) {
      audio.muted = guestMuted
      audio.volume = guestMuted ? 0 : Math.min(1, guestVolume)
    }
  }, [guestMuted, guestVolume])

  const teardownRecordingV2Tap = useCallback(() => {
    const node = recordingV2TapNodeRef.current
    const source = recordingV2TapSourceRef.current
    const sink = recordingV2TapSinkRef.current
    try {
      if (node) {
        node.port.onmessage = null
        node.disconnect()
      }
    } catch {}
    try {
      source?.disconnect()
    } catch {}
    try {
      sink?.disconnect()
    } catch {}
    recordingV2TapNodeRef.current = null
    recordingV2TapSourceRef.current = null
    recordingV2TapSinkRef.current = null
  }, [])

  const setupRecordingV2Tap = useCallback(
    async (stream: MediaStream): Promise<boolean> => {
      if (!recordingEngineV2Enabled) return false
      const ctx = ctxRef.current
      if (!ctx || typeof AudioWorkletNode === "undefined" || !ctx.audioWorklet) return false
      try {
        if (!recordingV2TapModuleLoadedRef.current) {
          await ctx.audioWorklet.addModule("/worklets/recording-v2-pcm-tap.js")
          recordingV2TapModuleLoadedRef.current = true
        }
        teardownRecordingV2Tap()
        recordingV2TapStatsRef.current = {
          framesCaptured: 0,
          chunkReports: 0,
          errors: 0,
        }
        const source = ctx.createMediaStreamSource(stream)
        const node = new AudioWorkletNode(ctx, "recording-v2-pcm-tap")
        const sink = ctx.createGain()
        sink.gain.value = 0
        source.connect(node)
        node.connect(sink)
        sink.connect(ctx.destination)
        node.port.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data as Partial<{
            type: string
            frames: number
            chunks: number
            dropped: number
          }>
          if (data?.type !== "stats") return
          const frames = typeof data.frames === "number" ? Math.max(0, Math.floor(data.frames)) : 0
          const chunks = typeof data.chunks === "number" ? Math.max(0, Math.floor(data.chunks)) : 0
          const dropped = typeof data.dropped === "number" ? Math.max(0, Math.floor(data.dropped)) : 0
          recordingV2TapStatsRef.current.framesCaptured += frames
          recordingV2TapStatsRef.current.chunkReports += chunks
          recordingV2TapStatsRef.current.errors += dropped
        }
        recordingV2TapNodeRef.current = node
        recordingV2TapSourceRef.current = source
        recordingV2TapSinkRef.current = sink
        return true
      } catch {
        teardownRecordingV2Tap()
        recordingV2TapStatsRef.current.errors += 1
        return false
      }
    },
    [recordingEngineV2Enabled, teardownRecordingV2Tap]
  )

  const closeRecordingV2OpfsWriter = useCallback(async () => {
    const writer = recordingV2OpfsWriterRef.current
    recordingV2OpfsWriterRef.current = null
    if (!writer) return
    try {
      await writer.close()
    } catch {}
  }, [])

  const disposeTrackAudioGraph = useCallback(() => {
    try {
      enginesRef.current.forEach((eng) => {
        try {
          eng?.destroy()
        } catch {}
      })
    } catch {}
    try {
      engineGateRef.current.forEach((node) => {
        try {
          node.disconnect()
        } catch {}
      })
    } catch {}
    try {
      trackGainRef.current.forEach((node) => {
        try {
          node.disconnect()
        } catch {}
      })
    } catch {}
    try {
      panRef.current.forEach((node) => {
        try {
          node.disconnect()
        } catch {}
      })
    } catch {}
    enginesRef.current = []
    engineGateRef.current = []
    trackGainRef.current = []
    panRef.current = []
  }, [])

  /** =========================
   *  INIT (once)
   *  ========================= */
  useEffect(() => {
    let cancelled = false
    const fetchControllers: AbortController[] = []

    const init = async () => {
      readyRef.current = false
      setIsReady(false)
      disposeTrackAudioGraph()
      let ctx = ctxRef.current
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioContext()
        ctxRef.current = ctx
      }

      // master graph (create once per context)
      let masterIn = masterInRef.current
      if (!masterIn || !dryGainRef.current || !wetGainRef.current || !masterGainRef.current) {
        masterIn = ctx.createGain()
        const dryGain = ctx.createGain()
        const wetGain = ctx.createGain()
        const convolver = ctx.createConvolver()
        const masterGain = ctx.createGain()

        masterInRef.current = masterIn
        dryGainRef.current = dryGain
        wetGainRef.current = wetGain
        masterGainRef.current = masterGain

        masterIn.connect(dryGain)
        masterIn.connect(convolver)
        convolver.connect(wetGain)

        dryGain.connect(masterGain)
        wetGain.connect(masterGain)
        masterGain.connect(ctx.destination)
        convolver.buffer = makeImpulseResponse(ctx)
      }

      if (masterGainRef.current) masterGainRef.current.gain.value = masterVol
      if (wetGainRef.current) wetGainRef.current.gain.value = reverbAmount
      if (dryGainRef.current) dryGainRef.current.gain.value = 1 - reverbAmount

      // Load per-track and tolerate decode failures to avoid blocking the entire player.
      const decodeWarnings: string[] = []
      const fallbackDurationSec = 600
      const decodeTrackBuffer = async (trackIndex: number): Promise<{ buffer: AudioBuffer; byteLength: number }> => {
        const track = trackList[trackIndex]
        for (let attempt = 1; attempt <= TRACK_DECODE_MAX_ATTEMPTS; attempt++) {
          const controller = new AbortController()
          fetchControllers.push(controller)
          try {
            const res = await fetch(track.src, { signal: controller.signal })
            if (!res.ok) throw new Error(`Fetch failed: ${track.src} (${res.status})`)
            const arr = await res.arrayBuffer()
            return {
              buffer: await ctx.decodeAudioData(arr),
              byteLength: arr.byteLength,
            }
          } catch (err) {
            const isAbort = err instanceof DOMException && err.name === "AbortError"
            if (isAbort) break
            if (attempt >= TRACK_DECODE_MAX_ATTEMPTS) {
              const reason = err instanceof Error ? err.message : "unknown decode error"
              decodeWarnings.push(`${track.name}: ${reason}`)
            }
          }
        }
        // Keep transport behavior predictable when one of stems cannot be decoded.
        return {
          buffer: createSilentBuffer(ctx, fallbackDurationSec),
          byteLength: 0,
        }
      }

      let buffers: AudioBuffer[] = []
      if (trackList.length > 0) {
        const restIndexes = trackList.map((_, index) => index).filter((index) => index !== 0)
        buffers = new Array(trackList.length)
        const firstDecoded = await decodeTrackBuffer(0)
        buffers[0] = firstDecoded.buffer
        if (!cancelled) {
          setDuration(firstDecoded.buffer.duration || 0)
        }
        const shouldDecodeSequentially =
          progressiveLoadEnabled || firstDecoded.byteLength >= LARGE_TRACK_BYTES_THRESHOLD
        if (shouldDecodeSequentially) {
          for (const trackIndex of restIndexes) {
            const decoded = await decodeTrackBuffer(trackIndex)
            buffers[trackIndex] = decoded.buffer
          }
        } else {
          const decodedRest = await Promise.all(restIndexes.map((trackIndex) => decodeTrackBuffer(trackIndex)))
          decodedRest.forEach((decoded, idx) => {
            buffers[restIndexes[idx]] = decoded.buffer
          })
        }
      }

      if (decodeWarnings.length) {
        console.warn("Audio decode fallback activated:", decodeWarnings.join(" | "))
      }

      if (cancelled) return
      setDuration(buffers[0]?.duration ?? 0)

      // engines + per-track chain
      buffers.forEach((buffer, i) => {
        const engine = createSoundTouchEngine(ctx, buffer, { bufferSize: 2048 })
        enginesRef.current[i] = engine

        // gate
        const gate = ctx.createGain()
        gate.gain.value = 0
        engineGateRef.current[i] = gate

        // track chain
        const g = ctx.createGain()
        g.gain.value = initialTrackVolumes[i] ?? 1
        const p = ctx.createStereoPanner()

        gate.connect(g)
        g.connect(p)
        p.connect(masterIn)

        trackGainRef.current[i] = g
        panRef.current[i] = p

        engine.connect(gate)

        engine.setTempo(tempoRef.current)
        engine.setPitchSemitones(pitchSemiRef.current)
      })

      setIsReady(true)
      readyRef.current = true
      onTrackSetReady?.(trackScopeId)

      // peaks
      requestAnimationFrame(() => {
        if (cancelled) return
        const peaksArr: (WavePeaks | null)[] = []
        for (let i = 0; i < buffers.length; i++) {
          const canvas = waveCanvasesRef.current[i]
          const w = canvas?.clientWidth ? Math.floor(canvas.clientWidth) : 900
          peaksArr[i] = computePeaks(buffers[i], Math.max(900, w))
        }
        peaksRef.current = peaksArr
        setWaveReady(true)
      })
    }

    init().catch((e) => console.error("Audio init error:", e))
    return () => {
      cancelled = true
      fetchControllers.forEach((controller) => controller.abort())
      readyRef.current = false
      if (persistOnUnmount && isPlayingRef.current) return
      disposeTrackAudioGraph()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disposeTrackAudioGraph, initialTrackVolumes, onTrackSetReady, persistOnUnmount, progressiveLoadEnabled, trackList, trackScopeId])

  useEffect(() => {
    return () => {
      if (persistOnUnmount && isPlayingRef.current) return
      if (typeof window !== "undefined" && isPlayingRef.current) {
        const handoff: NavHandoffState = {
          trackScopeId,
          positionSec: positionSecRef.current,
          loopOn,
          playing: true,
          ts: Date.now(),
        }
        try {
          window.sessionStorage.setItem(NAV_HANDOFF_STORAGE_KEY, JSON.stringify(handoff))
        } catch {}
      }
      try {
        disposeTrackAudioGraph()
      } catch {}
      teardownRecordingV2Tap()
      void closeRecordingV2OpfsWriter()
      const ctx = ctxRef.current
      if (ctx && ctx.state !== "closed") {
        void ctx.close()
      }
      ctxRef.current = null
      masterInRef.current = null
      masterGainRef.current = null
      wetGainRef.current = null
      dryGainRef.current = null
    }
  }, [closeRecordingV2OpfsWriter, disposeTrackAudioGraph, loopOn, persistOnUnmount, teardownRecordingV2Tap, trackScopeId])

  const stopEnginesHard = useCallback(() => {
    engineGateRef.current.forEach((g) => rampGainTo(g, 0, 0.02))
    enginesRef.current.forEach((eng) => {
      try {
        eng?.stop()
      } catch {}
    })
  }, [])

  useEffect(() => {
    // New track set must start from a clean transport state.
    readyRef.current = false
    if (pendingRafRef.current != null) {
      cancelAnimationFrame(pendingRafRef.current)
      pendingRafRef.current = null
    }
    pendingLastFrameMsRef.current = 0
    setMainPlayPending(false)
    setMainPlayingState(false)
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    stopEnginesHard()
    disposeTrackAudioGraph()
    positionSecRef.current = 0
    setCurrentTime(0)

    peaksRef.current = trackList.map(() => null)
    waveCanvasesRef.current = trackList.map(() => null)

    setMuted(trackList.map(() => false))
    setSolo(trackList.map(() => false))
    setPanUI(trackList.map(() => 0))
    setVolUI(initialTrackVolumes)

    // Restore FX defaults only when switching to another track set.
    // Loop/repeat of the same track does not change trackScopeId, so manual values stay intact.
    setReverbAmount(DEFAULT_REVERB_AMOUNT)
    setSpeed(DEFAULT_SPEED)
    tempoRef.current = DEFAULT_SPEED
    setPitchSemi(DEFAULT_PITCH_SEMITONES)
    pitchSemiRef.current = DEFAULT_PITCH_SEMITONES
    cancelTempoPitchSmoothing()
    applyTempoPitchToEngines(DEFAULT_SPEED, DEFAULT_PITCH_SEMITONES)
  }, [
    applyTempoPitchToEngines,
    cancelTempoPitchSmoothing,
    disposeTrackAudioGraph,
    initialTrackVolumes,
    setMainPlayingState,
    stopEnginesHard,
    trackList,
    trackScopeId,
  ])

  /** =========================
   *  APPLY UI -> AUDIO (with smoothing)
   *  ========================= */
  useEffect(() => {
    if (calibrationMutedRef.current) return
    const target = guestSoloMode ? 0 : masterVol
    rampGainTo(masterGainRef.current, target, 0.05)
  }, [masterVol, guestSoloMode])

  useEffect(() => {
    if (!wetGainRef.current || !dryGainRef.current) return
    rampGainTo(wetGainRef.current, reverbAmount, 0.05)
    rampGainTo(dryGainRef.current, 1 - reverbAmount, 0.05)
  }, [reverbAmount])

  const applyMuteSoloVolume = (m: boolean[], s: boolean[], v: number[]) => {
    const anySolo = s.some(Boolean)
    trackGainRef.current.forEach((g, i) => {
      if (!g) return
      const base = v[i] ?? 1
      const factor = anySolo ? (s[i] ? 1 : 0) : (m[i] ? 0 : 1)
      rampGainTo(g, base * factor, 0.035)
    })
  }

  const applyPan = (p: number[]) => {
    panRef.current.forEach((node, i) => {
      if (!node) return
      node.pan.value = p[i] ?? 0
    })
  }

  /** =========================
   *  ACTIVE TRACK (highlight)
   *  ========================= */
  const isTrackAudible = (i: number) => {
    const anySolo = solo.some(Boolean)
    if (anySolo) return !!solo[i]
    return !muted[i]
  }

  const selectedSoloTrackIndex = useMemo(() => {
    const indexes = solo
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0)
    return indexes.length === 1 ? indexes[0] : -1
  }, [solo])

  useEffect(() => {
    if (!referenceLockEnabled) return
    if (recordReferenceIndex == null && selectedSoloTrackIndex >= 0) {
      setRecordReferenceIndex(selectedSoloTrackIndex)
    }
  }, [recordReferenceIndex, referenceLockEnabled, selectedSoloTrackIndex])

  /** =========================
   *  ENGINE CONTROL
   *  ========================= */
  const startEngines = () => {
    engineGateRef.current.forEach((g) => rampGainTo(g, 1, 0.02))
    enginesRef.current.forEach((eng) => {
      try {
        eng?.start()
      } catch {}
    })
  }

  /** =========================
   *  ANIMATION + END-OF-TRACK RESET
   *  ========================= */
  const animate = () => {
    if (!isPlayingRef.current) return
    const e0 = enginesRef.current[0]
    if (!e0) return

    const pos = e0.getSourcePositionSeconds()

    // End of track.
    if (duration > 0 && pos >= duration - 0.01) {
      // During active recording, hard-stop recording exactly at main-track boundary.
      if (recording) {
        stopGuestRecording()
        return
      }
      // Stop playback.
      setMainPlayingState(false)
      stopEnginesHard()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null

      // Move cursor to start.
      positionSecRef.current = 0
      setCurrentTime(0)
      enginesRef.current.forEach((eng) => eng?.seekSeconds(0))

      // If loopOn is enabled, restart.
      if (loopOn) {
        emitMiniPlayerTelemetry({
          controllerId: globalControllerIdRef.current,
          action: "track_loop_restart",
          endStreamReason: "loop_restart",
          playing: true,
          currentSec: 0,
          durationSec: duration,
          loopOn: true,
          route: typeof window !== "undefined" ? window.location.pathname : "",
          locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : "",
        })
        // No extra delay needed, start immediately.
        setMainPlayingState(true)
        startEngines()
        rafRef.current = requestAnimationFrame(animate)
      } else {
        emitMiniPlayerTelemetry({
          controllerId: globalControllerIdRef.current,
          action: "track_end",
          endStreamReason: "track_ended",
          playing: false,
          currentSec: duration,
          durationSec: duration,
          loopOn: false,
          route: typeof window !== "undefined" ? window.location.pathname : "",
          locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : "",
        })
        if (registerGlobalAudio) clearGlobalAudio(globalControllerIdRef.current)
      }
      return
    }

    positionSecRef.current = pos
    setCurrentTime(pos)
    rafRef.current = requestAnimationFrame(animate)
  }

  useEffect(() => {
    if (!waveReady || !duration) return
    const p = clamp(currentTime / duration, 0, 1)
    for (let i = 0; i < trackList.length; i++) {
      const canvas = waveCanvasesRef.current[i]
      const peaks = peaksRef.current[i]
      if (canvas && peaks) drawWaveform(canvas, peaks, p)
    }
  }, [currentTime, duration, waveReady, trackList.length])

  useEffect(() => {
    onTimeChange?.(currentTime)
  }, [currentTime, onTimeChange])

  useEffect(() => {
    let cancelled = false

    const loadTeleprompter = async () => {
      let hasLocalDraft = false
      setTeleprompterLoadState(effectiveTeleprompterSourceUrl ? "loading" : "idle")
      try {
        const draftState = parseTeleprompterDraftState(localStorage.getItem(teleprompterStateStorageKey))
        if (draftState?.lines.length) {
          setTeleprompterLines(draftState.lines)
          setTeleprompterDraftSavedAt(draftState.savedAt)
          hasLocalDraft = true
          setTeleprompterLoadState("ready")
        } else {
          const rawLocal = localStorage.getItem(teleprompterLinesStorageKey)
          const normalized = normalizeTeleprompterLines(rawLocal ? JSON.parse(rawLocal) : [])
          if (normalized.length > 0) {
            setTeleprompterLines(normalized)
            hasLocalDraft = true
            setTeleprompterLoadState("ready")
          }
        }
      } catch {}

      if (!effectiveTeleprompterSourceUrl) {
        if (!hasLocalDraft) setTeleprompterLines([])
        setTeleprompterLoadState(hasLocalDraft ? "ready" : "idle")
        return
      }

      try {
        const res = await fetch(effectiveTeleprompterSourceUrl)
        if (res.status === 404) {
          if (!hasLocalDraft) setTeleprompterLines([])
          setTeleprompterLoadState(hasLocalDraft ? "ready" : "missing")
          return
        }
        if (!res.ok) throw new Error(`Teleprompter fetch failed: ${effectiveTeleprompterSourceUrl}`)
        const base = normalizeTeleprompterLines((await res.json()) as TeleprompterLine[])
        if (cancelled) return

        if (!teleprompterExpandedText?.length) {
          setTeleprompterLines(base)
          setTeleprompterLoadState(base.length > 0 ? "ready" : "empty")
          return
        }

        const expanded: TeleprompterLine[] = []
        let textIdx = 0
        for (let i = 0; i < base.length; i++) {
          const curr = base[i]
          const next = base[i + 1]
          const halfStep = next ? Math.max((next.time - curr.time) / 2, 0.35) : 2.2
          const first = teleprompterExpandedText[textIdx] ?? curr.text
          const second = teleprompterExpandedText[textIdx + 1] ?? curr.text
          expanded.push({ time: curr.time, text: first })
          expanded.push({ time: curr.time + halfStep, text: second })
          textIdx += 2
        }

        setTeleprompterLines(expanded)
        setTeleprompterLoadState(expanded.length > 0 ? "ready" : "empty")
      } catch (e) {
        console.error("Teleprompter load error:", e)
        if (cancelled) return
        if (!hasLocalDraft) {
          setTeleprompterLines([])
          setTeleprompterLoadState("error")
        } else {
          setTeleprompterLoadState("ready")
        }
      }
    }

    void loadTeleprompter()

    return () => {
      cancelled = true
    }
  }, [effectiveTeleprompterSourceUrl, teleprompterExpandedText, teleprompterLinesStorageKey, teleprompterStateStorageKey])

  useEffect(() => {
    try {
      if (!teleprompterLines.length) {
        localStorage.removeItem(teleprompterLinesStorageKey)
      } else {
        localStorage.setItem(teleprompterLinesStorageKey, JSON.stringify(teleprompterLines))
      }
    } catch {}
  }, [teleprompterLines, teleprompterLinesStorageKey])

  useEffect(() => {
    if (!teleprompterAnchorStorageKey) return
    try {
      const draftState = parseTeleprompterDraftState(localStorage.getItem(teleprompterStateStorageKey))
      if (draftState) {
        setTeleprompterAnchors(draftState.anchors)
        return
      }
      const raw = localStorage.getItem(teleprompterAnchorStorageKey)
      const parsed = raw ? JSON.parse(raw) : null
      setTeleprompterAnchors(normalizeTeleprompterAnchors(parsed))
    } catch {
      setTeleprompterAnchors({})
    }
  }, [teleprompterAnchorStorageKey, teleprompterStateStorageKey])

  useEffect(() => {
    teleprompterAnchorsRef.current = teleprompterAnchors
  }, [teleprompterAnchors])

  useEffect(() => {
    if (!teleprompterAnchorStorageKey) return
    try {
      localStorage.setItem(teleprompterAnchorStorageKey, JSON.stringify(teleprompterAnchors))
    } catch {}
  }, [teleprompterAnchorStorageKey, teleprompterAnchors])

  useEffect(() => {
    if (!teleprompterTextStorageKey) return
    try {
      const draftState = parseTeleprompterDraftState(localStorage.getItem(teleprompterStateStorageKey))
      if (draftState) {
        setTeleprompterTextOverrides(draftState.textOverrides)
        return
      }
      const raw = localStorage.getItem(teleprompterTextStorageKey)
      const parsed = raw ? JSON.parse(raw) : null
      setTeleprompterTextOverrides(normalizeTeleprompterTextOverrides(parsed))
    } catch {
      setTeleprompterTextOverrides({})
    }
  }, [teleprompterStateStorageKey, teleprompterTextStorageKey])

  useEffect(() => {
    teleprompterTextOverridesRef.current = teleprompterTextOverrides
  }, [teleprompterTextOverrides])

  useEffect(() => {
    if (!teleprompterTextStorageKey) return
    try {
      localStorage.setItem(teleprompterTextStorageKey, JSON.stringify(teleprompterTextOverrides))
    } catch {}
  }, [teleprompterTextOverrides, teleprompterTextStorageKey])

  useEffect(() => {
    if (!teleprompterAutoCollectStorageKey) return
    try {
      const raw = localStorage.getItem(teleprompterAutoCollectStorageKey)
      setTeleprompterAutoCollect(raw === "1")
    } catch {
      setTeleprompterAutoCollect(false)
    }
    teleprompterAutoCollectPrimedRef.current = false
  }, [teleprompterAutoCollectStorageKey])

  useEffect(() => {
    if (!teleprompterAutoCollectStorageKey) return
    try {
      localStorage.setItem(teleprompterAutoCollectStorageKey, teleprompterAutoCollect ? "1" : "0")
    } catch {}
  }, [teleprompterAutoCollect, teleprompterAutoCollectStorageKey])

  useEffect(() => {
    if (!teleprompterPreviewAutoSaveStorageKey) return
    try {
      const raw = localStorage.getItem(teleprompterPreviewAutoSaveStorageKey)
      setTeleprompterPreviewAutoSave(raw !== "0")
    } catch {
      setTeleprompterPreviewAutoSave(true)
    }
    teleprompterPreviewAutoSavePrimedRef.current = false
    teleprompterPreviewKnownSignatureRef.current = ""
  }, [teleprompterPreviewAutoSaveStorageKey])

  useEffect(() => {
    if (!teleprompterPreviewAutoSaveStorageKey) return
    try {
      localStorage.setItem(teleprompterPreviewAutoSaveStorageKey, teleprompterPreviewAutoSave ? "1" : "0")
    } catch {}
  }, [teleprompterPreviewAutoSave, teleprompterPreviewAutoSaveStorageKey])

  useEffect(() => {
    teleprompterLinesRef.current = teleprompterLines
  }, [teleprompterLines])

  useEffect(() => {
    teleprompterDraftDirtyRef.current = false
    setTeleprompterDraftDirty(false)
    setTeleprompterDraftSavedAt("")
    setTeleprompterBackupInfo("")
  }, [teleprompterStateStorageKey])

  const stopPendingTransport = useCallback(() => {
    if (pendingRafRef.current != null) {
      cancelAnimationFrame(pendingRafRef.current)
      pendingRafRef.current = null
    }
    pendingLastFrameMsRef.current = 0
  }, [])

  const startPendingTransport = useCallback(() => {
    if (pendingRafRef.current != null) return
    const step = (frameMs: number) => {
      if (!pendingPlayRef.current || readyRef.current || isPlayingRef.current) {
        stopPendingTransport()
        return
      }
      if (guestTransportLinkedRef.current) {
        pendingLastFrameMsRef.current = frameMs
        pendingRafRef.current = requestAnimationFrame(step)
        return
      }
      const prev = pendingLastFrameMsRef.current || frameMs
      const dtSec = Math.max(0, Math.min(0.2, (frameMs - prev) / 1000))
      pendingLastFrameMsRef.current = frameMs
      if (dtSec > 0) {
        const nextPos = positionSecRef.current + dtSec * Math.max(0.6, tempoRef.current)
        const bounded = duration > 0 ? Math.min(nextPos, duration) : nextPos
        positionSecRef.current = bounded
        setCurrentTime(bounded)
      }
      pendingRafRef.current = requestAnimationFrame(step)
    }
    pendingRafRef.current = requestAnimationFrame(step)
  }, [duration, stopPendingTransport])

  /** =========================
   *  TRANSPORT
   *  ========================= */
  const play = async () => {
    const ctx = ctxRef.current
    if (!ctx || !readyRef.current) {
      pendingPlayRef.current = true
      setMainPlayPending(true)
      startPendingTransport()
      return
    }
    stopPendingTransport()
    setMainPlayPending(false)
    pendingPlayRef.current = false
    if (registerGlobalAudio && globalControllerRef.current) requestGlobalAudio(globalControllerRef.current)
    await ctx.resume()
    if (guestSoloMode) setGuestSoloMode(false)
    const masterTarget = guestSoloMode ? 0 : masterVol
    // Restore main bus levels before start after an explicit hard stop.
    rampGainTo(masterGainRef.current, masterTarget, 0.02)
    rampGainTo(wetGainRef.current, reverbAmount, 0.03)
    rampGainTo(dryGainRef.current, 1 - reverbAmount, 0.03)

    // If we are at track end, restart from the beginning.
    const atEnd = duration > 0 && positionSecRef.current >= duration - 0.02
    const pos = atEnd ? 0 : clamp(positionSecRef.current, 0, duration || positionSecRef.current)

    positionSecRef.current = pos
    setCurrentTime(pos)

    stopEnginesHard()
    enginesRef.current.forEach((eng) => eng?.seekSeconds(pos))
    const guestAudio = guestAudioRef.current
    const hasLinkedGuest = guestTransportLinkedRef.current && !!guestAudio && !!guestTrackUrl
    if (hasLinkedGuest && guestAudio) {
      await waitForGuestAudioReady(guestAudio)
      if (guestNeedsRecalibrateRef.current || !guestCalibrateReady) {
        await calibrateGuestDelay({ silent: true, keepPosition: true })
      }
      await seekGuestAudioForStart(pos)
      guardGuestStart()
    }

    startEngines()
    setMainPlayingState(true)

    if (hasLinkedGuest && guestAudio) {
      void (async () => {
        try {
          await guestAudio.play()
        } catch {
          try {
            // Fallback for browsers that reject delayed unmuted autoplay after async setup.
            const targetMuted = guestMuted
            guestAudio.muted = true
            await guestAudio.play()
            guestAudio.muted = targetMuted
          } catch {
            setRecordError(t.guestStartSyncFailed)
          }
        }
      })()
      ;[40, 140, 280].forEach((delayMs) => {
        window.setTimeout(() => {
          if (!guestTransportLinkedRef.current || !isPlayingRef.current) return
          syncGuestToMain(positionSecRef.current, true)
        }, delayMs)
      })
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
  }

  const forceStopMainTransport = () => {
    stopPendingTransport()
    setMainPlayPending(false)
    setMainPlayingState(false)
    stopEnginesHard()
    // Hard-duck master bus to instantly cut reverb tail on stop/switch.
    rampGainTo(masterGainRef.current, 0, 0.012)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }

  const pauseGuestSolo = () => {
    const guestAudio = guestAudioRef.current
    if (!guestAudio) return
    setGuestSoloMode(false)
    rampGainTo(masterGainRef.current, masterVol, 0.04)
    beginGuestProgrammaticAction()
    guestAudio.pause()
    endGuestProgrammaticAction()
    setGuestIsPlaying(false)
  }

  const clearGuestCalibrateTimer = () => {
    if (guestCalibrateTimerRef.current != null) {
      window.clearInterval(guestCalibrateTimerRef.current)
      guestCalibrateTimerRef.current = null
    }
  }

  const setCalibrationMute = (enabled: boolean) => {
    const audio = guestAudioRef.current
    const master = masterGainRef.current
    const guestGain = guestGainNodeRef.current
    if (enabled) {
      calibrationMutedRef.current = true
      if (audio) calibrationGuestVolumeRef.current = audio.volume
      if (guestGain) calibrationGuestGainRef.current = guestGain.gain.value
      if (master) {
        const now = master.context.currentTime
        master.gain.cancelScheduledValues(now)
        master.gain.setValueAtTime(0, now)
      }
      if (guestGain) {
        const now = guestGain.context.currentTime
        guestGain.gain.cancelScheduledValues(now)
        guestGain.gain.setValueAtTime(0, now)
      }
      if (audio) audio.volume = 0
      return
    }

    if (!calibrationMutedRef.current) return
    calibrationMutedRef.current = false
    const masterTarget = guestSoloMode ? 0 : masterVol
    rampGainTo(master, masterTarget, 0.05)
    if (guestGain) rampGainTo(guestGain, calibrationGuestGainRef.current, 0.04)
    if (audio) {
      if (guestGain) audio.volume = 0
      else audio.volume = calibrationGuestVolumeRef.current
    }
  }

  const openGuestDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open("rr_guest_tracks", 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("tracks")) db.createObjectStore("tracks")
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

  const saveGuestRecording = useCallback(async (blob: Blob, recordKey = guestRecordStorageKey) => {
    try {
      const db = await openGuestDb()
      const tx = db.transaction("tracks", "readwrite")
      const store = tx.objectStore("tracks")
      await new Promise<void>((resolve, reject) => {
        const req = store.put({ blob, ts: Date.now() }, recordKey)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
      db.close()
    } catch {}
  }, [guestRecordStorageKey])

  const loadGuestRecordingByKey = useCallback(async (recordKey: string): Promise<Blob | null> => {
    try {
      const db = await openGuestDb()
      const tx = db.transaction("tracks", "readonly")
      const store = tx.objectStore("tracks")
      const record = await new Promise<{ blob?: Blob } | undefined>((resolve, reject) => {
        const req = store.get(recordKey)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return record?.blob ?? null
    } catch {}
    return null
  }, [])

  const loadGuestRecording = useCallback(async (): Promise<void> => {
    const applyTakeMetaToUi = (take: GuestTakeMeta | null) => {
      if (!take) return
      setRecordReferenceIndex(take.referenceTrackIndex)
      setGuestCalibrateReady(false)
      setGuestCalibrateScore(take.score ?? null)
      setGuestSyncQuality(take.syncQuality ?? "unknown")
      if (typeof take.offsetSec === "number" && Number.isFinite(take.offsetSec)) {
        setGuestSyncOffsetSec(clamp(take.offsetSec, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC))
      }
    }

    const applyBlobAsActiveTake = (blob: Blob, takeId: string | null, takes: GuestTakeMeta[]) => {
      const url = URL.createObjectURL(blob)
      setGuestTrackUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
      setGuestTakes(takes)
      setActiveGuestTakeId(takeId)
      const activeTake = takeId ? takes.find((item) => item.id === takeId) ?? null : null
      applyTakeMetaToUi(activeTake)
    }

    try {
      const rawTakes = localStorage.getItem(guestTakesStorageKey)
      if (rawTakes) {
        const parsed = JSON.parse(rawTakes) as Partial<GuestTakesState> | null
        const parsedTakes = Array.isArray(parsed?.takes)
          ? parsed.takes.filter((take): take is GuestTakeMeta => {
              if (!take || typeof take !== "object") return false
              if (typeof take.id !== "string" || !take.id) return false
              if (typeof take.sourceKey !== "string" || !take.sourceKey) return false
              if (typeof take.referenceTrackIndex !== "number" || !Number.isFinite(take.referenceTrackIndex)) return false
              return true
            })
          : []
        if (parsedTakes.length > 0) {
          const safeTakes = parsedTakes.slice(0, GUEST_TAKES_MAX)
          const candidateId = typeof parsed?.activeTakeId === "string" ? parsed.activeTakeId : safeTakes[0].id
          const selectedTake = safeTakes.find((take) => take.id === candidateId) ?? safeTakes[0]
          const blob = await loadGuestRecordingByKey(selectedTake.sourceKey)
          if (blob) {
            applyBlobAsActiveTake(blob, selectedTake.id, safeTakes)
            return
          }
        }
      }
    } catch {}

    // Legacy fallback: single take key.
    try {
      const legacyBlob = await loadGuestRecordingByKey(guestRecordStorageKey)
      if (!legacyBlob) return
      const legacyId = "legacy"
      const legacyTake: GuestTakeMeta = {
        id: legacyId,
        title: "Legacy take",
        createdAt: new Date(0).toISOString(),
        sourceKey: guestRecordStorageKey,
        referenceTrackIndex: selectedSoloTrackIndex >= 0 ? selectedSoloTrackIndex : 0,
      }
      applyBlobAsActiveTake(legacyBlob, legacyId, [legacyTake])
    } catch {}
  }, [guestRecordStorageKey, guestTakesStorageKey, loadGuestRecordingByKey, selectedSoloTrackIndex])

  const pause = () => {
    stopPendingTransport()
    setMainPlayPending(false)
    pendingPlayRef.current = false
    clearGuestCalibrateTimer()
    clearGuestStartGuardTimer()
    forceStopMainTransport()

    const guestAudio = guestAudioRef.current
    if (guestAudio && !guestAudio.paused) {
      beginGuestProgrammaticAction()
      guestAudio.pause()
      endGuestProgrammaticAction()
    }
    if (guestAudio) guestAudio.playbackRate = 1
    guestRateNudgeRef.current = 1
    void flushGuestSyncTelemetry("pause", true)
  }

  const togglePlay = () => {
    if (isPlayingRef.current || mainPlayPending) pause()
    else play()
  }

  const seekTo = (sec: number) => {
    const pos = clamp(sec, 0, duration || sec)
    positionSecRef.current = pos
    setCurrentTime(pos)

    const wasPlaying = isPlayingRef.current

    stopEnginesHard()
    enginesRef.current.forEach((eng) => eng?.seekSeconds(pos))

    if (wasPlaying) {
      startEngines()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(animate)
    }

    if (guestTransportLinkedRef.current) {
      syncGuestToMain(pos, true)
    }
  }

  const goToStart = () => {
    pause()
    seekTo(0)
  }

  useEffect(() => {
    if (!isReady || !pendingPlayRef.current) return
    pendingPlayRef.current = false
    void play()
    // play intentionally excluded to avoid unstable callback re-triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    if (!isReady || navResumePositionRef.current == null) return
    const resumePos = navResumePositionRef.current
    const resumePlay = navResumePlayRef.current
    navResumePositionRef.current = null
    navResumePlayRef.current = false
    seekTo(resumePos)
    if (resumePlay) {
      void play()
    }
    // seekTo/play intentionally excluded to avoid unstable callback re-triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    globalControllerRef.current = {
      id: globalControllerIdRef.current,
      title: trackList[0]?.name ?? t.songFallbackTitle,
      subtitle: t.songFallbackSubtitle,
      prime: () => {
        const ctx = ctxRef.current
        if (!ctx) return
        void ctx.resume().catch(() => {})
      },
      stop: () => pause(),
      play: () => {
        play().catch(() => {})
      },
      pause: () => pause(),
      toggle: () => {
        if (isPlayingRef.current) pause()
        else play().catch(() => {})
      },
      prev: () => {
        seekTo(Math.max(0, positionSecRef.current - 10))
      },
      next: () => {
        seekTo(Math.min(duration || positionSecRef.current + 10, positionSecRef.current + 10))
      },
      seek: (timeSec: number) => seekTo(timeSec),
      getProgress: () => ({
        current: positionSecRef.current,
        duration,
        playing: isPlayingRef.current,
      }),
      getLoop: () => loopOn,
      setLoop: (loop: boolean) => setLoopOn(loop),
    }
    onControllerReady?.(globalControllerRef.current)
    return () => {
      if (persistOnUnmount && isPlayingRef.current) return
      onControllerReady?.(null)
    }
    // play/pause are intentionally omitted to keep controller wiring stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, loopOn, onControllerReady, persistOnUnmount, seekTo, t.songFallbackSubtitle, t.songFallbackTitle, trackList])

  useEffect(() => {
    if (seekToSeconds == null) return
    if (lastExternalSeekRef.current != null && Math.abs(lastExternalSeekRef.current - seekToSeconds) < 0.001) return
    lastExternalSeekRef.current = seekToSeconds
    seekTo(seekToSeconds)
    // seekTo intentionally not in deps to avoid effect loop from function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekToSeconds])

  useEffect(() => {
    return () => {
      stopPendingTransport()
      pendingPlayRef.current = false
      clearGuestCalibrateTimer()
      clearGuestStartGuardTimer()
      if (tempoPitchRealignTimerRef.current != null) {
        window.clearTimeout(tempoPitchRealignTimerRef.current)
        tempoPitchRealignTimerRef.current = null
      }
      cancelTempoPitchSmoothing()
      if (countInTimerRef.current != null) {
        window.clearInterval(countInTimerRef.current)
        countInTimerRef.current = null
      }
      if (recordingCapabilitySnapshotRef.current) {
        const finalSnapshot = {
          ...recordingCapabilitySnapshotRef.current,
          dropoutCount: recordDropoutCountRef.current,
          recoveryCount: recordRecoveryCountRef.current,
          workletTapActive: !!recordingV2TapNodeRef.current,
          workletFramesCaptured: recordingV2TapStatsRef.current.framesCaptured,
          workletChunkReports: recordingV2TapStatsRef.current.chunkReports,
          workletTapErrors: recordingV2TapStatsRef.current.errors,
          opfsWriterActive: !!recordingV2OpfsWriterRef.current,
          opfsBytesWritten: recordingV2OpfsStatsRef.current.bytes,
          opfsChunkCount: recordingV2OpfsStatsRef.current.chunks,
          opfsWriteErrors: recordingV2OpfsStatsRef.current.errors,
          uploadState: recordingV2UploadState,
          capturedAt: new Date().toISOString(),
        }
        flushRecorderCapabilityTelemetry("unmount", finalSnapshot)
      }
      teardownRecordingV2Tap()
      void closeRecordingV2OpfsWriter()
      if (guestTrackUrl) URL.revokeObjectURL(guestTrackUrl)
      recordStreamRef.current?.getTracks().forEach((t) => t.stop())
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop()
      }
    }
  }, [
    cancelTempoPitchSmoothing,
    closeRecordingV2OpfsWriter,
    flushRecorderCapabilityTelemetry,
    guestTrackUrl,
    recordingV2UploadState,
    stopPendingTransport,
    teardownRecordingV2Tap,
  ])

  const playReferenceTone = async (freq: number) => {
    const ctx = ctxRef.current
    if (!ctx) return
    await ctx.resume()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    g.gain.value = 0.0001
    osc.frequency.value = freq
    osc.type = "sine"
    osc.connect(g)
    g.connect(ctx.destination)
    const now = ctx.currentTime
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
    osc.start(now)
    osc.stop(now + 0.38)
  }

  const playPianoTone = useCallback(async (freq: number) => {
    const ctx = ctxRef.current
    if (!ctx) return
    await ctx.resume()

    const now = ctx.currentTime
    const out = ctx.createGain()
    out.gain.value = 0.0001

    const bodyFilter = ctx.createBiquadFilter()
    bodyFilter.type = "lowpass"
    bodyFilter.frequency.setValueAtTime(5200, now)
    bodyFilter.frequency.exponentialRampToValueAtTime(1800, now + 0.48)
    bodyFilter.Q.value = 0.9

    const sparkleFilter = ctx.createBiquadFilter()
    sparkleFilter.type = "highshelf"
    sparkleFilter.frequency.value = 2500
    sparkleFilter.gain.value = 3.8

    const osc1 = ctx.createOscillator()
    osc1.type = "triangle"
    osc1.frequency.value = freq
    const g1 = ctx.createGain()
    g1.gain.value = 0.52

    const osc2 = ctx.createOscillator()
    osc2.type = "triangle"
    osc2.frequency.value = freq * 2.01
    const g2 = ctx.createGain()
    g2.gain.value = 0.2

    const osc3 = ctx.createOscillator()
    osc3.type = "sine"
    osc3.frequency.value = freq * 2.99
    const g3 = ctx.createGain()
    g3.gain.value = 0.1

    const osc4 = ctx.createOscillator()
    osc4.type = "sine"
    osc4.frequency.value = freq * 4.02
    const g4 = ctx.createGain()
    g4.gain.value = 0.045

    const noise = ctx.createBufferSource()
    const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * 0.06))
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate)
    const noiseData = noiseBuf.getChannelData(0)
    for (let i = 0; i < noiseLen; i++) noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen)
    noise.buffer = noiseBuf
    const noiseFilter = ctx.createBiquadFilter()
    noiseFilter.type = "bandpass"
    noiseFilter.frequency.value = Math.min(3800, Math.max(1200, freq * 2.7))
    noiseFilter.Q.value = 0.8
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.08, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055)

    osc1.connect(g1)
    osc2.connect(g2)
    osc3.connect(g3)
    osc4.connect(g4)
    g1.connect(bodyFilter)
    g2.connect(bodyFilter)
    g3.connect(bodyFilter)
    g4.connect(bodyFilter)
    noise.connect(noiseFilter)
    noiseFilter.connect(noiseGain)
    noiseGain.connect(bodyFilter)
    bodyFilter.connect(sparkleFilter)
    sparkleFilter.connect(out)
    out.connect(ctx.destination)

    const target = Math.max(0.05, pianoVolume) * 0.2
    out.gain.setValueAtTime(0.0001, now)
    out.gain.exponentialRampToValueAtTime(target, now + 0.008)
    out.gain.exponentialRampToValueAtTime(target * 0.44, now + 0.22)
    out.gain.exponentialRampToValueAtTime(target * 0.22, now + 0.85)
    out.gain.exponentialRampToValueAtTime(0.0001, now + 2.1)

    osc1.start(now)
    osc2.start(now)
    osc3.start(now)
    osc4.start(now)
    noise.start(now)
    const stopAt = now + 2.2
    osc1.stop(stopAt)
    osc2.stop(stopAt)
    osc3.stop(stopAt)
    osc4.stop(stopAt)
    noise.stop(now + 0.065)
  }, [pianoVolume])

  useEffect(() => {
    if (!showPiano) return
    const map = new Map<string, number>()
    for (const key of pianoKeys) {
      if (key.kbd) map.set(key.kbd.toLowerCase(), key.freq)
      if (key.kbdRu) map.set(key.kbdRu.toLowerCase(), key.freq)
    }
    const pressed = new Set<string>()
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      const freq = map.get(k)
      if (!freq) return
      if (pressed.has(k)) return
      pressed.add(k)
      e.preventDefault()
      playPianoTone(freq).catch(() => {})
    }
    const onUp = (e: KeyboardEvent) => {
      pressed.delete(e.key.toLowerCase())
    }
    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
    }
  }, [showPiano, pianoKeys, playPianoTone])

  const playCountInClick = async (isLast: boolean) => {
    const freq = isLast ? 1046.5 : 783.99
    await playReferenceTone(freq)
  }

  const startGuestRecording = async () => {
    if (recordArmingRef.current) {
      setRecordError(t.recordStartInProgress)
      return
    }
    try {
      recordArmingRef.current = true
      setRecordError(null)
      setGuestCalibrateReady(false)
      setGuestCalibrateScore(null)
      setGuestSyncQuality("unknown")
      guestTransportLinkedRef.current = false
      setRecordChecklistOpen(true)
      const localMasterEnabled = recordingMode === "local_master" && recordingEngineV2Enabled && localMasterCapable
      if (recordingMode === "local_master" && !localMasterEnabled) {
        setRecordError(t.recordingModeFallbackHint)
      }
      if (selectedSoloTrackIndex < 0) {
        setRecordError(t.recordRequireSingleSolo)
        recordArmingRef.current = false
        return
      }
      const persistedHeadphonesConfirmed = (() => {
        if (recordHeadphonesConfirmed) return true
        if (typeof window === "undefined") return false
        try {
          return window.localStorage.getItem(RECORD_HEADPHONES_STORAGE_KEY) === "1"
        } catch {
          return false
        }
      })()
      if (!recordHeadphonesConfirmed && persistedHeadphonesConfirmed) {
        setRecordHeadphonesConfirmed(true)
      }
      if (!persistedHeadphonesConfirmed) {
        setRecordError(t.recordRequireHeadphones)
        recordArmingRef.current = false
        return
      }
      if (referenceLockEnabled) {
        setRecordReferenceIndex(selectedSoloTrackIndex)
      } else {
        setRecordReferenceIndex(null)
      }

      if (countInTimerRef.current != null) {
        window.clearInterval(countInTimerRef.current)
        countInTimerRef.current = null
      }
      guestTogetherFirstStartRef.current = true
      guestStartupBiasSecRef.current = 0
      recordDropoutCountRef.current = 0
      recordRecoveryCountRef.current = 0
      setRecordDropoutCount(0)
      setRecordRecoveryCount(0)
      recordingV2TakeSessionIdRef.current = null
      recordingV2ChunkSeqRef.current = 0
      recordingV2WriteChainRef.current = Promise.resolve()
      recordingV2OpfsStatsRef.current = { bytes: 0, chunks: 0, errors: 0 }
      setRecordingV2OpfsBytes(0)
      setRecordingV2OpfsChunks(0)
      setRecordingV2OpfsErrors(0)
      setRecordingV2OpfsActive(false)
      setRecordingV2UploadState("idle")
      await closeRecordingV2OpfsWriter()

      let stream = recordStreamRef.current
      const hasLiveTrack = !!stream?.getAudioTracks().some((t) => t.readyState === "live")
      if (!hasLiveTrack) {
        stream = await navigator.mediaDevices.getUserMedia(RECORD_STREAM_CONSTRAINTS)
        recordStreamRef.current = stream
      }
      if (!stream) throw new Error("mic-stream-unavailable")
      teardownRecordingV2Tap()
      recordingV2TapStatsRef.current = {
        framesCaptured: 0,
        chunkReports: 0,
        errors: 0,
      }
      if (localMasterEnabled) {
        const tapReady = await setupRecordingV2Tap(stream)
        if (!tapReady) {
          recordingV2TapStatsRef.current.errors += 1
        }
        const sessionTakeId = buildGuestTakeId()
        recordingV2TakeSessionIdRef.current = sessionTakeId
        try {
          const writer = await createRecordingV2OpfsWriter(sessionTakeId)
          if (writer) {
            recordingV2OpfsWriterRef.current = writer
            setRecordingV2OpfsActive(true)
          } else {
            recordingV2OpfsStatsRef.current.errors += 1
            setRecordingV2OpfsErrors(recordingV2OpfsStatsRef.current.errors)
          }
        } catch {
          recordingV2OpfsStatsRef.current.errors += 1
          setRecordingV2OpfsErrors(recordingV2OpfsStatsRef.current.errors)
        }
      }
      const inputTrack = stream.getAudioTracks()[0]
      const inputLabelRaw = inputTrack?.label || "default-input"
      const inputLabel = inputLabelRaw.toLowerCase()
      const looksBluetooth = /airpods|bluetooth|buds|hands-free|headset/.test(inputLabel)
      setBluetoothRouteRisk(looksBluetooth)
      const inputSettings = inputTrack?.getSettings?.()
      const inputDeviceId = typeof inputSettings?.deviceId === "string" && inputSettings.deviceId ? inputSettings.deviceId : "default"
      const browserHint = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 24) : "browser"
      const profileId = `${browserHint}:${inputDeviceId}`
      let activeDeviceProfileId: string | undefined
      if (inputTrack) {
        inputTrack.onmute = () => {
          recordDropoutCountRef.current += 1
          setRecordDropoutCount(recordDropoutCountRef.current)
        }
        inputTrack.onunmute = () => {
          recordRecoveryCountRef.current += 1
          setRecordRecoveryCount(recordRecoveryCountRef.current)
        }
        inputTrack.onended = () => {
          setRecordError(t.recordMicDisconnected)
          setRecording(false)
          const endedSnapshot = buildCurrentRecorderSnapshot({
            stream: recordStreamRef.current,
            mimeType: recorderRef.current?.mimeType || pickRecordingMimeType(),
          })
          setRecordingCapabilitySnapshot(endedSnapshot)
          flushRecorderCapabilityTelemetry("error", endedSnapshot)
          if (recordStreamRef.current === stream) {
            recordStreamRef.current = null
          }
        }
      }
      recordChunksRef.current = []
      const mimeType = pickRecordingMimeType()
      const recordingProbe = buildCurrentRecorderSnapshot({ stream, mimeType })
      setRecordingCapabilitySnapshot(recordingProbe)
      const estimatedOffset = estimateLatencyCompensationSec(ctxRef.current, stream)
      const profileOffset = deviceLatencyProfile?.id === profileId ? deviceLatencyProfile.offsetSec : null
      const baselineOffset = Number.isFinite(profileOffset ?? NaN) ? (profileOffset as number) : estimatedOffset
      if (Number.isFinite(estimatedOffset) && estimatedOffset > 0.01) {
        setDeviceLatencyProfile({
          id: profileId,
          label: inputLabelRaw,
          offsetSec: clamp(estimatedOffset, -1, 1),
          updatedAt: new Date().toISOString(),
        })
        activeDeviceProfileId = profileId
      } else if (profileOffset != null) {
        activeDeviceProfileId = profileId
      }
      // Do not overwrite manual user calibration each time.
      if (Math.abs(guestSyncOffsetRef.current) < 0.02 && baselineOffset > 0.01) {
        setGuestSyncOffsetSec(baselineOffset)
      }
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size <= 0) return
        const writer = recordingV2OpfsWriterRef.current
        if (!writer) {
          recordChunksRef.current.push(e.data)
          return
        }
        const seq = recordingV2ChunkSeqRef.current++
        const chunk = e.data
        recordingV2WriteChainRef.current = recordingV2WriteChainRef.current
          .then(async () => {
            const appendResult = await writer.appendChunk(chunk, seq)
            recordingV2OpfsStatsRef.current.bytes = appendResult.totalBytes
            recordingV2OpfsStatsRef.current.chunks = appendResult.chunkCount
            setRecordingV2OpfsBytes(appendResult.totalBytes)
            setRecordingV2OpfsChunks(appendResult.chunkCount)
          })
          .catch(() => {
            recordingV2OpfsStatsRef.current.errors += 1
            setRecordingV2OpfsErrors(recordingV2OpfsStatsRef.current.errors)
            // Fallback path preserves current behavior if OPFS append fails mid-record.
            recordChunksRef.current.push(chunk)
          })
      }
      recorder.onerror = () => {
        recordArmingRef.current = false
        setRecordError(t.recordMicError)
        setRecording(false)
        setRecordingV2OpfsActive(false)
        setRecordingV2UploadState("failed")
        void closeRecordingV2OpfsWriter()
        const errorSnapshot = buildCurrentRecorderSnapshot({
          stream: recordStreamRef.current,
          mimeType: recorder.mimeType || mimeType,
        })
        setRecordingCapabilitySnapshot(errorSnapshot)
        flushRecorderCapabilityTelemetry("error", errorSnapshot)
      }
      recorder.onstop = () => {
        const stopSnapshot = buildCurrentRecorderSnapshot({
          stream: recordStreamRef.current,
          mimeType: recorder.mimeType || mimeType,
        })
        setRecordingCapabilitySnapshot(stopSnapshot)
        flushRecorderCapabilityTelemetry("stop", stopSnapshot)
        teardownRecordingV2Tap()
        void (async () => {
          const outMime = recorder.mimeType || mimeType || "audio/webm"
          let rawBlob = new Blob(recordChunksRef.current, { type: outMime })
          const writer = recordingV2OpfsWriterRef.current
          if (writer) {
            try {
              await recordingV2WriteChainRef.current
              const finalized = await writer.finalizeToBlob(outMime)
              if (finalized.blob.size > 0) {
                rawBlob = finalized.blob
                recordingV2OpfsStatsRef.current.bytes = finalized.byteLength
                recordingV2OpfsStatsRef.current.chunks = finalized.chunkCount
                setRecordingV2OpfsBytes(finalized.byteLength)
                setRecordingV2OpfsChunks(finalized.chunkCount)
              }
            } catch {
              recordingV2OpfsStatsRef.current.errors += 1
              setRecordingV2OpfsErrors(recordingV2OpfsStatsRef.current.errors)
            } finally {
              setRecordingV2OpfsActive(false)
              await closeRecordingV2OpfsWriter()
            }
          }
          if (rawBlob.size < 1024) {
            setRecordError(t.recordTooShort)
            setRecording(false)
            setCountInBeat(null)
            return
          }
          let finalBlob = rawBlob
          try {
            const normalizedBlob = await normalizeRecordedBlobToStereoWav(rawBlob)
            if (normalizedBlob.size > 0) {
              finalBlob = normalizedBlob
            }
          } catch {}
          const takeId = recordingV2TakeSessionIdRef.current || buildGuestTakeId()
          recordingV2TakeSessionIdRef.current = null
          const takeRecordKey = `${guestRecordStorageKey}:take:${takeId}`
          const takeCreatedAt = new Date().toISOString()
          const resolvedReferenceIndex = recordReferenceIndexRef.current
          const takeReferenceIndex = Number.isFinite(resolvedReferenceIndex ?? NaN)
            ? Math.max(0, Number(resolvedReferenceIndex))
            : Math.max(0, selectedSoloTrackIndex)

          const url = URL.createObjectURL(finalBlob)
          setGuestTrackUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return url
          })
          saveGuestRecording(finalBlob, takeRecordKey).catch(() => {})
          const nextTake: GuestTakeMeta = {
            id: takeId,
            title: `Take ${new Date(takeCreatedAt).toLocaleTimeString(uiLang === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit" })}`,
            createdAt: takeCreatedAt,
            sourceKey: takeRecordKey,
            referenceTrackIndex: takeReferenceIndex,
            deviceProfileId: activeDeviceProfileId,
            offsetSec: guestSyncOffsetRef.current,
            score: null,
            syncQuality: "unknown",
          }
          setGuestTakes((prev) => [nextTake, ...prev].slice(0, GUEST_TAKES_MAX))
          setActiveGuestTakeId(takeId)
          if (localMasterEnabled && recordingV2OpfsStatsRef.current.bytes > 0) {
            const snapshot = recordingCapabilitySnapshotRef.current
            const uploadMeta = {
              takeId,
              sampleRate: snapshot?.inputSampleRate ?? 48_000,
              channels: snapshot?.inputChannelCount ?? 1,
              codec: "pcm_f32le" as const,
            }
            setRecordingV2UploadState("uploading")
            void (async () => {
              try {
                await uploadRecordingV2TakeFromOpfs(uploadMeta)
                setRecordingV2UploadState("uploaded")
              } catch {
                enqueueRecordingV2Upload(uploadMeta)
                setRecordingV2UploadState("queued")
              }
            })()
          }
          setRecording(false)
          setCountInBeat(null)
          const autoAligned = await calibrateGuestDelay({ silent: true, keepPosition: true, guestUrlOverride: url })
          const syncedScore = guestCalibrateScoreRef.current
          const syncedQuality = guestSyncQualityRef.current
          setGuestTakes((prev) =>
            prev.map((take) =>
              take.id === takeId
                ? {
                    ...take,
                    offsetSec: guestSyncOffsetRef.current,
                    score: syncedScore,
                    syncQuality: syncedQuality,
                    durationSec: guestDuration || undefined,
                  }
                : take
            )
          )
          if (!autoAligned) {
            setRecordError(t.recordSyncAutoCheckFailed)
          } else if (guestSyncQualityRef.current === "low") {
            setGuestLowConfidenceRuns((prev) => prev + 1)
            setRecordError(t.recordSyncUnstable)
          }
        })()
      }

      pause()
      seekTo(0)
      const guestAudio = guestAudioRef.current
      if (guestAudio) {
        guestAudio.pause()
        guestAudio.currentTime = 0
        setGuestCurrentTime(0)
      }

      let beat = COUNT_IN_BEATS
      setCountInBeat(beat)
      playCountInClick(false).catch(() => {})
      const beatMs = Math.round((60 / COUNT_IN_BPM) * 1000)

      countInTimerRef.current = window.setInterval(() => {
        beat -= 1
        if (beat <= 0) {
          if (countInTimerRef.current != null) {
            window.clearInterval(countInTimerRef.current)
            countInTimerRef.current = null
          }
          setCountInBeat(null)
          if (recorderRef.current !== recorder || recorder.state !== "inactive") {
            recordArmingRef.current = false
            setRecordError(t.recordAlreadyRunning)
            return
          }
          recorder.onstart = () => {
            setRecording(true)
            recordArmingRef.current = false
            const startSnapshot = buildCurrentRecorderSnapshot({
              stream: recordStreamRef.current,
              mimeType: recorder.mimeType || mimeType,
            })
            setRecordingCapabilitySnapshot(startSnapshot)
            flushRecorderCapabilityTelemetry("start", startSnapshot)
            play()
          }
          try {
            if (localMasterEnabled) recorder.start(1000)
            else recorder.start()
          } catch {
            recordArmingRef.current = false
            setRecording(false)
            setRecordError(t.recordStartFailed)
          }
          return
        }
        setCountInBeat(beat)
        playCountInClick(beat === 1).catch(() => {})
      }, beatMs)
    } catch {
      recordArmingRef.current = false
      teardownRecordingV2Tap()
      setRecordingV2OpfsActive(false)
      void closeRecordingV2OpfsWriter()
      setRecordError(t.recordMicPermissionDenied)
      setRecording(false)
      setCountInBeat(null)
    }
  }

  const stopGuestRecording = () => {
    recordArmingRef.current = false
    guestTransportLinkedRef.current = false
    guestCalibratingRef.current = false
    setGuestCalibrating(false)
    clearGuestCalibrateTimer()
    setCalibrationMute(false)
    if (countInTimerRef.current != null) {
      window.clearInterval(countInTimerRef.current)
      countInTimerRef.current = null
      setCountInBeat(null)
    }
    teardownRecordingV2Tap()
    setRecordingV2OpfsActive(false)
    void closeRecordingV2OpfsWriter()
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop()
    }
    setRecording(false)
    guestStartupBiasSecRef.current = 0
    pause()
  }

  const activateGuestTake = async (takeId: string) => {
    const take = guestTakes.find((item) => item.id === takeId)
    if (!take) return
    const blob = await loadGuestRecordingByKey(take.sourceKey)
    if (!blob) {
      setRecordError(t.recordTakeLoadFailed)
      return
    }
    const url = URL.createObjectURL(blob)
    setGuestTrackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
    setActiveGuestTakeId(take.id)
    setRecordReferenceIndex(take.referenceTrackIndex)
    setGuestCalibrateReady(false)
    setGuestCalibrateScore(take.score ?? null)
    setGuestSyncQuality(take.syncQuality ?? "unknown")
    setGuestSyncOffsetSec(typeof take.offsetSec === "number" ? clamp(take.offsetSec, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC) : guestSyncOffsetRef.current)
    guestNeedsRecalibrateRef.current = true
    if (isPlayingRef.current || guestIsPlaying) {
      pause()
      guestTransportLinkedRef.current = false
    }
  }

  const runGuestActionLocked = useCallback(async (action: () => Promise<void>) => {
    if (guestActionBusyRef.current) return false
    guestActionBusyRef.current = true
    setGuestActionBusy(true)
    try {
      await action()
      return true
    } finally {
      guestActionBusyRef.current = false
      setGuestActionBusy(false)
    }
  }, [])

  const playGuestOnly = async () => {
    await runGuestActionLocked(async () => {
      const audio = guestAudioRef.current
      if (!audio) return
      setRecordError(null)
      setGuestCalibrateReady(false)
      guestTransportLinkedRef.current = false
      guestStartupBiasSecRef.current = 0
      setGuestSoloMode(true)
      forceStopMainTransport()
      // Hard mute main bus immediately to avoid any residual solo bleed into guest-only monitoring.
      rampGainTo(masterGainRef.current, 0, 0.015)
      const graphReady = await ensureGuestPlaybackGraph()
      audio.muted = guestMuted
      audio.volume = graphReady ? 0 : (guestMuted ? 0 : Math.min(1, guestVolume))
      try {
        await audio.play()
        setGuestIsPlaying(true)
      } catch {
        setRecordError(t.guestPlaybackFailed)
      }
    })
  }

  const playGuestWithTrack = async () => {
    await runGuestActionLocked(async () => {
      if (!guestAudioRef.current) return
      if (selectedSoloTrackIndex < 0) {
        setRecordError(t.guestTrackModeRequireSolo)
        return
      }
      if (referenceLockEnabled) {
        const locked = recordReferenceIndexRef.current
        if (locked != null && selectedSoloTrackIndex !== locked) {
          setRecordError(t.referenceLockRequireSoloBeforeStart)
          return
        }
        if (locked == null) setRecordReferenceIndex(selectedSoloTrackIndex)
      }
      setRecordError(null)
      setGuestSoloMode(false)
      await primeGuestAudioAutoplay()
      guestTransportLinkedRef.current = true
      guestStartupBiasSecRef.current = GUEST_STARTUP_BIAS_SEC
      guestStartupBiasStartedAtRef.current = Date.now()
      const audio = guestAudioRef.current
      if (audio) {
        const graphReady = await ensureGuestPlaybackGraph()
        audio.muted = guestMuted
        audio.volume = graphReady ? 0 : (guestMuted ? 0 : Math.min(1, guestVolume))
      }
      const startPos = guestTogetherFirstStartRef.current
        ? 0
        : clamp(positionSecRef.current, 0, duration || positionSecRef.current)
      guestTogetherFirstStartRef.current = false
      seekTo(startPos)

      await play()
    })
  }

  const calibrateGuestDelay = async (options?: { silent?: boolean; keepPosition?: boolean; guestUrlOverride?: string }) => {
    const silent = options?.silent ?? false
    const keepPosition = options?.keepPosition ?? false
    const calibrateGuestUrl = options?.guestUrlOverride || guestTrackUrlRef.current || guestTrackUrl
    const audio = guestAudioRef.current
    if (!audio) return
    if (guestCalibratingRef.current) return
    if (selectedSoloTrackIndex < 0) {
      if (!silent) setRecordError(t.calibrateRequireSolo)
      return
    }
    if (!calibrateGuestUrl) {
      if (!silent) setRecordError(t.calibrateRequireTake)
      return
    }
    const ctx = ctxRef.current
    if (!ctx) {
      if (!silent) setRecordError(t.audioEngineNotReady)
      return
    }

    if (!silent) setRecordError(null)
    guestStartupBiasSecRef.current = 0
    guestCalibratingRef.current = true
    setGuestCalibrating(true)
    if (!silent) setGuestCalibrateReady(false)
    setGuestCalibrateScore(null)
    setGuestSyncQuality("unknown")
    setGuestSyncRuns((prev) => prev + 1)
    clearGuestCalibrateTimer()
    const originalPos = positionSecRef.current

    try {
      const [mainRes, guestRes] = await Promise.all([
        fetch(trackList[selectedSoloTrackIndex].src),
        fetch(calibrateGuestUrl),
      ])
      if (!mainRes.ok || !guestRes.ok) throw new Error("fetch")

      const [mainArr, guestArr] = await Promise.all([mainRes.arrayBuffer(), guestRes.arrayBuffer()])
      const [mainBuf, guestBuf] = await Promise.all([
        ctx.decodeAudioData(mainArr.slice(0)),
        ctx.decodeAudioData(guestArr.slice(0)),
      ])

      const attempts = [
        { binSec: 0.02, secWindow: 60, minScore: 0.18 },
        { binSec: 0.03, secWindow: 120, minScore: 0.12 },
      ] as const
      let best: { lagBins: number; score: number; binSec: number; minScore: number } | null = null
      const baseOffsetSecRaw = Number.isFinite(guestSyncOffsetRef.current) ? guestSyncOffsetRef.current : DEFAULT_GUEST_SYNC_SEC
      const baseOffsetSec = Math.abs(baseOffsetSecRaw) > 0.9 ? DEFAULT_GUEST_SYNC_SEC : baseOffsetSecRaw
      const preferredLagBinsByAttempt = attempts.map((a) => Math.round(baseOffsetSec / a.binSec))

      for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
        const attempt = attempts[attemptIndex]
        const mainEnv = buildRmsEnvelopeByTime(mainBuf, attempt.binSec, attempt.secWindow)
        const guestEnv = buildRmsEnvelopeByTime(guestBuf, attempt.binSec, attempt.secWindow)
        const maxLagBins = Math.round(Math.min(GUEST_CALIBRATE_MAX_ABS_SEC, Math.abs(baseOffsetSec) + GUEST_CALIBRATE_SEARCH_SWING_SEC) / attempt.binSec)
        const { lagBins, score } = estimateOffsetByCorrelation(mainEnv, guestEnv, maxLagBins, preferredLagBinsByAttempt[attemptIndex] ?? 0)
        if (!Number.isFinite(score)) continue
        if (!best || score > best.score) {
          best = { lagBins, score, binSec: attempt.binSec, minScore: attempt.minScore }
        }
      }

      if (!best || best.score < best.minScore) {
        throw new Error("low-correlation")
      }

      // Fine pass around coarse estimate for sub-20ms stability.
      let finalLagBins = best.lagBins
      let finalBinSec = best.binSec
      let finalScore = best.score
      try {
        const fineMainEnv = buildRmsEnvelopeByTime(mainBuf, GUEST_CALIBRATE_FINE_BIN_SEC, 90)
        const fineGuestEnv = buildRmsEnvelopeByTime(guestBuf, GUEST_CALIBRATE_FINE_BIN_SEC, 90)
        const coarseSec = best.lagBins * best.binSec
        const fineCenterLag = Math.round(coarseSec / GUEST_CALIBRATE_FINE_BIN_SEC)
        const fineWindowLag = Math.max(1, Math.round(GUEST_CALIBRATE_FINE_WINDOW_SEC / GUEST_CALIBRATE_FINE_BIN_SEC))
        const fineResult = estimateOffsetByCorrelationInRange(
          fineMainEnv,
          fineGuestEnv,
          fineCenterLag - fineWindowLag,
          fineCenterLag + fineWindowLag,
          fineCenterLag
        )
        if (Number.isFinite(fineResult.score) && fineResult.score >= best.minScore - 0.02) {
          finalLagBins = fineResult.lagBins
          finalBinSec = GUEST_CALIBRATE_FINE_BIN_SEC
          finalScore = fineResult.score
        }
      } catch {}

      const offsetSec = clamp(finalLagBins * finalBinSec, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC)
      if (Math.abs(offsetSec - baseOffsetSec) > GUEST_CALIBRATE_MAX_JUMP_SEC) {
        throw new Error("implausible-jump")
      }
      if (Math.abs(offsetSec) > 1.6) {
        throw new Error("implausible-offset")
      }
      setGuestSyncOffsetSec(offsetSec)
      setGuestCalibrateReady(true)
      const roundedScore = Number(finalScore.toFixed(3))
      setGuestCalibrateScore(roundedScore)
      const quality = classifyGuestSyncQuality(finalScore)
      setGuestSyncQuality(quality)
      if (quality === "low") setGuestLowConfidenceRuns((prev) => prev + 1)
      guestNeedsRecalibrateRef.current = false
      if (keepPosition) {
        syncGuestToMain(originalPos, true)
      } else {
        seekTo(0)
        syncGuestToMain(0, true)
      }
      return true
    } catch {
      if (!silent) {
        setRecordError(t.calibrateMeasureFailed)
      }
      setGuestCalibrateReady(false)
      setGuestCalibrateScore(null)
      setGuestSyncQuality("unknown")
      return false
    } finally {
      guestCalibratingRef.current = false
      setGuestCalibrating(false)
    }
  }

  const resetGuestAndMainToStart = () => {
    pause()
    pauseGuestSolo()
    guestTransportLinkedRef.current = false
    guestTogetherFirstStartRef.current = false
    seekTo(0)
    const audio = guestAudioRef.current
    if (audio) {
      audio.currentTime = 0
      setGuestCurrentTime(0)
    }
  }

  const downloadByUrl = (url: string, filename: string) => {
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const encodeBufferToCompressedBlob = async (buffer: AudioBuffer, format: Exclude<ExportFormat, "wav">): Promise<Blob> => {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder unavailable")
    }
    const mimeType = mimeByExportFormat(format)
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      throw new Error(`format ${format} unsupported`)
    }
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) throw new Error("AudioContext unavailable")

    const ctx = new AudioContextCtor()
    try {
      const dest = ctx.createMediaStreamDestination()
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(dest)

      const chunks: BlobPart[] = []
      const rec = new MediaRecorder(dest.stream, { mimeType })
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      const done = new Promise<Blob>((resolve, reject) => {
        rec.onerror = () => reject(new Error("MediaRecorder error"))
        rec.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
      })

      await ctx.resume()
      rec.start()
      source.start()
      source.onended = () => {
        try {
          if (rec.state !== "inactive") rec.stop()
        } catch {}
      }
      return await done
    } finally {
      void ctx.close()
    }
  }

  const decodeAudioFromUrl = async (url: string): Promise<AudioBuffer> => {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) throw new Error("AudioContext unavailable")
    const ctx = new AudioContextCtor()
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error("fetch")
      const arr = await res.arrayBuffer()
      return await ctx.decodeAudioData(arr.slice(0))
    } finally {
      void ctx.close()
    }
  }

  const exportAudioBuffer = async (buffer: AudioBuffer, format: ExportFormat): Promise<Blob> => {
    if (format === "wav") {
      const left = buffer.getChannelData(0)
      const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)
      return encodeStereoWav(left, right, buffer.sampleRate)
    }
    return encodeBufferToCompressedBlob(buffer, format)
  }

  const exportAudioBufferWithFallback = async (
    buffer: AudioBuffer,
    preferredFormat: ExportFormat
  ): Promise<{ blob: Blob; formatUsed: ExportFormat; usedFallback: boolean }> => {
    try {
      const blob = await exportAudioBuffer(buffer, preferredFormat)
      return { blob, formatUsed: preferredFormat, usedFallback: false }
    } catch {
      if (preferredFormat === "wav") throw new Error("WAV_EXPORT_FAILED")
      const wavBlob = await exportAudioBuffer(buffer, "wav")
      return { blob: wavBlob, formatUsed: "wav", usedFallback: true }
    }
  }

  const downloadGuestSolo = async (format: ExportFormat) => {
    if (!guestTrackUrl) {
      setRecordError(t.exportRequireTake)
      return
    }
    if (guestExportingDuet) return
    setGuestDownloadMenuOpen(false)
    setGuestDuetMixOpen(false)
    setGuestExportingDuet(true)
    setRecordError(null)
    try {
      const guestBuf = await decodeAudioFromUrl(guestTrackUrl)
      const exported = await exportAudioBufferWithFallback(guestBuf, format)
      const blob = exported.blob
      const url = URL.createObjectURL(blob)
      downloadByUrl(url, `russian-raspev-guest-solo.${exported.formatUsed}`)
      if (exported.usedFallback) {
        setRecordError(t.exportFallbackWav)
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch {
      if (format === "mp3") setRecordError(t.exportMp3Unavailable)
      else if (format === "m4a") setRecordError(t.exportM4aUnavailable)
      else setRecordError(t.exportSoloFailed)
    } finally {
      setGuestExportingDuet(false)
    }
  }

  const downloadGuestDuet = async () => {
    if (!guestTrackUrl) {
      setRecordError(t.exportRequireTake)
      return
    }
    if (selectedSoloTrackIndex < 0) {
      setRecordError(t.exportDuetRequireSolo)
      return
    }
    const ctx = ctxRef.current
    if (!ctx) {
      setRecordError(t.audioEngineNotReady)
      return
    }
    const OfflineContextCtor =
      window.OfflineAudioContext ||
      (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    if (!OfflineContextCtor) {
      setRecordError(t.exportDuetUnsupported)
      return
    }

    setGuestDownloadMenuOpen(false)
    setGuestDuetMixOpen(false)
    setGuestExportingDuet(true)
    setRecordError(null)
    try {
      pause()
      setGuestSoloMode(false)
      guestTransportLinkedRef.current = false

      // Triple calibration before duet export for maximum sync precision.
      for (let i = 0; i < 3; i++) {
        const ok = await calibrateGuestDelay({ silent: true, keepPosition: true })
        if (!ok) {
          setRecordError(t.exportDuetCalibrateFailed)
          return
        }
      }

      const [mainRes, guestRes] = await Promise.all([
        fetch(trackList[selectedSoloTrackIndex].src),
        fetch(guestTrackUrl),
      ])
      if (!mainRes.ok || !guestRes.ok) {
        setRecordError(t.exportDuetTrackLoadFailed)
        return
      }
      const [mainArr, guestArr] = await Promise.all([mainRes.arrayBuffer(), guestRes.arrayBuffer()])
      const [mainBuf, guestBuf] = await Promise.all([
        ctx.decodeAudioData(mainArr.slice(0)),
        ctx.decodeAudioData(guestArr.slice(0)),
      ])

      const duetLenSec = Math.max(0.1, guestBuf.duration)
      const sampleRate = Math.max(44100, mainBuf.sampleRate, guestBuf.sampleRate)
      const totalFrames = Math.max(1, Math.ceil(duetLenSec * sampleRate))
      const offline = new OfflineContextCtor(2, totalFrames, sampleRate)

      const master = offline.createGain()
      master.gain.value = 1
      master.connect(offline.destination)

      const offsetSec = guestSyncOffsetRef.current
      const mainSrc = offline.createBufferSource()
      mainSrc.buffer = mainBuf
      const mainGain = offline.createGain()
      mainGain.gain.value = clamp(duetSoloLevel / 100, 0, 1.5)
      mainSrc.connect(mainGain)
      mainGain.connect(master)
      {
        const mainPlayableSec = Math.min(duetLenSec, Math.max(0, mainBuf.duration))
        if (mainPlayableSec > 0.01) {
          mainSrc.start(0, 0, mainPlayableSec)
        }
      }

      // Keep duet export alignment identical to live playback:
      // guestTimelineTime = mainTimelineTime + offsetSec.
      const guestSrc = offline.createBufferSource()
      guestSrc.buffer = guestBuf
      const guestGain = offline.createGain()
      guestGain.gain.value = clamp(duetGuestLevel / 100, 0, 1.5)
      guestSrc.connect(guestGain)
      guestGain.connect(master)

      if (offsetSec >= 0) {
        const guestStartInSource = offsetSec
        const guestPlayableSec = Math.min(duetLenSec, Math.max(0, guestBuf.duration - guestStartInSource))
        if (guestPlayableSec > 0.01) {
          guestSrc.start(0, guestStartInSource, guestPlayableSec)
        }
      } else {
        const guestStartInOutput = -offsetSec
        const guestPlayableSec = Math.min(Math.max(0, duetLenSec - guestStartInOutput), guestBuf.duration)
        if (guestPlayableSec > 0.01) {
          guestSrc.start(guestStartInOutput, 0, guestPlayableSec)
        }
      }

      const rendered = await offline.startRendering()
      const exported = await exportAudioBufferWithFallback(rendered, duetFormat)
      const blob = exported.blob
      const duetUrl = URL.createObjectURL(blob)
      downloadByUrl(duetUrl, `russian-raspev-guest-duet.${exported.formatUsed}`)
      if (exported.usedFallback) {
        setRecordError(t.exportDuetFallbackWav)
      }
      window.setTimeout(() => URL.revokeObjectURL(duetUrl), 1500)
    } catch {
      if (duetFormat === "mp3") setRecordError(t.exportMp3Unavailable)
      else if (duetFormat === "m4a") setRecordError(t.exportM4aUnavailable)
      else setRecordError(t.exportDuetFailed)
    } finally {
      setGuestExportingDuet(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const buildGuestWave = async () => {
      if (!guestTrackUrl || !ctxRef.current) {
        guestPeaksRef.current = null
        setGuestWaveReady(false)
        setGuestCurrentTime(0)
        setGuestDuration(0)
        return
      }

      const res = await fetch(guestTrackUrl)
      const arr = await res.arrayBuffer()
      const buffer = await ctxRef.current.decodeAudioData(arr.slice(0))
      if (cancelled) return
      guestPeaksRef.current = computePeaks(buffer, 1200)
      setGuestDuration(buffer.duration)
      setGuestWaveReady(true)
      setGuestCurrentTime(0)
    }

    buildGuestWave().catch(() => {
      guestPeaksRef.current = makeFlatPeaks(1200)
      setGuestWaveReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [guestTrackUrl])

  useEffect(() => {
    if (!guestWaveReady || !guestDuration) return
    const canvas = guestCanvasRef.current
    const peaks = guestPeaksRef.current
    if (!canvas || !peaks) return
    drawWaveform(canvas, peaks, clamp(guestCurrentTime / guestDuration, 0, 1))
  }, [guestWaveReady, guestCurrentTime, guestDuration])

  const guestSeekTo = (sec: number) => {
    const audio = guestAudioRef.current
    if (!audio || !guestDuration) return

    // Manual guest scrub should stop current playback; next Play will recalibrate/relink.
    if (isPlayingRef.current || guestIsPlaying) {
      pause()
      setGuestSoloMode(false)
      guestTransportLinkedRef.current = false
    }

    const pos = clamp(sec, 0, guestDuration)
    audio.currentTime = pos
    setGuestCurrentTime(pos)
    guestNeedsRecalibrateRef.current = true

    // Allow selecting joint playback position directly on guest waveform.
    const mappedMainPos = clamp(
      pos - (guestSyncOffsetRef.current + getStartupBiasSec()),
      0,
      duration || pos
    )
    if (guestTransportLinkedRef.current || !isPlayingRef.current) {
      seekTo(mappedMainPos)
    }
  }

  const guestScrubFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!guestDuration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const p = clamp(x / rect.width, 0, 1)
    guestSeekTo(p * guestDuration)
  }

  const onGuestWavePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
    guestScrubRef.current = true
    guestScrubFromEvent(e)
  }

  const onGuestWavePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!guestScrubRef.current) return
    guestScrubFromEvent(e)
  }

  const onGuestWavePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    guestScrubRef.current = false
    try {
      ;(e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  const effectiveTeleprompterLines = useMemo(() => {
    if (!teleprompterLines.length) return []
    return teleprompterLines.map((line, index) => ({
      ...line,
      time: teleprompterAnchors[index] ?? line.time,
      text: Object.prototype.hasOwnProperty.call(teleprompterTextOverrides, index)
        ? teleprompterTextOverrides[index]
        : line.text,
    }))
  }, [teleprompterAnchors, teleprompterLines, teleprompterTextOverrides])
  const effectiveTeleprompterSignature = useMemo(
    () => buildTeleprompterLinesSignature(effectiveTeleprompterLines),
    [effectiveTeleprompterLines]
  )

  const persistTeleprompterJson = useCallback((storageKey: string | null, value: unknown) => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {}
  }, [])

  const flushTeleprompterDraftNow = useCallback(() => {
    const lines = teleprompterLinesRef.current
    const anchors = teleprompterAnchorsRef.current
    const textOverrides = teleprompterTextOverridesRef.current
    const savedAt = new Date().toISOString()
    persistTeleprompterJson(teleprompterLinesStorageKey, lines)
    persistTeleprompterJson(teleprompterAnchorStorageKey, anchors)
    persistTeleprompterJson(teleprompterTextStorageKey, textOverrides)
    persistTeleprompterJson(teleprompterStateStorageKey, {
      savedAt,
      lines,
      anchors,
      textOverrides,
    } satisfies TeleprompterDraftState)
    teleprompterDraftDirtyRef.current = false
    setTeleprompterDraftDirty(false)
    setTeleprompterDraftSavedAt(savedAt)
  }, [
    persistTeleprompterJson,
    teleprompterAnchorStorageKey,
    teleprompterLinesStorageKey,
    teleprompterStateStorageKey,
    teleprompterTextStorageKey,
  ])

  useEffect(() => {
    if (teleprompterSkipDirtyMarkRef.current) {
      teleprompterSkipDirtyMarkRef.current = false
      return
    }
    teleprompterDraftDirtyRef.current = true
    setTeleprompterDraftDirty(true)
  }, [teleprompterAnchors, teleprompterLines, teleprompterTextOverrides])

  useEffect(() => {
    if (!teleprompterDraftDirty) return
    const timer = window.setTimeout(() => {
      flushTeleprompterDraftNow()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [flushTeleprompterDraftNow, teleprompterDraftDirty])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!teleprompterDraftDirtyRef.current) return
      flushTeleprompterDraftNow()
    }, 1200)
    return () => window.clearInterval(timer)
  }, [flushTeleprompterDraftNow])

  useEffect(() => {
    const flush = () => flushTeleprompterDraftNow()
    const flushOnHidden = () => {
      if (document.visibilityState === "hidden") flushTeleprompterDraftNow()
    }
    window.addEventListener("pagehide", flush)
    window.addEventListener("beforeunload", flush)
    document.addEventListener("visibilitychange", flushOnHidden)
    return () => {
      window.removeEventListener("pagehide", flush)
      window.removeEventListener("beforeunload", flush)
      document.removeEventListener("visibilitychange", flushOnHidden)
    }
  }, [flushTeleprompterDraftNow])

  const setTeleprompterAnchorAtCurrentTime = useCallback(
    (lineIndex: number) => {
      if (lineIndex < 0 || lineIndex >= effectiveTeleprompterLines.length) return
      const rawTime = Math.max(0, Number(currentTime.toFixed(3)))
      setTeleprompterAnchors((prevMap) => {
        const nextMap = { ...prevMap, [lineIndex]: rawTime }
        teleprompterAnchorsRef.current = nextMap
        persistTeleprompterJson(teleprompterAnchorStorageKey, nextMap)
        return nextMap
      })
    },
    [currentTime, effectiveTeleprompterLines, persistTeleprompterJson, teleprompterAnchorStorageKey]
  )

  const clearTeleprompterAnchor = useCallback((lineIndex: number) => {
    setTeleprompterAnchors((prevMap) => {
      if (!(lineIndex in prevMap)) return prevMap
      const nextMap = { ...prevMap }
      delete nextMap[lineIndex]
      teleprompterAnchorsRef.current = nextMap
      persistTeleprompterJson(teleprompterAnchorStorageKey, nextMap)
      return nextMap
    })
  }, [persistTeleprompterJson, teleprompterAnchorStorageKey])

  const setTeleprompterTextOverride = useCallback((lineIndex: number, text: string) => {
    setTeleprompterTextOverrides((prevMap) => {
      const nextMap = { ...prevMap, [lineIndex]: text }
      teleprompterTextOverridesRef.current = nextMap
      persistTeleprompterJson(teleprompterTextStorageKey, nextMap)
      return nextMap
    })
  }, [persistTeleprompterJson, teleprompterTextStorageKey])

  const clearTeleprompterTextOverride = useCallback((lineIndex: number) => {
    setTeleprompterTextOverrides((prevMap) => {
      if (!(lineIndex in prevMap)) return prevMap
      const nextMap = { ...prevMap }
      delete nextMap[lineIndex]
      teleprompterTextOverridesRef.current = nextMap
      persistTeleprompterJson(teleprompterTextStorageKey, nextMap)
      return nextMap
    })
  }, [persistTeleprompterJson, teleprompterTextStorageKey])

  const resetTeleprompterAnchors = useCallback(() => {
    teleprompterAnchorsRef.current = {}
    persistTeleprompterJson(teleprompterAnchorStorageKey, {})
    setTeleprompterAnchors({})
  }, [persistTeleprompterJson, teleprompterAnchorStorageKey])

  const resetTeleprompterTextOverrides = useCallback(() => {
    teleprompterTextOverridesRef.current = {}
    persistTeleprompterJson(teleprompterTextStorageKey, {})
    setTeleprompterTextOverrides({})
  }, [persistTeleprompterJson, teleprompterTextStorageKey])

  const copyTeleprompterAnchorsJson = useCallback(async () => {
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    const payload = {
      sourceUrl: effectiveTeleprompterSourceUrl,
      generatedAt: new Date().toISOString(),
      anchors: effectiveTeleprompterLines.map((line, index) => ({
        index,
        time: Number(line.time.toFixed(3)),
        text: line.text,
        anchored: Object.prototype.hasOwnProperty.call(teleprompterAnchors, index),
      })),
    }
    const text = JSON.stringify(payload, null, 2)
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.left = "-9999px"
    document.body.appendChild(ta)
    ta.select()
    document.execCommand("copy")
    document.body.removeChild(ta)
  }, [effectiveTeleprompterLines, teleprompterAnchors, effectiveTeleprompterSourceUrl])

  const downloadTeleprompterAnchorsJson = useCallback(() => {
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    const payload = {
      sourceUrl: effectiveTeleprompterSourceUrl,
      generatedAt: new Date().toISOString(),
      anchors: effectiveTeleprompterLines.map((line, index) => ({
        index,
        time: Number(line.time.toFixed(3)),
        text: line.text,
        anchored: Object.prototype.hasOwnProperty.call(teleprompterAnchors, index),
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "teleprompter-anchors.json"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [effectiveTeleprompterLines, teleprompterAnchors, effectiveTeleprompterSourceUrl])

  const downloadTeleprompterBackupJson = useCallback(() => {
    const now = new Date()
    const generatedAt = now.toISOString()
    const pad2 = (n: number) => String(n).padStart(2, "0")
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
    const payload = {
      backup_version: "v1",
      generated_at: generatedAt,
      song_scope: trackScopeId,
      source_url: effectiveTeleprompterSourceUrl ?? null,
      storage_keys: {
        state: teleprompterStateStorageKey,
        lines: teleprompterLinesStorageKey,
        anchors: teleprompterAnchorStorageKey,
        text_overrides: teleprompterTextStorageKey,
      },
      draft_saved_at: teleprompterDraftSavedAt || null,
      lines_raw: teleprompterLines,
      anchors: teleprompterAnchors,
      text_overrides: teleprompterTextOverrides,
      lines_effective: effectiveTeleprompterLines,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `teleprompter-backup-${trackScopeId.slice(0, 56)}-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [
    effectiveTeleprompterLines,
    effectiveTeleprompterSourceUrl,
    teleprompterAnchorStorageKey,
    teleprompterAnchors,
    teleprompterDraftSavedAt,
    teleprompterLines,
    teleprompterLinesStorageKey,
    teleprompterStateStorageKey,
    teleprompterTextOverrides,
    teleprompterTextStorageKey,
    trackScopeId,
  ])

  const triggerTeleprompterBackupImport = useCallback(() => {
    setTeleprompterBackupInfo("")
    teleprompterBackupInputRef.current?.click()
  }, [])

  const importTeleprompterBackupJson = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget
      const file = input.files?.[0]
      if (!file) return
      setTeleprompterBackupInfo(t.teleprompterBackupImporting)
      try {
        const raw = await file.text()
        const parsed = JSON.parse(raw) as TeleprompterBackupPayload
        if (!parsed || typeof parsed !== "object") throw new Error("invalid_backup_json")

        const linesInput = parsed.lines_raw ?? parsed.lines ?? parsed.lines_effective ?? []
        const nextLines = normalizeTeleprompterLines(linesInput)
        if (!nextLines.length) throw new Error("backup_has_no_lines")

        const nextAnchors = normalizeTeleprompterAnchors(parsed.anchors ?? {})
        const nextTextOverrides = normalizeTeleprompterTextOverrides(parsed.text_overrides ?? parsed.textOverrides ?? {})
        const savedAt =
          typeof parsed.draft_saved_at === "string" && parsed.draft_saved_at
            ? parsed.draft_saved_at
            : new Date().toISOString()

        teleprompterSkipDirtyMarkRef.current = true
        teleprompterLinesRef.current = nextLines
        teleprompterAnchorsRef.current = nextAnchors
        teleprompterTextOverridesRef.current = nextTextOverrides
        setTeleprompterLines(nextLines)
        setTeleprompterAnchors(nextAnchors)
        setTeleprompterTextOverrides(nextTextOverrides)

        persistTeleprompterJson(teleprompterLinesStorageKey, nextLines)
        persistTeleprompterJson(teleprompterAnchorStorageKey, nextAnchors)
        persistTeleprompterJson(teleprompterTextStorageKey, nextTextOverrides)
        persistTeleprompterJson(teleprompterStateStorageKey, {
          savedAt,
          lines: nextLines,
          anchors: nextAnchors,
          textOverrides: nextTextOverrides,
        } satisfies TeleprompterDraftState)

        teleprompterDraftDirtyRef.current = false
        setTeleprompterDraftDirty(false)
        setTeleprompterDraftSavedAt(savedAt)
        setTeleprompterBackupInfo(`${t.teleprompterBackupImportedPrefix} ${nextLines.length} ${t.teleprompterLinesWord}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : "backup_import_failed"
        setTeleprompterBackupInfo(`${t.teleprompterImportErrorPrefix} ${message}`)
      } finally {
        input.value = ""
      }
    },
    [
      persistTeleprompterJson,
      teleprompterAnchorStorageKey,
      teleprompterLinesStorageKey,
      teleprompterStateStorageKey,
      teleprompterTextStorageKey,
      t,
    ]
  )

  const datasetRows = useMemo(() => {
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    const now = new Date().toISOString()
    return effectiveTeleprompterLines.map((line, index) => {
      const next = effectiveTeleprompterLines[index + 1]
      const sourceLine = teleprompterLines[index]
      const endSec = next ? Number(next.time.toFixed(3)) : duration > line.time ? Number(duration.toFixed(3)) : null
      return {
        dataset_version: "v1",
        exported_at: now,
        song_scope: trackScopeId,
        source_url: effectiveTeleprompterSourceUrl,
        primary_track_name: trackList[0]?.name ?? null,
        primary_track_src: trackList[0]?.src ?? null,
        line_index: index,
        start_sec: Number(line.time.toFixed(3)),
        end_sec: endSec,
        duration_sec: endSec != null ? Number((endSec - line.time).toFixed(3)) : null,
        text_source: sourceLine?.text ?? line.text,
        text_final: line.text,
        is_anchor_manual: Object.prototype.hasOwnProperty.call(teleprompterAnchors, index),
        is_text_edited: Object.prototype.hasOwnProperty.call(teleprompterTextOverrides, index),
      }
    })
  }, [
    duration,
    effectiveTeleprompterLines,
    teleprompterAnchors,
    teleprompterLines,
    effectiveTeleprompterSourceUrl,
    teleprompterTextOverrides,
    trackList,
    trackScopeId,
  ])

  const postTeleprompterDatasetSnapshot = useCallback(
    async (reason: "manual" | "auto") => {
      if (!datasetRows || !datasetRows.length) return
      setTeleprompterCollectState("saving")
      setTeleprompterCollectInfo(t.teleprompterCollectSaving)
      try {
        const snapshotId = `${trackScopeId}-${reason}-${Date.now()}`
        const res = await fetch("/api/dataset/teleprompter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshotId, rows: datasetRows }),
        })
        const data = await res.json()
        if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `http_${res.status}`))
        setTeleprompterCollectState("saved")
        setTeleprompterCollectInfo(`${t.teleprompterCollectSavedPrefix} ${data.rowsWritten} ${t.teleprompterLinesWord}`)
      } catch (e) {
        setTeleprompterCollectState("error")
        setTeleprompterCollectInfo(`${t.teleprompterErrorPrefix} ${e instanceof Error ? e.message : "save_failed"}`)
      }
    },
    [datasetRows, t, trackScopeId]
  )

  useEffect(() => {
    if (!teleprompterAutoCollect) return
    if (!effectiveTeleprompterSourceUrl || !datasetRows?.length) return
    if (!teleprompterAutoCollectPrimedRef.current) {
      teleprompterAutoCollectPrimedRef.current = true
      return
    }
    const timer = window.setTimeout(() => {
      void postTeleprompterDatasetSnapshot("auto")
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [
    datasetRows,
    postTeleprompterDatasetSnapshot,
    teleprompterAnchors,
    teleprompterAutoCollect,
    effectiveTeleprompterSourceUrl,
    teleprompterTextOverrides,
  ])

  const copyTeleprompterDatasetJsonl = useCallback(async () => {
    if (!datasetRows || !datasetRows.length) return
    const rows = datasetRows
    const jsonl = rows.map((r) => JSON.stringify(r)).join("\n")
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(jsonl)
      return
    }
    const ta = document.createElement("textarea")
    ta.value = jsonl
    ta.style.position = "fixed"
    ta.style.left = "-9999px"
    document.body.appendChild(ta)
    ta.select()
    document.execCommand("copy")
    document.body.removeChild(ta)
  }, [datasetRows])

  const downloadTeleprompterDatasetJsonl = useCallback(() => {
    if (!datasetRows || !datasetRows.length) return
    const rows = datasetRows
    const jsonl = rows.map((r) => JSON.stringify(r)).join("\n")
    const blob = new Blob([jsonl], { type: "application/x-ndjson" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "teleprompter-dataset.jsonl"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [datasetRows])

  const openTeleprompterBulkTextEditor = useCallback(() => {
    if (effectiveTeleprompterLines.length > 0) {
      setTeleprompterBulkTextValue(effectiveTeleprompterLines.map((line) => line.text).join("\n"))
    } else {
      setTeleprompterBulkTextValue("")
    }
    setTeleprompterBulkTextInfo("")
    setTeleprompterBulkTextEditOpen(true)
  }, [effectiveTeleprompterLines])

  const applyTeleprompterBulkText = useCallback(() => {
    const rows = teleprompterBulkTextValue.split(/\r?\n/)
    if (!rows.length) return

    if (!effectiveTeleprompterLines.length) {
      const created = rows.map((text, index) => ({
        time: Number((index * 2).toFixed(3)),
        text,
      }))
      teleprompterLinesRef.current = created
      persistTeleprompterJson(teleprompterLinesStorageKey, created)
      setTeleprompterLines(created)
      teleprompterAnchorsRef.current = {}
      persistTeleprompterJson(teleprompterAnchorStorageKey, {})
      setTeleprompterAnchors({})
      teleprompterTextOverridesRef.current = {}
      persistTeleprompterJson(teleprompterTextStorageKey, {})
      setTeleprompterTextOverrides({})
      setTeleprompterBulkTextInfo(`${t.teleprompterBulkCreatedPrefix} ${created.length} ${t.teleprompterLinesWord}`)
      setTeleprompterBulkTextEditOpen(false)
      return
    }

    const maxLines = effectiveTeleprompterLines.length
    const applied = Math.min(rows.length, maxLines)
    const nextOverrides: TeleprompterTextOverrideMap = {}
    for (let i = 0; i < applied; i++) {
      const nextText = rows[i] ?? ""
      const baseText = teleprompterLines[i]?.text ?? effectiveTeleprompterLines[i]?.text ?? ""
      if (nextText !== baseText) nextOverrides[i] = nextText
    }
    teleprompterTextOverridesRef.current = nextOverrides
    persistTeleprompterJson(teleprompterTextStorageKey, nextOverrides)
    setTeleprompterTextOverrides(nextOverrides)
    setTeleprompterBulkTextInfo(`${t.teleprompterBulkAppliedPrefix} ${applied}/${maxLines}`)
    setTeleprompterBulkTextEditOpen(false)
  }, [
    effectiveTeleprompterLines,
    persistTeleprompterJson,
    teleprompterAnchorStorageKey,
    teleprompterBulkTextValue,
    teleprompterLines,
    teleprompterLinesStorageKey,
    teleprompterTextStorageKey,
    t,
  ])

  const saveTeleprompterPreviewJson = useCallback(async (mode: "manual" | "auto" = "manual") => {
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) {
      if (mode === "manual") {
        setTeleprompterPreviewSaveState("error")
        setTeleprompterPreviewSaveInfo(t.teleprompterPreviewPathMissing)
      }
      return
    }
    setTeleprompterPreviewSaveState("saving")
    setTeleprompterPreviewSaveInfo(mode === "auto" ? t.teleprompterPreviewAutosaving : t.teleprompterPreviewSaving)
    try {
      const res = await fetch("/api/teleprompter/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: effectiveTeleprompterSourceUrl,
          lines: effectiveTeleprompterLines.map((line) => ({
            time: Number(line.time.toFixed(3)),
            text: line.text,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `http_${res.status}`))
      setTeleprompterPreviewSaveState("saved")
      setTeleprompterPreviewSaveInfo(
        `${mode === "auto" ? t.teleprompterPreviewAutosavedPrefix : t.teleprompterPreviewSavedPrefix} ${data.linesWritten} ${t.teleprompterLinesWord}`
      )
      teleprompterPreviewKnownSignatureRef.current = effectiveTeleprompterSignature
    } catch (e) {
      setTeleprompterPreviewSaveState("error")
      setTeleprompterPreviewSaveInfo(`${t.teleprompterErrorPrefix} ${e instanceof Error ? e.message : "save_failed"}`)
    }
  }, [effectiveTeleprompterLines, effectiveTeleprompterSignature, effectiveTeleprompterSourceUrl, t])

  useEffect(() => {
    if (!teleprompterPreviewAutoSave) return
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    if (!teleprompterPreviewAutoSavePrimedRef.current) {
      teleprompterPreviewAutoSavePrimedRef.current = true
      teleprompterPreviewKnownSignatureRef.current = effectiveTeleprompterSignature
      return
    }
    if (effectiveTeleprompterSignature === teleprompterPreviewKnownSignatureRef.current) return
    teleprompterPreviewKnownSignatureRef.current = effectiveTeleprompterSignature
    const timer = window.setTimeout(() => {
      void saveTeleprompterPreviewJson("auto")
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [
    effectiveTeleprompterLines.length,
    effectiveTeleprompterSignature,
    effectiveTeleprompterSourceUrl,
    saveTeleprompterPreviewJson,
    teleprompterPreviewAutoSave,
  ])

  const activeTeleprompterIndex = useMemo(() => {
    if (!effectiveTeleprompterLines.length) return -1
    for (let i = effectiveTeleprompterLines.length - 1; i >= 0; i--) {
      if (currentTime + TELEPROMPTER_LEAD_SEC >= effectiveTeleprompterLines[i].time) return i
    }
    return 0
  }, [currentTime, effectiveTeleprompterLines])

  const teleprompterWindow = useMemo(() => {
    if (!effectiveTeleprompterLines.length) return []
    const start = activeTeleprompterIndex >= 0 ? activeTeleprompterIndex : 0
    const end = Math.min(effectiveTeleprompterLines.length, start + 4)
    return effectiveTeleprompterLines.slice(start, end).map((line, i) => ({ line, index: start + i }))
  }, [activeTeleprompterIndex, effectiveTeleprompterLines])

  /** =========================
   *  WAVE SCRUB (drag)
   *  ========================= */
  const isScrubbingRef = useRef(false)

  const scrubFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const p = clamp(x / rect.width, 0, 1)
    const trackIndex = Number((e.currentTarget as HTMLCanvasElement).dataset.trackIndex ?? "-1")

    // In Guest+Track mode, clicking on the active Solo track should stop playback first.
    if (
      guestTransportLinkedRef.current &&
      (isPlayingRef.current || guestIsPlaying) &&
      trackIndex === selectedSoloTrackIndex
    ) {
      pause()
      setGuestSoloMode(false)
      guestTransportLinkedRef.current = false
      guestNeedsRecalibrateRef.current = true
    }

    seekTo(p * duration)
  }

  const onWavePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
    isScrubbingRef.current = true
    scrubFromEvent(e)
  }
  const onWavePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isScrubbingRef.current) return
    scrubFromEvent(e)
  }
  const onWavePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isScrubbingRef.current = false
    try {
      ;(e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  /** =========================
   *  SPEED / PITCH
   *  ========================= */
  const scheduleTempoPitchRealign = () => {
    if (tempoPitchRealignTimerRef.current != null) {
      window.clearTimeout(tempoPitchRealignTimerRef.current)
      tempoPitchRealignTimerRef.current = null
    }
    // Intentionally disabled: forced transport realign introduced audible dropouts.
  }

  const setSpeedUI = (v: number) => {
    if (recording || countInBeat != null || guestTransportLinkedRef.current) {
      setRecordError(t.tempoLocked)
      return
    }
    setSpeed(v)
    tempoRef.current = v
    scheduleTempoPitchSmoothing(v, pitchSemiRef.current)
    scheduleTempoPitchRealign()
  }

  const setPitchUI = (semi: number) => {
    if (recording || countInBeat != null || guestTransportLinkedRef.current) {
      setRecordError(t.pitchLocked)
      return
    }
    setPitchSemi(semi)
    pitchSemiRef.current = semi
    scheduleTempoPitchSmoothing(tempoRef.current, semi)
    scheduleTempoPitchRealign()
  }

  /** =========================
   *  TRACK CONTROLS
   *  ========================= */
  const toggleMute = (i: number) => {
    setMuted((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      applyMuteSoloVolume(next, solo, volUI)
      return next
    })
  }

  const toggleSolo = (i: number) => {
    if (referenceLockEnabled && (recording || countInBeat != null || guestTransportLinkedRef.current)) {
      const lockedIdx = recordReferenceIndexRef.current
      if (lockedIdx != null && i !== lockedIdx) {
        setRecordError(t.referenceLockTrackChangeBlocked)
        return
      }
      if (lockedIdx != null && i === lockedIdx && solo[i]) {
        setRecordError(t.referenceLockSoloRequired)
        return
      }
    }
    setSolo((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      applyMuteSoloVolume(muted, next, volUI)
      if (next.filter(Boolean).length === 1) setRecSoloHint(false)
      return next
    })
  }

  const setPan = (i: number, value: number) => {
    setPanUI((prev) => {
      const next = [...prev]
      next[i] = value
      applyPan(next)
      return next
    })
  }

  const setVol = (i: number, value: number) => {
    setVolUI((prev) => {
      const next = [...prev]
      next[i] = value
      applyMuteSoloVolume(muted, solo, next)
      return next
    })
  }

  const handleMainRecClick = () => {
    if (selectedSoloTrackIndex < 0) {
      setRecSoloHint(true)
      return
    }
    setGuestPanelOpen(true)
    setRecSoloHint(false)

    // During count-in or recording, the same button acts as STOP.
    if (recording || countInBeat != null) {
      stopGuestRecording()
      return
    }

    // Fresh REC click always starts new take from the beginning.
    startGuestRecording().catch(() => {})
  }

  const syncQualityLabel =
    guestSyncQuality === "good"
      ? t.syncGood
      : guestSyncQuality === "ok"
        ? t.syncOk
        : guestSyncQuality === "low"
          ? t.syncLow
          : t.syncUnknown
  const syncQualityClass =
    guestSyncQuality === "good"
      ? "bg-emerald-700/70 text-white"
      : guestSyncQuality === "ok"
        ? "bg-sky-700/70 text-white"
        : guestSyncQuality === "low"
          ? "bg-amber-700/80 text-white"
        : "bg-zinc-800 text-white/70"
  const referenceLockActive = referenceLockEnabled && (recording || countInBeat != null || guestTransportLinkedRef.current)
  const tempoPitchLocked = recording || countInBeat != null || (referenceLockEnabled && guestTransportLinkedRef.current)
  const guestWithTrackUiActive = guestTransportLinkedRef.current && (isPlaying || guestIsPlaying)

  /** =========================
   *  RENDER
   *  ========================= */
  return (
    <div data-testid="multitrack-root" className="relative bg-zinc-950/60 rounded-2xl p-6 md:p-8 space-y-6 text-white shadow-xl border border-white/10">
      {topStatusBanner ? (
        <Link
          href={topStatusBanner.href}
          className="absolute left-6 top-1 z-20 inline-flex max-w-[calc(100%-3rem)] rounded border border-white/15 bg-black/35 px-2 py-0.5 text-[10px] leading-4 text-white/80 hover:bg-black/45 hover:text-white md:left-8 md:max-w-[calc(100%-4rem)]"
        >
          <span className="truncate">{topStatusBanner.text}</span>
        </Link>
      ) : null}
      {!isReady && <div className="text-white/70">{t.loadingAudio}</div>}

      {isReady || (showControlsBeforeReady && isHydrated) ? (
      <>
          {/* MASTER */}
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={goToStart}
                      aria-label={t.goToStartAria}
                      className="btn-round"
                      title={t.goToStartTitle}
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 7 3 12l5 5" />
                        <path d="M4 12h10a5 5 0 1 1 0 10" />
                      </svg>
                    </button>

                    <button
                      onClick={togglePlay}
                      aria-label={isPlaying || mainPlayPending ? t.pauseAria : t.playAria}
                      className="px-5 h-11 bg-white text-black rounded-full font-medium hover:bg-white/90 transition"
                    >
                      {isPlaying || mainPlayPending ? t.pauseButton : t.playButton}
                    </button>

                    <button
                      onClick={() => setLoopOn((v) => !v)}
                      aria-label={t.repeatTrackAria}
                      className={`btn-round ${loopOn ? "btn-round--active" : ""}`}
                      title={t.repeatTrackTitle}
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 7v5h-5" />
                        <path d="M4 17v-5h5" />
                        <path d="M18.5 12A6.5 6.5 0 0 0 7 8" />
                        <path d="M5.5 12A6.5 6.5 0 0 0 17 16" />
                      </svg>
                    </button>

                    <div className="relative">
                      <button
                        onClick={handleMainRecClick}
                        data-testid="master-record-toggle"
                        data-recording={recording || countInBeat != null ? "1" : "0"}
                        aria-label={recording || countInBeat != null ? t.recordGuestStopAria : t.recordGuestStartAria}
                        className={`btn-round ${recording || countInBeat != null ? "bg-red-700 border-red-500/70" : ""}`}
                        title={recording || countInBeat != null ? t.recordGuestStopTitle : t.recordGuestStartTitle}
                      >
                        {recording || countInBeat != null ? (
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                            <rect x="7" y="7" width="10" height="10" rx="1.5" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="7" />
                            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
                          </svg>
                        )}
                      </button>
                      {recSoloHint ? (
                        <div className="absolute left-1/2 top-[calc(100%+8px)] -translate-x-1/2 rounded bg-black/90 px-2 py-1 text-[11px] text-amber-300 whitespace-nowrap">
                          {t.recSoloHint}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-sm text-white/70">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </div>
                </div>

                <input
                  type="range"
                  aria-label={t.trackPositionAria}
                  min={0}
                  max={duration || 0}
                  step="0.005"
                  value={Math.min(currentTime, duration || currentTime)}
                  onChange={(e) => seekTo(Number(e.currentTarget.value))}
                  className="w-full range-thin"
                />

                <div className="grid grid-cols-4 gap-3 items-center max-w-[520px]">
                  <div className="space-y-1">
                    <div className="text-[11px] text-white/60">{t.volume}</div>
                    <input
                      type="range"
                      aria-label={t.masterVolumeAria}
                      min={0}
                      max={1}
                      step="0.01"
                      value={masterVol}
                      onChange={(e) => setMasterVol(Number(e.currentTarget.value))}
                      className="range-thin w-full max-w-[110px]"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-white/60">{t.reverb}</div>
                    <input
                      type="range"
                      aria-label="Reverb"
                      min={0}
                      max={1}
                      step="0.01"
                      value={reverbAmount}
                      onChange={(e) => setReverbAmount(Number(e.currentTarget.value))}
                      className="range-thin w-full max-w-[110px]"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-white/60">{t.speed}</div>
                    <div className="relative max-w-[110px]">
                      <div
                        className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/45"
                        style={{ left: `${clamp(((1 - 0.6) / (1.4 - 0.6)) * 100, 0, 100)}%` }}
                      />
                      <input
                        type="range"
                        aria-label={t.speedAria}
                        min={0.6}
                        max={1.4}
                        step="0.01"
                        value={speed}
                        onChange={(e) => setSpeedUI(Number(e.currentTarget.value))}
                        className={`w-full range-thin ${tempoPitchLocked ? "opacity-60" : ""}`}
                        disabled={tempoPitchLocked}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-white/60">{t.pitch}</div>
                    <div className="relative max-w-[110px]">
                      <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/45" style={{ left: "50%" }} />
                      <input
                        type="range"
                        aria-label="Pitch"
                        min={-12}
                        max={12}
                        step={1}
                        value={pitchSemi}
                        onChange={(e) => setPitchUI(Number(e.currentTarget.value))}
                        className={`w-full range-thin ${tempoPitchLocked ? "opacity-60" : ""}`}
                        disabled={tempoPitchLocked}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                  <button
                    onClick={() => setGuestPanelOpen(true)}
                    data-testid="guest-panel-toggle"
                    className="rounded-sm bg-zinc-800 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700"
                  >
                    {t.guestPanelTitle}
                  </button>
                  <span className={`rounded-sm px-2 py-1 text-[11px] ${guestCalibrating ? "bg-zinc-600 text-white" : guestCalibrateReady ? "bg-emerald-700/70 text-white" : "bg-zinc-800 text-white/70"}`}>
                    {guestCalibrating ? t.calibrating : guestCalibrateReady ? t.delayDetected : t.delayPending}
                  </span>
                  <button
                    onClick={() => {
                      calibrateGuestDelay({ keepPosition: true }).catch(() => {})
                    }}
                    className="rounded-sm bg-zinc-800 px-2 py-1 text-[11px] text-white hover:bg-zinc-700"
                    disabled={guestCalibrating || guestActionBusy}
                  >
                    {t.syncCheck}
                  </button>
                  <span className={`rounded-sm px-2 py-1 text-[11px] ${syncQualityClass}`}>
                    {syncQualityLabel}
                    {guestCalibrateScore != null ? ` (${guestCalibrateScore.toFixed(2)})` : ""}
                  </span>
                  {countInBeat ? <span className="rounded-sm bg-amber-500/90 px-2 py-1 text-xs font-semibold text-black">{t.countInPrefix}: {countInBeat}</span> : null}
                </div>
              </div>

              <div className="relative overflow-visible rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-xs text-white/60">{t.teleprompterTitle}</div>
                {!effectiveTeleprompterSourceUrl && teleprompterWindow.length === 0 && (
                  <div className="text-sm text-white/50">{t.teleprompterEmptyHint}</div>
                )}
                {effectiveTeleprompterSourceUrl && teleprompterWindow.length === 0 && (
                  <div className="text-sm text-white/50">
                    {teleprompterLoadState === "loading" && t.teleprompterLoadLoading}
                    {teleprompterLoadState === "missing" && t.teleprompterLoadMissing}
                    {teleprompterLoadState === "empty" && t.teleprompterLoadEmpty}
                    {teleprompterLoadState === "error" && t.teleprompterLoadError}
                    {(teleprompterLoadState === "idle" || teleprompterLoadState === "ready") && t.teleprompterLoadIdle}
                  </div>
                )}
                {teleprompterWindow.length > 0 && (
                  <div className="space-y-1">
                    {teleprompterWindow.map(({ line, index }) => {
                      const isActive = index === activeTeleprompterIndex
                      return (
                        <button
                          key={`${line.time}-${index}`}
                          onClick={() => seekTo(line.time)}
                          className={`block w-full rounded-sm px-2 py-1 text-left text-sm transition ${
                            isActive ? "bg-[#5f82aa] text-white" : "text-white/75 hover:bg-white/10"
                          }`}
                        >
                          {renderTeleprompterLineText(line.text)}
                        </button>
                      )
                    })}
                  </div>
                )}
                {(
                  <>
                    <button
                      onClick={() => setTeleprompterSettingsOpen((v) => !v)}
                      aria-label={teleprompterSettingsOpen ? t.teleprompterSettingsHide : t.teleprompterSettingsShow}
                      title={teleprompterSettingsOpen ? t.teleprompterSettingsHide : t.teleprompterSettingsShow}
                      className={`absolute bottom-2 -left-9 z-20 flex h-7 w-7 items-center justify-center rounded-full border ${teleprompterSettingsOpen ? "border-[#5f82aa] bg-[#5f82aa] text-white" : "border-white/25 bg-black/45 text-white/80 hover:bg-black/60"}`}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3.2" />
                        <path d="m19 12 .8.4m-15.6 0 .8-.4m13.5 5.8.4-.8m-12.2.8.4-.8m10.1-10.1.8-.4m-11.8.4.8-.4M12 5l.4-.8m-.8 15.6.4-.8" />
                      </svg>
                    </button>
                    {teleprompterSettingsOpen && (
                      <div className="absolute inset-x-2 bottom-10 z-20 space-y-2 rounded-md border border-white/15 bg-zinc-950/95 p-2 shadow-xl">
                        <div className="max-h-[46vh] space-y-2 overflow-auto pr-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => setTeleprompterAnchorEditMode((v) => !v)}
                              className={`rounded-sm px-2 py-1 text-xs ${teleprompterAnchorEditMode ? "bg-[#5f82aa] text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                            >
                              {teleprompterAnchorEditMode ? t.teleprompterMarkupHide : t.teleprompterMarkupShow}
                            </button>
                            <button
                              onClick={() => setTeleprompterTextEditMode((v) => !v)}
                              className={`rounded-sm px-2 py-1 text-xs ${teleprompterTextEditMode ? "bg-[#5f82aa] text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                            >
                              {teleprompterTextEditMode ? t.teleprompterEditorHide : t.teleprompterEditorShow}
                            </button>
                            <button
                              onClick={openTeleprompterBulkTextEditor}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterPasteBulk}
                            </button>
                            {activeTeleprompterIndex >= 0 && (
                              <button
                                onClick={() => setTeleprompterAnchorAtCurrentTime(activeTeleprompterIndex)}
                                className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                              >
                                {t.teleprompterAnchorCurrent}
                              </button>
                            )}
                            <button
                              onClick={() => void copyTeleprompterAnchorsJson()}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterCopyJson}
                            </button>
                            <button
                              onClick={downloadTeleprompterAnchorsJson}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterDownloadJson}
                            </button>
                            <button
                              onClick={downloadTeleprompterBackupJson}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterBackupDownload}
                            </button>
                            <button
                              onClick={triggerTeleprompterBackupImport}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterBackupRestore}
                            </button>
                            <button
                              onClick={() => void copyTeleprompterDatasetJsonl()}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterCopyDatasetJsonl}
                            </button>
                            <button
                              onClick={downloadTeleprompterDatasetJsonl}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterDownloadDatasetJsonl}
                            </button>
                            <button
                              onClick={() => void postTeleprompterDatasetSnapshot("manual")}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterSaveDataset}
                            </button>
                            <button
                              onClick={() => void saveTeleprompterPreviewJson()}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterRewritePreview}
                            </button>
                            <button
                              onClick={() => setTeleprompterPreviewAutoSave((v) => !v)}
                              className={`rounded-sm px-2 py-1 text-xs ${teleprompterPreviewAutoSave ? "bg-[#5f82aa] text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                            >
                              {teleprompterPreviewAutoSave ? t.teleprompterAutoPreviewOn : t.teleprompterAutoPreviewOff}
                            </button>
                            <button
                              onClick={() => setTeleprompterAutoCollect((v) => !v)}
                              className={`rounded-sm px-2 py-1 text-xs ${teleprompterAutoCollect ? "bg-[#5f82aa] text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                            >
                              {teleprompterAutoCollect ? t.teleprompterAutoCollectOn : t.teleprompterAutoCollectOff}
                            </button>
                            <button
                              onClick={resetTeleprompterAnchors}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterResetAnchors}
                            </button>
                            <button
                              onClick={resetTeleprompterTextOverrides}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterResetText}
                            </button>
                            <input
                              ref={teleprompterBackupInputRef}
                              type="file"
                              accept="application/json,.json"
                              className="hidden"
                              onChange={(e) => void importTeleprompterBackupJson(e)}
                            />
                          </div>
                          <div className="text-[11px] text-white/60">
                            {t.teleprompterDatasetStatus}: {teleprompterCollectState}
                            {teleprompterCollectInfo ? ` · ${teleprompterCollectInfo}` : ""}
                          </div>
                          <div className="text-[11px] text-white/60">
                            {t.teleprompterDraftStatus}: {teleprompterDraftDirty ? t.teleprompterDraftDirty : t.teleprompterDraftSaved}
                            {teleprompterDraftSavedAt
                              ? ` · ${new Date(teleprompterDraftSavedAt).toLocaleTimeString(uiLang === "ru" ? "ru-RU" : "en-US")}`
                              : ""}
                          </div>
                          <div className="text-[11px] text-white/60">
                            {t.teleprompterPreviewStatus}: {teleprompterPreviewSaveState}
                            {teleprompterPreviewSaveInfo ? ` · ${teleprompterPreviewSaveInfo}` : ""}
                          </div>
                          {teleprompterBackupInfo ? (
                            <div className="text-[11px] text-white/60">{t.teleprompterBackupStatus}: {teleprompterBackupInfo}</div>
                          ) : null}
                          {teleprompterBulkTextInfo ? (
                            <div className="text-[11px] text-white/60">{teleprompterBulkTextInfo}</div>
                          ) : null}
                          {teleprompterBulkTextEditOpen && (
                            <div className="space-y-2 rounded-sm border border-white/10 bg-black/25 p-2">
                              <div className="text-[11px] text-white/70">
                                {t.teleprompterBulkHint}
                              </div>
                              <textarea
                                value={teleprompterBulkTextValue}
                                onChange={(e) => setTeleprompterBulkTextValue(e.currentTarget.value)}
                                rows={10}
                                className="w-full rounded-sm border border-white/15 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-[#5f82aa]"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={applyTeleprompterBulkText}
                                  className="rounded-sm bg-[#5f82aa] px-2 py-1 text-xs text-white hover:bg-[#4d729f]"
                                >
                                  {t.teleprompterApply}
                                </button>
                                <button
                                  onClick={() => setTeleprompterBulkTextEditOpen(false)}
                                  className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                                >
                                  {t.teleprompterCancel}
                                </button>
                              </div>
                            </div>
                          )}
                          {(teleprompterAnchorEditMode || teleprompterTextEditMode) && (
                            <div className="max-h-56 space-y-1 overflow-auto rounded-sm border border-white/10 bg-black/20 p-1.5">
                              {effectiveTeleprompterLines.map((line, index) => {
                                const isActive = index === activeTeleprompterIndex
                                const isAnchored = Object.prototype.hasOwnProperty.call(teleprompterAnchors, index)
                                const isTextOverridden = Object.prototype.hasOwnProperty.call(teleprompterTextOverrides, index)
                                return (
                                  <div
                                    key={`anchor-${index}-${line.time}`}
                                    className={`rounded-sm px-2 py-1 ${isActive ? "bg-[#5f82aa]/30" : "bg-transparent"}`}
                                  >
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                      <button
                                        onClick={() => seekTo(line.time)}
                                        className="truncate text-left text-xs text-white/85 hover:text-white"
                                        title={line.text}
                                      >
                                        {String(index + 1).padStart(2, "0")} · {formatTime(line.time)} · {line.text}
                                      </button>
                                      <div className="shrink-0 space-x-1">
                                        {teleprompterAnchorEditMode && (
                                          <button
                                            onClick={() => setTeleprompterAnchorAtCurrentTime(index)}
                                            className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/85 hover:bg-white/20"
                                          >
                                            Anchor now
                                          </button>
                                        )}
                                        {teleprompterAnchorEditMode && isAnchored && (
                                          <button
                                            onClick={() => clearTeleprompterAnchor(index)}
                                            className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/85 hover:bg-white/20"
                                          >
                                            Clear
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {teleprompterTextEditMode && (
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="text"
                                          value={line.text}
                                          onChange={(e) => setTeleprompterTextOverride(index, e.currentTarget.value)}
                                          className="w-full rounded-sm border border-white/20 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-white/40"
                                          aria-label={`${t.teleprompterLineAriaPrefix} ${index + 1}`}
                                        />
                                        {isTextOverridden && (
                                          <button
                                            onClick={() => clearTeleprompterTextOverride(index)}
                                            className="shrink-0 rounded bg-white/10 px-1.5 py-1 text-[11px] text-white/85 hover:bg-white/20"
                                          >
                                            Reset
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

          </div>

          {showDetailedSections ? (
          <div className="flex flex-col gap-4">
            <div className={`order-2 rounded-xl border border-white/10 bg-black/25 p-3 space-y-2 ${guestPanelOpen ? "block" : "hidden"}`}>
              {guestPanelOpen ? (
                <div className="space-y-2 pt-1">
                  <div className="rounded-sm border border-white/10 bg-black/20 p-2">
                    <button
                      onClick={() => setRecordChecklistOpen((v) => !v)}
                      data-testid="recording-checklist-toggle"
                      className="text-xs font-medium text-white/85 hover:text-white"
                    >
                      {t.recordChecklist}
                    </button>
                    {recordChecklistOpen ? (
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <label className="flex items-center gap-2 text-xs text-white/80">
                          <input
                            type="checkbox"
                            checked={recordHeadphonesConfirmed}
                            onChange={(e) => setRecordHeadphonesConfirmed(e.currentTarget.checked)}
                            data-testid="record-headphones-checkbox"
                          />
                          <span>{t.headphonesCheck}</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs text-white/80">
                          <input
                            type="checkbox"
                            checked={referenceLockEnabled}
                            onChange={(e) => setReferenceLockEnabled(e.currentTarget.checked)}
                          />
                          <span>{t.referenceLock}</span>
                        </label>
                        <label className="block text-xs text-white/70">
                          <span>{t.selectReference}</span>
                          <select
                            value={recordReferenceIndex ?? ""}
                            onChange={(e) => {
                              const raw = e.currentTarget.value
                              setRecordReferenceIndex(raw === "" ? null : Math.max(0, Number(raw)))
                            }}
                            className="mt-1 w-full rounded-sm border border-white/20 bg-zinc-900/80 px-2 py-1 text-xs text-white outline-none"
                          >
                            <option value="">{t.referenceAutoSolo}</option>
                            {trackList.map((track, idx) => (
                              <option key={track.src} value={idx}>
                                {track.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-white/70">
                          <span>{t.recordingModeLabel}</span>
                          <select
                            value={recordingMode}
                            onChange={(e) => {
                              const raw = e.currentTarget.value
                              setRecordingMode(raw === "local_master" ? "local_master" : "compatibility")
                            }}
                            data-testid="recording-mode-select"
                            className="mt-1 w-full rounded-sm border border-white/20 bg-zinc-900/80 px-2 py-1 text-xs text-white outline-none"
                          >
                            <option value="compatibility">{t.recordingModeCompatibility}</option>
                            <option value="local_master" disabled={!recordingEngineV2Enabled || !localMasterCapable}>
                              {t.recordingModeLocalMaster}
                            </option>
                          </select>
                        </label>
                        <div className="text-[11px] text-white/60">
                          <div>
                            {t.syncRuns}: {guestSyncRuns}
                          </div>
                          <div>
                            {t.lowConfidenceRuns}: {guestLowConfidenceRuns}
                          </div>
                          <div>
                            {t.longTaskCount}: {playerLongTaskCount}
                          </div>
                          <div>
                            {t.longTaskMax}: {playerLongTaskMaxMs} ms
                          </div>
                          <div>
                            {t.progressiveLoadFlag}: {progressiveLoadEnabled ? "on" : "off"}
                          </div>
                          <div>
                            {t.recordingV2Flag}: {recordingEngineV2Enabled ? "on" : "off"}
                          </div>
                          <div>
                            mode: {recordingMode}
                          </div>
                          <div>
                            {t.recordingEngine}: {recordingCapabilitySnapshot?.recordingEngine ?? "—"}
                          </div>
                          <div>
                            {t.recorderDropouts}: {recordDropoutCount}
                          </div>
                          <div>
                            {t.recorderRecoveries}: {recordRecoveryCount}
                          </div>
                          <div>
                            {t.recorderBaseLatency}: {recordingCapabilitySnapshot?.baseLatencyMs ?? "—"}
                          </div>
                          <div>
                            {t.recorderOutputLatency}: {recordingCapabilitySnapshot?.outputLatencyMs ?? "—"}
                          </div>
                          <div>
                            {t.recorderInputLatency}: {recordingCapabilitySnapshot?.inputLatencyMs ?? "—"}
                          </div>
                          <div>
                            {t.recorderInputSettings}:{" "}
                            {recordingCapabilitySnapshot
                              ? `${recordingCapabilitySnapshot.inputSampleRate ?? "?"}Hz/${recordingCapabilitySnapshot.inputChannelCount ?? "?"}ch/${recordingCapabilitySnapshot.inputSampleSize ?? "?"}bit`
                              : "—"}
                          </div>
                          <div>
                            {t.recorderCapabilities}:{" "}
                            {recordingCapabilitySnapshot
                              ? `aw:${recordingCapabilitySnapshot.audioWorkletSupported ? "1" : "0"} opfs:${recordingCapabilitySnapshot.opfsSupported ? "1" : "0"} mr:${recordingCapabilitySnapshot.mediaRecorderSupported ? "1" : "0"}`
                              : "—"}
                          </div>
                          <div>
                            {t.recorderTapActive}: {recordingCapabilitySnapshot?.workletTapActive ? "1" : "0"}
                          </div>
                          <div>
                            {t.recorderTapFrames}: {recordingCapabilitySnapshot?.workletFramesCaptured ?? 0}
                          </div>
                          <div>
                            {t.recorderTapChunks}: {recordingCapabilitySnapshot?.workletChunkReports ?? 0}
                          </div>
                          <div>
                            {t.recorderTapErrors}: {recordingCapabilitySnapshot?.workletTapErrors ?? 0}
                          </div>
                          <div>
                            {t.recorderOpfsActive}: {recordingV2OpfsActive ? "1" : "0"}
                          </div>
                          <div>
                            {t.recorderOpfsBytes}: {recordingV2OpfsBytes}
                          </div>
                          <div>
                            {t.recorderOpfsChunks}: {recordingV2OpfsChunks}
                          </div>
                          <div>
                            {t.recorderOpfsErrors}: {recordingV2OpfsErrors}
                          </div>
                          <div>
                            {t.recorderUploadState}: {recordingV2UploadState}
                          </div>
                          <div>
                            {t.driftSamples}: {guestDriftSampleCount}
                          </div>
                          <div>
                            {t.driftAvg}: {Math.round(guestDriftAvgMs)} ms
                          </div>
                          <div>
                            {t.driftMax}: {guestDriftMaxMs} ms
                          </div>
                          <div>
                            {t.softDriftFixes}: {guestDriftSoftCorrections}
                          </div>
                          <div>
                            {t.hardDriftFixes}: {guestDriftHardCorrections}
                          </div>
                          <div>
                            {t.deviceProfile}: {deviceLatencyProfile ? `${Math.round(deviceLatencyProfile.offsetSec * 1000)} ms | ${deviceLatencyProfile.label}` : "—"}
                          </div>
                          {bluetoothRouteRisk ? <div className="text-amber-300">{t.bluetoothRisk}</div> : null}
                          {referenceLockActive ? <div className="text-amber-300">{t.referenceLockActive}</div> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button onClick={resetGuestAndMainToStart} className="btn-round h-8 w-8" aria-label={t.guestGoToStartAria} title={t.guestGoToStartTitle}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 7 3 12l5 5" />
                        <path d="M4 12h12" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        if (guestWithTrackUiActive) {
                          pause()
                          guestTransportLinkedRef.current = false
                          return
                        }
                        playGuestWithTrack().catch(() => {})
                      }}
                      aria-label={guestWithTrackUiActive ? t.guestWithTrackStop : t.guestWithTrackStart}
                      title={guestWithTrackUiActive ? t.guestWithTrackStop : t.guestWithTrackStart}
                      disabled={guestActionBusy || guestCalibrating}
                      className={`h-8 w-8 rounded-md ${guestWithTrackUiActive ? "bg-green-600" : "bg-zinc-700 hover:bg-zinc-600"} text-white ${guestActionBusy || guestCalibrating ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {guestWithTrackUiActive ? (
                        <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4" fill="currentColor"><rect x="6" y="6" width="4" height="12" /><rect x="14" y="6" width="4" height="12" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4" fill="currentColor"><path d="m8 5 11 7-11 7z" /></svg>
                      )}
                    </button>
                    <button
                      onClick={handleMainRecClick}
                      data-testid="guest-record-toggle"
                      data-recording={recording || countInBeat != null ? "1" : "0"}
                      className={`h-8 w-11 rounded-md ${recording || countInBeat != null ? "bg-red-700" : "bg-zinc-800 hover:bg-zinc-700"} text-white`}
                    >
                      {recording || countInBeat != null ? (
                        <span className="mx-auto block h-3 w-3 rounded-[2px] bg-white" />
                      ) : (
                        <span className="mx-auto block h-3.5 w-3.5 rounded-full bg-red-500" />
                      )}
                    </button>
                    <button
                      onClick={() => setGuestLoop((v) => !v)}
                      className={`btn-round h-8 w-8 ${guestLoop ? "btn-round--active" : ""}`}
                      title={t.guestRepeatFragmentTitle}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 7v5h-5" />
                        <path d="M4 17v-5h5" />
                        <path d="M18.5 12A6.5 6.5 0 0 0 7 8" />
                        <path d="M5.5 12A6.5 6.5 0 0 0 17 16" />
                      </svg>
                    </button>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => {
                          if (guestIsPlaying && !guestTransportLinkedRef.current) pauseGuestSolo()
                          else playGuestOnly().catch(() => {})
                        }}
                      disabled={guestActionBusy || guestCalibrating}
                      className={`rounded-sm px-2 py-1 text-xs ${guestIsPlaying && !guestTransportLinkedRef.current ? "bg-[#5f82aa]" : "bg-zinc-700 hover:bg-zinc-600"} ${guestActionBusy || guestCalibrating ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {t.solo}
                    </button>
                      <button
                        onClick={() => setGuestMuted((v) => !v)}
                      className={`rounded-sm px-2 py-1 text-xs ${guestMuted ? "bg-red-600" : "bg-zinc-700 hover:bg-zinc-600"}`}
                    >
                      {t.mute}
                    </button>
                    </div>
                    <div className="w-[96px]">
                      {uiLang === "ru" ? (
                        <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
                          <span>{t.left}</span>
                          <span>{t.right}</span>
                        </div>
                      ) : (
                        <div className="mb-1 text-[11px] text-white/60">{t.pan}</div>
                      )}
                      <CenterMarkedSlider value={guestPan} min={-1} max={1} step={0.01} onChange={(v) => setGuestPan(v)} ariaLabel={t.guestPanAria} />
                    </div>
                    <div className="w-[120px]">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-white/65">
                        <span>{t.volShort}</span>
                        <span>{Math.round(guestVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.01}
                        value={guestVolume}
                        onChange={(e) => setGuestVolume(Number(e.currentTarget.value))}
                        className="w-full range-thin"
                        aria-label={t.guestVolumeAria}
                      />
                    </div>
                    <div className="min-w-[190px] flex-1 max-w-[280px]">
                      <div className="flex items-center justify-between text-[11px] text-white/65">
                        <span>{t.delay}</span>
                        <span>{Math.round(guestSyncOffsetSec * 1000)} ms</span>
                      </div>
                      <input
                        type="range"
                        min={GUEST_SYNC_MIN_SEC}
                        max={GUEST_SYNC_MAX_SEC}
                        step={0.005}
                        value={guestSyncOffsetSec}
                        onChange={(e) => setGuestSyncOffsetSec(Number(e.currentTarget.value))}
                        className="w-full range-thin"
                        aria-label={t.guestDelayAria}
                      />
                    </div>
                    <span className="text-[11px] text-white/75">{formatTime(guestCurrentTime)} / {formatTime(guestDuration)}</span>
                    <div className="relative ml-auto">
                      <button
                        onClick={() => {
                          if (!guestTrackUrl || guestExportingDuet) return
                          setGuestDownloadMenuOpen((v) => !v)
                        }}
                        className={`rounded-sm px-2 py-1 text-xs ${guestTrackUrl && !guestExportingDuet ? "bg-zinc-700 hover:bg-zinc-600" : "bg-zinc-800 text-white/40 cursor-not-allowed"}`}
                      >
                        {guestExportingDuet ? t.export : t.save}
                      </button>
                      {guestDownloadMenuOpen && guestTrackUrl ? (
                        <div className="absolute right-0 top-[calc(100%+6px)] z-20 min-w-[140px] rounded-md border border-white/10 bg-zinc-900/95 p-1 shadow-xl">
                          <button
                            onClick={() => {
                              downloadGuestSolo("m4a").catch(() => {})
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-white hover:bg-zinc-700"
                          >
                            {t.soloFmtM4a}
                          </button>
                          <button
                            onClick={() => {
                              downloadGuestSolo("mp3").catch(() => {})
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-white hover:bg-zinc-700"
                          >
                            {t.soloFmtMp3}
                          </button>
                          <button
                            onClick={() => {
                              downloadGuestSolo("wav").catch(() => {})
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-white hover:bg-zinc-700"
                          >
                            {t.soloFmtWav}
                          </button>
                          <button
                            onClick={() => {
                              setGuestDuetMixOpen((v) => !v)
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-white hover:bg-zinc-700"
                          >
                            {t.duet}
                          </button>
                          {guestDuetMixOpen ? (
                            <div className="mt-1 space-y-2 rounded border border-white/10 bg-black/35 p-2 text-[11px] text-white/80">
                              <div>
                                <div className="mb-1 flex items-center justify-between">
                                  <span>{t.duetGuest}</span>
                                  <span>{duetGuestLevel}%</span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={150}
                                  step={1}
                                  value={duetGuestLevel}
                                  onChange={(e) => setDuetGuestLevel(Number(e.currentTarget.value))}
                                  className="w-full range-thin"
                                />
                              </div>
                              <div>
                                <div className="mb-1 flex items-center justify-between">
                                  <span>{t.duetSoloTrack}</span>
                                  <span>{duetSoloLevel}%</span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={150}
                                  step={1}
                                  value={duetSoloLevel}
                                  onChange={(e) => setDuetSoloLevel(Number(e.currentTarget.value))}
                                  className="w-full range-thin"
                                />
                              </div>
                              <div>
                                <div className="mb-1 text-[11px] text-white/70">{t.duetFormat}</div>
                                <div className="grid grid-cols-3 gap-1">
                                  {(["m4a", "mp3", "wav"] as ExportFormat[]).map((fmt) => (
                                    <button
                                      key={fmt}
                                      onClick={() => setDuetFormat(fmt)}
                                      className={`rounded px-1 py-1 text-[11px] ${duetFormat === fmt ? "bg-[#5f82aa] text-white" : "bg-zinc-700 text-white/90 hover:bg-zinc-600"}`}
                                    >
                                      {fmt === "mp3" ? "mp3 320" : fmt}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  downloadGuestDuet().catch(() => {})
                                }}
                                className="w-full rounded bg-[#5f82aa] px-2 py-1.5 text-xs font-medium text-white hover:bg-[#7398c2]"
                              >
                                {t.saveDuet}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {guestTakes.length > 0 ? (
                    <div className="rounded-sm border border-white/10 bg-black/20 p-2">
                      <div className="mb-2 text-xs text-white/75">{t.takes}</div>
                      <div className="flex flex-wrap gap-1">
                        {guestTakes.map((take) => (
                          <button
                            key={take.id}
                            onClick={() => {
                              activateGuestTake(take.id).catch(() => {})
                            }}
                            className={`rounded-sm px-2 py-1 text-[11px] ${
                              take.id === activeGuestTakeId ? "bg-[#5f82aa] text-white" : "bg-zinc-800 text-white/80 hover:bg-zinc-700"
                            }`}
                            title={`${take.title} · ${take.syncQuality ?? "unknown"}`}
                          >
                            {t.activateTake}: {take.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-xl overflow-hidden border border-white/10 bg-black/25">
                    <canvas
                      ref={guestCanvasRef}
                      aria-label="Guest waveform"
                      onPointerDown={onGuestWavePointerDown}
                      onPointerMove={onGuestWavePointerMove}
                      onPointerUp={onGuestWavePointerUp}
                      className="w-full h-[74px] cursor-pointer"
                      title={t.guestWaveformTitle}
                    />
                  </div>
                  {recordError ? <div className="text-xs text-red-300">{recordError}</div> : null}
                </div>
              ) : null}

              <audio
                ref={guestAudioRef}
                controls={false}
                src={guestTrackUrl ?? undefined}
                className="hidden"
                onLoadedMetadata={(e) => {
                  setGuestDuration(e.currentTarget.duration || guestDuration)
                }}
                onTimeUpdate={(e) => {
                  setGuestCurrentTime(e.currentTarget.currentTime)
                  if (guestSyncGuardRef.current) return
                  if (!guestTransportLinkedRef.current || !isPlayingRef.current) return
                  const now = Date.now()
                  if (now - guestDriftLastSampleAtRef.current < GUEST_DRIFT_SAMPLE_THROTTLE_MS) return
                  guestDriftLastSampleAtRef.current = now
                  const mainPos = enginesRef.current[0]?.getSourcePositionSeconds?.() ?? positionSecRef.current
                  syncGuestToMain(mainPos, false)
                  if (now - guestDriftTelemetryLastFlushAtRef.current >= GUEST_DRIFT_TELEMETRY_FLUSH_MS) {
                    void flushGuestSyncTelemetry("periodic")
                  }
                }}
                onPause={() => setGuestIsPlaying(false)}
                onPlay={() => setGuestIsPlaying(true)}
                onEnded={() => {
                  setGuestIsPlaying(false)
                  if (guestLoop) {
                    if (guestTransportLinkedRef.current) {
                      guestTransportLinkedRef.current = false
                      resetGuestAndMainToStart()
                      playGuestWithTrack().catch(() => {})
                    } else {
                      playGuestOnly().catch(() => {})
                    }
                    return
                  }
                  setGuestSoloMode(false)
                  if (guestTransportLinkedRef.current) {
                    pause()
                    guestTransportLinkedRef.current = false
                  }
                }}
                onError={() => {
                  setRecordError(t.guestFilePlaybackFailed)
                }}
              />
            </div>

            <div className="order-3 space-y-4">
              {trackList.map((track, i) => {
                const audible = isTrackAudible(i)
                const isLit = isPlaying && audible
                return (
                  <div key={i} className={`space-y-2 transition ${isLit ? "opacity-100" : "opacity-45"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{track.name}</span>
                        <button
                          onClick={() => toggleMute(i)}
                          aria-label={`Mute ${track.name}`}
                          className={`px-2.5 py-1 rounded text-xs transition ${muted[i] ? "bg-red-600" : "bg-zinc-700 hover:bg-zinc-600"}`}
                        >
                          M
                        </button>
                        <button
                          onClick={() => toggleSolo(i)}
                          aria-label={`Solo ${track.name}`}
                          className={`px-2.5 py-1 rounded text-xs transition ${solo[i] ? "bg-yellow-400 text-black" : "bg-zinc-700 hover:bg-zinc-600"}`}
                        >
                          S
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="hidden md:block">
                          <div className="text-[11px] text-white/60 mb-1">{t.volShort}</div>
                          <input
                            type="range"
                            aria-label={`Volume ${track.name}`}
                            min={0}
                            max={1}
                            step="0.01"
                            value={volUI[i] ?? 1}
                            onChange={(e) => setVol(i, Number(e.currentTarget.value))}
                            className="range-thin range-short"
                          />
                        </div>
                        <div className="hidden md:block w-[132px]">
                          {uiLang === "ru" ? (
                            <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
                              <span>{t.left}</span>
                              <span>{t.right}</span>
                            </div>
                          ) : (
                            <div className="text-[11px] text-white/60 mb-1">{t.pan}</div>
                          )}
                          <CenterMarkedSlider
                            value={panUI[i] ?? 0}
                            ariaLabel={`Pan ${track.name}`}
                            min={-1}
                            max={1}
                            step={0.01}
                            onChange={(v) => setPan(i, v)}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl overflow-hidden border border-white/10 bg-black/25">
                      <canvas
                        aria-label={`Waveform ${track.name}`}
                        data-track-index={i}
                        ref={(el) => {
                          waveCanvasesRef.current[i] = el
                        }}
                        onPointerDown={onWavePointerDown}
                        onPointerMove={onWavePointerMove}
                        onPointerUp={onWavePointerUp}
                        className="w-full h-[92px] cursor-pointer"
                        title={t.trackWaveformTitle}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="order-4 rounded-xl border border-white/10 bg-zinc-900/70 p-3 space-y-3">
                <button
                  onClick={() => setShowPiano((v) => !v)}
                  className="rounded-sm bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
                >
                  {showPiano ? t.pianoHide : t.pianoShow}
                </button>
              {showPiano ? (
                <div className="space-y-2">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-white/70">
                        <span>{t.pianoVolumeLabel}</span>
                        <span>{Math.round(pianoVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={1.8}
                        step={0.01}
                        value={pianoVolume}
                        onChange={(e) => setPianoVolume(Number(e.currentTarget.value))}
                        className="w-full range-thin"
                        aria-label={t.pianoVolumeAria}
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-white/70">
                        <span>{t.pianoOctaveRangeLabel}</span>
                        <span>{OCTAVE_NAMES[pianoBaseOctave]} + {OCTAVE_NAMES[pianoBaseOctave + 1]}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={6}
                        step={1}
                        value={pianoBaseOctave}
                        onChange={(e) => setPianoBaseOctave(Number(e.currentTarget.value))}
                        className="w-full range-thin"
                        aria-label={t.pianoOctaveRangeAria}
                      />
                    </div>
                  </div>
                  <div className="text-xs text-white/65">
                    {t.pianoHint} {OCTAVE_NAMES[3]} + {OCTAVE_NAMES[4]}.
                  </div>
                  <div className="relative h-[180px] w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-800/70 p-2">
                    <div className="grid h-full grid-cols-14 gap-[2px]">
                      {pianoKeys.filter((k) => !k.isBlack).map((key) => (
                        <button
                          key={key.note}
                          onMouseDown={() => playPianoTone(key.freq)}
                          className="relative rounded-b-md border border-zinc-300 bg-zinc-100 text-zinc-900 hover:bg-white"
                        >
                          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px]">{key.note}</span>
                          {key.kbd ? <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] text-zinc-500">{key.kbd?.toUpperCase()}/{key.kbdRu?.toUpperCase()}</span> : null}
                        </button>
                      ))}
                    </div>
                    {pianoKeys.filter((k) => k.isBlack).map((key) => (
                      <button
                        key={key.note}
                        onMouseDown={() => playPianoTone(key.freq)}
                        className="absolute top-2 h-[105px] w-[5.5%] -translate-x-1/2 rounded-b-md border border-zinc-900 bg-zinc-950 text-white hover:bg-black"
                        style={{ left: `${key.left}%` }}
                      >
                        {key.kbd ? <span className="mt-1 block text-[10px] text-zinc-400">{key.kbd?.toUpperCase()}/{key.kbdRu?.toUpperCase()}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          ) : null}
      </>
      ) : null}
    </div>
  )
}
