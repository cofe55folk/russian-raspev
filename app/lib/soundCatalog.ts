import type { TrackDef } from "../components/MultiTrackPlayer"
import type { Locale } from "./i18n/types"

export type SoundItem = {
  id: number
  slug: string
  title: string
  titleTranslations?: Partial<Record<Locale, string>>
  genre?: string
  genreTranslations?: Partial<Record<Locale, string>>
  modernPerformer?: string
  modernPerformerTranslations?: Partial<Record<Locale, string>>
  authenticPerformer?: string
  authenticPerformerTranslations?: Partial<Record<Locale, string>>
  leadSinger?: string
  leadSingerTranslations?: Partial<Record<Locale, string>>
  recordingAuthor?: string
  recordingAuthorTranslations?: Partial<Record<Locale, string>>
  archiveInfo?: string
  archiveInfoTranslations?: Partial<Record<Locale, string>>
  previewSrc?: string
  masterSources?: string[]
  premiumEntitlementCode?: string
  teleprompterSourceUrl: string | null
}

export type LocalizedSoundItem = Omit<
  SoundItem,
  | "title"
  | "genre"
  | "modernPerformer"
  | "authenticPerformer"
  | "leadSinger"
  | "recordingAuthor"
  | "archiveInfo"
> & {
  title: string
  genre?: string
  modernPerformer?: string
  authenticPerformer?: string
  leadSinger?: string
  recordingAuthor?: string
  archiveInfo?: string
}

