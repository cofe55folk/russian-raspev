import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const PREVIEW_FLAGS_COOKIE = "rr_preview_flags_v1";

export const PREVIEW_FEATURE_KEYS = ["ugc_creator_tracks", "multitrack_progressive_load", "recording_engine_v2"] as const;
export type PreviewFeatureKey = (typeof PREVIEW_FEATURE_KEYS)[number];

function isPreviewFeatureKey(value: string): value is PreviewFeatureKey {
  return (PREVIEW_FEATURE_KEYS as readonly string[]).includes(value);
}

function parseRawFlags(raw: string | undefined): Set<PreviewFeatureKey> {
  if (!raw) return new Set();
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const out = new Set<PreviewFeatureKey>();
  for (const item of items) {
    if (isPreviewFeatureKey(item)) out.add(item);
  }
  return out;
}

function applyDefaultFlags(input: Set<PreviewFeatureKey>): Set<PreviewFeatureKey> {
  const out = new Set(input);
  const defaults = (process.env.RR_PREVIEW_FEATURES_DEFAULT || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const item of defaults) {
    if (isPreviewFeatureKey(item)) out.add(item);
  }
  return out;
}

export function serializePreviewFlags(flags: Iterable<PreviewFeatureKey>): string {
  return Array.from(new Set(flags)).sort().join(",");
}

export async function getPreviewFlagsFromCookieStore(): Promise<Set<PreviewFeatureKey>> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PREVIEW_FLAGS_COOKIE)?.value;
  return applyDefaultFlags(parseRawFlags(raw));
}

export function getPreviewFlagsFromRequest(request: NextRequest): Set<PreviewFeatureKey> {
  const raw = request.cookies.get(PREVIEW_FLAGS_COOKIE)?.value;
  return applyDefaultFlags(parseRawFlags(raw));
}

export async function isPreviewFeatureEnabledForCookieStore(key: PreviewFeatureKey): Promise<boolean> {
  const flags = await getPreviewFlagsFromCookieStore();
  return flags.has(key);
}

export function isPreviewFeatureEnabledForRequest(request: NextRequest, key: PreviewFeatureKey): boolean {
  const flags = getPreviewFlagsFromRequest(request);
  return flags.has(key);
}

export function normalizePreviewFeatureKey(value: unknown): PreviewFeatureKey | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isPreviewFeatureKey(trimmed) ? trimmed : null;
}

export function withPreviewFlag(
  current: Set<PreviewFeatureKey>,
  key: PreviewFeatureKey,
  enabled: boolean
): Set<PreviewFeatureKey> {
  const next = new Set(current);
  if (enabled) next.add(key);
  else next.delete(key);
  return next;
}
