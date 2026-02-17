import Image from "next/image";
import PageHero from "../components/PageHero";

const menuItems = [
  "Индивидуальный вокал и групповые занятия",
  "Видеокурсы",
  "Марафоны",
  "Обучающие ролики",
  "Лекции и мастер-классы",
  "Полезная литература",
  "Веб-ресурсы",
];

const benefits = [
  "Поставить голос с нуля",
  "Расслабление зажимов в вокальном аппарате",
  "Восстановление голосового аппарата",
];

const formats = [
  "Индивидуальное занятие",
  "Групповое занятие (курс)",
  "Работа с вашим ансамблем",
  "Видеокурс",
  "Марафон",
];

export default function EducationPage() {
  return (
    <main className="rr-main">
      <PageHero title="Обучение" />

      <section className="rr-container mt-8 space-y-8">
        <div className="relative h-[420px] overflow-hidden rounded-sm">
          <Image src="/hero.jpg" alt="Обучение" fill sizes="100vw" className="object-cover" />
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
            <h2 className="max-w-3xl text-3xl font-semibold leading-tight md:text-4xl">
              Название видео может содержать пару строк текста
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-white/85">
              Всё это позволяет, вне зависимости от опыта, расслышать текст и музыкальную фразу, выучить голоса,
              научиться видеть суть-схему и виртуозно варьировать.
            </p>
            <button className="rr-play-btn mt-5">▶</button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-3">
            {menuItems.map((item) => (
              <button
                key={item}
                className={`w-full rounded-sm px-4 py-3 text-sm ${
                  item === "Индивидуальный вокал и групповые занятия"
                    ? "rr-primary-btn"
                    : "bg-[#e1e1e1] text-zinc-800 hover:bg-[#d5d5d5]"
                }`}
              >
                {item}
              </button>
            ))}
          </aside>

          <div className="space-y-7">
            <div className="grid gap-4 md:grid-cols-3">
              {benefits.map((item) => (
                <div key={item} className="rounded-sm bg-[#e7e7e7] p-5">
                  <div className="text-xl font-semibold leading-tight">{item}</div>
                </div>
              ))}
            </div>

            <div className="space-y-4 text-zinc-700">
              <p className="text-base leading-7 md:text-lg">
                Ты новичок, давно поющий или опытный вокалист (фольклорист), желаешь расширить свои вокальные
                возможности?
              </p>
              <p className="text-base leading-7 md:text-lg">
                Мечтаешь улучшить технику, научиться петь свободно и легко? Говорить выразительно и убедительно?
                Чувствовать музыку, вести слушателя вслед за фразой?
              </p>
              <button className="rr-primary-btn px-8 py-3">Напиши мне</button>
              <p className="text-base leading-7 md:text-lg">
                Благодаря авторской методике работы с голосом уже на первых занятиях определяются ваши голосовые
                проблемы и подбирается курс для их устранения.
              </p>
            </div>

            <div>
              <h3 className="rr-section-title mb-4">Возможные форматы обучения</h3>
              <div className="grid gap-3 md:grid-cols-5">
                {formats.map((item) => (
                  <div key={item} className="rr-primary-btn p-3 text-center text-sm">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="rr-section-title mb-4">Действующие группы</h3>
              <div className="grid gap-5 md:grid-cols-2">
                <article className="overflow-hidden rounded-sm bg-[#e7e7e7]">
                  <div className="relative h-52">
                    <Image src="/hero.jpg" alt="Мужская группа" fill sizes="50vw" className="object-cover" />
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="rr-card-title">Мужская группа</div>
                    <button className="rr-primary-btn px-5 py-2">Подробнее</button>
                  </div>
                </article>

                <article className="overflow-hidden rounded-sm bg-[#e7e7e7]">
                  <div className="relative h-52">
                    <Image src="/hero.jpg" alt="Женская группа" fill sizes="50vw" className="object-cover" />
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="rr-card-title">Женская группа</div>
                    <button className="rr-primary-btn px-5 py-2">Подробнее</button>
                  </div>
                </article>
              </div>
            </div>

            <div>
              <h3 className="rr-section-title mb-4">Отзывы о занятиях</h3>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-sm bg-[#e7e7e7] p-5">
                  <div className="mb-2 rr-card-title">Иван Иванов</div>
                  <p className="rr-card-text">
                    Рыбатекст используется дизайнерами, проектировщиками и фронтендерами, когда нужно быстро заполнить
                    макеты и проверить структуру блока.
                  </p>
                </div>

                <div className="overflow-hidden rounded-sm bg-[#e7e7e7]">
                  <div className="relative h-48">
                    <Image src="/hero.jpg" alt="Отзыв" fill sizes="50vw" className="object-cover" />
                    <div className="absolute inset-0 bg-black/35" />
                    <button className="rr-play-btn absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                      ▶
                    </button>
                  </div>
                  <div className="p-4">
                    <div className="rr-card-title">Иван Иванов</div>
                    <p className="rr-card-text">Короткий видео-отзыв о курсе.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
