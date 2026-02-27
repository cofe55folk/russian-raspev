"use client"

import Image from "next/image"
import MultiTrackPlayer from "./components/MultiTrackPlayer"
import { useI18n } from "./components/i18n/I18nProvider"

export default function Home() {
  const { t } = useI18n()

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
            {t("home.heroTitle")}
          </h1>

          <p className="mt-6 text-lg md:text-xl text-white/90 leading-relaxed">
            {t("home.heroSubtitleLine1")}
            <br />
            {t("home.heroSubtitleLine2")}
          </p>

          <div className="mt-12 flex justify-center gap-6">
            <button className="px-8 py-3 rounded-full bg-white text-black font-medium hover:bg-white/90 transition">
              {t("home.watchCourses")}
            </button>

            <button className="px-8 py-3 rounded-full border border-white text-white hover:bg-white/10 transition">
              {t("home.aboutProject")}
            </button>
          </div>
        </div>
      </section>

      {/* MULTITRACK */}
      <section className="bg-black py-24 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-semibold mb-6">
            🎧 {t("home.multitrackTitle")}
          </h2>

          <p className="text-white/70 mb-12">
            {t("home.multitrackDescription")}
          </p>

          <MultiTrackPlayer showControlsBeforeReady />
        </div>
      </section>

    </main>
  )
}
