"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { I18N_MESSAGES } from "../../lib/i18n/messages";
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, type Locale } from "../../lib/i18n/types";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

type I18nProviderProps = {
  initialLocale?: Locale;
  children: ReactNode;
};

export default function I18nProvider({ initialLocale = DEFAULT_LOCALE, children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    document.documentElement.lang = nextLocale;
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try {
      window.localStorage.setItem(LOCALE_COOKIE_NAME, nextLocale);
    } catch {}
  }, []);

  const t = useCallback(
    (key: string) =>
      I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ??
      I18N_MESSAGES[DEFAULT_LOCALE][key as keyof (typeof I18N_MESSAGES)["ru"]] ??
      key,
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return ctx;
}
