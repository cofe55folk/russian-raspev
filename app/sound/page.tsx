"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MultiTrackPlayer, { type TrackDef } from "../components/MultiTrackPlayer";
import PageHero from "../components/PageHero";
import { clearGlobalAudio, requestGlobalAudio, type GlobalAudioController } from "../lib/globalAudioManager";

type SoundItem = {
  id: number;
  slug: string;
  title: string;
  genre?: string;
  modernPerformer?: string;
  authenticPerformer?: string;
  leadSinger?: string;
  recordingAuthor?: string;
  archiveInfo?: string;
  previewSrc?: string;
  masterSources?: string[];
  coverSrc?: string | null;
};

const tracks: SoundItem[] = [
  {
    id: 1,
    slug: "selezen",
    title: "Селезень сиз-косастый",
    genre: "хороводная",
    modernPerformer: "Багринцев Евгений",
    archiveInfo: "с. Крутиха, Кыштовского р-на Новосибирской обл.",
    previewSrc: "/audio/selezen/selezen-01.m4a",
    masterSources: ["/audio/selezen/selezen-01.m4a", "/audio/selezen/selezen-02.m4a", "/audio/selezen/selezen-03.m4a"],
    coverSrc: "/hero.jpg",
  },
  {
    id: 2,
    slug: "balman-ty-zorya-moya",
    title: "Ты заря моя ты зоренька",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-01.mp3",
    masterSources: [
      "/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-01.mp3",
      "/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-02.mp3",
      "/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-03.mp3",
    ],
    coverSrc: "/hero.jpg",
  },
  {
    id: 3,
    slug: "balman-seyu-veyu",
    title: "Сею-вею",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-seyu_veyu/balman-seyu-veyu-01.m4a",
    masterSources: [
      "/audio/balman-seyu_veyu/balman-seyu-veyu-01.m4a",
      "/audio/balman-seyu_veyu/balman-seyu-veyu-02.m4a",
      "/audio/balman-seyu_veyu/balman-seyu-veyu-03.m4a",
    ],
    coverSrc: "/hero.jpg",
  },
  {
    id: 4,
    slug: "balman-lipynka",
    title: "Липынька",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-Lipynka/balman-Lipynka-01.m4a",
    masterSources: ["/audio/balman-Lipynka/balman-Lipynka-01.m4a", "/audio/balman-Lipynka/balman-Lipynka-02.m4a", "/audio/balman-Lipynka/balman-Lipynka-03.m4a"],
    coverSrc: "/hero.jpg",
  },
  {
    id: 5,
    slug: "balman-kumushki-skachite",
    title: "Кумушки скачите",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-kumushki_skachite/balman-kumushki_skachite-01.mp3",
    masterSources: [
      "/audio/balman-kumushki_skachite/balman-kumushki_skachite-01.mp3",
      "/audio/balman-kumushki_skachite/balman-kumushki_skachite-02.mp3",
      "/audio/balman-kumushki_skachite/balman-kumushki_skachite-03.mp3",
    ],
    coverSrc: "/hero.jpg",
  },
  {
    id: 6,
    slug: "balman-vechor-devku",
    title: "Вечор девку",
    genre: "хороводная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-vechor_devku/balman-vechor_devku-01.mp3",
    masterSources: [
      "/audio/balman-vechor_devku/balman-vechor_devku-01.mp3",
      "/audio/balman-vechor_devku/balman-vechor_devku-02.mp3",
      "/audio/balman-vechor_devku/balman-vechor_devku-03.mp3",
    ],
    coverSrc: "/hero.jpg",
  },
  {
    id: 7,
    slug: "balman-ya-kachu-kolco",
    title: "Я качу кольцо",
    genre: "хороводная игровая, вечерочная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Балман, Куйбышевский район",
    archiveInfo: "Новосибирская область, с. Балман",
    previewSrc: "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-01.mp3",
    masterSources: [
      "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-01.mp3",
      "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-02.mp3",
      "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-03.mp3",
    ],
    coverSrc: "/hero.jpg",
  },
  {
    id: 8,
    slug: "talbakul-poteryala-ya-kolechko",
    title: "Потеряла я колечко",
    genre: "лирическая протяжная, романс",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Талбакуль, Колосовский район",
    archiveInfo: "Новосибирская область, с. Талбакуль",
    previewSrc: "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-01.m4a",
    masterSources: [
      "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-01.m4a",
      "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-02.m4a",
      "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-03.m4a",
    ],
    coverSrc: "/hero.jpg",
  },
  {
    id: 9,
    slug: "tomsk-bogoslovka-po-moryam",
    title: "По морям",
    genre: "лирическая протяжная",
    modernPerformer: "Ансамбль «Русский распев»",
    authenticPerformer: "Жители с. Богословка, Зырянский район",
    archiveInfo: "Томская область, с. Богословка",
    previewSrc: "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-01.m4a",
    masterSources: [
      "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-01.m4a",
      "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-02.m4a",
      "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-03.m4a",
    ],
    coverSrc: "/hero.jpg",
  },
  ...Array.from({ length: 10 }, (_, i) => ({
    id: i + 10,
    slug: `mne-mladcu-malym-spalos-${i + 1}`,
    title: "Мне младцу малым спалось",
    coverSrc: null,
  })),
];

