"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import View3sCounter from "../analytics/View3sCounter";
import { useI18n } from "../i18n/I18nProvider";
import { getAuthHref } from "../../lib/i18n/routing";

type CommunityContentType = "article" | "video" | "sound" | "education";

type ContentReactionsBarProps = {
  contentType: CommunityContentType;
  contentId: string;
  contentTitle?: string;
  contentHref?: string;
  tone?: "light" | "dark";
  showAuthLink?: boolean;
  className?: string;
  testId?: string;
};

export default function ContentReactionsBar({
  contentType,
  contentId,
  contentTitle,
  contentHref,
  tone = "light",
  showAuthLink = true,
  className = "",
  testId = "content-reactions",
}: ContentReactionsBarProps) {
  const { locale, t } = useI18n();
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [sessionRes, summaryRes] = await Promise.all([
          fetch("/api/auth/session", { cache: "no-store" }),
          fetch(
            `/api/community/reactions/content?contentType=${encodeURIComponent(contentType)}&contentId=${encodeURIComponent(contentId)}`,
            { cache: "no-store" }
          ),
        ]);

        const sessionPayload = (await sessionRes.json()) as { session?: { userId?: string } | null };
        const summaryPayload = (await summaryRes.json()) as { likeCount?: number; liked?: boolean; bookmarked?: boolean };
        if (cancelled) return;

        setSessionUserId(sessionPayload.session?.userId || null);
        if (summaryRes.ok) {
          setLikeCount(typeof summaryPayload.likeCount === "number" ? summaryPayload.likeCount : 0);
          setLiked(summaryPayload.liked === true);
          setBookmarked(summaryPayload.bookmarked === true);
        }
      } catch {
        // Non-critical block: keep rendering static controls.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contentType, contentId]);

  const toggleReaction = async (action: "toggleLike" | "toggleBookmark") => {
    if (!sessionUserId) return;

    try {
      const response = await fetch("/api/community/reactions/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          contentType,
          contentId,
          title: contentTitle,
          href: contentHref,
        }),
      });
      const payload = (await response.json()) as { likeCount?: number; liked?: boolean; bookmarked?: boolean };
      if (!response.ok) return;

      if (action === "toggleLike") {
        if (typeof payload.likeCount === "number") setLikeCount(payload.likeCount);
        if (typeof payload.liked === "boolean") setLiked(payload.liked);
      }

      if (action === "toggleBookmark") {
        if (typeof payload.bookmarked === "boolean") setBookmarked(payload.bookmarked);
      }
    } catch {
      // Silent fallback: counters remain as-is.
    }
  };

  const isDarkTone = tone === "dark";
  const textTone = isDarkTone ? "text-[#8f97a9]" : "text-[#6c7483]";
  const linkTone = isDarkTone ? "text-[#9ec5ff]" : "text-[#3b6fb1]";
  const idleTone = isDarkTone
    ? "text-[#8f97a9] hover:bg-white/10 hover:text-[#dbe4f5]"
    : "text-[#6c7483] hover:bg-black/5 hover:text-[#2e3848]";
  const activeLikeTone = isDarkTone
    ? "text-[#ff5e73] bg-white/10"
    : "text-[#d24f65] bg-black/5";
  const activeBookmarkTone = isDarkTone
    ? "text-[#84b8ff] bg-white/10"
    : "text-[#2f6fb8] bg-black/5";

  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs ${textTone} ${className}`.trim()} data-testid={testId}>
      <button
        type="button"
        onClick={() => void toggleReaction("toggleLike")}
        disabled={!sessionUserId}
        aria-label={t("engagement.like")}
        title={!sessionUserId ? t("engagement.loginToReact") : t("engagement.like")}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
          liked ? activeLikeTone : idleTone
        } disabled:opacity-55`}
        data-testid={`${testId}-like-toggle`}
      >
        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 20.5 4.8 13.9a4.8 4.8 0 0 1 6.8-6.8L12 7.5l.4-.4a4.8 4.8 0 1 1 6.8 6.8Z" />
        </svg>
        <span>{likeCount}</span>
      </button>

      <View3sCounter
        contentType={contentType}
        contentId={contentId}
        className={`rounded-md px-1.5 py-1 ${idleTone}`}
        testId={`${testId}-views`}
      />

      <button
        type="button"
        onClick={() => void toggleReaction("toggleBookmark")}
        disabled={!sessionUserId}
        aria-label={t("engagement.bookmark")}
        title={!sessionUserId ? t("engagement.loginToReact") : t("engagement.bookmark")}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
          bookmarked ? activeBookmarkTone : idleTone
        } disabled:opacity-55`}
        data-testid={`${testId}-bookmark-toggle`}
      >
        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 3.8h12a1 1 0 0 1 1 1V20l-7-4-7 4V4.8a1 1 0 0 1 1-1Z" />
        </svg>
      </button>

      {!sessionUserId && showAuthLink ? (
        <Link href={getAuthHref(locale)} className={`${linkTone} ml-1 hover:underline`} data-testid={`${testId}-auth-link`}>
          {t("comments.loginCta")}
        </Link>
      ) : null}
    </div>
  );
}
