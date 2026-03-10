"use client"

import type { SoundTouchEngine } from "./soundtouchEngine"

type CreateMediaStreamingEngineOpts = {
  preload?: "none" | "metadata" | "auto"
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

// Experimental streaming engine for pilot runs.
// Uses MediaElementAudioSourceNode to let browser handle buffering/segment fetch.
export function createMediaStreamingEngine(
  audioCtx: AudioContext,
  src: string,
  opts?: CreateMediaStreamingEngineOpts
): SoundTouchEngine {
  const audioEl = new Audio(src)
  audioEl.preload = opts?.preload ?? "auto"
  audioEl.crossOrigin = "anonymous"
  audioEl.loop = false
  audioEl.setAttribute("playsinline", "true")
  try {
    ;(audioEl as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = true
  } catch {}
  try {
    ;(audioEl as HTMLMediaElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true
  } catch {}

  const sourceNode = audioCtx.createMediaElementSource(audioEl)
  let outputNode: AudioNode | null = null
  let isConnected = false
  let isRunning = false
  let tempo = 1

  const connectSource = () => {
    if (!outputNode || isConnected) return
    try {
      sourceNode.connect(outputNode)
      isConnected = true
    } catch {}
  }

  const disconnectSource = () => {
    if (!isConnected) return
    try {
      sourceNode.disconnect()
    } catch {}
    isConnected = false
  }

  return {
    getCapabilities() {
      return {
        supportsTempo: true,
        supportsIndependentPitch: false,
      }
    },

    connect(node: AudioNode) {
      outputNode = node
      if (isRunning) connectSource()
    },

    disconnect() {
      disconnectSource()
      outputNode = null
      isRunning = false
    },

    start() {
      if (!outputNode) return
      isRunning = true
      connectSource()
      void audioEl.play().catch(() => {})
    },

    stop() {
      if (!audioEl.paused) {
        try {
          audioEl.pause()
        } catch {}
      }
      isRunning = false
    },

    seekSeconds(sec: number) {
      const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : Infinity
      const target = clamp(sec, 0, duration)
      try {
        audioEl.currentTime = target
      } catch {}
    },

    getSourcePositionSeconds() {
      return Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0
    },

    setTempo(nextTempo: number) {
      tempo = clamp(nextTempo, 0.25, 4)
      try {
        audioEl.playbackRate = tempo
      } catch {}
    },

    setPitchSemitones(_semitones: number) {
      // Pilot limitation: independent pitch-shift is unavailable in media-element mode.
    },

    getDurationSeconds() {
      return Number.isFinite(audioEl.duration) ? Math.max(0, audioEl.duration) : 0
    },

    destroy() {
      disconnectSource()
      try {
        audioEl.pause()
      } catch {}
      try {
        audioEl.removeAttribute("src")
        audioEl.load()
      } catch {}
      outputNode = null
      isRunning = false
    },
  }
}
