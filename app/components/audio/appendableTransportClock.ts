"use client"

export type AppendableTransportClockSnapshot = {
  running: boolean
  currentFrame: number
  currentSec: number
  anchorFrame: number
  anchorCtxTime: number
  durationFrames: number
}

export type AppendableTransportClock = {
  getSnapshot: (ctxTime: number) => AppendableTransportClockSnapshot
  start: (ctxTime: number, frame?: number) => AppendableTransportClockSnapshot
  pause: (ctxTime: number) => AppendableTransportClockSnapshot
  seek: (frame: number, ctxTime: number) => AppendableTransportClockSnapshot
  rebase: (frame: number, ctxTime: number) => AppendableTransportClockSnapshot
  isRunning: () => boolean
}

function clampFrame(frame: number, durationFrames: number) {
  return Math.min(durationFrames, Math.max(0, Math.floor(frame)))
}

export function createAppendableTransportClock(sampleRate: number, durationFrames: number): AppendableTransportClock {
  const safeSampleRate = Math.max(1, Math.floor(sampleRate))
  const safeDurationFrames = Math.max(0, Math.floor(durationFrames))

  let running = false
  let anchorFrame = 0
  let anchorCtxTime = 0
  let parkedFrame = 0

  const getCurrentFrame = (ctxTime: number) => {
    if (!running) return parkedFrame
    const elapsedFrames = Math.max(0, Math.floor(Math.max(0, ctxTime - anchorCtxTime) * safeSampleRate))
    return clampFrame(anchorFrame + elapsedFrames, safeDurationFrames)
  }

  const toSnapshot = (ctxTime: number): AppendableTransportClockSnapshot => {
    const currentFrame = getCurrentFrame(ctxTime)
    return {
      running,
      currentFrame,
      currentSec: currentFrame / safeSampleRate,
      anchorFrame,
      anchorCtxTime,
      durationFrames: safeDurationFrames,
    }
  }

  const moveToFrame = (frame: number, ctxTime: number, keepRunning: boolean) => {
    const safeFrame = clampFrame(frame, safeDurationFrames)
    parkedFrame = safeFrame
    anchorFrame = safeFrame
    anchorCtxTime = Math.max(0, ctxTime)
    running = keepRunning
    return toSnapshot(ctxTime)
  }

  return {
    getSnapshot(ctxTime) {
      return toSnapshot(ctxTime)
    },

    start(ctxTime, frame) {
      const startFrame = typeof frame === "number" && Number.isFinite(frame) ? frame : parkedFrame
      return moveToFrame(startFrame, ctxTime, true)
    },

    pause(ctxTime) {
      const snapshot = toSnapshot(ctxTime)
      parkedFrame = snapshot.currentFrame
      anchorFrame = snapshot.currentFrame
      anchorCtxTime = Math.max(0, ctxTime)
      running = false
      return toSnapshot(ctxTime)
    },

    seek(frame, ctxTime) {
      return moveToFrame(frame, ctxTime, running)
    },

    rebase(frame, ctxTime) {
      return moveToFrame(frame, ctxTime, running)
    },

    isRunning() {
      return running
    },
  }
}
