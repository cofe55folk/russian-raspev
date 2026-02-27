"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  closeGlobalVideo,
  getGlobalVideoState,
  nextGlobalVideo,
  openGlobalVideoPlaylistIndex,
  prevGlobalVideo,
  setGlobalVideoLoop,
  setGlobalVideoPinned,
  setGlobalVideoRect,
  snapGlobalVideoRect,
  subscribeGlobalVideo,
  type GlobalVideoState,
} from "../lib/globalVideoManager"
import { stopGlobalAudioForVideoStart } from "../lib/mediaMutualExclusion"

type UiLang = "ru" | "en"

const VIDEO_UI: Record<UiLang, {
  pin: string
  close: string
  queue: string
  previous: string
  next: string
  repeat: string
  pause: string
  play: string
  queueTitle: string
  noItems: string
}> = {
  ru: {
    pin: "Закрепить",
    close: "Закрыть",
    queue: "Очередь",
    previous: "Предыдущее видео",
    next: "Следующее видео",
    repeat: "Повтор",
    pause: "Пауза",
    play: "Воспроизвести",
    queueTitle: "Плейлист статьи",
    noItems: "Плейлист пуст",
  },
  en: {
    pin: "Pin",
    close: "Close",
    queue: "Queue",
    previous: "Previous video",
    next: "Next video",
    repeat: "Repeat",
    pause: "Pause",
    play: "Play",
    queueTitle: "Article playlist",
    noItems: "Playlist is empty",
  },
}

function detectUiLang(): UiLang {
  if (typeof document === "undefined") return "ru"
  const lang = (document.documentElement.lang || "ru").toLowerCase()
  return lang.startsWith("en") ? "en" : "ru"
}

function toEmbedUrl(src: string) {
  try {
    const parsed = new URL(src)
    const host = parsed.hostname.toLowerCase()

    if (host === "youtu.be") {
      const id = parsed.pathname.replace(/^\/+/, "").split("/")[0]
      if (id) return `https://www.youtube.com/embed/${id}?autoplay=1`
    }

    if (host.includes("youtube.com")) {
      const idFromQuery = parsed.searchParams.get("v")
      if (idFromQuery) return `https://www.youtube.com/embed/${idFromQuery}?autoplay=1`
      const parts = parsed.pathname.split("/").filter(Boolean)
      if (parts[0] === "embed" && parts[1]) return `https://www.youtube.com/embed/${parts[1]}?autoplay=1`
      if (parts[0] === "shorts" && parts[1]) return `https://www.youtube.com/embed/${parts[1]}?autoplay=1`
    }

    if (host.includes("rutube.ru")) {
      const parts = parsed.pathname.split("/").filter(Boolean)
      const videoIndex = parts.findIndex((part) => part === "video")
      if (videoIndex >= 0 && parts[videoIndex + 1]) {
        return `https://rutube.ru/play/embed/${parts[videoIndex + 1]}?autoplay=1`
      }
      if (parts[0] === "play" && parts[1] === "embed" && parts[2]) {
        return `https://rutube.ru/play/embed/${parts[2]}?autoplay=1`
      }
    }
  } catch {
    return src.includes("?") ? `${src}&autoplay=1` : `${src}?autoplay=1`
  }

  if (src.includes("autoplay=")) return src
  return src.includes("?") ? `${src}&autoplay=1` : `${src}?autoplay=1`
}

