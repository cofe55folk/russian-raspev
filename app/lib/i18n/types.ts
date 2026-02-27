export const LOCALES = ["ru", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export type LocalePathPrefixPolicy = "never" | "always";
export type LocaleSearchProfile = "slavic-cyrillic" | "latin";

export type LocaleMeta = {
  intl: string;
  label: string;
  pathPrefix: LocalePathPrefixPolicy;
  searchProfile: LocaleSearchProfile;
};

export const LOCALE_REGISTRY: Record<Locale, LocaleMeta> = {
  ru: {
    intl: "ru-RU",
    label: "Русский",
    pathPrefix: "never",
    searchProfile: "slavic-cyrillic",
  },
  en: {
    intl: "en-US",
    label: "English",
    pathPrefix: "always",
    searchProfile: "latin",
  },
};

export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_COOKIE_NAME = "rr_locale";
export const REQUEST_LOCALE_HEADER_NAME = "x-rr-locale";
export const REQUEST_PATHNAME_HEADER_NAME = "x-rr-pathname";

const LOCALE_SET = new Set<string>(LOCALES);

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && LOCALE_SET.has(value);
}

export function getLocaleMeta(locale: Locale): LocaleMeta {
  return LOCALE_REGISTRY[locale];
}
