import DonateCheckoutPanel from "../components/DonateCheckoutPanel";
import PageHero from "../components/PageHero";
import { I18N_MESSAGES, type I18nKey } from "../lib/i18n/messages";
import { readRequestLocale } from "../lib/i18n/server";

type PageProps = {
  searchParams: Promise<{ status?: string; amountMinor?: string; interval?: string; mock?: string }>;
};

function normalizeStatus(raw: string | undefined): "success" | "failed" | null {
  if (raw === "success") return "success";
  if (raw === "failed") return "failed";
  return null;
}

function normalizeAmountMinor(raw: string | undefined): number | null {
  if (!raw) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : null;
}

function normalizeInterval(raw: string | undefined): "once" | "monthly" | null {
  if (raw === "once" || raw === "monthly") return raw;
  return null;
}

export default async function DonatePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const locale = await readRequestLocale();
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];
  const status = normalizeStatus(params.status);
  const amountMinor = normalizeAmountMinor(params.amountMinor);
  const interval = normalizeInterval(params.interval);
  const mock = params.mock === "1";
  const preferMock = !(process.env.RR_DONATE_CHECKOUT_URL || "").trim();
  const checkoutMode = preferMock ? "mock" : "external";
  const methods = [
    {
      id: "card",
      logo: "VISA / Mastercard",
      title: t("donate.method.card"),
    },
    {
      id: "mir",
      logo: "MIR",
      title: t("donate.method.mir"),
    },
    {
      id: "paysend",
      logo: "PAYSEND",
      title: t("donate.method.paysend"),
    },
  ];

  return (
    <main className="rr-main" data-testid="donate-page">
      <PageHero title={t("donate.pageTitle")} />

      <section className="rr-container mt-12 text-center">
        <div className="mx-auto max-w-5xl space-y-6">
          <p className="rr-card-text text-lg md:text-xl">
            {t("donate.intro1")}
          </p>
          <p className="rr-card-text text-lg md:text-xl">
            {t("donate.intro2")}
          </p>
          <p className="rr-card-text text-lg md:text-xl">
            {t("donate.intro3")}
          </p>
          <p className="rr-card-text text-lg md:text-xl">
            {t("donate.intro4")}
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

        <DonateCheckoutPanel
          locale={locale}
          status={status}
          amountMinor={amountMinor}
          interval={interval}
          mock={mock}
          preferMock={preferMock}
          checkoutMode={checkoutMode}
        />
      </section>
    </main>
  );
}
