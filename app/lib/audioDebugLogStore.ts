"use client"

const AUDIO_DEBUG_EVENT_NAME = "rr-audio-debug-buffer-change"
const AUDIO_DEBUG_BUFFER_LIMIT = 200
const AUDIO_DEBUG_STORAGE_KEY = "rr_audio_debug"
const AUDIO_DEBUG_CAPTURE_STORAGE_KEY = "rr_audio_debug_capture"
const AUDIO_TTFP_STORAGE_KEY = "rr_audio_ttfp"
const EMPTY_AUDIO_DEBUG_BUFFER: AudioDebugBufferEntry[] = []
const QUIET_AUDIO_DEBUG_EMIT_DELAY_MS = 250
const QUIET_AUDIO_DEBUG_EVENTS = new Set([
  "audio:focus_state",
  "ringbuffer:runtime_probe",
  "ringbuffer:wrap_event",
  "ringbuffer:stats",
])

export type AudioDebugChannel = "AUDIO_DEBUG" | "AUDIO_TTFP"

export type AudioDebugBufferEntry = {
  id: number
  ts: string
  channel: AudioDebugChannel
  event: string
  payload: Record<string, unknown>
}

type AudioDebugBufferState = {
  seq: number
  entries: AudioDebugBufferEntry[]
}

declare global {
  interface Window {
    __rrAudioDebugBufferState?: AudioDebugBufferState
  }
}

function getState(): AudioDebugBufferState {
  if (typeof window === "undefined") {
    return { seq: 0, entries: [] }
  }
  if (!window.__rrAudioDebugBufferState) {
    window.__rrAudioDebugBufferState = { seq: 0, entries: [] }
  }
  return window.__rrAudioDebugBufferState
}

function emitChange() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(AUDIO_DEBUG_EVENT_NAME))
}

let quietEmitTimer: number | null = null

function flushQuietEmitTimer() {
  if (typeof window === "undefined") return
  if (quietEmitTimer == null) return
  window.clearTimeout(quietEmitTimer)
  quietEmitTimer = null
}

function scheduleQuietEmit() {
  if (typeof window === "undefined") return
  if (quietEmitTimer != null) return
  quietEmitTimer = window.setTimeout(() => {
    quietEmitTimer = null
    emitChange()
  }, QUIET_AUDIO_DEBUG_EMIT_DELAY_MS)
}

function pushEntry(entry: Omit<AudioDebugBufferEntry, "id">, quiet = false) {
  if (typeof window === "undefined") return
  const state = getState()
  state.seq += 1
  state.entries.push({
    id: state.seq,
    ...entry,
  })
  if (state.entries.length > AUDIO_DEBUG_BUFFER_LIMIT) {
    state.entries.splice(0, state.entries.length - AUDIO_DEBUG_BUFFER_LIMIT)
  }
  if (quiet) {
    scheduleQuietEmit()
  } else {
    flushQuietEmitTimer()
    emitChange()
  }
}

export function isAudioDebugEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_AUDIO_DEBUG === "1") return true
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(AUDIO_DEBUG_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function isAudioDebugCaptureEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_AUDIO_DEBUG_CAPTURE === "1") return true
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(AUDIO_DEBUG_CAPTURE_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function isAudioTtfpEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_AUDIO_TTFP === "1") return true
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(AUDIO_TTFP_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function logAudioDebug(event: string, payload: Record<string, unknown>) {
  if (!isAudioDebugEnabled()) return
  const ts = new Date().toISOString()
  const quiet = QUIET_AUDIO_DEBUG_EVENTS.has(event)
  if (!quiet) {
    console.info(`[AUDIO_DEBUG] ${ts} ${event}`, payload)
  }
  pushEntry({
    ts,
    channel: "AUDIO_DEBUG",
    event,
    payload,
  }, quiet)
}

export function logAudioTtfp(payload: Record<string, unknown>) {
  if (!isAudioTtfpEnabled()) return
  const ts = new Date().toISOString()
  console.info(`[AUDIO_TTFP] ${ts}`, payload)
  pushEntry({
    ts,
    channel: "AUDIO_TTFP",
    event: "sample",
    payload,
  })
}

export function getAudioDebugBufferSnapshot(): AudioDebugBufferEntry[] {
  if (typeof window === "undefined") return EMPTY_AUDIO_DEBUG_BUFFER
  return getState().entries
}

export function subscribeAudioDebugBuffer(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const handler = () => onChange()
  window.addEventListener(AUDIO_DEBUG_EVENT_NAME, handler as EventListener)
  return () => {
    window.removeEventListener(AUDIO_DEBUG_EVENT_NAME, handler as EventListener)
  }
}

export function formatAudioDebugBuffer(entries: AudioDebugBufferEntry[]): string {
  return entries
    .map((entry) => {
      const payload = JSON.stringify(entry.payload)
      if (entry.channel === "AUDIO_TTFP") {
        return `[${entry.channel}] ${entry.ts} ${payload}`
      }
      return `[${entry.channel}] ${entry.ts} ${entry.event} ${payload}`
    })
    .join("\n")
}
