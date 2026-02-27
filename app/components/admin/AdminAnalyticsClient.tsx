"use client";

import { useEffect, useState } from "react";
import { readAdminSecretClient, writeAdminSecretClient } from "../../lib/admin/clientSecret";
import { useI18n } from "../i18n/I18nProvider";

type AnalyticsContentType = "article" | "video" | "sound" | "education" | "search" | "paywall" | "commerce";

type TopItem = {
  contentType: AnalyticsContentType;
  contentId: string;
  view3sCount: number;
};

type Summary = {
  generatedAt: string;
  totalEvents: number;
  totalView3s: number;
  totalReadSec: number;
  totalWatchSec: number;
  totalListenSec: number;
  totalEducationSec: number;
  uniqueUsers: number;
  uniqueVisitors: number;
  progressReached25: number;
  progressReached50: number;
  progressReached75: number;
  progressReached100: number;
  searchSubmitCount: number;
  searchClickCount: number;
  searchZeroResultsViewCount: number;
  searchRecoveryClickCount: number;
  searchCtr: number;
  searchRecoveryCtr: number;
  avgSearchTimeToClickSec: number;
  paywallSeenCount: number;
  paywallClickCount: number;
  purchaseCount: number;
  donateViewCount: number;
  donateAmountSelectCount: number;
  donateCheckoutStartCount: number;
  donateCheckoutSuccessCount: number;
  donateCheckoutFailCount: number;
  topContentByView3s: TopItem[];
};

type GuestSyncTopTrack = {
  trackScopeId: string;
  reports: number;
  sampleCount: number;
  avgAbsDriftMs: number;
  maxAbsDriftMs: number;
  softCorrections: number;
  hardCorrections: number;
};

type GuestSyncSummary = {
  generatedAt: string;
  totalReports: number;
  totalSamples: number;
  avgAbsDriftMs: number;
  maxAbsDriftMs: number;
  softCorrections: number;
  hardCorrections: number;
  topTracks: GuestSyncTopTrack[];
};

type MapSummary = {
  generatedAt: string;
  totalReports: number;
  mapInitReports: number;
  mapFilterReports: number;
  tileErrorReports: number;
  fallbackActivations: number;
  avgMapInitTimeMs: number;
  p95MapInitTimeMs: number;
  avgMapFilterTimeMs: number;
  p95MapFilterTimeMs: number;
  tileErrorRate: number;
};

type SearchQualityFailedQuery = {
  query: string;
  totalCount: number;
  zeroResultCount: number;
  zeroResultRate: number;
};

