"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { emitAnalyticsClientEvent } from "../../lib/analytics/emitClientEvent";
import { ensureAnalyticsSessionId, ensureVisitorId } from "../../lib/analytics/clientIdentity";
import { useI18n } from "../i18n/I18nProvider";
import { getAccountFeedbackDraftHref, getAuthHref } from "../../lib/i18n/routing";

type CourseMediaItem = {
  id: string;
  title: string;
  description?: string;
  src: string;
  provider?: "internal" | "kinescope";
  drmProtected?: boolean;
  durationMin?: number;
  locked?: boolean;
};

type CourseTextItem = {
  id: string;
  title: string;
  description?: string;
  href: string;
  locked?: boolean;
};

type CourseContentResponse = {
  premiumUnlocked: boolean;
  requiredEntitlement: string | null;
  free: {
    videos: CourseMediaItem[];
    audios: CourseMediaItem[];
    texts: CourseTextItem[];
  };
  premium: {
    videos: CourseMediaItem[];
    audios: CourseMediaItem[];
    texts: CourseTextItem[];
  };
};

type BuildCuratorHref = (contextType: "course_video" | "course_audio" | "course_text", item: {
  id: string;
  title: string;
}) => string;

function isExternalMediaSource(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://");
}

function MediaList({
  items,
  type,
  testId,
  lockedLabel,
  minuteLabel,
  openExternalLabel,
  askCuratorLabel,
  buildCuratorHref,
}: {
  items: CourseMediaItem[];
  type: "video" | "audio";
  testId: string;
  lockedLabel: string;
  minuteLabel: string;
  openExternalLabel: string;
  askCuratorLabel: string;
  buildCuratorHref: BuildCuratorHref;
}) {
  const contextType = type === "video" ? "course_video" : "course_audio";

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid={testId}>
      {items.map((item) => (
        <article key={item.id} className="rounded-sm border border-[#3b3f47] bg-[#20232b] p-3">
          <div className="mb-2 text-sm font-semibold text-[#e6e8ec]">{item.title}</div>
          {item.description ? <div className="mb-2 text-xs text-[#9aa3b2]">{item.description}</div> : null}
          {type === "video" ? (
            item.locked || !item.src ? (
              <div className="rounded-sm border border-[#3b3f47] bg-[#161a20] px-3 py-4 text-xs text-[#9aa3b2]">
                {lockedLabel}
              </div>
            ) : isExternalMediaSource(item.src) || item.provider === "kinescope" ? (
              <div className="space-y-2 rounded-sm border border-[#3b3f47] bg-[#161a20] px-3 py-3 text-xs text-[#cdd6e3]">
                {item.provider === "kinescope" || item.drmProtected ? (
                  <div className="text-[11px] text-[#95a5bf]">Kinescope DRM</div>
                ) : null}
                <a
                  href={item.src}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rr-article-link text-xs"
                  data-testid={`${testId}-external-open-${item.id}`}
                >
                  {openExternalLabel}
                </a>
              </div>
            ) : (
              <video controls preload="metadata" className="w-full rounded-sm" src={item.src} />
            )
          ) : item.locked || !item.src ? (
            <div className="rounded-sm border border-[#3b3f47] bg-[#161a20] px-3 py-4 text-xs text-[#9aa3b2]">
              {lockedLabel}
            </div>
          ) : isExternalMediaSource(item.src) || item.provider === "kinescope" ? (
            <div className="space-y-2 rounded-sm border border-[#3b3f47] bg-[#161a20] px-3 py-3 text-xs text-[#cdd6e3]">
              {item.provider === "kinescope" || item.drmProtected ? (
                <div className="text-[11px] text-[#95a5bf]">Kinescope DRM</div>
              ) : null}
              <a
                href={item.src}
                target="_blank"
                rel="noreferrer noopener"
                className="rr-article-link text-xs"
                data-testid={`${testId}-external-open-${item.id}`}
              >
                {openExternalLabel}
              </a>
            </div>
          ) : (
            <audio controls preload="metadata" className="w-full" src={item.src} />
          )}
          {typeof item.durationMin === "number" ? (
            <div className="mt-2 text-[11px] text-[#7f8ba1]">
              ~{item.durationMin} {minuteLabel}
            </div>
          ) : null}
          <div className="mt-2">
            <Link
              href={buildCuratorHref(contextType, item)}
              className="rr-article-link text-xs"
              data-testid={`course-curator-link-${contextType}-${item.id}`}
            >
              {askCuratorLabel}
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

function TextList({
  items,
  testId,
  lockedLabel,
  openLabel,
  askCuratorLabel,
  buildCuratorHref,
}: {
  items: CourseTextItem[];
  testId: string;
  lockedLabel: string;
  openLabel: string;
  askCuratorLabel: string;
  buildCuratorHref: BuildCuratorHref;
}) {
  const isExternalHref = (href: string): boolean => href.startsWith("http://") || href.startsWith("https://");
  return (
    <ul className="space-y-2" data-testid={testId}>
      {items.map((item) => (
        <li key={item.id} className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2">
          <div className="text-sm font-medium text-[#e6e8ec]">{item.title}</div>
          {item.description ? <div className="text-xs text-[#9aa3b2]">{item.description}</div> : null}
          {item.locked || !item.href ? (
            <div className="mt-1 text-xs text-[#9aa3b2]">{lockedLabel}</div>
          ) : isExternalHref(item.href) ? (
            <a
              href={item.href}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex text-xs text-[#9cc4ff] underline-offset-4 hover:underline"
            >
              {openLabel}
            </a>
          ) : (
            <Link href={item.href} className="mt-1 inline-flex text-xs text-[#9cc4ff] underline-offset-4 hover:underline">
              {openLabel}
            </Link>
          )}
          <div className="mt-2">
            <Link
              href={buildCuratorHref("course_text", item)}
              className="rr-article-link text-xs"
              data-testid={`course-curator-link-course_text-${item.id}`}
            >
              {askCuratorLabel}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function CourseContentClient({ slug }: { slug: string }) {
  const { locale, t } = useI18n();
  const [payload, setPayload] = useState<CourseContentResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/courses/${slug}/content`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as CourseContentResponse;
        if (!cancelled) setPayload(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const authHref = useMemo(() => getAuthHref(locale), [locale]);
  const lockedLabel = t("education.content.lockedLabel");
  const openLabel = t("education.content.openLabel");
  const openExternalLabel = t("education.content.openExternal");
  const minuteLabel = t("education.content.minutesShort");
  const askCuratorLabel = t("education.content.askCurator");
  const subjectPrefix = t("feedback.subjectCuratorPrefix");

  const buildCuratorHref = useMemo<BuildCuratorHref>(() => {
    return (contextType, item) =>
      getAccountFeedbackDraftHref(locale, {
        channel: "curator",
        contextType,
        contextId: `${slug}:${item.id}`,
        contextSlug: slug,
        contextTitle: item.title,
        subject: `${subjectPrefix}: ${item.title}`,
      });
  }, [locale, slug, subjectPrefix]);

  useEffect(() => {
    if (!payload || payload.premiumUnlocked) return;
    const visitorId = ensureVisitorId();
    const sessionId = ensureAnalyticsSessionId();
    emitAnalyticsClientEvent({
      eventType: "paywall_seen",
      contentType: "paywall",
      contentId: `course:${slug}`,
      dedupeKey: `paywall-seen:${visitorId}:${sessionId}:course:${slug}`,
    });
  }, [payload, slug]);

  if (loading) {
    return <div className="text-sm text-[#9aa3b2]">{t("education.content.loading")}</div>;
  }
  if (error || !payload) {
    return (
      <div className="rounded-sm border border-[#6a2d2d] bg-[#392021] px-3 py-2 text-sm text-[#f5b4b4]">
        {t("education.content.error")}: {error || "unknown"}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3" data-testid="course-free-section">
        <h2 className="rr-section-title">{t("education.content.freeTitle")}</h2>
        <div className="space-y-3">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("education.content.videos")}</div>
          <MediaList
            items={payload.free.videos}
            type="video"
            testId="course-free-videos"
            lockedLabel={lockedLabel}
            minuteLabel={minuteLabel}
            openExternalLabel={openExternalLabel}
            askCuratorLabel={askCuratorLabel}
            buildCuratorHref={buildCuratorHref}
          />
        </div>
        <div className="space-y-3">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("education.content.audios")}</div>
          <MediaList
            items={payload.free.audios}
            type="audio"
            testId="course-free-audios"
            lockedLabel={lockedLabel}
            minuteLabel={minuteLabel}
            openExternalLabel={openExternalLabel}
            askCuratorLabel={askCuratorLabel}
            buildCuratorHref={buildCuratorHref}
          />
        </div>
        <div className="space-y-3">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("education.content.texts")}</div>
          <TextList
            items={payload.free.texts}
            testId="course-free-texts"
            lockedLabel={lockedLabel}
            openLabel={openLabel}
            askCuratorLabel={askCuratorLabel}
            buildCuratorHref={buildCuratorHref}
          />
        </div>
      </section>

      <section className="space-y-3" data-testid="course-premium-section">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="rr-section-title">{t("education.content.premiumTitle")}</h2>
          {payload.premiumUnlocked ? (
            <span className="rounded-sm border border-[#2d6b43] bg-[#163827] px-2 py-0.5 text-xs text-[#9fe0b5]">
              {t("education.content.unlocked")}
            </span>
          ) : (
            <span className="rounded-sm border border-[#6b4d2d] bg-[#3a2b1b] px-2 py-0.5 text-xs text-[#ffdca8]">
              {t("education.content.locked")}
            </span>
          )}
        </div>

        {!payload.premiumUnlocked ? (
          <div
            className="rounded-sm border border-[#6b4d2d] bg-[#2f2620] px-3 py-2 text-sm text-[#ffdca8]"
            data-testid="course-premium-locked"
          >
            {t("education.content.lockedHint")}
            <Link
              href={authHref}
              className="ml-2 text-[#9cc4ff] underline-offset-4 hover:underline"
              onClick={() => {
                const visitorId = ensureVisitorId();
                const sessionId = ensureAnalyticsSessionId();
                emitAnalyticsClientEvent({
                  eventType: "paywall_click",
                  contentType: "paywall",
                  contentId: `course:${slug}`,
                  dedupeKey: `paywall-click:${visitorId}:${sessionId}:course:${slug}`,
                });
              }}
            >
              {t("education.content.openAuth")}
            </Link>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("education.content.videos")}</div>
          <MediaList
            items={payload.premium.videos}
            type="video"
            testId="course-premium-videos"
            lockedLabel={lockedLabel}
            minuteLabel={minuteLabel}
            openExternalLabel={openExternalLabel}
            askCuratorLabel={askCuratorLabel}
            buildCuratorHref={buildCuratorHref}
          />
        </div>
        <div className="space-y-3">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("education.content.audios")}</div>
          <MediaList
            items={payload.premium.audios}
            type="audio"
            testId="course-premium-audios"
            lockedLabel={lockedLabel}
            minuteLabel={minuteLabel}
            openExternalLabel={openExternalLabel}
            askCuratorLabel={askCuratorLabel}
            buildCuratorHref={buildCuratorHref}
          />
        </div>
        <div className="space-y-3">
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("education.content.texts")}</div>
          <TextList
            items={payload.premium.texts}
            testId="course-premium-texts"
            lockedLabel={lockedLabel}
            openLabel={openLabel}
            askCuratorLabel={askCuratorLabel}
            buildCuratorHref={buildCuratorHref}
          />
        </div>
      </section>
    </div>
  );
}
