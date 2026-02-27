"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { getAuthHref, getPublicProfileHref } from "../../lib/i18n/routing";

type CommunityContentType = "article" | "video" | "sound" | "education";

type CommentItem = {
  id: string;
  parentId?: string;
  userId: string;
  userName: string;
  userHandle?: string;
  userAvatarUrl?: string;
  userRingStyle?: "none" | "sky" | "emerald" | "gold";
  body: string;
  createdAt: string;
  updatedAt: string;
};

type CommentsPanelProps = {
  contentType: CommunityContentType;
  contentId: string;
  contentTitle?: string;
  contentHref?: string;
  className?: string;
  testId?: string;
};

function formatTime(value: string, locale: "ru" | "en"): string {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

const EMOJI_HINTS = ["👍", "❤️", "🔥", "👏", "🙂", "🎶"];

function getRingClass(style: CommentItem["userRingStyle"]): string {
  if (style === "gold") return "border-[#d6b25e]";
  if (style === "emerald") return "border-[#42a06f]";
  if (style === "sky") return "border-[#5f82aa]";
  return "border-[#3b3f47]";
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] || "";
  const second = parts[1]?.[0] || "";
  return `${first}${second}`.toUpperCase();
}

export default function CommentsPanel({
  contentType,
  contentId,
  contentTitle,
  contentHref,
  className = "",
  testId = "comments-panel",
}: CommentsPanelProps) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<CommentItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [totalComments, setTotalComments] = useState(0);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  const byParent = useMemo(() => {
    const map = new Map<string, CommentItem[]>();
    for (const item of items) {
      const key = item.parentId || "__root__";
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    return map;
  }, [items]);

  const loadSession = async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const payload = (await response.json()) as { session?: { userId?: string } | null };
    setSessionLoaded(true);
    setSessionUserId(payload.session?.userId || null);
  };

  const loadSummary = async () => {
    const response = await fetch(
      `/api/community/reactions/content?contentType=${encodeURIComponent(contentType)}&contentId=${encodeURIComponent(contentId)}`,
      { cache: "no-store" }
    );
    const payload = (await response.json()) as { likeCount?: number; liked?: boolean; bookmarked?: boolean };
    if (!response.ok) return;
    setLikeCount(typeof payload.likeCount === "number" ? payload.likeCount : 0);
    setLiked(payload.liked === true);
    setBookmarked(payload.bookmarked === true);
  };

  const loadComments = async (offset: number, replace: boolean) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/community/comments?contentType=${encodeURIComponent(contentType)}&contentId=${encodeURIComponent(contentId)}&offset=${offset}&limit=5`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        items?: CommentItem[];
        totalComments?: number;
        nextOffset?: number | null;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const pageItems = payload.items ?? [];
      setItems((prev) => (replace ? pageItems : [...prev, ...pageItems]));
      setTotalComments(typeof payload.totalComments === "number" ? payload.totalComments : 0);
      setNextOffset(payload.nextOffset ?? null);
    } catch (error) {
      setStatus(`${t("comments.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setLoading(false);
    }
  };

  const openPanel = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen) return;
    setStatus("");
    if (!sessionLoaded) await loadSession();
    await Promise.all([loadSummary(), loadComments(0, true)]);
  };

  const sendComment = async () => {
    const body = inputText.trim();
    if (!body) return;
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/community/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType,
          contentId,
          parentId: replyToId || undefined,
          body,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setInputText("");
      setReplyToId(null);
      await loadComments(0, true);
      setStatus(t("comments.sent"));
    } catch (error) {
      setStatus(`${t("comments.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleReaction = async (action: "toggleLike" | "toggleBookmark") => {
    if (!sessionUserId) return;
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
  };

  const renderNode = (item: CommentItem, depth: number) => (
    <div
      key={item.id}
      className="space-y-1 rounded-sm border border-[#313641] bg-[#20232b] px-3 py-2"
      style={{ marginLeft: depth > 0 ? `${Math.min(depth, 4) * 16}px` : undefined }}
      data-testid={`comment-item-${item.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#d5dbea]">
        <div className={`h-8 w-8 overflow-hidden rounded-full border ${getRingClass(item.userRingStyle)}`}>
          {item.userAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.userAvatarUrl} alt={item.userName} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#2b303a] text-[11px] font-semibold text-[#d5dbea]">
              {initialsFromName(item.userName)}
            </div>
          )}
        </div>
        <span className="font-semibold">{item.userName}</span>
        {item.userHandle ? (
          <Link href={getPublicProfileHref(locale, item.userHandle)} className="text-[#9cc4ff] hover:underline">
            @{item.userHandle}
          </Link>
        ) : null}
        <span className="text-[#7f8ba1]">{formatTime(item.createdAt, locale)}</span>
      </div>
      <div className="whitespace-pre-wrap text-sm text-[#e6e8ec]">{item.body}</div>
      {sessionUserId ? (
        <button
          type="button"
          onClick={() => setReplyToId(item.id)}
          className="text-xs text-[#9cc4ff] hover:underline"
        >
          {t("comments.reply")}
        </button>
      ) : null}
      {(byParent.get(item.id) ?? []).map((child) => renderNode(child, depth + 1))}
    </div>
  );

  return (
    <section className={`rr-article-panel p-4 ${className}`} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void openPanel()}
          className="text-sm font-semibold text-[#e6e8ec] hover:text-white"
          data-testid="comments-toggle"
        >
          {t("comments.title")} ({totalComments}) {open ? t("comments.collapse") : t("comments.expand")}
        </button>
        {open ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!sessionUserId}
              onClick={() => void toggleReaction("toggleLike")}
              className={`rounded-full border px-2 py-1 text-xs ${
                liked ? "border-[#ad4456] bg-[#4b222c] text-[#ffced8]" : "border-[#3b3f47] text-[#c8cdd6]"
              } disabled:opacity-50`}
              data-testid="comments-like-toggle"
            >
              ♥ {likeCount}
            </button>
            <button
              type="button"
              disabled={!sessionUserId}
              onClick={() => void toggleReaction("toggleBookmark")}
              className={`rounded-full border px-2 py-1 text-xs ${
                bookmarked ? "border-[#3b669e] bg-[#233042] text-[#cfe4ff]" : "border-[#3b3f47] text-[#c8cdd6]"
              } disabled:opacity-50`}
              data-testid="comments-bookmark-toggle"
            >
              ⌖
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            {(byParent.get("__root__") ?? []).map((item) => renderNode(item, 0))}
            {!items.length ? <div className="text-sm text-[#9aa3b2]">{t("comments.empty")}</div> : null}
          </div>

          {nextOffset !== null ? (
            <button
              type="button"
              onClick={() => void loadComments(nextOffset, false)}
              disabled={loading}
              className="text-sm text-[#9cc4ff] hover:underline disabled:opacity-50"
              data-testid="comments-load-more"
            >
              {t("comments.loadMore")}
            </button>
          ) : null}

          {sessionUserId ? (
            <div className="space-y-2 rounded-sm border border-[#3b3f47] bg-[#1b1f26] p-3">
              {replyToId ? (
                <div className="flex items-center justify-between gap-2 text-xs text-[#9cc4ff]">
                  <span>{t("comments.replyTo")} #{replyToId.slice(0, 8)}</span>
                  <button type="button" onClick={() => setReplyToId(null)} className="hover:underline">
                    {t("comments.cancelReply")}
                  </button>
                </div>
              ) : null}
              <textarea
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                rows={3}
                placeholder={t("comments.placeholder")}
                className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
                data-testid="comments-input"
              />
              <div className="flex flex-wrap items-center gap-2">
                {EMOJI_HINTS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setInputText((prev) => `${prev}${emoji}`)}
                    className="rounded border border-[#3b3f47] bg-[#20232b] px-1.5 py-0.5 text-sm"
                    data-testid={`comments-emoji-${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void sendComment()}
                disabled={loading}
                className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
                data-testid="comments-send"
              >
                {loading ? t("comments.sending") : t("comments.send")}
              </button>
            </div>
          ) : (
            <div className="text-sm text-[#9aa3b2]">
              {t("comments.loginHint")}{" "}
              <Link href={getAuthHref(locale)} className="text-[#9cc4ff] hover:underline">
                {t("comments.loginCta")}
              </Link>
            </div>
          )}

          {status ? (
            <div className="text-xs text-[#9cc4ff]" data-testid="comments-status">
              {status}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
