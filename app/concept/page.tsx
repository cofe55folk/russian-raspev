import Image from "next/image";
import Link from "next/link";
import {
  getEducationHref,
  getHomeHref,
  getSoundHref,
  getSoundTrackHref,
  getVideoHref,
} from "../lib/i18n/routing";
import { readRequestLocale } from "../lib/i18n/server";
import type { Locale } from "../lib/i18n/types";

type PillarRoute = "sound" | "education" | "video";
const pillars = [
  {
    title: "Архив и многодорожечный звук",
    text: "Разбор традиционного многоголосия по партиям: слушать, выключать, заучивать и собирать целое звучание.",
    route: "sound" as const,
  },
  {
    title: "Обучение и практика",
    text: "Видеокурсы, разборы, марафоны и живые занятия по традиционной вокальной технике.",
    route: "education" as const,
  },
  {
    title: "Видео и события",
    text: "Концерты, полевые экспедиции, лекции и календарь мероприятий проекта.",
    route: "video" as const,
  },
];

const features = [
  "Многодорожечный плеер с обучающим суфлером",
  "Карта песенных традиций с поиском по регионам",
  "Разделы для начинающих и опытных исполнителей",
  "Личный бренд + архивная платформа в одном стиле",
];

function resolvePillarHref(route: PillarRoute, locale: Locale): string {
  if (route === "sound") return getSoundHref(locale);
  if (route === "education") return getEducationHref(locale);
  return getVideoHref(locale);
}

export default async function ConceptPage() {
  const locale = await readRequestLocale();

  return (
    <main className="min-h-screen bg-[var(--rr-surface)] text-[var(--rr-ink)] pb-20">
      <section className="relative overflow-hidden rr-brand-gradient text-white pt-28 md:pt-34 pb-16 md:pb-24">
        <div className="absolute inset-0 opacity-20">
          <Image src="/hero.jpg" alt="Русский распев — главный образ" fill priority className="object-cover mix-blend-overlay" />
        </div>
        <div className="rr-container relative grid gap-8 md:grid-cols-[1.1fr_0.9fr] items-end">
          <div>
            <p className="inline-flex rounded-full border border-white/25 px-3 py-1 text-xs tracking-[0.18em] uppercase text-white/85">
              Дизайн-концепт
            </p>
            <h1 className="mt-4 text-4xl md:text-6xl font-semibold leading-[1.06]">
              Русский распев:
              <br />
              личный голос и живой архив
            </h1>
            <p className="mt-5 max-w-2xl text-base md:text-xl text-white/88 leading-relaxed">
              Современный сайт музыканта-исследователя: обучение, события, видео и архив с акцентом на многоголосие.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={getSoundHref(locale)} className="rounded-md bg-[var(--rr-brand-accent)] px-6 py-3 text-sm font-semibold text-[#08192b] hover:brightness-105">
                Открыть раздел Звук
              </Link>
              <Link href={getHomeHref(locale)} className="rounded-md border border-white/35 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10">
                На главную
              </Link>
            </div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-black/20 backdrop-blur p-5 md:p-6">
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">Визуальный вектор</p>
            <ul className="mt-4 space-y-3 text-sm md:text-base text-white/92">
              <li>Глубокий вечерний градиент + теплые акценты.</li>
              <li>Фокус на человеке и голосе как центре проекта.</li>
              <li>Светлые контент-блоки для удобного чтения материалов.</li>
              <li>Собранная типографика и плотные интерфейсные панели.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="rr-container -mt-8 md:-mt-12 relative z-10">
        <div className="grid gap-4 md:grid-cols-3">
          {pillars.map((item) => (
            <article key={item.title} className="rounded-2xl border border-[#cad2dc] bg-[var(--rr-surface-2)] p-5 shadow-[0_10px_28px_rgba(9,22,40,0.08)]">
              <h2 className="text-xl font-semibold">{item.title}</h2>
              <p className="mt-2 text-[15px] leading-7 text-[var(--rr-ink-soft)]">{item.text}</p>
              <Link href={resolvePillarHref(item.route, locale)} className="mt-4 inline-flex text-sm font-semibold text-[#1f4f80] hover:text-[#163f68]">
                Перейти →
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="rr-container mt-12 md:mt-16 grid gap-8 md:grid-cols-[1.25fr_0.75fr]">
        <article className="rounded-2xl border border-[#d4dbe4] bg-white p-6 md:p-8">
          <h3 className="text-3xl font-semibold">Как этот стиль ляжет на весь сайт</h3>
          <p className="mt-4 text-[16px] leading-8 text-[var(--rr-ink-soft)]">
            Главная страница остаётся эмоциональной и личной, а внутренние разделы получают чистую модульную сетку:
            карточки контента, фильтры, боковые панели и плеерные блоки в одном визуальном ритме.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {features.map((feature) => (
              <div key={feature} className="rounded-xl border border-[#dbe2ea] bg-[#f7f9fb] px-4 py-3 text-sm text-[var(--rr-ink)]">
                {feature}
              </div>
            ))}
          </div>
        </article>

        <aside className="rounded-2xl border border-[#1f3f61] bg-[#102b46] p-6 text-white">
          <p className="text-xs uppercase tracking-[0.15em] text-white/65">Дальше по этапам</p>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-white/90">
            <li>1. Зафиксировать палитру, карточки и типографику.</li>
            <li>2. Перенести стиль на страницы Видео/Звук/Обучение.</li>
            <li>3. Полировать плеер, карту, навигацию и адаптив.</li>
            <li>4. Сделать единый UI-kit для быстрых будущих правок.</li>
          </ol>
          <Link href={getSoundTrackHref(locale, "selezen")} className="mt-6 inline-flex rounded-md bg-[var(--rr-brand-accent)] px-4 py-2 text-sm font-semibold text-[#0a1f33] hover:brightness-105">
            Проверить в реальном треке
          </Link>
        </aside>
      </section>
    </main>
  );
}
