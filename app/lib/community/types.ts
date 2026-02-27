import type { CommunityContentType } from "./store";

export function isCommunityContentType(value: string | undefined): value is CommunityContentType {
  return value === "article" || value === "video" || value === "sound" || value === "education";
}
