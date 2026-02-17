"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { createSoundTouchEngine, type SoundTouchEngine } from "./audio/soundtouchEngine"

type TrackDef = { name: string; src: string }
type WavePeaks = { min: Float32Array; max: Float32Array }

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}
function formatTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s < 10 ? "0" : ""}${s}`
}

/** =========================
 *  PEAKS + WAVE DRAW
 *  ========================= */
function computePeaks(buffer: AudioBuffer, buckets: number): WavePeaks {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const safeBuckets = Math.max(1, Math.min(buckets, length))

  const min = new Float32Array(safeBuckets)
  const max = new Float32Array(safeBuckets)
  for (let i = 0; i < safeBuckets; i++) {
    min[i] = 1
    max[i] = -1
  }

  const samplesPerBucket = Math.max(1, Math.floor(length / safeBuckets))
  for (let b = 0; b < safeBuckets; b++) {
    const start = b * samplesPerBucket
    const end = Math.min(length, start + samplesPerBucket)

    let localMin = 1
    let localMax = -1

    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c)
      for (let i = start; i < end; i++) {
        const v = data[i]
        if (v < localMin) localMin = v
        if (v > localMax) localMax = v
      }
    }

    min[b] = localMin
    max[b] = localMax
  }

  return { min, max }
}

function drawWaveform(canvas: HTMLCanvasElement, peaks: WavePeaks, progress01: number) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  const W = Math.max(1, Math.floor(cssW * dpr))
  const H = Math.max(1, Math.floor(cssH * dpr))
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = "rgba(255,255,255,0.05)"
  ctx.fillRect(0, 0, W, H)

  const mid = H / 2
  const amp = H * 0.42
  const peaksLen = peaks.min.length
  const idxAt = (x: number) => Math.min(peaksLen - 1, Math.floor((x / (W - 1)) * peaksLen))

  // base
  ctx.lineWidth = 1
  ctx.strokeStyle = "rgba(255,255,255,0.32)"
  ctx.beginPath()
  for (let x = 0; x < W; x++) {
    const idx = idxAt(x)
    const y1 = mid + peaks.min[idx] * amp
    const y2 = mid + peaks.max[idx] * amp
    ctx.moveTo(x + 0.5, y1)
    ctx.lineTo(x + 0.5, y2)
  }
  ctx.stroke()

  // progress overlay
  const progX = Math.floor(W * clamp(progress01, 0, 1))
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, progX, H)
  ctx.clip()

  ctx.strokeStyle = "rgba(255,255,255,0.9)"
  ctx.beginPath()
  for (let x = 0; x < W; x++) {
    const idx = idxAt(x)
    const y1 = mid + peaks.min[idx] * amp
    const y2 = mid + peaks.max[idx] * amp
    ctx.moveTo(x + 0.5, y1)
    ctx.lineTo(x + 0.5, y2)
  }
  ctx.stroke()
  ctx.restore()

  // playhead
  ctx.fillStyle = "rgba(255,255,255,0.85)"
  ctx.fillRect(progX, 0, Math.max(1, Math.floor(1 * dpr)), H)
}

/** =========================
 *  REVERB
 *  ========================= */
function makeImpulseResponse(ctx: AudioContext) {
  const seconds = 2.0
  const decay = 4.8
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const impulse = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const t = i / length
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay)
    }
  }
  return impulse
}

/** =========================
 *  SLIDER WITH CENTER MARK
 *  ========================= */
function CenterMarkedSlider(props: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  className?: string
  title?: string
}) {
  const { value, min, max, step, onChange, className, title } = props
  const centerPct = min === max ? 50 : clamp(((0 - min) / (max - min)) * 100, 0, 100)

  return (
    <div className={`relative ${className ?? ""}`} title={title}>
      <div
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/45"
        style={{ left: `${centerPct}%` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="w-full range-thin"
      />
    </div>
  )
}

export default function MultiTrackPlayer() {
  const tracks: TrackDef[] = useMemo(
    () => [
      { name: "Селезень 01", src: "/audio/selezen/selezen-01.m4a" },
      { name: "Селезень 02", src: "/audio/selezen/selezen-02.m4a" },
      { name: "Селезень 03", src: "/audio/selezen/selezen-03.m4a" },
    ],
    []
  )

  const ctxRef = useRef<AudioContext | null>(null)
  const enginesRef = useRef<(SoundTouchEngine | null)[]>(tracks.map(() => null))

  // gate (anti-cascade + clean start/stop)
  const engineGateRef = useRef<GainNode[]>([])

  // per-track nodes
  const trackGainRef = useRef<GainNode[]>([])
  const panRef = useRef<StereoPannerNode[]>([])

  // master
  const masterGainRef = useRef<GainNode | null>(null)
  const wetGainRef = useRef<GainNode | null>(null)
  const dryGainRef = useRef<GainNode | null>(null)

  // transport
  const rafRef = useRef<number | null>(null)
  const isPlayingRef = useRef(false)
  const positionSecRef = useRef(0)

  // params
  const tempoRef = useRef(1)
  const pitchSemiRef = useRef(0)

  // UI
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loopOn, setLoopOn] = useState(false)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const [muted, setMuted] = useState<boolean[]>(tracks.map(() => false))
  const [solo, setSolo] = useState<boolean[]>(tracks.map(() => false))
  const [panUI, setPanUI] = useState<number[]>(tracks.map(() => 0))
  const [volUI, setVolUI] = useState<number[]>(tracks.map(() => 1))

  const [masterVol, setMasterVol] = useState(1)
  const [reverbAmount, setReverbAmount] = useState(0.15)

  const [speed, setSpeed] = useState(1)
  const [pitchSemi, setPitchSemi] = useState(0)

  // waveform
  const waveCanvasesRef = useRef<(HTMLCanvasElement | null)[]>([])
  const peaksRef = useRef<(WavePeaks | null)[]>(tracks.map(() => null))
  const [waveReady, setWaveReady] = useState(false)

  /** =========================
   *  CLICK-FREE RAMP HELPERS
   *  ========================= */
  const rampGainTo = (node: GainNode | null | undefined, target: number, rampSec = 0.045) => {
    if (!node) return
    const ctx = node.context
    const now = ctx.currentTime
    const g = node.gain
    const from = g.value
    if (Math.abs(from - target) < 0.0005) return

    try {
      g.cancelScheduledValues(now)
      g.setValueAtTime(from, now)
      g.linearRampToValueAtTime(target, now + rampSec)
    } catch {
      g.value = target
    }
  }

  /** =========================
   *  INIT (один раз)
   *  ========================= */
  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const ctx = new AudioContext()
      ctxRef.current = ctx

      // master graph
      const masterIn = ctx.createGain()
      const dryGain = ctx.createGain()
      const wetGain = ctx.createGain()
      const convolver = ctx.createConvolver()
      const masterGain = ctx.createGain()

      dryGainRef.current = dryGain
      wetGainRef.current = wetGain
      masterGainRef.current = masterGain

      masterIn.connect(dryGain)
      masterIn.connect(convolver)
      convolver.connect(wetGain)

      dryGain.connect(masterGain)
      wetGain.connect(masterGain)
      masterGain.connect(ctx.destination)

      masterGain.gain.value = masterVol
      wetGain.gain.value = reverbAmount
      dryGain.gain.value = 1 - reverbAmount
      convolver.buffer = makeImpulseResponse(ctx)

      // load buffers
      const buffers = await Promise.all(
        tracks.map(async (t) => {
          const res = await fetch(t.src)
          if (!res.ok) throw new Error(`Fetch failed: ${t.src} (${res.status})`)
          const arr = await res.arrayBuffer()
          return await ctx.decodeAudioData(arr)
        })
      )

      if (cancelled) return
      setDuration(buffers[0]?.duration ?? 0)

      // engines + per-track chain
      buffers.forEach((buffer, i) => {
        const engine = createSoundTouchEngine(ctx, buffer, { bufferSize: 2048 })
        enginesRef.current[i] = engine

        // gate
        const gate = ctx.createGain()
        gate.gain.value = 0
        engineGateRef.current[i] = gate

        // track chain
        const g = ctx.createGain()
        const p = ctx.createStereoPanner()

        gate.connect(g)
        g.connect(p)
        p.connect(masterIn)

        trackGainRef.current[i] = g
        panRef.current[i] = p

        engine.connect(gate)

        engine.setTempo(tempoRef.current)
        engine.setPitchSemitones(pitchSemiRef.current)
      })

      setIsReady(true)

      // peaks
      requestAnimationFrame(() => {
        if (cancelled) return
        const peaksArr: (WavePeaks | null)[] = []
        for (let i = 0; i < buffers.length; i++) {
          const canvas = waveCanvasesRef.current[i]
          const w = canvas?.clientWidth ? Math.floor(canvas.clientWidth) : 900
          peaksArr[i] = computePeaks(buffers[i], Math.max(900, w))
        }
        peaksRef.current = peaksArr
        setWaveReady(true)
      })
    }

    init().catch((e) => console.error("Audio init error:", e))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])

  /** =========================
   *  APPLY UI -> AUDIO (с плавностью)
   *  ========================= */
  useEffect(() => {
    rampGainTo(masterGainRef.current, masterVol, 0.05)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterVol])

  useEffect(() => {
    if (!wetGainRef.current || !dryGainRef.current) return
    rampGainTo(wetGainRef.current, reverbAmount, 0.05)
    rampGainTo(dryGainRef.current, 1 - reverbAmount, 0.05)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reverbAmount])

  const applyMuteSoloVolume = (m: boolean[], s: boolean[], v: number[]) => {
    const anySolo = s.some(Boolean)
    trackGainRef.current.forEach((g, i) => {
      if (!g) return
      const base = v[i] ?? 1
      const factor = anySolo ? (s[i] ? 1 : 0) : (m[i] ? 0 : 1)
      rampGainTo(g, base * factor, 0.035)
    })
  }

  const applyPan = (p: number[]) => {
    panRef.current.forEach((node, i) => {
      if (!node) return
      node.pan.value = p[i] ?? 0
    })
  }

  /** =========================
   *  ACTIVE TRACK (подсветка)
   *  ========================= */
  const isTrackAudible = (i: number) => {
    const anySolo = solo.some(Boolean)
    if (anySolo) return !!solo[i]
    return !muted[i]
  }

  /** =========================
   *  ENGINE CONTROL
   *  ========================= */
  const stopEnginesHard = () => {
    engineGateRef.current.forEach((g) => rampGainTo(g, 0, 0.02))
    enginesRef.current.forEach((eng) => {
      try {
        eng?.stop()
      } catch {}
    })
  }

  const startEngines = () => {
    engineGateRef.current.forEach((g) => rampGainTo(g, 1, 0.02))
    enginesRef.current.forEach((eng) => {
      try {
        eng?.start()
      } catch {}
    })
  }

  /** =========================
   *  ANIMATION + END-OF-TRACK RESET
   *  ========================= */
  const animate = () => {
    if (!isPlayingRef.current) return
    const e0 = enginesRef.current[0]
    if (!e0) return

    const pos = e0.getSourcePositionSeconds()

    // конец трека
    if (duration > 0 && pos >= duration - 0.01) {
      // останавливаем
      isPlayingRef.current = false
      setIsPlaying(false)
      stopEnginesHard()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null

      // курсор в начало
      positionSecRef.current = 0
      setCurrentTime(0)
      enginesRef.current.forEach((eng) => eng?.seekSeconds(0))

      // если loopOn — запускаем заново
      if (loopOn) {
        // небольшая задержка не нужна, просто стартуем
        isPlayingRef.current = true
        setIsPlaying(true)
        startEngines()
        rafRef.current = requestAnimationFrame(animate)
      }
      return
    }

    positionSecRef.current = pos
    setCurrentTime(pos)
    rafRef.current = requestAnimationFrame(animate)
  }

  useEffect(() => {
    if (!waveReady || !duration) return
    const p = clamp(currentTime / duration, 0, 1)
    for (let i = 0; i < tracks.length; i++) {
      const canvas = waveCanvasesRef.current[i]
      const peaks = peaksRef.current[i]
      if (canvas && peaks) drawWaveform(canvas, peaks, p)
    }
  }, [currentTime, duration, waveReady, tracks.length])

  /** =========================
   *  TRANSPORT
   *  ========================= */
  const play = async () => {
    const ctx = ctxRef.current
    if (!ctx || !isReady) return
    await ctx.resume()

    // если стоим в самом конце — стартуем с начала
    const atEnd = duration > 0 && positionSecRef.current >= duration - 0.02
    const pos = atEnd ? 0 : clamp(positionSecRef.current, 0, duration || positionSecRef.current)

    positionSecRef.current = pos
    setCurrentTime(pos)

    stopEnginesHard()
    enginesRef.current.forEach((eng) => eng?.seekSeconds(pos))
    startEngines()

    isPlayingRef.current = true
    setIsPlaying(true)

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
  }

  const pause = () => {
    isPlayingRef.current = false
    setIsPlaying(false)
    stopEnginesHard()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }

  const togglePlay = () => {
    if (isPlayingRef.current) pause()
    else play()
  }

  const seekTo = (sec: number) => {
    const pos = clamp(sec, 0, duration || sec)
    positionSecRef.current = pos
    setCurrentTime(pos)

    const wasPlaying = isPlayingRef.current

    stopEnginesHard()
    enginesRef.current.forEach((eng) => eng?.seekSeconds(pos))

    if (wasPlaying) {
      startEngines()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(animate)
    }
  }

  const goToStart = () => {
    pause()
    seekTo(0)
  }

  /** =========================
   *  WAVE SCRUB (drag)
   *  ========================= */
  const isScrubbingRef = useRef(false)

  const scrubFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const p = clamp(x / rect.width, 0, 1)
    seekTo(p * duration)
  }

  const onWavePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
    isScrubbingRef.current = true
    scrubFromEvent(e)
  }
  const onWavePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isScrubbingRef.current) return
    scrubFromEvent(e)
  }
  const onWavePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isScrubbingRef.current = false
    try {
      ;(e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  /** =========================
   *  SPEED / PITCH
   *  ========================= */
  const setSpeedUI = (v: number) => {
    setSpeed(v)
    tempoRef.current = v
    enginesRef.current.forEach((eng) => eng?.setTempo(v))
  }

  const setPitchUI = (semi: number) => {
    setPitchSemi(semi)
    pitchSemiRef.current = semi
    enginesRef.current.forEach((eng) => eng?.setPitchSemitones(semi))
  }

  /** =========================
   *  TRACK CONTROLS
   *  ========================= */
  const toggleMute = (i: number) => {
    setMuted((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      applyMuteSoloVolume(next, solo, volUI)
      return next
    })
  }

  const toggleSolo = (i: number) => {
    setSolo((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      applyMuteSoloVolume(muted, next, volUI)
      return next
    })
  }

  const setPan = (i: number, value: number) => {
    setPanUI((prev) => {
      const next = [...prev]
      next[i] = value
      applyPan(next)
      return next
    })
  }

  const setVol = (i: number, value: number) => {
    setVolUI((prev) => {
      const next = [...prev]
      next[i] = value
      applyMuteSoloVolume(muted, solo, next)
      return next
    })
  }

  /** =========================
   *  RENDER
   *  ========================= */
  return (
    <div className="bg-zinc-950/60 rounded-2xl p-6 md:p-8 space-y-6 text-white shadow-xl border border-white/10">
      {!isReady && <div className="text-white/70">Загрузка аудио…</div>}

      {isReady && (
        <>
          {/* MASTER */}
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <button onClick={goToStart} className="btn-round" title="В начало (без воспроизведения)">
                  <span className="text-2xl leading-none">↩︎</span>
                </button>

                <button
                  onClick={togglePlay}
                  className="px-5 h-11 bg-white text-black rounded-full font-medium hover:bg-white/90 transition"
                >
                  {isPlaying ? "Пауза" : "▶ Воспроизвести"}
                </button>

                <button
                  onClick={() => setLoopOn((v) => !v)}
                  className={`btn-round ${loopOn ? "btn-round--active" : ""}`}
                  title="Повтор трека"
                >
                  <span className="text-[34px] leading-[0.9]">⟲</span>
                </button>
              </div>

              <div className="text-sm text-white/70">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={duration || 0}
              step="0.005"
              value={Math.min(currentTime, duration || currentTime)}
              onChange={(e) => seekTo(Number(e.currentTarget.value))}
              className="w-full range-thin"
            />

            <div className="grid md:grid-cols-4 gap-4 items-center">
              <div className="space-y-1">
                <div className="text-[11px] text-white/60">Master</div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step="0.01"
                  value={masterVol}
                  onChange={(e) => setMasterVol(Number(e.currentTarget.value))}
                  className="range-thin range-short"
                />
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-white/60">Reverb</div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step="0.01"
                  value={reverbAmount}
                  onChange={(e) => setReverbAmount(Number(e.currentTarget.value))}
                  className="range-thin range-short"
                />
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-white/60">Speed</div>
                <div className="relative">
                  <div
                    className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/45"
                    style={{ left: `${clamp(((1 - 0.6) / (1.4 - 0.6)) * 100, 0, 100)}%` }}
                  />
                  <input
                    type="range"
                    min={0.6}
                    max={1.4}
                    step="0.01"
                    value={speed}
                    onChange={(e) => setSpeedUI(Number(e.currentTarget.value))}
                    className="w-full range-thin"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-white/60">Pitch</div>
                <div className="relative">
                  <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/45" style={{ left: "50%" }} />
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={pitchSemi}
                    onChange={(e) => setPitchUI(Number(e.currentTarget.value))}
                    className="w-full range-thin"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* TRACKS */}
          <div className="space-y-6">
            {tracks.map((track, i) => {
              const audible = isTrackAudible(i)

              // подсветка: только играющие и слышимые — яркие
              const isLit = isPlaying && audible

              return (
                <div
                  key={i}
                  className={`space-y-3 transition ${
                    isLit ? "opacity-100" : "opacity-45"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{track.name}</span>

                      <button
                        onClick={() => toggleMute(i)}
                        className={`px-2.5 py-1 rounded text-xs transition ${
                          muted[i] ? "bg-red-600" : "bg-zinc-700 hover:bg-zinc-600"
                        }`}
                      >
                        M
                      </button>

                      <button
                        onClick={() => toggleSolo(i)}
                        className={`px-2.5 py-1 rounded text-xs transition ${
                          solo[i] ? "bg-yellow-400 text-black" : "bg-zinc-700 hover:bg-zinc-600"
                        }`}
                      >
                        S
                      </button>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="hidden md:block">
                        <div className="text-[11px] text-white/60 mb-1">Vol</div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step="0.01"
                          value={volUI[i] ?? 1}
                          onChange={(e) => setVol(i, Number(e.currentTarget.value))}
                          className="range-thin range-short"
                        />
                      </div>

                      <div className="hidden md:block w-[150px]">
                        <div className="text-[11px] text-white/60 mb-1">Pan</div>
                        <CenterMarkedSlider
                          value={panUI[i] ?? 0}
                          min={-1}
                          max={1}
                          step={0.01}
                          onChange={(v) => setPan(i, v)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl overflow-hidden border border-white/10 bg-black/25">
                    <canvas
                      ref={(el) => {
                        waveCanvasesRef.current[i] = el
                      }}
                      onPointerDown={onWavePointerDown}
                      onPointerMove={onWavePointerMove}
                      onPointerUp={onWavePointerUp}
                      className="w-full h-[92px] cursor-pointer"
                      title="Клик/перетаскивание по волне — перемотка"
                    />
                  </div>

                  <div className="md:hidden grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[11px] text-white/60 mb-1">Volume</div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step="0.01"
                        value={volUI[i] ?? 1}
                        onChange={(e) => setVol(i, Number(e.currentTarget.value))}
                        className="range-thin"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] text-white/60 mb-1">Pan</div>
                      <CenterMarkedSlider
                        value={panUI[i] ?? 0}
                        min={-1}
                        max={1}
                        step={0.01}
                        onChange={(v) => setPan(i, v)}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
