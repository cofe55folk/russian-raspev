import { stopGlobalAudioForVideoStart } from "./mediaMutualExclusion"

export type GlobalVideoItem = {
  id: string
  title: string
  subtitle?: string
  src: string
  provider?: "kinescope" | "file" | "other"
}

export type GlobalVideoRect = {
  x: number
  y: number
  width: number
  height: number
}

export type GlobalVideoPlaylistPayload = {
  contextId: string
  items: GlobalVideoItem[]
  startIndex?: number
  preserveCurrentIfSame?: boolean
  autoplay?: boolean
  loop?: boolean
}

export type GlobalVideoState = {
  active: GlobalVideoItem | null
  open: boolean
  pinned: boolean
  rect: GlobalVideoRect
  contextId: string
  playlist: GlobalVideoItem[]
  playlistIndex: number
  loop: boolean
}

const EVENT_NAME = "rr-global-video-change"
const STORAGE_KEY = "rr_global_video_rect_v1"

declare global {
  interface Window {
    __rrGlobalVideoState?: GlobalVideoState
  }
}

function defaultRect(): GlobalVideoRect {
  if (typeof window === "undefined") return { x: 24, y: 120, width: 360, height: 204 }
  const w = window.innerWidth
  const h = window.innerHeight
  const width = Math.max(280, Math.min(420, Math.round(w * 0.28)))
  const height = Math.round(width * 0.5625)
  return { x: Math.max(12, w - width - 24), y: Math.max(88, h - height - 24), width, height }
}

function clampRect(rect: GlobalVideoRect): GlobalVideoRect {
  if (typeof window === "undefined") return rect
  const pad = 8
  const maxX = Math.max(pad, window.innerWidth - rect.width - pad)
  const maxY = Math.max(76, window.innerHeight - rect.height - pad)
  return {
    ...rect,
    x: Math.max(pad, Math.min(maxX, rect.x)),
    y: Math.max(76, Math.min(maxY, rect.y)),
  }
}

function clampIndex(index: number, size: number): number {
  if (size <= 0) return -1
  if (!Number.isFinite(index)) return 0
  return Math.max(0, Math.min(size - 1, Math.floor(index)))
}

function findIndexByItem(items: GlobalVideoItem[], item: GlobalVideoItem | null): number {
  if (!item || !items.length) return -1
  const byId = items.findIndex((candidate) => candidate.id === item.id)
  if (byId >= 0) return byId
  return items.findIndex((candidate) => candidate.src === item.src)
}

function state(): GlobalVideoState {
  if (typeof window === "undefined") {
    return {
      active: null,
      open: false,
      pinned: false,
      rect: { x: 24, y: 120, width: 360, height: 204 },
      contextId: "",
      playlist: [],
      playlistIndex: -1,
      loop: false,
    }
  }
  if (!window.__rrGlobalVideoState) {
    const initial: GlobalVideoState = {
      active: null,
      open: false,
      pinned: false,
      rect: defaultRect(),
      contextId: "",
      playlist: [],
      playlistIndex: -1,
      loop: false,
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GlobalVideoRect>
        if (
          typeof parsed.x === "number" &&
          typeof parsed.y === "number" &&
          typeof parsed.width === "number" &&
          typeof parsed.height === "number"
        ) {
          initial.rect = clampRect({
            x: parsed.x,
            y: parsed.y,
            width: parsed.width,
            height: parsed.height,
          })
        }
      }
    } catch {}
    window.__rrGlobalVideoState = initial
  }
  return window.__rrGlobalVideoState
}

function emitChange() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

function saveRect(rect: GlobalVideoRect) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rect))
  } catch {}
}

function setActiveByIndex(s: GlobalVideoState, index: number) {
  if (!s.playlist.length) {
    s.playlistIndex = -1
    s.active = null
    return
  }
  const nextIndex = clampIndex(index, s.playlist.length)
  s.playlistIndex = nextIndex
  s.active = nextIndex >= 0 ? s.playlist[nextIndex] ?? null : null
}

export function getGlobalVideoState(): GlobalVideoState {
  return state()
}

