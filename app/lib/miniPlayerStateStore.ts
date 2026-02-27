import { getGlobalAudioController, subscribeGlobalAudio, type GlobalAudioController, type GlobalAudioProgress } from "./globalAudioManager"

export type MiniPlayerItem = {
  id: string
  title: string
  subtitle?: string
}

export type MiniPlayerSnapshot = {
  controllerId: string | null
  title: string
  subtitle: string
  progress: GlobalAudioProgress
  loopOn: boolean
  playlist: MiniPlayerItem[]
  playlistIndex: number
  activeSlug: string | null
  updatedAtMs: number
}

const PROGRESS_EPSILON_SEC = 0.04
const RAF_TICK_MIN_MS = 120

const EMPTY_PROGRESS: GlobalAudioProgress = {
  current: 0,
  duration: 0,
  playing: false,
}

const EMPTY_SNAPSHOT: MiniPlayerSnapshot = {
  controllerId: null,
  title: "",
  subtitle: "",
  progress: EMPTY_PROGRESS,
  loopOn: false,
  playlist: [],
  playlistIndex: -1,
  activeSlug: null,
  updatedAtMs: 0,
}

let snapshot: MiniPlayerSnapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()
let unsubscribeGlobalAudio: (() => void) | null = null
let rafId = 0
let lastRafTickMs = 0

function safeProgress(controller: GlobalAudioController | null): GlobalAudioProgress {
  if (!controller) return EMPTY_PROGRESS
  try {
    const value = controller.getProgress()
    return {
      current: Number.isFinite(value.current) ? Math.max(0, value.current) : 0,
      duration: Number.isFinite(value.duration) ? Math.max(0, value.duration) : 0,
      playing: !!value.playing,
    }
  } catch {
    return EMPTY_PROGRESS
  }
}

function safeTitle(controller: GlobalAudioController | null, fallback: string): string {
  if (!controller) return ""
  try {
    const byGetter = controller.getTitle?.()
    if (typeof byGetter === "string" && byGetter) return byGetter
  } catch {}
  return controller.title || fallback || ""
}

function safeSubtitle(controller: GlobalAudioController | null, fallback: string): string {
  if (!controller) return ""
  try {
    const byGetter = controller.getSubtitle?.()
    if (typeof byGetter === "string") return byGetter
  } catch {}
  return controller.subtitle || fallback || ""
}

function safeLoop(controller: GlobalAudioController | null, fallback: boolean): boolean {
  if (!controller?.getLoop) return fallback
  try {
    return !!controller.getLoop()
  } catch {
    return fallback
  }
}

function safePlaylist(controller: GlobalAudioController | null): MiniPlayerItem[] {
  if (!controller?.getPlaylist) return []
  try {
    const raw = controller.getPlaylist()
    if (!Array.isArray(raw)) return []
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") return null
        if (typeof item.id !== "string" || typeof item.title !== "string") return null
        return {
          id: item.id,
          title: item.title,
          subtitle: typeof item.subtitle === "string" ? item.subtitle : undefined,
        } as MiniPlayerItem
      })
      .filter((item): item is MiniPlayerItem => !!item)
  } catch {
    return []
  }
}

function safePlaylistIndex(controller: GlobalAudioController | null, fallback: number): number {
  if (!controller?.getPlaylistIndex) return fallback
  try {
    const next = controller.getPlaylistIndex()
    if (!Number.isFinite(next)) return fallback
    return Math.floor(next)
  } catch {
    return fallback
  }
}

