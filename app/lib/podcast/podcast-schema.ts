export type PodcastChapter = {
  id: string;
  title: string;
  startSec: number;
};

export type PodcastTranscriptLine = {
  id: string;
  startSec: number;
  endSec?: number;
  text: string;
};

export type PodcastTranscript = {
  lines: PodcastTranscriptLine[];
};

export type PodcastEpisode = {
  slug: string;
  showSlug: string;
  title: string;
  description?: string;
  audioUrl: string;
  publishedAt: string;
  durationSec?: number;
  chapters: PodcastChapter[];
  transcript: PodcastTranscript;
};

export type PodcastShow = {
  slug: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  episodeSlugs: string[];
};

export type PodcastDb = {
  shows: PodcastShow[];
  episodes: PodcastEpisode[];
};

const PODCAST_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TITLE_LENGTH = 180;

export function isValidPodcastSlug(value: unknown): value is string {
  return typeof value === "string" && PODCAST_SLUG_RE.test(value.trim());
}

export function isValidPodcastTitle(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 2 && normalized.length <= MAX_TITLE_LENGTH;
}

export function isValidPodcastAudioUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.startsWith("/")) return true;
  return normalized.startsWith("https://") || normalized.startsWith("http://");
}

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeSlug(value: unknown): string | null {
  if (!isValidPodcastSlug(value)) return null;
  return value.trim();
}

function normalizeAudioUrl(value: unknown): string | null {
  if (!isValidPodcastAudioUrl(value)) return null;
  return (value as string).trim();
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function normalizeSeconds(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const seconds = Math.max(0, Math.floor(num));
  return seconds;
}

function normalizeChapter(value: unknown, index: number): PodcastChapter | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PodcastChapter>;
  const title = normalizeText(raw.title, 1, MAX_TITLE_LENGTH);
  const startSec = normalizeSeconds(raw.startSec);
  if (!title || startSec == null) return null;
  const id = normalizeSlug(raw.id) ?? `chapter-${index + 1}`;
  return { id, title, startSec };
}

function normalizeTranscriptLine(value: unknown, index: number): PodcastTranscriptLine | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PodcastTranscriptLine>;
  const text = normalizeText(raw.text, 1, 600);
  const startSec = normalizeSeconds(raw.startSec);
  if (!text || startSec == null) return null;
  const endSec = raw.endSec == null ? undefined : normalizeSeconds(raw.endSec) ?? undefined;
  const id = normalizeSlug(raw.id) ?? `line-${index + 1}`;
  return {
    id,
    startSec,
    endSec: endSec != null && endSec >= startSec ? endSec : undefined,
    text,
  };
}

function normalizeTranscript(value: unknown): PodcastTranscript {
  if (!value || typeof value !== "object") return { lines: [] };
  const raw = value as Partial<PodcastTranscript>;
  const lines = Array.isArray(raw.lines)
    ? raw.lines.map((item, idx) => normalizeTranscriptLine(item, idx)).filter((item): item is PodcastTranscriptLine => !!item)
    : [];
  return {
    lines: lines.sort((left, right) => left.startSec - right.startSec),
  };
}

function normalizeEpisode(value: unknown): PodcastEpisode | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PodcastEpisode>;
  const slug = normalizeSlug(raw.slug);
  const showSlug = normalizeSlug(raw.showSlug);
  const title = normalizeText(raw.title, 2, MAX_TITLE_LENGTH);
  const audioUrl = normalizeAudioUrl(raw.audioUrl);
  if (!slug || !showSlug || !title || !audioUrl) return null;
  const publishedAt = normalizeIsoDate(raw.publishedAt) ?? new Date(0).toISOString();
  const durationSec = raw.durationSec == null ? undefined : normalizeSeconds(raw.durationSec) ?? undefined;
  const description = raw.description == null ? undefined : normalizeText(raw.description, 1, 800) ?? undefined;
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters.map((item, idx) => normalizeChapter(item, idx)).filter((item): item is PodcastChapter => !!item)
    : [];
  const transcript = normalizeTranscript(raw.transcript);
  return {
    slug,
    showSlug,
    title,
    description,
    audioUrl,
    publishedAt,
    durationSec,
    chapters: chapters.sort((left, right) => left.startSec - right.startSec),
    transcript,
  };
}

function normalizeShow(value: unknown): PodcastShow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PodcastShow>;
  const slug = normalizeSlug(raw.slug);
  const title = normalizeText(raw.title, 2, MAX_TITLE_LENGTH);
  if (!slug || !title) return null;
  const description = raw.description == null ? undefined : normalizeText(raw.description, 1, 800) ?? undefined;
  const coverImageUrl =
    raw.coverImageUrl == null
      ? undefined
      : typeof raw.coverImageUrl === "string" && raw.coverImageUrl.trim()
        ? raw.coverImageUrl.trim()
        : undefined;
  const episodeSlugs = Array.isArray(raw.episodeSlugs)
    ? raw.episodeSlugs.map(normalizeSlug).filter((item): item is string => !!item)
    : [];
  return {
    slug,
    title,
    description,
    coverImageUrl,
    episodeSlugs,
  };
}

export function normalizePodcastDb(input: unknown): PodcastDb {
  const raw = input && typeof input === "object" ? (input as Partial<PodcastDb>) : {};
  const normalizedShows = Array.isArray(raw.shows)
    ? raw.shows.map(normalizeShow).filter((item): item is PodcastShow => !!item)
    : [];
  const normalizedEpisodes = Array.isArray(raw.episodes)
    ? raw.episodes.map(normalizeEpisode).filter((item): item is PodcastEpisode => !!item)
    : [];

  const showBySlug = new Map<string, PodcastShow>();
  for (const show of normalizedShows) {
    if (!showBySlug.has(show.slug)) {
      showBySlug.set(show.slug, show);
    }
  }

  const episodeBySlug = new Map<string, PodcastEpisode>();
  for (const episode of normalizedEpisodes) {
    if (!showBySlug.has(episode.showSlug)) continue;
    if (!episodeBySlug.has(episode.slug)) {
      episodeBySlug.set(episode.slug, episode);
    }
  }

  const episodes = Array.from(episodeBySlug.values()).sort(
    (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
  );

  const episodeSlugsByShow = new Map<string, string[]>();
  for (const showSlug of showBySlug.keys()) {
    episodeSlugsByShow.set(showSlug, []);
  }
  for (const episode of episodes) {
    const list = episodeSlugsByShow.get(episode.showSlug);
    if (!list) continue;
    list.push(episode.slug);
  }

  const shows = Array.from(showBySlug.values()).map((show) => {
    const existingValid = show.episodeSlugs.filter((slug) => {
      const episode = episodeBySlug.get(slug);
      return !!episode && episode.showSlug === show.slug;
    });
    const fromEpisodes = episodeSlugsByShow.get(show.slug) || [];
    const deduped = Array.from(new Set([...existingValid, ...fromEpisodes]));
    return {
      ...show,
      episodeSlugs: deduped,
    };
  });

  return {
    shows,
    episodes,
  };
}
