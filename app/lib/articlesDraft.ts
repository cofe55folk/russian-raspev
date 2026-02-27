import type { ArticleBlock } from "./articlesCatalog";

export const DRAFT_KEY = "rr_articles_builder_v1";
export const PUBLISH_REGISTRY_KEY = "rr_articles_publish_registry_v1";
export const DRAFT_SCHEMA_VERSION = 2;

export type DraftPublishStatus = "draft" | "scheduled" | "published";

export type ArticleDraft = {
  slug: string;
  title: string;
  subtitle: string;
  coverImage: string;
  coverFocusY: number;
  sourceLabel: string;
  sourceUrl: string;
  blocks: ArticleBlock[];
};

export type PublishRegistryEntry = {
  status: DraftPublishStatus;
  visibility: "public" | "link";
  publishedAt: string;
  canonicalUrl?: string;
};

type StoredDraftPayload = {
  version: number;
  draft: ArticleDraft;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeTextBlock(block: Record<string, unknown>, idx: number): ArticleBlock {
  return {
    id: asString(block.id, `text-${idx + 1}`),
    type: "text",
    html: asString(block.html, "<p>Новый текстовый блок статьи.</p>"),
    align: block.align === "center" || block.align === "right" ? block.align : "left",
    fontScale: block.fontScale === "sm" || block.fontScale === "lg" ? block.fontScale : "md",
  };
}

function normalizeBlocks(value: unknown): ArticleBlock[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [
      {
        id: "text-default-1",
        type: "text",
        html: "<p>Новый текстовый блок статьи.</p>",
        align: "left",
        fontScale: "md",
      },
    ];
  }

  const blocks = value
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const block = item as Record<string, unknown>;
      const type = asString(block.type);
      if (type === "text") return normalizeTextBlock(block, idx);
      if (type === "quote") {
        return {
          id: asString(block.id, `quote-${idx + 1}`),
          type: "quote",
          text: asString(block.text, ""),
          author: asString(block.author, ""),
        } satisfies ArticleBlock;
      }
      if (type === "image") {
        return {
          id: asString(block.id, `image-${idx + 1}`),
          type: "image",
          src: asString(block.src, ""),
          caption: asString(block.caption, ""),
          align: block.align === "left" || block.align === "right" || block.align === "full" ? block.align : "center",
          size: block.size === "sm" || block.size === "lg" ? block.size : "md",
          wrap: Boolean(block.wrap),
        } satisfies ArticleBlock;
      }
      if (type === "audio") {
        return {
          id: asString(block.id, `audio-${idx + 1}`),
          type: "audio",
          src: asString(block.src, ""),
          title: asString(block.title, "Название аудио"),
          caption: asString(block.caption, ""),
        } satisfies ArticleBlock;
      }
      if (type === "video") {
        return {
          id: asString(block.id, `video-${idx + 1}`),
          type: "video",
          src: asString(block.src, ""),
          title: asString(block.title, ""),
          caption: asString(block.caption, ""),
          align: block.align === "left" || block.align === "right" || block.align === "full" ? block.align : "center",
          size: block.size === "sm" || block.size === "lg" ? block.size : "md",
          wrap: Boolean(block.wrap),
        } satisfies ArticleBlock;
      }
      if (type === "table") {
        const rows = Array.isArray(block.rows)
          ? block.rows.map((row) => (Array.isArray(row) ? row.map((cell) => asString(cell, "")) : ["", ""]))
          : [["", ""], ["", ""]];
        return {
          id: asString(block.id, `table-${idx + 1}`),
          type: "table",
          caption: asString(block.caption, ""),
          bordered: block.bordered !== false,
          rows: rows.length ? rows : [["", ""], ["", ""]],
        } satisfies ArticleBlock;
      }
      if (type === "playlist") {
        return {
          id: asString(block.id, `playlist-${idx + 1}`),
          type: "playlist",
          title: asString(block.title, "Плейлист"),
          songSlugs: Array.isArray(block.songSlugs) ? block.songSlugs.map((s) => asString(s, "")).filter(Boolean) : [],
        } satisfies ArticleBlock;
      }
      return null;
    })
    .filter((block): block is ArticleBlock => !!block);

  return blocks.length
    ? blocks
    : [
        {
          id: "text-default-1",
          type: "text",
          html: "<p>Новый текстовый блок статьи.</p>",
          align: "left",
          fontScale: "md",
        },
      ];
}

export function createDefaultDraft(): ArticleDraft {
  return {
    slug: "",
    title: "",
    subtitle: "",
    coverImage: "",
    coverFocusY: 50,
    sourceLabel: "Источник",
    sourceUrl: "",
    blocks: normalizeBlocks(undefined),
  };
}

export function normalizeDraftLike(value: unknown): ArticleDraft | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  return {
    slug: asString(src.slug, ""),
    title: asString(src.title, ""),
    subtitle: asString(src.subtitle, ""),
    coverImage: asString(src.coverImage, ""),
    coverFocusY: clamp(typeof src.coverFocusY === "number" ? src.coverFocusY : 50, 0, 100),
    sourceLabel: asString(src.sourceLabel, "Источник"),
    sourceUrl: asString(src.sourceUrl, ""),
    blocks: normalizeBlocks(src.blocks),
  };
}

export function parseStoredDraft(raw: string): ArticleDraft | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Partial<StoredDraftPayload>;
    if (payload.draft && typeof payload.draft === "object") {
      return normalizeDraftLike(payload.draft);
    }
    return normalizeDraftLike(parsed);
  } catch {
    return null;
  }
}

export function readDraftFromStorage(): { draft: ArticleDraft | null; restored: boolean } {
  if (typeof window === "undefined") return { draft: null, restored: false };
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { draft: null, restored: false };
    const draft = parseStoredDraft(raw);
    return { draft, restored: !!draft };
  } catch {
    return { draft: null, restored: false };
  }
}

export function writeDraftToStorage(draft: ArticleDraft): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload: StoredDraftPayload = { version: DRAFT_SCHEMA_VERSION, draft };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadPublishRegistryFromStorage(): Record<string, PublishRegistryEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PUBLISH_REGISTRY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<PublishRegistryEntry>>;
    if (!parsed || typeof parsed !== "object") return {};
    const normalized: Record<string, PublishRegistryEntry> = {};
    Object.entries(parsed).forEach(([slug, entry]) => {
      if (!entry || typeof entry !== "object") return;
      const status: DraftPublishStatus =
        entry.status === "scheduled" || entry.status === "published" ? entry.status : "draft";
      normalized[slug] = {
        status,
        visibility: entry.visibility === "link" ? "link" : "public",
        publishedAt: asString(entry.publishedAt, new Date().toISOString().slice(0, 10)),
        canonicalUrl: asString(entry.canonicalUrl, ""),
      };
    });
    return normalized;
  } catch {
    return {};
  }
}

export function savePublishRegistryToStorage(registry: Record<string, PublishRegistryEntry>): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(PUBLISH_REGISTRY_KEY, JSON.stringify(registry));
    return true;
  } catch {
    return false;
  }
}
