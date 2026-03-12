"use client"

import { createAppendableTransportClock, type AppendableTransportClockSnapshot } from "./appendableTransportClock"
import {
  createAppendableQueueSabRing,
  getAppendableQueueSabRingAvailableFrames,
  resetAppendableQueueSabRing,
  writeAppendableQueueSabRingChunk,
  type AppendableQueueSabRing,
} from "./appendableQueueSabRing"
import type { AudioEngineTickPlan, SoundTouchEngine } from "./soundtouchEngine"

export type AppendablePcmChunk = {
  startFrame: number
  frameCount: number
  channels: Float32Array[]
  final: boolean
}

export type AppendablePcmReadResult =
  | { kind: "chunk"; chunk: AppendablePcmChunk }
  | { kind: "pending" }
  | { kind: "ended" }

export type AppendablePcmSource = {
  sampleRate: number
  channelCount: number
  durationFrames: number
  read: (startFrame: number, frameCount: number) => AppendablePcmReadResult
  getBufferedUntilFrame?: () => number
  isEnded?: () => boolean
}

export type AppendableQueueDataPlaneMode = "postmessage_pcm" | "sab_ring"
export type AppendableQueueControlPlaneMode = "message_port"
export type AppendableQueuePreferredDataPlaneMode = "sab_ring_preferred" | "postmessage_pcm_fallback"
export type AppendableQueueSabRequirement =
  | "cross_origin_isolation_required"
  | "shared_array_buffer_missing"
  | "shared_array_buffer_constructor_failed"

export type AppendableQueueWorkletStats = {
  availableFrames: number
  minAvailableFrames: number
  maxAvailableFrames: number
  underrunFrames: number
  droppedFrames: number
  playedFrame: number
  bufferedEndFrame: number
  discontinuityCount: number
  generation: number
  tempo: number
  pitchSemitones: number
}

export type AppendableQueueDebugStats = AppendableQueueWorkletStats & {
  sampleRate: number
  channelCount: number
  supportsIndependentPitch: boolean
  dataPlaneMode: AppendableQueueDataPlaneMode
  controlPlaneMode: AppendableQueueControlPlaneMode
  preferredDataPlaneMode: AppendableQueuePreferredDataPlaneMode
  sabCapable: boolean
  sabReady: boolean
  crossOriginIsolated: boolean
  sabRequirement: AppendableQueueSabRequirement | null
  appendCount: number
  appendMessageCount: number
  appendedFrames: number
  appendedSec: number
  appendedBytes: number
  bufferLeadFrames: number
  bufferLeadSec: number
  minObservedLeadFrames: number
  minObservedLeadSec: number
  maxObservedLeadFrames: number
  maxObservedLeadSec: number
  targetLeadFrames: number
  lowWaterFrames: number
  lowWaterSec: number
  highWaterFrames: number
  highWaterSec: number
  refillTriggerFrames: number
  refillTriggerSec: number
  lowWaterBreachCount: number
  highWaterBreachCount: number
  overflowDropCount: number
  overflowDroppedFrames: number
  appendChunkFrames: number
  ringFrames: number
  generation: number
  sourceEnded: boolean
  transportRunning: boolean
  transportFrame: number
  transportSec: number
  anchorFrame: number
  transportRate: number
  tempo: number
}

export type ManualAppendablePcmSourceState = {
  durationFrames: number
  bufferedUntilFrame: number
  queuedSegments: number
  ended: boolean
}

export type ManualAppendablePcmSourceController = {
  source: AppendablePcmSource
  appendChunk: (chunk: AppendablePcmChunk) => void
  clear: () => void
  markEnded: () => void
  getState: () => ManualAppendablePcmSourceState
}

type CreateAppendableQueueEngineOpts = {
  ringFrames?: number
  appendChunkFrames?: number
  lowWaterFrames?: number
  highWaterFrames?: number
  enableIndependentPitch?: boolean
  externalTick?: boolean
  onStats?: (stats: AppendableQueueDebugStats) => void
}

const WORKLET_MODULE_PATH = "/worklets/rr-appendable-queue-processor.js"
const APPENDABLE_QUEUE_CONTROL_PLANE_MODE = "message_port" as const
const moduleLoadPromiseByCtx = new WeakMap<AudioContext, Promise<void>>()

