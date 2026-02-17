import Image from "next/image";
import PageHero from "../components/PageHero";

const events = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  date: "12 марта 2023",
  title: "Название мероприятия может содержать несколько строк",
  description:
    "Студенты Екатерины Белобровой неоднократно принимали участие в фестивалях, концертах, занимали призовые места на конкурсах.",
}));

export default function EventsPage() {
  return (
    <main className="rr-main">
      <PageHero title="События" />
      <section className="rr-container mt-10">
        <div className="grid gap-x-7 gap-y-10 md:grid-cols-3">
          {events.map((event) => (
            <article key={event.id} className="space-y-4">
              <div className="relative h-56 overflow-hidden rounded-sm">
                <Image src="/hero.jpg" alt={event.title} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
              </div>
              <div className="text-sm font-medium text-[#5f82aa]">{event.date}</div>
              <h3 className="rr-card-title">{event.title}</h3>
              <p className="rr-card-text">{event.description}</p>
              <button className="rr-primary-btn px-8 py-3">Подробнее</button>
            </article>
          ))}
        </div>

        <div className="mt-10 flex items-center justify-center gap-2">
          {["1", "2", "3", "4", "5", "6", "7"].map((page) => (
            <button
              key={page}
              className={`rr-pagination-btn ${
                page === "1" ? "rr-pagination-btn-active" : ""
              }`}
            >
              {page}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
