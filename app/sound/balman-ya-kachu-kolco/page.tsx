"use client";

import MultiTrackPlayer, { type TrackDef } from "../../components/MultiTrackPlayer";
import PageHero from "../../components/PageHero";
import SongTabs from "../../components/SongTabs";

const tracks: TrackDef[] = [
  { name: "Я качу кольцо 01", src: "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-01.mp3" },
  { name: "Я качу кольцо 02", src: "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-02.mp3" },
  { name: "Я качу кольцо 03", src: "/audio/balman-ya_kachu_kolco/balman-ya_kachu_kolco-03.mp3" },
];

const content = {
  text: [
    "Я качу-качу,",
    "Я качу-качу",
    "Золото кольцо,",
    "Золото кольцо.",
    "",
    "Золото кольцо,",
    "Золото кольцо",
    "Со брильянтами,",
    "Со брильянтами.",
    "",
    "За кольцом идёт,",
    "За кольцом идёт",
    "Добрый молодец,",
    "Добрый молодец.",
    "",
    "За собой ведет,",
    "За собой ведет",
    "Красную девицу",
    "Красную девицу.",
    "",
    "Ты возьми её,",
    "Ты возьми её",
    "За праву руку,",
    "За злото кольцо.",
    "",
    "Проведи её,",
    "Проведи её",
    "Вдоль по горенке,",
    "Вдоль по широкой.",
    "",
    "Ты поставь её,",
    "Ты поставь её",
    "Против маточки,",
    "Против маточки.",
    "",
    "Подойди-ко к ней,",
    "Подойди-ко к ней",
    "Столь близёшенько,",
    "Столь близёшенько.",
    "",
    "Поклонись ты ей,",
    "Поклонись ты ей",
    "Столь низёшенько,",
    "Столь низёшенько",
    "",
    "Поцелуй её,",
    "Поцелуй её",
    "Столь милёшенько,",
    "Столь милёшенько.",
  ],
  expanded: ["Распетый текст и таймкоды для суфлера будут добавлены следующим шагом."],
  notes: ["Нотная расшифровка будет добавлена позже."],
  about: [
    "Жанр: хороводная игровая, вечерочная.",
    "Локализация: с. Балман Куйбышевского района Новосибирской области.",
  ],
};

export default function BalmanYaKachuKolcoPage() {
  return (
    <main className="rr-main">
      <PageHero
        title="Я качу кольцо"
        subtitle="с. Балман Куйбышевского района Новосибирской области · жанр: хороводная игровая, вечерочная"
      />

      <section className="rr-container">
        <MultiTrackPlayer tracks={tracks} />
      </section>

      <SongTabs content={content} showPlayer={false} />
    </main>
  );
}

