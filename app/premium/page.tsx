import Link from "next/link";
import AnalyticsEventOnMount from "../components/analytics/AnalyticsEventOnMount";
import AnalyticsTrackedLink from "../components/analytics/AnalyticsTrackedLink";
import PageHero from "../components/PageHero";
import { readAuthSessionFromCookieStore, sessionHasEntitlement } from "../lib/auth/session";
import {
  COURSE_ITEMS,
  getCoursePremiumEntitlementCode,
  getCourseSubtitle,
  getCourseTitle,
} from "../lib/coursesCatalog";
import { I18N_MESSAGES } from "../lib/i18n/messages";
import { getAuthHref, getEducationCourseHref, getMaterialsHref } from "../lib/i18n/routing";
import { readRequestLocale } from "../lib/i18n/server";

export default async function PremiumPage() {
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;
  const session = await readAuthSessionFromCookieStore();
  const premiumCourses = COURSE_ITEMS.filter((course) => !!getCoursePremiumEntitlementCode(course));
  const unlockedCount = premiumCourses.filter((course) =>
    sessionHasEntitlement(session, getCoursePremiumEntitlementCode(course))
  ).length;

  return (
    <main className="rr-main">
      <PageHero title={t("premium.pageTitle")} subtitle={t("premium.pageSubtitle")} />
      <section className="rr-container mt-8 max-w-4xl space-y-4">
        <div className="rr-article-panel space-y-2 p-5" data-testid="premium-hub-summary">
          <div className="text-sm text-[#aab0bb]">{t("premium.hint")}</div>
          {session ? (
            <div className="text-sm text-[#d7deea]">
              {t("premium.signedInAs")}: <span className="font-semibold">{session.name || session.email || session.userId}</span>
            </div>
          ) : (
            <div className="text-sm text-[#d7deea]" data-testid="premium-signed-out">
              {t("premium.signedOut")}
            </div>
          )}
          <div className="text-sm text-[#8aa6d8]" data-testid="premium-access-count">
            {t("premium.unlockedCount")}: {unlockedCount}/{premiumCourses.length}
          </div>
          <Link href={getMaterialsHref(locale)} className="rr-article-link text-sm" data-testid="premium-open-materials">
            {t("premium.openMaterials")}
          </Link>
          {!session ? (
            <Link href={getAuthHref(locale)} className="rr-article-link text-sm" data-testid="premium-open-auth">
              {t("premium.openAuth")}
            </Link>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {premiumCourses.map((course) => {
            const requiredEntitlement = getCoursePremiumEntitlementCode(course);
            const unlocked = sessionHasEntitlement(session, requiredEntitlement);
            const premiumItemsCount =
              course.premiumVideos.length + course.premiumAudios.length + course.premiumTexts.length;
            return (
              <article
                key={course.id}
                className="rr-article-panel space-y-3 p-5"
                data-testid={`premium-course-${course.slug}`}
              >
                {!unlocked ? (
                  <AnalyticsEventOnMount
                    eventType="paywall_seen"
                    contentType="paywall"
                    contentId={`premium-course:${course.slug}`}
                  />
                ) : null}
                <div className="text-base font-semibold text-[#e6e8ec]">{getCourseTitle(course, locale)}</div>
                {getCourseSubtitle(course, locale) ? (
                  <div className="text-sm text-[#9aa3b2]">{getCourseSubtitle(course, locale)}</div>
                ) : null}
                <div className="text-xs text-[#8aa6d8]">
                  {t("premium.itemsLabel")}: {premiumItemsCount}
                </div>
                <div
                  className={`text-xs ${unlocked ? "text-[#9bd1a7]" : "text-[#f2c58b]"}`}
                  data-testid={`premium-course-status-${course.slug}`}
                >
                  {unlocked ? t("premium.statusUnlocked") : t("premium.statusLocked")}
                </div>
                {requiredEntitlement ? (
                  <div className="text-[11px] text-[#7f8a9d]">
                    {t("premium.entitlementCode")}: {requiredEntitlement}
                  </div>
                ) : null}
                <div className="pt-1">
                  {unlocked ? (
                    <Link
                      href={getEducationCourseHref(locale, course.slug)}
                      className="rr-article-link text-sm"
                      data-testid={`premium-course-link-${course.slug}`}
                    >
                      {t("premium.openCourse")}
                    </Link>
                  ) : (
                    <AnalyticsTrackedLink
                      href={getAuthHref(locale)}
                      className="rr-article-link text-sm"
                      dataTestId={`premium-course-link-${course.slug}`}
                      analyticsEventType="paywall_click"
                      analyticsContentType="paywall"
                      analyticsContentId={`premium-course:${course.slug}`}
                    >
                      {t("premium.unlockCourse")}
                    </AnalyticsTrackedLink>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
