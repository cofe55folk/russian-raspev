"use client"

export type AppendableTransportClockSnapshot = {
  running: boolean
  currentFrame: number
  currentSec: number
  anchorFrame: number
  anchorCtxTime: number
  durationFrames: number
  playbackRate: number
}

export type AppendableTransportClock = {
  getSnapshot: (ctxTime: number) => AppendableTransportClockSnapshot
  start: (ctxTime: number, frame?: number) => AppendableTransportClockSnapshot
  pause: (ctxTime: number) => AppendableTransportClockSnapshot
  seek: (frame: number, ctxTime: number) => AppendableTransportClockSnapshot
  rebase: (frame: number, ctxTime: number) => AppendableTransportClockSnapshot
  setRate: (rate: number, ctxTime: number) => AppendableTransportClockSnapshot
  getRate: () => number
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
  let playbackRate = 1

  const getCurrentFrame = (ctxTime: number) => {
    if (!running) return parkedFrame
    const elapsedFrames = Math.max(
      0,
      Math.floor(Math.max(0, ctxTime - anchorCtxTime) * safeSampleRate * playbackRate)
    )
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
      playbackRate,
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

    setRate(rate, ctxTime) {
      const safeRate = Math.min(4, Math.max(0.25, Number.isFinite(rate) ? rate : 1))
      const snapshot = toSnapshot(ctxTime)
      parkedFrame = snapshot.currentFrame
      anchorFrame = snapshot.currentFrame
      anchorCtxTime = Math.max(0, ctxTime)
      playbackRate = safeRate
      return toSnapshot(ctxTime)
    },

    getRate() {
      return playbackRate
    },

    isRunning() {
      return running
    },
  }
}
