export type SearchResultKind = "sound" | "article" | "video" | "education" | "event";

export type SearchResultItem = {
  id: string;
  kind: SearchResultKind;
  title: string;
  href: string;
  snippet: string;
  score: number;
  accessStatus: "unlocked" | "locked";
  requiredEntitlement?: string | null;
  region?: string | null;
  eventDateIso?: string | null;
};

export type SearchSuggestResponse = {
  query: string;
  results: SearchResultItem[];
  suggestions: string[];
  popular: SearchResultItem[];
  popularQueries: string[];
};
