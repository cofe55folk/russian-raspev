"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { getGlobalAudioController } from "../lib/globalAudioManager"
import { getMiniPlayerStateSnapshot, subscribeMiniPlayerState, touchMiniPlayerState } from "../lib/miniPlayerStateStore"
import { useI18n } from "./i18n/I18nProvider"
import { getSoundTrackHref } from "../lib/i18n/routing"
import { emitMiniPlayerTelemetry } from "../lib/analytics/emitMiniPlayerTelemetry"
import type { MiniPlayerAction, MiniPlayerEndStreamReason } from "../lib/analytics/miniplayerContract"

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00"
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s < 10 ? "0" : ""}${s}`
}

type GlobalMiniPlayerProps = {
  mobile?: boolean
}

type TransportBadgeState = "idle" | "buffering" | "stalled" | "retrying" | "recovered"
const FOLLOW_CARD_STORAGE_KEY = "rr_miniplayer_follow_card_v2"
const TRANSPORT_BUFFERING_THRESHOLD_MS = 1800
const TRANSPORT_STALLED_THRESHOLD_MS = 5200

export default function GlobalMiniPlayer({ mobile = false }: GlobalMiniPlayerProps = {}) {
  const router = useRouter()
  const { locale, t } = useI18n()
  const snapshot = useSyncExternalStore(subscribeMiniPlayerState, getMiniPlayerStateSnapshot, getMiniPlayerStateSnapshot)
  const [desktopViewport, setDesktopViewport] = useState(() => {
    if (typeof window === "undefined") return true
    try {
      return window.matchMedia("(min-width: 640px)").matches
    } catch {
      return true
    }
  })
  const [expanded, setExpanded] = useState(false)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubValue, setScrubValue] = useState<number | null>(null)
  const [transportBadge, setTransportBadge] = useState<TransportBadgeState>("idle")
  const [transportPulse, setTransportPulse] = useState(0)
  const isScrubbingRef = useRef(false)
  const rangeRef = useRef<HTMLInputElement | null>(null)
  const playbackIntentUntilMsRef = useRef(0)
  const playbackIntentStartedAtMsRef = useRef(0)
  const lastProgressRef = useRef<{ current: number; advancedAtMs: number; retryAtMs: number; recoveredUntilMs: number }>({
    current: 0,
    advancedAtMs: 0,
    retryAtMs: 0,
    recoveredUntilMs: 0,
  })
  const previousControllerIdRef = useRef<string | null>(null)
  const [followCard, setFollowCard] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return localStorage.getItem(FOLLOW_CARD_STORAGE_KEY) === "1"
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(FOLLOW_CARD_STORAGE_KEY, followCard ? "1" : "0")
    } catch {}
  }, [followCard])

  const controller = getGlobalAudioController()
  const isActiveController = !!snapshot.controllerId && !!controller && controller.id === snapshot.controllerId
  const activeController = isActiveController ? controller : null
  const controlsActive = mobile ? !desktopViewport : desktopViewport

  const loopOn = snapshot.loopOn
  const title = snapshot.title
  const subtitle = snapshot.subtitle
  const playlist = snapshot.playlist
  const playlistIndex = snapshot.playlistIndex
  const hasQueue = playlist.length > 0 && typeof activeController?.jumpTo === "function"
  const progress = snapshot.progress
  const displayCurrent =
    isScrubbing && scrubValue !== null
      ? scrubValue
      : Math.min(progress.current, progress.duration > 0 ? progress.duration : progress.current)

  useEffect(() => {
    if (typeof window === "undefined") return
    let active = true
    const media = window.matchMedia("(min-width: 640px)")
    const sync = () => {
      if (!active) return
      setDesktopViewport(media.matches)
    }
    sync()
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync)
      return () => {
        active = false
        media.removeEventListener("change", sync)
      }
    }
    media.addListener(sync)
    return () => {
      active = false
      media.removeListener(sync)
    }
  }, [])

  const emitMiniPlayerAction = (action: MiniPlayerAction, endStreamReason?: MiniPlayerEndStreamReason) => {
    emitMiniPlayerTelemetry({
      controllerId: snapshot.controllerId || activeController?.id || "",
      action,
      endStreamReason,
      playing: progress.playing,
      currentSec: progress.current,
      durationSec: progress.duration,
      loopOn,
      playlistIndex,
      route: typeof window !== "undefined" ? window.location.pathname : "",
      locale,
    })
  }

  const transportLabel =
    transportBadge === "buffering"
      ? t("miniplayer.stateBuffering")
      : transportBadge === "stalled"
        ? t("miniplayer.stateStalled")
        : transportBadge === "retrying"
          ? t("miniplayer.stateRetrying")
          : transportBadge === "recovered"
            ? t("miniplayer.stateRecovered")
            : ""

  const commitSeek = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) return
    if (!activeController) return
    activeController.seek(nextValue)
    touchMiniPlayerState()
    emitMiniPlayerAction("seek_commit", "seek")
  }

  const markPlaybackIntent = (ttlMs = 9_000) => {
    const now = performance.now()
    const until = now + ttlMs
    if (until > playbackIntentUntilMsRef.current) {
      playbackIntentUntilMsRef.current = until
    }
    playbackIntentStartedAtMsRef.current = now
  }

  useEffect(() => {
    if (!controlsActive || !isActiveController) return
    const prevId = previousControllerIdRef.current
    if (prevId && snapshot.controllerId && prevId !== snapshot.controllerId) {
      emitMiniPlayerTelemetry({
        controllerId: snapshot.controllerId,
        action: "controller_handoff",
        endStreamReason: "source_handoff",
        playing: progress.playing,
        currentSec: progress.current,
        durationSec: progress.duration,
        loopOn,
        playlistIndex,
        route: typeof window !== "undefined" ? window.location.pathname : "",
        locale,
      })
    }
    previousControllerIdRef.current = snapshot.controllerId
  }, [controlsActive, isActiveController, locale, loopOn, playlistIndex, progress, snapshot.controllerId])

  useEffect(() => {
    if (!controlsActive || !isActiveController || !activeController) return
    const now = performance.now()
    const progressState = lastProgressRef.current
    const current = progress.current
    const advanced = progress.playing && Math.abs(current - progressState.current) > 0.08
    const hasPlaybackIntent = now <= playbackIntentUntilMsRef.current
    const emitTransportStalled = () => {
      emitMiniPlayerTelemetry({
        controllerId: snapshot.controllerId || activeController.id,
        action: "transport_stalled",
        endStreamReason: "stalled",
        playing: progress.playing,
        currentSec: progress.current,
        durationSec: progress.duration,
        loopOn,
        playlistIndex,
        route: typeof window !== "undefined" ? window.location.pathname : "",
        locale,
      })
    }
    const deferBadge = (next: TransportBadgeState) => {
      window.setTimeout(() => {
        setTransportBadge(next)
      }, 0)
    }

    if (!progress.playing && !hasPlaybackIntent) {
      progressState.current = current
      progressState.advancedAtMs = now
      progressState.recoveredUntilMs = 0
      if (transportBadge !== "idle") deferBadge("idle")
      return
    }

    if (!progress.playing && hasPlaybackIntent) {
      const intentElapsedMs = now - playbackIntentStartedAtMsRef.current
      if (intentElapsedMs >= TRANSPORT_BUFFERING_THRESHOLD_MS && transportBadge === "idle") {
        deferBadge("buffering")
      }
      if (intentElapsedMs >= TRANSPORT_STALLED_THRESHOLD_MS && transportBadge !== "stalled" && transportBadge !== "retrying") {
        deferBadge("stalled")
        emitTransportStalled()
      }
      return
    }

    if (advanced) {
      playbackIntentUntilMsRef.current = 0
      progressState.current = current
      progressState.advancedAtMs = now
      if (transportBadge === "stalled" || transportBadge === "retrying") {
        deferBadge("recovered")
        progressState.recoveredUntilMs = now + 1600
        emitMiniPlayerTelemetry({
          controllerId: snapshot.controllerId || activeController.id,
          action: "transport_recovered",
          endStreamReason: "retry_recovered",
          playing: progress.playing,
          currentSec: progress.current,
          durationSec: progress.duration,
          loopOn,
          playlistIndex,
          route: typeof window !== "undefined" ? window.location.pathname : "",
          locale,
        })
        return
      }
    } else {
      const idleMs = now - progressState.advancedAtMs
      if (idleMs >= TRANSPORT_BUFFERING_THRESHOLD_MS && transportBadge === "idle") {
        deferBadge("buffering")
      }
      if (idleMs >= TRANSPORT_STALLED_THRESHOLD_MS && transportBadge !== "stalled" && transportBadge !== "retrying") {
        deferBadge("stalled")
        emitTransportStalled()
      }
    }

    if (transportBadge === "recovered" && now >= progressState.recoveredUntilMs) {
      deferBadge("idle")
    }
  }, [activeController, controlsActive, isActiveController, locale, loopOn, playlistIndex, progress, snapshot.controllerId, transportBadge, transportPulse])

  useEffect(() => {
    if (!controlsActive || !isActiveController || !activeController) return
    const timer = window.setInterval(() => {
      const now = performance.now()
      const hasPlaybackIntent = now <= playbackIntentUntilMsRef.current
      if (progress.playing || hasPlaybackIntent || transportBadge !== "idle") {
        setTransportPulse((value) => (value + 1) % 1_000_000)
      }
    }, 450)
    return () => {
      window.clearInterval(timer)
    }
  }, [activeController, controlsActive, isActiveController, progress.playing, transportBadge])

  const beginScrub = () => {
    isScrubbingRef.current = true
    setIsScrubbing(true)
    if (rangeRef.current) setScrubValue(Number(rangeRef.current.value))
  }

  const endScrub = () => {
    if (!isScrubbingRef.current) return
    isScrubbingRef.current = false
    setIsScrubbing(false)
    const nextValue = scrubValue ?? Number(rangeRef.current?.value ?? progress.current)
    setScrubValue(null)
    commitSeek(nextValue)
  }

  const switchQueue = (delta: number) => {
    if (!hasQueue || !activeController) return
    markPlaybackIntent()
    const base = playlistIndex >= 0 ? playlistIndex : 0
    const nextIdx = (base + delta + playlist.length) % playlist.length
    emitMiniPlayerAction(delta < 0 ? "queue_prev" : "queue_next", delta < 0 ? "previous_track" : "next_track")
    const jumpTo = activeController.jumpTo
    const hasJumpTo = typeof jumpTo === "function"
    if (hasJumpTo) jumpTo(nextIdx)
    else if (delta < 0) activeController.prev()
    else activeController.next()
    touchMiniPlayerState()
    if (followCard) {
      const slug = playlist[nextIdx]?.id
      if (slug) router.push(getSoundTrackHref(locale, slug))
    }
    // Controllers with jumpTo() already own autoplay behavior.
    // Extra forced play here creates a second controller_play and can cause
    // audible stutter / swallowed intro on Safari.
    if (!hasJumpTo) {
      window.setTimeout(() => {
        const p = activeController.getProgress()
        if (!p.playing) activeController.play()
        touchMiniPlayerState()
      }, 30)
    }
  }

  if (!controlsActive || !isActiveController || !activeController) return null

  if (mobile) {
    return (
      <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] sm:hidden">
        <div className="rounded-2xl border border-white/15 bg-[#0a0d16]/90 p-2 text-white shadow-[0_18px_44px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <div className="mb-1 flex items-center gap-1">
            <button
              onClick={() => switchQueue(-1)}
              disabled={!hasQueue}
              className="btn-round h-8 w-8 text-white/90 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t("miniplayer.previousAria")}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m11 19-7-7 7-7" /><path d="M20 5v14" /></svg>
            </button>
            <button
              onClick={() => {
                if (!progress.playing) markPlaybackIntent()
                emitMiniPlayerAction(progress.playing ? "toggle_pause" : "toggle_play", progress.playing ? "user_pause" : "resume")
                activeController.toggle()
                touchMiniPlayerState()
              }}
              className="btn-round h-8 w-8 text-white hover:text-white"
              aria-label={progress.playing ? t("miniplayer.pauseAria") : t("miniplayer.playAria")}
            >
              {progress.playing ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <button
              onClick={() => switchQueue(1)}
              disabled={!hasQueue}
              className="btn-round h-8 w-8 text-white/90 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t("miniplayer.nextAria")}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m13 5 7 7-7 7" /><path d="M4 5v14" /></svg>
            </button>
            <button
              onClick={() => {
                emitMiniPlayerAction("toggle_loop")
                activeController.setLoop?.(!loopOn)
                touchMiniPlayerState()
              }}
              className={`btn-round h-8 w-8 ${loopOn ? "text-[#7ea4cd]" : "text-white/80"} hover:text-white`}
              aria-label={t("miniplayer.repeatAria")}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            </button>
            <div className="min-w-0 pl-1">
              <div className="truncate text-[11px] text-white/95">{title}</div>
              <div className="truncate text-[10px] text-white/60">{subtitle}</div>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, progress.duration || 0)}
            step={0.01}
            value={Math.min(progress.current, progress.duration > 0 ? progress.duration : progress.current)}
            onChange={(e) => {
              const next = Number(e.currentTarget.value)
              commitSeek(next)
            }}
            className="w-full range-thin"
            aria-label={t("miniplayer.progressAria")}
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-white/60">
            <span>{formatTime(progress.current)}</span>
            <span>{formatTime(progress.duration)}</span>
          </div>
          {transportLabel ? <div className="mt-0.5 text-[10px] text-amber-300">{transportLabel}</div> : null}
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex h-10 items-center gap-1 rounded-xl border border-white/10 bg-black/25 px-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
        <button
          onClick={() => switchQueue(-1)}
          disabled={!hasQueue}
          className="btn-round h-7 w-7 text-white/90 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t("miniplayer.previousAria")}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m11 19-7-7 7-7" /><path d="M20 5v14" /></svg>
        </button>
        <button
            onClick={() => {
              if (!progress.playing) markPlaybackIntent()
              emitMiniPlayerAction(progress.playing ? "toggle_pause" : "toggle_play", progress.playing ? "user_pause" : "resume")
              activeController.toggle()
              touchMiniPlayerState()
            }}
          className="btn-round h-7 w-7 text-white hover:text-white"
          aria-label={progress.playing ? t("miniplayer.pauseAria") : t("miniplayer.playAria")}
        >
          {progress.playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <button
          onClick={() => switchQueue(1)}
          disabled={!hasQueue}
          className="btn-round h-7 w-7 text-white/90 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t("miniplayer.nextAria")}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m13 5 7 7-7 7" /><path d="M4 5v14" /></svg>
        </button>
        <button
              onClick={() => {
                emitMiniPlayerAction("toggle_loop")
                activeController.setLoop?.(!loopOn)
                touchMiniPlayerState()
              }}
          className={`btn-round h-7 w-7 ${loopOn ? "text-[#7ea4cd]" : "text-white/80"} hover:text-white`}
          aria-label={t("miniplayer.repeatAria")}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        </button>
      </div>

      <button
        onClick={() => {
          const next = !expanded
          setExpanded(next)
          emitMiniPlayerAction(next ? "panel_expand" : "panel_collapse")
        }}
        className="absolute -bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-white/25 hover:bg-white/50"
        aria-label={t("miniplayer.expandAria")}
      />

      {expanded ? (
        <div className="absolute left-1/2 top-full z-50 mt-1 w-[220px] -translate-x-1/2 rounded-xl border border-white/10 bg-black/75 p-2 text-white shadow-2xl backdrop-blur-md">
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <label className="mb-0.5 flex items-center gap-1 text-[10px] text-white/80">
                <input
                  type="checkbox"
                  checked={followCard}
                  onChange={(e) => setFollowCard(e.currentTarget.checked)}
                  className="h-3 w-3 accent-[#7ea4cd]"
                />
                <span>{t("miniplayer.followCard")}</span>
              </label>
              <div className="truncate text-[11px] text-white/95">{title}</div>
              <div className="truncate text-[10px] text-white/60">{subtitle}</div>
              {transportLabel ? (
                <div className="mt-0.5 text-[10px] text-amber-300">{transportLabel}</div>
              ) : null}
            </div>
            <div className="relative">
              <button
                onClick={() => setPlaylistOpen((v) => !v)}
                onMouseEnter={() => setPlaylistOpen(true)}
                className="btn-round h-7 w-7 text-white/80 hover:text-white"
                aria-label={t("miniplayer.playlistAria")}
                title={t("miniplayer.playlistTitle")}
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
                  <div className="mb-1 px-1 text-[10px] text-white/60">{t("miniplayer.queueTitle")}</div>
                  <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                    {playlist.map((item, idx) => (
                      <button
                        key={`${item.id}-${idx}`}
                        onClick={() => {
                          markPlaybackIntent()
                          emitMiniPlayerAction("queue_jump", "playlist_jump")
                          activeController.jumpTo?.(idx)
                          touchMiniPlayerState()
                          if (followCard && item.id) router.push(getSoundTrackHref(locale, item.id))
                        }}
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
              ref={rangeRef}
              type="range"
              min={0}
              max={Math.max(0, progress.duration || 0)}
              step={0.01}
              value={displayCurrent}
              onPointerDown={beginScrub}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onBlur={endScrub}
              onChange={(e) => {
                const next = Number(e.currentTarget.value)
                if (isScrubbingRef.current) {
                  setScrubValue(next)
                  return
                }
                commitSeek(next)
              }}
              className="w-full range-thin"
              aria-label={t("miniplayer.progressAria")}
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-white/65">
              <span>{formatTime(displayCurrent)}</span>
              <span>{formatTime(progress.duration)}</span>
            </div>
          </div>
          <div className="absolute left-1/2 top-0 h-full w-[110px] -translate-x-1/2 pointer-events-none" />
        </div>
      ) : null}
    </div>
  )
}
