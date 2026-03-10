"use client"

export type AudioDebugCaptureClickEvent = {
  ts: string
  deltaAbs: number
  frameCursorFrames: number
  outputSec: number
  trackCurrentSec: number | null
}

export type AudioDebugCaptureArtifact = {
  format: "audio/wav"
  sampleRate: number
  channels: 1
  durationSec: number
  captureWindowSec: number
  totalCapturedSec: number
  artifactStartOffsetSec: number
  artifactEndOffsetSec: number
  wavBase64: string
  clickEvents: AudioDebugCaptureClickEvent[]
}

type AudioDebugCaptureState = {
  sampleRate: number
  channels: 1
  maxFrames: number
  ring: Int16Array
  writeIndex: number
  filledFrames: number
  totalCapturedFrames: number
  clickEvents: AudioDebugCaptureClickEvent[]
}

declare global {
  interface Window {
    __rrAudioDebugCaptureState?: AudioDebugCaptureState
  }
}

const DEFAULT_CAPTURE_SECONDS = 20
const MAX_CLICK_EVENTS = 32

function getState(): AudioDebugCaptureState | null {
  if (typeof window === "undefined") return null
  return window.__rrAudioDebugCaptureState ?? null
}

export function initAudioDebugCaptureStore(sampleRate: number, maxSeconds = DEFAULT_CAPTURE_SECONDS) {
  if (typeof window === "undefined") return
  const safeSampleRate = Math.max(8_000, Math.floor(sampleRate || 44_100))
  const maxFrames = Math.max(safeSampleRate, Math.floor(safeSampleRate * Math.max(1, maxSeconds)))
  const current = window.__rrAudioDebugCaptureState
  if (
    current &&
    current.sampleRate === safeSampleRate &&
    current.maxFrames === maxFrames &&
    current.channels === 1
  ) {
    current.writeIndex = 0
    current.filledFrames = 0
    current.totalCapturedFrames = 0
    current.clickEvents = []
    current.ring.fill(0)
    return
  }
  window.__rrAudioDebugCaptureState = {
    sampleRate: safeSampleRate,
    channels: 1,
    maxFrames,
    ring: new Int16Array(maxFrames),
    writeIndex: 0,
    filledFrames: 0,
    totalCapturedFrames: 0,
    clickEvents: [],
  }
}

export function resetAudioDebugCaptureStore() {
  const state = getState()
  if (!state) return
  state.writeIndex = 0
  state.filledFrames = 0
  state.totalCapturedFrames = 0
  state.clickEvents = []
  state.ring.fill(0)
}

export function appendAudioDebugCaptureSamples(samples: Int16Array) {
  const state = getState()
  if (!state || !samples.length) return
  for (let i = 0; i < samples.length; i += 1) {
    state.ring[state.writeIndex] = samples[i]
    state.writeIndex = (state.writeIndex + 1) % state.maxFrames
  }
  state.filledFrames = Math.min(state.maxFrames, state.filledFrames + samples.length)
  state.totalCapturedFrames += samples.length
}

export function recordAudioDebugCaptureClick(event: AudioDebugCaptureClickEvent) {
  const state = getState()
  if (!state) return
  state.clickEvents.push(event)
  if (state.clickEvents.length > MAX_CLICK_EVENTS) {
    state.clickEvents.splice(0, state.clickEvents.length - MAX_CLICK_EVENTS)
  }
}

function linearizeSamples(state: AudioDebugCaptureState): Int16Array {
  if (state.filledFrames <= 0) return new Int16Array(0)
  if (state.filledFrames < state.maxFrames) {
    return state.ring.slice(0, state.filledFrames)
  }
  const out = new Int16Array(state.maxFrames)
  const tail = state.maxFrames - state.writeIndex
  out.set(state.ring.subarray(state.writeIndex), 0)
  out.set(state.ring.subarray(0, state.writeIndex), tail)
  return out
}

function encodeMono16Wav(samples: Int16Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  let offset = 0

  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i))
      offset += 1
    }
  }

  writeString("RIFF")
  view.setUint32(offset, 36 + dataSize, true)
  offset += 4
  writeString("WAVE")
  writeString("fmt ")
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint32(offset, sampleRate, true)
  offset += 4
  view.setUint32(offset, sampleRate * bytesPerSample, true)
  offset += 4
  view.setUint16(offset, bytesPerSample, true)
  offset += 2
  view.setUint16(offset, 16, true)
  offset += 2
  writeString("data")
  view.setUint32(offset, dataSize, true)
  offset += 4

  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(offset, samples[i], true)
    offset += 2
  }

  return new Uint8Array(buffer)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...slice)
  }
  return window.btoa(binary)
}

export function getAudioDebugCaptureArtifactSnapshot(): AudioDebugCaptureArtifact | null {
  if (typeof window === "undefined") return null
  const state = getState()
  if (!state || state.filledFrames <= 0) return null
  const samples = linearizeSamples(state)
  if (!samples.length) return null
  const wavBytes = encodeMono16Wav(samples, state.sampleRate)
  const artifactDurationSec = Number((samples.length / state.sampleRate).toFixed(3))
  const totalCapturedSec = Number((state.totalCapturedFrames / state.sampleRate).toFixed(3))
  const artifactEndOffsetSec = totalCapturedSec
  const artifactStartOffsetSec = Number(Math.max(0, artifactEndOffsetSec - artifactDurationSec).toFixed(3))
  return {
    format: "audio/wav",
    sampleRate: state.sampleRate,
    channels: 1,
    durationSec: artifactDurationSec,
    captureWindowSec: Number((state.maxFrames / state.sampleRate).toFixed(3)),
    totalCapturedSec,
    artifactStartOffsetSec,
    artifactEndOffsetSec: Number(artifactEndOffsetSec.toFixed(3)),
    wavBase64: bytesToBase64(wavBytes),
    clickEvents: state.clickEvents.slice(),
  }
}