export const SOUND_ITEMS: SoundItem[] = [
  {
    id: 1,
    slug: "selezen",
    title: "Селезень сиз-косастый",
    genre: "хороводная",
    modernPerformer: "Багринцев Евгений",
    archiveInfo: "с. Крутиха, Кыштовского р-на Новосибирской обл.",
    previewSrc: "/audio/selezen/selezen-01.m4a",
    masterSources: ["/audio/selezen/selezen-01.m4a", "/audio/selezen/selezen-02.m4a", "/audio/selezen/selezen-03.m4a"],
    teleprompterSourceUrl: "/audio/selezen/selezen-01-lyrics.anchor-preview.json",
  },
  {
    id: 2,
    slug: "balman-ty-zorya-moya",
    title: "Ты заря моя ты зоренька",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-01.mp3",
    masterSources: [
      "/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-01.mp3",
      "/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-02.mp3",
      "/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-03.mp3",
    ],
    teleprompterSourceUrl: "/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-lyrics.anchor-preview.json",
  },
  {
    id: 3,
    slug: "balman-seyu-veyu",
    title: "Сею-вею",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-seyu_veyu/balman-seyu-veyu-01.m4a",
    masterSources: [
      "/audio/balman-seyu_veyu/balman-seyu-veyu-01.m4a",
      "/audio/balman-seyu_veyu/balman-seyu-veyu-02.m4a",
      "/audio/balman-seyu_veyu/balman-seyu-veyu-03.m4a",
    ],
    teleprompterSourceUrl: "/audio/balman-seyu_veyu/balman-seyu-veyu-01-lyrics.yandex-preview.json",
  },
  {
    id: 4,
    slug: "balman-lipynka",
    title: "Липынька",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-Lipynka/balman-Lipynka-01.m4a",
    masterSources: ["/audio/balman-Lipynka/balman-Lipynka-01.m4a", "/audio/balman-Lipynka/balman-Lipynka-02.m4a", "/audio/balman-Lipynka/balman-Lipynka-03.m4a"],
    teleprompterSourceUrl: "/audio/balman-Lipynka/balman-Lipynka-01-lyrics.anchor-preview.json",
  },
  {
    id: 5,
    slug: "balman-kumushki-skachite",
    title: "Кумушки скачите",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-kumushki_skachite/balman-kumushki_skachite-01.mp3",
    masterSources: [
      "/audio/balman-kumushki_skachite/balman-kumushki_skachite-01.mp3",
      "/audio/balman-kumushki_skachite/balman-kumushki_skachite-02.mp3",
      "/audio/balman-kumushki_skachite/balman-kumushki_skachite-03.mp3",
    ],
    teleprompterSourceUrl: "/audio/balman-kumushki_skachite/balman-kumushki_skachite-01-lyrics.anchor-preview.json",
  },
  {
    id: 6,
    slug: "balman-vechor-devku",
    title: "Вечор девку",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-vechor_devku/balman-vechor_devku-01.mp3",
    masterSources: [
      "/audio/balman-vechor_devku/balman-vechor_devku-01.mp3",
      "/audio/balman-vechor_devku/balman-vechor_devku-02.mp3",
      "/audio/balman-vechor_devku/balman-vechor_devku-03.mp3",
    ],
    teleprompterSourceUrl: "/audio/balman-vechor_devku/balman-vechor_devku-01-lyrics.anchor-preview.json",
  },
  {
    id: 7,
    slug: "balman-ya-kachu-kolco",
    title: "Я качу кольцо",
    genre: "хороводная игровая, вечерочная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-01.mp3",
    masterSources: [
      "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-01.mp3",
      "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-02.mp3",
      "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-03.mp3",
    ],
    teleprompterSourceUrl: "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-01-lyrics.anchor-preview.json",
  },
  {
    id: 8,
    slug: "talbakul-poteryala-ya-kolechko",
    title: "Потеряла я колечко",
    genre: "лирическая протяжная, романс",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Талбакуль, Колосовский район",
    archiveInfo: "Новосибирская область, с. Талбакуль",
    previewSrc: "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-01.m4a",
    masterSources: [
      "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-01.m4a",
      "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-02.m4a",
      "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-03.m4a",
    ],
    teleprompterSourceUrl: "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-01-lyrics.anchor-preview.json",
  },
  {
    id: 9,
    slug: "tomsk-bogoslovka-po-moryam",
    title: "По морям",
    genre: "лирическая протяжная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Богословка, Зырянский район",
    archiveInfo: "Томская область, с. Богословка",
    previewSrc: "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-01.m4a",
    masterSources: [
      "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-01.m4a",
      "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-02.m4a",
      "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-03.m4a",
    ],
    teleprompterSourceUrl: "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-01-lyrics.anchor-preview.json",
  },
  {
    id: 20,
    slug: "omsk-talbakul-alenkiy-cvetochek",
    title: "Аленький цветочек",
    genre: "лирическая протяжная",
    archiveInfo: "село Табакуль Колосовского района Омской области",
    previewSrc: "/audio/omsk_talbakul-alenkiy_cvetochek/omsk_talbakul-alenkiy_cvetochek-01.mp3",
    masterSources: [
      "/audio/omsk_talbakul-alenkiy_cvetochek/omsk_talbakul-alenkiy_cvetochek-01.mp3",
      "/audio/omsk_talbakul-alenkiy_cvetochek/omsk_talbakul-alenkiy_cvetochek-02.mp3",
      "/audio/omsk_talbakul-alenkiy_cvetochek/omsk_talbakul-alenkiy_cvetochek-03.mp3",
    ],
    teleprompterSourceUrl: "/audio/omsk_talbakul-alenkiy_cvetochek/omsk_talbakul-alenkiy_cvetochek-01-lyrics.anchor-preview.json",
  },
  {
    id: 21,
    slug: "altay-pervokamenka-ah-ty-polyushka",
    title: "Ах ты полюшка наша поляна",
    genre: "лирическая протяжная",
    archiveInfo: "село Первокаменка Третьяковского района Алтайского края",
    previewSrc: "/audio/altay_pervokamenka-ah_ty_polyushka/altay_pervokamenka-ah_ty_polyushka-01.mp3",
    masterSources: [
      "/audio/altay_pervokamenka-ah_ty_polyushka/altay_pervokamenka-ah_ty_polyushka-01.mp3",
      "/audio/altay_pervokamenka-ah_ty_polyushka/altay_pervokamenka-ah_ty_polyushka-02.mp3",
      "/audio/altay_pervokamenka-ah_ty_polyushka/altay_pervokamenka-ah_ty_polyushka-03.mp3",
    ],
    teleprompterSourceUrl: null,
  },
  {
    id: 22,
    slug: "bolshoy-kunaley-chto-ty-vanya",
    title: "Что ты, Ваня, разудала голова",
    genre: "лирическая протяжная",
    archiveInfo: "село Большой Куналей Тарбагатайского района Республики Бурятия",
    previewSrc: "/audio/bolshoy_kunaliy-chto_ty_vanya/bolshoy_kunaliy-chto_ty_vanya-01.mp3",
    masterSources: [
      "/audio/bolshoy_kunaliy-chto_ty_vanya/bolshoy_kunaliy-chto_ty_vanya-01.mp3",
      "/audio/bolshoy_kunaliy-chto_ty_vanya/bolshoy_kunaliy-chto_ty_vanya-02.mp3",
      "/audio/bolshoy_kunaliy-chto_ty_vanya/bolshoy_kunaliy-chto_ty_vanya-03.mp3",
      "/audio/bolshoy_kunaliy-chto_ty_vanya/bolshoy_kunaliy-chto_ty_vanya-04.mp3",
    ],
    teleprompterSourceUrl: null,
  },
  {
    id: 23,
    slug: "kemerov-varyuhino-gulenka",
    title: "Гуленька ты мой голубочек",
    genre: "лирическая протяжная",
    archiveInfo: "село Варюхино Юргинского района Кемеровской области",
    recordingAuthor: "А.М. Мехнецов, 1968",
    previewSrc: "/audio/kemerov_varyuhino-gulenka/kemerov_varyuhino-gulenka-01.mp3",
    masterSources: [
      "/audio/kemerov_varyuhino-gulenka/kemerov_varyuhino-gulenka-01.mp3",
      "/audio/kemerov_varyuhino-gulenka/kemerov_varyuhino-gulenka-02.mp3",
    ],
    teleprompterSourceUrl: "/audio/kemerov_varyuhino-gulenka/kemerov_varyuhino-gulenka-01-lyrics.anchor-preview.json",
  },
  {
    id: 24,
    slug: "novosibirsk-severnoe-na-ulitse-veetsya",
    title: "На улице веется",
    genre: "крутуха, плясовая",
    archiveInfo: "с. Северное Северного района Новосибирской области",
    previewSrc: "/audio/novosibirsk_severnoe-na ulitse_veetsya/novosibirsk_severnoe-na ulitse_veetsya-01.mp3",
    masterSources: [
      "/audio/novosibirsk_severnoe-na ulitse_veetsya/novosibirsk_severnoe-na ulitse_veetsya-01.mp3",
      "/audio/novosibirsk_severnoe-na ulitse_veetsya/novosibirsk_severnoe-na ulitse_veetsya-02.mp3",
      "/audio/novosibirsk_severnoe-na ulitse_veetsya/novosibirsk_severnoe-na ulitse_veetsya-03.mp3",
      "/audio/novosibirsk_severnoe-na ulitse_veetsya/novosibirsk_severnoe-na ulitse_veetsya-04.mp3",
      "/audio/novosibirsk_severnoe-na ulitse_veetsya/novosibirsk_severnoe-na ulitse_veetsya-05.mp3",
    ],
    teleprompterSourceUrl: null,
  },
  {
    id: 25,
    slug: "terek-mne-mladcu-malym-spalos",
    title: "Мне младцу малым спалось",
    genre: "лирическая протяжная",
    archiveInfo: "станица Червлёная Шелковского района Республики Чечня",
    recordingAuthor: "А.С. Кабанов",
    previewSrc: "/audio/terek-mne_mladcu_35k/terek-mne_mladcu_35k-01.mp3",
    masterSources: [
      "/audio/terek-mne_mladcu_35k/terek-mne_mladcu_35k-01.mp3",
      "/audio/terek-mne_mladcu_35k/terek-mne_mladcu_35k-02.mp3",
    ],
    teleprompterSourceUrl: null,
  },
  {
    id: 26,
    slug: "terek-ne-vo-daleche",
    title: "Не во далече было, во чистом-то поле",
    genre: "былинная песня, лирическая протяжная",
    archiveInfo: "станица Червлёная Шелковского района Республики Чечня",
    recordingAuthor: "А.С. Кабанов",
    previewSrc: "/audio/terek-ne_vo_daleche/terek-ne_vo_daleche-01.mp3",
    masterSources: [
      "/audio/terek-ne_vo_daleche/terek-ne_vo_daleche-01.mp3",
      "/audio/terek-ne_vo_daleche/terek-ne_vo_daleche-02.mp3",
    ],
    teleprompterSourceUrl: "/audio/terek-ne_vo_daleche/terek-ne_vo_daleche-01-lyrics.anchor-preview.json",
  },
]

