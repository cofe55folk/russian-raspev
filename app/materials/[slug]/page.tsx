import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsEventOnMount from "../../components/analytics/AnalyticsEventOnMount";
import AnalyticsTrackedLink from "../../components/analytics/AnalyticsTrackedLink";
import PageHero from "../../components/PageHero";
import { readAuthSessionFromCookieStore, sessionHasEntitlement } from "../../lib/auth/session";
import { getCheckoutUrlForOffer } from "../../lib/billing/checkout";
import { getCourseByEntitlementCode, getCourseTitle } from "../../lib/coursesCatalog";
import { I18N_MESSAGES, type I18nKey } from "../../lib/i18n/messages";
import { getAccountFeedbackDraftHref, getAuthHref, getEducationCourseHref, getPremiumHref } from "../../lib/i18n/routing";
import { readRequestLocale } from "../../lib/i18n/server";
import {
  getMaterialOfferBySlug,
  getMaterialOfferDescription,
  getMaterialOfferSubtitle,
  getMaterialOfferTitle,
} from "../../lib/materialOffers";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function MaterialOfferPage({ params }: PageProps) {
  const { slug } = await params;
  const offer = getMaterialOfferBySlug(slug);
  if (!offer) return notFound();

  const locale = await readRequestLocale();
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];
  const session = await readAuthSessionFromCookieStore();
  const unlocked = sessionHasEntitlement(session, offer.entitlementCode);
  const title = getMaterialOfferTitle(offer, locale);
  const subtitle = getMaterialOfferSubtitle(offer, locale);
  const description = getMaterialOfferDescription(offer, locale);
  const checkoutUrl = getCheckoutUrlForOffer(offer);
  const linkedCourse = getCourseByEntitlementCode(offer.entitlementCode);
  const authHref = getAuthHref(locale);
  const premiumHref = getPremiumHref(locale);
  const linkedCourseHref = linkedCourse ? getEducationCourseHref(locale, linkedCourse.slug) : null;
  const feedbackHref = getAccountFeedbackDraftHref(locale, {
    channel: "curator",
    contextType: "material_offer",
    contextId: offer.id,
    contextSlug: offer.slug,
    contextTitle: title,
    subject: `${t("feedback.subjectCuratorPrefix")}: ${title}`,
  });

  return (
    <main className="rr-main pb-12">
      <PageHero title={title} subtitle={subtitle} />

      <section className="rr-container mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="rr-article-panel space-y-4 p-5" data-testid={`material-offer-${slug}`}>
          <div
            className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
              unlocked ? "border-[#2d6b43] bg-[#163827] text-[#9fe0b5]" : "border-[#6b4d2d] bg-[#3a2b1b] text-[#ffdca8]"
            }`}
            data-testid="material-offer-status"
          >
            {unlocked ? t("materials.statusUnlocked") : t("materials.statusLocked")}
          </div>

          <p className="text-sm leading-6 text-[#d7deea]">{description}</p>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-[#e6e8ec]">{t("materials.whatIncluded")}</h2>
            <ul className="space-y-2">
              {offer.includes.map((item) => (
                <li key={item.id} className="rounded-lg border border-[#3b3f47] bg-[#20232b] px-3 py-2">
                  <div className="text-sm font-semibold text-[#e6e8ec]">{item.title}</div>
                  <div className="text-xs text-[#9aa3b2]">{item.description}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-xs text-[#9aa3b2]">
            {t("materials.entitlementCode")}: {offer.entitlementCode}
          </div>
        </article>

        <aside className="space-y-4">
          <div className="rr-article-panel space-y-3 p-5" data-testid="material-offer-preview">
            <h2 className="text-lg font-semibold text-[#e6e8ec]">{t("materials.preview")}</h2>
            <ul className="space-y-2 text-sm text-[#d7deea]">
              {offer.previewBullets.map((item) => (
                <li key={item} className="rounded-lg border border-[#3b3f47] bg-[#20232b] px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rr-article-panel space-y-3 p-5" data-testid="material-offer-cta">
            {unlocked ? (
              <>
                <div className="text-sm text-[#d7deea]">{t("materials.unlockedHint")}</div>
                {linkedCourse ? (
                  <Link href={linkedCourseHref || "/education"} className="rr-article-link text-sm" data-testid="material-offer-open-course">
                    {t("materials.openCourse")}: {getCourseTitle(linkedCourse, locale)}
                  </Link>
                ) : (
                  <div className="text-sm text-[#9aa3b2]">{t("materials.comingSoonHint")}</div>
                )}
                <Link href={feedbackHref} className="rr-article-link text-sm" data-testid="material-offer-curator-link">
                  {t("education.content.askCurator")}
                </Link>
                <Link href={premiumHref} className="rr-article-link text-sm">
                  {t("materials.openPremiumHub")}
                </Link>
              </>
            ) : (
              <>
                <AnalyticsEventOnMount
                  eventType="paywall_seen"
                  contentType="paywall"
                  contentId={`material:${offer.slug}`}
                />
                <div className="text-sm text-[#d7deea]">{t("materials.lockedHint")}</div>
                <div className="text-sm text-[#9aa3b2]">{t("materials.purchaseHint")}</div>
                {!session ? (
                  <AnalyticsTrackedLink
                    href={authHref}
                    className="rr-article-link text-sm"
                    analyticsEventType="paywall_click"
                    analyticsContentType="paywall"
                    analyticsContentId={`material:${offer.slug}`}
                  >
                    {t("materials.unlockCta")}
                  </AnalyticsTrackedLink>
                ) : checkoutUrl ? (
                  <a
                    href={checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rr-article-link text-sm"
                    data-testid="material-offer-checkout-link"
                  >
                    {t("materials.buyNow")}
                  </a>
                ) : (
                  <div className="text-xs text-[#9aa3b2]" data-testid="material-offer-checkout-pending">
                    {t("materials.checkoutPending")}
                  </div>
                )}
                {linkedCourse ? (
                  <div className="text-xs text-[#9aa3b2]">
                    {t("materials.openCourse")}: {getCourseTitle(linkedCourse, locale)}
                  </div>
                ) : null}
                <Link href={feedbackHref} className="rr-article-link text-sm" data-testid="material-offer-curator-link">
                  {t("education.content.askCurator")}
                </Link>
                <Link href={premiumHref} className="rr-article-link text-sm">
                  {t("materials.openPremiumHub")}
                </Link>
              </>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
