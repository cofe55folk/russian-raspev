import Image from "next/image"
import MultiTrackPlayer from "./components/MultiTrackPlayer"

export default function Home() {
  return (
    <main className="min-h-screen text-white">

      {/* HERO */}
      <section className="relative h-screen flex items-center justify-center text-center overflow-hidden">
        {/* Background Image */}
        <div className="absolute inset-0">
          <Image
            src="/hero.jpg"
            alt="Evgenij with balalaika"
            fill
            priority
            sizes="100vw"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/80" />

        {/* Content */}
        <div className="relative z-10 max-w-3xl px-6">
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-tight drop-shadow-lg">
            Русский распев
          </h1>

          <p className="mt-6 text-lg md:text-xl text-white/90 leading-relaxed">
            Традиция. Звук. Глубина.
            <br />
            Онлайн-курсы и живые встречи.
          </p>

          <div className="mt-12 flex justify-center gap-6">
            <button className="px-8 py-3 rounded-full bg-white text-black font-medium hover:bg-white/90 transition">
              Смотреть курсы
            </button>

            <button className="px-8 py-3 rounded-full border border-white text-white hover:bg-white/10 transition">
              О проекте
            </button>
          </div>
        </div>
      </section>

      {/* MULTITRACK */}
      <section className="bg-black py-24 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-semibold mb-6">
            🎧 Попробовать многоголосие
          </h2>

          <p className="text-white/70 mb-12">
            Разберите партии отдельно или включите всё вместе —
            почувствуйте структуру традиционного звучания.
          </p>

          <MultiTrackPlayer />
        </div>
      </section>

    </main>
  )
}
