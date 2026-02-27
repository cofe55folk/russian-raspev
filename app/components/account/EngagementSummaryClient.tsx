"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

type Summary = {
  totalReadSec: number;
  totalWatchSec: number;
  totalListenSec: number;
  totalEducationSec: number;
  totalView3s: number;
  progressReached25: number;
  progressReached50: number;
  progressReached75: number;
  progressReached100: number;
  favoriteSoundId: string | null;
};

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function EngagementSummaryClient() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/analytics/me/summary", { cache: "no-store" });
        const payload = (await response.json()) as { summary?: Summary; error?: string };
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (!cancelled) setSummary(payload.summary || null);
      } catch (error) {
        if (!cancelled) {
          setStatus(`${t("analytics.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="space-y-3 rounded-sm border border-[#3b3f47] bg-[#20232b] p-4" data-testid="account-analytics">
      <div className="text-sm font-semibold text-[#e6e8ec]">{t("analytics.title")}</div>
      <div className="text-xs text-[#9aa3b2]">{t("analytics.personalHint")}</div>

      {summary ? (
        <div className="grid gap-2 text-sm text-[#d7deea] md:grid-cols-2">
          <div>{t("analytics.totalRead")} {formatDuration(summary.totalReadSec)}</div>
          <div>{t("analytics.totalWatch")} {formatDuration(summary.totalWatchSec)}</div>
          <div>{t("analytics.totalListen")} {formatDuration(summary.totalListenSec)}</div>
          <div>{t("analytics.totalEducation")} {formatDuration(summary.totalEducationSec)}</div>
          <div>{t("analytics.views3s")} {summary.totalView3s}</div>
          <div>{t("analytics.progress")}: 25%={summary.progressReached25}, 50%={summary.progressReached50}, 75%={summary.progressReached75}, 100%={summary.progressReached100}</div>
          <div className="md:col-span-2">
            {t("analytics.favoriteSound")}: {summary.favoriteSoundId || t("analytics.favoriteSoundEmpty")}
          </div>
        </div>
      ) : (
        <div className="text-sm text-[#9aa3b2]">{status || t("analytics.loading")}</div>
      )}
    </section>
  );
}
