import type { Locale } from "./types";
import { DEFAULT_LOCALE, isLocale } from "./types";

export type FeedbackDraftContextType = "course_video" | "course_audio" | "course_text" | "material_offer" | "general";
export type FeedbackDraftChannel = "general" | "curator";

export type FeedbackDraftQuery = {
  channel?: FeedbackDraftChannel;
  contextType?: FeedbackDraftContextType;
  contextId?: string;
  contextTitle?: string;
  contextSlug?: string;
  subject?: string;
};

export function localizeHref(href: string, locale: Locale): string {
  // Keep external URLs untouched.
  if (!href || !href.startsWith("/") || href.startsWith("//")) {
    return href;
  }
  if (href.startsWith("/api") || href.startsWith("/_next")) {
    return href;
  }

  const matched = href.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  const pathnamePart = matched?.[1] || "/";
  const query = matched?.[2] ?? "";
  const hash = matched?.[3] ?? "";
  const normalizedPath = stripLocalePrefixFromPathname(pathnamePart);
  const localizedPath = buildLocalePathname(normalizedPath, locale);
  return `${localizedPath}${query}${hash}`;
}

export function extractLocaleFromPathname(pathname: string): Locale | null {
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  return isLocale(firstSegment) ? firstSegment : null;
}

export function stripLocalePrefixFromPathname(pathname: string): string {
  const cleanPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const locale = extractLocaleFromPathname(cleanPath);
  if (!locale) return cleanPath || "/";

  const stripped = cleanPath.replace(new RegExp(`^/${locale}(?=/|$)`), "");
  return stripped || "/";
}

export function buildLocalePathname(pathname: string, locale: Locale): string {
  const normalizedPath = stripLocalePrefixFromPathname(pathname || "/");
  if (locale === DEFAULT_LOCALE) return normalizedPath;
  return normalizedPath === "/" ? `/${locale}` : `/${locale}${normalizedPath}`;
}

export function getHomeHref(locale: Locale): string {
  return localizeHref("/", locale);
}

export function getConceptHref(locale: Locale): string {
  return localizeHref("/concept", locale);
}

export function getAuthHref(locale: Locale): string {
  return localizeHref("/auth", locale);
}

export function getAccountHref(locale: Locale): string {
  return localizeHref("/account", locale);
}

export function getPremiumHref(locale: Locale): string {
  return localizeHref("/premium", locale);
}

export function getAdminEntitlementsHref(locale: Locale): string {
  return localizeHref("/admin/entitlements", locale);
}

export function getAdminFeedbackHref(locale: Locale): string {
  return localizeHref("/admin/feedback", locale);
}

export function getAdminAnalyticsHref(locale: Locale): string {
  return localizeHref("/admin/analytics", locale);
}

export function getAdminEventsHref(locale: Locale): string {
  return localizeHref("/admin/events", locale);
}

export function getVideoHref(locale: Locale): string {
  return localizeHref("/video", locale);
}

export function getSoundHref(locale: Locale): string {
  return localizeHref("/sound", locale);
}

export function getEducationHref(locale: Locale): string {
  return localizeHref("/education", locale);
}

export function getEducationCourseHref(locale: Locale, slug: string): string {
  return localizeHref(`/education/${slug}`, locale);
}

export function getArticlesHref(locale: Locale): string {
  return localizeHref("/articles", locale);
}

export function getEventsHref(locale: Locale): string {
  return localizeHref("/events", locale);
}

export function getEventHref(locale: Locale, slug: string): string {
  return localizeHref(`/events/${slug}`, locale);
}

export function getDonateHref(locale: Locale): string {
  return localizeHref("/donate", locale);
}

export function getMapHref(locale: Locale): string {
  return localizeHref("/map", locale);
}

export function getSearchHref(locale: Locale): string {
  return localizeHref("/search", locale);
}

export function getMaterialOfferHref(locale: Locale, slug: string): string {
  return localizeHref(`/materials/${slug}`, locale);
}

export function getMaterialsHref(locale: Locale): string {
  return localizeHref("/materials", locale);
}

export function getArticleCreateHref(locale: Locale): string {
  return localizeHref("/articles/create", locale);
}

export function getArticlePreviewHref(locale: Locale): string {
  return localizeHref("/articles/preview", locale);
}

export function getArticleHref(locale: Locale, slug: string): string {
  return localizeHref(`/articles/${slug}`, locale);
}

export function getSoundTrackHref(locale: Locale, slug: string): string {
  return localizeHref(`/sound/${slug}`, locale);
}

export function getAccountFeedbackHref(locale: Locale): string {
  return localizeHref("/account/feedback", locale);
}

export function getAccountFeedbackDraftHref(locale: Locale, draft: FeedbackDraftQuery): string {
  const base = getAccountFeedbackHref(locale);
  const params = new URLSearchParams();
  if (draft.channel) params.set("channel", draft.channel);
  if (draft.contextType) params.set("contextType", draft.contextType);
  if (draft.contextId?.trim()) params.set("contextId", draft.contextId.trim());
  if (draft.contextTitle?.trim()) params.set("contextTitle", draft.contextTitle.trim());
  if (draft.contextSlug?.trim()) params.set("contextSlug", draft.contextSlug.trim());
  if (draft.subject?.trim()) params.set("subject", draft.subject.trim());
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function getAccountBookmarksHref(locale: Locale): string {
  return localizeHref("/account/bookmarks", locale);
}

export function getPublicProfileHref(locale: Locale, handle: string): string {
  return localizeHref(`/u/${encodeURIComponent(handle.trim().toLowerCase())}`, locale);
}
