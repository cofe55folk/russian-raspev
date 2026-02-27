import Link from "next/link";
import PageHero from "../../components/PageHero";
import BookmarksClient from "../../components/account/BookmarksClient";
import { readAuthSessionFromCookieStore } from "../../lib/auth/session";
import { I18N_MESSAGES } from "../../lib/i18n/messages";
import { getAuthHref } from "../../lib/i18n/routing";
import { readRequestLocale } from "../../lib/i18n/server";

export default async function AccountBookmarksPage() {
  const locale = await readRequestLocale();
  const t = (key: keyof (typeof I18N_MESSAGES)["ru"]) => I18N_MESSAGES[locale][key] ?? key;
  const session = await readAuthSessionFromCookieStore();

  return (
    <main className="rr-main pb-10">
      <PageHero title={t("bookmarks.pageTitle")} subtitle={t("bookmarks.pageSubtitle")} />
      <section className="rr-container mt-8">
        {session ? (
          <BookmarksClient />
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