function detectAppendableQueueSabReadiness(): {
  preferredDataPlaneMode: AppendableQueuePreferredDataPlaneMode
  sabCapable: boolean
  sabReady: boolean
  crossOriginIsolated: boolean
  sabRequirement: AppendableQueueSabRequirement | null
} {
  const crossOriginIsolated = globalThis.crossOriginIsolated === true
  const SharedArrayBufferCtor = globalThis.SharedArrayBuffer
  const hasSabConstructor = typeof SharedArrayBufferCtor === "function"
  let sabCapable = false

  if (hasSabConstructor) {
    try {
      sabCapable = new SharedArrayBufferCtor(4).byteLength === 4
    } catch {
      sabCapable = false
    }
  }

  const sabReady = crossOriginIsolated && sabCapable
  let sabRequirement: AppendableQueueSabRequirement | null = null
  if (!crossOriginIsolated) {
    sabRequirement = "cross_origin_isolation_required"
  } else if (!hasSabConstructor) {
    sabRequirement = "shared_array_buffer_missing"
  } else if (!sabCapable) {
    sabRequirement = "shared_array_buffer_constructor_failed"
  }

  return {
    preferredDataPlaneMode: sabReady ? "sab_ring_preferred" : "postmessage_pcm_fallback",
    sabCapable,
    sabReady,
    crossOriginIsolated,
    sabRequirement,
  }
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

function clampFrame(frame: number, durationFrames: number) {
  return Math.min(durationFrames, Math.max(0, Math.floor(frame)))
}

function alignFrames(n: number, quantum = 1024) {
  return Math.max(quantum, Math.ceil(n / quantum) * quantum)
}

function ensureAppendableQueueWorkletModule(ctx: AudioContext): Promise<void> {
  const existing = moduleLoadPromiseByCtx.get(ctx)
  if (existing) return existing
  const promise = ctx.audioWorklet.addModule(WORKLET_MODULE_PATH)
  moduleLoadPromiseByCtx.set(ctx, promise)
  return promise
}

function toTransferableChunk(chunk: AppendablePcmChunk): { channels: Float32Array[]; transferables: Transferable[] } {
  const channels: Float32Array[] = []
  const transferables: Transferable[] = []
  for (const channel of chunk.channels) {
    channels.push(channel)
    if (channel.buffer instanceof ArrayBuffer) {
      transferables.push(channel.buffer)
    }
  }
  return { channels, transferables }
}

function getLeadFrames(
  transport: AppendableTransportClockSnapshot,
  bufferedEndFrame: number,
  queueFramesEstimate: number | null
) {
  const directLeadFrames = Math.max(0, bufferedEndFrame - transport.currentFrame)
  const estimatedLeadFrames =
    typeof queueFramesEstimate === "number" && Number.isFinite(queueFramesEstimate) && queueFramesEstimate > 0
      ? Math.max(0, Math.round(queueFramesEstimate))
      : null
  return estimatedLeadFrames == null ? directLeadFrames : Math.min(directLeadFrames, estimatedLeadFrames)
}

export function sliceAudioBufferToChunk(
  audioBuffer: AudioBuffer,
  startFrame: number,
  frameCount: number,
  opts?: { final?: boolean }
): AppendablePcmChunk | null {
  const durationFrames = Math.max(0, audioBuffer.length)
  const safeStartFrame = clampFrame(startFrame, durationFrames)
  if (safeStartFrame >= durationFrames) return null
  const safeFrameCount = Math.max(1, Math.floor(frameCount))
  const safeEndFrame = Math.min(durationFrames, safeStartFrame + safeFrameCount)
  const actualFrameCount = Math.max(0, safeEndFrame - safeStartFrame)
  if (actualFrameCount <= 0) return null

  return {
    startFrame: safeStartFrame,
    frameCount: actualFrameCount,
    channels: Array.from({ length: Math.max(1, audioBuffer.numberOfChannels) }, (_, index) => {
      const source = audioBuffer.getChannelData(index)
      const copy = new Float32Array(actualFrameCount)
      copy.set(source.subarray(safeStartFrame, safeEndFrame))
      return copy
    }),
    final: opts?.final === true || safeEndFrame >= durationFrames,
  }
}

export function createAudioBufferAppendableSource(audioBuffer: AudioBuffer): AppendablePcmSource {
  const durationFrames = Math.max(0, audioBuffer.length)
  const channelCount = Math.max(1, audioBuffer.numberOfChannels)
  const sourceChannels: Float32Array[] = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index))

  return {
    sampleRate: audioBuffer.sampleRate,
    channelCount,
    durationFrames,
    read(startFrame, frameCount) {
      const safeStartFrame = clampFrame(startFrame, durationFrames)
      if (safeStartFrame >= durationFrames) return { kind: "ended" }
      const safeFrameCount = Math.max(1, Math.floor(frameCount))
      const safeEndFrame = Math.min(durationFrames, safeStartFrame + safeFrameCount)
      const actualFrameCount = Math.max(0, safeEndFrame - safeStartFrame)
      if (actualFrameCount <= 0) return { kind: "ended" }
      const channels = sourceChannels.map((channel) => {
        const copy = new Float32Array(actualFrameCount)
        copy.set(channel.subarray(safeStartFrame, safeEndFrame))
        return copy
      })
      return {
        kind: "chunk",
        chunk: {
          startFrame: safeStartFrame,
          frameCount: actualFrameCount,
          channels,
          final: safeEndFrame >= durationFrames,
        },
      }
    },
    getBufferedUntilFrame() {
      return durationFrames
    },
    isEnded() {
      return true
    },
  }
}

