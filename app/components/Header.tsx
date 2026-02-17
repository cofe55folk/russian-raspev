"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import GlobalMiniPlayer from "./GlobalMiniPlayer";

const navItems = [
  { href: "/video", label: "Видео" },
  { href: "/sound", label: "Звук" },
  { href: "/education", label: "Обучение" },
  { href: "/events", label: "События" },
  { href: "/donate", label: "Донат" },
  { href: "/map", label: "Карта" },
];

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="fixed inset-x-0 top-0 z-50 text-white">
      <div className="mx-auto mt-4 flex w-[min(1200px,94%)] items-center justify-between rounded-xl border border-white/15 bg-black/45 px-4 py-3 backdrop-blur-md md:px-6">
        <Link href="/" className="text-xl font-semibold tracking-wide md:text-3xl">
          Русский распев
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`transition ${isActive ? "text-[#7ea4cd]" : "text-white hover:text-[#7ea4cd]"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 md:gap-4">
          <GlobalMiniPlayer />
          <button aria-label="Поиск" className="text-sm text-white/90 hover:text-white">
            Поиск
          </button>
          <button aria-label="Выбор языка" className="text-sm text-white/90 hover:text-white">
            Ru
          </button>
          <button
            aria-label="Вход"
            className="rounded-md bg-[#5f82aa] px-4 py-2 text-sm font-medium hover:bg-[#7398c2]"
          >
            Вход
          </button>
        </div>
      </div>
    </header>
  );
}
