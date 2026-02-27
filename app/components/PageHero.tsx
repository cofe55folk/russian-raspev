"use client";

import Image from "next/image";
import BackButton from "./BackButton";
import SoundCardHeroAction from "./SoundCardHeroAction";
import { useI18n } from "./i18n/I18nProvider";

type PageHeroProps = {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  backHref?: string;
};

export default function PageHero({ title, subtitle, showBack = true, backHref }: PageHeroProps) {
  const { t } = useI18n();

  return (
    <section className="relative pt-28">
      <div className="relative h-[250px] overflow-hidden">
        <Image
          src="/hero.jpg"
          alt={t("pageHero.alt")}
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ pointerEvents: "none" }}
        />
        <div className="absolute inset-0 bg-black/55" style={{ pointerEvents: "none" }} />
        <div className="rr-container relative flex h-full flex-col items-start justify-center">
          {showBack ? <div className="mb-4"><BackButton href={backHref} /></div> : null}
          <h1 className="text-4xl font-semibold text-white md:text-5xl">{title}</h1>
          {subtitle ? <p className="mt-3 max-w-2xl text-base text-white/80 md:text-lg">{subtitle}</p> : null}
          <SoundCardHeroAction />
        </div>
      </div>
    </section>
  );
}