export function subscribeGlobalVideo(onChange: () => void) {
  if (typeof window === "undefined") return () => {}
  const handler = () => onChange()
  window.addEventListener(EVENT_NAME, handler as EventListener)
  return () => window.removeEventListener(EVENT_NAME, handler as EventListener)
}

export function setGlobalVideoPlaylist(payload: GlobalVideoPlaylistPayload) {
  const s = state()
  const items = payload.items ?? []
  const preserveCurrent = payload.preserveCurrentIfSame !== false && payload.contextId === s.contextId

  s.contextId = payload.contextId
  s.playlist = items
  if (typeof payload.loop === "boolean") s.loop = payload.loop

  if (!items.length) {
    s.active = null
    s.playlistIndex = -1
    if (payload.autoplay) s.open = false
    emitChange()
    return
  }

  let nextIndex = Number.isFinite(payload.startIndex) ? Number(payload.startIndex) : 0
  if (preserveCurrent) {
    const currentIndex = findIndexByItem(items, s.active)
    if (currentIndex >= 0) nextIndex = currentIndex
  }

  setActiveByIndex(s, nextIndex)
  if (payload.autoplay) {
    stopGlobalAudioForVideoStart()
    s.open = true
  }
  emitChange()
}

export function openGlobalVideo(item: GlobalVideoItem, options?: { contextId?: string; playlist?: GlobalVideoItem[]; index?: number; loop?: boolean }) {
  const s = state()

  if (options?.contextId) s.contextId = options.contextId
  if (Array.isArray(options?.playlist)) {
    s.playlist = options.playlist
  }
  if (typeof options?.loop === "boolean") s.loop = options.loop

  const indexFromOptions = Number.isFinite(options?.index) ? Number(options?.index) : -1
  if (indexFromOptions >= 0 && s.playlist.length) {
    setActiveByIndex(s, indexFromOptions)
  } else if (s.playlist.length) {
    const playlistIndex = findIndexByItem(s.playlist, item)
    if (playlistIndex >= 0) {
      setActiveByIndex(s, playlistIndex)
    } else {
      s.playlist = [item, ...s.playlist]
      setActiveByIndex(s, 0)
    }
  } else {
    s.active = item
    s.playlist = [item]
    s.playlistIndex = 0
  }

  stopGlobalAudioForVideoStart()
  s.open = true
  emitChange()
}

export function openGlobalVideoPlaylistIndex(contextId: string, index: number) {
  const s = state()
  if (!s.playlist.length) return
  if (contextId && s.contextId && contextId !== s.contextId) return
  setActiveByIndex(s, index)
  stopGlobalAudioForVideoStart()
  s.open = true
  emitChange()
}

export function nextGlobalVideo() {
  const s = state()
  if (!s.playlist.length) return
  const next = s.playlistIndex + 1
  if (next >= s.playlist.length) return
  setActiveByIndex(s, next)
  stopGlobalAudioForVideoStart()
  s.open = true
  emitChange()
}

export function prevGlobalVideo() {
  const s = state()
  if (!s.playlist.length) return
  const prev = s.playlistIndex - 1
  if (prev < 0) return
  setActiveByIndex(s, prev)
  stopGlobalAudioForVideoStart()
  s.open = true
  emitChange()
}

export function setGlobalVideoLoop(loop: boolean) {
  const s = state()
  s.loop = loop
  emitChange()
}

export function closeGlobalVideo() {
  const s = state()
  s.open = false
  emitChange()
}

export function setGlobalVideoPinned(pinned: boolean) {
  const s = state()
  s.pinned = pinned
  emitChange()
}

export function setGlobalVideoRect(rect: GlobalVideoRect) {
  const s = state()
  s.rect = clampRect(rect)
  saveRect(s.rect)
  emitChange()
}

export function snapGlobalVideoRect() {
  const s = state()
  if (typeof window === "undefined") return
  const left = s.rect.x
  const right = window.innerWidth - (s.rect.x + s.rect.width)
  s.rect = clampRect({
    ...s.rect,
    x: left <= right ? 12 : Math.max(12, window.innerWidth - s.rect.width - 12),
    y: Math.max(88, window.innerHeight - s.rect.height - 12),
  })
  saveRect(s.rect)
  emitChange()
}
