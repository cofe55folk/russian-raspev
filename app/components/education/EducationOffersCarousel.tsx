"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type OfferSlide = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  href: string;
  coverImageSrc?: string;
};

type EducationOffersCarouselProps = {
  slides: OfferSlide[];
  prevLabel: string;
  nextLabel: string;
  openLabel: string;
};

const AUTO_ROTATE_MS = 5500;

export default function EducationOffersCarousel({
  slides,
  prevLabel,
  nextLabel,
  openLabel,
}: EducationOffersCarouselProps) {
  const total = slides.length;
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (total <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((value) => (value + 1) % total);
    }, AUTO_ROTATE_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [total]);

  const normalizedIndex = total ? activeIndex % total : 0;
  const activeSlide = useMemo(() => slides[normalizedIndex] ?? null, [normalizedIndex, slides]);

  if (!activeSlide) return null;

  return (
    <div className="space-y-3" data-testid="education-offers-carousel">
      <div className="relative overflow-hidden rounded-[28px] border border-[#3b3f47] bg-[#1c2028]">
        <div className="relative h-[290px] md:h-[330px]">
          <Image
            src={activeSlide.coverImageSrc || "/hero.jpg"}
            alt={activeSlide.title}
            fill
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/55 to-black/35" />

          <div className="absolute inset-0 flex items-end p-5 md:p-8">
            <div className="max-w-2xl space-y-2">
              <h3 className="text-xl font-semibold text-white md:text-2xl">{activeSlide.title}</h3>
              <p className="text-sm text-white/90 md:text-base">{activeSlide.subtitle}</p>
              <p className="line-clamp-2 text-xs text-white/75 md:text-sm">{activeSlide.description}</p>
              <div className="pt-1">
                <Link
                  href={activeSlide.href}
                  className="inline-flex items-center rounded-full bg-[#ef765f] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#f08a76]"
                  data-testid={`education-offer-open-${activeSlide.id}`}
                >
                  {openLabel}
                </Link>
              </div>
            </div>
          </div>
        </div>

        {total > 1 ? (
          <>
            <button
              type="button"
              onClick={() => setActiveIndex((value) => (value - 1 + total) % total)}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-black/35 px-3 py-2 text-xs font-semibold text-white transition hover:bg-black/50"
              aria-label={prevLabel}
              data-testid="education-offers-prev"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((value) => (value + 1) % total)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-black/35 px-3 py-2 text-xs font-semibold text-white transition hover:bg-black/50"
              aria-label={nextLabel}
              data-testid="education-offers-next"
            >
              →
            </button>
          </>
        ) : null}
      </div>

      {total > 1 ? (
        <div className="flex items-center justify-center gap-2" data-testid="education-offers-dots">
          {slides.map((slide, index) => {
            const isActive = index === normalizedIndex;
            return (
              <button
                key={slide.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`h-2.5 rounded-full transition ${isActive ? "w-8 bg-[#ef765f]" : "w-2.5 bg-white/35 hover:bg-white/55"}`}
                aria-label={`${index + 1}`}
                data-testid={`education-offers-dot-${slide.id}`}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
