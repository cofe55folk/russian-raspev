"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SOUND_ITEMS } from "../../lib/soundCatalog";
import type { ArticleBlock, ArticleMediaAlign, ArticleMediaSize } from "../../lib/articlesCatalog";
import { dispatchArticleAudioSetPlaylist } from "../../lib/articleAudioBus";
import { getSoundTrackHref } from "../../lib/i18n/routing";
import {
  getGlobalVideoState,
  openGlobalVideo,
  setGlobalVideoPlaylist,
  subscribeGlobalVideo,
  type GlobalVideoItem,
  type GlobalVideoState,
} from "../../lib/globalVideoManager";
import { useI18n } from "../i18n/I18nProvider";
import ArticleAudioRow from "./ArticleAudioRow";

type Props = {
  blocks: ArticleBlock[];
  tone?: "dark" | "light";
  renderProfile?: "default" | "vk-compat";
  playlistLinkMode?: "link" | "text";
  className?: string;
  anchorPrefix?: string;
  articleId?: string;
  articleTitle?: string;
  syncGlobalPlaylist?: boolean;
  syncGlobalVideoPlaylist?: boolean;
};

function getVkBlockSpacingClass(block: ArticleBlock): string {
  const role = block.vkGroupRole;
  const isFigureLike =
    block.vkType === 100 ||
    block.vkType === 101 ||
    block.vkType === 102 ||
    block.vkType === 105 ||
    block.type === "image" ||
    block.type === "audio" ||
    block.type === "video" ||
    block.type === "playlist";

  if (block.type === "quote") {
    if (role === "last") return "mt-[-21px] mb-[21px]";
    return "my-[21px]";
  }

  if (isFigureLike) {
    if (role === "first") return "mt-[30px]";
    if (role === "middle") return "mt-0";
    if (role === "last") return "mt-0 mb-[30px]";
    return "mt-[30px]";
  }

  if (block.type === "text") {
    if (/<h[23][^>]*>/i.test(block.html)) return "mt-[40px]";
    return "mt-[24px]";
  }

  if (block.type === "ordered_list") return "mt-[24px]";
  return "mt-[24px]";
}

function mediaSizeClass(size?: ArticleMediaSize) {
  if (size === "sm") return "max-w-xs";
  if (size === "lg") return "max-w-4xl";
  return "max-w-2xl";
}

function mediaAlignClass(align?: ArticleMediaAlign) {
  if (align === "left") return "mr-6";
  if (align === "right") return "ml-6";
  if (align === "full") return "w-full";
  return "mx-auto";
}

function mediaWrapClass(align?: ArticleMediaAlign, wrap?: boolean) {
  if (!wrap) return "";
  if (align === "right") return "md:float-right";
  if (align === "left") return "md:float-left";
  return "";
}

function getYouTubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      const videoId = parsed.pathname.replace(/^\/+/, "").split("/")[0];
      if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      return null;
    }
    if (host.includes("youtube.com")) {
      const idFromQuery = parsed.searchParams.get("v");
      if (idFromQuery) return `https://www.youtube.com/embed/${idFromQuery}`;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" && parts[1]) return `https://www.youtube.com/embed/${parts[1]}`;
      if (parts[0] === "shorts" && parts[1]) return `https://www.youtube.com/embed/${parts[1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

function getRutubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("rutube.ru")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const videoIndex = parts.findIndex((part) => part === "video");
    if (videoIndex >= 0 && parts[videoIndex + 1]) {
      return `https://rutube.ru/play/embed/${parts[videoIndex + 1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

function getExternalPlatformLabel(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("youtube.com") || host === "youtu.be") return "YouTube";
    if (host.includes("rutube.ru")) return "RuTube";
  } catch {}
  return "платформе";
}

function getVideoProvider(url: string): GlobalVideoItem["provider"] {
  if (!url) return "other";
  const youtube = getYouTubeEmbedUrl(url);
  const rutube = getRutubeEmbedUrl(url);
  if (youtube || rutube) return "other";
  return "file";
}

type UiLang = "ru" | "en";

const VIDEO_UI: Record<UiLang, { openInPlayer: string; nowPlaying: string; openOnPlatform: (platform: string) => string }> = {
  ru: {
    openInPlayer: "Открыть в плеере",
    nowPlaying: "Сейчас в плеере",
    openOnPlatform: (platform: string) => `Открыть на ${platform}`,
  },
  en: {
    openInPlayer: "Open in player",
    nowPlaying: "Now playing",
    openOnPlatform: (platform: string) => `Open on ${platform}`,
  },
};

