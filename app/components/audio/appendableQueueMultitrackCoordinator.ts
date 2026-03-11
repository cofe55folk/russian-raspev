"use client"

import { createAppendableTransportClock, type AppendableTransportClock } from "./appendableTransportClock"
import type { AppendableQueueDebugStats } from "./appendableQueueEngine"
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

function readStatsFromEngine(engine: SoundTouchEngine): AppendableQueueDebugStats | null {
  const debugState = engine.getDebugState?.()
  if (!debugState || typeof debugState !== "object") return null
  const stats = debugState as Record<string, number | string | null | undefined>
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
    minAvailableFrames: toFiniteNumber(stats.minAvailableFrames, availableFrames),
    maxAvailableFrames: toFiniteNumber(stats.maxAvailableFrames, availableFrames),
    underrunFrames,
    droppedFrames: toFiniteNumber(stats.droppedFrames, 0),
    playedFrame: toFiniteNumber(stats.playedFrame, 0),
    bufferedEndFrame: toFiniteNumber(stats.bufferedEndFrame, 0),
    discontinuityCount,
    generation: toFiniteNumber(stats.generation, 0),
    appendCount,
    appendedFrames,
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
      return {
        playing,
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
