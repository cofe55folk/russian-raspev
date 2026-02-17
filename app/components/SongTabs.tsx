"use client";

import { useEffect, useMemo, useState } from "react";
import MultiTrackPlayer from "./MultiTrackPlayer";

type TabKey = "text" | "expanded" | "notes" | "about";

const tabLabels: Record<TabKey, string> = {
  text: "Текст",
  expanded: "Распетый текст",
  notes: "Ноты",
  about: "О песне",
};

const defaultContent: Record<TabKey, string[]> = {
  text: [
    "Ой, да мне младцу малым(ы) спалось, во(я) сне виделоса.",
    "Ой, будто конь мо(и) вараной разыгралса подо мной.",
    "Разыгрался, расплясался пред удалым, бравым молодцом.",
    "Как подули ветры буйны со восточной стороны.",
  ],
  expanded: [
    "Ой да разыгрался, да он расплясался пред удалым, бравым маладцом.",
    "Ой как подули ветры буйны са васточной стараны.",
    "Ой да сар(ы)вали да чёр(ы)наю шляпу с маей буйной галавы.",
    "Ой есаул дагадлив(ы) был(ы), сумел сон мой разгадать.",
  ],
  notes: [
    "Нотный материал будет загружен после публикации сканов и проверки авторских прав.",
    "На этом месте запланирован просмотр нот и PDF-загрузка по кнопке.",
  ],
  about: [
    "Запись относится к казачьему песенному пласту с развитой мелизматикой и устойчивой многоголосной фактурой.",
    "Рекомендуемый порядок изучения: основной напев -> верхний голос -> подголоски.",
  ],
};

type SongTabsProps = {
  content?: Record<TabKey, string[]>;
  defaultTab?: TabKey;
  showPlayer?: boolean;
  textColumns?: string[][];
};

export default function SongTabs({
  content = defaultContent,
  defaultTab = "text",
  showPlayer = true,
  textColumns,
}: SongTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);
  const [editMode, setEditMode] = useState(false);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [contentDraft, setContentDraft] = useState<Record<TabKey, string[]>>(content);
  const [textColumnsDraft, setTextColumnsDraft] = useState<string[][] | undefined>(textColumns);

  useEffect(() => {
    setContentDraft(content);
  }, [content]);

  useEffect(() => {
    setTextColumnsDraft(textColumns);
  }, [textColumns]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setStorageKey(`rr_songtabs_edit:${window.location.pathname}`);
  }, []);

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
          {editMode ? "Готово" : "Редактировать текст"}
        </button>
        {editMode && (
          <button
            onClick={resetEdits}
            className="rounded-sm bg-[#dedede] px-4 py-2 text-sm text-zinc-700 hover:bg-[#d3d3d3]"
          >
            Сбросить правки
          </button>
        )}
      </div>

      {activeTab === "text" && (textColumnsDraft ?? textColumns)?.length ? (
        <div className="mb-8 grid gap-6 md:grid-cols-3">
          {(textColumnsDraft ?? textColumns ?? []).map((column, colIdx) => (
            <div key={`col-${colIdx}`} className="space-y-2 text-base leading-7 text-zinc-700">
              {column.map((line, lineIdx) => (
                editMode ? (
                  <textarea
                    key={`col-${colIdx}-line-${lineIdx}`}
                    value={line}
                    onChange={(e) => setTextColumnValue(colIdx, lineIdx, e.currentTarget.value)}
                    className="w-full rounded-sm border border-zinc-300 bg-white px-2 py-1 text-sm leading-6 text-zinc-800"
                    rows={line.length > 64 ? 2 : 1}
                  />
                ) : (
                  <p key={`col-${colIdx}-line-${lineIdx}`}>{line}</p>
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
              <p key={`${activeTab}-${index}`}>{line}</p>
            )
          ))}
        </div>
      )}

      {showPlayer ? <MultiTrackPlayer /> : null}
    </section>
  );
}
