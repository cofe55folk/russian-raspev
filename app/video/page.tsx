import PageHero from "../components/PageHero";
import Image from "next/image";

const videos = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  title: "Название видео может содержать пару строк текста",
  description:
    "Всё это позволяет, вне зависимости от опыта, расслышать текст и музыкальную фразу, выучить голоса, научиться видеть суть-схему и виртуозно варьировать.",
}));

export default function VideoPage() {
  return (
    <main className="rr-main">
      <PageHero title="Видео" />

      <section className="rr-container mt-10 grid gap-8 lg:grid-cols-[270px_1fr]">
        <aside className="rr-panel h-fit p-4">
          <div className="mb-6">
            <div className="rr-sidebar-title">Поиск</div>
            <input className="rr-input" placeholder="Поиск" />
          </div>

          <div className="rr-sidebar-title">Категории</div>
          <ul className="space-y-1 text-sm text-zinc-700">
            {["Соло", "Дуэт", "Ансамбль", "Acapella", "ВЕК"].map((item) => (
              <li key={item} className={`cursor-pointer rounded-sm px-2 py-1 ${item === "Ансамбль" ? "bg-[#678ab2] text-white" : "hover:bg-zinc-200"}`}>
                · {item}
              </li>
            ))}
          </ul>

          <div className="mt-6 rr-sidebar-title">Плейлисты</div>
        </aside>

        <div>
          <div className="mb-6 flex items-center justify-between text-sm">
            <div className="flex gap-5">
              <button className="rr-tab-active">Лучшее</button>
              <button className="rr-tab">Свежее</button>
            </div>
            <div className="text-zinc-600">Выводить по <span className="font-semibold">6</span> 12 24 36 Все</div>
          </div>

          <div className="grid gap-x-7 gap-y-10 md:grid-cols-2">
            {videos.map((item) => (
              <article key={item.id} className="space-y-3">
                <div className="relative h-64 overflow-hidden rounded-sm">
                  <Image src="/hero.jpg" alt={item.title} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
                  <div className="absolute inset-0 bg-black/35" />
                  <button className="rr-play-btn absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    ▶
                  </button>
                </div>

                <div className="rr-meta">❤ 234 &nbsp;&nbsp; 👁 34</div>
                <h3 className="rr-card-title max-w-lg">{item.title}</h3>
                <p className="rr-card-text max-w-xl">{item.description}</p>
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
