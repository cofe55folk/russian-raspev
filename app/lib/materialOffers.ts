import type { Locale } from "./i18n/types";

export type MaterialOfferItem = {
  id: string;
  title: string;
  description: string;
};

export type MaterialOffer = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  titleTranslations?: { ru?: string; en?: string };
  subtitleTranslations?: { ru?: string; en?: string };
  description: string;
  descriptionTranslations?: { ru?: string; en?: string };
  entitlementCode: string;
  previewBullets: string[];
  includes: MaterialOfferItem[];
  searchKeywords: string[];
  coverImageSrc?: string;
};

export const MATERIAL_OFFERS: MaterialOffer[] = [
  {
    id: "offer-vocal-course-pro",
    slug: "vocal-course-pro",
    title: "Видеокурс «Основы народного вокала»",
    subtitle: "33 DRM-видео, 6 недель, обратная связь и поэтапная практика",
    titleTranslations: {
      en: "Video Course: Fundamentals of Folk Vocal",
    },
    subtitleTranslations: {
      en: "33 DRM-protected lessons, 6 weeks, feedback, and guided practice",
    },
    description:
      "Полный курс по вокалу: диагностика проблем, дыхание, резонаторы, артикуляция, фразовая работа и закрепление на песнях. Материалы защищены DRM на Kinescope.",
    descriptionTranslations: {
      en: "A complete vocal path: diagnostics, breathing, resonators, articulation, phrase work, and song-based practice. Content is DRM-protected on Kinescope.",
    },
    entitlementCode: "course:vocal:full",
    previewBullets: [
      "Открытый урок 001 «Введение в основы вокала»",
      "Полная программа 4 модулей и 33 занятий",
      "DRM-плейлист и индивидуальный темп прохождения",
    ],
    includes: [
      { id: "vocal-videos", title: "33 видеоурока", description: "Пошаговый путь от основы к фразовой и песенной работе." },
      { id: "vocal-practice", title: "Практические блоки", description: "Распевки, дыхание, атака, артикуляция и координация тела." },
      { id: "vocal-materials", title: "Дополнительные материалы", description: "Аудиодорожки, многоголосные треки и этнографические записи." },
    ],
    searchKeywords: ["вокал", "основы вокала", "народный вокал", "действительно петь", "дыхание", "резонаторы", "артикуляция", "kinescope", "drm"],
    coverImageSrc: "/hero.jpg",
  },
  {
    id: "offer-kolyadki-course-1",
    slug: "kolyadki-course-1",
    title: "Колядки. Видеокурс №1",
    subtitle: "5 основных песен, дополнительные видео и DRM-плейлист",
    titleTranslations: {
      en: "Kolyadki: Video Course #1",
    },
    subtitleTranslations: {
      en: "5 core songs, bonus videos, and DRM playlist",
    },
    description:
      "Курс по колядкам от простого к сложному: диалектный текст, показ напева, разбор голосов и дополнительные видео. Контент защищен DRM на Kinescope.",
    descriptionTranslations: {
      en: "A Kolyadki course from simple to complex: dialect lyrics, melodic guidance, voice-part analysis, and bonus videos. Content is DRM-protected on Kinescope.",
    },
    entitlementCode: "course:kolyadki:full",
    previewBullets: [
      "Открытый урок из курса",
      "5 песен с уровнями сложности 1* -> 2.5*",
      "DRM-плейлист и дополнительные видео",
    ],
    includes: [
      { id: "kolyadki-videos", title: "Основные видеоуроки", description: "5 песен с пошаговым разбором от простого к сложному." },
      { id: "kolyadki-bonus", title: "Бонусные видео", description: "Дополнительные разборы и пояснения к материалу курса." },
      { id: "kolyadki-ethno", title: "Этнографический материал", description: "Опорные этнографические примеры в приложениях к урокам." },
    ],
    searchKeywords: ["колядки", "видеокурс", "рождественские песни", "традиционное пение", "kinescope", "drm"],
    coverImageSrc: "/hero.jpg",
  },
  {
    id: "offer-khorovod-marathon",
    slug: "khorovod-marathon",
    title: "Марафон по хороводным песням",
    subtitle: "5-7 треков, видео и материалы по каждой теме",
    description:
      "Интенсив для тех, кто хочет быстро войти в материал: каждую песню разбираем через ритм, фразу и партию, с поддержкой дополнительных материалов.",
    entitlementCode: "marathon:khorovod:access",
    previewBullets: [
      "Список треков и программа марафона",
      "Открытый фрагмент одного видеоразбора",
      "Пример методички по домашнему повторению",
    ],
    includes: [
      { id: "marathon-tracks", title: "Треки", description: "5-7 основных треков и учебные версии для самостоятельной практики." },
      { id: "marathon-video", title: "Видео", description: "Пошаговые разборы по каждой песне и общие сессии по технике." },
      { id: "marathon-text", title: "Материалы", description: "Текстовые подсказки, структура занятий и чек-листы прогресса." },
    ],
    searchKeywords: ["марафон", "хороводные песни", "трек", "обучение"],
    coverImageSrc: "/hero.jpg",
  },
  {
    id: "offer-improv-pack",
    slug: "improv-pack",
    title: "Импровизация",
    subtitle: "2 видео + расширенный набор дорожек",
    description:
      "Надстройка для развития импровизации в ансамблевом и сольном пении. Включает демонстрации и дополнительные дорожки под разные песни.",
    entitlementCode: "improv:pack:access",
    previewBullets: [
      "Демо-фрагмент импровизационного упражнения",
      "Открытая схема взаимодействия голосов",
      "Описание дополнительного набора дорожек",
    ],
    includes: [
      { id: "improv-video", title: "Видео", description: "2 методических видео по импровизационным приёмам." },
      { id: "improv-trackpack", title: "Доп. дорожки", description: "Расширенный набор учебных дорожек под разные песни." },
      { id: "improv-guides", title: "Сценарии практики", description: "План импровизационных тренировок для ежедневной работы." },
    ],
    searchKeywords: ["импровизация", "дорожки", "дополнительные дорожки", "вариативность"],
    coverImageSrc: "/hero.jpg",
  },
  {
    id: "offer-porushka-foundation",
    slug: "porushka-foundation",
    title: "Курс «Порушка»: база и надстройка",
    subtitle: "Базовые материалы + расширенные блоки по подписке",
    description:
      "Карточка доступа к расширенным материалам курса «Порушка». Подходит как витрина и точка входа перед покупкой.",
    entitlementCode: "course:porushka-foundation:access",
    previewBullets: [
      "Демо-фрагмент урока из курса",
      "Состав базового и расширенного модулей",
      "Условия доступа и формат занятий",
    ],
    includes: [
      { id: "porushka-video", title: "Видео", description: "Расширенные видеоразборы по структуре и вариативности." },
      { id: "porushka-audio", title: "Аудио", description: "Дополнительные дорожки для практики и послойного обучения." },
      { id: "porushka-text", title: "Текст", description: "Методические материалы и пошаговые планы занятий." },
    ],
    searchKeywords: ["порушка", "курс порушка", "дополнительные дорожки", "обучение"],
    coverImageSrc: "/hero.jpg",
  },
];

export function getMaterialOfferBySlug(slug: string): MaterialOffer | undefined {
  return MATERIAL_OFFERS.find((item) => item.slug === slug);
}

export function getMaterialOfferByEntitlementCode(entitlementCode: string): MaterialOffer | undefined {
  return MATERIAL_OFFERS.find((item) => item.entitlementCode === entitlementCode);
}

export function getMaterialOfferTitle(offer: MaterialOffer, locale: Locale): string {
  return offer.titleTranslations?.[locale] || offer.title;
}

export function getMaterialOfferSubtitle(offer: MaterialOffer, locale: Locale): string {
  return offer.subtitleTranslations?.[locale] || offer.subtitle;
}

export function getMaterialOfferDescription(offer: MaterialOffer, locale: Locale): string {
  return offer.descriptionTranslations?.[locale] || offer.description;
}
