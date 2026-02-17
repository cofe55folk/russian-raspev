import Image from "next/image";
import PageHero from "../components/PageHero";

const genres = ["Протяжная", "Хороводная", "Свадебная", "Плясовая", "Величальная", "Историческая", "Былинная", "Духовный стих"];

const pins = [
  { left: "24%", top: "22%" },
  { left: "48%", top: "17%" },
  { left: "66%", top: "31%" },
  { left: "52%", top: "46%" },
  { left: "30%", top: "39%" },
  { left: "60%", top: "61%" },
  { left: "35%", top: "71%" },
  { left: "75%", top: "55%" },
  { left: "84%", top: "42%" },
];

export default function MapPage() {
  return (
    <main className="rr-main">
      <PageHero title="Карта" />

      <section className="rr-container mt-10 grid gap-7 lg:grid-cols-[290px_1fr]">
        <aside className="rr-panel h-fit p-4">
          <div className="mb-5">
            <div className="rr-sidebar-title">Поиск</div>
            <input className="rr-input" placeholder="Поиск" />
          </div>

          <div className="rr-sidebar-title">Категории</div>
          <button className="mb-4 w-full rounded-sm bg-zinc-200 px-3 py-2 text-left text-sm">Показать</button>

          <div className="rr-sidebar-title">Этнографический регион</div>
          <button className="mb-4 w-full rounded-sm bg-zinc-200 px-3 py-2 text-left text-sm">Показать</button>

          <div className="rr-sidebar-title">Жанр</div>
          <ul className="space-y-1 text-sm text-zinc-700">
            {genres.map((genre) => (
              <li key={genre} className="rounded-sm px-2 py-1 hover:bg-zinc-200">
                · {genre}
              </li>
            ))}
          </ul>
        </aside>

        <div className="relative h-[820px] overflow-hidden rounded-sm border border-black/8 bg-[#d3d8dc]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#dfe5ea,transparent_40%),radial-gradient(circle_at_80%_40%,#c4cdd4,transparent_35%),radial-gradient(circle_at_50%_75%,#bec8cf,transparent_35%)]" />
          <div className="absolute left-[15%] top-[12%] h-[2px] w-[70%] rotate-[11deg] bg-[#9eb3c5]/70" />
          <div className="absolute left-[8%] top-[52%] h-[2px] w-[80%] rotate-[-7deg] bg-[#9eb3c5]/70" />
          <div className="absolute left-[33%] top-[8%] h-[78%] w-[2px] rotate-[16deg] bg-[#8ba8c1]/70" />
          <div className="absolute left-[63%] top-[6%] h-[84%] w-[2px] rotate-[-10deg] bg-[#8ba8c1]/70" />

          {pins.map((pin) => (
            <button
              key={`${pin.left}-${pin.top}`}
              className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#527ba5] ring-4 ring-white/70"
              style={{ left: pin.left, top: pin.top }}
              aria-label="Точка на карте"
            />
          ))}

          <div className="absolute right-8 top-24 w-52 overflow-hidden rounded-sm bg-white shadow-md">
            <div className="relative h-32">
              <Image src="/hero.jpg" alt="Селезень сиз-косастый" fill sizes="220px" className="object-cover" />
            </div>
            <div className="p-3">
              <div className="rr-meta">❤ 234 &nbsp;&nbsp; 👁 34</div>
              <div className="rr-card-title mt-1">Селезень сиз-косастый</div>
              <div className="rr-card-text">с. Крутиха, Кыштовский район</div>
            </div>
          </div>

          <div className="absolute bottom-8 left-8 w-48 rounded-sm bg-white p-3 text-sm text-zinc-700 shadow-md">
            <div className="mb-2 rr-card-title">село Крутиха</div>
            <ul className="space-y-1 rr-card-text">
              <li>Селезень сиз-косастый</li>
              <li>Кыштовский район</li>
              <li>Новосибирская область</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
