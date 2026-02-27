"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import EngagementTracker from "./analytics/EngagementTracker";
import CommentsPanel from "./community/CommentsPanel";
import ContentReactionsBar from "./community/ContentReactionsBar";
import MultiTrackPlayer from "./MultiTrackPlayer";
import { useI18n } from "./i18n/I18nProvider";
import { getSoundTrackHref } from "../lib/i18n/routing";

type TabKey = "text" | "expanded" | "notes" | "about";

const defaultContent: Record<TabKey, string[]> = {
  text: [],
  expanded: [],
  notes: [],
  about: [],
};

type SongTabsProps = {
  content?: Record<TabKey, string[]>;
  defaultTab?: TabKey;
  showPlayer?: boolean;
  showCommunity?: boolean;
  communityContentId?: string;
  communityContentTitle?: string;
  communityContentHref?: string;
  communityTone?: "light" | "dark";
  textColumns?: string[][];
  textColumnGroupSizes?: number[];
  textColumnGroupPatterns?: number[][];
  textGroupSize?: number;
  textGroupGapClassName?: string;
  textLineClassName?: string;
  textEmptyLineClassName?: string;
  textItalicLines?: string[];
  storageVersion?: string;
  showTextKindsHint?: boolean;
};

export default function SongTabs({
  content = defaultContent,
  defaultTab = "text",
  showPlayer = true,
  showCommunity = true,
  communityContentId,
  communityContentTitle,
  communityContentHref,
  communityTone = "light",
  textColumns,
  textColumnGroupSizes,
  textColumnGroupPatterns,
  textGroupSize = 0,
  textGroupGapClassName = "mt-2",
  textLineClassName = "",
  textEmptyLineClassName = "h-4",
  textItalicLines,
  storageVersion = "v2",
  showTextKindsHint = true,
}: SongTabsProps) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);
  const [editMode, setEditMode] = useState(false);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [contentDraft, setContentDraft] = useState<Record<TabKey, string[]>>(content);
  const [textColumnsDraft, setTextColumnsDraft] = useState<string[][] | undefined>(textColumns);
  const [resolvedTitle, setResolvedTitle] = useState<string>("");
  const textColumnCount = (textColumnsDraft ?? textColumns)?.length ?? 0;
  const italicLineSet = useMemo(() => new Set((textItalicLines ?? []).map((line) => line.trim())), [textItalicLines]);
  const tabLabels = useMemo<Record<TabKey, string>>(
    () => ({
      text: t("songTabs.tab.text"),
      expanded: t("songTabs.tab.expanded"),
      notes: t("songTabs.tab.notes"),
      about: t("songTabs.tab.about"),
    }),
    [t]
  );
  const routeSlug = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    const soundIdx = segments.findIndex((segment) => segment === "sound");
    if (soundIdx < 0) return null;
    const slug = segments[soundIdx + 1];
    return slug?.trim() || null;
  }, [pathname]);
  const effectiveContentId = communityContentId || routeSlug || "";
  const effectiveContentTitle = communityContentTitle || resolvedTitle || undefined;
  const effectiveContentHref = communityContentHref || (effectiveContentId ? getSoundTrackHref(locale, effectiveContentId) : undefined);

  useEffect(() => {
    setContentDraft(content);
  }, [content]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const h1 = document.querySelector("h1");
    const text = h1?.textContent?.trim();
    if (text) setResolvedTitle(text);
  }, [pathname]);

  useEffect(() => {
    setTextColumnsDraft(textColumns);
  }, [textColumns]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setStorageKey(`rr_songtabs_edit:${storageVersion}:${window.location.pathname}`);
  }, [storageVersion]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { content?: Record<TabKey, string[]>; textColumns?: string[][] };
      if (parsed.content) setContentDraft(parsed.content);
      if (parsed.textColumns) setTextColumnsDraft(parsed.textColumns);
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ content: contentDraft, textColumns: textColumnsDraft }));
    } catch {}
  }, [contentDraft, storageKey, textColumnsDraft]);

  const rows = useMemo(() => contentDraft[activeTab], [activeTab, contentDraft]);
  const groupedTextRows = useMemo(() => {
    if (activeTab !== "text" || textGroupSize <= 0) return null;
    const compactRows = rows.filter((line) => line.trim().length > 0);
    const out: string[][] = [];
    for (let i = 0; i < compactRows.length; i += textGroupSize) {
      out.push(compactRows.slice(i, i + textGroupSize));
    }
    return out;
  }, [activeTab, rows, textGroupSize]);

  const setRowValue = (tab: TabKey, index: number, value: string) => {
    setContentDraft((prev) => {
      const nextRows = [...prev[tab]];
      nextRows[index] = value;
      return { ...prev, [tab]: nextRows };
    });
  };

  const setTextColumnValue = (columnIndex: number, lineIndex: number, value: string) => {
    setTextColumnsDraft((prev) => {
      if (!prev) return prev;
      const next = prev.map((col) => [...col]);
      next[columnIndex][lineIndex] = value;
      return next;
    });
  };

  const resetEdits = () => {
    setContentDraft(content);
    setTextColumnsDraft(textColumns);
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    }
  };

  return (
    <section className="rr-container mt-8">
      {showCommunity && effectiveContentId ? (
        <div className="mb-5 space-y-3">
          <EngagementTracker contentType="sound" contentId={effectiveContentId} mode="page" />
          <ContentReactionsBar
            contentType="sound"
            contentId={effectiveContentId}
            contentTitle={effectiveContentTitle}
            contentHref={effectiveContentHref}
            tone={communityTone}
            testId={`sound-reactions-${effectiveContentId}`}
          />
          <CommentsPanel
            contentType="sound"
            contentId={effectiveContentId}
            contentTitle={effectiveContentTitle}
            contentHref={effectiveContentHref}
            testId={`sound-comments-${effectiveContentId}`}
          />
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        {(Object.keys(tabLabels) as TabKey[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-sm px-4 py-2 text-sm ${
              activeTab === tab ? "rr-primary-btn" : "bg-[#dedede] text-zinc-700 hover:bg-[#d3d3d3]"
            }`}
          >
            {tabLabels[tab]}
          </button>
        ))}
        <button
          onClick={() => setEditMode((v) => !v)}
          className={`rounded-sm px-4 py-2 text-sm ${editMode ? "rr-primary-btn" : "bg-[#dedede] text-zinc-700 hover:bg-[#d3d3d3]"}`}
        >
          {editMode ? t("songTabs.done") : t("songTabs.edit")}
        </button>
        {editMode && (
          <button
            onClick={resetEdits}
            className="rounded-sm bg-[#dedede] px-4 py-2 text-sm text-zinc-700 hover:bg-[#d3d3d3]"
          >
            {t("songTabs.reset")}
          </button>
        )}
      </div>

      {showTextKindsHint && !editMode && (
        <div className="mb-5 rounded-md border border-zinc-200 bg-white/85 px-4 py-3 text-sm text-zinc-700">
          <p><strong>{t("songTabs.kinds.title")}</strong></p>
          <p className="mt-1">{t("songTabs.kinds.body")}</p>
        </div>
      )}

      {activeTab === "text" && (textColumnsDraft ?? textColumns)?.length ? (
        <div className={`mb-8 grid gap-6 ${textColumnCount === 2 ? "md:grid-cols-2" : textColumnCount === 1 ? "md:grid-cols-1" : "md:grid-cols-3"}`}>
          {(textColumnsDraft ?? textColumns ?? []).map((column, colIdx) => {
            const groupSize = textColumnGroupSizes?.[colIdx] ?? textGroupSize;
            const groupPattern = textColumnGroupPatterns?.[colIdx];
            if (editMode) {
              return (
                <div key={`col-${colIdx}`} className="space-y-2 text-base leading-7 text-zinc-700">
                  {column.map((line, lineIdx) => (
                    <textarea
                      key={`col-${colIdx}-line-${lineIdx}`}
                      value={line}
                      onChange={(e) => setTextColumnValue(colIdx, lineIdx, e.currentTarget.value)}
                      className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm leading-6 text-zinc-800"
                      rows={line.length > 64 ? 2 : 1}
                    />
                  ))}
                </div>
              );
            }

            if (groupPattern?.length) {
              const compact = column.filter((line) => line.trim().length > 0);
              const groups: string[][] = [];
              let cursor = 0;
              let patternIdx = 0;
              while (cursor < compact.length) {
                const fallback = groupPattern[groupPattern.length - 1] ?? 0;
                const step = groupPattern[patternIdx] ?? fallback;
                if (step <= 0) break;
                groups.push(compact.slice(cursor, cursor + step));
                cursor += step;
                patternIdx += 1;
              }
              return (
                <div key={`col-${colIdx}`} className="text-base leading-7 text-zinc-700">
                  {groups.map((group, groupIdx) => (
                    <div key={`col-${colIdx}-group-${groupIdx}`} className={groupIdx > 0 ? textGroupGapClassName : undefined}>
                      {group.map((line, lineIdx) => (
                        line.trim().length === 0 ? (
                          <div key={`col-${colIdx}-group-${groupIdx}-line-${lineIdx}`} className={textEmptyLineClassName} />
                        ) : (
                          <p
                            key={`col-${colIdx}-group-${groupIdx}-line-${lineIdx}`}
                            className={`${textLineClassName} ${italicLineSet.has(line.trim()) ? "italic" : ""}`.trim()}
                          >
                            {line}
                          </p>
                        )
                      ))}
                    </div>
                  ))}
                </div>
              );
            }

            if (groupSize > 0) {
              const compact = column.filter((line) => line.trim().length > 0);
              const groups: string[][] = [];
              for (let i = 0; i < compact.length; i += groupSize) groups.push(compact.slice(i, i + groupSize));
              return (
                <div key={`col-${colIdx}`} className="text-base leading-7 text-zinc-700">
                  {groups.map((group, groupIdx) => (
                    <div key={`col-${colIdx}-group-${groupIdx}`} className={groupIdx > 0 ? textGroupGapClassName : undefined}>
                      {group.map((line, lineIdx) => (
                        <p key={`col-${colIdx}-group-${groupIdx}-line-${lineIdx}`}>{line}</p>
                      ))}
                    </div>
                  ))}
                </div>
              );
            }

            return (
              <div key={`col-${colIdx}`} className="space-y-2 text-base leading-7 text-zinc-700">
                {column.map((line, lineIdx) => (
                  line.trim().length === 0 ? (
                    <div key={`col-${colIdx}-line-${lineIdx}`} className={textEmptyLineClassName} />
                  ) : (
                    <p
                      key={`col-${colIdx}-line-${lineIdx}`}
                      className={`${textLineClassName} ${italicLineSet.has(line.trim()) ? "italic" : ""}`.trim()}
                    >
                      {line}
                    </p>
                  )
                ))}
              </div>
            );
          })}
        </div>
      ) : activeTab === "text" && !editMode && groupedTextRows ? (
        <div className="mb-8 text-base leading-7 text-zinc-700 md:text-lg">
          {groupedTextRows.map((group, groupIdx) => (
            <div
              key={`text-group-${groupIdx}`}
              className={groupIdx > 0 ? textGroupGapClassName : undefined}
            >
              {group.map((line, lineIdx) => (
                line.trim().length === 0 ? (
                  <div key={`text-group-${groupIdx}-line-${lineIdx}`} className={textEmptyLineClassName} />
                ) : (
                  <p
                    key={`text-group-${groupIdx}-line-${lineIdx}`}
                    className={`${textLineClassName} ${italicLineSet.has(line.trim()) ? "italic" : ""}`.trim()}
                  >
                    {line}
                  </p>
                )
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-8 space-y-3 text-base leading-7 text-zinc-700 md:text-lg">
          {rows.map((line, index) => (
            editMode ? (
              <textarea
                key={`${activeTab}-${index}`}
                value={line}
                onChange={(e) => setRowValue(activeTab, index, e.currentTarget.value)}
                className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm leading-6 text-zinc-800"
                rows={line.length > 80 ? 2 : 1}
              />
            ) : (
              line.trim().length === 0 ? (
                <div key={`${activeTab}-${index}`} className={textEmptyLineClassName} />
              ) : (
                <p
                  key={`${activeTab}-${index}`}
                  className={`${textLineClassName} ${italicLineSet.has(line.trim()) ? "italic" : ""}`.trim()}
                >
                  {line}
                </p>
              )
            )
          ))}
        </div>
      )}

      {showPlayer ? <MultiTrackPlayer /> : null}
    </section>
  );
}