function hasValue(value?: string) {
  return !!value && value.trim().length > 0 && value.trim().toLowerCase() !== "уточняется";
}

function composeSecondLine(item: SoundItem) {
  return [item.archiveInfo, item.authenticPerformer, item.leadSinger, item.recordingAuthor]
    .filter((value): value is string => hasValue(value))
    .join(" · ");
}

function toTrackDefs(item: SoundItem): TrackDef[] {
  const srcs = item.masterSources?.length ? item.masterSources : (item.previewSrc ? [item.previewSrc] : []);
  return srcs.map((src, idx) => ({ name: `${item.title} ${String(idx + 1).padStart(2, "0")}`, src }));
}

export default function SoundPage() {
  const previewItems = useMemo(() => tracks.filter((t) => !!t.previewSrc), []);

  const [activePreviewId, setActivePreviewId] = useState<number | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [activeTracks, setActiveTracks] = useState<TrackDef[] | null>(null);
  const [playerKey, setPlayerKey] = useState(0);
  const [previewLoop, setPreviewLoop] = useState(false);

  const backendControllerRef = useRef<GlobalAudioController | null>(null);
  const soundControllerRef = useRef<GlobalAudioController | null>(null);
  const activePreviewIdRef = useRef<number | null>(null);
  const activePreviewIdxRef = useRef<number>(-1);
  const pendingAutoPlayRef = useRef(false);

  const playByIndex = useCallback((idx: number) => {
    if (idx < 0 || idx >= previewItems.length) return;
    const item = previewItems[idx];
    const defs = toTrackDefs(item);
    if (!defs.length) return;
    pendingAutoPlayRef.current = true;
    setActivePreviewId(item.id);
    activePreviewIdRef.current = item.id;
    activePreviewIdxRef.current = idx;
    setActiveTracks(defs);
    setPlayerKey((k) => k + 1);
  }, [previewItems]);

  const togglePreview = useCallback((item: SoundItem) => {
    if (!item.previewSrc) return;
    if (activePreviewIdRef.current === item.id && backendControllerRef.current) {
      if (soundControllerRef.current) requestGlobalAudio(soundControllerRef.current);
      backendControllerRef.current.toggle();
      return;
    }
    const idx = previewItems.findIndex((t) => t.id === item.id);
    if (idx < 0) return;
    if (soundControllerRef.current) requestGlobalAudio(soundControllerRef.current);
    playByIndex(idx);
  }, [playByIndex, previewItems]);

  const onBackendControllerReady = useCallback((controller: GlobalAudioController | null) => {
    backendControllerRef.current = controller;
    if (!controller || !pendingAutoPlayRef.current) return;
    pendingAutoPlayRef.current = false;
    if (soundControllerRef.current) requestGlobalAudio(soundControllerRef.current);
    controller.play();
  }, []);

  useEffect(() => {
    soundControllerRef.current = {
      id: "rr-sound-page-preview",
      title: activePreviewId != null ? (tracks.find((t) => t.id === activePreviewId)?.title ?? "Предпрослушка") : "Предпрослушка",
      subtitle: activePreviewId != null ? (tracks.find((t) => t.id === activePreviewId)?.archiveInfo ?? "") : "",
      getTitle: () => {
        const idx = activePreviewIdxRef.current;
        if (idx >= 0 && idx < previewItems.length) return previewItems[idx].title;
        return "Предпрослушка";
      },
      getSubtitle: () => {
        const idx = activePreviewIdxRef.current;
        if (idx >= 0 && idx < previewItems.length) return previewItems[idx].archiveInfo ?? "";
        return "";
      },
      getPlaylist: () =>
        previewItems.map((t) => ({
          id: String(t.id),
          title: t.title,
          subtitle: t.archiveInfo ?? "",
        })),
      getPlaylistIndex: () => activePreviewIdxRef.current,
      jumpTo: (index: number) => {
        if (soundControllerRef.current) requestGlobalAudio(soundControllerRef.current);
        playByIndex(index);
      },
      stop: () => {
        backendControllerRef.current?.stop();
        setIsPreviewPlaying(false);
      },
      play: () => {
        if (soundControllerRef.current) requestGlobalAudio(soundControllerRef.current);
        if (backendControllerRef.current && activePreviewIdxRef.current >= 0) {
          backendControllerRef.current.play();
          return;
        }
        if (activePreviewIdxRef.current >= 0) playByIndex(activePreviewIdxRef.current);
        else playByIndex(0);
      },
      pause: () => {
        backendControllerRef.current?.pause();
        setIsPreviewPlaying(false);
      },
      toggle: () => {
        if (soundControllerRef.current) requestGlobalAudio(soundControllerRef.current);
        if (backendControllerRef.current && activePreviewIdxRef.current >= 0) {
          backendControllerRef.current.toggle();
          return;
        }
        if (activePreviewIdxRef.current >= 0) playByIndex(activePreviewIdxRef.current);
        else playByIndex(0);
      },
      prev: () => {
        const idx = activePreviewIdxRef.current >= 0 ? activePreviewIdxRef.current : 0;
        playByIndex((idx - 1 + previewItems.length) % previewItems.length);
      },
      next: () => {
        const idx = activePreviewIdxRef.current >= 0 ? activePreviewIdxRef.current : -1;
        playByIndex((idx + 1 + previewItems.length) % previewItems.length);
      },
      seek: (timeSec: number) => {
        backendControllerRef.current?.seek(timeSec);
      },
      getProgress: () => {
        if (backendControllerRef.current) return backendControllerRef.current.getProgress();
        return { current: 0, duration: 0, playing: false };
      },
      getLoop: () => previewLoop,
      setLoop: (loop: boolean) => {
        setPreviewLoop(loop);
        backendControllerRef.current?.setLoop?.(loop);
      },
    };
  }, [activePreviewId, playByIndex, previewItems, previewLoop]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const progress = backendControllerRef.current?.getProgress();
      setIsPreviewPlaying(!!progress?.playing);
      if (progress && !progress.playing && progress.current <= 0.001 && activePreviewIdRef.current != null) {
        setIsPreviewPlaying(false);
      }
    }, 180);
    return () => {
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    return () => {
      backendControllerRef.current?.stop();
      clearGlobalAudio(soundControllerRef.current?.id);
    };
  }, []);

  return (
    <main className="rr-main">
      {activeTracks ? (
        <div className="hidden" aria-hidden>
          <MultiTrackPlayer
            key={`sound-preview-${playerKey}`}
            tracks={activeTracks}
            onControllerReady={onBackendControllerReady}
            registerGlobalAudio={false}
          />
        </div>
      ) : null}

      <PageHero title="Звук" />

      <section className="rr-container mt-10 grid gap-8 lg:grid-cols-[270px_1fr]">
        <aside className="rr-panel h-fit p-4">
          <div className="mb-6">
            <div className="rr-sidebar-title">Поиск</div>
            <input className="rr-input" placeholder="Поиск" />
          </div>

          <div className="rr-sidebar-title">Категории</div>
          <button className="mb-2 w-full rounded-sm bg-zinc-200 px-3 py-2 text-left text-sm">Показать</button>

          <div className="rr-sidebar-title">Этнографический регион</div>
          <button className="mb-2 w-full rounded-sm bg-zinc-200 px-3 py-2 text-left text-sm">Показать</button>

          <div className="rr-sidebar-title">Жанр</div>
          <ul className="space-y-1 text-sm text-zinc-700">
            {["Протяжная", "Хороводная", "Свадебная", "Плясовая", "Величальная", "Историческая", "Былинная"].map((item) => (
              <li key={item} className="rounded-sm px-2 py-1 hover:bg-zinc-200">
                · {item}
              </li>
            ))}
          </ul>
        </aside>

        <div>
          <div className="mb-6 flex items-center justify-between text-sm">
            <div className="flex gap-5">
              <button className="rr-tab-active">Лучшее</button>
              <button className="rr-tab">Свежее</button>
            </div>
            <div className="text-zinc-600">Выводить по <span className="font-semibold">6</span> 12 24 36 Все</div>
          </div>

          <div className="space-y-2">
            {tracks.map((item) => {
              const secondLine = composeSecondLine(item);
              const isCurrent = activePreviewId === item.id;
              const isPlaying = isCurrent && isPreviewPlaying;
              return (
                <article key={item.id} className="rounded-md border border-[#d4c39f] bg-[#f5efe2] px-2 py-1.5 text-[#1f2937]">
                  <div className="flex items-start gap-2">
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-sm border border-[#b9a783]">
                      {item.coverSrc ? (
                        <>
                          <Image src={item.coverSrc} alt={item.title} fill sizes="56px" className="object-cover" />
                          <div className="absolute inset-0 bg-black/45" />
                        </>
                      ) : (
                        <div className="h-full w-full bg-zinc-900/85" />
                      )}
                      <button
                        type="button"
                        aria-label={isPlaying ? "Пауза мастер-канала" : "Плей мастер-канала"}
                        title={item.previewSrc ? "Прослушать мастер-канал" : "Мастер-канал пока не добавлен"}
                        disabled={!item.previewSrc}
                        onClick={() => togglePreview(item)}
                        className={`absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 ${
                          item.previewSrc ? "bg-[#1f2937]/85 text-white hover:bg-[#0f172a]" : "cursor-not-allowed bg-[#475569]/60 text-white/40"
                        }`}
                      >
                        {isPlaying ? (
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                            <rect x="6" y="5" width="4" height="14" rx="1" />
                            <rect x="14" y="5" width="4" height="14" rx="1" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-4 w-4 translate-x-[1px]" fill="currentColor">
                            <path d="M8 5v14l11-7-11-7z" />
                          </svg>
                        )}
                      </button>
                    </div>

                    <Link href={`/sound/${item.slug}`} className="min-w-0 flex-1 rounded-sm px-1 py-0.5 hover:bg-[#eadfca]">
                      <div className="truncate text-[16px] leading-5 text-[#1f2937]">
                        <span className="font-semibold text-[#0f172a]">{item.title}</span>
                        {hasValue(item.genre) ? <span className="text-[#334155]">, {item.genre}</span> : null}
                      </div>
                      {hasValue(secondLine) ? <div className="truncate text-[14px] leading-5 text-[#475569]">{secondLine}</div> : null}
                      <span className="hidden" data-modern-performer={item.modernPerformer ?? ""} />
                    </Link>
                  </div>
                </article>
              );
            })}
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
