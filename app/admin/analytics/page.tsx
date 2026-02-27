import PageHero from "../../components/PageHero";
import AdminAnalyticsClient from "../../components/admin/AdminAnalyticsClient";
import { I18N_MESSAGES } from "../../lib/i18n/messages";
import { readRequestLocale } from "../../lib/i18n/server";

export default async function AdminAnalyticsPage() {
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;

  return (
    <main className="rr-main pb-10">
      <PageHero title={t("admin.analytics.pageTitle")} subtitle={t("admin.analytics.pageSubtitle")} />
      <section className="rr-container mt-8 max-w-4xl">
        <AdminAnalyticsClient />
      </section>
    </main>
  );
}
