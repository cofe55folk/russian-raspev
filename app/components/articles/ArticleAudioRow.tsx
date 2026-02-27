"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ARTICLE_AUDIO_STATE_EVENT,
  dispatchArticleAudioCommand,
  getArticleAudioStateSnapshot,
  type ArticleAudioState,
} from "../../lib/articleAudioBus";

type Props = {
  src: string;
  title: string;
  caption?: string;
  tone?: "dark" | "light";
  globalArticleId?: string;
  trackIndex?: number;
};

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
  const seconds = Math.floor(totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function parseCaptionDuration(caption?: string): number {
  if (!caption) return 0;
  const match = caption.match(/(\d+):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export default function ArticleAudioRow({
  src,
  title,
  caption,
  tone = "dark",
  globalArticleId,
  trackIndex,
}: Props) {
  const id = useId();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [localCurrent, setLocalCurrent] = useState(0);
  const [localDuration, setLocalDuration] = useState(0);
  const [localReady, setLocalReady] = useState(false);
  const [globalState, setGlobalState] = useState<ArticleAudioState | null>(() => getArticleAudioStateSnapshot());
  const isGlobalMode = !!globalArticleId && Number.isFinite(trackIndex);
  const sameArticle = !!globalArticleId && globalState?.articleId === globalArticleId;
  const isActiveTrack = sameArticle && globalState?.activeIndex === trackIndex;
  const isPlaying = isGlobalMode ? !!(isActiveTrack && globalState?.playing) : localPlaying;
  const currentTime = isGlobalMode ? (isActiveTrack ? (globalState?.current ?? 0) : 0) : localCurrent;
  const durationFromCaption = parseCaptionDuration(caption);
  const duration = isGlobalMode
    ? isActiveTrack
      ? (globalState?.duration || durationFromCaption)
      : durationFromCaption
    : (localDuration || durationFromCaption);
  const isReady = isGlobalMode ? duration > 0 : localReady;

  useEffect(() => {
    if (isGlobalMode) return;
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => {
      setLocalDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setLocalReady(true);
    };
    const onTimeUpdate = () => setLocalCurrent(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    const onEnded = () => setLocalPlaying(false);
    const onPause = () => setLocalPlaying(false);
    const onPlay = () => setLocalPlaying(true);

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
    };
  }, [isGlobalMode]);

  useEffect(() => {
    if (isGlobalMode) return;
    const onExternalPlay = (event: Event) => {
      const customEvent = event as CustomEvent<{ id: string }>;
      if (customEvent.detail?.id === id) return;
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      audio.pause();
    };

    window.addEventListener("rr-article-audio-play", onExternalPlay as EventListener);
    return () => window.removeEventListener("rr-article-audio-play", onExternalPlay as EventListener);
  }, [id, isGlobalMode]);

  useEffect(() => {
    if (!isGlobalMode) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ArticleAudioState>).detail;
      setGlobalState(detail ?? null);
    };
    window.addEventListener(ARTICLE_AUDIO_STATE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ARTICLE_AUDIO_STATE_EVENT, handler as EventListener);
  }, [isGlobalMode]);

  const togglePlay = async () => {
    if (isGlobalMode && globalArticleId && Number.isFinite(trackIndex)) {
      if (isActiveTrack) {
        dispatchArticleAudioCommand({ articleId: globalArticleId, action: "toggle" });
      } else {
        dispatchArticleAudioCommand({ articleId: globalArticleId, action: "playIndex", index: Number(trackIndex), autoplay: true });
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) {
      window.dispatchEvent(new CustomEvent("rr-article-audio-play", { detail: { id } }));
      try {
        await audio.play();
      } catch {
        setLocalPlaying(false);
      }
      return;
    }
    audio.pause();
  };

  const onSeek = (value: number) => {
    if (isGlobalMode && globalArticleId && Number.isFinite(trackIndex)) {
      dispatchArticleAudioCommand({
        articleId: globalArticleId,
        action: "seek",
        index: Number(trackIndex),
        timeSec: value,
      });
      return;
    }

    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    audio.currentTime = value;
    setLocalCurrent(value);
  };

  return (
    <section
      className={`rr-article-audio-row ${tone === "dark" ? "rr-article-audio-row-dark" : ""} ${isActiveTrack ? "rr-article-audio-row-active" : ""}`}
      data-testid={isGlobalMode && Number.isFinite(trackIndex) ? `article-audio-row-${Number(trackIndex)}` : undefined}
      data-article-audio-active={isActiveTrack ? "1" : "0"}
    >
      <div className="rr-article-audio-top">
        <button
          type="button"
          onClick={togglePlay}
          className="rr-article-audio-play"
          aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
          disabled={!src}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" className="rr-article-audio-icon rr-article-audio-icon-pause" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="rr-article-audio-icon rr-article-audio-icon-play" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className="rr-article-audio-meta">
          <div className="rr-article-audio-title">{title}</div>
          {caption ? <div className="rr-article-audio-caption">{caption}</div> : null}
        </div>
        <div className="rr-article-audio-time">
          {formatTime(currentTime)} / {isReady ? formatTime(duration) : "--:--"}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 1}
        step={0.01}
        value={Math.min(currentTime, duration || 1)}
        onChange={(event) => onSeek(Number(event.currentTarget.value))}
        className="rr-article-audio-range"
        aria-label="Позиция аудио"
        disabled={!src || (!isGlobalMode && !duration)}
      />
      {!isGlobalMode ? (
        <audio ref={audioRef} preload="none">
          {src ? <source src={src} /> : null}
        </audio>
      ) : null}
    </section>
  );
}
