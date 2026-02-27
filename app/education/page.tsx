import Image from "next/image";
import Link from "next/link";
import PageHero from "../components/PageHero";
import EngagementTracker from "../components/analytics/EngagementTracker";
import EducationOffersCarousel from "../components/education/EducationOffersCarousel";
import { COURSE_ITEMS, getCourseSubtitle, getCourseTitle } from "../lib/coursesCatalog";
import {
  MATERIAL_OFFERS,
  getMaterialOfferDescription,
  getMaterialOfferSubtitle,
  getMaterialOfferTitle,
} from "../lib/materialOffers";
import { I18N_MESSAGES } from "../lib/i18n/messages";
import { getEducationCourseHref, getMaterialOfferHref } from "../lib/i18n/routing";
import { readRequestLocale } from "../lib/i18n/server";

export default async function EducationPage() {
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;
  const offerSlides = MATERIAL_OFFERS.map((offer) => ({
    id: offer.id,
    title: getMaterialOfferTitle(offer, locale),
    subtitle: getMaterialOfferSubtitle(offer, locale),
    description: getMaterialOfferDescription(offer, locale),
    href: getMaterialOfferHref(locale, offer.slug),
    coverImageSrc: offer.coverImageSrc,
  }));

  return (
    <main className="rr-main">
      <EngagementTracker contentType="education" contentId="education-catalog" mode="page" />
      <PageHero title={t("education.pageTitle")} subtitle={t("education.pageSubtitle")} />

      <section className="rr-container mt-8 space-y-8">
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-4">
            <h2 className="rr-section-title">{t("education.offersTitle")}</h2>
            <p className="max-w-xl text-right text-sm text-[#9aa3b2]">{t("education.offersSubtitle")}</p>
          </div>
          <EducationOffersCarousel
            slides={offerSlides}
            prevLabel={t("education.offersPrev")}
            nextLabel={t("education.offersNext")}
            openLabel={t("education.offersOpen")}
          />
        </div>

        <div className="relative h-[320px] overflow-hidden rounded-sm">
          <Image src="/hero.jpg" alt={t("education.pageTitle")} fill sizes="100vw" className="object-cover" />
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-0 flex items-end p-6 md:p-8">
            <p className="max-w-3xl text-sm text-white/90 md:text-base">{t("education.catalogHint")}</p>
          </div>
        </div>

        <div>
          <h2 className="rr-section-title mb-4">{t("education.coursesTitle")}</h2>
          <div className="grid gap-5 md:grid-cols-2">
            {COURSE_ITEMS.map((course) => (
              <article key={course.id} className="rounded-sm border border-[#3b3f47] bg-[#20232b] p-5">
                <div className="text-lg font-semibold text-[#e6e8ec]">{getCourseTitle(course, locale)}</div>
                {getCourseSubtitle(course, locale) ? (
                  <div className="mt-2 text-sm text-[#9aa3b2]">{getCourseSubtitle(course, locale)}</div>
                ) : null}
                {course.description ? <p className="mt-3 text-sm text-[#9aa3b2]">{course.description}</p> : null}

                <div className="mt-4">
                  <Link
                    href={getEducationCourseHref(locale, course.slug)}
                    className="rr-primary-btn inline-flex items-center px-4 py-2"
                    data-testid={`education-open-course-${course.slug}`}
                  >
                    {t("education.openCourse")}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
