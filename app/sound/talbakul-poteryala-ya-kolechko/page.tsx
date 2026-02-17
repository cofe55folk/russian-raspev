"use client";

import MultiTrackPlayer, { type TrackDef } from "../../components/MultiTrackPlayer";
import PageHero from "../../components/PageHero";
import SongTabs from "../../components/SongTabs";

const tracks: TrackDef[] = [
  { name: "Талбакуль 01", src: "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-01.m4a" },
  { name: "Талбакуль 02", src: "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-02.m4a" },
  { name: "Талбакуль 03", src: "/audio/talbakul-poteryala_ya_kolechko/talbakul-poteryala_ya_kolechko-03.m4a" },
];

const content = {
  text: [
    "Потеряла я колечко",
    "Жанр: лирическая протяжная, романс.",
    "Локализация: с. Талбакуль Колосовского района Новосибирской области.",
  ],
  expanded: ["Распетый текст будет добавлен после загрузки финального текста."],
  notes: ["Нотная расшифровка будет добавлена позже."],
  about: ["В карточке подключены 3 мультитрек-дорожки записи."],
};

export default function TalbakulPoteryalaYaKolechkoPage() {
  return (
    <main className="rr-main">
      <PageHero
        title="Потеряла я колечко"
        subtitle="с. Талбакуль Колосовского района Новосибирской области · жанр: лирическая протяжная, романс"
      />

      <section className="rr-container">
        <MultiTrackPlayer tracks={tracks} />
      </section>

      <SongTabs content={content} showPlayer={false} />
    </main>
  );
}

