"use client";

import PageHero from "../../components/PageHero";
import SongTabs from "../../components/SongTabs";
import SoundCardPlayerSlot from "../../components/SoundCardPlayerSlot";

const content = {
  text: [
    "Гуленька ты мой голубочек,",
    "Сизокрыленький ты мой воркуночек.",
    "Что ж ты в гости ко мне не летаешь?",
    "Разве домичка ты моего не знаешь?",
    "Я сижу-то в такой большой неволе,",
    "Крылушечки мои дождик мочит,",
    "Голосочек мой ветерком относит.",
  ],
  expanded: [],
  notes: [],
  about: [
    "Жанр: лирическая протяжная.",
    "Локализация: село Варюхино Юргинского района Кемеровской области.",
    "Записал: А.М. Мехнецов, 1968 год.",
  ],
};

export default function KemerovVaryuhinoGulenkaPage() {
  return (
    <main className="rr-main">
      <PageHero
        title="Гуленька ты мой голубочек"
        subtitle="село Варюхино Юргинского района Кемеровской области · жанр: лирическая протяжная"
      />

      <section className="rr-container">
        <SoundCardPlayerSlot slug="kemerov-varyuhino-gulenka" />
      </section>

      <SongTabs content={content} showPlayer={false} storageVersion="gulenka-v2" />
    </main>
  );
}
