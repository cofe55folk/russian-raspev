"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import ArticleBlocksRenderer from "../../components/articles/ArticleBlocksRenderer";
import { useI18n } from "../../components/i18n/I18nProvider";
import PageHero from "../../components/PageHero";
import { ARTICLES } from "../../lib/articlesCatalog";
import { toIntlLocale } from "../../lib/i18n/format";
import { getArticleHref, getArticlePreviewHref, getArticlesHref } from "../../lib/i18n/routing";
import {
  createDefaultDraft,
  DRAFT_KEY,
  loadPublishRegistryFromStorage,
  readDraftFromStorage,
  savePublishRegistryToStorage,
  type ArticleDraft,
  type DraftPublishStatus,
  writeDraftToStorage,
} from "../../lib/articlesDraft";
import { SOUND_ITEMS } from "../../lib/soundCatalog";
import type {
  ArticleBlock,
  ArticleImageBlock,
  ArticleItem,
  ArticleMediaAlign,
  ArticleMediaSize,
  ArticleTableBlock,
  ArticleTextAlign,
  ArticleVideoBlock,
} from "../../lib/articlesCatalog";

type Draft = ArticleDraft;

type PublishSettings = {
  status: DraftPublishStatus;
  visibility: "public" | "link";
  publishedAt: string;
  canonicalUrl: string;
};

type DraftHistoryEntry = {
  id: string;
  savedAt: number;
  label: string;
  draft: Draft;
};

type InsertMenuState = {
  open: boolean;
  afterId: string | null;
  source: "plus" | "slash";
};

type CollapsedBlocksState = Record<string, boolean>;

const DRAFT_HISTORY_KEY = "rr_articles_builder_history_v1";
const EDITOR_PREFS_KEY = "rr_articles_editor_prefs_v1";
const HISTORY_LIMIT = 20;
const BLOCK_TYPE_OPTIONS: ArticleBlock["type"][] = ["text", "quote", "image", "audio", "video", "table", "playlist"];

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

type EditorPrefs = {
  workspaceMode: "writer" | "advanced";
  editorMode: "edit" | "preview";
  isFocusMode: boolean;
  publishSettings: PublishSettings;
};

function slugifyFromTitle(value: string): string {
  if (!value.trim()) return "";
  const transliterated = value
    .toLowerCase()
    .split("")
    .map((symbol) => CYRILLIC_TO_LATIN[symbol] ?? symbol)
    .join("");
  return transliterated
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96);
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function isValidDraftLike(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Draft;
  if (!Array.isArray(draft.blocks)) return false;
  return draft.blocks.every((block) => !!block && typeof block === "object" && "id" in block && "type" in block);
}

function isValidBlockArray(value: unknown): value is ArticleBlock[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const block = item as Partial<ArticleBlock>;
    if (typeof block.id !== "string" || typeof block.type !== "string") return false;
    return BLOCK_TYPE_OPTIONS.includes(block.type as ArticleBlock["type"]);
  });
}

function loadHistoryFromStorage(): DraftHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DRAFT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DraftHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => !!entry?.id && !!entry?.savedAt && !!entry?.draft && isValidDraftLike(entry.draft));
  } catch {
    return [];
  }
}

function readEditorPrefsFromStorage(): EditorPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(EDITOR_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditorPrefs>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      workspaceMode: parsed.workspaceMode === "advanced" ? "advanced" : "writer",
      editorMode: parsed.editorMode === "preview" ? "preview" : "edit",
      isFocusMode: parsed.isFocusMode === true,
      publishSettings: {
        status: parsed.publishSettings?.status === "scheduled" || parsed.publishSettings?.status === "draft" ? parsed.publishSettings.status : "published",
        visibility: parsed.publishSettings?.visibility === "link" ? "link" : "public",
        publishedAt: typeof parsed.publishSettings?.publishedAt === "string" && parsed.publishSettings.publishedAt ? parsed.publishSettings.publishedAt : new Date().toISOString().slice(0, 10),
        canonicalUrl: typeof parsed.publishSettings?.canonicalUrl === "string" ? parsed.publishSettings.canonicalUrl : "",
      },
    };
  } catch {
    return null;
  }
}