export function createManualAppendablePcmSource(params: {
  sampleRate: number
  channelCount: number
  durationFrames: number
}): ManualAppendablePcmSourceController {
  const sampleRate = Math.max(1, Math.floor(params.sampleRate))
  const channelCount = Math.max(1, Math.floor(params.channelCount))
  const durationFrames = Math.max(0, Math.floor(params.durationFrames))
  let segments: AppendablePcmChunk[] = []
  let ended = false

  const normalizeChunk = (chunk: AppendablePcmChunk): AppendablePcmChunk => {
    const safeStartFrame = clampFrame(chunk.startFrame, durationFrames)
    const safeFrameCount = clamp(chunk.frameCount, 1, Math.max(1, durationFrames - safeStartFrame))
    const safeChannels = Array.from({ length: channelCount }, (_, channelIndex) => {
      const source = chunk.channels[channelIndex] ?? new Float32Array(safeFrameCount)
      if (source.length === safeFrameCount) return source
      const copy = new Float32Array(safeFrameCount)
      copy.set(source.subarray(0, safeFrameCount))
      return copy
    })
    return {
      startFrame: safeStartFrame,
      frameCount: safeFrameCount,
      channels: safeChannels,
      final: chunk.final || safeStartFrame + safeFrameCount >= durationFrames,
    }
  }

  const getBufferedUntilFrame = () => {
    let cursor = 0
    const ordered = segments.slice().sort((a, b) => a.startFrame - b.startFrame)
    for (const segment of ordered) {
      if (segment.startFrame > cursor) break
      cursor = Math.max(cursor, segment.startFrame + segment.frameCount)
    }
    return cursor
  }

  return {
    source: {
      sampleRate,
      channelCount,
      durationFrames,
      read(startFrame, frameCount) {
        const safeStartFrame = clampFrame(startFrame, durationFrames)
        const targetSegment = segments.find(
          (segment) =>
            safeStartFrame >= segment.startFrame && safeStartFrame < segment.startFrame + segment.frameCount
        )
        if (!targetSegment) {
          const bufferedUntilFrame = getBufferedUntilFrame()
          if (ended && safeStartFrame >= bufferedUntilFrame) {
            return { kind: "ended" }
          }
          return { kind: "pending" }
        }

        const offset = safeStartFrame - targetSegment.startFrame
        const actualFrameCount = Math.min(
          Math.max(1, Math.floor(frameCount)),
          Math.max(0, targetSegment.frameCount - offset)
        )
        if (actualFrameCount <= 0) {
          return ended ? { kind: "ended" } : { kind: "pending" }
        }
        const channels = targetSegment.channels.map((channel) => {
          const copy = new Float32Array(actualFrameCount)
          copy.set(channel.subarray(offset, offset + actualFrameCount))
          return copy
        })
        return {
          kind: "chunk",
          chunk: {
            startFrame: safeStartFrame,
            frameCount: actualFrameCount,
            channels,
            final: targetSegment.final && offset + actualFrameCount >= targetSegment.frameCount,
          },
        }
      },
      getBufferedUntilFrame() {
        return getBufferedUntilFrame()
      },
      isEnded() {
        return ended
      },
    },

    appendChunk(chunk) {
      const normalized = normalizeChunk(chunk)
      segments = segments
        .filter((segment) => {
          const segmentEnd = segment.startFrame + segment.frameCount
          const normalizedEnd = normalized.startFrame + normalized.frameCount
          return normalized.startFrame >= segmentEnd || normalizedEnd <= segment.startFrame
        })
        .concat(normalized)
        .sort((a, b) => a.startFrame - b.startFrame)
      if (normalized.final) ended = true
    },

    clear() {
      segments = []
      ended = false
    },

    markEnded() {
      ended = true
    },

    getState() {
      return {
        durationFrames,
        bufferedUntilFrame: getBufferedUntilFrame(),
        queuedSegments: segments.length,
        ended,
      }
    },
  }
}

