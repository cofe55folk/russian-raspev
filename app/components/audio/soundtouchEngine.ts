"use client"

import { PitchShifter } from "soundtouchjs"

export type SoundTouchEngine = {
  connect: (node: AudioNode) => void
  disconnect: () => void

  start: () => void
  stop: () => void

  seekSeconds: (sec: number) => void
  getSourcePositionSeconds: () => number

  setTempo: (tempo: number) => void
  setPitchSemitones: (semitones: number) => void

  destroy: () => void
}

type CreateOpts = {
  bufferSize?: number
}

type PitchShifterInstance = {
  sourcePosition: number
  tempo: number
  pitchSemitones: number
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

function sliceAudioBuffer(ctx: AudioContext, src: AudioBuffer, startSample: number) {
  const channels = src.numberOfChannels
  const length = src.length
  const start = Math.max(0, Math.min(length, startSample))
  const newLen = Math.max(1, length - start)

  const out = ctx.createBuffer(channels, newLen, src.sampleRate)
  for (let c = 0; c < channels; c++) {
    const from = src.getChannelData(c).subarray(start, start + newLen)
    out.getChannelData(c).set(from)
  }
  return out
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

  let baseOffsetSamples = 0
  let currentBuffer: AudioBuffer = original

  const PitchShifterClass = PitchShifter as PitchShifterCtor
  let shifter: PitchShifterInstance | null = null

  let outputNode: AudioNode | null = null
  let isRunning = false

  const getLocalPosSamples = () => {
    if (!shifter) return 0
    const sp = shifter.sourcePosition
    return typeof sp === "number" ? sp : 0
  }

  const rebuildShifter = () => {
    if (shifter) {
      try {
        shifter.disconnect()
      } catch {}
    }

    shifter = new PitchShifterClass(audioCtx, currentBuffer, bufferSize)

    shifter.tempo = clamp(tempo, 0.25, 4)
    shifter.pitchSemitones = clamp(pitchSemi, -24, 24)

    // стартуем из 0 текущего слайса
    try {
      shifter.sourcePosition = 0
    } catch {}

    if (outputNode) {
      try {
        shifter.connect(outputNode)
      } catch {}
    }
  }

  const ensureShifter = () => {
    if (!shifter) rebuildShifter()
  }

  const applySeekSamples = (absoluteSamples: number) => {
    baseOffsetSamples = Math.max(0, Math.min(original.length - 1, absoluteSamples))
    currentBuffer = sliceAudioBuffer(audioCtx, original, baseOffsetSamples)
    rebuildShifter()
  }

  return {
    connect(node: AudioNode) {
      outputNode = node
      ensureShifter()
      try {
        shifter?.connect(node)
      } catch {}
    },

    disconnect() {
      try {
        shifter?.disconnect()
      } catch {}
      outputNode = null
    },

    start() {
      if (isRunning) return
      if (!outputNode) return
      ensureShifter()

      try {
        shifter?.connect(outputNode)
      } catch {}

      isRunning = true
    },

    stop() {
      if (!isRunning) return

      const local = getLocalPosSamples()
      baseOffsetSamples = clamp(baseOffsetSamples + local, 0, original.length - 1)

      currentBuffer = sliceAudioBuffer(audioCtx, original, baseOffsetSamples)

      try {
        shifter?.disconnect()
      } catch {}

      isRunning = false
    },

    seekSeconds(sec: number) {
      const dur = original.duration || 0
      const s = clamp(sec, 0, dur)
      const absSamples = Math.floor(s * sr)

      const wasRunning = isRunning
      if (wasRunning) {
        try {
          shifter?.disconnect()
        } catch {}
        isRunning = false
      }

      applySeekSamples(absSamples)

      if (wasRunning && outputNode) {
        try {
          shifter?.connect(outputNode)
        } catch {}
        isRunning = true
      }
    },

    getSourcePositionSeconds() {
      const local = getLocalPosSamples()
      return (baseOffsetSamples + local) / sr
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
      try {
        shifter?.disconnect()
      } catch {}
      try {
        shifter?.off?.()
      } catch {}
      shifter = null
      outputNode = null
      isRunning = false
    },
  }
}
