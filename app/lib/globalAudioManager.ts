import { stopGlobalVideoForAudioStart } from "./mediaMutualExclusion"

export type GlobalAudioProgress = {
  current: number
  duration: number
  playing: boolean
}

export type GlobalAudioController = {
  id: string
  title: string
  subtitle?: string
  getTitle?: () => string
  getSubtitle?: () => string
  prime?: () => void
  stop: () => void
  play: () => void
  pause: () => void
  toggle: () => void
  prev: () => void
  next: () => void
  seek: (timeSec: number) => void
  getProgress: () => GlobalAudioProgress
  getLoop?: () => boolean
  setLoop?: (loop: boolean) => void
  getPlaylist?: () => { id: string; title: string; subtitle?: string }[]
  getPlaylistIndex?: () => number
  jumpTo?: (index: number) => void
}

type GlobalAudioState = {
  active: GlobalAudioController | null
}

const EVENT_NAME = "rr-global-audio-change"

declare global {
  interface Window {
    __rrGlobalAudioState?: GlobalAudioState
  }
}

function state(): GlobalAudioState {
  if (typeof window === "undefined") return { active: null }
  if (!window.__rrGlobalAudioState) {
    window.__rrGlobalAudioState = { active: null }
  }
  return window.__rrGlobalAudioState
}

function emitChange() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function getGlobalAudioController(): GlobalAudioController | null {
  return state().active
}

export function requestGlobalAudio(controller: GlobalAudioController) {
  const s = state()
  stopGlobalVideoForAudioStart()
  if (s.active && s.active.id !== controller.id) {
    try {
      s.active.stop()
    } catch {}
  }
  s.active = controller
  emitChange()
}

export function clearGlobalAudio(controllerId?: string) {
  const s = state()
  if (!s.active) return
  if (controllerId && s.active.id !== controllerId) return
  s.active = null
  emitChange()
}

export function subscribeGlobalAudio(onChange: () => void) {
  if (typeof window === "undefined") return () => {}
  const handler = () => onChange()
  window.addEventListener(EVENT_NAME, handler as EventListener)
  return () => {
    window.removeEventListener(EVENT_NAME, handler as EventListener)
  }
}
