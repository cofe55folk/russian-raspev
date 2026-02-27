export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^0-9a-zа-я]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeForSearch(value).split(" ").filter(Boolean);
}