function writeEditorPrefsToStorage(prefs: EditorPrefs): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(EDITOR_PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

export default function ArticleCreatePage() {
  const { locale, t } = useI18n();
  const intlLocale = toIntlLocale(locale);
  const [draft, setDraft] = useState<Draft>(() => createDefaultDraft());
  const [activeBlockId, setActiveBlockId] = useState<string>("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [publishSettings, setPublishSettings] = useState<PublishSettings>({
    status: "published",
    visibility: "public",
    publishedAt: new Date().toISOString().slice(0, 10),
    canonicalUrl: "",
  });
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [insertMenu, setInsertMenu] = useState<InsertMenuState>({
    open: false,
    afterId: null,
    source: "plus",
  });
  const [insertQuery, setInsertQuery] = useState("");
  const [insertActiveIndex, setInsertActiveIndex] = useState(0);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [workspaceMode, setWorkspaceMode] = useState<"writer" | "advanced">("writer");
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isPublishPanelOpen, setIsPublishPanelOpen] = useState(false);
  const [isMobileInsertSheetOpen, setIsMobileInsertSheetOpen] = useState(false);
  const [inlineToolbar, setInlineToolbar] = useState<{ visible: boolean; top: number; left: number }>({
    visible: false,
    top: 0,
    left: 0,
  });
  const [draftHistory, setDraftHistory] = useState<DraftHistoryEntry[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>("");
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);
  const [isSlugEditedManually, setIsSlugEditedManually] = useState(false);
  const [collapsedBlocks, setCollapsedBlocks] = useState<CollapsedBlocksState>({});
  const textEditorRef = useRef<HTMLDivElement | null>(null);
  const lastSavedFingerprintRef = useRef("");
  const previousDraftRef = useRef<Draft | null>(null);

  useEffect(() => {
    const fallbackDraft = createDefaultDraft();
    const restoredState = readDraftFromStorage();
    const nextDraft = restoredState.draft && isValidDraftLike(restoredState.draft) ? restoredState.draft : fallbackDraft;
    const editorPrefs = readEditorPrefsFromStorage();

    setDraft(nextDraft);
    setActiveBlockId(nextDraft.blocks[0]?.id ?? "");
    setRestoredFromStorage(restoredState.restored);
    setIsSlugEditedManually(!!nextDraft.slug.trim());
    lastSavedFingerprintRef.current = JSON.stringify(nextDraft);
    previousDraftRef.current = nextDraft;
    setIsDirty(false);
    if (editorPrefs) {
      setWorkspaceMode(editorPrefs.workspaceMode);
      setEditorMode(editorPrefs.editorMode);
      setIsFocusMode(editorPrefs.isFocusMode);
      setPublishSettings(editorPrefs.publishSettings);
    }
    setDraftHistory(loadHistoryFromStorage());
    setIsStorageReady(true);
  }, []);

  const persistDraftNow = useCallback((nextDraft: Draft) => {
    try {
      if (!writeDraftToStorage(nextDraft)) throw new Error("save_failed");
      setSaveState("saved");
      setLastSavedAt(Date.now());
      const fingerprint = JSON.stringify(nextDraft);
      lastSavedFingerprintRef.current = fingerprint;
      setIsDirty(false);
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }, []);

  useEffect(() => {
    if (!isStorageReady) return;
    const fingerprint = JSON.stringify(draft);
    if (fingerprint === lastSavedFingerprintRef.current) return;
    setIsDirty(true);
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      persistDraftNow(draft);
    }, 520);
    return () => window.clearTimeout(timer);
  }, [draft, isStorageReady, persistDraftNow]);

  useEffect(() => {
    if (!isStorageReady) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty, isStorageReady]);

  useEffect(() => {
    setCollapsedBlocks((prev) => {
      const existingIds = new Set(draft.blocks.map((block) => block.id));
      const next: CollapsedBlocksState = {};
      Object.entries(prev).forEach(([id, value]) => {
        if (existingIds.has(id)) next[id] = value;
      });
      return next;
    });
  }, [draft.blocks]);

  useEffect(() => {
    if (!isStorageReady) return;
    writeEditorPrefsToStorage({
      workspaceMode,
      editorMode,
      isFocusMode,
      publishSettings,
    });
  }, [editorMode, isFocusMode, isStorageReady, publishSettings, workspaceMode]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_HISTORY_KEY, JSON.stringify(draftHistory));
    } catch {}
  }, [draftHistory]);

  useEffect(() => {
    if (selectedHistoryId) return;
    if (!draftHistory.length) return;
    setSelectedHistoryId(draftHistory[0].id);
  }, [draftHistory, selectedHistoryId]);

  const activeBlock = draft.blocks.find((b) => b.id === activeBlockId) ?? null;
  const blockTypeLabel = useCallback(
    (type: ArticleBlock["type"]) => {
      if (type === "text") return t("articles.create.blockType.text");
      if (type === "quote") return t("articles.create.blockType.quote");
      if (type === "image") return t("articles.create.blockType.image");
      if (type === "audio") return t("articles.create.blockType.audio");
      if (type === "video") return t("articles.create.blockType.video");
      if (type === "table") return t("articles.create.blockType.table");
      return t("articles.create.blockType.playlist");
    },
    [t]
  );
  const blockTypeOptions = useMemo(
    () => BLOCK_TYPE_OPTIONS.map((type) => ({ type, label: blockTypeLabel(type) })),
    [blockTypeLabel]
  );

  const playlistOptions = useMemo(
    () => SOUND_ITEMS.map((song) => ({ slug: song.slug, title: song.title })),
    []
  );
  const normalizedSlug = draft.slug.trim().toLowerCase();
  const slugTaken = !!normalizedSlug && ARTICLES.some((article) => article.slug.toLowerCase() === normalizedSlug);
  const publishReady = !!draft.title.trim() && !!normalizedSlug && draft.blocks.length > 0 && !slugTaken;
  const publishChecklist = [
    { label: t("articles.create.publish.check.title"), ok: !!draft.title.trim() },
    { label: t("articles.create.publish.check.slug"), ok: !!normalizedSlug },
    { label: t("articles.create.publish.check.slugUnique"), ok: !slugTaken && !!normalizedSlug },
    { label: t("articles.create.publish.check.block"), ok: draft.blocks.length > 0 },
  ];
  const articlePathPreview = getArticleHref(locale, normalizedSlug || "new-article");
  const isAdvancedMode = workspaceMode === "advanced";

  const setMeta = <K extends keyof Omit<Draft, "blocks">>(key: K, value: Omit<Draft, "blocks">[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateBlock = (id: string, updater: (b: ArticleBlock) => ArticleBlock) => {
    setDraft((prev) => ({
      ...prev,
      blocks: prev.blocks.map((block) => (block.id === id ? updater(block) : block)),
    }));
  };

  const createBlockByType = useCallback(
    (type: ArticleBlock["type"]): ArticleBlock =>
      type === "text"
        ? { id: uid("text"), type: "text", html: `<p>${t("articles.create.block.defaultText")}</p>`, align: "left", fontScale: "md" }
        : type === "quote"
          ? { id: uid("quote"), type: "quote", text: t("articles.create.block.defaultQuote"), author: "" }
          : type === "image"
            ? { id: uid("image"), type: "image", src: "", caption: "", align: "center", size: "md", wrap: false }
            : type === "audio"
              ? { id: uid("audio"), type: "audio", src: "", title: t("articles.create.block.defaultAudioTitle"), caption: "" }
              : type === "video"
                ? { id: uid("video"), type: "video", src: "", title: t("articles.create.block.defaultVideoTitle"), caption: "", align: "center", size: "md", wrap: false }
                : type === "table"
                  ? { id: uid("table"), type: "table", caption: "", bordered: true, rows: [["", ""], ["", ""]] }
                  : { id: uid("playlist"), type: "playlist", title: t("articles.create.block.defaultPlaylistTitle"), songSlugs: [] },
    [t]
  );

  const addBlock = (type: ArticleBlock["type"]) => {
    const block = createBlockByType(type);

    setDraft((prev) => ({ ...prev, blocks: [...prev.blocks, block] }));
    setActiveBlockId(block.id);
  };

  const insertBlockAfter = useCallback(
    (afterId: string | null, type: ArticleBlock["type"] = "text") => {
      const block = createBlockByType(type);
      setDraft((prev) => {
        if (!afterId) return { ...prev, blocks: [block, ...prev.blocks] };
        const index = prev.blocks.findIndex((b) => b.id === afterId);
        if (index < 0) return { ...prev, blocks: [...prev.blocks, block] };
        const next = [...prev.blocks];
        next.splice(index + 1, 0, block);
        return { ...prev, blocks: next };
      });
      setActiveBlockId(block.id);
    },
    [createBlockByType]
  );

  const removeBlock = (id: string) => {
    setDraft((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== id) }));
    setActiveBlockId((prev) => (prev === id ? "" : prev));
  };

  const duplicateBlock = useCallback((id: string) => {
    let duplicatedId = "";
    setDraft((prev) => {
      const index = prev.blocks.findIndex((b) => b.id === id);
      if (index < 0) return prev;
      const source = prev.blocks[index];
      const clone = { ...source, id: uid(source.type) } as ArticleBlock;
      duplicatedId = clone.id;
      const next = [...prev.blocks];
      next.splice(index + 1, 0, clone);
      return { ...prev, blocks: next };
    });
    if (duplicatedId) {
      setActiveBlockId(duplicatedId);
      setCollapsedBlocks((prev) => ({ ...prev, [duplicatedId]: false }));
    }
  }, []);

  const moveBlock = (id: string, direction: -1 | 1) => {
    setDraft((prev) => {
      const index = prev.blocks.findIndex((b) => b.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.blocks.length) return prev;
      const next = [...prev.blocks];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return { ...prev, blocks: next };
    });
  };

  const moveBlockByDrop = useCallback((dragId: string, dropId: string) => {
    setDraft((prev) => {
      const from = prev.blocks.findIndex((block) => block.id === dragId);
      const to = prev.blocks.findIndex((block) => block.id === dropId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev.blocks];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...prev, blocks: next };
    });
  }, []);

  const toggleBlockCollapse = useCallback((id: string) => {
    setCollapsedBlocks((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const focusInsertQueryInput = useCallback((afterId: string | null, source: InsertMenuState["source"]) => {
    window.setTimeout(() => {
      const menuKey = `${source}:${afterId ?? "root"}`;
      const input = document.querySelector(`[data-rr-insert-search="${menuKey}"]`) as HTMLInputElement | null;
      input?.focus();
    }, 0);
  }, []);

  const openInsertMenu = useCallback((afterId: string | null, source: "plus" | "slash" = "plus") => {
    setInsertMenu({ open: true, afterId, source });
    setInsertQuery("");
    setInsertActiveIndex(0);
    focusInsertQueryInput(afterId, source);
  }, [focusInsertQueryInput]);

  const closeInsertMenu = useCallback(() => {
    setInsertMenu((prev) => ({ ...prev, open: false }));
    setInsertQuery("");
    setInsertActiveIndex(0);
  }, []);

  const insertBlockFromMenu = useCallback(
    (type: ArticleBlock["type"]) => {
      insertBlockAfter(insertMenu.afterId, type);
      closeInsertMenu();
    },
    [closeInsertMenu, insertBlockAfter, insertMenu.afterId]
  );
  const filteredBlockOptions = useMemo(() => {
    const q = insertQuery.trim().toLocaleLowerCase(intlLocale);
    if (!q) return blockTypeOptions;
    return blockTypeOptions.filter((option) => option.label.toLocaleLowerCase(intlLocale).includes(q));
  }, [blockTypeOptions, insertQuery, intlLocale]);

  useEffect(() => {
    setInsertActiveIndex((prev) => {
      if (!filteredBlockOptions.length) return 0;
      return Math.min(prev, filteredBlockOptions.length - 1);
    });
  }, [filteredBlockOptions.length]);

  const moveInsertMenuSelection = useCallback(
    (direction: 1 | -1) => {
      if (!filteredBlockOptions.length) return;
      setInsertActiveIndex((prev) => {
        const next = prev + direction;
        if (next < 0) return filteredBlockOptions.length - 1;
        if (next >= filteredBlockOptions.length) return 0;
        return next;
      });
    },
    [filteredBlockOptions.length]
  );

  const applyInsertMenuSelection = useCallback(() => {
    const option = filteredBlockOptions[insertActiveIndex] ?? filteredBlockOptions[0];
    if (!option) return false;
    insertBlockFromMenu(option.type);
    return true;
  }, [filteredBlockOptions, insertActiveIndex, insertBlockFromMenu]);

  const handleInsertMenuKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement | HTMLDivElement>) => {
      if (!insertMenu.open) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveInsertMenuSelection(1);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveInsertMenuSelection(-1);
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        return applyInsertMenuSelection();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeInsertMenu();
        return true;
      }
      return false;
    },
    [applyInsertMenuSelection, closeInsertMenu, insertMenu.open, moveInsertMenuSelection]
  );

  const focusTextBlockEditor = useCallback((blockId: string) => {
    setActiveBlockId(blockId);
    window.setTimeout(() => {
      const nextEditor = document.querySelector(`[data-rr-text-editor="${blockId}"]`) as HTMLDivElement | null;
      if (!nextEditor) return;
      nextEditor.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(nextEditor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }, 0);
  }, []);

  const clearDraft = () => {
    const clean = createDefaultDraft();
    setDraft(clean);
    setActiveBlockId(clean.blocks[0].id);
    setIsSlugEditedManually(false);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
  };

  const createSnapshot = useCallback(
    (label: string) => {
      setDraftHistory((prev) => {
        const entry: DraftHistoryEntry = {
          id: uid("ver"),
          savedAt: Date.now(),
          label,
          draft,
        };
        return [entry, ...prev].slice(0, HISTORY_LIMIT);
      });
    },
    [draft]
  );

  const restoreSnapshot = useCallback(() => {
    const selected = draftHistory.find((entry) => entry.id === selectedHistoryId);
    if (!selected) return;
    if (isDirty && previousDraftRef.current) {
      setDraftHistory((prev) =>
        [
          {
            id: uid("ver"),
            savedAt: Date.now(),
            label: t("articles.create.snapshot.autoBeforeRestore"),
            draft: previousDraftRef.current as Draft,
          },
          ...prev,
        ].slice(0, HISTORY_LIMIT)
      );
    }
    setDraft(selected.draft);
    setActiveBlockId(selected.draft.blocks[0]?.id ?? "");
    setSaveState("saving");
  }, [draftHistory, isDirty, selectedHistoryId, t]);

  const buildArticlePayload = (forPublish: boolean): ArticleItem => ({
    slug: draft.slug || "new-article",
    title: draft.title || t("articles.create.newArticleTitle"),
    subtitle: draft.subtitle || "",
    coverImage: draft.coverImage || undefined,
    sourceLabel: draft.sourceLabel || undefined,
    sourceUrl: draft.sourceUrl || undefined,
    publishedAt: forPublish ? publishSettings.publishedAt || undefined : undefined,
    sections: [],
    blocks: draft.blocks,
  });

  const copyJson = async () => {
    const article = buildArticlePayload(false);
    await navigator.clipboard.writeText(JSON.stringify(article, null, 2));
  };

  const downloadJson = (forPublish = false) => {
    const article = buildArticlePayload(forPublish);
    const fileName = `${article.slug || "article"}.json`;
    const blob = new Blob([JSON.stringify(article, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPublishPackage = async () => {
    const article = buildArticlePayload(true);
    const publicationPacket = {
      article,
      status: publishSettings.status,
      visibility: publishSettings.visibility,
      canonicalUrl: publishSettings.canonicalUrl || undefined,
      exportedAt: new Date().toISOString(),
    };
    await navigator.clipboard.writeText(JSON.stringify(publicationPacket, null, 2));
    markAsPublished(article.slug);
  };

  const markAsPublished = (slug: string) => {
    if (!slug.trim()) return;
    try {
      const registry = loadPublishRegistryFromStorage();
      const normalizedDate = publishSettings.publishedAt || new Date().toISOString().slice(0, 10);
      const nowDate = new Date().toISOString().slice(0, 10);
      const computedStatus: DraftPublishStatus =
        publishSettings.status === "scheduled" || normalizedDate > nowDate
          ? "scheduled"
          : publishSettings.status === "draft"
            ? "draft"
            : "published";
      registry[slug.trim().toLowerCase()] = {
        status: computedStatus,
        publishedAt: normalizedDate,
        visibility: publishSettings.visibility,
        canonicalUrl: publishSettings.canonicalUrl || "",
      };
      savePublishRegistryToStorage(registry);
    } catch {}
  };

  const importJsonFromPrompt = () => {
    const raw = window.prompt(t("articles.create.prompt.importJson"));
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw) as Partial<ArticleItem>;
      if (!isValidBlockArray(parsed.blocks)) throw new Error("invalid blocks");
      const next: Draft = {
        slug: parsed.slug ?? "",
        title: parsed.title ?? "",
        subtitle: parsed.subtitle ?? "",
        coverImage: parsed.coverImage ?? "",
        coverFocusY: 50,
        sourceLabel: parsed.sourceLabel ?? t("common.source"),
        sourceUrl: parsed.sourceUrl ?? "",
        blocks: parsed.blocks,
      };
      if (!next.blocks.length) throw new Error("empty blocks");
      setDraft(next);
      setActiveBlockId(next.blocks[0].id ?? "");
    } catch {
      window.alert(t("articles.create.alert.importJsonError"));
    }
  };

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
  };

  const hideInlineToolbar = useCallback(() => {
    setInlineToolbar((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  const refreshInlineToolbar = useCallback(() => {
    if (!(editorMode === "edit" && activeBlock?.type === "text")) {
      hideInlineToolbar();
      return;
    }
    const root = textEditorRef.current;
    if (!root) {
      hideInlineToolbar();
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideInlineToolbar();
      return;
    }
    const anchorNode = selection.anchorNode;
    if (!anchorNode || !root.contains(anchorNode)) {
      hideInlineToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    const rangeRect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    if (rangeRect.width === 0 && rangeRect.height === 0) {
      hideInlineToolbar();
      return;
    }
    const left = rangeRect.left - rootRect.left + rangeRect.width / 2;
    const top = rangeRect.top - rootRect.top - 10;
    const safeLeft = Math.max(32, Math.min(left, rootRect.width - 32));
    const safeTop = Math.max(10, top);
    setInlineToolbar({ visible: true, left: safeLeft, top: safeTop });
  }, [activeBlock?.type, editorMode, hideInlineToolbar]);

  const runInlineAction = useCallback(
    (action: "bold" | "italic" | "underline" | "link" | "unlink") => {
      if (action === "link") {
        const href = window.prompt(t("articles.create.prompt.linkUrl"));
        if (!href) return;
        exec("createLink", href);
      } else if (action === "unlink") {
        exec("unlink");
      } else {
        exec(action);
      }
      window.setTimeout(() => refreshInlineToolbar(), 0);
    },
    [refreshInlineToolbar, t]
  );

  const setTextBlockFormat = useCallback(
    (tag: "p" | "h2" | "h3") => {
      exec("formatBlock", `<${tag}>`);
      window.setTimeout(() => refreshInlineToolbar(), 0);
    },
    [refreshInlineToolbar]
  );

  useEffect(() => {
    previousDraftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === "Escape") {
        closeInsertMenu();
        setIsPublishPanelOpen(false);
        setIsMobileInsertSheetOpen(false);
        return;
      }
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSaveState("saving");
        if (persistDraftNow(draft)) {
          createSnapshot(t("articles.create.snapshot.manualSave"));
        }
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setIsFocusMode((prev) => !prev);
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setEditorMode("preview");
        return;
      }
      if (mod && event.key === "Enter") {
        event.preventDefault();
        setIsPublishPanelOpen(true);
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (!activeBlockId) return;
        duplicateBlock(activeBlockId);
        return;
      }
      if (event.altKey && !mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (!activeBlockId) return;
        toggleBlockCollapse(activeBlockId);
        return;
      }
      if (event.altKey && !mod) {
        const keyMap: Record<string, ArticleBlock["type"]> = {
          "1": "text",
          "2": "quote",
          "3": "image",
          "4": "audio",
          "5": "video",
          "6": "table",
          "7": "playlist",
        };
        const nextType = keyMap[event.key];
        if (!nextType) return;
        event.preventDefault();
        const lastId = draft.blocks[draft.blocks.length - 1]?.id ?? null;
        insertBlockAfter(activeBlockId || lastId, nextType);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeBlockId, closeInsertMenu, createSnapshot, draft, duplicateBlock, insertBlockAfter, persistDraftNow, t, toggleBlockCollapse]);

  useEffect(() => {
    if (!(editorMode === "edit" && activeBlock?.type === "text")) {
      hideInlineToolbar();
      return;
    }
    const onSelectionChange = () => refreshInlineToolbar();
    const onResize = () => refreshInlineToolbar();
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("resize", onResize);
    };
  }, [activeBlock?.type, editorMode, hideInlineToolbar, refreshInlineToolbar]);

  const saveStatusLabel =
    saveState === "saving"
      ? t("articles.create.save.saving")
      : saveState === "saved"
        ? `${t("articles.create.save.saved")}${lastSavedAt ? ` ${new Date(lastSavedAt).toLocaleTimeString(intlLocale)}` : ""}`
        : saveState === "error"
          ? t("articles.create.save.error")
          : isDirty
            ? t("articles.create.save.dirty")
            : t("articles.create.save.autosave");

  return (
    <main className={`rr-article-main pb-24 lg:pb-12 ${isFocusMode ? "pt-4" : ""}`}>
      {!isFocusMode ? <PageHero title={t("articles.create.pageTitle")} subtitle={t("articles.create.pageSubtitle")} /> : null}

      <section className="rr-article-shell sticky top-2 z-20 mt-4">
        <div className="rr-article-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3 backdrop-blur">
          <div className="text-sm text-[#aab0bb]" data-testid="articles-save-status">
            {t("articles.create.statusPrefix")}:{" "}
            <span className={saveState === "error" ? "text-[#f5a3a3]" : "text-[#e6e8ec]"}>{saveStatusLabel}</span>
            {restoredFromStorage ? <span className="ml-2 text-[#9cc4ff]">• {t("articles.create.statusRestored")}</span> : null}
            {isDirty ? <span className="ml-2 text-[#f8d281]">• {t("articles.create.statusUnsaved")}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border border-[#4a4d55] bg-[#2b2d33] p-1">
              <button
                onClick={() => setEditorMode("edit")}
                data-testid="article-mode-edit-btn"
                className={`rounded-sm px-2 py-1 text-xs ${editorMode === "edit" ? "bg-[#3b669e] text-white" : "text-[#c8cdd6]"}`}
              >
                {t("articles.create.mode.edit")}
              </button>
              <button
                onClick={() => setEditorMode("preview")}
                data-testid="article-mode-preview-btn"
                className={`rounded-sm px-2 py-1 text-xs ${editorMode === "preview" ? "bg-[#3b669e] text-white" : "text-[#c8cdd6]"}`}
              >
                {t("articles.create.mode.preview")}
              </button>
            </div>
            <div className="rounded-md border border-[#4a4d55] bg-[#2b2d33] p-1">
              <button
                onClick={() => setWorkspaceMode("writer")}
                data-testid="article-workspace-writer-btn"
                className={`rounded-sm px-2 py-1 text-xs ${workspaceMode === "writer" ? "bg-[#3b669e] text-white" : "text-[#c8cdd6]"}`}
              >
                {t("articles.create.workspace.writer")}
              </button>
              <button
                onClick={() => setWorkspaceMode("advanced")}
                data-testid="article-workspace-advanced-btn"
                className={`rounded-sm px-2 py-1 text-xs ${workspaceMode === "advanced" ? "bg-[#3b669e] text-white" : "text-[#c8cdd6]"}`}
              >
                {t("articles.create.workspace.advanced")}
              </button>
            </div>
            <button
              data-testid="article-publish-open-btn"
              onClick={() => setIsPublishPanelOpen(true)}
              className="rr-article-btn-accent px-3 py-1.5 text-sm font-semibold"
            >
              {t("articles.create.action.publish")}
            </button>
            <button
              onClick={() => createSnapshot(t("articles.create.snapshot.manualSnapshot"))}
              className="rr-article-btn px-3 py-1.5 text-sm"
              data-testid="article-snapshot-btn"
            >
              {t("articles.create.action.snapshot")}
            </button>
            <button onClick={() => setIsFocusMode((prev) => !prev)} className="rr-article-btn px-3 py-1.5 text-sm">
              {isFocusMode ? t("articles.create.action.focusOff") : t("articles.create.action.focusOn")}
            </button>
            {isAdvancedMode ? (
              <>
                <button onClick={importJsonFromPrompt} className="rr-article-btn px-3 py-1.5 text-sm">
                  {t("articles.create.action.importJson")}
                </button>
                <button onClick={copyJson} className="rr-article-btn px-3 py-1.5 text-sm">
                  {t("articles.create.action.copyJson")}
                </button>
                <button onClick={() => downloadJson(false)} className="rr-article-btn px-3 py-1.5 text-sm">
                  {t("articles.create.action.downloadJson")}
                </button>
                <button onClick={clearDraft} className="rr-article-btn px-3 py-1.5 text-sm">
                  {t("articles.create.action.clear")}
                </button>
              </>
            ) : null}
            <Link href={getArticlesHref(locale)} className="rr-article-btn px-3 py-1.5 text-sm">
              {t("articles.create.action.toCatalog")}
            </Link>
          </div>
          <div className={`w-full text-xs text-[#aab0bb] ${isFocusMode ? "hidden" : ""}`}>
            {t("articles.create.shortcuts")}
          </div>
        </div>
      </section>

      <section className={`rr-article-shell mt-8 grid gap-6 ${isAdvancedMode ? "lg:grid-cols-[320px_1fr]" : ""}`}>
        {isAdvancedMode ? (
          <aside className="space-y-4 rr-article-panel p-4" data-testid="article-advanced-sidebar">
            <div className="text-sm font-semibold text-[#e6e8ec]">{t("articles.create.workspace.advanced")}</div>

            <div className="space-y-2 border-t border-[#3b3f47] pt-3">
              <div className="text-sm font-semibold text-[#c8cdd6]">{t("articles.create.sidebar.addBlock")}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {blockTypeOptions.map((option) => (
                  <button
                    key={`advanced-add-${option.type}`}
                    onClick={() => addBlock(option.type)}
                    className={`rr-article-btn px-2 py-2 ${option.type === "playlist" ? "col-span-2" : ""}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 border-t border-[#3b3f47] pt-3">
              <div className="text-sm font-semibold text-[#c8cdd6]">{t("articles.create.sidebar.service")}</div>
              <button onClick={importJsonFromPrompt} className="w-full rr-article-btn px-3 py-2 text-sm">
                {t("articles.create.action.importJson")}
              </button>
              <button onClick={copyJson} className="w-full rr-article-btn-accent px-3 py-2 text-sm">
                {t("articles.create.action.copyJson")}
              </button>
              <button onClick={() => downloadJson(false)} className="w-full rr-article-btn px-3 py-2 text-sm">
                {t("articles.create.action.downloadJson")}
              </button>
              <button onClick={() => createSnapshot(t("articles.create.snapshot.manualSnapshot"))} className="w-full rr-article-btn px-3 py-2 text-sm">
                {t("articles.create.action.snapshot")}
              </button>
              <Link href={getArticlePreviewHref(locale)} className="block w-full rr-article-btn px-3 py-2 text-center text-sm">
                {t("articles.create.sidebar.openFullPreview")}
              </Link>
              <button onClick={clearDraft} className="w-full rr-article-btn px-3 py-2 text-sm">
                {t("articles.create.sidebar.clearDraft")}
              </button>
              <Link href={getArticlesHref(locale)} className="block w-full rr-article-btn px-3 py-2 text-center text-sm">
                {t("articles.create.sidebar.backToArticles")}
              </Link>
            </div>

            <div className="space-y-2 border-t border-[#3b3f47] pt-3">
              <div className="text-sm font-semibold text-[#c8cdd6]">{t("articles.create.sidebar.history")}</div>
              <select value={selectedHistoryId} onChange={(e) => setSelectedHistoryId(e.currentTarget.value)} className="rr-article-input">
                <option value="">{t("articles.create.sidebar.selectVersion")}</option>
                {draftHistory.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {new Date(entry.savedAt).toLocaleString(intlLocale)} • {entry.label}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={restoreSnapshot}
                  disabled={!selectedHistoryId}
                  className="rr-article-btn px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("articles.create.sidebar.restore")}
                </button>
                <button
                  onClick={() => {
                    if (!selectedHistoryId) return;
                    setDraftHistory((prev) => prev.filter((entry) => entry.id !== selectedHistoryId));
                    setSelectedHistoryId("");
                  }}
                  disabled={!selectedHistoryId}
                  className="rr-article-btn px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("articles.create.sidebar.delete")}
                </button>
              </div>
            </div>
          </aside>
        ) : null}

        <div className={`space-y-6 ${isAdvancedMode ? "" : "rr-article-col"}`}>
          <section className="rr-article-panel p-5 md:p-6">
            <input
              value={draft.title}
              onChange={(e) => {
                const nextTitle = e.currentTarget.value;
                setDraft((prev) => ({
                  ...prev,
                  title: nextTitle,
                  slug: isSlugEditedManually ? prev.slug : slugifyFromTitle(nextTitle),
                }));
              }}
              className="w-full border-none bg-transparent text-[2rem] font-semibold leading-[1.1] tracking-[-0.01em] text-[#f5f7fb] placeholder:text-[#6f7682] focus:outline-none"
              placeholder={t("articles.create.field.titlePlaceholder")}
              data-testid="article-title-input"
            />
            <textarea
              value={draft.subtitle}
              onChange={(e) => setMeta("subtitle", e.currentTarget.value)}
              className="mt-3 min-h-[68px] w-full resize-y border-none bg-transparent text-[1.1rem] leading-7 text-[#bcc3d0] placeholder:text-[#6f7682] focus:outline-none"
              placeholder={t("articles.create.field.subtitlePlaceholder")}
            />
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <input
                value={draft.slug}
                onChange={(e) => {
                  setIsSlugEditedManually(true);
                  setMeta("slug", e.currentTarget.value);
                }}
                className="rr-article-input"
                placeholder={t("articles.create.field.slugPlaceholder")}
                data-testid="article-slug-input"
              />
              <input
                value={draft.coverImage}
                onChange={(e) => setMeta("coverImage", e.currentTarget.value)}
                className="rr-article-input"
                placeholder={t("articles.create.field.coverPlaceholder")}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#8f97a8]">
              <span>
                {t("articles.create.field.slugLabel")}:{" "}
                {isSlugEditedManually ? t("articles.create.field.slugMode.manual") : t("articles.create.field.slugMode.auto")}
              </span>
              <button
                onClick={() => {
                  setIsSlugEditedManually(false);
                  setMeta("slug", slugifyFromTitle(draft.title));
                }}
                className="rounded-sm border border-[#4a4d55] px-2 py-0.5 text-[#cbd3e4] hover:bg-[#2d3340]"
                type="button"
              >
                {t("articles.create.field.slugRefresh")}
              </button>
            </div>
            <label className="mt-2 block text-xs text-[#aab0bb]">
              {t("articles.create.field.coverPosition")}: {Math.round(draft.coverFocusY)}%
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={draft.coverFocusY}
                onChange={(e) => setMeta("coverFocusY", Number(e.currentTarget.value))}
                className="mt-1 w-full"
              />
            </label>
            {slugTaken ? (
              <div className="mt-3 rounded-sm border border-[#6a2d2d] bg-[#392021] px-2 py-1 text-xs text-[#f5b4b4]">
                {t("articles.create.field.slugTaken")}
              </div>
            ) : null}
            <details className="mt-3 rounded-lg border border-[#3b3f47] bg-[#26282e] px-3 py-2 text-sm text-[#bcc3d0]" open={isAdvancedMode}>
              <summary className="cursor-pointer text-[#d8dde8]">{t("articles.create.field.extraFields")}</summary>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <input
                  value={draft.sourceUrl}
                  onChange={(e) => setMeta("sourceUrl", e.currentTarget.value)}
                  className="rr-article-input"
                  placeholder={t("articles.create.field.sourceUrlPlaceholder")}
                />
                <input
                  value={draft.sourceLabel}
                  onChange={(e) => setMeta("sourceLabel", e.currentTarget.value)}
                  className="rr-article-input"
                  placeholder={t("articles.create.field.sourceLabelPlaceholder")}
                />
              </div>
            </details>
          </section>

          {editorMode === "edit" ? (
            <div className="rr-article-panel p-4 md:p-5" data-testid="article-editor-timeline">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-[#d7dbe4]">{t("articles.create.editor.contentTitle")}</div>
                <div className="text-xs text-[#9097a5]">{t("articles.create.editor.contentHint")}</div>
              </div>
              <div className="space-y-2">
                {draft.blocks.length ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openInsertMenu(null, "plus")}
                      className="rounded-md border border-[#495066] bg-[#2d3342] px-2.5 py-1 text-xs text-[#dce5ff] hover:bg-[#374057]"
                    >
                      {t("articles.create.insert.start")}
                    </button>
                  </div>
                ) : null}
                {insertMenu.open && insertMenu.afterId === null && insertMenu.source === "plus" ? (
                  <div className="rounded-md border border-[#495066] bg-[#20242d] p-2">
                    <input
                      value={insertQuery}
                      onChange={(event) => setInsertQuery(event.currentTarget.value)}
                      onKeyDown={handleInsertMenuKeyboard}
                      className="rr-article-input mb-2"
                      placeholder={t("articles.create.insert.searchPlaceholder")}
                      data-rr-insert-search="plus:root"
                    />
                    <div className="flex flex-wrap gap-2">
                      {filteredBlockOptions.map((option, optionIndex) => (
                        <button
                          key={`insert-start-${option.type}`}
                          onClick={() => insertBlockFromMenu(option.type)}
                          className={`rounded-md border px-2 py-1 text-xs ${
                            optionIndex === insertActiveIndex
                              ? "border-[#688bc0] bg-[#3a4a67] text-white"
                              : "border-[#434957] bg-[#2e3340] text-[#d3daea] hover:bg-[#3a4254]"
                          }`}
                        >
                          + {option.label}
                        </button>
                      ))}
                      <button
                        onClick={closeInsertMenu}
                        className="rounded-md border border-[#434957] bg-[#2e3340] px-2 py-1 text-xs text-[#d3daea] hover:bg-[#3a4254]"
                      >
                        {t("articles.create.action.cancel")}
                      </button>
                    </div>
                  </div>
                ) : null}
                {draft.blocks.map((block, index) => {
                  const isActive = activeBlockId === block.id;
                  const isCollapsed = !!collapsedBlocks[block.id];
                  return (
                  <div key={block.id} className="space-y-2" data-testid={`article-block-row-${block.id}`}>
                    <div
                      draggable
                      onDragStart={() => setDragBlockId(block.id)}
                      onDragEnd={() => setDragBlockId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (!dragBlockId || dragBlockId === block.id) return;
                        moveBlockByDrop(dragBlockId, block.id);
                        setDragBlockId(null);
                      }}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                        isActive ? "border-[#5f82aa] bg-[#2f3f5b]" : "border-[#3b3f47] bg-[#252830]"
                      }`}
                    >
                      <button onClick={() => setActiveBlockId(block.id)} className="flex items-center gap-2 text-left text-[#d7dbe4]">
                        <span className="text-[#8e95a3]">⋮⋮</span>
                        <span>{index + 1}. {blockTypeLabel(block.type)}</span>
                        {isActive ? (
                          <span className="rounded bg-[#3b669e] px-1.5 py-0.5 text-[10px] font-semibold text-white">{t("articles.create.block.active")}</span>
                        ) : null}
                        {isCollapsed ? (
                          <span className="rounded bg-[#3d4048] px-1.5 py-0.5 text-[10px] text-[#d4dae6]">{t("articles.create.block.collapsed")}</span>
                        ) : null}
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => duplicateBlock(block.id)}
                          className="rounded-md border border-[#3e4455] bg-[#303645] px-2 py-1 text-xs text-[#d5dbea]"
                          data-testid={`article-block-duplicate-${block.id}`}
                        >
                          {t("articles.create.block.duplicate")}
                        </button>
                        <button
                          onClick={() => toggleBlockCollapse(block.id)}
                          className="rounded-md border border-[#3e4455] bg-[#303645] px-2 py-1 text-xs text-[#d5dbea]"
                          data-testid={`article-block-collapse-${block.id}`}
                        >
                          {isCollapsed ? t("articles.create.block.expand") : t("articles.create.block.collapse")}
                        </button>
                        <button onClick={() => moveBlock(block.id, -1)} className="rounded-md border border-[#3e4455] bg-[#303645] px-2 py-1 text-xs text-[#d5dbea]">
                          ↑
                        </button>
                        <button onClick={() => moveBlock(block.id, 1)} className="rounded-md border border-[#3e4455] bg-[#303645] px-2 py-1 text-xs text-[#d5dbea]">
                          ↓
                        </button>
                        <button
                          onClick={() => removeBlock(block.id)}
                          className="rounded-md border border-[#643a42] bg-[#4a2b31] px-2 py-1 text-xs text-[#ffd7dc]"
                        >
                          {t("articles.create.block.delete")}
                        </button>
                      </div>
                    </div>
                    {!isCollapsed && block.type === "text" ? (
                      <div
                        className={`rounded-md border px-3 py-3 ${
                          isActive ? "border-[#5f82aa] bg-[#1f2533]" : "border-[#3b3f47] bg-[#20232b]"
                        }`}
                      >
                        {isActive ? (
                          <div className="mb-2 flex flex-wrap gap-2">
                            <button onClick={() => setTextBlockFormat("h2")} className="rounded-sm bg-zinc-100 px-2 py-1 text-xs font-semibold">
                              H2
                            </button>
                            <button onClick={() => setTextBlockFormat("h3")} className="rounded-sm bg-zinc-100 px-2 py-1 text-xs font-semibold">
                              H3
                            </button>
                            <button onClick={() => setTextBlockFormat("p")} className="rounded-sm bg-zinc-100 px-2 py-1 text-xs">
                              ¶
                            </button>
                            <button onClick={() => exec("bold")} className="rounded-sm bg-zinc-100 px-2 py-1 text-xs">
                              {t("articles.create.format.bold")}
                            </button>
                            <button onClick={() => exec("italic")} className="rounded-sm bg-zinc-100 px-2 py-1 text-xs italic">
                              {t("articles.create.format.italic")}
                            </button>
                            <button onClick={() => exec("underline")} className="rounded-sm bg-zinc-100 px-2 py-1 text-xs underline">
                              {t("articles.create.format.underline")}
                            </button>
                            <button onClick={() => exec("justifyLeft")} className="rounded-sm bg-zinc-100 px-2 py-1 text-xs">
                              {t("articles.create.format.left")}
                            </button>
                            <button onClick={() => exec("justifyCenter")} className="rounded-sm bg-zinc-100 px-2 py-1 text-xs">
                              {t("articles.create.format.center")}
                            </button>
                            <button onClick={() => exec("justifyRight")} className="rounded-sm bg-zinc-100 px-2 py-1 text-xs">
                              {t("articles.create.format.right")}
                            </button>
                            <button
                              onClick={() => {
                                const href = window.prompt(t("articles.create.prompt.linkUrl"));
                                if (href) exec("createLink", href);
                              }}
                              className="rounded-sm bg-zinc-100 px-2 py-1 text-xs"
                            >
                              {t("articles.create.format.link")}
                            </button>
                            <select
                              value={block.fontScale ?? "md"}
                              onChange={(e) =>
                                updateBlock(block.id, (b) =>
                                  b.type === "text" ? { ...b, fontScale: e.currentTarget.value as "sm" | "md" | "lg" } : b
                                )
                              }
                              className="rounded-sm border border-zinc-200 bg-white px-2 py-1 text-xs"
                            >
                              <option value="sm">{t("articles.create.format.sizeSm")}</option>
                              <option value="md">{t("articles.create.format.sizeMd")}</option>
                              <option value="lg">{t("articles.create.format.sizeLg")}</option>
                            </select>
                            <select
                              value={block.align ?? "left"}
                              onChange={(e) =>
                                updateBlock(block.id, (b) =>
                                  b.type === "text" ? { ...b, align: e.currentTarget.value as ArticleTextAlign } : b
                                )
                              }
                              className="rounded-sm border border-zinc-200 bg-white px-2 py-1 text-xs"
                            >
                              <option value="left">{t("articles.create.format.alignLeft")}</option>
                              <option value="center">{t("articles.create.format.alignCenter")}</option>
                              <option value="right">{t("articles.create.format.alignRight")}</option>
                            </select>
                          </div>
                        ) : null}

                        {insertMenu.open && insertMenu.source === "slash" && insertMenu.afterId === block.id ? (
                          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-sm border border-zinc-200 bg-zinc-50 p-2">
                            <div className="text-xs text-zinc-600">{t("articles.create.slashInsert")}</div>
                            <input
                              value={insertQuery}
                              onChange={(event) => setInsertQuery(event.currentTarget.value)}
                              onKeyDown={handleInsertMenuKeyboard}
                              className="w-full rounded-sm border border-zinc-200 px-2 py-1 text-xs"
                              placeholder={t("articles.create.insert.searchPlaceholder")}
                              data-rr-insert-search={`slash:${block.id}`}
                            />
                            {filteredBlockOptions.map((option, optionIndex) => (
                              <button
                                key={`slash-${block.id}-${option.type}`}
                                onClick={() => insertBlockFromMenu(option.type)}
                                className={`rounded-sm px-2 py-1 text-xs ${
                                  optionIndex === insertActiveIndex
                                    ? "bg-[#3a4a67] text-white"
                                    : "bg-white text-zinc-700 hover:bg-zinc-100"
                                }`}
                              >
                                / {option.label}
                              </button>
                            ))}
                            <button onClick={closeInsertMenu} className="rounded-sm bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100">
                              {t("articles.create.action.cancel")}
                            </button>
                          </div>
                        ) : null}

                        <div className="relative">
                          {inlineToolbar.visible && isActive ? (
                            <div
                              className="absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md border border-[#2f3138] bg-[#1f2024] px-1.5 py-1 shadow-lg"
                              style={{ left: `${inlineToolbar.left}px`, top: `${inlineToolbar.top}px` }}
                            >
                              <button
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => runInlineAction("bold")}
                                className="rounded-sm px-1.5 py-1 text-xs font-semibold text-white hover:bg-white/10"
                              >
                                B
                              </button>
                              <button
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => runInlineAction("italic")}
                                className="rounded-sm px-1.5 py-1 text-xs italic text-white hover:bg-white/10"
                              >
                                I
                              </button>
                              <button
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => runInlineAction("underline")}
                                className="rounded-sm px-1.5 py-1 text-xs underline text-white hover:bg-white/10"
                              >
                                U
                              </button>
                              <button
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => runInlineAction("link")}
                                className="rounded-sm px-1.5 py-1 text-xs text-white hover:bg-white/10"
                              >
                                {t("articles.create.format.link")}
                              </button>
                              <button
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => runInlineAction("unlink")}
                                className="rounded-sm px-1.5 py-1 text-xs text-white hover:bg-white/10"
                              >
                                ×
                              </button>
                            </div>
                          ) : null}
                          <div
                            ref={(node) => {
                              if (activeBlockId === block.id) {
                                textEditorRef.current = node;
                              }
                            }}
                            contentEditable
                            suppressContentEditableWarning
                            onFocus={() => setActiveBlockId(block.id)}
                            onClick={() => setActiveBlockId(block.id)}
                            onKeyDown={(event) => {
                              const slashMenuActive =
                                insertMenu.open && insertMenu.source === "slash" && insertMenu.afterId === block.id;
                              if (slashMenuActive) {
                                if (handleInsertMenuKeyboard(event)) return;
                                const modKey = event.metaKey || event.ctrlKey || event.altKey;
                                if (!modKey && event.key === "Backspace") {
                                  event.preventDefault();
                                  setInsertQuery((prev) => prev.slice(0, -1));
                                  return;
                                }
                                if (!modKey && event.key.length === 1) {
                                  event.preventDefault();
                                  setInsertQuery((prev) => `${prev}${event.key}`.trimStart());
                                  return;
                                }
                              }
                              const mod = event.metaKey || event.ctrlKey;
                              if (mod && event.key.toLowerCase() === "b") {
                                event.preventDefault();
                                runInlineAction("bold");
                                return;
                              }
                              if (mod && event.key.toLowerCase() === "i") {
                                event.preventDefault();
                                runInlineAction("italic");
                                return;
                              }
                              if (mod && event.key.toLowerCase() === "k") {
                                event.preventDefault();
                                runInlineAction("link");
                                return;
                              }
                              if (mod && event.key.toLowerCase() === "u") {
                                event.preventDefault();
                                runInlineAction("underline");
                                return;
                              }
                              if (event.key === "Tab") {
                                event.preventDefault();
                                const textBlocks = draft.blocks.filter((item) => item.type === "text");
                                const currentTextIndex = textBlocks.findIndex((item) => item.id === block.id);
                                if (currentTextIndex < 0) return;
                                const nextIndex = event.shiftKey ? currentTextIndex - 1 : currentTextIndex + 1;
                                const nextBlock = textBlocks[nextIndex];
                                if (!nextBlock) return;
                                focusTextBlockEditor(nextBlock.id);
                                return;
                              }
                              if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
                                event.preventDefault();
                                openInsertMenu(block.id, "slash");
                                return;
                              }
                              window.setTimeout(() => refreshInlineToolbar(), 0);
                            }}
                            onKeyUp={() => refreshInlineToolbar()}
                            onMouseUp={() => refreshInlineToolbar()}
                            onBlur={() => hideInlineToolbar()}
                            onInput={(e) => {
                              const html = (e.currentTarget as HTMLDivElement).innerHTML;
                              updateBlock(block.id, (b) => (b.type === "text" ? { ...b, html } : b));
                            }}
                            dangerouslySetInnerHTML={{ __html: block.html }}
                            data-rr-text-editor={block.id}
                            className="min-h-[140px] rounded-md border border-zinc-200 bg-white p-3 text-base leading-7 text-zinc-800"
                          />
                        </div>
                      </div>
                    ) : null}
                    {isCollapsed && block.type === "text" ? (
                      <div className="rounded-md border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-xs text-[#9aa3b2]">
                        {(block.html ?? "")
                          .replace(/<[^>]+>/g, " ")
                          .replace(/\s+/g, " ")
                          .trim()
                          .slice(0, 180) || t("articles.create.block.emptyText")}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openInsertMenu(block.id, "plus")}
                        className="rounded-md border border-[#495066] bg-[#2d3342] px-2 py-1 text-xs text-[#dce5ff] hover:bg-[#374057]"
                      >
                        +
                      </button>
                      {insertMenu.open && insertMenu.afterId === block.id && insertMenu.source === "plus" ? (
                        <div className="rounded-md border border-[#495066] bg-[#20242d] p-2">
                          <input
                            value={insertQuery}
                            onChange={(event) => setInsertQuery(event.currentTarget.value)}
                            onKeyDown={handleInsertMenuKeyboard}
                            className="rr-article-input mb-2"
                            placeholder={t("articles.create.insert.searchPlaceholder")}
                            data-rr-insert-search={`plus:${block.id}`}
                          />
                          <div className="flex flex-wrap gap-2">
                            {filteredBlockOptions.map((option, optionIndex) => (
                              <button
                                key={`insert-${block.id}-${option.type}`}
                                onClick={() => insertBlockFromMenu(option.type)}
                                className={`rounded-md border px-2 py-1 text-xs ${
                                  optionIndex === insertActiveIndex
                                    ? "border-[#688bc0] bg-[#3a4a67] text-white"
                                    : "border-[#434957] bg-[#2e3340] text-[#d3daea] hover:bg-[#3a4254]"
                                }`}
                              >
                                + {option.label}
                              </button>
                            ))}
                            <button
                              onClick={closeInsertMenu}
                              className="rounded-md border border-[#434957] bg-[#2e3340] px-2 py-1 text-xs text-[#d3daea] hover:bg-[#3a4254]"
                            >
                              {t("articles.create.action.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )})}
                {draft.blocks.length ? (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => openInsertMenu(draft.blocks[draft.blocks.length - 1]?.id ?? null, "plus")}
                      className="rounded-md border border-[#495066] bg-[#2d3342] px-2.5 py-1 text-xs text-[#dce5ff] hover:bg-[#374057]"
                    >
                      {t("articles.create.insert.end")}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {editorMode === "edit" && activeBlock && activeBlock.type !== "text" && !collapsedBlocks[activeBlock.id] ? (
            <section className="rr-article-panel p-4">
              <div className="mb-3 text-sm font-semibold text-[#d7dbe4]">
                {t("articles.create.block.editing")}: {blockTypeLabel(activeBlock.type)}
              </div>

              {activeBlock.type === "quote" ? (
                <div className="space-y-2">
                  <textarea
                    value={activeBlock.text}
                    onChange={(e) => updateBlock(activeBlock.id, (b) => (b.type === "quote" ? { ...b, text: e.currentTarget.value } : b))}
                    className="w-full rounded-sm border border-zinc-200 bg-white p-2 text-sm"
                    rows={4}
                  />
                  <input
                    value={activeBlock.author ?? ""}
                    onChange={(e) => updateBlock(activeBlock.id, (b) => (b.type === "quote" ? { ...b, author: e.currentTarget.value } : b))}
                    className="rr-article-input"
                    placeholder={t("articles.create.field.quoteAuthorPlaceholder")}
                  />
                </div>
              ) : null}

              {activeBlock.type === "image" ? (
                <MediaEditor
                  block={activeBlock}
                  onChange={(patch) =>
                    updateBlock(activeBlock.id, (b) =>
                      b.type === "image" ? ({ ...b, ...(patch as Partial<ArticleImageBlock>) } as ArticleImageBlock) : b
                    )
                  }
                />
              ) : null}

              {activeBlock.type === "video" ? (
                <MediaEditor
                  block={activeBlock}
                  onChange={(patch) =>
                    updateBlock(activeBlock.id, (b) =>
                      b.type === "video" ? ({ ...b, ...(patch as Partial<ArticleVideoBlock>) } as ArticleVideoBlock) : b
                    )
                  }
                />
              ) : null}

              {activeBlock.type === "audio" ? (
                <div className="space-y-2">
                  <MediaUploadControl
                    label={t("articles.create.audio.upload")}
                    accept="audio/*"
                    onFile={(file) =>
                      updateBlock(activeBlock.id, (b) =>
                        b.type === "audio"
                          ? { ...b, src: URL.createObjectURL(file), title: b.title || file.name.replace(/\.[^.]+$/, "") }
                          : b
                      )
                    }
                  />
                  <input
                    value={activeBlock.src}
                    onChange={(e) => updateBlock(activeBlock.id, (b) => (b.type === "audio" ? { ...b, src: e.currentTarget.value } : b))}
                    className="rr-article-input"
                    placeholder={t("articles.create.audio.urlPlaceholder")}
                  />
                  <input
                    value={activeBlock.title}
                    onChange={(e) => updateBlock(activeBlock.id, (b) => (b.type === "audio" ? { ...b, title: e.currentTarget.value } : b))}
                    className="rr-article-input"
                    placeholder={t("articles.create.audio.titlePlaceholder")}
                  />
                  <input
                    value={activeBlock.caption ?? ""}
                    onChange={(e) => updateBlock(activeBlock.id, (b) => (b.type === "audio" ? { ...b, caption: e.currentTarget.value } : b))}
                    className="rr-article-input"
                    placeholder={t("articles.create.audio.captionPlaceholder")}
                  />
                </div>
              ) : null}

              {activeBlock.type === "table" ? (
                <TableEditor
                  block={activeBlock}
                  onChange={(next) => updateBlock(activeBlock.id, (b) => (b.type === "table" ? next : b))}
                />
              ) : null}

              {activeBlock.type === "playlist" ? (
                <div className="space-y-2">
                  <input
                    value={activeBlock.title ?? ""}
                    onChange={(e) => updateBlock(activeBlock.id, (b) => (b.type === "playlist" ? { ...b, title: e.currentTarget.value } : b))}
                    className="rr-article-input"
                    placeholder={t("articles.create.playlist.titlePlaceholder")}
                  />
                  <div className="max-h-56 space-y-1 overflow-auto rounded-sm border border-zinc-200 bg-zinc-50 p-2">
                    {playlistOptions.map((song) => {
                      const checked = activeBlock.songSlugs.includes(song.slug);
                      return (
                        <label key={song.slug} className="flex items-center gap-2 text-sm text-zinc-800">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              updateBlock(activeBlock.id, (b) =>
                                b.type === "playlist"
                                  ? {
                                      ...b,
                                      songSlugs: checked ? b.songSlugs.filter((s) => s !== song.slug) : [...b.songSlugs, song.slug],
                                    }
                                  : b
                              )
                            }
                          />
                          {song.title}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {editorMode === "preview" ? (
            <section className="rr-article-panel p-4">
              <div className="mb-3 text-sm font-semibold text-[#d7dbe4]">{t("articles.create.preview.title")}</div>

              {draft.coverImage ? (
                <div className="relative mb-5 h-64 overflow-hidden rounded-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={draft.coverImage}
                    alt={draft.title || t("articles.create.preview.coverAlt")}
                    className="h-full w-full object-cover"
                    style={{ objectPosition: `50% ${draft.coverFocusY}%` }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <div className="pointer-events-none absolute inset-3 rounded border border-dashed border-white/40" />
                  <div className="pointer-events-none absolute left-0 right-0 top-[35%] border-t border-white/25" />
                  <div className="pointer-events-none absolute left-0 right-0 top-[65%] border-t border-white/25" />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <div className="text-2xl font-semibold text-white">{draft.title || t("articles.create.preview.fallbackTitle")}</div>
                    <div className="text-sm text-white/85">{draft.subtitle}</div>
                  </div>
                </div>
              ) : null}

              <ArticleBlocksRenderer
                blocks={draft.blocks}
                tone="light"
                playlistLinkMode="text"
                className="space-y-8 text-[17px] leading-8"
              />
            </section>
          ) : null}
        </div>
      </section>

      {isPublishPanelOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={() => setIsPublishPanelOpen(false)}>
          <aside
            data-testid="article-publish-panel"
            className="h-full w-full max-w-[420px] overflow-auto border-l border-[#3b3f47] bg-[#24262a] p-4 text-[#e6e8ec]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 data-testid="article-publish-panel-title" className="text-lg font-semibold">{t("articles.create.publish.title")}</h2>
              <button onClick={() => setIsPublishPanelOpen(false)} className="rr-article-btn px-2 py-1 text-xs">
                {t("articles.create.publish.close")}
              </button>
            </div>
            <div className="space-y-3">
              <div className="rounded-sm border border-[#4a4d55] bg-[#2f3138] px-2 py-1.5 text-xs text-[#c8cdd6]">
                {t("articles.create.publish.pathLabel")}: <span className="text-[#e6e8ec]">{articlePathPreview}</span>
              </div>
              <select
                data-testid="article-publish-status-select"
                value={publishSettings.status}
                onChange={(e) =>
                  setPublishSettings((prev) => ({ ...prev, status: e.currentTarget.value as DraftPublishStatus }))
                }
                className="rr-article-input"
              >
                <option value="published">{t("articles.create.publish.status.published")}</option>
                <option value="scheduled">{t("articles.create.publish.status.scheduled")}</option>
                <option value="draft">{t("articles.create.publish.status.draft")}</option>
              </select>
              <select
                data-testid="article-publish-visibility-select"
                value={publishSettings.visibility}
                onChange={(e) =>
                  setPublishSettings((prev) => ({ ...prev, visibility: e.currentTarget.value as PublishSettings["visibility"] }))
                }
                className="rr-article-input"
              >
                <option value="public">{t("articles.create.publish.visibility.public")}</option>
                <option value="link">{t("articles.create.publish.visibility.link")}</option>
              </select>
              <input
                data-testid="article-publish-date-input"
                type="date"
                value={publishSettings.publishedAt}
                onChange={(e) => setPublishSettings((prev) => ({ ...prev, publishedAt: e.currentTarget.value }))}
                className="rr-article-input"
              />
              <input
                data-testid="article-publish-canonical-input"
                value={publishSettings.canonicalUrl}
                onChange={(e) => setPublishSettings((prev) => ({ ...prev, canonicalUrl: e.currentTarget.value }))}
                className="rr-article-input"
                placeholder={t("articles.create.publish.canonicalPlaceholder")}
              />
              <div
                data-testid="article-publish-readiness"
                className={`rounded-sm border px-2 py-1 text-xs ${
                  publishReady ? "border-[#2d5f33] bg-[#1f3222] text-[#9fe3ac]" : "border-[#4a4d55] bg-[#2f3138] text-[#c8cdd6]"
                }`}
              >
                {publishReady
                  ? publishSettings.status === "scheduled"
                    ? t("articles.create.publish.ready.scheduled")
                    : publishSettings.status === "draft"
                      ? t("articles.create.publish.ready.draft")
                      : t("articles.create.publish.ready.published")
                  : t("articles.create.publish.ready.missing")}
              </div>
              <div className="rounded-sm border border-[#3b3f47] bg-[#2b2d33] px-2 py-2">
                <div className="mb-1 text-xs uppercase tracking-[0.06em] text-[#9aa3b2]">{t("articles.create.publish.checklistTitle")}</div>
                <div className="space-y-1 text-xs">
                  {publishChecklist.map((item) => (
                    <div key={item.label} className={item.ok ? "text-[#9fe3ac]" : "text-[#f5b4b4]"}>
                      {item.ok ? "✓" : "•"} {item.label}
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={copyPublishPackage}
                disabled={!publishReady}
                className="w-full rr-article-btn-accent px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="article-publish-copy-package-btn"
              >
                {t("articles.create.publish.copyPackage")}
              </button>
              <button
                onClick={() => {
                  downloadJson(true);
                  markAsPublished(draft.slug || "new-article");
                  createSnapshot(t("articles.create.snapshot.publishPackage"));
                }}
                disabled={!publishReady}
                className="w-full rr-article-btn px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="article-publish-save-download-btn"
              >
                {t("articles.create.publish.saveAndDownload")}
              </button>
              <button
                onClick={() => {
                  setIsPublishPanelOpen(false);
                  setEditorMode("preview");
                }}
                className="w-full rr-article-btn px-3 py-2 text-sm"
                data-testid="article-publish-open-preview-btn"
              >
                {t("articles.create.publish.openPreviewMode")}
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#3b3f47] bg-[#24262a]/95 p-2 backdrop-blur lg:hidden">
        <div className="grid grid-cols-4 gap-2 text-xs">
          <button
            onClick={() => setEditorMode((prev) => (prev === "edit" ? "preview" : "edit"))}
            className="rr-article-btn px-2 py-2"
            data-testid="article-mobile-toggle-mode-btn"
          >
            {editorMode === "edit" ? t("articles.create.mode.preview") : t("articles.create.mode.edit")}
          </button>
          <button
            onClick={() => {
              setInsertQuery("");
              setIsMobileInsertSheetOpen(true);
            }}
            className="rr-article-btn px-2 py-2"
            data-testid="article-mobile-add-block-btn"
          >
            {t("articles.create.mobile.addBlock")}
          </button>
          <button
            onClick={() => setIsPublishPanelOpen(true)}
            className="rr-article-btn-accent px-2 py-2"
            data-testid="article-mobile-open-publish-btn"
          >
            {t("articles.create.action.publish")}
          </button>
          <button
            onClick={() => {
              setSaveState("saving");
              if (persistDraftNow(draft)) {
                createSnapshot(t("articles.create.snapshot.manualSave"));
              }
            }}
            className="rr-article-btn px-2 py-2"
            data-testid="article-mobile-save-btn"
          >
            {t("articles.create.mobile.save")}
          </button>
        </div>
      </div>

      {isMobileInsertSheetOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => {
            setInsertQuery("");
            setIsMobileInsertSheetOpen(false);
          }}
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-xl border-t border-[#3b3f47] bg-[#24262a] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 text-sm font-semibold text-[#e6e8ec]">{t("articles.create.mobile.insertTitle")}</div>
            <input
              value={insertQuery}
              onChange={(event) => setInsertQuery(event.currentTarget.value)}
              onKeyDown={handleInsertMenuKeyboard}
              className="rr-article-input mb-3"
              placeholder={t("articles.create.mobile.insertSearchPlaceholder")}
              data-rr-insert-search={`plus:${activeBlockId || "root"}`}
            />
            <div className="grid grid-cols-2 gap-2">
              {filteredBlockOptions.map((option, optionIndex) => (
                <button
                  key={`mobile-insert-${option.type}`}
                  onClick={() => {
                    const lastId = draft.blocks[draft.blocks.length - 1]?.id ?? null;
                    insertBlockAfter(activeBlockId || lastId, option.type);
                    setIsMobileInsertSheetOpen(false);
                  }}
                  className={`rr-article-btn px-3 py-2 text-sm ${optionIndex === insertActiveIndex ? "border-[#688bc0] bg-[#3a4a67] text-white" : ""}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function MediaEditor({
  block,
  onChange,
}: {
  block: ArticleImageBlock | ArticleVideoBlock;
  onChange: (patch: {
    src?: string;
    title?: string;
    caption?: string;
    align?: ArticleMediaAlign;
    size?: ArticleMediaSize;
    wrap?: boolean;
  }) => void;
}) {
  const { t } = useI18n();
  const accept = "title" in block ? "video/*" : "image/*";
  const uploadLabel = "title" in block ? t("articles.create.media.uploadVideo") : t("articles.create.media.uploadImage");
  return (
    <div className="space-y-2">
      <MediaUploadControl
        label={uploadLabel}
        accept={accept}
        onFile={(file) => {
          onChange({
            src: URL.createObjectURL(file),
            ...("title" in block && !block.title ? { title: file.name.replace(/\.[^.]+$/, "") } : {}),
          });
        }}
      />
      <input
        value={block.src}
        onChange={(e) => onChange({ src: e.currentTarget.value })}
        className="rr-article-input"
        placeholder={t("articles.create.media.urlPlaceholder")}
      />
      {"title" in block ? (
        <input
          value={block.title ?? ""}
          onChange={(e) => onChange({ title: e.currentTarget.value })}
          className="rr-article-input"
          placeholder={t("articles.create.media.videoTitlePlaceholder")}
        />
      ) : null}
      <input
        value={block.caption ?? ""}
        onChange={(e) => onChange({ caption: e.currentTarget.value })}
        className="rr-article-input"
        placeholder={t("articles.create.media.captionPlaceholder")}
      />
      <div className="grid grid-cols-3 gap-2">
        <select
          value={block.align ?? "center"}
          onChange={(e) => onChange({ align: e.currentTarget.value as ArticleMediaAlign })}
          className="rounded-sm border border-zinc-200 bg-white px-2 py-2 text-sm"
        >
          <option value="left">{t("articles.create.media.align.left")}</option>
          <option value="center">{t("articles.create.media.align.center")}</option>
          <option value="right">{t("articles.create.media.align.right")}</option>
          <option value="full">{t("articles.create.media.align.full")}</option>
        </select>
        <select
          value={block.size ?? "md"}
          onChange={(e) => onChange({ size: e.currentTarget.value as ArticleMediaSize })}
          className="rounded-sm border border-zinc-200 bg-white px-2 py-2 text-sm"
        >
          <option value="sm">{t("articles.create.media.size.sm")}</option>
          <option value="md">{t("articles.create.media.size.md")}</option>
          <option value="lg">{t("articles.create.media.size.lg")}</option>
        </select>
        <label className="flex items-center gap-2 rounded-sm border border-zinc-200 bg-white px-2 py-2 text-sm">
          <input type="checkbox" checked={!!block.wrap} onChange={(e) => onChange({ wrap: e.currentTarget.checked })} />
          {t("articles.create.media.wrap")}
        </label>
      </div>
    </div>
  );
}

function MediaUploadControl({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
}) {
  const { t } = useI18n();
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        onFile(file);
      }}
      className={`rounded-sm border px-3 py-2 text-sm ${
        dragOver ? "border-[#5f82aa] bg-[#eef4fb]" : "border-zinc-200 bg-zinc-50"
      }`}
    >
      <label className="flex cursor-pointer items-center justify-between gap-2">
        <span className="text-zinc-700">{label}</span>
        <span className="rounded-sm bg-white px-2 py-1 text-xs text-zinc-600">{t("articles.create.media.chooseFile")}</span>
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            onFile(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <div className="mt-1 text-xs text-zinc-500">{t("articles.create.media.dropHint")}</div>
    </div>
  );
}

function TableEditor({ block, onChange }: { block: ArticleTableBlock; onChange: (next: ArticleTableBlock) => void }) {
  const { t } = useI18n();
  const rowCount = block.rows.length;
  const colCount = block.rows[0]?.length ?? 0;

  const resize = (rows: number, cols: number) => {
    const safeRows = Math.max(1, Math.min(12, rows));
    const safeCols = Math.max(1, Math.min(8, cols));
    const next: string[][] = Array.from({ length: safeRows }, (_, r) =>
      Array.from({ length: safeCols }, (_, c) => block.rows[r]?.[c] ?? "")
    );
    onChange({ ...block, rows: next });
  };

  return (
    <div className="space-y-2">
      <input
        value={block.caption ?? ""}
        onChange={(e) => onChange({ ...block, caption: e.currentTarget.value })}
        className="rr-article-input"
        placeholder={t("articles.create.table.captionPlaceholder")}
      />
      <div className="grid grid-cols-3 gap-2">
        <label className="rounded-sm border border-zinc-200 bg-white px-2 py-2 text-sm">
          {t("articles.create.table.rows")}
          <input
            type="number"
            min={1}
            max={12}
            value={rowCount}
            onChange={(e) => resize(Number(e.currentTarget.value), colCount)}
            className="mt-1 w-full rounded-sm border border-zinc-200 px-2 py-1"
          />
        </label>
        <label className="rounded-sm border border-zinc-200 bg-white px-2 py-2 text-sm">
          {t("articles.create.table.cols")}
          <input
            type="number"
            min={1}
            max={8}
            value={colCount}
            onChange={(e) => resize(rowCount, Number(e.currentTarget.value))}
            className="mt-1 w-full rounded-sm border border-zinc-200 px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 rounded-sm border border-zinc-200 bg-white px-2 py-2 text-sm">
          <input
            type="checkbox"
            checked={!!block.bordered}
            onChange={(e) => onChange({ ...block, bordered: e.currentTarget.checked })}
          />
          {t("articles.create.table.visible")}
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={`row-${r}`}>
                {row.map((cell, c) => (
                  <td key={`cell-${r}-${c}`} className="border border-zinc-200 p-1">
                    <input
                      value={cell}
                      onChange={(e) =>
                        onChange({
                          ...block,
                          rows: block.rows.map((rr, rIdx) =>
                            rr.map((cc, cIdx) => (rIdx === r && cIdx === c ? e.currentTarget.value : cc))
                          ),
                        })
                      }
                      className="w-full rounded-sm border border-zinc-200 px-2 py-1"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
