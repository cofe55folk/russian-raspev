"use client"

import { createAppendableTransportClock, type AppendableTransportClock } from "./appendableTransportClock"
import type {
  AppendableQueueControlPlaneMode,
  AppendableQueueDataPlaneMode,
  AppendableQueueDebugStats,
  AppendableQueuePreferredDataPlaneMode,
  AppendableQueueSabRequirement,
} from "./appendableQueueEngine"
import type { SoundTouchEngine } from "./soundtouchEngine"

export type AppendableQueueCoordinatorStem = {
  stemIndex: number
  label: string
  engine: SoundTouchEngine
  engineInstanceId?: number | null
  getLastStats?: () => AppendableQueueDebugStats | null
  getSourceBufferedUntilSec?: () => number
  getSourceQueuedSegments?: () => number
  isSourceEnded?: () => boolean
  isStartupAppended?: () => boolean
  isFullAppended?: () => boolean
  isFullDecoded?: () => boolean
}

export type AppendableQueueCoordinatorStemSnapshot = {
  stemIndex: number
  label: string
  engineInstanceId: number | null
  currentSec: number
  startupAppended: boolean
  fullAppended: boolean
  fullDecoded: boolean
  sourceBufferedUntilSec: number
  sourceQueuedSegments: number
  sourceEnded: boolean
  stats: AppendableQueueDebugStats | null
}

export type AppendableQueueCoordinatorSnapshot = {
  playing: boolean
  tempo: number
  dataPlaneMode: string | null
  controlPlaneMode: string | null
  preferredDataPlaneMode: string | null
  sabCapable: boolean | null
  sabReady: boolean | null
  crossOriginIsolated: boolean | null
  sabRequirement: string | null
  sampleRates: number[]
  totalAppendMessages: number
  totalAppendedBytes: number
  transportSec: number
  durationSec: number
  stemCount: number
  allStartupAppended: boolean
  allFullDecoded: boolean
  allFullAppended: boolean
  stems: AppendableQueueCoordinatorStemSnapshot[]
  sync: {
    stemDriftSec: number
    transportDriftSec: number
    minLeadSec: number
    maxLeadSec: number
    totalUnderrunFrames: number
    totalDiscontinuityCount: number
  }
}

export type AppendableQueueMultitrackCoordinator = {
  start: () => void
  pause: () => void
  seekSeconds: (sec: number) => number
  rebaseSeconds: (sec: number) => number
  setTempo: (tempo: number) => number
  tick: (opts?: { force?: boolean }) => void
  isPlaying: () => boolean
  getSnapshot: () => AppendableQueueCoordinatorSnapshot
  getTransportClock: () => AppendableTransportClock
}

type CreateAppendableQueueMultitrackCoordinatorOpts = {
  ctx: AudioContext
  sampleRate: number
  durationFrames: number
  stems: AppendableQueueCoordinatorStem[]
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

function toFiniteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value
  if (value === 1 || value === "1" || value === "true") return true
  if (value === 0 || value === "0" || value === "false") return false
  return fallback
}

