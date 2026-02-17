"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type LyricLine = {
  time: number;
  text: string;
};

const KARAOKE_LEAD_SEC = 0.18;

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

type KaraokeLyricsProps = {
  currentTime: number;
  onSeek?: (timeSec: number) => void;
  lyricsSourceUrl?: string;
  expandedText?: string[];
};

export default function KaraokeLyrics({
  currentTime,
  onSeek,
  lyricsSourceUrl = "/audio/selezen/selezen-01-lyrics.json",
  expandedText,
}: KaraokeLyricsProps) {
  const activeLineRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevActiveIndexRef = useRef(-1);

  const [lines, setLines] = useState<LyricLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadLyrics = async () => {
      const res = await fetch(lyricsSourceUrl);
      if (!res.ok) throw new Error("Lyrics fetch failed");
      const data = (await res.json()) as LyricLine[];
      if (cancelled) return;
      setLines(data);
      setReady(true);
    };

    loadLyrics().catch((e) => console.error("Lyrics load error:", e));

    return () => {
      cancelled = true;
    };
  }, [lyricsSourceUrl]);

  const effectiveLines = useMemo(() => {
    if (!expandedText?.length) return lines;
    if (!lines.length) return [];

    const out: LyricLine[] = [];
    let textIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      const curr = lines[i];
      const next = lines[i + 1];
      const halfStep = next ? Math.max((next.time - curr.time) / 2, 0.35) : 2.2;

      const first = expandedText[textIdx] ?? curr.text;
      const second = expandedText[textIdx + 1] ?? curr.text;

      out.push({ time: curr.time, text: first });
      out.push({ time: curr.time + halfStep, text: second });
      textIdx += 2;
    }

    return out;
  }, [lines, expandedText]);

  const activeIndex = useMemo(() => {
    if (!effectiveLines.length) return -1;
    for (let i = effectiveLines.length - 1; i >= 0; i--) {
      if (currentTime + KARAOKE_LEAD_SEC >= effectiveLines[i].time) return i;
    }
    return -1;
  }, [currentTime, effectiveLines]);

  useEffect(() => {
    if (!activeLineRef.current || !listRef.current) return;
    const container = listRef.current;
    const line = activeLineRef.current;

    const containerRect = container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const lineTop = lineRect.top - containerRect.top + container.scrollTop;
    const lineHeight = lineRect.height;
    const containerHeight = container.clientHeight;
    const lineBottom = lineTop + lineHeight;
    const currentTop = container.scrollTop;
    const currentBottom = currentTop + containerHeight;

    // Stable teleprompter window: previous line above + active + several following lines.
    const targetTop = Math.max(0, lineTop - lineHeight * 1.4);
    const maxScrollTop = Math.max(0, container.scrollHeight - containerHeight);
    const clampedTop = Math.min(targetTop, maxScrollTop);

    const changedBySeek = prevActiveIndexRef.current >= 0 && Math.abs(activeIndex - prevActiveIndexRef.current) > 4;
    const needsAdjust = lineTop < currentTop + lineHeight || lineBottom > currentBottom - lineHeight * 2;

    if (needsAdjust) {
      const delta = Math.abs(container.scrollTop - clampedTop);
      if (delta > lineHeight * 0.35) {
        container.scrollTo({
          top: clampedTop,
          behavior: changedBySeek ? "auto" : "smooth",
        });
      }
    }

    prevActiveIndexRef.current = activeIndex;
  }, [activeIndex]);

  return (
    <section className="rr-container mt-8 rounded-sm bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="rr-section-title">Текст по таймкодам (караоке)</h3>
        <div className="text-sm text-zinc-500">{formatTime(currentTime)} (синхронно с плеером)</div>
      </div>

      {!ready && <div className="rr-card-text">Загрузка таймкодов…</div>}

      {ready && (
        <div
          ref={listRef}
          className="max-h-[420px] space-y-1 overflow-auto rounded-sm border border-zinc-200 bg-zinc-50 p-2"
        >
          {effectiveLines.map((line, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                key={`${line.time}-${idx}`}
                ref={isActive ? activeLineRef : null}
                onClick={() => onSeek?.(line.time)}
                className={`flex w-full items-start gap-3 rounded-sm px-3 py-2 text-left transition ${
                  isActive ? "bg-[#5f82aa] text-white" : "hover:bg-zinc-200"
                }`}
              >
                <span className={`min-w-14 text-xs ${isActive ? "text-white/90" : "text-zinc-500"}`}>
                  {formatTime(line.time)}
                </span>
                <span className={`text-sm leading-6 ${isActive ? "text-white" : "text-zinc-700"}`}>
                  {line.text}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
