"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import CardViewTracker from "../components/analytics/CardViewTracker"
import PageHero from "../components/PageHero"
import ContentReactionsBar from "../components/community/ContentReactionsBar"
import { useI18n } from "../components/i18n/I18nProvider"
import { getGlobalAudioController } from "../lib/globalAudioManager"
import { toIntlLocale } from "../lib/i18n/format"
import { getAuthHref, getSoundTrackHref } from "../lib/i18n/routing"
import { getMiniPlayerStateSnapshot, subscribeMiniPlayerState } from "../lib/miniPlayerStateStore"
import { localizeSoundItem, SOUND_ITEMS, type LocalizedSoundItem } from "../lib/soundCatalog"
import { dispatchSoundRoutePlay } from "../lib/soundRoutePlayerBus"

function hasValue(value?: string) {
  return !!value && value.trim().length > 0 && value.trim().toLowerCase() !== "уточняется"
}

function normalizeGenreToken(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.;:!?]+$/g, "")
}

function composeSecondLine(item: LocalizedSoundItem) {
  return [item.archiveInfo, item.authenticPerformer, item.leadSinger, item.recordingAuthor]
    .filter((value): value is string => hasValue(value))
    .join(" · ")
}

export default function SoundPage() {
  const { locale, t } = useI18n()
  const intlLocale = toIntlLocale(locale)
  const miniPlayerState = useSyncExternalStore(subscribeMiniPlayerState, getMiniPlayerStateSnapshot, getMiniPlayerStateSnapshot)
  const isPreviewPlaying = !!miniPlayerState.progress.playing
  const activeTitle = miniPlayerState.title
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)

  const tracks = useMemo(() => SOUND_ITEMS.map((item) => localizeSoundItem(item, locale)), [locale])
  const genreItems = useMemo(
    () =>
      Array.from(
        new Set(
          tracks.flatMap((item) =>
            (item.genre ?? "")
              .split(",")
              .map((part) => normalizeGenreToken(part))
              .filter(Boolean)
          )
        )
      ).map((genre) => genre[0].toLocaleUpperCase(intlLocale) + genre.slice(1)),
    [intlLocale, tracks]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" })
        const payload = (await response.json()) as { session?: { userId?: string } | null }
        if (cancelled) return
        setSessionLoaded(true)
        setSessionUserId(payload.session?.userId || null)
      } catch {
        if (cancelled) return
        setSessionLoaded(true)
        setSessionUserId(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const togglePreview = (item: (typeof SOUND_ITEMS)[number]) => {
    if (!item.previewSrc) return
    const active = getGlobalAudioController()
    const activeIsRoutePlayer = active?.id === "rr-sound-route-player"
    const activeTitleNow = active ? (active.getTitle ? active.getTitle() : active.title) : ""

    if (activeIsRoutePlayer && activeTitleNow === item.title) {
      active?.toggle()
      return
    }

    dispatchSoundRoutePlay({ slug: item.slug, autoplay: true })
  }

  return (
    <main className="rr-main">
      <PageHero title={t("nav.sound")} />

      <section className="rr-container mt-10 grid gap-8 lg:grid-cols-[270px_1fr]">
        <aside className="rr-panel h-fit p-4">
          <div className="mb-6">
            <div className="rr-sidebar-title">{t("common.search")}</div>
            <input className="rr-input" placeholder={t("common.search")} />
          </div>

          <div className="rr-sidebar-title">{t("common.categories")}</div>
          <button className="mb-2 w-full rounded-sm bg-zinc-200 px-3 py-2 text-left text-sm">{t("common.show")}</button>

          <div className="rr-sidebar-title">{t("common.ethnographicRegion")}</div>
          <button className="mb-2 w-full rounded-sm bg-zinc-200 px-3 py-2 text-left text-sm">{t("common.show")}</button>

          <div className="rr-sidebar-title">{t("common.genre")}</div>
          <ul className="space-y-1 text-sm text-zinc-700">
            {genreItems.map((item) => (
              <li key={item} className="rounded-sm px-2 py-1 hover:bg-zinc-200">
                · {item}
              </li>
            ))}
          </ul>
        </aside>

        <div>
          <div className="mb-6 flex items-center justify-between text-sm">
            <div className="flex gap-5">
              <button className="rr-tab-active">{t("common.best")}</button>
              <button className="rr-tab">{t("common.latest")}</button>
            </div>
            <div className="text-zinc-600">{t("sound.itemsPerPage")} <span className="font-semibold">6</span> 12 24 36 {t("articles.scope.all")}</div>
          </div>

          <div className="space-y-2">
            {sessionLoaded && !sessionUserId ? (
              <div className="rounded-sm border border-[#d8c8a6] bg-[#fff7e8] px-3 py-2 text-sm text-[#6b4d1f]" data-testid="sound-list-guest-cta">
                <span>{t("sound.reactionsLoginHint")} </span>
                <Link href={getAuthHref(locale)} className="font-semibold text-[#2f6fb8] hover:underline">
                  {t("sound.reactionsLoginCta")}
                </Link>
              </div>
            ) : null}
            {tracks.map((item) => {
              const secondLine = composeSecondLine(item)
              const isCurrent = activeTitle === item.title
              const isPlaying = isCurrent && isPreviewPlaying
              return (
                <article key={item.id} className="rounded-md border border-[#d4c39f] bg-[#f5efe2] px-2 py-1.5 text-[#1f2937]">
                  <CardViewTracker contentType="sound" contentId={item.slug} />
                  <div className="flex items-start gap-2">
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-sm border border-[#b9a783] bg-zinc-900/85">
                      <button
                        type="button"
                        aria-label={isPlaying ? t("sound.preview.pauseMasterAria") : t("sound.preview.playMasterAria")}
                        title={item.previewSrc ? t("sound.preview.listenMasterTitle") : t("sound.preview.missingMasterTitle")}
                        disabled={!item.previewSrc}
                        onClick={() => togglePreview(item)}
                        className={`absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 ${
                          item.previewSrc ? "bg-[#1f2937]/85 text-white hover:bg-[#0f172a]" : "cursor-not-allowed bg-[#475569]/60 text-white/40"
                        }`}
                      >
                        {isPlaying ? (
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                            <rect x="6" y="5" width="4" height="14" rx="1" />
                            <rect x="14" y="5" width="4" height="14" rx="1" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-4 w-4 translate-x-[1px]" fill="currentColor">
                            <path d="M8 5v14l11-7-11-7z" />
                          </svg>
                        )}
                      </button>
                    </div>

                    <Link href={getSoundTrackHref(locale, item.slug)} className="min-w-0 flex-1 rounded-sm px-1 py-0.5 hover:bg-[#eadfca]">
                      <div className="truncate text-[16px] leading-5 text-[#1f2937]">
                        <span className="font-semibold text-[#0f172a]">{item.title}</span>
                        {hasValue(item.genre) ? <span className="text-[#334155]">, {item.genre}</span> : null}
                      </div>
                      {hasValue(secondLine) ? <div className="truncate text-[14px] leading-5 text-[#475569]">{secondLine}</div> : null}
                      <span className="hidden" data-modern-performer={item.modernPerformer ?? ""} />
                    </Link>
                  </div>
                  <ContentReactionsBar
                    contentType="sound"
                    contentId={item.slug}
                    contentTitle={item.title}
                    contentHref={getSoundTrackHref(locale, item.slug)}
                    tone="light"
                    showAuthLink={false}
                    className="mt-1.5 pl-[64px]"
                    testId={`sound-list-reactions-${item.slug}`}
                  />
                </article>
              )
            })}
          </div>

          <div className="mt-10 flex items-center gap-2">
            {["1", "2", "3", "4", "5", "6", "7"].map((page) => (
              <button
                key={page}
                className={`rr-pagination-btn ${
                  page === "1" ? "rr-pagination-btn-active" : ""
                }`}
              >
                {page}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