type SearchQualitySummary = {
  generatedAt: string;
  updatedAt: string;
  totalQueries: number;
  zeroResultQueries: number;
  zeroResultRate: number;
  searchSubmitCount: number;
  searchClickCount: number;
  searchCtr: number;
  avgTimeToClickSec: number;
  searchZeroResultsViewCount: number;
  searchRecoveryClickCount: number;
  searchRecoveryCtr: number;
  failedQueries: SearchQualityFailedQuery[];
};

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(value: string, locale: "ru" | "en"): string {
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

export default function AdminAnalyticsClient() {
  const { t, locale } = useI18n();
  const [secret, setSecret] = useState("");
  const [secretReady, setSecretReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [guestSyncSummary, setGuestSyncSummary] = useState<GuestSyncSummary | null>(null);
  const [mapSummary, setMapSummary] = useState<MapSummary | null>(null);
  const [searchQualitySummary, setSearchQualitySummary] = useState<SearchQualitySummary | null>(null);

  useEffect(() => {
    setSecret(readAdminSecretClient());
    setSecretReady(true);
  }, []);

  useEffect(() => {
    if (!secretReady) return;
    writeAdminSecretClient(secret);
  }, [secret, secretReady]);

  const onLoad = async () => {
    setBusy(true);
    setStatus("");
    try {
      const [mainResponse, guestSyncResponse, mapResponse, searchQualityResponse] = await Promise.all([
        fetch("/api/admin/analytics/summary", {
          headers: { "x-rr-admin-secret": secret.trim() },
          cache: "no-store",
        }),
        fetch("/api/admin/analytics/guest-sync-summary", {
          headers: { "x-rr-admin-secret": secret.trim() },
          cache: "no-store",
        }),
        fetch("/api/admin/analytics/map-summary", {
          headers: { "x-rr-admin-secret": secret.trim() },
          cache: "no-store",
        }),
        fetch(`/api/admin/analytics/search-quality?locale=${locale}&limit=20`, {
          headers: { "x-rr-admin-secret": secret.trim() },
          cache: "no-store",
        }),
      ]);
      const mainPayload = (await mainResponse.json()) as { summary?: Summary; error?: string };
      const guestPayload = (await guestSyncResponse.json()) as { summary?: GuestSyncSummary; error?: string };
      const mapPayload = (await mapResponse.json()) as { summary?: MapSummary; error?: string };
      const searchQualityPayload = (await searchQualityResponse.json()) as { summary?: SearchQualitySummary; error?: string };
      if (!mainResponse.ok) throw new Error(mainPayload.error || `HTTP ${mainResponse.status}`);
      if (!guestSyncResponse.ok) throw new Error(guestPayload.error || `HTTP ${guestSyncResponse.status}`);
      if (!mapResponse.ok) throw new Error(mapPayload.error || `HTTP ${mapResponse.status}`);
      if (!searchQualityResponse.ok) throw new Error(searchQualityPayload.error || `HTTP ${searchQualityResponse.status}`);
      setSummary(mainPayload.summary ?? null);
      setGuestSyncSummary(guestPayload.summary ?? null);
      setMapSummary(mapPayload.summary ?? null);
      setSearchQualitySummary(searchQualityPayload.summary ?? null);
      setStatus(t("admin.analytics.loaded"));
    } catch (error) {
      setStatus(`${t("analytics.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  const onExportSearchFailedQueries = async () => {
    setStatus("");
    try {
      const response = await fetch(`/api/admin/analytics/search-quality/export?locale=${locale}&limit=200`, {
        headers: { "x-rr-admin-secret": secret.trim() },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `search-failed-queries-${locale}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(t("admin.analytics.searchQuality.exportReady"));
    } catch (error) {
      setStatus(`${t("analytics.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    }
  };

  const resolveTypeLabel = (contentType: AnalyticsContentType): string => {
    if (contentType === "article") return t("header.searchKind.article");
    if (contentType === "video") return t("header.searchKind.video");
    if (contentType === "sound") return t("header.searchKind.sound");
    if (contentType === "education") return t("header.searchKind.education");
    if (contentType === "search") return t("admin.analytics.type.search");
    if (contentType === "paywall") return t("admin.analytics.type.paywall");
    return t("admin.analytics.type.commerce");
  };

  return (
    <section className="space-y-4" data-testid="admin-analytics-root">
      <div className="rr-article-panel space-y-3 p-4" data-testid="admin-analytics-auth">
        <div className="text-sm text-[#9aa3b2]">{t("admin.analytics.secretHint")}</div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            type="password"
            className="w-full max-w-sm rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            placeholder={t("admin.entitlements.secret")}
            data-testid="admin-analytics-secret-input"
          />
          <button
            type="button"
            onClick={onLoad}
            className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
            disabled={busy || !secret.trim()}
            data-testid="admin-analytics-load"
          >
            {busy ? t("feedback.sending") : t("admin.analytics.load")}
          </button>
        </div>
      </div>

      {summary ? (
        <div className="rr-article-panel space-y-4 p-4" data-testid="admin-analytics-summary">
          <div className="text-xs text-[#9aa3b2]">
            {t("admin.analytics.generatedAt")}: {formatDate(summary.generatedAt, locale)}
          </div>
          <div className="grid gap-2 text-sm text-[#d7deea] md:grid-cols-2">
            <div>{t("admin.analytics.totalEvents")}: {summary.totalEvents}</div>
            <div>{t("analytics.views3s")} {summary.totalView3s}</div>
            <div>{t("admin.analytics.uniqueUsers")}: {summary.uniqueUsers}</div>
            <div>{t("admin.analytics.uniqueVisitors")}: {summary.uniqueVisitors}</div>
            <div>{t("analytics.totalRead")} {formatDuration(summary.totalReadSec)}</div>
            <div>{t("analytics.totalWatch")} {formatDuration(summary.totalWatchSec)}</div>
            <div>{t("analytics.totalListen")} {formatDuration(summary.totalListenSec)}</div>
            <div>{t("analytics.totalEducation")} {formatDuration(summary.totalEducationSec)}</div>
            <div>{t("admin.analytics.searchSubmitCount")}: {summary.searchSubmitCount}</div>
            <div>{t("admin.analytics.searchClickCount")}: {summary.searchClickCount}</div>
            <div>{t("admin.analytics.searchCtr")}: {(summary.searchCtr * 100).toFixed(2)}%</div>
            <div>{t("admin.analytics.avgSearchTimeToClick")}: {summary.avgSearchTimeToClickSec.toFixed(1)}s</div>
            <div>{t("admin.analytics.searchZeroResultsViewCount")}: {summary.searchZeroResultsViewCount}</div>
            <div>{t("admin.analytics.searchRecoveryClickCount")}: {summary.searchRecoveryClickCount}</div>
            <div>{t("admin.analytics.searchRecoveryCtr")}: {(summary.searchRecoveryCtr * 100).toFixed(2)}%</div>
            <div>{t("admin.analytics.paywallSeenCount")}: {summary.paywallSeenCount}</div>
            <div>{t("admin.analytics.paywallClickCount")}: {summary.paywallClickCount}</div>
            <div>{t("admin.analytics.purchaseCount")}: {summary.purchaseCount}</div>
            <div>{t("admin.analytics.donateViewCount")}: {summary.donateViewCount}</div>
            <div>{t("admin.analytics.donateAmountSelectCount")}: {summary.donateAmountSelectCount}</div>
            <div>{t("admin.analytics.donateCheckoutStartCount")}: {summary.donateCheckoutStartCount}</div>
            <div>{t("admin.analytics.donateCheckoutSuccessCount")}: {summary.donateCheckoutSuccessCount}</div>
            <div>{t("admin.analytics.donateCheckoutFailCount")}: {summary.donateCheckoutFailCount}</div>
            <div className="md:col-span-2">
              {t("analytics.progress")}: 25%={summary.progressReached25}, 50%={summary.progressReached50}, 75%=
              {summary.progressReached75}, 100%={summary.progressReached100}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-[#e6e8ec]">{t("admin.analytics.topByViews")}</div>
            {summary.topContentByView3s.length ? (
              <div className="overflow-x-auto rounded-sm border border-[#3b3f47]">
                <table className="w-full text-left text-xs text-[#d5dbea]" data-testid="admin-analytics-top-table">
                  <thead className="bg-[#1b1f27] text-[#9aa3b2]">
                    <tr>
                      <th className="px-2 py-1.5">{t("admin.analytics.table.type")}</th>
                      <th className="px-2 py-1.5">{t("admin.analytics.table.id")}</th>
                      <th className="px-2 py-1.5">{t("admin.analytics.table.views")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topContentByView3s.map((item) => (
                      <tr
                        key={`${item.contentType}:${item.contentId}`}
                        className="border-t border-[#3b3f47] bg-[#20232b]"
                        data-testid={`admin-analytics-top-row-${item.contentType}-${item.contentId}`}
                      >
                        <td className="px-2 py-1.5">{resolveTypeLabel(item.contentType)}</td>
                        <td className="px-2 py-1.5">{item.contentId}</td>
                        <td className="px-2 py-1.5">{item.view3sCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-[#9aa3b2]">{t("admin.analytics.emptyTop")}</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-[#e6e8ec]">{t("admin.analytics.guestSync.title")}</div>
            {guestSyncSummary ? (
              <>
                <div className="grid gap-2 text-sm text-[#d7deea] md:grid-cols-2" data-testid="admin-analytics-guest-sync-summary">
                  <div>{t("admin.analytics.guestSync.totalReports")}: {guestSyncSummary.totalReports}</div>
                  <div>{t("admin.analytics.guestSync.totalSamples")}: {guestSyncSummary.totalSamples}</div>
                  <div>{t("admin.analytics.guestSync.avgAbsDriftMs")}: {Math.round(guestSyncSummary.avgAbsDriftMs)} ms</div>
                  <div>{t("admin.analytics.guestSync.maxAbsDriftMs")}: {guestSyncSummary.maxAbsDriftMs} ms</div>
                  <div>{t("admin.analytics.guestSync.softCorrections")}: {guestSyncSummary.softCorrections}</div>
                  <div>{t("admin.analytics.guestSync.hardCorrections")}: {guestSyncSummary.hardCorrections}</div>
                  <div className="md:col-span-2 text-xs text-[#9aa3b2]">
                    {t("admin.analytics.generatedAt")}: {formatDate(guestSyncSummary.generatedAt, locale)}
                  </div>
                </div>
                {guestSyncSummary.topTracks.length ? (
                  <div className="overflow-x-auto rounded-sm border border-[#3b3f47]">
                    <table className="w-full text-left text-xs text-[#d5dbea]" data-testid="admin-analytics-guest-sync-top-table">
                      <thead className="bg-[#1b1f27] text-[#9aa3b2]">
                        <tr>
                          <th className="px-2 py-1.5">{t("admin.analytics.guestSync.table.track")}</th>
                          <th className="px-2 py-1.5">{t("admin.analytics.guestSync.table.samples")}</th>
                          <th className="px-2 py-1.5">{t("admin.analytics.guestSync.table.avgDrift")}</th>
                          <th className="px-2 py-1.5">{t("admin.analytics.guestSync.table.maxDrift")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {guestSyncSummary.topTracks.map((item) => (
                          <tr
                            key={item.trackScopeId}
                            className="border-t border-[#3b3f47] bg-[#20232b]"
                            data-testid={`admin-analytics-guest-sync-top-row-${item.trackScopeId}`}
                          >
                            <td className="px-2 py-1.5">{item.trackScopeId}</td>
                            <td className="px-2 py-1.5">{item.sampleCount}</td>
                            <td className="px-2 py-1.5">{Math.round(item.avgAbsDriftMs)} ms</td>
                            <td className="px-2 py-1.5">{Math.round(item.maxAbsDriftMs)} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-[#9aa3b2]">{t("admin.analytics.guestSync.empty")}</div>
                )}
              </>
            ) : (
              <div className="text-sm text-[#9aa3b2]">{t("admin.analytics.guestSync.empty")}</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-[#e6e8ec]">{t("admin.analytics.map.title")}</div>
            {mapSummary ? (
              <div className="grid gap-2 text-sm text-[#d7deea]" data-testid="admin-analytics-map-summary">
                <div>{t("admin.analytics.map.totalReports")}: {mapSummary.totalReports}</div>
                <div>{t("admin.analytics.map.mapInitReports")}: {mapSummary.mapInitReports}</div>
                <div>{t("admin.analytics.map.mapFilterReports")}: {mapSummary.mapFilterReports}</div>
                <div>{t("admin.analytics.map.tileErrorReports")}: {mapSummary.tileErrorReports}</div>
                <div>{t("admin.analytics.map.fallbackActivations")}: {mapSummary.fallbackActivations}</div>
                <div>{t("admin.analytics.map.avgInitMs")}: {mapSummary.avgMapInitTimeMs} ms</div>
                <div>{t("admin.analytics.map.p95InitMs")}: {mapSummary.p95MapInitTimeMs} ms</div>
                <div>{t("admin.analytics.map.avgFilterMs")}: {mapSummary.avgMapFilterTimeMs} ms</div>
                <div>{t("admin.analytics.map.p95FilterMs")}: {mapSummary.p95MapFilterTimeMs} ms</div>
                <div>{t("admin.analytics.map.tileErrorRate")}: {(mapSummary.tileErrorRate * 100).toFixed(2)}%</div>
                <div className="text-xs text-[#9aa3b2]">
                  {t("admin.analytics.generatedAt")}: {formatDate(mapSummary.generatedAt, locale)}
                </div>
              </div>
            ) : (
              <div className="text-sm text-[#9aa3b2]">{t("admin.analytics.map.empty")}</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[#e6e8ec]">{t("admin.analytics.searchQuality.title")}</div>
              <button
                type="button"
                className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-1.5 text-xs text-[#d7deea] hover:border-[#5f82aa]"
                onClick={() => {
                  void onExportSearchFailedQueries();
                }}
                data-testid="admin-analytics-search-quality-export"
              >
                {t("admin.analytics.searchQuality.export")}
              </button>
            </div>
            {searchQualitySummary ? (
              <>
                <div className="grid gap-2 text-sm text-[#d7deea]" data-testid="admin-analytics-search-quality-summary">
                  <div>{t("admin.analytics.searchQuality.totalQueries")}: {searchQualitySummary.totalQueries}</div>
                  <div>{t("admin.analytics.searchQuality.zeroResultQueries")}: {searchQualitySummary.zeroResultQueries}</div>
                  <div>{t("admin.analytics.searchQuality.zeroResultRate")}: {(searchQualitySummary.zeroResultRate * 100).toFixed(2)}%</div>
                  <div>{t("admin.analytics.searchCtr")}: {(searchQualitySummary.searchCtr * 100).toFixed(2)}%</div>
                  <div>{t("admin.analytics.avgSearchTimeToClick")}: {searchQualitySummary.avgTimeToClickSec.toFixed(1)}s</div>
                  <div>{t("admin.analytics.searchRecoveryCtr")}: {(searchQualitySummary.searchRecoveryCtr * 100).toFixed(2)}%</div>
                  <div className="text-xs text-[#9aa3b2]">
                    {t("admin.analytics.generatedAt")}: {formatDate(searchQualitySummary.generatedAt, locale)}
                  </div>
                </div>
                {searchQualitySummary.failedQueries.length ? (
                  <div className="overflow-x-auto rounded-sm border border-[#3b3f47]">
                    <table className="w-full text-left text-xs text-[#d5dbea]" data-testid="admin-analytics-search-quality-table">
                      <thead className="bg-[#1b1f27] text-[#9aa3b2]">
                        <tr>
                          <th className="px-2 py-1.5">{t("admin.analytics.searchQuality.table.query")}</th>
                          <th className="px-2 py-1.5">{t("admin.analytics.searchQuality.table.total")}</th>
                          <th className="px-2 py-1.5">{t("admin.analytics.searchQuality.table.zero")}</th>
                          <th className="px-2 py-1.5">{t("admin.analytics.searchQuality.table.rate")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchQualitySummary.failedQueries.map((item) => (
                          <tr
                            key={item.query}
                            className="border-t border-[#3b3f47] bg-[#20232b]"
                            data-testid={`admin-analytics-search-quality-row-${item.query}`}
                          >
                            <td className="px-2 py-1.5">{item.query}</td>
                            <td className="px-2 py-1.5">{item.totalCount}</td>
                            <td className="px-2 py-1.5">{item.zeroResultCount}</td>
                            <td className="px-2 py-1.5">{(item.zeroResultRate * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-[#9aa3b2]">{t("admin.analytics.searchQuality.empty")}</div>
                )}
              </>
            ) : (
              <div className="text-sm text-[#9aa3b2]">{t("admin.analytics.searchQuality.empty")}</div>
            )}
          </div>
        </div>
      ) : null}

      {status ? (
        <div className="text-xs text-[#9cc4ff]" data-testid="admin-analytics-status">
          {status}
        </div>
      ) : null}
    </section>
  );
}
