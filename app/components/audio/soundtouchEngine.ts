"use client"

import { PitchShifter } from "soundtouchjs"

export type SoundTouchEngine = {
  getCapabilities: () => AudioEngineCapabilities
  connect: (node: AudioNode) => void
  disconnect: () => void

  start: () => void
  stop: () => void

  seekSeconds: (sec: number) => void
  getSourcePositionSeconds: () => number
  getDurationSeconds?: () => number
  getBufferedSeconds?: () => number
  getDebugState?: () => Record<string, number | string | null | undefined>
  tickPlayback?: (plan?: AudioEngineTickPlan) => void

  setTempo: (tempo: number) => void
  setPitchSemitones: (semitones: number) => void

  destroy: () => void
}

export type AudioEngineCapabilities = {
  supportsTempo: boolean
  supportsIndependentPitch: boolean
}

export type AudioEngineTickPlan = {
  sharedMinQueueEstimateFrames?: number
  queueSlackFrames?: number
  chunkBudget?: number
  force?: boolean
}

type CreateOpts = {
  bufferSize?: number
}

type PitchShifterInstance = {
  sourcePosition: number
  tempo: number
  pitchSemitones: number
  percentagePlayed?: number
  _filter?: { sourcePosition: number }
  connect: (node: AudioNode) => void
  disconnect: () => void
  off?: () => void
}

type PitchShifterCtor = new (
  ctx: AudioContext,
  buffer: AudioBuffer,
  bufferSize: number
) => PitchShifterInstance

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

export function createSoundTouchEngine(
  audioCtx: AudioContext,
  audioBuffer: AudioBuffer,
  opts?: CreateOpts
): SoundTouchEngine {
  const bufferSize = opts?.bufferSize ?? 2048

  const original = audioBuffer
  const sr = original.sampleRate

  let tempo = 1
  let pitchSemi = 0

  const maxSourceSample = Math.max(0, original.length - 1)
  let targetSourcePositionSamples = 0

  const PitchShifterClass = PitchShifter as PitchShifterCtor
  let shifter: PitchShifterInstance | null = null

  let outputNode: AudioNode | null = null
  let isRunning = false
  let isConnected = false
  let needsRebuildOnStart = true

  const clampSourcePosition = (samples: number) => clamp(Math.floor(samples), 0, maxSourceSample)

  const setShifterSourcePosition = (samples: number) => {
    const pos = clampSourcePosition(samples)
    targetSourcePositionSamples = pos
    if (!shifter) return

    let positioned = false
    try {
      if (shifter._filter) {
        shifter._filter.sourcePosition = pos
        positioned = true
      }
    } catch {}
    try {
      shifter.sourcePosition = pos
    } catch {}
    if (positioned) return

    // Fallback for implementations where direct filter position is unavailable.
    const fullSamples = original.duration * sr
    if (fullSamples > 0 && Number.isFinite(fullSamples)) {
      try {
        const perc = clamp(pos / fullSamples, 0, 1)
        shifter.percentagePlayed = perc
      } catch {}
    }
  }

  const getShifterPosSamples = () => {
    if (!shifter) return 0
    const filterPos = shifter._filter?.sourcePosition
    if (typeof filterPos === "number") return clampSourcePosition(filterPos)
    const sp = shifter.sourcePosition
    return typeof sp === "number" ? clampSourcePosition(sp) : 0
  }

  const getCurrentPosSamples = () => {
    if (!shifter) return targetSourcePositionSamples
    return getShifterPosSamples()
  }

  const rebuildShifter = () => {
    if (shifter) {
      try {
        shifter.disconnect()
      } catch {}
      isConnected = false
    }

    shifter = new PitchShifterClass(audioCtx, original, bufferSize)

    shifter.tempo = clamp(tempo, 0.25, 4)
    shifter.pitchSemitones = clamp(pitchSemi, -24, 24)

    // Keep absolute source position without rebuilding/copying tail buffers.
    setShifterSourcePosition(targetSourcePositionSamples)
    needsRebuildOnStart = false

    if (outputNode && isRunning) {
      try {
        shifter.connect(outputNode)
        isConnected = true
      } catch {}
    }
  }

  const ensureShifter = () => {
    if (!shifter) rebuildShifter()
  }

  const connectShifter = () => {
    if (!shifter || !outputNode || isConnected) return
    try {
      shifter.connect(outputNode)
      isConnected = true
    } catch {}
  }

  const disconnectShifter = () => {
    if (!shifter) return
    try {
      shifter.disconnect()
    } catch {}
    isConnected = false
  }

  const applySeekSamples = (absoluteSamples: number) => {
    setShifterSourcePosition(absoluteSamples)
    if (!shifter) return
    // Safari/WebKit can ignore in-place filter reposition while processor is actively pulling.
    // Rebuild node on active playback to make seek deterministic without buffer slicing.
    if (isRunning) {
      rebuildShifter()
      return
    }
    if (shifter._filter) return
    try {
      shifter.sourcePosition = targetSourcePositionSamples
    } catch {
      rebuildShifter()
    }
  }

  return {
    getCapabilities() {
      return {
        supportsTempo: true,
        supportsIndependentPitch: true,
      }
    },

    connect(node: AudioNode) {
      outputNode = node
      if (!isRunning) return
      if (needsRebuildOnStart || !shifter) {
        rebuildShifter()
        return
      }
      connectShifter()
    },

    disconnect() {
      disconnectShifter()
      outputNode = null
      isRunning = false
    },

    start() {
      if (isRunning) return
      if (!outputNode) return
      isRunning = true
      if (needsRebuildOnStart || !shifter) {
        rebuildShifter()
        return
      }
      setShifterSourcePosition(targetSourcePositionSamples)
      connectShifter()
    },

    stop() {
      if (isRunning) {
        targetSourcePositionSamples = getCurrentPosSamples()
      }

      disconnectShifter()
      isRunning = false
      needsRebuildOnStart = true
    },

    seekSeconds(sec: number) {
      const dur = original.duration || 0
      const s = clamp(sec, 0, dur)
      const absSamples = Math.floor(s * sr)
      applySeekSamples(absSamples)
      if (!isRunning) needsRebuildOnStart = true
    },

    getSourcePositionSeconds() {
      return getCurrentPosSamples() / sr
    },

    getDurationSeconds() {
      return original.duration || 0
    },

    setTempo(t: number) {
      tempo = clamp(t, 0.25, 4)
      if (shifter) shifter.tempo = tempo
    },

    setPitchSemitones(semi: number) {
      pitchSemi = clamp(semi, -24, 24)
      if (shifter) shifter.pitchSemitones = pitchSemi
    },

    destroy() {
      disconnectShifter()
      try {
        shifter?.off?.()
      } catch {}
      shifter = null
      outputNode = null
      isRunning = false
      isConnected = false
      needsRebuildOnStart = true
    },
  }
}
