import { notFound } from "next/navigation";
import PageHero from "../../components/PageHero";
import { getCommunityUserProfileByHandle } from "../../lib/community/profiles";
import { isPreviewFeatureEnabledForCookieStore } from "../../lib/feature-flags/preview";
import { I18N_MESSAGES } from "../../lib/i18n/messages";
import { readRequestLocale } from "../../lib/i18n/server";
import { listPublicCreatorTracksByOwner } from "../../lib/ugc/tracks-store";

type PageProps = {
  params: Promise<{ handle: string }>;
};

function ringClass(style: "none" | "sky" | "emerald" | "gold"): string {
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

export default async function PublicProfilePage({ params }: PageProps) {
  const { handle } = await params;
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;
  const ugcCreatorTracksEnabled = await isPreviewFeatureEnabledForCookieStore("ugc_creator_tracks");

  const profile = await getCommunityUserProfileByHandle(handle);
  if (!profile || profile.visibility !== "public") return notFound();
  const tracks = ugcCreatorTracksEnabled ? await listPublicCreatorTracksByOwner(profile.userId) : [];

  const displayName = profile.displayName || `@${profile.handle}`;
  const normalizedHandle = profile.handle || handle.toLowerCase();

  return (
    <main className="rr-main pb-12">
      <PageHero title={displayName} subtitle={`@${normalizedHandle}`} />

      <section className="rr-container mt-8 max-w-3xl">
        <article className="rr-article-panel space-y-4 p-5" data-testid="public-profile-card">
          <div className="flex items-center gap-4">
            <div className={`h-16 w-16 overflow-hidden rounded-full border-2 ${ringClass(profile.ringStyle)}`}>
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatarUrl} alt={displayName} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#2b303a] text-base font-semibold text-[#d5dbea]">
                  {initialsFromName(displayName)}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <div className="text-lg font-semibold text-[#e6e8ec]">{displayName}</div>
              <div className="text-sm text-[#9cc4ff]">@{normalizedHandle}</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-[#7f8ba1]">{t("profile.bio")}</div>
            <div className="rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2 text-sm text-[#d7deea]" data-testid="public-profile-bio">
              {profile.bio || t("profile.publicBioEmpty")}
            </div>
          </div>

          {ugcCreatorTracksEnabled ? (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-[#7f8ba1]">{t("profile.tracksTitle")}</div>
              {tracks.length ? (
                <div className="grid gap-3" data-testid="public-profile-tracks">
                  {tracks.map((track) => (
                    <article
                      key={track.id}
                      className="rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2"
                      data-testid={`public-profile-track-${track.slug}`}
                    >
                      <div className="text-sm font-semibold text-[#e6e8ec]">{track.title}</div>
                      {track.subtitle ? <div className="text-xs text-[#9aa3b2]">{track.subtitle}</div> : null}
                      {track.description ? <div className="mt-1 text-xs text-[#cbd2de]">{track.description}</div> : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#8aa6d8]">
                        <span>{t("profile.trackStems")}: {track.stems.length}</span>
                        {track.stems.some((stem) => stem.accessTier === "premium") ? (
                          <span className="rounded-full border border-[#6b4d2d] bg-[#3a2b1b] px-2 py-0.5 text-[#ffdca8]">
                            {t("profile.trackHasPremiumStems")}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2 text-sm text-[#9aa3b2]" data-testid="public-profile-no-tracks">
                  {t("profile.noPublicTracks")}
                </div>
              )}
            </div>
          ) : null}
        </article>
      </section>
    </main>
  );
}
