export type ArticleAudioTrack = {
  id: string
  title: string
  subtitle?: string
  src: string
}

export type ArticleAudioSetPlaylistDetail = {
  articleId: string
  articleTitle: string
  tracks: ArticleAudioTrack[]
  startIndex?: number
  autoplay?: boolean
  preserveCurrentIfSame?: boolean
}

export type ArticleAudioCommandDetail =
  | { articleId: string; action: "playIndex"; index: number; autoplay?: boolean }
  | { articleId: string; action: "toggle" }
  | { articleId: string; action: "seek"; index: number; timeSec: number }

export type ArticleAudioState = {
  articleId: string
  articleTitle: string
  tracks: ArticleAudioTrack[]
  activeIndex: number
  playing: boolean
  current: number
  duration: number
  loop: boolean
}

export const ARTICLE_AUDIO_SET_PLAYLIST_EVENT = "rr-article-audio-set-playlist"
export const ARTICLE_AUDIO_COMMAND_EVENT = "rr-article-audio-command"
export const ARTICLE_AUDIO_STATE_EVENT = "rr-article-audio-state"

declare global {
  interface Window {
    __rrArticleAudioState?: ArticleAudioState
  }
}

export function dispatchArticleAudioSetPlaylist(detail: ArticleAudioSetPlaylistDetail) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<ArticleAudioSetPlaylistDetail>(ARTICLE_AUDIO_SET_PLAYLIST_EVENT, { detail }))
}

export function dispatchArticleAudioCommand(detail: ArticleAudioCommandDetail) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<ArticleAudioCommandDetail>(ARTICLE_AUDIO_COMMAND_EVENT, { detail }))
}

export function publishArticleAudioState(state: ArticleAudioState) {
  if (typeof window === "undefined") return
  window.__rrArticleAudioState = state
  window.dispatchEvent(new CustomEvent<ArticleAudioState>(ARTICLE_AUDIO_STATE_EVENT, { detail: state }))
}

export function getArticleAudioStateSnapshot(): ArticleAudioState | null {
  if (typeof window === "undefined") return null
  return window.__rrArticleAudioState ?? null
}