function readStatsFromEngine(engine: SoundTouchEngine): AppendableQueueDebugStats | null {
  const debugState = engine.getDebugState?.()
  if (!debugState || typeof debugState !== "object") return null
  const stats = debugState as Record<string, number | string | boolean | null | undefined>
  const availableFrames = toFiniteNumber(stats.availableFrames, 0)
  const bufferLeadFrames = toFiniteNumber(stats.bufferLeadFrames, 0)
  const bufferLeadSec = toFiniteNumber(stats.bufferLeadSec, 0)
  const discontinuityCount = toFiniteNumber(stats.discontinuityCount, 0)
  const underrunFrames = toFiniteNumber(stats.underrunFrames, 0)
  const appendCount = toFiniteNumber(stats.appendCount, 0)
  const appendedFrames = toFiniteNumber(stats.appendedFrames, 0)
  if (
    availableFrames <= 0 &&
    bufferLeadFrames <= 0 &&
    bufferLeadSec <= 0 &&
    underrunFrames <= 0 &&
    discontinuityCount <= 0 &&
    appendCount <= 0 &&
    appendedFrames <= 0
  ) {
    return null
  }
  return {
    availableFrames,
    sampleRate: toFiniteNumber(stats.sampleRate, 0),
    channelCount: toFiniteNumber(stats.channelCount, 0),
    dataPlaneMode:
      typeof stats.dataPlaneMode === "string" ? (stats.dataPlaneMode as AppendableQueueDataPlaneMode) : "postmessage_pcm",
    controlPlaneMode:
      typeof stats.controlPlaneMode === "string"
        ? (stats.controlPlaneMode as AppendableQueueControlPlaneMode)
        : "message_port",
    preferredDataPlaneMode:
      typeof stats.preferredDataPlaneMode === "string"
        ? (stats.preferredDataPlaneMode as AppendableQueuePreferredDataPlaneMode)
        : "postmessage_pcm_fallback",
    sabCapable: toBoolean(stats.sabCapable, false),
    sabReady: toBoolean(stats.sabReady, false),
    crossOriginIsolated: toBoolean(stats.crossOriginIsolated, false),
    sabRequirement:
      typeof stats.sabRequirement === "string" ? (stats.sabRequirement as AppendableQueueSabRequirement) : null,
    minAvailableFrames: toFiniteNumber(stats.minAvailableFrames, availableFrames),
    maxAvailableFrames: toFiniteNumber(stats.maxAvailableFrames, availableFrames),
    underrunFrames,
    droppedFrames: toFiniteNumber(stats.droppedFrames, 0),
    playedFrame: toFiniteNumber(stats.playedFrame, 0),
    bufferedEndFrame: toFiniteNumber(stats.bufferedEndFrame, 0),
    discontinuityCount,
    generation: toFiniteNumber(stats.generation, 0),
    appendCount,
    appendMessageCount: toFiniteNumber(stats.appendMessageCount, appendCount),
    appendedFrames,
    appendedSec: toFiniteNumber(stats.appendedSec, 0),
    appendedBytes: toFiniteNumber(stats.appendedBytes, 0),
    bufferLeadFrames,
    bufferLeadSec,
    targetLeadFrames: toFiniteNumber(stats.targetLeadFrames, 0),
    lowWaterFrames: toFiniteNumber(stats.lowWaterFrames, 0),
    highWaterFrames: toFiniteNumber(stats.highWaterFrames, 0),
    refillTriggerFrames: toFiniteNumber(stats.refillTriggerFrames, 0),
    appendChunkFrames: toFiniteNumber(stats.appendChunkFrames, 0),
    ringFrames: toFiniteNumber(stats.ringFrames, 0),
    sourceEnded: stats.sourceEnded === 1 || stats.sourceEnded === "1" || stats.sourceEnded === "true",
    transportRunning:
      stats.transportRunning === 1 || stats.transportRunning === "1" || stats.transportRunning === "true",
    transportFrame: toFiniteNumber(stats.transportFrame, 0),
    transportSec: toFiniteNumber(stats.transportSec, 0),
    anchorFrame: toFiniteNumber(stats.anchorFrame, 0),
    transportRate: toFiniteNumber(stats.transportRate, 1),
    tempo: toFiniteNumber(stats.tempo, 1),
  }
}

function getStemStats(stem: AppendableQueueCoordinatorStem) {
  return stem.getLastStats?.() ?? readStatsFromEngine(stem.engine)
}

