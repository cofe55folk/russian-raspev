import Link from "next/link";
import { I18N_MESSAGES, type I18nKey } from "../../../lib/i18n/messages";
import { readRequestLocale } from "../../../lib/i18n/server";
import { getPodcastShowWithEpisodes } from "../../../lib/podcast/podcast-store";

type PodcastEpisodePageProps = {
  params: Promise<{ showSlug: string; episodeSlug: string }>;
  searchParams?: Promise<{ t?: string }>;
};

function formatTime(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseTargetSec(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function withTime(template: string, time: string): string {
  return template.replace("{time}", time);
}

export default async function PodcastEpisodePage({ params, searchParams }: PodcastEpisodePageProps) {
  const locale = await readRequestLocale();
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];
  const { showSlug, episodeSlug } = await params;
  const query = searchParams ? await searchParams : undefined;

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
          <div className="rr-panel p-6 text-zinc-100" data-testid="podcast-episode-error">
            {t("podcast.episode.errorLoad")}
          </div>
        </section>
      </main>
    );
  }

  const show = data?.show;
  const episode = data?.episodes.find((item) => item.slug === episodeSlug);
  if (!show || !episode) {
    return (
      <main className="rr-main">
        <section className="rr-container mt-10">
          <div className="rr-panel p-6 text-zinc-100" data-testid="podcast-episode-missing">
            {t("podcast.episode.notFound")}
          </div>
        </section>
      </main>
    );
  }

  const defaultTarget = episode.chapters[0]?.startSec ?? 0;
  const targetSec = parseTargetSec(query?.t, defaultTarget);

  return (
    <main className="rr-main">
      <section className="rr-container mt-10">
        <div className="rr-panel mb-6 p-6">
          <Link href={`/podcast/${show.slug}`} className="text-sm text-[#9cc4ff] hover:underline" data-testid="podcast-episode-back-link">
            ← {show.title}
          </Link>
          <h1 className="rr-card-title mt-3 text-3xl text-white" data-testid="podcast-episode-title">
            {episode.title}
          </h1>
          <p className="rr-card-text mt-3 text-zinc-200">{episode.description || t("podcast.episode.noDescription")}</p>
        </div>

        <div className="rr-panel mb-6 p-6">
          <audio id="podcast-player" controls preload="none" src={episode.audioUrl} className="w-full" data-testid="podcast-player">
            {t("podcast.episode.audioUnsupported")}
          </audio>
          <div className="mt-3 text-sm text-zinc-300" data-testid="podcast-target-time" data-target-sec={String(targetSec)}>
            {withTime(t("podcast.episode.targetTime"), formatTime(targetSec))}
          </div>
        </div>

        <div className="rr-panel mb-6 p-6" data-testid="podcast-chapters">
          <h2 className="rr-card-title text-xl text-white">{t("podcast.episode.chaptersTitle")}</h2>
          {episode.chapters.length === 0 ? (
            <p className="rr-card-text mt-3 text-zinc-200">{t("podcast.episode.chaptersEmpty")}</p>
          ) : (
            <ol className="mt-4 space-y-2">
              {episode.chapters.map((chapter) => (
                <li key={chapter.id}>
                  <Link
                    href={`/podcast/${show.slug}/${episode.slug}?t=${chapter.startSec}#podcast-player`}
                    className={`inline-flex gap-2 text-sm ${targetSec === chapter.startSec ? "text-[#9cc4ff]" : "text-zinc-200 hover:text-white"}`}
                    data-testid={`podcast-chapter-link-${chapter.id}`}
                    data-target-sec={String(chapter.startSec)}
                  >
                    <span>{formatTime(chapter.startSec)}</span>
                    <span>{chapter.title}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>

        <details className="rr-panel p-6" data-testid="podcast-transcript">
          <summary className="cursor-pointer text-lg text-white" data-testid="podcast-transcript-toggle">
            {t("podcast.episode.transcriptTitle")}
          </summary>
          {episode.transcript.lines.length === 0 ? (
            <p className="rr-card-text mt-4 text-zinc-200" data-testid="podcast-transcript-empty">
              {t("podcast.episode.transcriptEmpty")}
            </p>
          ) : (
            <ol className="mt-4 space-y-3">
              {episode.transcript.lines.map((line, index) => (
                <li key={line.id} className="text-sm text-zinc-200" data-testid={`podcast-transcript-line-${index + 1}`}>
                  <span className="mr-2 text-xs uppercase tracking-[0.08em] text-zinc-400">{formatTime(line.startSec)}</span>
                  <span>{line.text}</span>
                </li>
              ))}
            </ol>
          )}
        </details>
      </section>
    </main>
  );
}
