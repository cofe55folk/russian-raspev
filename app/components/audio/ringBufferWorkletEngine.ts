"use client"

import type { AudioEngineTickPlan, SoundTouchEngine } from "./soundtouchEngine"

export type RingBufferWorkletStats = {
  availableFrames: number
  minAvailableFrames: number
  maxAvailableFrames: number
  underrunFrames: number
  underrunDeltaFrames: number
  droppedFrames: number
  droppedDeltaFrames: number
  queueEstimateFrames: number
  fillRatio: number
  lowWaterFrames: number
  highWaterFrames: number
  refillTriggerFrames: number
  ringFrames: number
  refillCount: number
  pushCount: number
  sourceFrameCursorFrames: number
  sourceFrameCursorSec: number
  readWrapCount: number
  writeWrapCount: number
  lastReadWrapDeltaMax: number
}

type CreateRingBufferWorkletEngineOpts = {
  ringFrames?: number
  pushChunkFrames?: number
  lowWaterFrames?: number
  highWaterFrames?: number
  externalTick?: boolean
  onStats?: (payload: RingBufferWorkletStats) => void
}

const WORKLET_MODULE_PATH = "/worklets/rr-ring-buffer-processor.js"
const moduleLoadPromiseByCtx = new WeakMap<AudioContext, Promise<void>>()

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

function alignFrames(n: number, quantum = 1024) {
  return Math.max(quantum, Math.ceil(n / quantum) * quantum)
}

function ensureRingBufferWorkletModule(ctx: AudioContext): Promise<void> {
  const existing = moduleLoadPromiseByCtx.get(ctx)
  if (existing) return existing
  const promise = ctx.audioWorklet.addModule(WORKLET_MODULE_PATH)
  moduleLoadPromiseByCtx.set(ctx, promise)
  return promise
}

