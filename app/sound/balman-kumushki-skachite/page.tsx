"use client";

import MultiTrackPlayer, { type TrackDef } from "../../components/MultiTrackPlayer";
import PageHero from "../../components/PageHero";
import SongTabs from "../../components/SongTabs";

const tracks: TrackDef[] = [
  { name: "Кумушки 01", src: "/audio/balman-kumushki_skachite/balman-kumushki_skachite-01.mp3" },
  { name: "Кумушки 02", src: "/audio/balman-kumushki_skachite/balman-kumushki_skachite-02.mp3" },
  { name: "Кумушки 03", src: "/audio/balman-kumushki_skachite/balman-kumushki_skachite-03.mp3" },
];

const content = {
  text: [
    "Кумушки, скачите, да",
    "На меня, младу, ни глядите,",
    "На меня младу ни...",
    "",
    "Ни глядите да,",
    "Уж я, млада, заручёна,",
    "Уж я, млада, за...",
    "",
    "Заручёна, да",
    "Навучёна, подговорёна,",
    "Заручёна, па...",
    "",
    "Подговорёна, да",
    "За детинку малодо(ва),",
    "За детинку ма...",
    "",
    "Малодо(ва), да",
    "Детинушка, малоденек -",
    "Детинушка, ма...",
    "",
    "Малодене(кы),",
    "Умом(ы)-разум(а)м глупенек,",
    "Умом-разум(а)м.",
    "",
    "А глупенек(ы),",
    "Поздн(а) вечер(а)м гуляет,",
    "Поздн(а) вечер(а)м.",
    "",
    "Вечер(а)м гуляет(ы),",
    "Во пол(ы)ночь домой приходит,",
    "Во полночь домой.",
  ],
  expanded: ["Распетый текст и таймкоды для суфлера будут добавлены следующим шагом."],
  notes: ["Нотная расшифровка будет добавлена позже."],
  about: [
    "Жанр: хороводная.",
    "Локализация: с. Балман Куйбышевского района Новосибирской области.",
  ],
};

export default function BalmanKumushkiSkachitePage() {
  return (
    <main className="rr-main">
      <PageHero
        title="Кумушки скачите"
        subtitle="с. Балман Куйбышевского района Новосибирской области · жанр: хороводная"
      />

      <section className="rr-container">
        <MultiTrackPlayer tracks={tracks} />
      </section>

      <SongTabs content={content} showPlayer={false} />
    </main>
  );
}

