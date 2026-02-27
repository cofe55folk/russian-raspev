"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import GlobalMiniPlayer from "./GlobalMiniPlayer";
import HeaderSearch from "./HeaderSearch";
import {
  getArticlesHref,
  getAuthHref,
  getDonateHref,
  getEducationHref,
  getEventsHref,
  getHomeHref,
  getSearchHref,
  localizeHref,
  getMapHref,
  getSoundHref,
  getVideoHref,
} from "../lib/i18n/routing";
import { useI18n } from "./i18n/I18nProvider";

const navItems = [
  { hrefBuilder: getVideoHref, labelKey: "nav.video" },
  { hrefBuilder: getSoundHref, labelKey: "nav.sound" },
  { hrefBuilder: getEducationHref, labelKey: "nav.education" },
  { hrefBuilder: getArticlesHref, labelKey: "nav.articles" },
  { hrefBuilder: getEventsHref, labelKey: "nav.events" },
  { hrefBuilder: getDonateHref, labelKey: "nav.donate" },
  { hrefBuilder: getMapHref, labelKey: "nav.map" },
] as const;

function isActivePath(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

function getNextLocale(locale: "ru" | "en") {
  return locale === "ru" ? "en" : "ru";
}

function localeLabel(locale: "ru" | "en") {
  return locale.toUpperCase();
}

function localeTitle(locale: "ru" | "en") {
  return locale === "ru" ? "RU -> EN" : "EN -> RU";
}

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const nextLocale = getNextLocale(locale);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const switchLocale = () => {
    const query = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const current = `${pathname || "/"}${query}${hash}`;
    const target = localizeHref(current, nextLocale);
    setLocale(nextLocale);
    if (target !== current) {
      window.location.assign(target);
      return;
    }
    router.refresh();
  };

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileMenuOpen]);

  const mobileMenuAria = mobileMenuOpen ? t("header.mobileMenuClose") : t("header.mobileMenuOpen");

  return (
    <header className="fixed inset-x-0 top-0 z-50 text-white">
      <div className="rr-top-shell mx-auto mt-3 flex w-[min(1200px,94%)] items-center justify-between px-3 py-2.5 md:mt-4 md:px-6 md:py-3">
        <Link href={getHomeHref(locale)} className="truncate text-xl font-semibold tracking-wide md:text-3xl">
          {t("site.name")}
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          {navItems.map((item) => {
            const href = item.hrefBuilder(locale);
            const isActive = isActivePath(pathname, href);
            return (
              <Link
                key={item.labelKey}
                href={href}
                className={`transition ${isActive ? "text-[#7ea4cd]" : "text-white hover:text-[#7ea4cd]"}`}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden sm:block">
            <GlobalMiniPlayer />
          </div>
          <div className="hidden sm:block">
            <HeaderSearch />
          </div>
          <button
            aria-label={t("header.languageAria")}
            title={localeTitle(locale)}
            className="text-xs text-white/90 hover:text-white md:text-sm"
            onClick={switchLocale}
          >
            {localeLabel(locale)}
          </button>
          <Link
            href={getAuthHref(locale)}
            aria-label={t("header.signInAria")}
            className="rounded-md bg-[#5f82aa] px-3 py-1.5 text-sm font-medium hover:bg-[#7398c2] md:px-4 md:py-2"
          >
            {t("header.signIn")}
          </Link>
          <button
            type="button"
            aria-label={mobileMenuAria}
            aria-expanded={mobileMenuOpen}
            aria-controls="rr-mobile-menu"
            className="grid h-9 w-9 place-items-center rounded-md border border-white/20 bg-white/5 text-white/90 hover:bg-white/10 md:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <span className="sr-only">{mobileMenuAria}</span>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileMenuOpen ? (
                <>
                  <path d="M6 6l12 12" />
                  <path d="M18 6 6 18" />
                </>
              ) : (
                <>
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-hidden={!mobileMenuOpen}
        tabIndex={mobileMenuOpen ? 0 : -1}
        className={`fixed inset-0 z-40 bg-black/50 transition md:hidden ${
          mobileMenuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMobileMenuOpen(false)}
      />
      <nav
        id="rr-mobile-menu"
        className={`fixed inset-x-3 top-[72px] z-50 rounded-xl border border-white/15 bg-[#111722]/95 p-3 shadow-2xl backdrop-blur-xl transition md:hidden ${
          mobileMenuOpen ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
        }`}
      >
        <div className="grid gap-2">
          <Link
            href={getSearchHref(locale)}
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/90 hover:bg-white/10"
          >
            {t("header.search")}
          </Link>
          {navItems.map((item) => {
            const href = item.hrefBuilder(locale);
            const isActive = isActivePath(pathname, href);
            return (
              <Link
                key={item.labelKey}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className={`rounded-md px-3 py-2 text-sm transition ${
                  isActive ? "bg-[#5f82aa]/35 text-white" : "bg-white/5 text-white/90 hover:bg-white/10"
                }`}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>
      <GlobalMiniPlayer mobile />
    </header>
  );
}
