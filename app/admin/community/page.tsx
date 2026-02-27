import PageHero from "../../components/PageHero";
import AdminCommunityModerationClient from "../../components/admin/AdminCommunityModerationClient";
import { I18N_MESSAGES } from "../../lib/i18n/messages";
import { readRequestLocale } from "../../lib/i18n/server";

export default async function AdminCommunityPage() {
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;

  return (
    <main className="rr-main pb-10">
      <PageHero title={t("admin.community.pageTitle")} subtitle={t("admin.community.pageSubtitle")} />
      <section className="rr-container mt-8 max-w-3xl">
        <AdminCommunityModerationClient />
      </section>
    </main>
  );
}