export async function createRingBufferWorkletEngine(
  audioCtx: AudioContext,
  audioBuffer: AudioBuffer,
  opts?: CreateRingBufferWorkletEngineOpts
): Promise<SoundTouchEngine> {
  await ensureRingBufferWorkletModule(audioCtx)

  const source = audioBuffer
  const channelCount = source.numberOfChannels
  const sampleRate = source.sampleRate
  const durationSec = source.duration || 0
  const maxFrame = Math.max(0, source.length)
  const srcChannels: Float32Array[] = Array.from({ length: channelCount }, (_, ch) => source.getChannelData(ch))

  const defaultPushChunkFrames = alignFrames(sampleRate * 0.2)
  const defaultRingFrames = Math.max(defaultPushChunkFrames * 16, alignFrames(sampleRate * 5.5, defaultPushChunkFrames))
  const ringFrames = Math.max(8192, opts?.ringFrames ?? defaultRingFrames)
  const pushChunkFrames = Math.min(
    Math.max(1024, opts?.pushChunkFrames ?? defaultPushChunkFrames),
    Math.max(1024, Math.floor(ringFrames / 8))
  )
  const lowWaterCap = Math.max(pushChunkFrames * 2, ringFrames - pushChunkFrames * 3)
  const lowWaterFrames = Math.min(
    lowWaterCap,
    Math.max(pushChunkFrames * 4, opts?.lowWaterFrames ?? alignFrames(sampleRate * 1.35))
  )
  const highWaterFrames = Math.min(
    ringFrames - pushChunkFrames,
    Math.max(lowWaterFrames + pushChunkFrames * 4, opts?.highWaterFrames ?? alignFrames(sampleRate * 2.7))
  )
  const refillTriggerFrames = Math.min(
    highWaterFrames - pushChunkFrames,
    Math.max(lowWaterFrames + pushChunkFrames, Math.floor((lowWaterFrames + highWaterFrames) / 2))
  )
  const refillTickMs = 20
  const normalRefillChunkBudget = 1
  const catchupRefillChunkBudget = 2
  const useExternalTick = opts?.externalTick === true

  const node = new AudioWorkletNode(audioCtx, "rr-ring-buffer", {
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
  let feederTimer: number | null = null

  let currentSec = 0
  let playAnchorSec = 0
  let playAnchorCtxTime = 0
  let sourceFrameCursor = 0
  let queueFramesEstimate = 0
  let lastQueueEstimateCtxTime = 0
  let pushCount = 0
  let refillCount = 0
  let lastUnderrunFrames = 0
  let lastDroppedFrames = 0
  let readWrapCount = 0
  let writeWrapCount = 0
  let lastReadWrapDeltaMax = 0

  const emitStats = (data: {
    availableFrames: number
    minAvailableFrames: number
    maxAvailableFrames: number
    underrunFrames: number
    droppedFrames: number
  }) => {
    if (typeof opts?.onStats !== "function") return
    const availableFrames = Math.max(0, Number(data.availableFrames) || 0)
    const underrunFrames = Math.max(0, Number(data.underrunFrames) || 0)
    const droppedFrames = Math.max(0, Number(data.droppedFrames) || 0)
    const underrunDeltaFrames = Math.max(0, underrunFrames - lastUnderrunFrames)
    const droppedDeltaFrames = Math.max(0, droppedFrames - lastDroppedFrames)
    lastUnderrunFrames = underrunFrames
    lastDroppedFrames = droppedFrames

    opts.onStats({
      availableFrames,
      minAvailableFrames: Math.max(0, Number(data.minAvailableFrames) || availableFrames),
      maxAvailableFrames: Math.max(0, Number(data.maxAvailableFrames) || availableFrames),
      underrunFrames,
      underrunDeltaFrames,
      droppedFrames,
      droppedDeltaFrames,
      queueEstimateFrames: Math.max(0, Math.round(queueFramesEstimate)),
      fillRatio: Number((availableFrames / ringFrames).toFixed(4)),
      lowWaterFrames,
      highWaterFrames,
      refillTriggerFrames,
      ringFrames,
      refillCount,
      pushCount,
      sourceFrameCursorFrames: sourceFrameCursor,
      sourceFrameCursorSec: Number((sourceFrameCursor / sampleRate).toFixed(3)),
      readWrapCount,
      writeWrapCount,
      lastReadWrapDeltaMax: Number(lastReadWrapDeltaMax.toFixed(6)),
    })
  }

  node.port.onmessage = (event) => {
    const data = event?.data
    if (!data || typeof data !== "object") return
    if (data.type !== "stats") return
    const availableFrames = Math.max(0, Number(data.availableFrames) || 0)
    queueFramesEstimate = availableFrames
    readWrapCount = Math.max(0, Number(data.readWrapCount) || 0)
    writeWrapCount = Math.max(0, Number(data.writeWrapCount) || 0)
    lastReadWrapDeltaMax = Math.max(0, Number(data.lastReadWrapDeltaMax) || 0)
    emitStats({
      availableFrames,
      minAvailableFrames: Number(data.minAvailableFrames) || 0,
      maxAvailableFrames: Number(data.maxAvailableFrames) || 0,
      underrunFrames: Number(data.underrunFrames) || 0,
      droppedFrames: Number(data.droppedFrames) || 0,
    })
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
    clearInterval(feederTimer)
    feederTimer = null
  }

  const updateQueueEstimate = () => {
    if (!isRunning) return
    const now = audioCtx.currentTime
    const elapsed = Math.max(0, now - lastQueueEstimateCtxTime)
    lastQueueEstimateCtxTime = now
    if (elapsed <= 0) return
    const consumedFrames = elapsed * sampleRate
    queueFramesEstimate = Math.max(0, queueFramesEstimate - consumedFrames)
  }

  const pushChunk = () => {
    const available = maxFrame - sourceFrameCursor
    if (available <= 0) return 0
    const frames = Math.min(pushChunkFrames, available)
    const channelPayload: Float32Array[] = []
    const transferables: ArrayBuffer[] = []

    for (let ch = 0; ch < channelCount; ch += 1) {
      const copy = new Float32Array(frames)
      copy.set(srcChannels[ch].subarray(sourceFrameCursor, sourceFrameCursor + frames))
      channelPayload.push(copy)
      transferables.push(copy.buffer)
    }

    try {
      node.port.postMessage(
        {
          type: "push",
          frames,
          channels: channelPayload,
        },
        transferables
      )
      sourceFrameCursor += frames
      queueFramesEstimate += frames
      pushCount += 1
      return frames
    } catch {
      return 0
    }
  }

  const fillQueueTo = (targetFrames: number, maxChunks = Number.POSITIVE_INFINITY) => {
    let pushedTotal = 0
    let pushedChunks = 0
    while (queueFramesEstimate < targetFrames && pushedChunks < maxChunks) {
      const pushed = pushChunk()
      if (!pushed) break
      pushedTotal += pushed
      pushedChunks += 1
    }
    return pushedTotal
  }

  const clampSec = (sec: number) => clamp(sec, 0, durationSec || sec)

  const primeFrom = (sec: number) => {
    currentSec = clampSec(sec)
    sourceFrameCursor = Math.floor(currentSec * sampleRate)
    queueFramesEstimate = 0
    lastQueueEstimateCtxTime = audioCtx.currentTime
    lastUnderrunFrames = 0
    lastDroppedFrames = 0
    refillCount = 0
    pushCount = 0
    try {
      node.port.postMessage({ type: "reset" })
    } catch {}
    fillQueueTo(highWaterFrames)
  }

  const stepFeeder = (plan?: AudioEngineTickPlan) => {
    if (!isRunning) return
    updateQueueEstimate()
    const sharedMinQueueEstimateFrames =
      typeof plan?.sharedMinQueueEstimateFrames === "number" && Number.isFinite(plan.sharedMinQueueEstimateFrames)
        ? Math.max(0, Math.round(plan.sharedMinQueueEstimateFrames))
        : Math.max(0, Math.round(queueFramesEstimate))
    const queueSlackFrames =
      typeof plan?.queueSlackFrames === "number" && Number.isFinite(plan.queueSlackFrames)
        ? Math.max(0, Math.round(plan.queueSlackFrames))
        : Math.floor(pushChunkFrames / 2)
    const chunkBudgetFromPlan =
      typeof plan?.chunkBudget === "number" && Number.isFinite(plan.chunkBudget)
        ? Math.max(normalRefillChunkBudget, Math.round(plan.chunkBudget))
        : null
    const refillChunkBudget = Math.min(
      catchupRefillChunkBudget,
      chunkBudgetFromPlan ?? (queueFramesEstimate < lowWaterFrames ? catchupRefillChunkBudget : normalRefillChunkBudget)
    )
    const localQueueEstimateFrames = Math.max(0, Math.round(queueFramesEstimate))
    const isAheadOfSharedQueue = localQueueEstimateFrames > sharedMinQueueEstimateFrames + queueSlackFrames
    const needsRefill = plan?.force === true ? localQueueEstimateFrames < highWaterFrames : queueFramesEstimate < refillTriggerFrames

    if (needsRefill && !isAheadOfSharedQueue) {
      const pushedFrames = fillQueueTo(highWaterFrames, refillChunkBudget)
      if (pushedFrames > 0) refillCount += 1
    }
  }

  const startFeeder = () => {
    if (useExternalTick) return
    stopFeeder()
    lastQueueEstimateCtxTime = audioCtx.currentTime
    feederTimer = setInterval(stepFeeder, refillTickMs) as unknown as number
  }

  const getRuntimePositionSec = () => {
    if (!isRunning) return currentSec
    const now = audioCtx.currentTime
    const elapsed = Math.max(0, now - playAnchorCtxTime)
    return clampSec(playAnchorSec + elapsed)
  }

  return {
    getCapabilities() {
      return {
        supportsTempo: false,
        supportsIndependentPitch: false,
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
      stopFeeder()
      try {
        node.port.postMessage({ type: "setPlaying", playing: false })
      } catch {}
    },

    start() {
      if (isRunning) return
      primeFrom(currentSec)
      isRunning = true
      playAnchorSec = currentSec
      playAnchorCtxTime = audioCtx.currentTime
      lastQueueEstimateCtxTime = audioCtx.currentTime
      connectNode()
      try {
        node.port.postMessage({ type: "setPlaying", playing: true })
      } catch {}
      startFeeder()
    },

    stop() {
      if (!isRunning) return
      currentSec = getRuntimePositionSec()
      isRunning = false
      stopFeeder()
      try {
        node.port.postMessage({ type: "setPlaying", playing: false })
      } catch {}
    },

    seekSeconds(sec: number) {
      const nextSec = clampSec(sec)
      currentSec = nextSec
      primeFrom(nextSec)
      if (isRunning) {
        playAnchorSec = nextSec
        playAnchorCtxTime = audioCtx.currentTime
        lastQueueEstimateCtxTime = audioCtx.currentTime
        try {
          node.port.postMessage({ type: "setPlaying", playing: true })
        } catch {}
      }
    },

    getSourcePositionSeconds() {
      return getRuntimePositionSec()
    },

    getDurationSeconds() {
      return durationSec
    },

    getBufferedSeconds() {
      return Math.max(0, queueFramesEstimate / sampleRate)
    },

    getDebugState() {
      return {
        queueEstimateFrames: Math.max(0, Math.round(queueFramesEstimate)),
        queueEstimateSec: Number((Math.max(0, queueFramesEstimate) / sampleRate).toFixed(3)),
        pushCount,
        refillCount,
        sourceFrameCursorFrames: sourceFrameCursor,
        sourceFrameCursorSec: Number((sourceFrameCursor / sampleRate).toFixed(3)),
        pushChunkFrames,
        pushChunkSec: Number((pushChunkFrames / sampleRate).toFixed(3)),
        lowWaterFrames,
        lowWaterSec: Number((lowWaterFrames / sampleRate).toFixed(3)),
        highWaterFrames,
        highWaterSec: Number((highWaterFrames / sampleRate).toFixed(3)),
        refillTriggerFrames,
        refillTriggerSec: Number((refillTriggerFrames / sampleRate).toFixed(3)),
        readWrapCount,
        writeWrapCount,
        lastReadWrapDeltaMax: Number(lastReadWrapDeltaMax.toFixed(6)),
      }
    },

    tickPlayback(plan) {
      if (!useExternalTick) return
      stepFeeder(plan)
    },

    setTempo(_tempo: number) {
      // Pilot limitation: tempo is not yet time-stretched in ring-buffer mode.
    },

    setPitchSemitones(_semitones: number) {
      // Pilot limitation: independent pitch-shift is unavailable in ring-buffer mode.
    },

    destroy() {
      stopFeeder()
      disconnectNode()
      try {
        node.port.postMessage({ type: "setPlaying", playing: false })
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
