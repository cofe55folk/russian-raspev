"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import MultiTrackPlayer, { type TrackDef } from "./MultiTrackPlayer"
import { getGlobalAudioController, requestGlobalAudio, subscribeGlobalAudio, type GlobalAudioController } from "../lib/globalAudioManager"
import { audioDebug, createAudioDebugSessionId } from "../lib/debug/audioDebug"
import { extractLocaleFromPathname, getAuthHref, getSoundTrackHref, stripLocalePrefixFromPathname } from "../lib/i18n/routing"
import { getSoundDisplayArchiveInfo, getSoundDisplayTitle, SOUND_PLAYABLE_ITEMS, getPlayableIndexBySlug, toTrackDefs } from "../lib/soundCatalog"
import { SOUND_ROUTE_PLAY_EVENT, type SoundRoutePlayEventDetail } from "../lib/soundRoutePlayerBus"
import { touchMiniPlayerState } from "../lib/miniPlayerStateStore"
import { getLatestSoundPlayerSlot, subscribeSoundPlayerSlot } from "../lib/soundPlayerSlotRegistry"

const FORCE_AUTOPLAY_STORAGE_KEY = "rr_force_autoplay_next_mount"

function buildTrackScopeId(trackList: TrackDef[]): string {
  const raw = trackList.map((t) => t.src).join("|")
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return normalized.slice(0, 180) || "default"
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
  const [loopOn, setLoopOn] = useState(false)
  const [trackAccessMeta, setTrackAccessMeta] = useState<{ free: number; premium: number; unlocked: boolean } | null>(null)

  const backendControllerRef = useRef<GlobalAudioController | null>(null)
  const wrapperControllerRef = useRef<GlobalAudioController | null>(null)
  const pendingAutoplayRef = useRef(false)
  const pendingTrackScopeRef = useRef<string | null>(null)
  const trackAccessRequestIdRef = useRef(0)
  const readyTrackScopeRef = useRef<string | null>(null)
  const activeIndexRef = useRef(initialIndex)
  const initializedRef = useRef(false)
  const ownerSessionIdRef = useRef(createAudioDebugSessionId("owner"))
  const prevPathnameRef = useRef(pathname)
  const activeSlug = SOUND_PLAYABLE_ITEMS[activeIndex]?.slug ?? ""
  const activeTitle = SOUND_PLAYABLE_ITEMS[activeIndex]
    ? getSoundDisplayTitle(SOUND_PLAYABLE_ITEMS[activeIndex], localeFromPath)
    : localeFromPath === "ru"
      ? "другая песня"
      : "another song"
  const routeSlug = extractSoundSlugFromPath(pathname)
  const showDetailedSections = !routeSlug || routeSlug === activeSlug
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
  const setSongByIndex = useCallback((idx: number, autoplay: boolean) => {
    if (idx < 0 || idx >= SOUND_PLAYABLE_ITEMS.length) return
    const item = SOUND_PLAYABLE_ITEMS[idx]
    const fallbackDefs = toTrackDefs(item, "free", localeFromPath)
    if (!fallbackDefs.length) return

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
        setActiveTracks(tracks)
        pendingTrackScopeRef.current = buildTrackScopeId(tracks)
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

  useEffect(() => {
    const prevPath = prevPathnameRef.current
    if (prevPath === pathname) return
    audioDebug("nav:route-change", {
      ownerId: ownerSessionIdRef.current,
      from: prevPath,
      to: pathname,
    })
    prevPathnameRef.current = pathname
  }, [pathname])

  const onBackendControllerReady = useCallback((controller: GlobalAudioController | null) => {
    backendControllerRef.current = controller
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
      getLoop: () => loopOn,
      setLoop: (loop: boolean) => {
        setLoopOn(loop)
        backendControllerRef.current?.setLoop?.(loop)
        touchMiniPlayerState()
      },
    }
  }, [activeIndex, localeFromPath, loopOn, setSongByIndex])

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

  useEffect(() => {
    const host = document.getElementById("rr-sound-player-host")
    if (!host) return
    const parking = document.getElementById("rr-sound-player-parking")
    let moveHostRaf: number | null = null

    const moveHost = () => {
      const slotFromRegistry = getLatestSoundPlayerSlot()
      const slotFromDom = document.getElementById("rr-sound-player-slot")
      const slot = slotFromRegistry?.isConnected ? slotFromRegistry : slotFromDom
      if (!slot) {
        if (parking && host.parentElement !== parking) {
          parking.appendChild(host)
        }
        host.style.display = "none"
        return
      }
      if (host.parentElement !== slot) {
        slot.appendChild(host)
      }
      host.style.display = ""
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
  }, [pathname])

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
      teleprompterSourceUrl={activeTeleprompterUrl}
      onControllerReady={onBackendControllerReady}
      onPlaybackStateChange={onPlaybackStateChange}
      onTrackSetReady={onTrackSetReady}
      registerGlobalAudio={false}
      showDetailedSections={showDetailedSections}
      topStatusBanner={topStatusBanner}
    />
  )

  const portalTarget = isMounted ? document.getElementById("rr-sound-player-host") : null
  if (!isMounted) return <div className="hidden" aria-hidden>{playerNode}</div>
  if (portalTarget) return createPortal(playerNode, portalTarget)
  return <div className="hidden" aria-hidden>{playerNode}</div>
}
