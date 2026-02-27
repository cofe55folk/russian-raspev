"use client";

import Link from "next/link";
import {
  getArticlesHref,
  getDonateHref,
  getEducationHref,
  getEventsHref,
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

export default function Footer() {
  const { locale, t } = useI18n();

  return (
    <footer className="mt-20 bg-[#11447e] text-white">
      <div className="mx-auto flex w-[min(1200px,94%)] flex-col gap-5 py-7 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-white/90">{t("footer.siteLabel")}</div>
        <nav className="flex flex-wrap items-center gap-5 text-sm">
          {navItems.map((item) => (
            <Link key={item.labelKey} href={item.hrefBuilder(locale)} className="hover:text-[#c9def3]">
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
