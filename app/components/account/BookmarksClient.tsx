"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { localizeHref } from "../../lib/i18n/routing";

type BookmarkItem = {
  id: string;
  contentType: "article" | "video" | "sound" | "education";
  contentId: string;
  title?: string;
  href?: string;
  createdAt: string;
};

function formatTime(value: string, locale: "ru" | "en"): string {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(ts));
}

function fallbackHref(item: BookmarkItem): string {
  if (item.contentType === "article") return `/articles/${item.contentId}`;
  if (item.contentType === "sound") return `/sound/${item.contentId}`;
  if (item.contentType === "education") return `/education/${item.contentId}`;
  return `/video#${item.contentId}`;
}

export default function BookmarksClient() {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/community/bookmarks", { cache: "no-store" });
        const payload = (await response.json()) as { bookmarks?: BookmarkItem[]; error?: string };
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (!cancelled) setItems(payload.bookmarks ?? []);
      } catch (error) {
        if (!cancelled) {
          setStatus(`${t("comments.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="rr-article-panel space-y-3 p-5" data-testid="bookmarks-list">
      {items.length ? (
        items.map((item) => {
          const href = item.href || fallbackHref(item);
          return (
            <div key={item.id} className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2">
              <div className="text-xs uppercase tracking-[0.08em] text-[#9aa3b2]">{item.contentType}</div>
              <div className="text-sm text-[#e6e8ec]">{item.title || item.contentId}</div>
              <div className="mt-1 text-[11px] text-[#7f8ba1]">{formatTime(item.createdAt, locale)}</div>
              <Link href={localizeHref(href, locale)} className="mt-1 inline-flex text-xs text-[#9cc4ff] hover:underline">
                {t("bookmarks.openItem")}
              </Link>
            </div>
          );
        })
      ) : (
        <div className="text-sm text-[#aab0bb]">{t("bookmarks.empty")}</div>
      )}
      {status ? <div className="text-xs text-[#9cc4ff]">{status}</div> : null}
    </div>
  );
}