export async function createAppendableQueueEngine(
  audioCtx: AudioContext,
  source: AppendablePcmSource,
  opts?: CreateAppendableQueueEngineOpts
): Promise<SoundTouchEngine> {
  await ensureAppendableQueueWorkletModule(audioCtx)

  const sampleRate = Math.max(1, Math.floor(source.sampleRate))
  const channelCount = Math.max(1, Math.floor(source.channelCount))
  const durationFrames = Math.max(0, Math.floor(source.durationFrames))
  const durationSec = durationFrames / sampleRate
  const defaultAppendChunkFrames = alignFrames(sampleRate * 0.25)
  const appendChunkFrames = Math.min(
    Math.max(1024, opts?.appendChunkFrames ?? defaultAppendChunkFrames),
    Math.max(1024, alignFrames(sampleRate * 1.5))
  )
  const defaultRingFrames = Math.max(
    appendChunkFrames * 16,
    alignFrames(sampleRate * 6, appendChunkFrames)
  )
  const ringFrames = Math.max(8192, opts?.ringFrames ?? defaultRingFrames)
  const lowWaterCap = Math.max(appendChunkFrames * 2, ringFrames - appendChunkFrames * 3)
  const lowWaterFrames = Math.min(
    lowWaterCap,
    Math.max(appendChunkFrames * 3, opts?.lowWaterFrames ?? alignFrames(sampleRate * 1.25))
  )
  const highWaterFrames = Math.min(
    ringFrames - appendChunkFrames,
    Math.max(lowWaterFrames + appendChunkFrames * 2, opts?.highWaterFrames ?? alignFrames(sampleRate * 2.75))
  )
  const refillTriggerFrames = Math.min(
    highWaterFrames - appendChunkFrames,
    Math.max(lowWaterFrames + appendChunkFrames, Math.floor((lowWaterFrames + highWaterFrames) / 2))
  )
  const refillTickMs = 20
  const normalRefillChunkBudget = 1
  const catchupRefillChunkBudget = 2
  const useExternalTick = opts?.externalTick === true
  const transportClock = createAppendableTransportClock(sampleRate, durationFrames)

  const node = new AudioWorkletNode(audioCtx, "rr-appendable-queue", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channelCount],
    processorOptions: {
      channelCount,
      ringFrames,
    },
  })

  let outputNode: AudioNode | null = null
  let isConnected = false
  let isRunning = false
  let startRequested = false
  let feederTimer: number | null = null
  let pendingStartTimer: number | null = null
  let generation = 0
  let bufferedEndFrame = 0
  let appendCount = 0
  let appendMessageCount = 0
  let appendedFrames = 0
  let appendedBytes = 0
  let droppedFrames = 0
  let lowWaterBreachCount = 0
  let highWaterBreachCount = 0
  let overflowDropCount = 0
  let overflowDroppedFrames = 0
  let minObservedLeadFrames = 0
  let maxObservedLeadFrames = 0
  let hasObservedLeadFrames = false
  let belowLowWaterActive = false
  let aboveHighWaterActive = false
  let sourceEnded = false
  let queueFramesEstimate: number | null = null
  const supportsTempo = channelCount <= 2
  const supportsIndependentPitch = supportsTempo && opts?.enableIndependentPitch === true
  const sabReadiness = detectAppendableQueueSabReadiness()
  let dataPlaneMode: AppendableQueueDataPlaneMode = "postmessage_pcm"
  let sabRing: AppendableQueueSabRing | null = null
  if (sabReadiness.sabReady) {
    try {
      sabRing = createAppendableQueueSabRing({ channelCount, ringFrames })
      resetAppendableQueueSabRing(sabRing, 0)
      node.port.postMessage({
        type: "configureSabRing",
        generation,
        stateSab: sabRing.stateSab,
        dataSabs: sabRing.dataSabs,
      })
      dataPlaneMode = "sab_ring"
    } catch {
      sabRing = null
      dataPlaneMode = "postmessage_pcm"
    }
  }
  let tempo = 1
  let pitchSemitones = 0
  let lastWorkletStats: AppendableQueueWorkletStats = {
    availableFrames: 0,
    minAvailableFrames: 0,
    maxAvailableFrames: 0,
    underrunFrames: 0,
    droppedFrames: 0,
    playedFrame: 0,
    bufferedEndFrame: 0,
    discontinuityCount: 0,
    generation: 0,
    tempo,
    pitchSemitones,
  }

  const emitStats = () => {
    if (typeof opts?.onStats !== "function") return
    if (dataPlaneMode === "sab_ring" && sabRing) {
      queueFramesEstimate = getAppendableQueueSabRingAvailableFrames(sabRing)
    }
    const transport = transportClock.getSnapshot(audioCtx.currentTime)
    const bufferLeadFrames = getLeadFrames(transport, bufferedEndFrame, queueFramesEstimate)
    if (appendCount > 0 || appendedFrames > 0) {
      if (!hasObservedLeadFrames) {
        minObservedLeadFrames = bufferLeadFrames
        maxObservedLeadFrames = bufferLeadFrames
        hasObservedLeadFrames = true
      } else {
        minObservedLeadFrames = Math.min(minObservedLeadFrames, bufferLeadFrames)
        maxObservedLeadFrames = Math.max(maxObservedLeadFrames, bufferLeadFrames)
      }

      const belowLowWater = bufferLeadFrames < lowWaterFrames
      const aboveHighWater = bufferLeadFrames > highWaterFrames
      if (belowLowWater && !belowLowWaterActive) {
        lowWaterBreachCount += 1
      }
      if (aboveHighWater && !aboveHighWaterActive) {
        highWaterBreachCount += 1
      }
      belowLowWaterActive = belowLowWater
      aboveHighWaterActive = aboveHighWater
    } else {
      belowLowWaterActive = false
      aboveHighWaterActive = false
    }
    opts.onStats({
      ...lastWorkletStats,
      sampleRate,
      channelCount,
      supportsIndependentPitch,
      dataPlaneMode,
      controlPlaneMode: APPENDABLE_QUEUE_CONTROL_PLANE_MODE,
      preferredDataPlaneMode: sabReadiness.preferredDataPlaneMode,
      sabCapable: sabReadiness.sabCapable,
      sabReady: sabReadiness.sabReady,
      crossOriginIsolated: sabReadiness.crossOriginIsolated,
      sabRequirement: sabReadiness.sabRequirement,
      generation,
      appendCount,
      appendMessageCount,
      appendedFrames,
      appendedSec: Number((appendedFrames / sampleRate).toFixed(3)),
      appendedBytes,
      bufferLeadFrames,
      bufferLeadSec: Number((bufferLeadFrames / sampleRate).toFixed(3)),
      minObservedLeadFrames,
      minObservedLeadSec: Number((minObservedLeadFrames / sampleRate).toFixed(3)),
      maxObservedLeadFrames,
      maxObservedLeadSec: Number((maxObservedLeadFrames / sampleRate).toFixed(3)),
      targetLeadFrames: highWaterFrames,
      lowWaterFrames,
      lowWaterSec: Number((lowWaterFrames / sampleRate).toFixed(3)),
      highWaterFrames,
      highWaterSec: Number((highWaterFrames / sampleRate).toFixed(3)),
      refillTriggerFrames,
      refillTriggerSec: Number((refillTriggerFrames / sampleRate).toFixed(3)),
      lowWaterBreachCount,
      highWaterBreachCount,
      overflowDropCount,
      overflowDroppedFrames,
      appendChunkFrames,
      ringFrames,
      sourceEnded,
      transportRunning: transport.running,
      transportFrame: transport.currentFrame,
      transportSec: Number(transport.currentSec.toFixed(3)),
      anchorFrame: transport.anchorFrame,
      transportRate: transport.playbackRate,
      tempo,
      pitchSemitones,
    })
  }

  const clearPendingStart = () => {
    if (pendingStartTimer == null) return
    window.clearTimeout(pendingStartTimer)
    pendingStartTimer = null
  }

  node.port.onmessage = (event) => {
    const data = event?.data as Partial<AppendableQueueWorkletStats> | undefined
    if (!data || typeof data !== "object") return
    if (typeof data.generation !== "number" || data.generation !== generation) return
    lastWorkletStats = {
      availableFrames: Math.max(0, Number(data.availableFrames) || 0),
      minAvailableFrames: Math.max(0, Number(data.minAvailableFrames) || 0),
      maxAvailableFrames: Math.max(0, Number(data.maxAvailableFrames) || 0),
      underrunFrames: Math.max(0, Number(data.underrunFrames) || 0),
      droppedFrames: Math.max(droppedFrames, Math.max(0, Number(data.droppedFrames) || 0)),
      playedFrame: Math.max(0, Number(data.playedFrame) || 0),
      bufferedEndFrame: Math.max(0, Number(data.bufferedEndFrame) || 0),
      discontinuityCount: Math.max(0, Number(data.discontinuityCount) || 0),
      generation,
      tempo: Math.min(4, Math.max(0.25, Number(data.tempo) || tempo)),
      pitchSemitones: Math.min(
        12,
        Math.max(
          -12,
          Number.isFinite(data.pitchSemitones) ? Number(data.pitchSemitones) : pitchSemitones
        )
      ),
    }
    tempo = lastWorkletStats.tempo
    pitchSemitones = lastWorkletStats.pitchSemitones
    queueFramesEstimate = lastWorkletStats.availableFrames
    emitStats()
    if (startRequested && !isRunning && lastWorkletStats.availableFrames > 0) {
      tryStartPlayback()
    }
  }

  const connectNode = () => {
    if (!outputNode || isConnected) return
    try {
      node.connect(outputNode)
      isConnected = true
    } catch {}
  }

  const disconnectNode = () => {
    if (!isConnected) return
    try {
      node.disconnect()
    } catch {}
    isConnected = false
  }

  const stopFeeder = () => {
    if (feederTimer == null) return
    window.clearInterval(feederTimer)
    feederTimer = null
  }

  const appendNextChunk = () => {
    const sourceBufferedUntilFrame = source.getBufferedUntilFrame?.()
    const hasBufferedSourceAhead =
      typeof sourceBufferedUntilFrame === "number" &&
      Number.isFinite(sourceBufferedUntilFrame) &&
      sourceBufferedUntilFrame > bufferedEndFrame
    const sourceTerminal = source.isEnded?.() ?? sourceEnded
    if (bufferedEndFrame >= durationFrames || (sourceTerminal && !hasBufferedSourceAhead)) {
      sourceEnded = true
      return 0
    }
    const readResult = source.read(bufferedEndFrame, appendChunkFrames)
    if (readResult.kind === "ended") {
      sourceEnded = true
      return 0
    }
    if (readResult.kind === "pending") {
      sourceEnded = sourceTerminal && !hasBufferedSourceAhead
      return 0
    }
    const chunk = readResult.chunk
    if (chunk.frameCount <= 0) return 0

    const safeStartFrame = clampFrame(chunk.startFrame, durationFrames)
    if (safeStartFrame !== bufferedEndFrame) {
      return 0
    }

    const safeFrameCount = clamp(chunk.frameCount, 1, Math.max(1, durationFrames - safeStartFrame))
    const safeFinal = chunk.final || safeStartFrame + safeFrameCount >= durationFrames
    const chunkBytes = chunk.channels.reduce((sum, channel) => sum + channel.byteLength, 0)

    if (dataPlaneMode === "sab_ring" && sabRing) {
      const result = writeAppendableQueueSabRingChunk(sabRing, {
        frameCount: safeFrameCount,
        channels: chunk.channels,
      })
      if (result.droppedFrames > 0) {
        droppedFrames += result.droppedFrames
        overflowDropCount += 1
        overflowDroppedFrames += result.droppedFrames
      }
      if (result.writtenFrames <= 0) {
        queueFramesEstimate = result.availableFrames
        return 0
      }
      bufferedEndFrame = safeStartFrame + result.writtenFrames
      appendCount += 1
      appendedFrames += result.writtenFrames
      appendedBytes += Math.round((chunkBytes * result.writtenFrames) / safeFrameCount)
      queueFramesEstimate = result.availableFrames
      const bufferedAfterAppend = source.getBufferedUntilFrame?.()
      const hasSourceAheadAfterAppend =
        typeof bufferedAfterAppend === "number" &&
        Number.isFinite(bufferedAfterAppend) &&
        bufferedAfterAppend > bufferedEndFrame
      sourceEnded = result.writtenFrames >= safeFrameCount ? safeFinal && !hasSourceAheadAfterAppend : false
      return result.writtenFrames
    }

    const transferableChunk = toTransferableChunk({
      startFrame: safeStartFrame,
      frameCount: safeFrameCount,
      channels: chunk.channels,
      final: safeFinal,
    })

    try {
      node.port.postMessage(
        {
          type: "append",
          generation,
          startFrame: safeStartFrame,
          frames: safeFrameCount,
          final: safeFinal,
          channels: transferableChunk.channels,
        },
        transferableChunk.transferables
      )
      bufferedEndFrame = safeStartFrame + safeFrameCount
      appendCount += 1
      appendMessageCount += 1
      appendedFrames += safeFrameCount
      appendedBytes += chunkBytes
      const bufferedAfterAppend = source.getBufferedUntilFrame?.()
      const hasSourceAheadAfterAppend =
        typeof bufferedAfterAppend === "number" &&
        Number.isFinite(bufferedAfterAppend) &&
        bufferedAfterAppend > bufferedEndFrame
      sourceEnded = safeFinal && !hasSourceAheadAfterAppend
      return safeFrameCount
    } catch {
      return 0
    }
  }

  const fillToLeadFrames = (targetLeadFrames: number, maxChunks = Number.POSITIVE_INFINITY) => {
    let pushedTotal = 0
    let pushedChunks = 0
    while (pushedChunks < maxChunks) {
      const transport = transportClock.getSnapshot(audioCtx.currentTime)
      const leadFrames = getLeadFrames(transport, bufferedEndFrame, queueFramesEstimate)
      const sourceBufferedUntilFrame = source.getBufferedUntilFrame?.()
      const hasBufferedSourceAhead =
        typeof sourceBufferedUntilFrame === "number" &&
        Number.isFinite(sourceBufferedUntilFrame) &&
        sourceBufferedUntilFrame > bufferedEndFrame
      const sourceExhausted = (source.isEnded?.() ?? sourceEnded) && !hasBufferedSourceAhead
      if (leadFrames >= targetLeadFrames || sourceExhausted) break
      const pushed = appendNextChunk()
      if (!pushed) break
      pushedTotal += pushed
      pushedChunks += 1
    }
    emitStats()
    return pushedTotal
  }

  const resetQueueAtFrame = (frame: number) => {
    const safeFrame = clampFrame(frame, durationFrames)
    generation += 1
    bufferedEndFrame = safeFrame
    appendCount = 0
    appendMessageCount = 0
    appendedFrames = 0
    appendedBytes = 0
    droppedFrames = 0
    lowWaterBreachCount = 0
    highWaterBreachCount = 0
    overflowDropCount = 0
    overflowDroppedFrames = 0
    minObservedLeadFrames = 0
    maxObservedLeadFrames = 0
    hasObservedLeadFrames = false
    belowLowWaterActive = false
    aboveHighWaterActive = false
    sourceEnded = safeFrame >= durationFrames
    queueFramesEstimate = 0
    if (sabRing) {
      resetAppendableQueueSabRing(sabRing, safeFrame)
    }
    lastWorkletStats = {
      availableFrames: 0,
      minAvailableFrames: 0,
      maxAvailableFrames: 0,
      underrunFrames: 0,
      droppedFrames: 0,
      playedFrame: safeFrame,
      bufferedEndFrame: safeFrame,
      discontinuityCount: 0,
      generation,
      tempo,
      pitchSemitones,
    }
    try {
      node.port.postMessage({
        type: "reset",
        generation,
        startFrame: safeFrame,
      })
    } catch {}
    fillToLeadFrames(highWaterFrames)
  }

  const stepFeeder = (plan?: AudioEngineTickPlan) => {
    const transport = transportClock.getSnapshot(audioCtx.currentTime)
    const localLeadFrames = getLeadFrames(transport, bufferedEndFrame, queueFramesEstimate)
    const sharedMinQueueEstimateFrames =
      typeof plan?.sharedMinQueueEstimateFrames === "number" && Number.isFinite(plan.sharedMinQueueEstimateFrames)
        ? Math.max(0, Math.round(plan.sharedMinQueueEstimateFrames))
        : localLeadFrames
    const queueSlackFrames =
      typeof plan?.queueSlackFrames === "number" && Number.isFinite(plan.queueSlackFrames)
        ? Math.max(0, Math.round(plan.queueSlackFrames))
        : Math.floor(appendChunkFrames / 2)
    const chunkBudgetFromPlan =
      typeof plan?.chunkBudget === "number" && Number.isFinite(plan.chunkBudget)
        ? Math.max(normalRefillChunkBudget, Math.round(plan.chunkBudget))
        : null
    const refillChunkBudget = Math.min(
      catchupRefillChunkBudget,
      chunkBudgetFromPlan ?? (localLeadFrames < lowWaterFrames ? catchupRefillChunkBudget : normalRefillChunkBudget)
    )
    const isAheadOfSharedQueue = localLeadFrames > sharedMinQueueEstimateFrames + queueSlackFrames
    const needsRefill = plan?.force === true ? localLeadFrames < highWaterFrames : localLeadFrames < refillTriggerFrames
    if (needsRefill && !isAheadOfSharedQueue) {
      fillToLeadFrames(highWaterFrames, refillChunkBudget)
    }
  }

  const startFeeder = () => {
    if (useExternalTick) return
    stopFeeder()
    feederTimer = window.setInterval(() => stepFeeder(), refillTickMs)
  }

  const schedulePendingStartCheck = () => {
    if (pendingStartTimer != null || !startRequested || isRunning) return
    pendingStartTimer = window.setTimeout(() => {
      pendingStartTimer = null
      tryStartPlayback()
    }, 12)
  }

  let tryStartPlayback: () => void = () => {}
  tryStartPlayback = () => {
    if (!startRequested || isRunning || !outputNode) return
    connectNode()
    const currentFrame = transportClock.getSnapshot(audioCtx.currentTime).currentFrame
    const leadFrames = getLeadFrames(transportClock.getSnapshot(audioCtx.currentTime), bufferedEndFrame, queueFramesEstimate)
    if (bufferedEndFrame <= currentFrame || leadFrames <= 0) {
      resetQueueAtFrame(currentFrame)
    }

    const availableFrames = Math.max(0, lastWorkletStats.availableFrames, queueFramesEstimate ?? 0)
    if (availableFrames <= 0 && !sourceEnded) {
      startFeeder()
      schedulePendingStartCheck()
      emitStats()
      return
    }

    clearPendingStart()
    transportClock.start(audioCtx.currentTime)
    isRunning = true
    startRequested = false
    try {
      node.port.postMessage({ type: "setPlaying", generation, playing: true })
    } catch {}
    startFeeder()
    emitStats()
  }

  return {
    getCapabilities() {
      return {
        supportsTempo,
        supportsIndependentPitch,
      }
    },

    connect(nodeOut: AudioNode) {
      outputNode = nodeOut
      if (isRunning) connectNode()
    },

    disconnect() {
      disconnectNode()
      outputNode = null
      isRunning = false
      startRequested = false
      stopFeeder()
      clearPendingStart()
      transportClock.pause(audioCtx.currentTime)
      try {
        node.port.postMessage({ type: "setPlaying", generation, playing: false })
      } catch {}
    },

    start() {
      if (isRunning || startRequested || !outputNode) return
      startRequested = true
      tryStartPlayback()
    },

    stop() {
      if (!isRunning && !startRequested) return
      clearPendingStart()
      startRequested = false
      transportClock.pause(audioCtx.currentTime)
      isRunning = false
      stopFeeder()
      try {
        node.port.postMessage({ type: "setPlaying", generation, playing: false })
      } catch {}
      emitStats()
    },

    seekSeconds(sec: number) {
      const nextFrame = clampFrame(Math.floor(clamp(sec, 0, durationSec) * sampleRate), durationFrames)
      const shouldResume = isRunning || startRequested
      if (isRunning) {
        try {
          node.port.postMessage({ type: "setPlaying", generation, playing: false })
        } catch {}
      }
      clearPendingStart()
      startRequested = false
      isRunning = false
      transportClock.seek(nextFrame, audioCtx.currentTime)
      resetQueueAtFrame(nextFrame)
      if (shouldResume) {
        startRequested = true
        tryStartPlayback()
      }
      emitStats()
    },

    getSourcePositionSeconds() {
      return transportClock.getSnapshot(audioCtx.currentTime).currentSec
    },

    getDurationSeconds() {
      return durationSec
    },

    getBufferedSeconds() {
      const transport = transportClock.getSnapshot(audioCtx.currentTime)
      return getLeadFrames(transport, bufferedEndFrame, queueFramesEstimate) / sampleRate
    },

    getDebugState() {
      const transport = transportClock.getSnapshot(audioCtx.currentTime)
      if (dataPlaneMode === "sab_ring" && sabRing) {
        queueFramesEstimate = getAppendableQueueSabRingAvailableFrames(sabRing)
      }
      const bufferLeadFrames = getLeadFrames(transport, bufferedEndFrame, queueFramesEstimate)
      return {
        sampleRate,
        channelCount,
        dataPlaneMode,
        controlPlaneMode: APPENDABLE_QUEUE_CONTROL_PLANE_MODE,
        preferredDataPlaneMode: sabReadiness.preferredDataPlaneMode,
        sabCapable: sabReadiness.sabCapable,
        sabReady: sabReadiness.sabReady,
        crossOriginIsolated: sabReadiness.crossOriginIsolated,
        sabRequirement: sabReadiness.sabRequirement,
        generation,
        appendCount,
        appendMessageCount,
        appendedFrames,
        appendedSec: Number((appendedFrames / sampleRate).toFixed(3)),
        appendedBytes,
        bufferLeadFrames,
        bufferLeadSec: Number((bufferLeadFrames / sampleRate).toFixed(3)),
        minObservedLeadFrames,
        minObservedLeadSec: Number((minObservedLeadFrames / sampleRate).toFixed(3)),
        maxObservedLeadFrames,
        maxObservedLeadSec: Number((maxObservedLeadFrames / sampleRate).toFixed(3)),
        transportFrame: transport.currentFrame,
        transportSec: Number(transport.currentSec.toFixed(3)),
        anchorFrame: transport.anchorFrame,
        transportRate: transport.playbackRate,
        tempo,
        pitchSemitones,
        sourceEnded: sourceEnded ? 1 : 0,
        supportsIndependentPitch: supportsIndependentPitch ? 1 : 0,
        lowWaterFrames,
        lowWaterSec: Number((lowWaterFrames / sampleRate).toFixed(3)),
        highWaterFrames,
        highWaterSec: Number((highWaterFrames / sampleRate).toFixed(3)),
        refillTriggerFrames,
        refillTriggerSec: Number((refillTriggerFrames / sampleRate).toFixed(3)),
        lowWaterBreachCount,
        highWaterBreachCount,
        overflowDropCount,
        overflowDroppedFrames,
        appendChunkFrames,
        ringFrames,
        availableFrames: lastWorkletStats.availableFrames,
        underrunFrames: lastWorkletStats.underrunFrames,
        droppedFrames: Math.max(lastWorkletStats.droppedFrames, droppedFrames),
        discontinuityCount: lastWorkletStats.discontinuityCount,
      }
    },

    tickPlayback(plan) {
      if (!useExternalTick) return
      stepFeeder(plan)
    },

    setTempo(_tempo: number) {
      if (!supportsTempo) return
      tempo = clamp(_tempo, 0.25, 4)
      transportClock.setRate(tempo, audioCtx.currentTime)
      try {
        node.port.postMessage({ type: "setTempo", generation, tempo })
      } catch {}
      emitStats()
    },

    setPitchSemitones(_semitones: number) {
      if (!supportsIndependentPitch) return
      pitchSemitones = Math.min(12, Math.max(-12, Math.round(_semitones)))
      try {
        node.port.postMessage({ type: "setPitchSemitones", generation, pitchSemitones })
      } catch {}
      emitStats()
    },

    destroy() {
      clearPendingStart()
      startRequested = false
      stopFeeder()
      disconnectNode()
      try {
        node.port.postMessage({ type: "setPlaying", generation, playing: false })
      } catch {}
      try {
        node.disconnect()
      } catch {}
      outputNode = null
      isRunning = false
      isConnected = false
    },
  }
}
