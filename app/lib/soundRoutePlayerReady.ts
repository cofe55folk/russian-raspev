const EVENT_NAME = "rr-sound-route-player-ready-change"

declare global {
  interface Window {
    __rrSoundRoutePlayerReady?: boolean
  }
}

function emitChange() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function markSoundRoutePlayerReady(ready: boolean) {
  if (typeof window === "undefined") return
  if (window.__rrSoundRoutePlayerReady === ready) return
  window.__rrSoundRoutePlayerReady = ready
  emitChange()
}

export function getSoundRoutePlayerReadySnapshot() {
  if (typeof window === "undefined") return false
  return window.__rrSoundRoutePlayerReady === true
}

export function subscribeSoundRoutePlayerReady(onChange: () => void) {
  if (typeof window === "undefined") return () => {}
  const handler = () => onChange()
  window.addEventListener(EVENT_NAME, handler as EventListener)
  return () => {
    window.removeEventListener(EVENT_NAME, handler as EventListener)
  }
}