function computeSnapshot(forceMetaRefresh = false): MiniPlayerSnapshot {
  const active = getGlobalAudioController()
  if (!active) {
    return {
      ...EMPTY_SNAPSHOT,
      updatedAtMs: Date.now(),
    }
  }

  const sameController = snapshot.controllerId === active.id
  const shouldRefreshMeta = forceMetaRefresh || !sameController
  const playlist = shouldRefreshMeta ? safePlaylist(active) : snapshot.playlist
  const playlistIndex = safePlaylistIndex(active, snapshot.playlistIndex)
  const activeSlug = playlistIndex >= 0 && playlistIndex < playlist.length ? playlist[playlistIndex]?.id ?? null : null

  return {
    controllerId: active.id,
    title: safeTitle(active, snapshot.title),
    subtitle: safeSubtitle(active, snapshot.subtitle),
    progress: safeProgress(active),
    loopOn: safeLoop(active, snapshot.loopOn),
    playlist,
    playlistIndex,
    activeSlug,
    updatedAtMs: Date.now(),
  }
}

function samePlaylist(a: MiniPlayerItem[], b: MiniPlayerItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id) return false
    if (a[i]?.title !== b[i]?.title) return false
    if ((a[i]?.subtitle ?? "") !== (b[i]?.subtitle ?? "")) return false
  }
  return true
}

function hasMeaningfulDiff(prev: MiniPlayerSnapshot, next: MiniPlayerSnapshot): boolean {
  if (prev.controllerId !== next.controllerId) return true
  if (prev.title !== next.title) return true
  if (prev.subtitle !== next.subtitle) return true
  if (prev.loopOn !== next.loopOn) return true
  if (prev.playlistIndex !== next.playlistIndex) return true
  if (prev.activeSlug !== next.activeSlug) return true
  if (!samePlaylist(prev.playlist, next.playlist)) return true
  if (prev.progress.playing !== next.progress.playing) return true
  if (Math.abs(prev.progress.duration - next.progress.duration) > PROGRESS_EPSILON_SEC) return true
  if (Math.abs(prev.progress.current - next.progress.current) > PROGRESS_EPSILON_SEC) return true
  return false
}

function emitSnapshot(forceMetaRefresh = false) {
  const next = computeSnapshot(forceMetaRefresh)
  if (!hasMeaningfulDiff(snapshot, next)) {
    if (next.progress.playing) startRafTicker()
    else stopRafTicker()
    return
  }
  snapshot = next
  listeners.forEach((listener) => listener())
  if (snapshot.progress.playing) startRafTicker()
  else stopRafTicker()
}

function rafTick(timestampMs: number) {
  if (!listeners.size) {
    rafId = 0
    return
  }
  if (timestampMs - lastRafTickMs >= RAF_TICK_MIN_MS) {
    lastRafTickMs = timestampMs
    emitSnapshot(false)
  }
  if (snapshot.progress.playing) {
    rafId = window.requestAnimationFrame(rafTick)
  } else {
    rafId = 0
  }
}

function startRafTicker() {
  if (typeof window === "undefined") return
  if (!listeners.size) return
  if (rafId || !snapshot.progress.playing) return
  rafId = window.requestAnimationFrame(rafTick)
}

function stopRafTicker() {
  if (typeof window === "undefined") return
  if (!rafId) return
  window.cancelAnimationFrame(rafId)
  rafId = 0
}

function ensureGlobalSubscription() {
  if (typeof window === "undefined") return
  if (unsubscribeGlobalAudio) return
  unsubscribeGlobalAudio = subscribeGlobalAudio(() => {
    emitSnapshot(true)
  })
}

function cleanupIfIdle() {
  if (listeners.size) return
  stopRafTicker()
  if (unsubscribeGlobalAudio) {
    unsubscribeGlobalAudio()
    unsubscribeGlobalAudio = null
  }
}

export function getMiniPlayerStateSnapshot(): MiniPlayerSnapshot {
  return snapshot
}

export function subscribeMiniPlayerState(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {}
  listeners.add(onStoreChange)
  ensureGlobalSubscription()
  emitSnapshot(true)
  return () => {
    listeners.delete(onStoreChange)
    cleanupIfIdle()
  }
}

export function touchMiniPlayerState() {
  if (typeof window === "undefined") return
  emitSnapshot(true)
}

