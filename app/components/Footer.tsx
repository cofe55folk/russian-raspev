import Link from "next/link";

const navItems = [
  { href: "/video", label: "Видео" },
  { href: "/sound", label: "Звук" },
  { href: "/education", label: "Обучение" },
  { href: "/events", label: "События" },
  { href: "/donate", label: "Донат" },
  { href: "/map", label: "Карта" },
];

export default function Footer() {
  return (
    <footer className="mt-20 bg-[#11447e] text-white">
      <div className="mx-auto flex w-[min(1200px,94%)] flex-col gap-5 py-7 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-white/90">Русский распев</div>
        <nav className="flex flex-wrap items-center gap-5 text-sm">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-[#c9def3]">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
