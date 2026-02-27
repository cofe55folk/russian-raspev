import Link from "next/link";
import CreatorTracksClient from "../components/account/CreatorTracksClient";
import FeaturePreviewSwitchesClient from "../components/account/FeaturePreviewSwitchesClient";
import PageHero from "../components/PageHero";
import EngagementSummaryClient from "../components/account/EngagementSummaryClient";
import ProfileSettingsClient from "../components/account/ProfileSettingsClient";
import { readAuthSessionFromCookieStore } from "../lib/auth/session";
import { getPreviewFlagsFromCookieStore, type PreviewFeatureKey } from "../lib/feature-flags/preview";
import { listOrdersByUser } from "../lib/auth/store";
import { listDonationsByUser } from "../lib/donations/store";
import { getCommunityUserProfile } from "../lib/community/profiles";
import { I18N_MESSAGES } from "../lib/i18n/messages";
import {
  getAccountBookmarksHref,
  getAccountFeedbackHref,
  getAdminAnalyticsHref,
  getAdminEventsHref,
  getAdminEntitlementsHref,
  getAuthHref,
  getPremiumHref,
  getPublicProfileHref,
} from "../lib/i18n/routing";
import { readRequestLocale } from "../lib/i18n/server";

function formatDate(value: string | undefined, locale: "ru" | "en"): string {
  if (!value) return "-";
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

function formatMoney(amountMinor: number | undefined, currency: string | undefined, locale: "ru" | "en"): string {
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor)) return "-";
  const normalizedCurrency = currency?.trim().toUpperCase() || "RUB";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalizedCurrency,
    }).format(amountMinor / 100);
  } catch {
    return `${amountMinor / 100} ${normalizedCurrency}`;
  }
}

