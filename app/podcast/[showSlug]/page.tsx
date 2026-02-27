import type { Metadata } from "next";
import Link from "next/link";
import { I18N_MESSAGES, type I18nKey } from "../../lib/i18n/messages";
import { readRequestLocale } from "../../lib/i18n/server";
import { getPodcastShowWithEpisodes } from "../../lib/podcast/podcast-store";

const FALLBACK_SITE_URL = "http://localhost:3000";

type PodcastShowPageProps = {
  params: Promise<{ showSlug: string }>;
};

function formatPublishedDate(iso: string, locale: "ru" | "en"): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function withCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

export async function generateMetadata({ params }: PodcastShowPageProps): Promise<Metadata> {
  const locale = await readRequestLocale();
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];
  const { showSlug } = await params;
  const metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL);

  try {
    const data = await getPodcastShowWithEpisodes(showSlug);
    if (!data) {
      return {
        metadataBase,
        title: t("podcast.show.metaNotFoundTitle"),
        description: t("podcast.show.metaNotFoundDescription"),
      };
    }

    const canonical = `/podcast/${data.show.slug}`;
    const fallbackDescription = withCount(t("podcast.show.metaEpisodesCount"), data.episodes.length);
    return {
      metadataBase,
      title: `${data.show.title} | ${t("podcast.show.metaTitleSuffix")}`,
      description: data.show.description || fallbackDescription,
      alternates: {
        canonical,
      },
      openGraph: {
        title: data.show.title,
        description: data.show.description || fallbackDescription,
        type: "website",
        url: canonical,
      },
    };
  } catch {
    return {
      metadataBase,
      title: t("podcast.show.metaFallbackTitle"),
      description: t("podcast.show.metaFallbackDescription"),
    };
  }
}

export default async function PodcastShowPage({ params }: PodcastShowPageProps) {
  const locale = await readRequestLocale();
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];
  const { showSlug } = await params;

  let data: Awaited<ReturnType<typeof getPodcastShowWithEpisodes>> | null = null;
  let hasError = false;
  try {
    data = await getPodcastShowWithEpisodes(showSlug);
  } catch {
    hasError = true;
  }

  if (hasError) {
    return (
      <main className="rr-main">
        <section className="rr-container mt-10">
          <div className="rr-panel p-6 text-zinc-100" data-testid="podcast-show-error">
            {t("podcast.show.errorLoad")}
          </div>
        </section>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="rr-main">
        <section className="rr-container mt-10">
          <div className="rr-panel p-6 text-zinc-100" data-testid="podcast-show-missing">
            {t("podcast.show.notFound")}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="rr-main">
      <section className="rr-container mt-10">
        <div className="rr-panel mb-6 p-6">
          <h1 className="rr-card-title text-3xl text-white" data-testid="podcast-show-title">
            {data.show.title}
          </h1>
          <p className="rr-card-text mt-3 text-zinc-200">{data.show.description || t("podcast.show.noDescription")}</p>
        </div>

        {data.episodes.length === 0 ? (
          <div className="rr-panel p-6 text-zinc-100" data-testid="podcast-show-empty">
            {t("podcast.show.emptyEpisodes")}
          </div>
        ) : (
          <div className="grid gap-4" data-testid="podcast-show-episodes">
            {data.episodes.map((episode) => (
              <article key={episode.slug} className="rr-panel p-5" data-testid={`podcast-episode-card-${episode.slug}`}>
                <div className="text-xs uppercase tracking-[0.08em] text-zinc-400">{formatPublishedDate(episode.publishedAt, locale)}</div>
                <h2 className="rr-card-title mt-2 text-xl text-white">{episode.title}</h2>
                <p className="rr-card-text mt-2 text-zinc-200">{episode.description || t("podcast.show.episodeNoDescription")}</p>
                <Link
                  href={`/podcast/${data.show.slug}/${episode.slug}`}
                  className="rr-primary-btn mt-4 inline-flex px-5 py-2"
                  data-testid={`podcast-episode-link-${episode.slug}`}
                >
                  {t("podcast.show.openEpisode")}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
