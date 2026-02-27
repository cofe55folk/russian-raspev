import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  type PodcastDb,
  type PodcastEpisode,
  type PodcastShow,
  isValidPodcastAudioUrl,
  isValidPodcastSlug,
  isValidPodcastTitle,
  normalizePodcastDb,
} from "./podcast-schema";

const PODCAST_DB_PATH = path.join(process.cwd(), "data", "podcast", "podcast-db.json");

let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

const DEFAULT_PODCAST_DB: PodcastDb = normalizePodcastDb({
  shows: [
    {
      slug: "folk-voice-lab",
      title: "Folk Voice Lab",
      description: "Практика народного вокала: разборы, дыхание и интонация.",
      coverImageUrl: "/images/community-collab-default.svg",
      episodeSlugs: ["warmup-breath-01", "phrase-rhythm-02"],
    },
  ],
  episodes: [
    {
      slug: "warmup-breath-01",
      showSlug: "folk-voice-lab",
      title: "Разогрев дыхания перед распевкой",
      description: "Короткий прогон для дыхания и устойчивой атаки.",
      audioUrl: "/audio/selezen/selezen-01.m4a",
      publishedAt: "2026-01-10T08:00:00.000Z",
      durationSec: 240,
      chapters: [
        { id: "intro", title: "Ввод", startSec: 0 },
        { id: "voice-release", title: "Освобождение голоса", startSec: 24 },
        { id: "air-column", title: "Воздушная колонна", startSec: 72 },
      ],
      transcript: {
        lines: [
          { id: "line-1", startSec: 0, text: "Начинаем с мягкого вдоха и спокойного выдоха." },
          { id: "line-2", startSec: 24, text: "Переходим к связке дыхания и гласных." },
          { id: "line-3", startSec: 72, text: "Добавляем устойчивость на длинной фразе." },
        ],
      },
    },
    {
      slug: "phrase-rhythm-02",
      showSlug: "folk-voice-lab",
      title: "Фразировка и пульсация",
      description: "Работа с долей и акцентами в коротком фрагменте.",
      audioUrl: "/audio/selezen/selezen-02.m4a",
      publishedAt: "2026-01-17T08:00:00.000Z",
      durationSec: 310,
      chapters: [
        { id: "pulse", title: "Пульсация", startSec: 0 },
        { id: "phrase", title: "Фразировка", startSec: 38 },
      ],
      transcript: {
        lines: [
          { id: "line-1", startSec: 0, text: "Собираем ровный пульс на гласной." },
          { id: "line-2", startSec: 38, text: "Переносим акцент на опорные слова фразы." },
        ],
      },
    },
  ],
});

const MEDIA_ASSET_ID_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)--([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export type PodcastUpsertError = "INVALID_SLUG" | "INVALID_TITLE" | "INVALID_AUDIO_URL" | "SHOW_NOT_FOUND";

export type PodcastUpsertResult<T> = { ok: true; value: T } | { ok: false; error: PodcastUpsertError };

function cloneDefaultDb(): PodcastDb {
  return normalizePodcastDb(JSON.parse(JSON.stringify(DEFAULT_PODCAST_DB)));
}

function normalizeDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 800) : undefined;
}

function normalizeIsoDate(value: unknown): string {
  if (typeof value === "string") {
    const ts = Date.parse(value);
    if (Number.isFinite(ts)) return new Date(ts).toISOString();
  }
  return new Date().toISOString();
}

function normalizeDuration(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.floor(num));
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(PODCAST_DB_PATH), { recursive: true });
}

async function readDb(): Promise<PodcastDb> {
  try {
    const raw = await fs.readFile(PODCAST_DB_PATH, "utf8");
    return normalizePodcastDb(JSON.parse(raw));
  } catch {
    return cloneDefaultDb();
  }
}