export default function ArticleBlocksRenderer({
  blocks,
  tone = "dark",
  renderProfile = "default",
  playlistLinkMode = "link",
  className = "",
  anchorPrefix = "article-block",
  articleId,
  articleTitle,
  syncGlobalPlaylist = false,
  syncGlobalVideoPlaylist = false,
}: Props) {
  const { locale, t } = useI18n();
  const [globalVideoState, setGlobalVideoState] = useState<GlobalVideoState | null>(null);
  const uiLang: UiLang = locale === "en" ? "en" : "ru";
  const isDark = tone === "dark";
  const isVkCompat = renderProfile === "vk-compat";
  const panelClass = isDark
    ? "rounded-sm border border-[#3b3f47] bg-[#23262d]"
    : "rounded-sm border border-zinc-200 bg-zinc-50";
  const baseTextClass = isDark ? "text-[#e6e8ec]" : "text-zinc-800";
  const softTextClass = isDark ? "text-[#9aa3b2]" : "text-zinc-500";
  const quoteBgClass = isDark ? "bg-transparent text-[#d7dbe2]" : "bg-[#f4f7fb] text-zinc-800";
  const playlistItemClass = isDark
    ? "block rounded-sm bg-[#2f333b] px-2 py-1 text-sm text-[#d7dbe2] hover:bg-[#383d46]"
    : "block rounded-sm bg-white px-2 py-1 text-sm text-zinc-800";
  const videoUi = VIDEO_UI[uiLang];
  const { audioTracks, audioIndexByBlockId } = useMemo(() => {
    const tracks: { id: string; title: string; subtitle?: string; src: string }[] = [];
    const indexByBlockId = new Map<string, number>();

    blocks.forEach((block) => {
      if (block.type === "audio") {
        indexByBlockId.set(block.id, tracks.length);
        tracks.push({
          id: "",
          title: block.title,
          subtitle: block.caption,
          src: block.src,
        });
        return;
      }

      if (block.type === "playlist") {
        block.songSlugs.forEach((slug) => {
          const song = SOUND_ITEMS.find((item) => item.slug === slug);
          const src = song?.previewSrc;
          if (!song || !src) return;
          tracks.push({
            id: song.slug,
            title: song.title,
            subtitle: song.archiveInfo ?? song.genre ?? articleTitle,
            src,
          });
        });
      }
    });

    return { audioTracks: tracks, audioIndexByBlockId: indexByBlockId };
  }, [articleTitle, blocks]);

  const videoTracks = useMemo(
    () =>
      blocks
        .filter((block): block is Extract<ArticleBlock, { type: "video" }> => block.type === "video")
        .map((block, index) => ({
          id: `${articleId ?? "article"}:video:${index}`,
          title: block.title || `Video ${index + 1}`,
          subtitle: block.caption,
          src: block.src,
          provider: getVideoProvider(block.src),
        })),
    [articleId, blocks]
  );

  const videoIndexByBlockId = useMemo(() => {
    const result = new Map<string, number>();
    let index = 0;
    blocks.forEach((block) => {
      if (block.type !== "video") return;
      result.set(block.id, index);
      index += 1;
    });
    return result;
  }, [blocks]);

  useEffect(() => {
    if (!syncGlobalVideoPlaylist) return;
    const sync = () => setGlobalVideoState({ ...getGlobalVideoState() });
    sync();
    const unsubscribe = subscribeGlobalVideo(sync);
    return () => unsubscribe();
  }, [syncGlobalVideoPlaylist]);

  useEffect(() => {
    if (!syncGlobalPlaylist || !articleId) return;
    dispatchArticleAudioSetPlaylist({
      articleId,
      articleTitle: articleTitle ?? "Статья",
      tracks: audioTracks,
      preserveCurrentIfSame: true,
    });
  }, [articleId, articleTitle, audioTracks, syncGlobalPlaylist]);

  useEffect(() => {
    if (!syncGlobalVideoPlaylist || !articleId) return;
    setGlobalVideoPlaylist({
      contextId: articleId,
      items: videoTracks,
      preserveCurrentIfSame: true,
    });
  }, [articleId, syncGlobalVideoPlaylist, videoTracks]);
  return (
    <div className={`${isVkCompat ? "rr-article-render-vk space-y-0" : "space-y-5 md:space-y-6"} ${className}`.trim()}>
      {blocks.map((block, index) => {
        const prevBlock = index > 0 ? blocks[index - 1] : null;
        const shouldClearBefore = !!(prevBlock && prevBlock.type === "image" && prevBlock.wrap && block.type !== "text");
        const clearClass = shouldClearBefore ? "clear-both" : "";
        const vkSpacingClass = isVkCompat ? getVkBlockSpacingClass(block) : "";
        const vkClassName = block.vkClassName ?? "";

        if (block.type === "text") {
          const alignClass =
            block.align === "center" ? "text-center" : block.align === "right" ? "text-right" : "text-left";
          const fontClass =
            block.fontScale === "sm"
              ? "text-sm leading-6"
              : block.fontScale === "lg"
                ? "text-xl leading-8"
                : "text-base leading-7 md:text-lg";
          return (
            <section
              id={`${anchorPrefix}-${block.id}`}
              key={block.id}
              className={`scroll-mt-24 ${alignClass} ${fontClass} ${baseTextClass} ${clearClass} ${vkSpacingClass} ${vkClassName} rr-article-flow-text`}
            >
              <div dangerouslySetInnerHTML={{ __html: block.html }} />
            </section>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote
              id={`${anchorPrefix}-${block.id}`}
              key={block.id}
              className={`scroll-mt-24 border-l border-[#6f7886] px-4 py-1 ${quoteBgClass} ${clearClass} ${vkSpacingClass} ${vkClassName} rr-article-flow-quote`}
            >
              <p className="whitespace-pre-line text-lg leading-7 italic">{block.text}</p>
              {block.author ? <footer className={`mt-2 text-sm ${softTextClass}`}>- {block.author}</footer> : null}
            </blockquote>
          );
        }

        if (block.type === "ordered_list") {
          return (
            <section
              id={`${anchorPrefix}-${block.id}`}
              key={block.id}
              className={`scroll-mt-24 ${clearClass} ${vkSpacingClass} ${vkClassName} rr-article-flow-text`}
            >
              <ol start={block.start} className={`${baseTextClass} list-decimal pl-6`}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${block.id}-${itemIndex}`} className="mb-1 leading-7 md:leading-8">
                    {item}
                  </li>
                ))}
              </ol>
            </section>
          );
        }

        if (block.type === "image") {
          const sizeClass = mediaSizeClass(block.size);
          const alignClass = mediaAlignClass(block.align);
          const wrapClass = mediaWrapClass(block.align, block.wrap);
          const wrappedSizeClass = block.wrap ? "w-full md:max-w-[340px]" : sizeClass;
          return (
            <figure
              id={`${anchorPrefix}-${block.id}`}
              key={block.id}
              className={`scroll-mt-24 rr-article-media-box p-2 ${wrappedSizeClass} ${alignClass} ${wrapClass} ${vkSpacingClass} ${vkClassName} mb-4`}
            >
              {block.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                  <img src={block.src} alt={block.caption ?? "Иллюстрация"} className="w-full rounded-sm object-cover" />
              ) : (
                <div className={`h-28 rounded-sm ${isDark ? "bg-[#2f333b]" : "bg-zinc-200"}`} />
              )}
              {block.caption ? <figcaption className={`mt-2 text-sm ${softTextClass} rr-article-media-caption`}>{block.caption}</figcaption> : null}
            </figure>
          );
        }

        if (block.type === "audio") {
          const audioTrackIndex = audioIndexByBlockId.get(block.id);
          return (
            <section id={`${anchorPrefix}-${block.id}`} key={block.id} className={`scroll-mt-24 ${clearClass} ${vkSpacingClass} ${vkClassName}`}>
              <ArticleAudioRow
                src={block.src}
                title={block.title}
                caption={block.caption}
                tone={tone}
                globalArticleId={syncGlobalPlaylist ? articleId : undefined}
                trackIndex={syncGlobalPlaylist ? audioTrackIndex : undefined}
              />
            </section>
          );
        }

        if (block.type === "video") {
          const sizeClass = mediaSizeClass(block.size);
          const alignClass = mediaAlignClass(block.align);
          const wrapClass = mediaWrapClass(block.align, block.wrap);
          const youtubeEmbedUrl = block.src ? getYouTubeEmbedUrl(block.src) : null;
          const rutubeEmbedUrl = block.src ? getRutubeEmbedUrl(block.src) : null;
          const externalEmbedUrl = youtubeEmbedUrl ?? rutubeEmbedUrl;
          const videoTrackIndex = videoIndexByBlockId.get(block.id);
          const isGlobalVideoMode = !!syncGlobalVideoPlaylist && !!articleId && Number.isFinite(videoTrackIndex);
          const isActiveVideo =
            !!isGlobalVideoMode &&
            !!globalVideoState?.open &&
            globalVideoState?.contextId === articleId &&
            globalVideoState?.playlistIndex === videoTrackIndex;
          return (
            <figure
              id={`${anchorPrefix}-${block.id}`}
              key={block.id}
              className={`scroll-mt-24 ${sizeClass} ${alignClass} ${wrapClass} ${clearClass} ${vkSpacingClass} ${vkClassName} ${isActiveVideo ? "rr-article-video-active" : ""}`}
            >
              <div className="relative">
                {externalEmbedUrl ? (
                  <div className="rr-article-video-frame aspect-video w-full overflow-hidden rounded-sm bg-black">
                    <iframe
                      src={externalEmbedUrl}
                      title={block.title || "Embedded video"}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                      className={`h-full w-full ${isGlobalVideoMode ? "pointer-events-none" : ""}`}
                    />
                  </div>
                ) : (
                  <video
                    controls={!isGlobalVideoMode}
                    preload="metadata"
                    className="rr-article-video-frame w-full rounded-sm bg-black"
                    playsInline
                    muted={isGlobalVideoMode}
                  >
                    {block.src ? <source src={block.src} /> : null}
                  </video>
                )}
                {isGlobalVideoMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      const idx = Number(videoTrackIndex);
                      const item = videoTracks[idx];
                      if (!item || !articleId) return;
                      openGlobalVideo(item, {
                        contextId: articleId,
                        playlist: videoTracks,
                        index: idx,
                      });
                    }}
                    data-testid={Number.isFinite(videoTrackIndex) ? `article-video-open-${Number(videoTrackIndex)}` : undefined}
                    className="absolute inset-0 flex items-center justify-center bg-black/0 transition hover:bg-black/25"
                    aria-label={videoUi.openInPlayer}
                  >
                    <span className="rounded-full border border-[#8ab8ff] bg-[#1f3a63]/80 px-3 py-1 text-xs font-medium text-[#d7e7ff]">
                      {isActiveVideo ? videoUi.nowPlaying : videoUi.openInPlayer}
                    </span>
                  </button>
                ) : null}
              </div>
              {block.title ? <div className={`mt-2 text-sm font-medium ${baseTextClass}`}>{block.title}</div> : null}
              {block.caption ? <figcaption className={`mt-1 text-xs ${softTextClass} rr-article-media-caption`}>{block.caption}</figcaption> : null}
              {externalEmbedUrl && block.src ? (
                <div className="mt-2 text-xs">
                  <a
                    href={block.src}
                    target="_blank"
                    rel="noreferrer"
                    className={isDark ? "text-[#9cc4ff] hover:text-white underline" : "text-[#2f5d92] hover:text-[#1f3f68] underline"}
                  >
                    {videoUi.openOnPlatform(getExternalPlatformLabel(block.src))}
                  </a>
                </div>
              ) : null}
            </figure>
          );
        }

        if (block.type === "table") {
          return (
            <figure
              id={`${anchorPrefix}-${block.id}`}
              key={block.id}
              className={`scroll-mt-24 overflow-x-auto ${clearClass} ${vkSpacingClass} ${vkClassName}`}
            >
              <table className={`w-full text-sm ${block.bordered ? (isDark ? "border border-[#3b3f47]" : "border border-zinc-300") : ""}`}>
                <tbody>
                  {block.rows.map((row, rowIdx) => (
                    <tr key={`${block.id}-r-${rowIdx}`}>
                      {row.map((cell, colIdx) => (
                        <td
                          key={`${block.id}-r-${rowIdx}-c-${colIdx}`}
                          className={`${block.bordered ? (isDark ? "border border-[#3b3f47]" : "border border-zinc-300") : ""} px-2 py-1 ${baseTextClass}`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {block.caption ? <figcaption className={`mt-2 text-xs ${softTextClass}`}>{block.caption}</figcaption> : null}
            </figure>
          );
        }

        const playlistItems = block.songSlugs
          .map((slug) => SOUND_ITEMS.find((song) => song.slug === slug))
          .filter((song): song is (typeof SOUND_ITEMS)[number] => !!song);
        return (
          <section
            id={`${anchorPrefix}-${block.id}`}
            key={block.id}
            className={`scroll-mt-24 ${isVkCompat ? "" : `${panelClass} p-4`} ${clearClass} ${vkSpacingClass} ${vkClassName}`.trim()}
          >
            <div className={`mb-2 text-sm font-semibold ${baseTextClass}`}>{block.title || t("common.playlist")}</div>
            <div className="space-y-1">
              {playlistItems.map((song) =>
                playlistLinkMode === "link" ? (
                  <Link key={song.slug} href={getSoundTrackHref(locale, song.slug)} className={playlistItemClass}>
                    {song.title}
                  </Link>
                ) : (
                  <div key={song.slug} className={playlistItemClass}>
                    {song.title}
                  </div>
                )
              )}
            </div>
          </section>
        );
      })}
      <div className="clear-both" />
    </div>
  );
}
