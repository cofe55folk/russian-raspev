"use client"

const VIDEO_CHANGE_EVENT = "rr-global-video-change"

type UnknownWindow = Window & {
  __rrGlobalAudioState?: {
    active?: {
      id?: string
      stop?: () => void
    } | null
  }
  __rrGlobalVideoState?: {
    open?: boolean
  } & Record<string, unknown>
}

function getWindowState(): UnknownWindow | null {
  if (typeof window === "undefined") return null
  return window as UnknownWindow
}

export function stopGlobalAudioForVideoStart(exceptControllerId?: string) {
  const win = getWindowState()
  if (!win) return
  const active = win.__rrGlobalAudioState?.active
  if (!active) return
  if (exceptControllerId && active.id === exceptControllerId) return
  try {
    active.stop?.()
  } catch {}
}

export function stopGlobalVideoForAudioStart() {
  const win = getWindowState()
  if (!win) return
  const videoState = win.__rrGlobalVideoState
  if (!videoState?.open) return
  videoState.open = false
  win.dispatchEvent(new CustomEvent(VIDEO_CHANGE_EVENT))
}