export const SOUND_PLAYABLE_ITEMS = SOUND_ITEMS.filter((item) => !!item.previewSrc)

const FREE_TRACK_LIMIT = 3

function getAllSources(item: SoundItem): string[] {
  return item.masterSources?.length ? item.masterSources : item.previewSrc ? [item.previewSrc] : []
}

function resolveLocalizedValue(
  baseValue: string | undefined,
  translations: Partial<Record<Locale, string>> | undefined,
  locale: Locale
): string | undefined {
  if (translations) {
    const translated = translations[locale] ?? translations.ru ?? translations.en
    if (translated && translated.trim()) return translated
  }
  if (baseValue && baseValue.trim()) return baseValue
  return undefined
}

export function localizeSoundItem(item: SoundItem, locale: Locale): LocalizedSoundItem {
  return {
    ...item,
    title: resolveLocalizedValue(item.title, item.titleTranslations, locale) ?? item.title,
    genre: resolveLocalizedValue(item.genre, item.genreTranslations, locale),
    modernPerformer: resolveLocalizedValue(item.modernPerformer, item.modernPerformerTranslations, locale),
    authenticPerformer: resolveLocalizedValue(item.authenticPerformer, item.authenticPerformerTranslations, locale),
    leadSinger: resolveLocalizedValue(item.leadSinger, item.leadSingerTranslations, locale),
    recordingAuthor: resolveLocalizedValue(item.recordingAuthor, item.recordingAuthorTranslations, locale),
    archiveInfo: resolveLocalizedValue(item.archiveInfo, item.archiveInfoTranslations, locale),
  }
}

