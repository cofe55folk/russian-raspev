import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE_NAME,
  REQUEST_LOCALE_HEADER_NAME,
  type Locale,
} from "./types";

export async function readRequestLocale(): Promise<Locale> {
  const headerStore = await headers();
  const fromHeader = headerStore.get(REQUEST_LOCALE_HEADER_NAME);
  if (isLocale(fromHeader)) return fromHeader;

  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (isLocale(raw)) return raw;
  return DEFAULT_LOCALE;
}
