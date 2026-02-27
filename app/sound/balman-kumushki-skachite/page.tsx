"use client";

import PageHero from "../../components/PageHero";
import SongTabs from "../../components/SongTabs";
import SoundCardPlayerSlot from "../../components/SoundCardPlayerSlot";

const content = {
  text: [
    "Кумушки, скачите, да",
    "На меня, младу, ни глядите,",
    "На меня младу ни...",
    "Ни глядите да,",
    "Уж я, млада, заручёна,",
    "Уж я, млада, за...",
    "Заручёна, да",
    "Навучёна, подговорёна,",
    "Заручёна, па...",
    "Подговорёна, да",
    "За детинку малодо(ва),",
    "За детинку ма...",
    "Малодо(ва), да",
    "Детинушка, малоденек -",
    "Детинушка, ма...",
    "Малодене(кы),",
    "Умом(ы)-разум(а)м глупенек,",
    "Умом-разум(а)м.",
    "А глупенек(ы),",
    "Поздн(а) вечер(а)м гуляет,",
    "Поздн(а) вечер(а)м.",
    "Вечер(а)м гуляет(ы),",
    "Во пол(ы)ночь домой приходит,",
    "Во полночь домой.",
  ],
  expanded: [],
  notes: [],
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
        <SoundCardPlayerSlot slug="balman-kumushki-skachite" />
      </section>

      <SongTabs content={content} showPlayer={false} textGroupSize={3} textGroupGapClassName="mt-2.5" />
    </main>
  );
}