export function getSoundDisplayTitle(item: SoundItem, locale: Locale): string {
  return resolveLocalizedValue(item.title, item.titleTranslations, locale) ?? item.title
}

export function getSoundDisplayArchiveInfo(item: SoundItem, locale: Locale): string | undefined {
  return resolveLocalizedValue(item.archiveInfo, item.archiveInfoTranslations, locale)
}

export function getSoundBySlug(slug: string): SoundItem | undefined {
  return SOUND_ITEMS.find((item) => item.slug === slug)
}

export function toTrackDefs(item: SoundItem, visibility: "all" | "free" = "all", locale: Locale = "ru"): TrackDef[] {
  const allSources = getAllSources(item)
  const srcs = visibility === "free" ? allSources.slice(0, Math.min(FREE_TRACK_LIMIT, allSources.length)) : allSources
  const title = getSoundDisplayTitle(item, locale)
  return srcs.map((src, idx) => ({ name: `${title} ${String(idx + 1).padStart(2, "0")}`, src }))
}

export type SoundTrackAccess = {
  freeTracks: TrackDef[]
  premiumTracks: TrackDef[]
  allTracks: TrackDef[]
  entitlementCode: string | null
}

export function getSoundPremiumEntitlementCode(item: SoundItem): string | null {
  const allSources = getAllSources(item)
  if (allSources.length <= FREE_TRACK_LIMIT) return null
  return item.premiumEntitlementCode ?? `sound:${item.slug}:premium-tracks`
}

export function getSoundTrackAccess(item: SoundItem, locale: Locale = "ru"): SoundTrackAccess {
  const allTracks = toTrackDefs(item, "all", locale)
  const freeTracks = allTracks.slice(0, Math.min(FREE_TRACK_LIMIT, allTracks.length))
  const premiumTracks = allTracks.slice(freeTracks.length)
  return {
    freeTracks,
    premiumTracks,
    allTracks,
    entitlementCode: getSoundPremiumEntitlementCode(item),
  }
}

export function getPlayableIndexBySlug(slug: string): number {
  return SOUND_PLAYABLE_ITEMS.findIndex((item) => item.slug === slug)
}
