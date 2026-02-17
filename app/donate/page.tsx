import PageHero from "../components/PageHero";

const methods = [
  {
    id: "card",
    logo: "VISA / Mastercard",
    title: "Перевод на банковскую карту",
  },
  {
    id: "mir",
    logo: "МИР",
    title: "Платежная система МИР",
  },
  {
    id: "paysend",
    logo: "PAYSEND",
    title: "Перевод через Paysend",
  },
];

export default function DonatePage() {
  return (
    <main className="rr-main">
      <PageHero title="Поддержи проект" />

      <section className="rr-container mt-12 text-center">
        <div className="mx-auto max-w-5xl space-y-6">
          <p className="rr-card-text text-lg md:text-xl">
            Этот проект призван помочь людям в поиске «себя», «своего родного» — «самоидентичности».
          </p>
          <p className="rr-card-text text-lg md:text-xl">
            Дать простой, доступный инструмент для изучения богатейшей культуры нашего народа.
          </p>
          <p className="rr-card-text text-lg md:text-xl">
            Автор проекта регулярно обновляет и совершенствует форматы и качество записи.
          </p>
          <p className="rr-card-text text-lg md:text-xl">
            Ваша финансовая поддержка позволит нам больше времени уделять созданию новых материалов и образовательных
            курсов.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {methods.map((method) => (
            <article key={method.id} className="rr-panel p-8">
              <div
                className={`mb-5 text-3xl font-bold md:text-4xl ${
                  method.id === "mir"
                    ? "text-[#4ca345]"
                    : method.id === "paysend"
                    ? "text-[#7a58d6]"
                    : "text-[#2f5d92]"
                }`}
              >
                {method.logo}
              </div>
              <h3 className="rr-card-title md:text-3xl">{method.title}</h3>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
