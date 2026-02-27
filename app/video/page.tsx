"use client";

import PageHero from "../components/PageHero";
import { useEffect, useMemo, useRef, useState } from "react";
import CardViewTracker from "../components/analytics/CardViewTracker";
import EngagementTracker from "../components/analytics/EngagementTracker";
import CommentsPanel from "../components/community/CommentsPanel";
import ContentReactionsBar from "../components/community/ContentReactionsBar";
import { useI18n } from "../components/i18n/I18nProvider";
import { openGlobalVideo } from "../lib/globalVideoManager";
import { VIDEO_CATALOG_ITEMS, type VideoCatalogItem } from "../lib/videosCatalog";

type VideoItem = {
  localUrl?: string;
} & VideoCatalogItem;

export default function VideoPage() {
  const { t } = useI18n();
  const [activeCollection, setActiveCollection] = useState<"acapella" | "all">("acapella");
  const [uploadedVideos, setUploadedVideos] = useState<VideoItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allVideos = useMemo<VideoItem[]>(
    () => [...uploadedVideos, ...VIDEO_CATALOG_ITEMS.map((item) => ({ ...item }))],
    [uploadedVideos]
  );

  const playableVideos = useMemo(
    () => allVideos.filter((item) => !!item.localUrl || !!item.externalUrl),
    [allVideos]
  );

  const visibleVideos = useMemo(
    () =>
      activeCollection === "acapella"
        ? playableVideos.filter((v) => v.source === "acapella" || v.source === "kinescope")
        : playableVideos,
    [activeCollection, playableVideos]
  );

  useEffect(() => {
    return () => {
      for (const item of uploadedVideos) {
        if (item.localUrl) URL.revokeObjectURL(item.localUrl);
      }
    };
  }, [uploadedVideos]);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.currentTarget.files;
    if (!list || !list.length) return;
    const files = Array.from(list).filter((f) => f.type.startsWith("video/"));
    if (!files.length) return;

    const added: VideoItem[] = files.map((file, idx) => ({
      id: Date.now() + idx,
      title: file.name.replace(/\.[^.]+$/, ""),
      description: `${t("video.uploadedFromComputer")} (Mac)`,
      source: "acapella",
      localUrl: URL.createObjectURL(file),
    }));

    setUploadedVideos((prev) => [...added, ...prev]);
    e.currentTarget.value = "";
  };

  const openInFloatingPlayer = (item: VideoItem) => {
    if (!item.externalUrl) return;
    openGlobalVideo({
      id: `video-${item.id}`,
      title: item.title,
      subtitle: item.description,
      src: item.externalUrl,
      provider: item.source === "kinescope" ? "kinescope" : "other",
    });
  };

  return (
    <main className="rr-main">
      <EngagementTracker contentType="video" contentId="video-catalog" mode="page" />
      <PageHero title={t("nav.video")} />

      <section className="rr-container mt-10 grid gap-8 lg:grid-cols-[270px_1fr]">
        <aside className="rr-panel h-fit p-4">
          <div className="mb-6">
            <div className="rr-sidebar-title">{t("common.search")}</div>
            <input className="rr-input" placeholder={t("common.search")} />
          </div>

          <div className="rr-sidebar-title">{t("common.categories")}</div>
          <ul className="space-y-1 text-sm text-zinc-700">
            {[
              { id: "solo", label: t("video.category.solo") },
              { id: "duet", label: t("video.category.duet") },
              { id: "ensemble", label: t("video.category.ensemble") },
              { id: "acapella", label: t("video.category.acapella") },
              { id: "vek", label: t("video.category.vek") },
            ].map((item) => (
              <li key={item.id} className={`cursor-pointer rounded-sm px-2 py-1 ${item.id === "acapella" ? "bg-[#678ab2] text-white" : "hover:bg-zinc-200"}`}>
                · {item.label}
              </li>
            ))}
          </ul>

          <div className="mt-6 rr-sidebar-title">{t("video.playlists")}</div>
        </aside>

        <div>
          <div className="mb-6 flex items-center justify-between text-sm">
            <div className="flex gap-5">
              <button
                onClick={() => setActiveCollection("acapella")}
                className={activeCollection === "acapella" ? "rr-tab-active" : "rr-tab"}
              >
                {t("video.tab.acapella")}
              </button>
              <button
                onClick={() => setActiveCollection("all")}
                className={activeCollection === "all" ? "rr-tab-active" : "rr-tab"}
              >
                {t("video.tab.all")}
              </button>
            </div>
            <button
              onClick={openFilePicker}
              className="rounded-sm bg-[#678ab2] px-3 py-2 text-white hover:bg-[#5d7da2]"
            >
              {t("video.uploadMac")}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              onChange={onPickFiles}
              className="hidden"
            />
          </div>

          <div className="grid gap-x-7 gap-y-10 md:grid-cols-2">
            {visibleVideos.map((item) => (
              <article key={item.id} className="space-y-3">
                <CardViewTracker contentType="video" contentId={String(item.id)} />
                <div className={`relative overflow-hidden rounded-sm ${item.localUrl ? "aspect-square" : "h-64"}`}>
                  {item.localUrl ? (
                    <video
                      src={item.localUrl}
                      controls
                      preload="metadata"
                      playsInline
                      className="h-full w-full object-cover bg-black"
                    />
                  ) : item.externalUrl ? (
                    <iframe
                      src={item.externalUrl}
                      title={item.title}
                      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                      allowFullScreen
                      className="h-full w-full border-0 bg-black"
                    />
                  ) : null}
                </div>
                <h3 className="rr-card-title max-w-lg">{item.title}</h3>
                <p className="rr-card-text max-w-xl">{item.description}</p>
                <ContentReactionsBar
                  contentType="video"
                  contentId={String(item.id)}
                  contentTitle={item.title}
                  contentHref={`/video#${item.id}`}
                  tone="light"
                  testId={`video-reactions-${item.id}`}
                />
                {item.externalUrl ? (
                  <button
                    onClick={() => openInFloatingPlayer(item)}
                    className="rounded-sm bg-[#678ab2] px-3 py-1.5 text-xs text-white hover:bg-[#5d7da2]"
                  >
                    {t("video.openFloating")}
                  </button>
                ) : null}
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  {t("video.sourceLabel")}: {item.source === "acapella" ? t("video.source.acapella") : item.source === "kinescope" ? t("video.source.kinescope") : t("video.source.other")}
                </div>
                <CommentsPanel
                  contentType="video"
                  contentId={String(item.id)}
                  contentTitle={item.title}
                  contentHref={`/video#${item.id}`}
                  testId={`video-comments-${item.id}`}
                />
              </article>
            ))}
          </div>

          <div className="mt-10 flex items-center gap-2">
            {["1", "2", "3", "4", "5", "6", "7"].map((page) => (
              <button
                key={page}
                className={`rr-pagination-btn ${
                  page === "1" ? "rr-pagination-btn-active" : ""
                }`}
              >
                {page}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
