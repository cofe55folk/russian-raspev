"use client"

import { useEffect, useMemo, useState } from "react"
import { getGlobalAudioController, subscribeGlobalAudio, type GlobalAudioController } from "../lib/globalAudioManager"

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00"
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s < 10 ? "0" : ""}${s}`
}

export default function GlobalMiniPlayer() {
  const [controller, setController] = useState<GlobalAudioController | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [progress, setProgress] = useState({ current: 0, duration: 0, playing: false })

  useEffect(() => {
    const sync = () => {
      const active = getGlobalAudioController()
      setController(active)
      if (active) setProgress(active.getProgress())
    }
    sync()
    const unsub = subscribeGlobalAudio(sync)
    const t = window.setInterval(() => {
      const active = getGlobalAudioController()
      if (!active) return
      setProgress(active.getProgress())
    }, 200)
    return () => {
      unsub()
      window.clearInterval(t)
    }
  }, [])

  const loopOn = useMemo(() => {
    if (!controller?.getLoop) return false
    try {
      return !!controller.getLoop()
    } catch {
      return false
    }
  }, [controller, progress.playing, progress.current])

  if (!controller) return null
  const title = controller.getTitle ? controller.getTitle() : controller.title
  const subtitle = controller.getSubtitle ? controller.getSubtitle() : (controller.subtitle ?? "")
  const playlist = controller.getPlaylist ? controller.getPlaylist() : []
  const playlistIndex = controller.getPlaylistIndex ? controller.getPlaylistIndex() : -1

  const pct = progress.duration > 0 ? Math.max(0, Math.min(100, (progress.current / progress.duration) * 100)) : 0

  return (
    <div
      className="relative"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex h-10 items-center gap-1 rounded-xl border border-white/10 bg-black/25 px-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
        <button onClick={() => controller.prev()} className="btn-round h-7 w-7 text-white/90 hover:text-white" aria-label="Предыдущий">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m11 19-7-7 7-7" /><path d="M20 5v14" /></svg>
        </button>
        <button onClick={() => controller.toggle()} className="btn-round h-7 w-7 text-white hover:text-white" aria-label={progress.playing ? "Пауза" : "Воспроизвести"}>
          {progress.playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <button onClick={() => controller.next()} className="btn-round h-7 w-7 text-white/90 hover:text-white" aria-label="Следующий">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m13 5 7 7-7 7" /><path d="M4 5v14" /></svg>
        </button>
        <button
          onClick={() => controller.setLoop?.(!loopOn)}
          className={`btn-round h-7 w-7 ${loopOn ? "text-[#7ea4cd]" : "text-white/80"} hover:text-white`}
          aria-label="Повтор"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        </button>
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="absolute -bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-white/25 hover:bg-white/50"
        aria-label="Показать миниплеер"
      />

      {expanded ? (
        <div className="absolute left-1/2 top-full z-50 mt-1 w-[220px] -translate-x-1/2 rounded-xl border border-white/10 bg-black/75 p-2 text-white shadow-2xl backdrop-blur-md">
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] text-white/95">{title}</div>
              <div className="truncate text-[10px] text-white/60">{subtitle}</div>
            </div>
            <div className="relative">
              <button
                onClick={() => setPlaylistOpen((v) => !v)}
                onMouseEnter={() => setPlaylistOpen(true)}
                className="btn-round h-7 w-7 text-white/80 hover:text-white"
                aria-label="Плейлист"
                title="Плейлист"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
              </button>
              {playlistOpen ? (
                <div
                  className="absolute right-0 top-8 z-50 w-[230px] rounded-xl border border-white/10 bg-black/80 p-1.5 shadow-2xl backdrop-blur-md"
                  onMouseLeave={() => setPlaylistOpen(false)}
                >
                  <div className="mb-1 px-1 text-[10px] text-white/60">Очередь</div>
                  <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                    {playlist.slice(0, 8).map((item, idx) => (
                      <button
                        key={`${item.id}-${idx}`}
                        onClick={() => controller.jumpTo?.(idx)}
                        className={`block w-full rounded-md px-1.5 py-1 text-left text-[11px] ${
                          idx === playlistIndex ? "bg-[#5f82aa]/35 text-white" : "text-white/80 hover:bg-white/10"
                        }`}
                      >
                        <div className="truncate">{item.title}</div>
                        {item.subtitle ? <div className="truncate text-[10px] text-white/55">{item.subtitle}</div> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-1.5 rounded-md border border-white/10 bg-black/25 p-1.5">
            <input
              type="range"
              min={0}
              max={Math.max(0, progress.duration || 0)}
              step={0.01}
              value={Math.min(progress.current, progress.duration || progress.current)}
              onChange={(e) => controller.seek(Number(e.currentTarget.value))}
              className="w-full range-thin"
              aria-label="Прогресс трека"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-white/65">
              <span>{formatTime(progress.current)}</span>
              <span>{formatTime(progress.duration)}</span>
            </div>
          </div>
          <div className="absolute left-1/2 top-0 h-full w-[110px] -translate-x-1/2 pointer-events-none" />
        </div>
      ) : null}
    </div>
  )
}
