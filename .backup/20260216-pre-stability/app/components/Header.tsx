export default function Header() {
  return (
    <header className="w-full absolute top-0 left-0 z-50 text-white">
      <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
        <div className="text-xl font-semibold">
          Russian Raspev
        </div>

        <nav className="hidden md:flex gap-6 text-sm font-medium">
          <a href="#">Видео</a>
          <a href="#">Звук</a>
          <a href="#">Обучение</a>
          <a href="#">События</a>
          <a href="#">Донат</a>
          <a href="#">Карта</a>
        </nav>

        <div className="flex items-center gap-6 text-sm">
<button className="cursor-pointer hover:opacity-70 transition">
  🔍
</button>
<button className="cursor-pointer hover:opacity-70 transition">
  🌍
</button>
<button className="cursor-pointer hover:opacity-70 transition">
  👤
</button>
        </div>
      </div>
    </header>
  );
}