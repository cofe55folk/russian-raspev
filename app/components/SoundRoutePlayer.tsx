"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import MultiTrackPlayer, { type TrackDef } from "./MultiTrackPlayer"
import { getGlobalAudioController, requestGlobalAudio, subscribeGlobalAudio, type GlobalAudioController } from "../lib/globalAudioManager"
import { extractLocaleFromPathname, getAuthHref, getSoundTrackHref, stripLocalePrefixFromPathname } from "../lib/i18n/routing"
import { getSoundDisplayArchiveInfo, getSoundDisplayTitle, SOUND_PLAYABLE_ITEMS, getPlayableIndexBySlug, toTrackDefs } from "../lib/soundCatalog"
import { SOUND_ROUTE_PLAY_EVENT, type SoundRoutePlayEventDetail } from "../lib/soundRoutePlayerBus"
import {
  formatAudioDebugBuffer,
  getAudioDebugBufferSnapshot,
  isAudioDebugEnabled,
  isAudioTtfpEnabled,
  logAudioDebug,
  subscribeAudioDebugBuffer,
} from "../lib/audioDebugLogStore"
import { getAudioDebugCaptureArtifactSnapshot } from "../lib/audioDebugCaptureStore"
import { touchMiniPlayerState } from "../lib/miniPlayerStateStore"
import { getLatestSoundPlayerSlot, subscribeSoundPlayerSlot } from "../lib/soundPlayerSlotRegistry"
import { markSoundRoutePlayerReady } from "../lib/soundRoutePlayerReady"

const FORCE_AUTOPLAY_STORAGE_KEY = "rr_force_autoplay_next_mount"

declare global {
  interface Window {
    __rrSoundPlayerHost?: HTMLElement | null
  }
}

function buildTrackScopeId(trackList: TrackDef[]): string {
  const raw = trackList.map((t) => t.src).join("|")
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return normalized.slice(0, 180) || "default"
}

function sameTrackDefsBySource(a: TrackDef[], b: TrackDef[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.src !== b[i]?.src) return false
  }
  return true
}

function resolveSoundPlayerHost(): HTMLElement | null {
  if (typeof window === "undefined") return null
  const cachedHost = window.__rrSoundPlayerHost
  if (cachedHost instanceof HTMLElement) return cachedHost
  const host = document.getElementById("rr-sound-player-host")
  if (!(host instanceof HTMLElement)) return null
  window.__rrSoundPlayerHost = host
  return host
}

function ensureSoundPlayerHost(parking: HTMLElement | null): HTMLElement | null {
  if (typeof window === "undefined") return null
  let host = resolveSoundPlayerHost()
  if (!host) {
    host = document.createElement("div")
    host.id = "rr-sound-player-host"
    window.__rrSoundPlayerHost = host
  }
  if (!host.isConnected && parking) {
    parking.appendChild(host)
  }
  return host
}

function extractSoundSlugFromPath(pathname: string): string {
  const normalizedPath = stripLocalePrefixFromPathname(pathname)
  if (!normalizedPath.startsWith("/sound/")) return ""
  return normalizedPath
    .slice("/sound/".length)
    .replace(/^\/+|\/+$/g, "")
}