export function createAppendableQueueMultitrackCoordinator(
  opts: CreateAppendableQueueMultitrackCoordinatorOpts
): AppendableQueueMultitrackCoordinator {
  const ctx = opts.ctx
  const sampleRate = Math.max(1, Math.floor(opts.sampleRate))
  const durationFrames = Math.max(0, Math.floor(opts.durationFrames))
  const durationSec = durationFrames / sampleRate
  const stems = opts.stems
  const transportClock = createAppendableTransportClock(sampleRate, durationFrames)
  let playing = false
  let tempo = 1

  const computeTickPlan = (force = false) => {
    const stats = stems.map((stem) => getStemStats(stem)).filter((value): value is AppendableQueueDebugStats => !!value)
    const sharedMinQueueEstimateFrames = stats.length
      ? Math.min(...stats.map((value) => Math.max(0, value.bufferLeadFrames)))
      : Math.max(
          0,
          Math.floor(
            Math.min(
              ...stems.map((stem) => {
                const bufferedSec = stem.engine.getBufferedSeconds?.()
                return typeof bufferedSec === "number" && Number.isFinite(bufferedSec) ? bufferedSec : durationSec
              })
            ) * sampleRate
          )
        )
    const lowWaterFrames = stats
      .map((value) => value.lowWaterFrames)
      .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
    const appendChunkFrames = stats
      .map((value) => value.appendChunkFrames)
      .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
    const minLowWaterFrames = lowWaterFrames.length ? Math.min(...lowWaterFrames) : Math.floor(sampleRate * 1.25)
    const maxAppendChunkFrames = appendChunkFrames.length ? Math.max(...appendChunkFrames) : Math.floor(sampleRate * 0.25)
    return {
      sharedMinQueueEstimateFrames,
      queueSlackFrames: Math.max(1024, Math.floor(maxAppendChunkFrames / 2), Math.floor(sampleRate * 0.08)),
      chunkBudget: force || sharedMinQueueEstimateFrames < minLowWaterFrames ? 2 : 1,
      force,
    }
  }

  const tick = (tickOpts?: { force?: boolean }) => {
    const plan = computeTickPlan(tickOpts?.force === true)
    stems.forEach((stem) => {
      try {
        stem.engine.tickPlayback?.(plan)
      } catch {}
    })
  }

  const moveAllToSec = (sec: number, mode: "seek" | "rebase") => {
    const safeSec = clamp(sec, 0, durationSec)
    const nextFrame = Math.floor(safeSec * sampleRate)
    const wasPlaying = playing
    if (wasPlaying) {
      transportClock.pause(ctx.currentTime)
    }
    if (mode === "rebase") {
      transportClock.rebase(nextFrame, ctx.currentTime)
    } else {
      transportClock.seek(nextFrame, ctx.currentTime)
    }
    stems.forEach((stem) => {
      stem.engine.seekSeconds(safeSec)
    })
    tick({ force: true })
    if (wasPlaying) {
      transportClock.start(ctx.currentTime)
    }
    return safeSec
  }

  return {
    start() {
      if (playing) return
      transportClock.start(ctx.currentTime)
      stems.forEach((stem) => {
        try {
          stem.engine.start()
        } catch {}
      })
      playing = true
      tick({ force: true })
    },

    pause() {
      if (!playing) return
      transportClock.pause(ctx.currentTime)
      stems.forEach((stem) => {
        try {
          stem.engine.stop()
        } catch {}
      })
      playing = false
    },

    seekSeconds(sec: number) {
      return moveAllToSec(sec, "seek")
    },

    rebaseSeconds(sec: number) {
      return moveAllToSec(sec, "rebase")
    },

    setTempo(nextTempo: number) {
      tempo = clamp(nextTempo, 0.25, 4)
      transportClock.setRate(tempo, ctx.currentTime)
      stems.forEach((stem) => {
        try {
          stem.engine.setTempo(tempo)
        } catch {}
      })
      return tempo
    },

    tick,

    isPlaying() {
      return playing
    },

    getSnapshot() {
      const transport = transportClock.getSnapshot(ctx.currentTime)
      const stemSnapshots: AppendableQueueCoordinatorStemSnapshot[] = stems.map((stem) => {
        const stats = getStemStats(stem)
        const sourceBufferedUntilSec = toFiniteNumber(stem.getSourceBufferedUntilSec?.(), durationSec)
        return {
          stemIndex: stem.stemIndex,
          label: stem.label,
          engineInstanceId: stem.engineInstanceId ?? null,
          currentSec: Number(stem.engine.getSourcePositionSeconds().toFixed(3)),
          startupAppended: stem.isStartupAppended?.() ?? false,
          fullAppended: stem.isFullAppended?.() ?? false,
          fullDecoded: stem.isFullDecoded?.() ?? false,
          sourceBufferedUntilSec: Number(sourceBufferedUntilSec.toFixed(3)),
          sourceQueuedSegments: Math.max(0, Math.floor(toFiniteNumber(stem.getSourceQueuedSegments?.(), 0))),
          sourceEnded: stem.isSourceEnded?.() ?? false,
          stats,
        }
      })
      const stemCurrentSecs = stemSnapshots.map((stem) => stem.currentSec)
      const stemLeadSecs = stemSnapshots.map((stem) => {
        if (stem.stats) return stem.stats.bufferLeadSec
        return Math.max(0, stem.sourceBufferedUntilSec - transport.currentSec)
      })
      const dataPlaneModes = Array.from(
        new Set(
          stemSnapshots
            .map((stem) => stem.stats?.dataPlaneMode)
            .filter(
              (value): value is AppendableQueueDataPlaneMode => typeof value === "string" && value.length > 0
            )
        )
      )
      const controlPlaneModes = Array.from(
        new Set(
          stemSnapshots
            .map((stem) => stem.stats?.controlPlaneMode)
            .filter(
              (value): value is AppendableQueueControlPlaneMode => typeof value === "string" && value.length > 0
            )
        )
      )
      const sampleRates = Array.from(
        new Set(
          stemSnapshots
            .map((stem) => stem.stats?.sampleRate)
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
        )
      ).sort((a, b) => a - b)
      const preferredDataPlaneModes = Array.from(
        new Set(
          stemSnapshots
            .map((stem) => stem.stats?.preferredDataPlaneMode)
            .filter(
              (value): value is AppendableQueuePreferredDataPlaneMode => typeof value === "string" && value.length > 0
            )
        )
      )
      const sabRequirements = Array.from(
        new Set(
          stemSnapshots
            .map((stem) => stem.stats?.sabRequirement)
            .filter((value): value is AppendableQueueSabRequirement => typeof value === "string" && value.length > 0)
        )
      )
      const sabCapableStates = Array.from(
        new Set(
          stemSnapshots
            .map((stem) => stem.stats?.sabCapable)
            .filter((value): value is boolean => typeof value === "boolean")
        )
      )
      const sabReadyStates = Array.from(
        new Set(
          stemSnapshots
            .map((stem) => stem.stats?.sabReady)
            .filter((value): value is boolean => typeof value === "boolean")
        )
      )
      const crossOriginIsolatedStates = Array.from(
        new Set(
          stemSnapshots
            .map((stem) => stem.stats?.crossOriginIsolated)
            .filter((value): value is boolean => typeof value === "boolean")
        )
      )
      const totalAppendMessages = stemSnapshots.reduce(
        (sum, stem) => sum + (typeof stem.stats?.appendMessageCount === "number" ? stem.stats.appendMessageCount : 0),
        0
      )
      const totalAppendedBytes = stemSnapshots.reduce(
        (sum, stem) => sum + (typeof stem.stats?.appendedBytes === "number" ? stem.stats.appendedBytes : 0),
        0
      )
      return {
        playing,
        tempo: Number(tempo.toFixed(3)),
        dataPlaneMode:
          dataPlaneModes.length === 1 ? (dataPlaneModes[0] ?? null) : dataPlaneModes.length ? dataPlaneModes.join(",") : null,
        controlPlaneMode:
          controlPlaneModes.length === 1
            ? (controlPlaneModes[0] ?? null)
            : controlPlaneModes.length
              ? controlPlaneModes.join(",")
              : null,
        preferredDataPlaneMode:
          preferredDataPlaneModes.length === 1
            ? (preferredDataPlaneModes[0] ?? null)
            : preferredDataPlaneModes.length
              ? preferredDataPlaneModes.join(",")
              : null,
        sabCapable:
          sabCapableStates.length === 1 ? sabCapableStates[0] ?? null : sabCapableStates.length ? null : null,
        sabReady: sabReadyStates.length === 1 ? sabReadyStates[0] ?? null : sabReadyStates.length ? null : null,
        crossOriginIsolated:
          crossOriginIsolatedStates.length === 1
            ? crossOriginIsolatedStates[0] ?? null
            : crossOriginIsolatedStates.length
              ? null
              : null,
        sabRequirement:
          sabRequirements.length === 1 ? (sabRequirements[0] ?? null) : sabRequirements.length ? sabRequirements.join(",") : null,
        sampleRates,
        totalAppendMessages,
        totalAppendedBytes,
        transportSec: Number(transport.currentSec.toFixed(3)),
        durationSec: Number(durationSec.toFixed(3)),
        stemCount: stemSnapshots.length,
        allStartupAppended: stemSnapshots.every((stem) => stem.startupAppended),
        allFullDecoded: stemSnapshots.every((stem) => stem.fullDecoded),
        allFullAppended: stemSnapshots.every((stem) => stem.fullAppended),
        stems: stemSnapshots,
        sync: {
          stemDriftSec:
            stemCurrentSecs.length > 1
              ? Number((Math.max(...stemCurrentSecs) - Math.min(...stemCurrentSecs)).toFixed(4))
              : 0,
          transportDriftSec: Number(
            stemSnapshots
              .reduce((maxDrift, stem) => Math.max(maxDrift, Math.abs(stem.currentSec - transport.currentSec)), 0)
              .toFixed(4)
          ),
          minLeadSec: Number((stemLeadSecs.length ? Math.min(...stemLeadSecs) : 0).toFixed(3)),
          maxLeadSec: Number((stemLeadSecs.length ? Math.max(...stemLeadSecs) : 0).toFixed(3)),
          totalUnderrunFrames: stemSnapshots.reduce((sum, stem) => sum + (stem.stats?.underrunFrames ?? 0), 0),
          totalDiscontinuityCount: stemSnapshots.reduce(
            (sum, stem) => sum + (stem.stats?.discontinuityCount ?? 0),
            0
          ),
        },
      }
    },

    getTransportClock() {
      return transportClock
    },
  }
}
