"use client";

import MultiTrackPlayer, { type TrackDef } from "../../components/MultiTrackPlayer";
import PageHero from "../../components/PageHero";
import SongTabs from "../../components/SongTabs";

const tracks: TrackDef[] = [
  { name: "По морям 01", src: "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-01.m4a" },
  { name: "По морям 02", src: "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-02.m4a" },
  { name: "По морям 03", src: "/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-03.m4a" },
];

const content = {
  text: [
    "По морям",
    "Жанр: лирическая протяжная.",
    "Локализация: с. Богословка Зырянского района Томской области.",
  ],
  expanded: ["Распетый текст будет добавлен после загрузки финального текста."],
  notes: ["Нотная расшифровка будет добавлена позже."],
  about: ["В карточке подключены 3 мультитрек-дорожки записи."],
};

export default function TomskBogoslovkaPoMoryamPage() {
  return (
    <main className="rr-main">
      <PageHero
        title="По морям"
        subtitle="с. Богословка Зырянского района Томской области · жанр: лирическая протяжная"
      />

      <section className="rr-container">
        <MultiTrackPlayer tracks={tracks} />
      </section>

      <SongTabs content={content} showPlayer={false} />
    </main>
  );
}