export default function GlobalFloatingVideoPlayer() {
  const [state, setState] = useState<GlobalVideoState | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const fileVideoRef = useRef<HTMLVideoElement | null>(null)
  const dragRef = useRef<{ dx: number; dy: number; active: boolean }>({ dx: 0, dy: 0, active: false })
  const uiLang = detectUiLang()

  useEffect(() => {
    const sync = () => setState({ ...getGlobalVideoState() })
    sync()
    const unsub = subscribeGlobalVideo(sync)
    const onResize = () => sync()
    window.addEventListener("resize", onResize)
    return () => {
      unsub()
      window.removeEventListener("resize", onResize)
    }
  }, [])

  const ui = VIDEO_UI[uiLang]
  const active = state?.active
  const isFile = active?.provider === "file"
  const embedSrc = useMemo(() => (active ? toEmbedUrl(active.src) : ""), [active])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!state || state.pinned) return
    dragRef.current.active = true
    dragRef.current.dx = e.clientX - state.rect.x
    dragRef.current.dy = e.clientY - state.rect.y
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!state || !dragRef.current.active || state.pinned) return
    setGlobalVideoRect({
      ...state.rect,
      x: e.clientX - dragRef.current.dx,
      y: e.clientY - dragRef.current.dy,
    })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!state || !dragRef.current.active) return
    dragRef.current.active = false
    try {
      ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
    } catch {}
    if (state.pinned) snapGlobalVideoRect()
  }

  if (!state || !state.open || !active) return null

  const width = state.rect.width
  const height = state.rect.height

  return (
    <div
      className="fixed z-[70] overflow-hidden rounded-xl border border-white/20 bg-black shadow-2xl"
      style={{ left: state.rect.x, top: state.rect.y, width, height }}
    >
      <div
        className="flex h-8 cursor-grab select-none items-center justify-between border-b border-white/10 bg-black/80 px-2 text-[11px] text-white/85"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="min-w-0 truncate">{active.title}</div>
        <div className="ml-2 flex items-center gap-1">
          <button
            className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-white/20 disabled:opacity-40"
            onClick={() => prevGlobalVideo()}
            title={ui.previous}
            aria-label={ui.previous}
            disabled={state.playlistIndex <= 0}
          >
            ‹
          </button>
          {isFile ? (
            <button
              className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-white/20"
              onClick={() => {
                const video = fileVideoRef.current
                if (!video) return
                if (video.paused) {
                  stopGlobalAudioForVideoStart()
                  void video.play()
                } else {
                  video.pause()
                }
              }}
              title={ui.play}
              aria-label={ui.play}
            >
              ▶
            </button>
          ) : null}
          <button
            className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-white/20 disabled:opacity-40"
            onClick={() => nextGlobalVideo()}
            title={ui.next}
            aria-label={ui.next}
            disabled={state.playlistIndex < 0 || state.playlistIndex >= state.playlist.length - 1}
          >
            ›
          </button>
          <button
            className={`rounded px-1.5 py-0.5 ${state.loop ? "bg-[#7ea4cd] text-white" : "bg-white/10 hover:bg-white/20"}`}
            onClick={() => setGlobalVideoLoop(!state.loop)}
            title={ui.repeat}
            aria-label={ui.repeat}
          >
            ↻
          </button>
          <button
            className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-white/20"
            onClick={() => setQueueOpen((v) => !v)}
            title={ui.queue}
            aria-label={ui.queue}
          >
            ☰
          </button>
          <button
            className={`rounded px-1.5 py-0.5 ${state.pinned ? "bg-[#7ea4cd] text-white" : "bg-white/10 hover:bg-white/20"}`}
            onClick={() => {
              const next = !state.pinned
              setGlobalVideoPinned(next)
              if (next) snapGlobalVideoRect()
            }}
            title={ui.pin}
          >
            pin
          </button>
          <button
            className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-white/20"
            onClick={() => closeGlobalVideo()}
            title={ui.close}
          >
            x
          </button>
        </div>
      </div>

      <div className="relative h-[calc(100%-2rem)] w-full bg-black">
        {isFile ? (
          <video
            key={`${active.id}:${active.src}`}
            ref={fileVideoRef}
            src={active.src}
            controls
            autoPlay
            playsInline
            className="h-full w-full bg-black"
            onEnded={(event) => {
              const video = event.currentTarget
              if (state.loop) {
                video.currentTime = 0
                void video.play()
                return
              }
              nextGlobalVideo()
            }}
          />
        ) : (
          <iframe
            key={`${active.id}:${active.src}`}
            src={embedSrc}
            title={active.title}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            className="h-full w-full border-0 bg-black"
          />
        )}

        {queueOpen ? (
          <div className="absolute right-2 top-2 z-20 w-[260px] rounded-lg border border-white/15 bg-black/80 p-2 backdrop-blur-md">
            <div className="mb-1 text-[11px] text-white/70">{ui.queueTitle}</div>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {state.playlist.length ? (
                state.playlist.map((item, idx) => (
                  <button
                    key={`${item.id}-${idx}`}
                    className={`block w-full rounded px-2 py-1 text-left text-xs ${
                      idx === state.playlistIndex ? "bg-[#5f82aa]/40 text-white" : "text-white/80 hover:bg-white/10"
                    }`}
                    onClick={() => {
                      openGlobalVideoPlaylistIndex(state.contextId, idx)
                      setQueueOpen(false)
                    }}
                  >
                    <div className="truncate">{item.title}</div>
                    {item.subtitle ? <div className="truncate text-[10px] text-white/55">{item.subtitle}</div> : null}
                  </button>
                ))
              ) : (
                <div className="text-xs text-white/55">{ui.noItems}</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