export default function SoundRoutePlayer() {
  const pathname = usePathname()
  const localeFromPath = extractLocaleFromPathname(pathname) ?? "ru"
  const initialRouteSlug = extractSoundSlugFromPath(pathname)
  const initialIndex = (() => {
    const idx = initialRouteSlug ? getPlayableIndexBySlug(initialRouteSlug) : -1
    return idx >= 0 ? idx : 0
  })()
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const [activeTracks, setActiveTracks] = useState<TrackDef[]>(() => toTrackDefs(SOUND_PLAYABLE_ITEMS[initialIndex], "free", localeFromPath))
  const [activeTeleprompterUrl, setActiveTeleprompterUrl] = useState<string | undefined>(
    SOUND_PLAYABLE_ITEMS[initialIndex]?.teleprompterSourceUrl ?? undefined
  )
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [loopOn, setLoopOn] = useState(false)
  const [debugCopyState, setDebugCopyState] = useState<"idle" | "ok" | "error">("idle")
  const [debugSaveState, setDebugSaveState] = useState<"idle" | "saving" | "ok" | "error">("idle")
  const [debugSavePath, setDebugSavePath] = useState<string | null>(null)
  const loopOnRef = useRef(loopOn)
  const [trackAccessMeta, setTrackAccessMeta] = useState<{ free: number; premium: number; unlocked: boolean } | null>(null)

  const backendControllerRef = useRef<GlobalAudioController | null>(null)
  const wrapperControllerRef = useRef<GlobalAudioController | null>(null)
  const activeTracksRef = useRef(activeTracks)
  const pendingAutoplayRef = useRef(false)
  const pendingTrackScopeRef = useRef<string | null>(null)
  const trackAccessRequestIdRef = useRef(0)
  const readyTrackScopeRef = useRef<string | null>(null)
  const activeIndexRef = useRef(initialIndex)
  const initializedRef = useRef(false)
  const activeSlug = SOUND_PLAYABLE_ITEMS[activeIndex]?.slug ?? ""
  const activeTitle = SOUND_PLAYABLE_ITEMS[activeIndex]
    ? getSoundDisplayTitle(SOUND_PLAYABLE_ITEMS[activeIndex], localeFromPath)
    : localeFromPath === "ru"
      ? "другая песня"
      : "another song"
  const routeSlug = extractSoundSlugFromPath(pathname)
  const showDetailedSections = !routeSlug || routeSlug === activeSlug
  const livePortalTarget = portalTarget ?? resolveSoundPlayerHost()
  const topStatusBanner =
    routeSlug && activeSlug && routeSlug !== activeSlug
      ? {
          href: getSoundTrackHref(localeFromPath, activeSlug),
          text:
            localeFromPath === "ru"
              ? `Сейчас играет: ${activeTitle} — открыть карточку`
              : `Now playing: ${activeTitle} — open card`,
        }
      : trackAccessMeta && trackAccessMeta.premium > 0
        ? {
            href: trackAccessMeta.unlocked ? getSoundTrackHref(localeFromPath, activeSlug) : getAuthHref(localeFromPath),
            text: trackAccessMeta.unlocked
              ? localeFromPath === "ru"
                ? `Доступ открывает ${trackAccessMeta.free + trackAccessMeta.premium} дорожек (${trackAccessMeta.premium} премиум)`
                : `Access unlocks ${trackAccessMeta.free + trackAccessMeta.premium} tracks (${trackAccessMeta.premium} premium)`
              : localeFromPath === "ru"
                ? `Доступно ${trackAccessMeta.free} дорожек, ещё ${trackAccessMeta.premium} по подписке`
                : `${trackAccessMeta.free} tracks available, ${trackAccessMeta.premium} more with subscription`,
          }
      : null
  const audioDebugEntries = useSyncExternalStore(
    subscribeAudioDebugBuffer,
    getAudioDebugBufferSnapshot,
    getAudioDebugBufferSnapshot
  )

  useEffect(() => {
    activeTracksRef.current = activeTracks
  }, [activeTracks])

  const copyAudioDebugLog = useCallback(async () => {
    const entries = getAudioDebugBufferSnapshot()
    if (entries.length === 0) {
      setDebugCopyState("error")
      window.setTimeout(() => setDebugCopyState("idle"), 1200)
      return
    }
    const text = formatAudioDebugBuffer(entries)
    try {
      await navigator.clipboard.writeText(text)
      setDebugCopyState("ok")
    } catch {
      setDebugCopyState("error")
    }
    window.setTimeout(() => setDebugCopyState("idle"), 1600)
  }, [])

  const saveAudioDebugLog = useCallback(async () => {
    const entries = getAudioDebugBufferSnapshot()
    if (entries.length === 0) {
      setDebugSaveState("error")
      setDebugSavePath(null)
      window.setTimeout(() => setDebugSaveState("idle"), 1600)
      return
    }
    const text = formatAudioDebugBuffer(entries)
    setDebugSaveState("saving")
    setDebugSavePath(null)
    try {
      if (typeof window !== "undefined") {
        const token = `flush-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await new Promise<void>((resolve) => {
          let settled = false
          const complete = () => {
            if (settled) return
            settled = true
            window.removeEventListener("rr-audio-debug-flush-complete", onComplete as EventListener)
            resolve()
          }
          const onComplete = (event: Event) => {
            if (!(event instanceof CustomEvent)) return
            const eventToken =
              event.detail && typeof event.detail.token === "string" ? (event.detail.token as string) : null
            if (eventToken !== token) return
            complete()
          }
          window.addEventListener("rr-audio-debug-flush-complete", onComplete as EventListener)
          window.dispatchEvent(new CustomEvent("rr-audio-debug-flush-capture", { detail: { token } }))
          window.setTimeout(() => complete(), 300)
        })
      }
      const audioArtifact = getAudioDebugCaptureArtifactSnapshot()
      const response = await fetch("/api/debug/audio-log", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entries,
          pathname,
          text,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          audioArtifact,
        }),
      })
      if (!response.ok) {
        throw new Error(`save_failed_${response.status}`)
      }
      const payload = (await response.json()) as { file?: unknown }
      setDebugSavePath(typeof payload.file === "string" ? payload.file : null)
      setDebugSaveState("ok")
    } catch {
      setDebugSaveState("error")
      setDebugSavePath(null)
    }
    window.setTimeout(() => setDebugSaveState("idle"), 3200)
  }, [pathname])

  useEffect(() => {
    logAudioDebug("route:player_visibility", {
      pathname,
      routeSlug,
      activeSlug,
      showDetailedSections,
      hostResolved: !!livePortalTarget,
      hostConnected: !!livePortalTarget?.isConnected,
      hostParentId: livePortalTarget?.parentElement?.id ?? null,
      pendingTrackScopeId: pendingTrackScopeRef.current,
      readyTrackScopeId: readyTrackScopeRef.current,
    })
  }, [activeSlug, livePortalTarget, pathname, routeSlug, showDetailedSections])

  useLayoutEffect(() => {
    const parking = typeof document === "undefined" ? null : document.getElementById("rr-sound-player-parking")
    const initialHost = ensureSoundPlayerHost(parking instanceof HTMLElement ? parking : null)
    if (initialHost && portalTarget === initialHost) return
    let rafId: number | null = null

    const resolvePortalTarget = () => {
      const host = ensureSoundPlayerHost(parking instanceof HTMLElement ? parking : null)
      if (host) {
        setPortalTarget((current) => (current === host ? current : host))
        return
      }
      rafId = window.requestAnimationFrame(resolvePortalTarget)
    }

    resolvePortalTarget()
    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [livePortalTarget, portalTarget])

  const setSongByIndex = useCallback((idx: number, autoplay: boolean) => {
    if (idx < 0 || idx >= SOUND_PLAYABLE_ITEMS.length) return
    const item = SOUND_PLAYABLE_ITEMS[idx]
    const fallbackDefs = toTrackDefs(item, "free", localeFromPath)
    if (!fallbackDefs.length) return

    // Stop current transport before swapping track scope to avoid overlap/glitch
    // between outgoing and incoming graphs on rapid next/prev switches.
    try {
      backendControllerRef.current?.stop()
    } catch {}

    backendControllerRef.current?.prime?.()
    setActiveIndex(idx)
    activeIndexRef.current = idx
    setActiveTracks(fallbackDefs)
    setActiveTeleprompterUrl(item.teleprompterSourceUrl ?? undefined)
    pendingAutoplayRef.current = autoplay
    pendingTrackScopeRef.current = buildTrackScopeId(fallbackDefs)
    touchMiniPlayerState()
    setTrackAccessMeta({
      free: fallbackDefs.length,
      premium: Math.max(0, toTrackDefs(item, "all", localeFromPath).length - fallbackDefs.length),
      unlocked: false,
    })

    const requestId = ++trackAccessRequestIdRef.current
    void (async () => {
      try {
        const response = await fetch(`/api/sound/${item.slug}/tracks`, {
          cache: "no-store",
          headers: { "x-rr-locale": localeFromPath },
        })
        if (!response.ok) return
        const payload = (await response.json()) as {
          tracks?: unknown
          premiumUnlocked?: unknown
          counts?: { free?: unknown; premium?: unknown }
        }
        if (trackAccessRequestIdRef.current !== requestId) return
        const tracks = Array.isArray(payload.tracks)
          ? payload.tracks
              .map((track) => {
                if (!track || typeof track !== "object") return null
                const candidate = track as { name?: unknown; src?: unknown }
                if (typeof candidate.name !== "string" || typeof candidate.src !== "string") return null
                return { name: candidate.name, src: candidate.src } as TrackDef
              })
              .filter((track): track is TrackDef => !!track)
          : []
        if (!tracks.length) return
        const nextScopeId = buildTrackScopeId(tracks)
        const isPlayingNow = !!backendControllerRef.current?.getProgress().playing
        const currentReadyScopeId = readyTrackScopeRef.current
        const wouldHotSwapPlayingScope =
          isPlayingNow &&
          !!currentReadyScopeId &&
          currentReadyScopeId !== nextScopeId

        // Avoid replacing active multitrack scope while playback is already running:
        // late access-response upgrades can rebuild graph mid-song and look like
        // intro swallow / "stream delayed" / stutter on long tracks.
        if (!wouldHotSwapPlayingScope) {
          const tracksActuallyChanged = !sameTrackDefsBySource(activeTracksRef.current, tracks)
          if (tracksActuallyChanged) {
            setActiveTracks(tracks)
            pendingTrackScopeRef.current = nextScopeId
            touchMiniPlayerState()
          }
        }

        touchMiniPlayerState()
        setTrackAccessMeta({
          free: typeof payload.counts?.free === "number" ? payload.counts.free : fallbackDefs.length,
          premium: typeof payload.counts?.premium === "number" ? payload.counts.premium : Math.max(0, tracks.length - fallbackDefs.length),
          unlocked: payload.premiumUnlocked === true,
        })
      } catch {}
    })()
  }, [localeFromPath])

  const scheduleSongByIndex = useCallback((idx: number, autoplay: boolean) => {
    window.setTimeout(() => setSongByIndex(idx, autoplay), 0)
  }, [setSongByIndex])

  const onBackendControllerReady = useCallback((controller: GlobalAudioController | null) => {
    backendControllerRef.current = controller
    if (controller?.getLoop) {
      const backendLoopOn = !!controller.getLoop()
      loopOnRef.current = backendLoopOn
      setLoopOn(backendLoopOn)
    }
    const pendingScope = pendingTrackScopeRef.current
    if (!controller || !pendingScope) return
    if (pendingScope !== readyTrackScopeRef.current) return

    pendingTrackScopeRef.current = null
    if (!pendingAutoplayRef.current) return
    pendingAutoplayRef.current = false
    if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
    controller.seek(0)
    controller.play()
    touchMiniPlayerState()
  }, [])

  useEffect(() => {
    loopOnRef.current = loopOn
  }, [loopOn])

  const onTrackSetReady = useCallback((trackScopeId: string) => {
    readyTrackScopeRef.current = trackScopeId
    const pendingScope = pendingTrackScopeRef.current
    const controller = backendControllerRef.current
    if (!pendingScope || !controller) return
    if (pendingScope !== trackScopeId) return

    pendingTrackScopeRef.current = null
    if (!pendingAutoplayRef.current) return
    pendingAutoplayRef.current = false
    if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
    controller.seek(0)
    controller.play()
    touchMiniPlayerState()
  }, [])

  useEffect(() => {
    wrapperControllerRef.current = {
      id: "rr-sound-route-player",
      title: SOUND_PLAYABLE_ITEMS[activeIndex]
        ? getSoundDisplayTitle(SOUND_PLAYABLE_ITEMS[activeIndex], localeFromPath)
        : localeFromPath === "ru"
          ? "Песня"
          : "Song",
      subtitle: SOUND_PLAYABLE_ITEMS[activeIndex]
        ? getSoundDisplayArchiveInfo(SOUND_PLAYABLE_ITEMS[activeIndex], localeFromPath) ?? ""
        : "",
      getTitle: () => {
        const item = SOUND_PLAYABLE_ITEMS[activeIndexRef.current]
        if (!item) return localeFromPath === "ru" ? "Песня" : "Song"
        return getSoundDisplayTitle(item, localeFromPath)
      },
      getSubtitle: () => {
        const item = SOUND_PLAYABLE_ITEMS[activeIndexRef.current]
        if (!item) return ""
        return getSoundDisplayArchiveInfo(item, localeFromPath) ?? ""
      },
      getPlaylist: () =>
        SOUND_PLAYABLE_ITEMS.map((item) => ({
          id: item.slug,
          title: getSoundDisplayTitle(item, localeFromPath),
          subtitle: getSoundDisplayArchiveInfo(item, localeFromPath) ?? "",
        })),
      getPlaylistIndex: () => activeIndexRef.current,
      jumpTo: (index: number) => {
        if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
        setSongByIndex(index, true)
        touchMiniPlayerState()
      },
      stop: () => {
        backendControllerRef.current?.stop()
        pendingAutoplayRef.current = false
        pendingTrackScopeRef.current = null
        touchMiniPlayerState()
      },
      play: () => {
        if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
        if (backendControllerRef.current) {
          backendControllerRef.current.play()
          touchMiniPlayerState()
          return
        }
        setSongByIndex(activeIndexRef.current, true)
        touchMiniPlayerState()
      },
      pause: () => {
        backendControllerRef.current?.pause()
        touchMiniPlayerState()
      },
      toggle: () => {
        if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
        if (backendControllerRef.current) {
          backendControllerRef.current.toggle()
          touchMiniPlayerState()
          return
        }
        setSongByIndex(activeIndexRef.current, true)
        touchMiniPlayerState()
      },
      prev: () => {
        setSongByIndex((activeIndexRef.current - 1 + SOUND_PLAYABLE_ITEMS.length) % SOUND_PLAYABLE_ITEMS.length, true)
        touchMiniPlayerState()
      },
      next: () => {
        setSongByIndex((activeIndexRef.current + 1) % SOUND_PLAYABLE_ITEMS.length, true)
        touchMiniPlayerState()
      },
      seek: (timeSec: number) => {
        backendControllerRef.current?.seek(timeSec)
        touchMiniPlayerState()
      },
      getProgress: () => {
        if (backendControllerRef.current) return backendControllerRef.current.getProgress()
        return { current: 0, duration: 0, playing: false }
      },
      getLoop: () => {
        if (backendControllerRef.current?.getLoop) return !!backendControllerRef.current.getLoop()
        return loopOnRef.current
      },
      setLoop: (loop: boolean) => {
        loopOnRef.current = loop
        setLoopOn(loop)
        backendControllerRef.current?.setLoop?.(loop)
        touchMiniPlayerState()
      },
    }
  }, [activeIndex, localeFromPath, setSongByIndex])

  useEffect(() => {
    markSoundRoutePlayerReady(true)
    return () => {
      markSoundRoutePlayerReady(false)
    }
  }, [])

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<SoundRoutePlayEventDetail>).detail
      if (!detail?.slug) return
      const idx = getPlayableIndexBySlug(detail.slug)
      if (idx < 0) return
      if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
      setSongByIndex(idx, !!detail.autoplay)
    }
    window.addEventListener(SOUND_ROUTE_PLAY_EVENT, handler as EventListener)
    return () => {
      window.removeEventListener(SOUND_ROUTE_PLAY_EVENT, handler as EventListener)
    }
  }, [setSongByIndex])

  const subscribeMount = useCallback(() => () => {}, [])
  const isMounted = useSyncExternalStore(subscribeMount, () => true, () => false)
  const debugEntryCount = isMounted ? audioDebugEntries.length : 0
  const showFloatingDebugLogButton = isMounted
    ? audioDebugEntries.length > 0 || isAudioDebugEnabled() || isAudioTtfpEnabled()
    : process.env.NEXT_PUBLIC_AUDIO_DEBUG === "1" || process.env.NEXT_PUBLIC_AUDIO_TTFP === "1"

  useEffect(() => {
    const parking = document.getElementById("rr-sound-player-parking")
    const host = livePortalTarget ?? ensureSoundPlayerHost(parking instanceof HTMLElement ? parking : null)
    if (!host) return
    let moveHostRaf: number | null = null

    const moveHost = () => {
      const currentHost = host
      const slotFromRegistry = getLatestSoundPlayerSlot()
      const slotFromDom = document.getElementById("rr-sound-player-slot")
      const slot = slotFromRegistry?.isConnected ? slotFromRegistry : slotFromDom
      if (!slot) {
        if (parking && currentHost.parentElement !== parking) {
          parking.appendChild(currentHost)
        }
        currentHost.style.display = "none"
        return
      }
      if (currentHost.parentElement !== slot) {
        slot.appendChild(currentHost)
      }
      currentHost.style.display = ""
    }

    const scheduleMoveHost = () => {
      if (moveHostRaf != null) return
      moveHostRaf = window.requestAnimationFrame(() => {
        moveHostRaf = null
        moveHost()
      })
    }

    moveHost()
    const unsubscribe = subscribeSoundPlayerSlot(scheduleMoveHost)
    const observer = new MutationObserver(scheduleMoveHost)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      if (moveHostRaf != null) {
        window.cancelAnimationFrame(moveHostRaf)
        moveHostRaf = null
      }
      unsubscribe()
      observer.disconnect()
    }
  }, [livePortalTarget, pathname])

  const ensureWrapperActiveWhenPlaying = useCallback(() => {
    const backend = backendControllerRef.current
    const wrapper = wrapperControllerRef.current
    if (!backend || !wrapper) return
    const progress = backend.getProgress()
    if (!progress.playing) return
    const active = getGlobalAudioController()
    if (!active || active.id !== wrapper.id) {
      requestGlobalAudio(wrapper)
      touchMiniPlayerState()
    }
  }, [])

  const onPlaybackStateChange = useCallback((playing: boolean) => {
    if (!playing) return
    const activateWrapper = () => {
      const wrapper = wrapperControllerRef.current
      if (!wrapper) return false
      requestGlobalAudio(wrapper)
      touchMiniPlayerState()
      return true
    }
    if (activateWrapper()) return
    window.setTimeout(() => {
      activateWrapper()
    }, 0)
  }, [])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") ensureWrapperActiveWhenPlaying()
    }
    const unsubscribe = subscribeGlobalAudio(ensureWrapperActiveWhenPlaying)
    window.addEventListener("focus", ensureWrapperActiveWhenPlaying)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      unsubscribe()
      window.removeEventListener("focus", ensureWrapperActiveWhenPlaying)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [ensureWrapperActiveWhenPlaying])

  useEffect(() => {
    const slug = extractSoundSlugFromPath(pathname)
    const slugIdx = slug ? getPlayableIndexBySlug(slug) : -1

    if (!initializedRef.current) {
      initializedRef.current = true
      return
    }

    const forcedAutoplay = (() => {
      try {
        if (window.sessionStorage.getItem(FORCE_AUTOPLAY_STORAGE_KEY) === "1") {
          window.sessionStorage.removeItem(FORCE_AUTOPLAY_STORAGE_KEY)
          return true
        }
      } catch {}
      return false
    })()

    if (slugIdx >= 0 && forcedAutoplay) {
      if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
      scheduleSongByIndex(slugIdx, true)
      return
    }

    if (slugIdx >= 0 && slugIdx !== activeIndexRef.current) {
      const backend = backendControllerRef.current
      const wrapper = wrapperControllerRef.current
      const active = getGlobalAudioController()
      const playingNow = !!backend?.getProgress().playing
      const activeIsWrapper = !!active && !!wrapper && active.id === wrapper.id

      // Switching pages must not forcibly change currently playing song.
      if (!playingNow && !activeIsWrapper) {
        if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
        scheduleSongByIndex(slugIdx, false)
      }
    }
  }, [pathname, scheduleSongByIndex])

  const playerNode = (
    <MultiTrackPlayer
      tracks={activeTracks}
      appendableActivationTargets={activeSlug ? [activeSlug] : []}
      teleprompterSourceUrl={activeTeleprompterUrl}
      onControllerReady={onBackendControllerReady}
      onPlaybackStateChange={onPlaybackStateChange}
      onTrackSetReady={onTrackSetReady}
      registerGlobalAudio={false}
      showDetailedSections={showDetailedSections}
      topStatusBanner={topStatusBanner}
    />
  )

  const floatingDebugLogButton = showFloatingDebugLogButton ? (
    <div className="fixed bottom-4 right-4 z-[120]">
      <div className="flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => {
            void copyAudioDebugLog()
          }}
          className="rounded-full border border-white/15 bg-black/80 px-4 py-2 text-xs font-medium text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:bg-black/90"
          title={localeFromPath === "ru" ? "Скопировать журнал audio debug" : "Copy audio debug log"}
        >
          {localeFromPath === "ru"
            ? `Copy debug log${debugEntryCount ? ` (${debugEntryCount})` : ""}`
            : `Copy debug log${debugEntryCount ? ` (${debugEntryCount})` : ""}`}
        </button>
        <button
          type="button"
          onClick={() => {
            void saveAudioDebugLog()
          }}
          className="rounded-full border border-white/15 bg-black/80 px-4 py-2 text-xs font-medium text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:bg-black/90 disabled:cursor-wait disabled:opacity-70"
          disabled={debugSaveState === "saving"}
          title={localeFromPath === "ru" ? "Сохранить журнал audio debug в tmp/audio-debug" : "Save audio debug log to tmp/audio-debug"}
        >
          {debugSaveState === "saving"
            ? localeFromPath === "ru"
              ? "Saving debug log..."
              : "Saving debug log..."
            : localeFromPath === "ru"
              ? "Save debug log"
              : "Save debug log"}
        </button>
      </div>
      {debugCopyState !== "idle" || debugSaveState !== "idle" ? (
        <div className="mt-2 rounded-2xl border border-white/10 bg-black/75 px-3 py-2 text-[11px] text-white/80 backdrop-blur-md">
          {debugSaveState === "ok"
            ? debugSavePath
              ? localeFromPath === "ru"
                ? `saved: ${debugSavePath}`
                : `saved: ${debugSavePath}`
              : localeFromPath === "ru"
                ? "debug log saved"
                : "debug log saved"
            : debugSaveState === "error"
              ? localeFromPath === "ru"
                ? "debug log save failed"
                : "debug log save failed"
              : debugCopyState === "ok"
                ? localeFromPath === "ru"
                  ? "debug log copied"
                  : "debug log copied"
                : debugCopyState === "error"
                  ? localeFromPath === "ru"
                    ? "debug log unavailable"
                    : "debug log unavailable"
                  : localeFromPath === "ru"
                    ? "saving..."
                    : "saving..."}
        </div>
      ) : null}
    </div>
  ) : null

  if (!isMounted) return <>{floatingDebugLogButton}<div className="hidden" aria-hidden>{playerNode}</div></>
  if (livePortalTarget) return <>{floatingDebugLogButton}{createPortal(playerNode, livePortalTarget)}</>
  return <>{floatingDebugLogButton}<div className="hidden" aria-hidden>{playerNode}</div></>
}
