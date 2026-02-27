import Image from "next/image";
import { notFound } from "next/navigation";
import EngagementTracker from "../../components/analytics/EngagementTracker";
import PageHero from "../../components/PageHero";
import CourseContentClient from "../../components/education/CourseContentClient";
import {
  getCourseBySlug,
  getCourseSubtitle,
  getCourseTitle,
} from "../../lib/coursesCatalog";
import { I18N_MESSAGES } from "../../lib/i18n/messages";
import { readRequestLocale } from "../../lib/i18n/server";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EducationCoursePage({ params }: PageProps) {
  const { slug } = await params;
  const course = getCourseBySlug(slug);
  if (!course) return notFound();

  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;
  const subtitle = getCourseSubtitle(course, locale);

  return (
    <main className="rr-main">
      <EngagementTracker contentType="education" contentId={slug} mode="page" />
      <PageHero title={getCourseTitle(course, locale)} subtitle={subtitle || t("education.pageSubtitle")} />

      <section className="rr-container mt-8 space-y-6">
        <div className="relative h-[280px] overflow-hidden rounded-sm">
          <Image
            src={course.heroImageSrc || "/hero.jpg"}
            alt={getCourseTitle(course, locale)}
            fill
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/45" />
          {course.description ? (
            <div className="absolute inset-x-0 bottom-0 p-5 text-sm text-white/90 md:text-base">{course.description}</div>
          ) : null}
        </div>

        <article className="rr-article-panel space-y-6 p-5" data-testid={`course-meta-${slug}`}>
          {course.tagline ? <p className="text-base font-medium text-[#e6e8ec]">{course.tagline}</p> : null}

          <div className="grid gap-3 md:grid-cols-3">
            {course.scheduleLabel ? (
              <div className="rounded-sm border border-[#3b3f47] bg-[#20232b] p-3">
                <div className="text-xs text-[#8aa6d8]">{t("education.course.metaDates")}</div>
                <div className="mt-1 text-sm text-[#d7deea]">{course.scheduleLabel}</div>
              </div>
            ) : null}
            {course.durationLabel ? (
              <div className="rounded-sm border border-[#3b3f47] bg-[#20232b] p-3">
                <div className="text-xs text-[#8aa6d8]">{t("education.course.metaDuration")}</div>
                <div className="mt-1 text-sm text-[#d7deea]">{course.durationLabel}</div>
              </div>
            ) : null}
            {course.formatLabel ? (
              <div className="rounded-sm border border-[#3b3f47] bg-[#20232b] p-3">
                <div className="text-xs text-[#8aa6d8]">{t("education.course.metaFormat")}</div>
                <div className="mt-1 text-sm text-[#d7deea]">{course.formatLabel}</div>
              </div>
            ) : null}
          </div>

          {course.coursePlaylistUrl ? (
            <div className="text-sm">
              <span className="text-[#9aa3b2]">{t("education.course.playlistLabel")}: </span>
              <a
                href={course.coursePlaylistUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rr-article-link"
                data-testid={`course-playlist-${slug}`}
              >
                Kinescope
              </a>
            </div>
          ) : null}

          {course.audience.length ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-[#e6e8ec]">{t("education.course.audienceTitle")}</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-[#d7deea]">
                {course.audience.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {course.outcomes.length ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-[#e6e8ec]">{t("education.course.outcomesTitle")}</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-[#d7deea]">
                {course.outcomes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {course.modules.length ? (
            <section className="space-y-3" data-testid={`course-modules-${slug}`}>
              <h2 className="text-lg font-semibold text-[#e6e8ec]">{t("education.course.modulesTitle")}</h2>
              <div className="space-y-3">
                {course.modules.map((module) => (
                  <article key={module.id} className="rounded-sm border border-[#3b3f47] bg-[#20232b] p-3">
                    <h3 className="text-base font-semibold text-[#e6e8ec]">{module.title}</h3>
                    <p className="mt-1 text-sm text-[#9aa3b2]">{module.summary}</p>
                    <div className="mt-2 text-xs font-semibold text-[#8aa6d8]">
                      {t("education.course.lessonsLabel")}: {module.lessons.length}
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#d7deea]">
                      {module.lessons.map((lesson) => (
                        <li key={`${module.id}-${lesson.id}`}>{lesson.title}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {course.bonuses.length ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-[#e6e8ec]">{t("education.course.bonusesTitle")}</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-[#d7deea]">
                {course.bonuses.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {course.author ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-[#e6e8ec]">{t("education.course.authorTitle")}</h2>
              <div className="rounded-sm border border-[#3b3f47] bg-[#20232b] p-3 text-sm text-[#d7deea]">
                <div className="font-semibold text-[#e6e8ec]">{course.author.name}</div>
                <div className="mt-1">{course.author.bio}</div>
                {course.author.experienceLabel ? <div className="mt-2 text-[#9aa3b2]">{course.author.experienceLabel}</div> : null}
                {course.author.geographyLabel ? <div className="mt-1 text-[#9aa3b2]">{course.author.geographyLabel}</div> : null}
                {course.author.educationLabel ? <div className="mt-1 text-[#9aa3b2]">{course.author.educationLabel}</div> : null}
              </div>
            </section>
          ) : null}

          {course.faq.length ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-[#e6e8ec]">{t("education.course.faqTitle")}</h2>
              <ul className="space-y-2 text-sm text-[#d7deea]">
                {course.faq.map((item) => (
                  <li key={item} className="rounded-sm border border-[#3b3f47] bg-[#20232b] p-3">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>

        <CourseContentClient slug={slug} />
      </section>
    </main>
  );
}
