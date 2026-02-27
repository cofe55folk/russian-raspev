import Link from "next/link";
import PageHero from "../components/PageHero";
import { readAuthSessionFromCookieStore, sessionHasEntitlement } from "../lib/auth/session";
import { getCheckoutUrlForOffer } from "../lib/billing/checkout";
import { getCourseByEntitlementCode } from "../lib/coursesCatalog";
import { I18N_MESSAGES, type I18nKey } from "../lib/i18n/messages";
import { getAuthHref, getEducationCourseHref, getMaterialOfferHref, getPremiumHref } from "../lib/i18n/routing";
import { readRequestLocale } from "../lib/i18n/server";
import {
  MATERIAL_OFFERS,
  getMaterialOfferDescription,
  getMaterialOfferSubtitle,
  getMaterialOfferTitle,
} from "../lib/materialOffers";

export default async function MaterialsPage() {
  const locale = await readRequestLocale();
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];
  const session = await readAuthSessionFromCookieStore();

  return (
    <main className="rr-main pb-12">
      <PageHero title={t("materials.pageTitle")} subtitle={t("materials.pageSubtitle")} />

      <section className="rr-container mt-8 space-y-4">
        <div className="rr-article-panel space-y-2 p-4 text-sm text-[#d7deea]">
          <div>{t("materials.catalogHint")}</div>
          {!session ? (
            <Link href={getAuthHref(locale)} className="rr-article-link text-sm" data-testid="materials-auth-link">
              {t("materials.unlockCta")}
            </Link>
          ) : (
            <Link href={getPremiumHref(locale)} className="rr-article-link text-sm" data-testid="materials-premium-link">
              {t("materials.openPremiumHub")}
            </Link>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {MATERIAL_OFFERS.map((offer) => {
            const unlocked = sessionHasEntitlement(session, offer.entitlementCode);
            const linkedCourse = getCourseByEntitlementCode(offer.entitlementCode);
            const checkoutUrl = getCheckoutUrlForOffer(offer);
            return (
              <article key={offer.id} className="rr-article-panel space-y-3 p-5" data-testid={`materials-card-${offer.slug}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-[#e6e8ec]">{getMaterialOfferTitle(offer, locale)}</h2>
                  <div
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      unlocked ? "bg-[#1f5b3b] text-[#b9f7d3]" : "bg-[#5d3a23] text-[#ffd9b5]"
                    }`}
                  >
                    {unlocked ? t("materials.statusUnlocked") : t("materials.statusLocked")}
                  </div>
                </div>
                <p className="text-sm text-[#9aa3b2]">{getMaterialOfferSubtitle(offer, locale)}</p>
                <p className="text-sm text-[#d7deea]">{getMaterialOfferDescription(offer, locale)}</p>
                <div className="text-xs text-[#8aa6d8]">
                  {t("materials.entitlementCode")}: {offer.entitlementCode}
                </div>
                <Link
                  href={getMaterialOfferHref(locale, offer.slug)}
                  className="rr-article-link text-sm"
                  data-testid={`materials-open-${offer.slug}`}
                >
                  {t("materials.openCard")}
                </Link>
                {!unlocked && session && checkoutUrl ? (
                  <a
                    href={checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rr-article-link text-sm"
                    data-testid={`materials-checkout-${offer.slug}`}
                  >
                    {t("materials.buyNow")}
                  </a>
                ) : null}
                {!unlocked && session && !checkoutUrl ? (
                  <div className="text-xs text-[#9aa3b2]" data-testid={`materials-checkout-pending-${offer.slug}`}>
                    {t("materials.checkoutPending")}
                  </div>
                ) : null}
                {unlocked && linkedCourse ? (
                  <Link
                    href={getEducationCourseHref(locale, linkedCourse.slug)}
                    className="rr-article-link text-sm"
                    data-testid={`materials-open-course-${offer.slug}`}
                  >
                    {t("materials.openCourse")}
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
