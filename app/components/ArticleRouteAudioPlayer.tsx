"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ARTICLE_AUDIO_COMMAND_EVENT,
  ARTICLE_AUDIO_SET_PLAYLIST_EVENT,
  type ArticleAudioCommandDetail,
  type ArticleAudioSetPlaylistDetail,
  type ArticleAudioTrack,
  publishArticleAudioState,
} from "../lib/articleAudioBus"
import { requestGlobalAudio, type GlobalAudioController } from "../lib/globalAudioManager"

const CONTROLLER_ID = "rr-article-route-player"
const STORAGE_KEY = "rr-article-route-audio-state-v1"

type PersistedArticleAudioState = {
  articleId: string
  articleTitle: string
  tracks: ArticleAudioTrack[]
  activeIndex: number
  current: number
  duration: number
  loop: boolean
}

function readPersistedState(): PersistedArticleAudioState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedArticleAudioState
    if (!parsed || typeof parsed !== "object") return null
    if (typeof parsed.articleId !== "string" || !Array.isArray(parsed.tracks)) return null
    return parsed
  } catch {
    return null
  }
}

function writePersistedState(state: PersistedArticleAudioState) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

export default function ArticleRouteAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const wrapperControllerRef = useRef<GlobalAudioController | null>(null)
  const articleIdRef = useRef("")
  const articleTitleRef = useRef("")
  const tracksRef = useRef<ArticleAudioTrack[]>([])
  const activeIndexRef = useRef(-1)
  const loopRef = useRef(false)
  const progressRef = useRef({ current: 0, duration: 0, playing: false })
  const [, forceRender] = useState(0)

  const emitState = useCallback(() => {
    const snapshot = {
      articleId: articleIdRef.current,
      articleTitle: articleTitleRef.current,
      tracks: tracksRef.current,
      activeIndex: activeIndexRef.current,
      playing: progressRef.current.playing,
      current: progressRef.current.current,
      duration: progressRef.current.duration,
      loop: loopRef.current,
    }
    publishArticleAudioState(snapshot)
    writePersistedState({
      articleId: snapshot.articleId,
      articleTitle: snapshot.articleTitle,
      tracks: snapshot.tracks,
      activeIndex: snapshot.activeIndex,
      current: snapshot.current,
      duration: snapshot.duration,
      loop: snapshot.loop,
    })
  }, [])

  const setProgress = useCallback((patch: Partial<{ current: number; duration: number; playing: boolean }>) => {
    progressRef.current = { ...progressRef.current, ...patch }
    emitState()
  }, [emitState])

  const loadTrackAtIndex = useCallback(
    async (index: number, autoplay: boolean) => {
      const tracks = tracksRef.current
      const audio = audioRef.current
      if (!audio || !tracks.length || index < 0 || index >= tracks.length) return

      const track = tracks[index]
      const previousIndex = activeIndexRef.current
      const mustLoad = previousIndex !== index || audio.getAttribute("data-track-id") !== track.id

      activeIndexRef.current = index
      if (mustLoad) {
        audio.setAttribute("data-track-id", track.id)
        audio.src = track.src
        audio.load()
        setProgress({ current: 0, duration: 0, playing: false })
      }

      emitState()
      if (!autoplay) return
      if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
      try {
        await audio.play()
      } catch {}
    },
    [emitState, setProgress]
  )

  const handleTrackEnd = useCallback(async () => {
    const audio = audioRef.current
    const tracks = tracksRef.current
    if (!audio || !tracks.length) return

    if (loopRef.current) {
      audio.currentTime = 0
      setProgress({ current: 0, playing: true })
      try {
        await audio.play()
      } catch {
        setProgress({ playing: false })
      }
      return
    }

    const nextIndex = activeIndexRef.current + 1
    if (nextIndex >= 0 && nextIndex < tracks.length) {
      await loadTrackAtIndex(nextIndex, true)
      return
    }

    setProgress({ playing: false, current: 0 })
  }, [loadTrackAtIndex, setProgress])

  const applyPlaylist = useCallback(
    async (detail: ArticleAudioSetPlaylistDetail) => {
      const nextTracks = detail.tracks ?? []
      const currentArticleId = articleIdRef.current
      const preserveCurrent = detail.preserveCurrentIfSame !== false && detail.articleId === currentArticleId
      const previousTrack =
        preserveCurrent && activeIndexRef.current >= 0 ? tracksRef.current[activeIndexRef.current] : null

      articleIdRef.current = detail.articleId
      articleTitleRef.current = detail.articleTitle
      tracksRef.current = nextTracks

      const audio = audioRef.current
      if (!audio || !nextTracks.length) {
        activeIndexRef.current = -1
        setProgress({ current: 0, duration: 0, playing: false })
        emitState()
        return
      }

      let nextIndex = Number.isFinite(detail.startIndex) ? Number(detail.startIndex) : 0
      if (previousTrack) {
        const preservedIndex = nextTracks.findIndex((item) => item.src === previousTrack.src)
        if (preservedIndex >= 0) nextIndex = preservedIndex
      }
      if (!previousTrack) {
        const persisted = readPersistedState()
        if (persisted && persisted.articleId === detail.articleId) {
          const persistedTrack = persisted.tracks[persisted.activeIndex]
          if (persistedTrack) {
            const persistedIndex = nextTracks.findIndex((item) => item.src === persistedTrack.src)
            if (persistedIndex >= 0) nextIndex = persistedIndex
          }
        }
      }
      if (nextIndex < 0) nextIndex = 0
      if (nextIndex >= nextTracks.length) nextIndex = nextTracks.length - 1

      await loadTrackAtIndex(nextIndex, !!detail.autoplay)
      emitState()
    },
    [emitState, loadTrackAtIndex, setProgress]
  )

  useEffect(() => {
    const persisted = readPersistedState()
    if (!persisted) return
    articleIdRef.current = persisted.articleId
    articleTitleRef.current = persisted.articleTitle
    tracksRef.current = persisted.tracks
    activeIndexRef.current = Number.isFinite(persisted.activeIndex) ? persisted.activeIndex : -1
    loopRef.current = !!persisted.loop
    progressRef.current = {
      current: Number.isFinite(persisted.current) ? persisted.current : 0,
      duration: Number.isFinite(persisted.duration) ? persisted.duration : 0,
      playing: false,
    }
    emitState()
  }, [emitState])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => setProgress({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 })
    const onTimeUpdate = () => setProgress({ current: Number.isFinite(audio.currentTime) ? audio.currentTime : 0 })
    const onPlay = () => setProgress({ playing: true })
    const onPause = () => setProgress({ playing: false })
    const onEnded = () => {
      void handleTrackEnd()
    }

    audio.addEventListener("loadedmetadata", onLoadedMetadata)
    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("ended", onEnded)

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata)
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("ended", onEnded)
    }
  }, [handleTrackEnd, setProgress])

  useEffect(() => {
    const onSetPlaylist = (event: Event) => {
      const detail = (event as CustomEvent<ArticleAudioSetPlaylistDetail>).detail
      if (!detail?.articleId || !Array.isArray(detail.tracks)) return
      void applyPlaylist(detail)
    }
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<ArticleAudioCommandDetail>).detail
      if (!detail || detail.articleId !== articleIdRef.current) return

      if (detail.action === "playIndex") {
        void loadTrackAtIndex(detail.index, detail.autoplay !== false)
        return
      }
      const audio = audioRef.current
      if (!audio) return

      if (detail.action === "toggle") {
        if (activeIndexRef.current < 0 && tracksRef.current.length > 0) {
          void loadTrackAtIndex(0, true)
          return
        }
        if (audio.paused) {
          if (wrapperControllerRef.current) requestGlobalAudio(wrapperControllerRef.current)
          void audio.play().catch(() => {})
        } else {
          audio.pause()
        }
        return
      }

      if (detail.action === "seek") {
        const wasPlaying = !audio.paused
        const shouldAutoPlay = wasPlaying || detail.index !== activeIndexRef.current
        void loadTrackAtIndex(detail.index, shouldAutoPlay).then(() => {
          const bounded = Math.max(0, Number(detail.timeSec) || 0)
          audio.currentTime = bounded
          setProgress({ current: bounded })
        })
      }
    }

    window.addEventListener(ARTICLE_AUDIO_SET_PLAYLIST_EVENT, onSetPlaylist as EventListener)
    window.addEventListener(ARTICLE_AUDIO_COMMAND_EVENT, onCommand as EventListener)
    emitState()
    return () => {
      window.removeEventListener(ARTICLE_AUDIO_SET_PLAYLIST_EVENT, onSetPlaylist as EventListener)
      window.removeEventListener(ARTICLE_AUDIO_COMMAND_EVENT, onCommand as EventListener)
    }
  }, [applyPlaylist, emitState, loadTrackAtIndex, setProgress])

  useEffect(() => {
    wrapperControllerRef.current = {
      id: CONTROLLER_ID,
      title: articleTitleRef.current || "Статья",
      subtitle: articleIdRef.current || "",
      getTitle: () => {
        const current = tracksRef.current[activeIndexRef.current]
        return current?.title || articleTitleRef.current || "Статья"
      },
      getSubtitle: () => articleTitleRef.current || articleIdRef.current || "",
      stop: () => {
        const audio = audioRef.current
        if (!audio) return
        audio.pause()
        audio.currentTime = 0
        setProgress({ current: 0, playing: false })
      },
      play: () => {
        const audio = audioRef.current
        if (!audio || !tracksRef.current.length) return
        if (activeIndexRef.current < 0) {
          void loadTrackAtIndex(0, true)
          return
        }
        requestGlobalAudio(wrapperControllerRef.current as GlobalAudioController)
        void audio.play().catch(() => {})
      },
      pause: () => {
        audioRef.current?.pause()
      },
      toggle: () => {
        const audio = audioRef.current
        if (!audio || !tracksRef.current.length) return
        requestGlobalAudio(wrapperControllerRef.current as GlobalAudioController)
        if (audio.paused) {
          if (activeIndexRef.current < 0) {
            void loadTrackAtIndex(0, true)
            return
          }
          void audio.play().catch(() => {})
          return
        }
        audio.pause()
      },
      prev: () => {
        const nextIndex = Math.max(0, activeIndexRef.current - 1)
        void loadTrackAtIndex(nextIndex, true)
      },
      next: () => {
        const max = tracksRef.current.length - 1
        if (max < 0) return
        const nextIndex = Math.min(max, activeIndexRef.current + 1)
        void loadTrackAtIndex(nextIndex, true)
      },
      seek: (timeSec: number) => {
        const audio = audioRef.current
        if (!audio || activeIndexRef.current < 0) return
        const bounded = Math.max(0, Number(timeSec) || 0)
        audio.currentTime = bounded
        setProgress({ current: bounded })
      },
      getProgress: () => progressRef.current,
      getLoop: () => loopRef.current,
      setLoop: (loop: boolean) => {
        loopRef.current = loop
        emitState()
        forceRender((v) => v + 1)
      },
      getPlaylist: () =>
        tracksRef.current.map((track) => ({
          id: "",
          title: track.title,
          subtitle: track.subtitle || articleTitleRef.current,
        })),
      getPlaylistIndex: () => activeIndexRef.current,
      jumpTo: (index: number) => {
        void loadTrackAtIndex(index, true)
      },
    }
  }, [emitState, loadTrackAtIndex, setProgress])

  const hiddenAudio = useMemo(
    () => (
      <div className="hidden" aria-hidden="true">
        <audio ref={audioRef} preload="none" />
      </div>
    ),
    []
  )

  return hiddenAudio
}
