export const SOUND_ROUTE_PLAY_EVENT = "rr-sound-route-play"

export type SoundRoutePlayEventDetail = {
  slug: string
  autoplay?: boolean
}

export function dispatchSoundRoutePlay(detail: SoundRoutePlayEventDetail) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<SoundRoutePlayEventDetail>(SOUND_ROUTE_PLAY_EVENT, { detail }))
}
