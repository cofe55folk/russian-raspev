import type { Locale } from "./types";
import { getLocaleMeta } from "./types";

export function toIntlLocale(locale: Locale): string {
  return getLocaleMeta(locale).intl;
}

export function formatDateForLocale(value: string, locale: Locale): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(parsed);
}
