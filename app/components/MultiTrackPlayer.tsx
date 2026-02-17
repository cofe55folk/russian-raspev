"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createSoundTouchEngine, type SoundTouchEngine } from "./audio/soundtouchEngine"
import { clearGlobalAudio, requestGlobalAudio, type GlobalAudioController } from "../lib/globalAudioManager"

export type TrackDef = { name: string; src: string }
type WavePeaks = { min: Float32Array; max: Float32Array }
type TeleprompterLine = { time: number; text: string }
type TeleprompterAnchorMap = Record<number, number>
type TeleprompterTextOverrideMap = Record<number, string>
type ExportFormat = "m4a" | "mp3" | "wav"
type UiLang = "ru" | "en"
const TELEPROMPTER_LEAD_SEC = 0.18
const COUNT_IN_BEATS = 3
const COUNT_IN_BPM = 72
const DEFAULT_GUEST_SYNC_SEC = 0.22
const GLOBAL_GUEST_SYNC_STORAGE_KEY = "rr_guest_sync_offset_sec:global_v1"
const GUEST_STARTUP_BIAS_SEC = 0
const GUEST_STARTUP_BIAS_DECAY_SEC = 3.5
const GUEST_SYNC_MIN_SEC = -2.5
const GUEST_SYNC_MAX_SEC = 2.5
const GUEST_CALIBRATE_MAX_ABS_SEC = 1.4
const GUEST_CALIBRATE_SEARCH_SWING_SEC = 0.55
const GUEST_CALIBRATE_MAX_JUMP_SEC = 0.65
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

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}
function formatTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s < 10 ? "0" : ""}${s}`
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
  const maxLag = Math.max(1, maxLagBins)
  let bestLag = 0
  let bestScore = -Infinity

  for (let lag = -maxLag; lag <= maxLag; lag++) {
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
    const lagPenalty = 0.06 * (Math.abs(lag - preferredLagBins) / maxLag)
    const score = corr - lagPenalty
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  return { lagBins: bestLag, score: bestScore }
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
  teleprompterSourceUrl?: string
  teleprompterExpandedText?: string[]
  onControllerReady?: (controller: GlobalAudioController | null) => void
  registerGlobalAudio?: boolean
}

export default function MultiTrackPlayer({
  tracks: inputTracks,
  onTimeChange,
  seekToSeconds,
  teleprompterSourceUrl,
  teleprompterExpandedText,
  onControllerReady,
  registerGlobalAudio = true,
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
  const guestSyncStorageKey = useMemo(() => `rr_guest_sync_offset_sec:${trackScopeId}`, [trackScopeId])
  const guestRecordStorageKey = useMemo(() => `guest:${trackScopeId}`, [trackScopeId])

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
  const masterGainRef = useRef<GainNode | null>(null)
  const wetGainRef = useRef<GainNode | null>(null)
  const dryGainRef = useRef<GainNode | null>(null)

  // transport
  const rafRef = useRef<number | null>(null)
  const isPlayingRef = useRef(false)
  const positionSecRef = useRef(0)

  // params
  const tempoRef = useRef(1)
  const pitchSemiRef = useRef(0)

  // UI
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loopOn, setLoopOn] = useState(false)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const [muted, setMuted] = useState<boolean[]>(trackList.map(() => false))
  const [solo, setSolo] = useState<boolean[]>(trackList.map(() => false))
  const [panUI, setPanUI] = useState<number[]>(trackList.map(() => 0))
  const [volUI, setVolUI] = useState<number[]>(trackList.map(() => 1))

  const [masterVol, setMasterVol] = useState(1)
  const [reverbAmount, setReverbAmount] = useState(0.2)

  const [speed, setSpeed] = useState(1)
  const [pitchSemi, setPitchSemi] = useState(0)

  // waveform
  const waveCanvasesRef = useRef<(HTMLCanvasElement | null)[]>([])
  const peaksRef = useRef<(WavePeaks | null)[]>(trackList.map(() => null))
  const [waveReady, setWaveReady] = useState(false)
  const lastExternalSeekRef = useRef<number | null>(null)
  const [teleprompterLines, setTeleprompterLines] = useState<TeleprompterLine[]>([])
  const [teleprompterAnchorEditMode, setTeleprompterAnchorEditMode] = useState(false)
  const [teleprompterAnchors, setTeleprompterAnchors] = useState<TeleprompterAnchorMap>({})
  const [teleprompterTextEditMode, setTeleprompterTextEditMode] = useState(false)
  const [teleprompterTextOverrides, setTeleprompterTextOverrides] = useState<TeleprompterTextOverrideMap>({})
  const [teleprompterAutoCollect, setTeleprompterAutoCollect] = useState(false)
  const [teleprompterSettingsOpen, setTeleprompterSettingsOpen] = useState(false)
  const [teleprompterCollectState, setTeleprompterCollectState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [teleprompterCollectInfo, setTeleprompterCollectInfo] = useState("")
  const [showPiano, setShowPiano] = useState(false)
  const [pianoVolume, setPianoVolume] = useState(0.95)
  const [pianoBaseOctave, setPianoBaseOctave] = useState(3)
  const [recording, setRecording] = useState(false)
  const [countInBeat, setCountInBeat] = useState<number | null>(null)
  const [guestTrackUrl, setGuestTrackUrl] = useState<string | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordChunksRef = useRef<BlobPart[]>([])
  const recordStreamRef = useRef<MediaStream | null>(null)
  const countInTimerRef = useRef<number | null>(null)
  const guestAudioRef = useRef<HTMLAudioElement | null>(null)
  const guestCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const guestPeaksRef = useRef<WavePeaks | null>(null)
  const guestScrubRef = useRef(false)
  const guestSyncGuardRef = useRef(false)
  const guestTransportLinkedRef = useRef(false)
  const guestNeedsRecalibrateRef = useRef(false)
  const guestLastDriftFixAtRef = useRef(0)
  const guestRateNudgeRef = useRef(1)
  const guestStartGuardTimerRef = useRef<number | null>(null)
  const [guestWaveReady, setGuestWaveReady] = useState(false)
  const [guestCurrentTime, setGuestCurrentTime] = useState(0)
  const [guestDuration, setGuestDuration] = useState(0)
  const [guestIsPlaying, setGuestIsPlaying] = useState(false)
  const [guestSoloMode, setGuestSoloMode] = useState(false)
  const [guestMuted, setGuestMuted] = useState(false)
  const [guestLoop, setGuestLoop] = useState(false)
  const [guestPanelOpen, setGuestPanelOpen] = useState(true)
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
  const calibrationMutedRef = useRef(false)
  const guestActionBusyRef = useRef(false)
  const [guestActionBusy, setGuestActionBusy] = useState(false)
  const teleprompterAnchorStorageKey = useMemo(
    () => (teleprompterSourceUrl ? `rr_teleprompter_anchors:${trackScopeId}:${teleprompterSourceUrl}` : null),
    [teleprompterSourceUrl, trackScopeId]
  )
  const teleprompterTextStorageKey = useMemo(
    () => (teleprompterSourceUrl ? `rr_teleprompter_text_overrides:${trackScopeId}:${teleprompterSourceUrl}` : null),
    [teleprompterSourceUrl, trackScopeId]
  )
  const teleprompterAutoCollectStorageKey = useMemo(
    () => (teleprompterSourceUrl ? `rr_teleprompter_auto_collect:${trackScopeId}:${teleprompterSourceUrl}` : null),
    [teleprompterSourceUrl, trackScopeId]
  )
  const teleprompterAutoCollectPrimedRef = useRef(false)
  const calibrationGuestVolumeRef = useRef(1)
  const calibrationGuestGainRef = useRef(1)
  const guestTogetherFirstStartRef = useRef(true)
  const guestPanNodeRef = useRef<StereoPannerNode | null>(null)
  const guestGainNodeRef = useRef<GainNode | null>(null)
  const guestSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const [recSoloHint, setRecSoloHint] = useState(false)
  const [uiLang, setUiLang] = useState<UiLang>("ru")

  const t = useMemo(() => {
    const isRu = uiLang === "ru"
    return {
      volume: isRu ? "Громкость" : "Volume",
      reverb: isRu ? "Реверб" : "Reverb",
      speed: isRu ? "Скорость" : "Speed",
      pitch: isRu ? "Высота" : "Pitch",
      pan: isRu ? "Пан" : "Pan",
      solo: isRu ? "Соло" : "Solo",
      mute: isRu ? "Выкл" : "Mute",
      save: isRu ? "Скачать" : "Save",
      export: isRu ? "Экспорт..." : "Export...",
      soloFmtM4a: isRu ? "Соло · m4a" : "Solo · m4a",
      soloFmtMp3: isRu ? "Соло · mp3 320" : "Solo · mp3 320",
      soloFmtWav: isRu ? "Соло · wav" : "Solo · wav",
      duet: isRu ? "Дуэт" : "Duet",
      duetGuest: isRu ? "Гость" : "Guest",
      duetSoloTrack: isRu ? "Соло трек" : "Solo track",
      duetFormat: isRu ? "Формат дуэта" : "Duet format",
      saveDuet: isRu ? "Скачать дуэт" : "Save duet",
      delay: isRu ? "Задержка" : "Delay",
      left: isRu ? "Л" : "L",
      right: isRu ? "П" : "R",
      volShort: isRu ? "Гр." : "Vol",
    }
  }, [uiLang])

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
      const langAttr = document.documentElement.lang?.toLowerCase() || "ru"
      setUiLang(langAttr.startsWith("en") ? "en" : "ru")
    }
    syncLang()
    const observer = new MutationObserver(syncLang)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] })
    return () => observer.disconnect()
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

  const syncGuestToMain = (mainPosSec: number, force = false) => {
    if (!guestTransportLinkedRef.current) return
    const guestAudio = guestAudioRef.current
    if (!guestAudio) return
    if (!force && guestAudio.paused) return
    const hardwareBias = 0
    const startupBias = getStartupBiasSec()
    const offset = guestSyncOffsetRef.current + hardwareBias + startupBias
    const target = clamp(mainPosSec + offset, 0, guestDuration || mainPosSec + offset)
    const drift = guestAudio.currentTime - target
    const now = Date.now()
    const needFix = force || Math.abs(drift) > 0.03
    if (!needFix) return

    // No continuous retiming during playback: sync is only forced on explicit actions.
    if (!force) return

    guestLastDriftFixAtRef.current = now
    beginGuestProgrammaticAction()
    guestAudio.currentTime = target
    setGuestCurrentTime(target)
    endGuestProgrammaticAction()
    guestAudio.playbackRate = 1
    guestRateNudgeRef.current = 1
  }

  const seekGuestAudioForStart = async (mainPosSec: number) => {
    const guestAudio = guestAudioRef.current
    if (!guestAudio) return
    const hardwareBias = 0
    const startupBias = getStartupBiasSec()
    const offset = guestSyncOffsetRef.current + hardwareBias + startupBias
    const target = clamp(mainPosSec + offset, 0, guestDuration || mainPosSec + offset)

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

  useEffect(() => {
    guestSyncOffsetRef.current = guestSyncOffsetSec
  }, [guestSyncOffsetSec])

  useEffect(() => {
    guestCalibratingRef.current = guestCalibrating
  }, [guestCalibrating])

  useEffect(() => {
    setGuestTrackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setGuestWaveReady(false)
    setGuestCurrentTime(0)
    setGuestDuration(0)
    setGuestIsPlaying(false)

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
    guestSyncLoadedRef.current = true

    loadGuestRecording().catch(() => {})
    // loadGuestRecording depends only on guestRecordStorageKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestSyncStorageKey, guestRecordStorageKey])

  useEffect(() => {
    if (!guestSyncLoadedRef.current) return
    try {
      localStorage.setItem(guestSyncStorageKey, String(guestSyncOffsetSec))
      localStorage.setItem(GLOBAL_GUEST_SYNC_STORAGE_KEY, String(guestSyncOffsetSec))
    } catch {}
  }, [guestSyncOffsetSec, guestSyncStorageKey])

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
      setRecordError("Pan временно переведен в безопасный режим (без WebAudio).")
    }
  }, [guestPan])

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

  /** =========================
   *  INIT (один раз)
   *  ========================= */
  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const ctx = new AudioContext()
      ctxRef.current = ctx

      // master graph
      const masterIn = ctx.createGain()
      const dryGain = ctx.createGain()
      const wetGain = ctx.createGain()
      const convolver = ctx.createConvolver()
      const masterGain = ctx.createGain()

      dryGainRef.current = dryGain
      wetGainRef.current = wetGain
      masterGainRef.current = masterGain

      masterIn.connect(dryGain)
      masterIn.connect(convolver)
      convolver.connect(wetGain)

      dryGain.connect(masterGain)
      wetGain.connect(masterGain)
      masterGain.connect(ctx.destination)

      masterGain.gain.value = masterVol
      wetGain.gain.value = reverbAmount
      dryGain.gain.value = 1 - reverbAmount
      convolver.buffer = makeImpulseResponse(ctx)

      // load buffers
      const buffers = await Promise.all(
        trackList.map(async (t) => {
          const res = await fetch(t.src)
          if (!res.ok) throw new Error(`Fetch failed: ${t.src} (${res.status})`)
          const arr = await res.arrayBuffer()
          return await ctx.decodeAudioData(arr)
        })
      )

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackList])

  useEffect(() => {
    enginesRef.current = trackList.map(() => null)
    engineGateRef.current = []
    trackGainRef.current = []
    panRef.current = []
    peaksRef.current = trackList.map(() => null)
    waveCanvasesRef.current = trackList.map(() => null)

    setMuted(trackList.map(() => false))
    setSolo(trackList.map(() => false))
    setPanUI(trackList.map(() => 0))
    setVolUI(trackList.map(() => 1))
  }, [trackList])

  /** =========================
   *  APPLY UI -> AUDIO (с плавностью)
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
   *  ACTIVE TRACK (подсветка)
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

  /** =========================
   *  ENGINE CONTROL
   *  ========================= */
  const stopEnginesHard = () => {
    engineGateRef.current.forEach((g) => rampGainTo(g, 0, 0.02))
    enginesRef.current.forEach((eng) => {
      try {
        eng?.stop()
      } catch {}
    })
  }

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

    // конец трека
    if (duration > 0 && pos >= duration - 0.01) {
      // During active recording, hard-stop recording exactly at main-track boundary.
      if (recording) {
        stopGuestRecording()
        return
      }
      // останавливаем
      isPlayingRef.current = false
      setIsPlaying(false)
      stopEnginesHard()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null

      // курсор в начало
      positionSecRef.current = 0
      setCurrentTime(0)
      enginesRef.current.forEach((eng) => eng?.seekSeconds(0))

      // если loopOn — запускаем заново
      if (loopOn) {
        // небольшая задержка не нужна, просто стартуем
        isPlayingRef.current = true
        setIsPlaying(true)
        startEngines()
        rafRef.current = requestAnimationFrame(animate)
      } else {
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
      if (!teleprompterSourceUrl) {
        setTeleprompterLines([])
        return
      }

      const res = await fetch(teleprompterSourceUrl)
      if (!res.ok) throw new Error(`Teleprompter fetch failed: ${teleprompterSourceUrl}`)
      const base = (await res.json()) as TeleprompterLine[]
      if (cancelled) return

      if (!teleprompterExpandedText?.length) {
        setTeleprompterLines(base)
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
    }

    loadTeleprompter().catch((e) => console.error("Teleprompter load error:", e))

    return () => {
      cancelled = true
    }
  }, [teleprompterSourceUrl, teleprompterExpandedText])

  useEffect(() => {
    if (!teleprompterAnchorStorageKey) return
    try {
      const raw = localStorage.getItem(teleprompterAnchorStorageKey)
      if (!raw) {
        setTeleprompterAnchors({})
        return
      }
      const parsed = JSON.parse(raw) as TeleprompterAnchorMap
      if (!parsed || typeof parsed !== "object") {
        setTeleprompterAnchors({})
        return
      }
      const normalized: TeleprompterAnchorMap = {}
      for (const [k, v] of Object.entries(parsed)) {
        const idx = Number(k)
        const t = Number(v)
        if (Number.isFinite(idx) && Number.isFinite(t) && idx >= 0 && t >= 0) normalized[idx] = t
      }
      setTeleprompterAnchors(normalized)
    } catch {
      setTeleprompterAnchors({})
    }
  }, [teleprompterAnchorStorageKey])

  useEffect(() => {
    if (!teleprompterAnchorStorageKey) return
    try {
      localStorage.setItem(teleprompterAnchorStorageKey, JSON.stringify(teleprompterAnchors))
    } catch {}
  }, [teleprompterAnchorStorageKey, teleprompterAnchors])

  useEffect(() => {
    if (!teleprompterTextStorageKey) return
    try {
      const raw = localStorage.getItem(teleprompterTextStorageKey)
      if (!raw) {
        setTeleprompterTextOverrides({})
        return
      }
      const parsed = JSON.parse(raw) as TeleprompterTextOverrideMap
      if (!parsed || typeof parsed !== "object") {
        setTeleprompterTextOverrides({})
        return
      }
      const normalized: TeleprompterTextOverrideMap = {}
      for (const [k, v] of Object.entries(parsed)) {
        const idx = Number(k)
        if (Number.isFinite(idx) && idx >= 0 && typeof v === "string") normalized[idx] = v
      }
      setTeleprompterTextOverrides(normalized)
    } catch {
      setTeleprompterTextOverrides({})
    }
  }, [teleprompterTextStorageKey])

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

  /** =========================
   *  TRANSPORT
   *  ========================= */
  const play = async () => {
    const ctx = ctxRef.current
    if (!ctx || !isReady) return
    if (registerGlobalAudio && globalControllerRef.current) requestGlobalAudio(globalControllerRef.current)
    await ctx.resume()
    if (guestSoloMode) setGuestSoloMode(false)

    // если стоим в самом конце — стартуем с начала
    const atEnd = duration > 0 && positionSecRef.current >= duration - 0.02
    const pos = atEnd ? 0 : clamp(positionSecRef.current, 0, duration || positionSecRef.current)

    positionSecRef.current = pos
    setCurrentTime(pos)

    stopEnginesHard()
    enginesRef.current.forEach((eng) => eng?.seekSeconds(pos))
    const guestAudio = guestAudioRef.current
    const hasLinkedGuest = guestTransportLinkedRef.current && !!guestAudio && !!guestTrackUrl
    if (hasLinkedGuest && guestAudio) {
      if (guestNeedsRecalibrateRef.current || !guestCalibrateReady) {
        await calibrateGuestDelay({ silent: true, keepPosition: true })
      }
      await seekGuestAudioForStart(pos)
      guardGuestStart()
    }

    startEngines()
    isPlayingRef.current = true
    setIsPlaying(true)

    if (hasLinkedGuest && guestAudio) {
      beginGuestProgrammaticAction()
      guestAudio
        .play()
        .catch(() => {
          setRecordError("Не удалось синхронно запустить гостевую дорожку.")
        })
        .finally(() => {
          endGuestProgrammaticAction()
        })
      window.setTimeout(() => {
        if (!guestTransportLinkedRef.current || !isPlayingRef.current) return
        syncGuestToMain(positionSecRef.current, true)
      }, 150)
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
  }

  const forceStopMainTransport = () => {
    isPlayingRef.current = false
    setIsPlaying(false)
    stopEnginesHard()
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

  const saveGuestRecording = useCallback(async (blob: Blob) => {
    try {
      const db = await openGuestDb()
      const tx = db.transaction("tracks", "readwrite")
      const store = tx.objectStore("tracks")
      await new Promise<void>((resolve, reject) => {
        const req = store.put({ blob, ts: Date.now() }, guestRecordStorageKey)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
      db.close()
    } catch {}
  }, [guestRecordStorageKey])

  const loadGuestRecording = useCallback(async (): Promise<void> => {
    try {
      const db = await openGuestDb()
      const tx = db.transaction("tracks", "readonly")
      const store = tx.objectStore("tracks")
      const record = await new Promise<{ blob?: Blob } | undefined>((resolve, reject) => {
        const req = store.get(guestRecordStorageKey)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      db.close()
      if (!record?.blob) return
      const url = URL.createObjectURL(record.blob)
      setGuestTrackUrl(url)
    } catch {}
  }, [guestRecordStorageKey])

  const pause = () => {
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
  }

  const togglePlay = () => {
    if (isPlayingRef.current) pause()
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
    globalControllerRef.current = {
      id: globalControllerIdRef.current,
      title: trackList[0]?.name ?? "Песня",
      subtitle: "Карточка песни",
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
      onControllerReady?.(null)
    }
  }, [duration, loopOn, onControllerReady, trackList, seekTo])

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
      clearGuestCalibrateTimer()
      clearGuestStartGuardTimer()
      if (countInTimerRef.current != null) {
        window.clearInterval(countInTimerRef.current)
        countInTimerRef.current = null
      }
      if (guestTrackUrl) URL.revokeObjectURL(guestTrackUrl)
      recordStreamRef.current?.getTracks().forEach((t) => t.stop())
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop()
      }
    }
  }, [guestTrackUrl])

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
    try {
      setRecordError(null)
      setGuestCalibrateReady(false)
      guestTransportLinkedRef.current = false
      if (selectedSoloTrackIndex < 0) {
        setRecordError("Перед записью выбери ровно один голос в Solo.")
        return
      }

      if (countInTimerRef.current != null) {
        window.clearInterval(countInTimerRef.current)
        countInTimerRef.current = null
      }

      if (guestTrackUrl) {
        URL.revokeObjectURL(guestTrackUrl)
        setGuestTrackUrl(null)
        setGuestWaveReady(false)
      }
      guestTogetherFirstStartRef.current = true
      guestStartupBiasSecRef.current = 0

      let stream = recordStreamRef.current
      const hasLiveTrack = !!stream?.getAudioTracks().some((t) => t.readyState === "live")
      if (!hasLiveTrack) {
        stream = await navigator.mediaDevices.getUserMedia(RECORD_STREAM_CONSTRAINTS)
        recordStreamRef.current = stream
      }
      if (!stream) throw new Error("mic-stream-unavailable")
      const inputTrack = stream.getAudioTracks()[0]
      if (inputTrack) {
        inputTrack.onended = () => {
          setRecordError("Запись остановлена: микрофонное устройство стало недоступно.")
          setRecording(false)
          if (recordStreamRef.current === stream) {
            recordStreamRef.current = null
          }
        }
      }
      recordChunksRef.current = []
      const mimeType = pickRecordingMimeType()
      const estimatedOffset = estimateLatencyCompensationSec(ctxRef.current, stream)
      // Do not overwrite manual user calibration each time.
      if (Math.abs(guestSyncOffsetRef.current) < 0.02 && estimatedOffset > 0.02) {
        setGuestSyncOffsetSec(estimatedOffset)
      }
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data)
      }
      recorder.onerror = () => {
        setRecordError("Ошибка записи микрофона. Попробуй ещё раз.")
        setRecording(false)
      }
      recorder.onstop = () => {
        void (async () => {
          const outMime = recorder.mimeType || mimeType || "audio/webm"
          const rawBlob = new Blob(recordChunksRef.current, { type: outMime })
          if (rawBlob.size < 1024) {
            setRecordError("Запись получилась слишком короткой или пустой. Повтори запись.")
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
          const url = URL.createObjectURL(finalBlob)
          setGuestTrackUrl(url)
          saveGuestRecording(finalBlob).catch(() => {})
          setRecording(false)
          setCountInBeat(null)
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
          recorder.onstart = () => {
            setRecording(true)
            play()
          }
          recorder.start()
          return
        }
        setCountInBeat(beat)
        playCountInClick(beat === 1).catch(() => {})
      }, beatMs)
    } catch {
      setRecordError("Не удалось получить доступ к микрофону.")
      setRecording(false)
      setCountInBeat(null)
    }
  }

  const stopGuestRecording = () => {
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
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop()
    }
    setRecording(false)
    guestStartupBiasSecRef.current = 0
    pause()
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
        setRecordError("Не удалось воспроизвести гостевую дорожку в текущем браузере.")
      }
    })
  }

  const playGuestWithTrack = async () => {
    await runGuestActionLocked(async () => {
      if (!guestAudioRef.current) return
      if (selectedSoloTrackIndex < 0) {
        setRecordError("Для режима «Гость + трек» включи Solo на одном голосе.")
        return
      }
      setRecordError(null)
      setGuestCalibrateReady(false)
      setGuestSoloMode(false)
      await calibrateGuestDelay({ silent: true, keepPosition: true })
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

  const calibrateGuestDelay = async (options?: { silent?: boolean; keepPosition?: boolean }) => {
    const silent = options?.silent ?? false
    const keepPosition = options?.keepPosition ?? false
    const audio = guestAudioRef.current
    if (!audio) return
    if (guestCalibratingRef.current) return
    if (selectedSoloTrackIndex < 0) {
      if (!silent) setRecordError("Для калибровки включи Solo на одном голосе.")
      return
    }
    if (!guestTrackUrl) {
      if (!silent) setRecordError("Сначала запиши гостевую дорожку.")
      return
    }
    const ctx = ctxRef.current
    if (!ctx) {
      if (!silent) setRecordError("Аудиодвижок не готов.")
      return
    }

    if (!silent) setRecordError(null)
    guestStartupBiasSecRef.current = 0
    guestCalibratingRef.current = true
    setGuestCalibrating(true)
    if (!silent) setGuestCalibrateReady(false)
    clearGuestCalibrateTimer()
    const originalPos = positionSecRef.current

    try {
      const [mainRes, guestRes] = await Promise.all([
        fetch(trackList[selectedSoloTrackIndex].src),
        fetch(guestTrackUrl),
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

      const offsetSec = clamp(best.lagBins * best.binSec, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC)
      if (Math.abs(offsetSec - baseOffsetSec) > GUEST_CALIBRATE_MAX_JUMP_SEC) {
        throw new Error("implausible-jump")
      }
      if (Math.abs(offsetSec) > 1.6) {
        throw new Error("implausible-offset")
      }
      setGuestSyncOffsetSec(offsetSec)
      setGuestCalibrateReady(true)
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
        setRecordError("Не удалось надежно измерить задержку по файлам. Попробуй ещё раз после новой записи.")
      }
      setGuestCalibrateReady(false)
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

  const downloadGuestSolo = async (format: ExportFormat) => {
    if (!guestTrackUrl) {
      setRecordError("Сначала запиши гостевую дорожку.")
      return
    }
    if (guestExportingDuet) return
    setGuestDownloadMenuOpen(false)
    setGuestDuetMixOpen(false)
    setGuestExportingDuet(true)
    setRecordError(null)
    try {
      const guestBuf = await decodeAudioFromUrl(guestTrackUrl)
      const blob = await exportAudioBuffer(guestBuf, format)
      const url = URL.createObjectURL(blob)
      downloadByUrl(url, `russian-raspev-guest-solo.${format}`)
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch {
      if (format === "mp3") setRecordError("Экспорт MP3 недоступен в этом браузере. Выбери M4A или WAV.")
      else if (format === "m4a") setRecordError("Экспорт M4A недоступен в этом браузере. Выбери WAV.")
      else setRecordError("Ошибка экспорта соло.")
    } finally {
      setGuestExportingDuet(false)
    }
  }

  const downloadGuestDuet = async () => {
    if (!guestTrackUrl) {
      setRecordError("Сначала запиши гостевую дорожку.")
      return
    }
    if (selectedSoloTrackIndex < 0) {
      setRecordError("Для дуэта включи Solo на одном голосе.")
      return
    }
    const ctx = ctxRef.current
    if (!ctx) {
      setRecordError("Аудиодвижок не готов.")
      return
    }
    const OfflineContextCtor =
      window.OfflineAudioContext ||
      (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    if (!OfflineContextCtor) {
      setRecordError("Экспорт дуэта не поддерживается в этом браузере.")
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
          setRecordError("Не удалось выполнить калибровку для экспорта дуэта. Попробуй ещё раз.")
          return
        }
      }

      const [mainRes, guestRes] = await Promise.all([
        fetch(trackList[selectedSoloTrackIndex].src),
        fetch(guestTrackUrl),
      ])
      if (!mainRes.ok || !guestRes.ok) {
        setRecordError("Не удалось загрузить дорожки для экспорта.")
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
      const blob = await exportAudioBuffer(rendered, duetFormat)
      const duetUrl = URL.createObjectURL(blob)
      downloadByUrl(duetUrl, `russian-raspev-guest-duet.${duetFormat}`)
      window.setTimeout(() => URL.revokeObjectURL(duetUrl), 1500)
    } catch {
      if (duetFormat === "mp3") setRecordError("Экспорт MP3 недоступен в этом браузере. Выбери M4A или WAV.")
      else if (duetFormat === "m4a") setRecordError("Экспорт M4A недоступен в этом браузере. Выбери WAV.")
      else setRecordError("Ошибка экспорта дуэта. Попробуй ещё раз.")
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

  const setTeleprompterAnchorAtCurrentTime = useCallback(
    (lineIndex: number) => {
      if (lineIndex < 0 || lineIndex >= effectiveTeleprompterLines.length) return
      const rawTime = Math.max(0, Number(currentTime.toFixed(3)))
      setTeleprompterAnchors((prevMap) => ({ ...prevMap, [lineIndex]: rawTime }))
    },
    [currentTime, effectiveTeleprompterLines]
  )

  const clearTeleprompterAnchor = useCallback((lineIndex: number) => {
    setTeleprompterAnchors((prevMap) => {
      if (!(lineIndex in prevMap)) return prevMap
      const nextMap = { ...prevMap }
      delete nextMap[lineIndex]
      return nextMap
    })
  }, [])

  const setTeleprompterTextOverride = useCallback((lineIndex: number, text: string) => {
    setTeleprompterTextOverrides((prevMap) => ({ ...prevMap, [lineIndex]: text }))
  }, [])

  const clearTeleprompterTextOverride = useCallback((lineIndex: number) => {
    setTeleprompterTextOverrides((prevMap) => {
      if (!(lineIndex in prevMap)) return prevMap
      const nextMap = { ...prevMap }
      delete nextMap[lineIndex]
      return nextMap
    })
  }, [])

  const copyTeleprompterAnchorsJson = useCallback(async () => {
    if (!teleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    const payload = {
      sourceUrl: teleprompterSourceUrl,
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
  }, [effectiveTeleprompterLines, teleprompterAnchors, teleprompterSourceUrl])

  const downloadTeleprompterAnchorsJson = useCallback(() => {
    if (!teleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    const payload = {
      sourceUrl: teleprompterSourceUrl,
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
  }, [effectiveTeleprompterLines, teleprompterAnchors, teleprompterSourceUrl])

  const datasetRows = useMemo(() => {
    if (!teleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    const now = new Date().toISOString()
    return effectiveTeleprompterLines.map((line, index) => {
      const next = effectiveTeleprompterLines[index + 1]
      const sourceLine = teleprompterLines[index]
      const endSec = next ? Number(next.time.toFixed(3)) : duration > line.time ? Number(duration.toFixed(3)) : null
      return {
        dataset_version: "v1",
        exported_at: now,
        song_scope: trackScopeId,
        source_url: teleprompterSourceUrl,
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
    teleprompterSourceUrl,
    teleprompterTextOverrides,
    trackList,
    trackScopeId,
  ])

  const postTeleprompterDatasetSnapshot = useCallback(
    async (reason: "manual" | "auto") => {
      if (!datasetRows || !datasetRows.length) return
      setTeleprompterCollectState("saving")
      setTeleprompterCollectInfo("Сохранение...")
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
        setTeleprompterCollectInfo(`Saved ${data.rowsWritten} lines`)
      } catch (e) {
        setTeleprompterCollectState("error")
        setTeleprompterCollectInfo(`Ошибка: ${e instanceof Error ? e.message : "save_failed"}`)
      }
    },
    [datasetRows, trackScopeId]
  )

  useEffect(() => {
    if (!teleprompterAutoCollect) return
    if (!teleprompterSourceUrl || !datasetRows?.length) return
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
    teleprompterSourceUrl,
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

  const activeTeleprompterIndex = useMemo(() => {
    if (!effectiveTeleprompterLines.length) return -1
    for (let i = effectiveTeleprompterLines.length - 1; i >= 0; i--) {
      if (currentTime + TELEPROMPTER_LEAD_SEC >= effectiveTeleprompterLines[i].time) return i
    }
    return -1
  }, [currentTime, effectiveTeleprompterLines])

  const teleprompterWindow = useMemo(() => {
    if (!effectiveTeleprompterLines.length) return []
    const base = activeTeleprompterIndex >= 0 ? activeTeleprompterIndex : 0
    const start = Math.max(0, base - 1)
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
  const setSpeedUI = (v: number) => {
    setSpeed(v)
    tempoRef.current = v
    enginesRef.current.forEach((eng) => eng?.setTempo(v))
  }

  const setPitchUI = (semi: number) => {
    setPitchSemi(semi)
    pitchSemiRef.current = semi
    enginesRef.current.forEach((eng) => eng?.setPitchSemitones(semi))
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

  /** =========================
   *  RENDER
   *  ========================= */
  return (
    <div className="bg-zinc-950/60 rounded-2xl p-6 md:p-8 space-y-6 text-white shadow-xl border border-white/10">
      {!isReady && <div className="text-white/70">Загрузка аудио…</div>}

      {isReady && (
        <>
          {/* MASTER */}
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={goToStart}
                      aria-label="В начало"
                      className="btn-round"
                      title="В начало (без воспроизведения)"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 7 3 12l5 5" />
                        <path d="M4 12h10a5 5 0 1 1 0 10" />
                      </svg>
                    </button>

                    <button
                      onClick={togglePlay}
                      aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
                      className="px-5 h-11 bg-white text-black rounded-full font-medium hover:bg-white/90 transition"
                    >
                      {isPlaying ? "Пауза" : "▶ Воспроизвести"}
                    </button>

                    <button
                      onClick={() => setLoopOn((v) => !v)}
                      aria-label="Повтор трека"
                      className={`btn-round ${loopOn ? "btn-round--active" : ""}`}
                      title="Повтор трека"
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
                        aria-label={recording || countInBeat != null ? "Остановить запись гостевой дорожки" : "Записать гостевую дорожку"}
                        className={`btn-round ${recording || countInBeat != null ? "bg-red-700 border-red-500/70" : ""}`}
                        title={recording || countInBeat != null ? "Стоп записи" : "Записать гостевую дорожку"}
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
                          Выберите один голос Solo для записи
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
                  aria-label="Позиция трека"
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
                      aria-label="Master громкость"
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
                        aria-label="Скорость воспроизведения"
                        min={0.6}
                        max={1.4}
                        step="0.01"
                        value={speed}
                        onChange={(e) => setSpeedUI(Number(e.currentTarget.value))}
                        className="w-full range-thin"
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
                        className="w-full range-thin"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                  <button
                    onClick={() => setGuestPanelOpen((v) => !v)}
                    className="rounded-sm bg-zinc-800 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700"
                  >
                    Гостевая дорожка
                  </button>
                  <span className={`rounded-sm px-2 py-1 text-[11px] ${guestCalibrating ? "bg-zinc-600 text-white" : guestCalibrateReady ? "bg-emerald-700/70 text-white" : "bg-zinc-800 text-white/70"}`}>
                    {guestCalibrating ? "Подбор..." : guestCalibrateReady ? "Задержка подобрана" : "Ожидает подбора"}
                  </span>
                  {countInBeat ? <span className="rounded-sm bg-amber-500/90 px-2 py-1 text-xs font-semibold text-black">Отсчёт: {countInBeat}</span> : null}
                </div>
              </div>

              <div className="relative overflow-visible rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-xs text-white/60">Суфлёр</div>
                {!teleprompterSourceUrl && (
                  <div className="text-sm text-white/50">Подключи таймкоды для суфлёра</div>
                )}
                {teleprompterSourceUrl && teleprompterWindow.length === 0 && (
                  <div className="text-sm text-white/50">Загрузка строк…</div>
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
                          {line.text}
                        </button>
                      )
                    })}
                  </div>
                )}
                {teleprompterSourceUrl && effectiveTeleprompterLines.length > 0 && (
                  <>
                    <button
                      onClick={() => setTeleprompterSettingsOpen((v) => !v)}
                      aria-label={teleprompterSettingsOpen ? "Скрыть настройки суфлёра" : "Показать настройки суфлёра"}
                      title={teleprompterSettingsOpen ? "Скрыть настройки суфлёра" : "Показать настройки суфлёра"}
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
                              {teleprompterAnchorEditMode ? "Скрыть разметку" : "Разметка якорей"}
                            </button>
                            <button
                              onClick={() => setTeleprompterTextEditMode((v) => !v)}
                              className={`rounded-sm px-2 py-1 text-xs ${teleprompterTextEditMode ? "bg-[#5f82aa] text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                            >
                              {teleprompterTextEditMode ? "Скрыть редактор" : "Редактор текста"}
                            </button>
                            {activeTeleprompterIndex >= 0 && (
                              <button
                                onClick={() => setTeleprompterAnchorAtCurrentTime(activeTeleprompterIndex)}
                                className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                              >
                                Якорь текущей строки
                              </button>
                            )}
                            <button
                              onClick={() => void copyTeleprompterAnchorsJson()}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              Копировать JSON
                            </button>
                            <button
                              onClick={downloadTeleprompterAnchorsJson}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              Скачать JSON
                            </button>
                            <button
                              onClick={() => void copyTeleprompterDatasetJsonl()}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              Копировать dataset JSONL
                            </button>
                            <button
                              onClick={downloadTeleprompterDatasetJsonl}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              Скачать dataset JSONL
                            </button>
                            <button
                              onClick={() => void postTeleprompterDatasetSnapshot("manual")}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              Сохранить в dataset
                            </button>
                            <button
                              onClick={() => setTeleprompterAutoCollect((v) => !v)}
                              className={`rounded-sm px-2 py-1 text-xs ${teleprompterAutoCollect ? "bg-[#5f82aa] text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                            >
                              {teleprompterAutoCollect ? "Автосбор: вкл" : "Автосбор: выкл"}
                            </button>
                            <button
                              onClick={() => setTeleprompterAnchors({})}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              Сброс якорей
                            </button>
                            <button
                              onClick={() => setTeleprompterTextOverrides({})}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              Сброс текста
                            </button>
                          </div>
                          <div className="text-[11px] text-white/60">
                            Dataset status: {teleprompterCollectState}
                            {teleprompterCollectInfo ? ` · ${teleprompterCollectInfo}` : ""}
                          </div>
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
                                          aria-label={`Текст строки ${index + 1}`}
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

          <div className="flex flex-col gap-4">
            <div className={`order-2 rounded-xl border border-white/10 bg-black/25 p-3 space-y-2 ${guestPanelOpen ? "block" : "hidden"}`}>
              {guestPanelOpen ? (
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button onClick={resetGuestAndMainToStart} className="btn-round h-8 w-8" aria-label="В начало гостя" title="В начало">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 7 3 12l5 5" />
                        <path d="M4 12h12" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        if (guestTransportLinkedRef.current && isPlayingRef.current) {
                          pause()
                          guestTransportLinkedRef.current = false
                          return
                        }
                        playGuestWithTrack().catch(() => {})
                      }}
                      disabled={guestActionBusy || guestCalibrating}
                      className={`h-8 w-8 rounded-md ${guestTransportLinkedRef.current && isPlayingRef.current ? "bg-green-600" : "bg-zinc-700 hover:bg-zinc-600"} text-white ${guestActionBusy || guestCalibrating ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {guestTransportLinkedRef.current && isPlayingRef.current ? (
                        <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4" fill="currentColor"><rect x="6" y="6" width="4" height="12" /><rect x="14" y="6" width="4" height="12" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4" fill="currentColor"><path d="m8 5 11 7-11 7z" /></svg>
                      )}
                    </button>
                    <button
                      onClick={handleMainRecClick}
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
                      title="Повтор фрагмента"
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
                      <CenterMarkedSlider value={guestPan} min={-1} max={1} step={0.01} onChange={(v) => setGuestPan(v)} ariaLabel="Pan гостя" />
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
                        aria-label="Громкость гостевой дорожки"
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
                        aria-label="Компенсация задержки гостевой дорожки"
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

                  <div className="rounded-xl overflow-hidden border border-white/10 bg-black/25">
                    <canvas
                      ref={guestCanvasRef}
                      aria-label="Guest waveform"
                      onPointerDown={onGuestWavePointerDown}
                      onPointerMove={onGuestWavePointerMove}
                      onPointerUp={onGuestWavePointerUp}
                      className="w-full h-[74px] cursor-pointer"
                      title="Клик/перетаскивание по волне — перемотка гостевой дорожки"
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
                  setRecordError("Файл гостевой дорожки не удалось воспроизвести.")
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
                          <div className="text-[11px] text-white/60 mb-1">{t.pan}</div>
                          <CenterMarkedSlider
                            value={panUI[i] ?? 0}
                            ariaLabel={`Pan ${track.name}`}
                            min={-1}
                            max={1}
                            step={0.01}
                            onChange={(v) => setPan(i, v)}
                            leftLabel={t.left}
                            rightLabel={t.right}
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
                        title="Клик/перетаскивание по волне — перемотка"
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
                {showPiano ? "Скрыть пианино онлайн" : "Пианино онлайн"}
              </button>
              {showPiano ? (
                <div className="space-y-2">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-white/70">
                        <span>Громкость пианино</span>
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
                        aria-label="Громкость пианино"
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-white/70">
                        <span>Диапазон октав</span>
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
                        aria-label="Выбор диапазона октав пианино"
                      />
                    </div>
                  </div>
                  <div className="text-xs text-white/65">
                    Тембр: Grand Piano (Steinberg-style). Управление: английская и русская раскладки + цифры. База по умолчанию: {OCTAVE_NAMES[3]} + {OCTAVE_NAMES[4]}.
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
        </>
      )}
    </div>
  )
}
