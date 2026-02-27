"use client";

import PageHero from "../../components/PageHero";
import SongTabs from "../../components/SongTabs";
import SoundCardPlayerSlot from "../../components/SoundCardPlayerSlot";

const content = {
  text: ["Потеряла я колечко"],
  textColumns: [
    [
      "Потеряла я колечко —",
      "Потеряла я любовь.",
      "Как за это за колечко",
      "Мил заставил век страдать.",
      "Я страдать так — не страдала,",
      "Много горя приняла.",
      "Много слез я пролила",
      "Через милого дружка.",
    ],
    [
      "Патеряла я калеч(и)ка —",
      "Пате(е)ря(я)ла, да толька, я любовь,",
      "Ох, любов(и), да наве(е)р(ы)на_(а), ой да,",
      "Па(я)теря(я)ла, да толька, я любовь.",
      "Как за это за калеч(и)ка",
      "Мил зас(ы)та(я)вил(ы), толька, век страдать.",
      "Ох, страдат(и), да наве(е)р(ы)на_(а), ой да,",
      "Мил(ы)-та заста(я)вил(ы), толька, век страдать.",
      "Ох, я страдать так — не страда(я)ла.",
      "Многа ши го(ё)ря, да толька, приняла,",
      "Приняла ши, да наве(е)р(ы)на_(а), ой да,",
      "Мно(ё)га слёз(ы)-та, да толька, пралила.",
      "Ах, многа слез и многа горя",
      "Через(ы) ми(и)лы(и)ва сваво да дружка,",
      "Ох, дружка ши, да наве(е)р(ы)на_(а), ой да,",
      "Через ми(и)лава сваво ли да дружка.",
    ],
  ],
  expanded: [],
  notes: [],
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
        <SoundCardPlayerSlot slug="talbakul-poteryala-ya-kolechko" />
      </section>

      <SongTabs
        content={content}
        textColumns={content.textColumns}
        textColumnGroupSizes={[2, 4]}
        showPlayer={false}
        storageVersion="talbakul-v3"
      />
    </main>
  );
}