export default async function AccountPage() {
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;
  const session = await readAuthSessionFromCookieStore();
  const previewFlags: Set<PreviewFeatureKey> = session
    ? await getPreviewFlagsFromCookieStore()
    : new Set<PreviewFeatureKey>();
  const ugcCreatorTracksEnabled = previewFlags.has("ugc_creator_tracks");
  const profile = session ? await getCommunityUserProfile(session.userId) : null;
  const publicProfileHref =
    profile?.visibility === "public" && profile.handle ? getPublicProfileHref(locale, profile.handle) : null;
  const orders = session ? await listOrdersByUser(session.userId) : [];
  const donations = session ? await listDonationsByUser(session.userId) : [];
  const sortedOrders = [...orders].sort((a, b) => {
    const aTs = new Date(a.updatedAt).getTime();
    const bTs = new Date(b.updatedAt).getTime();
    return bTs - aTs;
  });
  const sortedDonations = [...donations].sort((a, b) => {
    const aTs = new Date(a.updatedAt).getTime();
    const bTs = new Date(b.updatedAt).getTime();
    return bTs - aTs;
  });

  return (
    <main className="rr-main">
      <PageHero title={t("account.pageTitle")} />
      <section className="rr-container mt-8 max-w-2xl">
        <div className="rr-article-panel space-y-4 p-5">
          {session ? (
            <>
              <div className="text-sm text-[#e6e8ec]">
                {t("account.signedInAs")}: <span className="font-semibold">{session.name || session.email || session.userId}</span>
              </div>
              <div className="text-sm text-[#aab0bb]">
                {t("account.userId")}: {session.userId}
              </div>
              {session.email ? (
                <div className="text-sm text-[#aab0bb]">
                  {t("account.email")}: {session.email}
                </div>
              ) : null}
              <Link href={getAuthHref(locale)} className="rr-article-link text-sm" data-testid="account-switch-profile">
                {t("account.openAuth")}
              </Link>

              <FeaturePreviewSwitchesClient initialFlags={Array.from(previewFlags)} />
              <ProfileSettingsClient />
              {ugcCreatorTracksEnabled ? (
                <CreatorTracksClient />
              ) : (
                <div className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-xs text-[#9aa3b2]" data-testid="creator-tracks-disabled">
                  {t("creatorTracks.disabledHint")}
                </div>
              )}
              <EngagementSummaryClient />

              <div>
                <div className="mb-1 text-sm font-semibold text-[#e6e8ec]">{t("account.entitlements")}</div>
                {session.entitlements.length ? (
                  <ul className="space-y-1 text-sm text-[#aab0bb]">
                    {session.entitlements.map((item) => (
                      <li key={item.code}>
                        <span>• {item.code}</span>
                        {item.expiresAt ? (
                          <span className="ml-2 text-[#8aa6d8]">
                            ({t("account.entitlement.expiresAt")}: {formatDate(item.expiresAt, locale)})
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-[#aab0bb]">{t("account.noEntitlements")}</div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-[#e6e8ec]">{t("account.orders")}</div>
                {sortedOrders.length ? (
                  <div className="overflow-x-auto rounded-sm border border-[#3b3f47]">
                    <table className="w-full text-left text-xs text-[#aab0bb]" data-testid="account-orders-table">
                      <thead className="bg-[#20232b] text-[#d5dbea]">
                        <tr>
                          <th className="px-2 py-1.5">{t("account.order.provider")}</th>
                          <th className="px-2 py-1.5">{t("account.order.reference")}</th>
                          <th className="px-2 py-1.5">{t("account.order.status")}</th>
                          <th className="px-2 py-1.5">{t("account.order.amount")}</th>
                          <th className="px-2 py-1.5">{t("account.order.updatedAt")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedOrders.map((order) => (
                          <tr key={order.id} className="border-t border-[#3b3f47] bg-[#1c1f26]">
                            <td className="px-2 py-1.5">{order.provider}</td>
                            <td className="px-2 py-1.5">{order.providerRef}</td>
                            <td className="px-2 py-1.5">{order.status}</td>
                            <td className="px-2 py-1.5">{formatMoney(order.amountMinor, order.currency, locale)}</td>
                            <td className="px-2 py-1.5">{formatDate(order.updatedAt, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-[#aab0bb]">{t("account.noOrders")}</div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-[#e6e8ec]">{t("account.donations")}</div>
                {sortedDonations.length ? (
                  <div className="overflow-x-auto rounded-sm border border-[#3b3f47]">
                    <table className="w-full text-left text-xs text-[#aab0bb]" data-testid="account-donations-table">
                      <thead className="bg-[#20232b] text-[#d5dbea]">
                        <tr>
                          <th className="px-2 py-1.5">{t("account.order.provider")}</th>
                          <th className="px-2 py-1.5">{t("account.order.reference")}</th>
                          <th className="px-2 py-1.5">{t("account.order.status")}</th>
                          <th className="px-2 py-1.5">{t("account.donation.interval")}</th>
                          <th className="px-2 py-1.5">{t("account.order.amount")}</th>
                          <th className="px-2 py-1.5">{t("account.order.updatedAt")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDonations.map((donation) => (
                          <tr key={donation.id} className="border-t border-[#3b3f47] bg-[#1c1f26]">
                            <td className="px-2 py-1.5">{donation.provider}</td>
                            <td className="px-2 py-1.5">{donation.providerRef}</td>
                            <td className="px-2 py-1.5">{donation.status}</td>
                            <td className="px-2 py-1.5">
                              {donation.interval === "monthly" ? t("donate.intervalMonthly") : t("donate.intervalOnce")}
                            </td>
                            <td className="px-2 py-1.5">{formatMoney(donation.amountMinor, donation.currency, locale)}</td>
                            <td className="px-2 py-1.5">{formatDate(donation.updatedAt, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-[#aab0bb]">{t("account.noDonations")}</div>
                )}
              </div>

              <ul className="list-none space-y-2 pt-1" data-testid="account-actions">
                <li>
                  <Link href={getAdminEntitlementsHref(locale)} className="rr-article-link block text-sm" data-testid="account-open-admin-entitlements">
                    {t("account.openAdminEntitlements")}
                  </Link>
                </li>
                <li>
                  <Link href={getAdminAnalyticsHref(locale)} className="rr-article-link block text-sm" data-testid="account-open-admin-analytics">
                    {t("account.openAdminAnalytics")}
                  </Link>
                </li>
                <li>
                  <Link href={getAdminEventsHref(locale)} className="rr-article-link block text-sm" data-testid="account-open-admin-events">
                    {t("account.openAdminEvents")}
                  </Link>
                </li>
                <li>
                  <Link href={getPremiumHref(locale)} className="rr-article-link block text-sm" data-testid="account-open-premium-hub">
                    {t("account.openPremiumHub")}
                  </Link>
                </li>
                {publicProfileHref ? (
                  <li>
                    <Link
                      href={publicProfileHref}
                      className="rr-article-link block text-sm"
                      data-testid="account-open-public-profile"
                    >
                      {t("account.openPublicProfile")}
                    </Link>
                  </li>
                ) : null}
                <li>
                  <Link href={getAccountFeedbackHref(locale)} className="rr-article-link block text-sm" data-testid="account-open-feedback">
                    {t("account.openFeedback")}
                  </Link>
                </li>
                <li>
                  <Link href={getAccountBookmarksHref(locale)} className="rr-article-link block text-sm" data-testid="account-open-bookmarks">
                    {t("account.openBookmarks")}
                  </Link>
                </li>
              </ul>
            </>
          ) : (
            <>
              <div className="text-sm text-[#aab0bb]">{t("account.signedOut")}</div>
              <Link href={getAuthHref(locale)} className="rr-article-link text-sm">
                {t("account.openAuth")}
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
