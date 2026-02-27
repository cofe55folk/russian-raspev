import PageHero from "../../components/PageHero";
import AdminEventsClient from "../../components/admin/AdminEventsClient";
import { I18N_MESSAGES } from "../../lib/i18n/messages";
import { readRequestLocale } from "../../lib/i18n/server";

export default async function AdminEventsPage() {
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;

  return (
    <main className="rr-main pb-10">
      <PageHero title={t("admin.events.pageTitle")} subtitle={t("admin.events.pageSubtitle")} />
      <section className="rr-container mt-8">
        <AdminEventsClient />
      </section>
    </main>
  );
}