async function writeDb(db: PodcastDb): Promise<void> {
  const payload = `${JSON.stringify(normalizePodcastDb(db), null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${PODCAST_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, PODCAST_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: PodcastDb) => Promise<T> | T): Promise<T> {
  const previous = mutationQueue;
  let unlock: () => void = () => {};
  mutationQueue = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  try {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  } finally {
    unlock();
  }
}

export async function listPodcastShows(): Promise<PodcastShow[]> {
  const db = await readDb();
  return [...db.shows].sort((left, right) => left.title.localeCompare(right.title));
}

export async function getPodcastShowBySlug(showSlug: string): Promise<PodcastShow | null> {
  const db = await readDb();
  return db.shows.find((item) => item.slug === showSlug) ?? null;
}

export async function listPodcastEpisodesByShowSlug(showSlug: string): Promise<PodcastEpisode[]> {
  const db = await readDb();
  return db.episodes
    .filter((item) => item.showSlug === showSlug)
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());
}

export async function getPodcastEpisodeBySlugs(showSlug: string, episodeSlug: string): Promise<PodcastEpisode | null> {
  const db = await readDb();
  return db.episodes.find((item) => item.showSlug === showSlug && item.slug === episodeSlug) ?? null;
}

export async function getPodcastShowWithEpisodes(
  showSlug: string
): Promise<{ show: PodcastShow; episodes: PodcastEpisode[] } | null> {
  const [show, episodes] = await Promise.all([getPodcastShowBySlug(showSlug), listPodcastEpisodesByShowSlug(showSlug)]);
  if (!show) return null;
  return { show, episodes };
}

export function encodePodcastMediaAssetId(showSlug: string, episodeSlug: string): string {
  return `${showSlug.trim()}--${episodeSlug.trim()}`;
}

export function decodePodcastMediaAssetId(assetId: string): { showSlug: string; episodeSlug: string } | null {
  const match = assetId.trim().match(MEDIA_ASSET_ID_RE);
  if (!match) return null;
  const showSlug = match[1] || "";
  const episodeSlug = match[2] || "";
  if (!showSlug || !episodeSlug) return null;
  return { showSlug, episodeSlug };
}

export async function getPodcastMediaAssetById(
  assetId: string
): Promise<{ assetId: string; show: PodcastShow; episode: PodcastEpisode } | null> {
  const decoded = decodePodcastMediaAssetId(assetId);
  if (!decoded) return null;
  const [show, episode] = await Promise.all([
    getPodcastShowBySlug(decoded.showSlug),
    getPodcastEpisodeBySlugs(decoded.showSlug, decoded.episodeSlug),
  ]);
  if (!show || !episode) return null;
  return { assetId: encodePodcastMediaAssetId(show.slug, episode.slug), show, episode };
}

export async function upsertPodcastShow(params: {
  slug: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
}): Promise<PodcastUpsertResult<PodcastShow>> {
  if (!isValidPodcastSlug(params.slug)) return { ok: false, error: "INVALID_SLUG" };
  if (!isValidPodcastTitle(params.title)) return { ok: false, error: "INVALID_TITLE" };

  return withDbMutation(async (db) => {
    const slug = params.slug.trim();
    const normalized: PodcastShow = {
      slug,
      title: params.title.trim().replace(/\s+/g, " "),
      description: normalizeDescription(params.description),
      coverImageUrl: typeof params.coverImageUrl === "string" && params.coverImageUrl.trim() ? params.coverImageUrl.trim() : undefined,
      episodeSlugs:
        db.shows.find((item) => item.slug === slug)?.episodeSlugs ||
        db.episodes.filter((item) => item.showSlug === slug).map((item) => item.slug),
    };

    const existingIndex = db.shows.findIndex((item) => item.slug === slug);
    if (existingIndex >= 0) {
      db.shows[existingIndex] = normalized;
    } else {
      db.shows.push(normalized);
    }
    const normalizedDb = normalizePodcastDb(db);
    db.shows = normalizedDb.shows;
    db.episodes = normalizedDb.episodes;
    const saved = db.shows.find((item) => item.slug === slug) || normalized;
    return { ok: true as const, value: saved };
  });
}

export async function upsertPodcastEpisode(params: {
  slug: string;
  showSlug: string;
  title: string;
  description?: string;
  audioUrl: string;
  publishedAt?: string;
  durationSec?: number;
  chapters?: PodcastEpisode["chapters"];
  transcript?: PodcastEpisode["transcript"];
}): Promise<PodcastUpsertResult<PodcastEpisode>> {
  if (!isValidPodcastSlug(params.slug) || !isValidPodcastSlug(params.showSlug)) {
    return { ok: false, error: "INVALID_SLUG" };
  }
  if (!isValidPodcastTitle(params.title)) return { ok: false, error: "INVALID_TITLE" };
  if (!isValidPodcastAudioUrl(params.audioUrl)) return { ok: false, error: "INVALID_AUDIO_URL" };

  return withDbMutation(async (db) => {
    const showExists = db.shows.some((item) => item.slug === params.showSlug.trim());
    if (!showExists) return { ok: false as const, error: "SHOW_NOT_FOUND" as const };

    const slug = params.slug.trim();
    const showSlug = params.showSlug.trim();
    const draft: PodcastEpisode = {
      slug,
      showSlug,
      title: params.title.trim().replace(/\s+/g, " "),
      description: normalizeDescription(params.description),
      audioUrl: params.audioUrl.trim(),
      publishedAt: normalizeIsoDate(params.publishedAt),
      durationSec: normalizeDuration(params.durationSec),
      chapters: Array.isArray(params.chapters) ? params.chapters : [],
      transcript: params.transcript && Array.isArray(params.transcript.lines) ? params.transcript : { lines: [] },
    };

    const existingIndex = db.episodes.findIndex((item) => item.slug === slug);
    if (existingIndex >= 0) {
      db.episodes[existingIndex] = draft;
    } else {
      db.episodes.push(draft);
    }

    const normalizedDb = normalizePodcastDb(db);
    db.shows = normalizedDb.shows;
    db.episodes = normalizedDb.episodes;

    const saved = db.episodes.find((item) => item.slug === slug && item.showSlug === showSlug);
    if (!saved) return { ok: false as const, error: "INVALID_SLUG" as const };
    return { ok: true as const, value: saved };
  });
}
