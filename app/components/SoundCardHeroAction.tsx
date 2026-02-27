"use client"

import { useMemo, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"
import { useI18n } from "./i18n/I18nProvider"
import { getMiniPlayerStateSnapshot, subscribeMiniPlayerState } from "../lib/miniPlayerStateStore"
import { stripLocalePrefixFromPathname } from "../lib/i18n/routing"
import { getSoundDisplayTitle, SOUND_ITEMS } from "../lib/soundCatalog"
import { dispatchSoundRoutePlay } from "../lib/soundRoutePlayerBus"

function getCardSlug(pathname: string): string | null {
  const normalized = stripLocalePrefixFromPathname(pathname)
  if (!normalized.startsWith("/sound/")) return null
  const slug = normalized.slice("/sound/".length).trim()
  if (!slug || slug.includes("/")) return null
  return slug
}

export default function SoundCardHeroAction() {
  const { locale, t } = useI18n()
  const pathname = usePathname()
  const miniPlayerState = useSyncExternalStore(subscribeMiniPlayerState, getMiniPlayerStateSnapshot, getMiniPlayerStateSnapshot)
  const activeSlug = miniPlayerState.activeSlug

  const cardSlug = useMemo(() => getCardSlug(pathname || ""), [pathname])
  const cardItem = useMemo(() => SOUND_ITEMS.find((item) => item.slug === cardSlug), [cardSlug])

  if (!cardSlug || !cardItem) return null
  if (!activeSlug || activeSlug === cardSlug) return null

  return (
    <button
      type="button"
      data-testid="sound-hero-handoff"
      onClick={() => dispatchSoundRoutePlay({ slug: cardSlug, autoplay: true })}
      className="mt-2 inline-flex rounded-sm border border-[#7ea4cd]/45 bg-[#7ea4cd]/10 px-2 py-1 text-xs text-white/90 hover:bg-[#7ea4cd]/20"
    >
      {t("sound.heroAction")} «{getSoundDisplayTitle(cardItem, locale)}»
    </button>
  )
}
