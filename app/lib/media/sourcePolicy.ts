const ALLOWED_MEDIA_PREFIXES = ["/audio/", "/video/"] as const;

export function isAllowedMediaSourcePath(src: string): boolean {
  return ALLOWED_MEDIA_PREFIXES.some((prefix) => src.startsWith(prefix));
}
