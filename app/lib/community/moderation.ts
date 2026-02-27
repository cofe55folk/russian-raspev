import type { AuthSession } from "../auth/session";
import type { UserModerationRestriction } from "./store-file";

const URL_PATTERN = /\b((https?:\/\/|www\.)[^\s]+)\b/i;
const PROFANITY_PATTERNS = [
  /(?:^|[^а-яё])(бля|бляд|блять|блять|бляха|блят)(?:[^а-яё]|$)/i,
  /(?:^|[^а-яё])(хуй|хуе|хуё|хуя|хуи)(?:[^а-яё]|$)/i,
  /(?:^|[^а-яё])(пизд|пизда|пиздец)(?:[^а-яё]|$)/i,
  /(?:^|[^а-яё])(ебан|ебат|ёбан|ебуч|ебло)(?:[^а-яё]|$)/i,
  /(?:^|[^а-яё])(мраз|сучк|уеб|урод|твар)(?:[^а-яё]|$)/i,
];

export function normalizeCommentBody(raw: string | undefined): string {
  return (raw || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
}

export function hasUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

export function hasProfanity(text: string): boolean {
  const normalized = text.toLowerCase();
  return PROFANITY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function canSessionPostLinks(
  session: AuthSession | null,
  restriction: UserModerationRestriction | null
): boolean {
  if (!session) return false;
  if (restriction?.linksAllowed === true) return true;
  return session.entitlements.length > 0;
}

export function isUserBannedNow(restriction: UserModerationRestriction | null): boolean {
  if (!restriction?.bannedUntil) return false;
  const ts = new Date(restriction.bannedUntil).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

export function getEffectiveCooldownSec(restriction: UserModerationRestriction | null): number {
  if (!restriction) return 15;
  return Math.max(0, Math.min(3600, Math.floor(restriction.commentCooldownSec || 0)));
}

export function canCommentByRestriction(restriction: UserModerationRestriction | null): boolean {
  if (!restriction) return true;
  return restriction.canComment;
}
