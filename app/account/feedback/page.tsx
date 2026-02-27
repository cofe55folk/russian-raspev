import Link from "next/link";
import PageHero from "../../components/PageHero";
import FeedbackCenterClient from "../../components/account/FeedbackCenterClient";
import { readAuthSessionFromCookieStore } from "../../lib/auth/session";
import { I18N_MESSAGES } from "../../lib/i18n/messages";
import { getAuthHref } from "../../lib/i18n/routing";
import { readRequestLocale } from "../../lib/i18n/server";

export default async function AccountFeedbackPage() {
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;
  const session = await readAuthSessionFromCookieStore();

  return (
    <main className="rr-main pb-10">
      <PageHero title={t("feedback.pageTitle")} subtitle={t("feedback.pageSubtitle")} />
      <section className="rr-container mt-8">
        {session ? (
          <FeedbackCenterClient />
        ) : (
          <div className="rr-article-panel space-y-3 p-5">
            <div className="text-sm text-[#aab0bb]">{t("feedback.authRequired")}</div>
            <Link href={getAuthHref(locale)} className="rr-article-link text-sm">
              {t("account.openAuth")}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
