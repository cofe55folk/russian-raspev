import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { getUgcAssetById, readUgcAssetBytes } from "./assets-store-file";
import { estimateWavStemAlignment } from "./alignment";

const UGC_TRACKS_DB_PATH = path.join(process.cwd(), "data", "ugc", "creator-tracks-db.json");
let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

export type UgcTrackVisibility = "private" | "unlisted" | "public";
export type UgcTrackStatus = "draft" | "published";
export type UgcStemAccessTier = "free" | "premium";
export type UgcStemAlignStatus = "pending" | "aligned" | "needs_review";
export type UgcStemAlignMethod = "manual" | "rms_correlation" | "transient_anchor";

export type UgcTrackStemDraft = {
  id: string;
  sortOrder: number;
  label: string;
  accessTier: UgcStemAccessTier;
  entitlementCode?: string;
  durationSec?: number;
  assetUploadId?: string;
  assetMimeType?: string;
  assetSizeBytes?: number;
  referenceStemId?: string;
  alignmentOffsetMs?: number;
  alignmentScore?: number;
  alignmentStatus: UgcStemAlignStatus;
  alignmentMethod?: UgcStemAlignMethod;
  alignmentMeasuredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UgcTrackRecord = {
  id: string;
  ownerId: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  language?: string;
  visibility: UgcTrackVisibility;
  status: UgcTrackStatus;
  entitlementCode?: string;
  stems: UgcTrackStemDraft[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
};

type UgcTracksDb = {
  tracks: UgcTrackRecord[];
};

const EMPTY_DB: UgcTracksDb = {
  tracks: [],
};

export class UgcTrackSlugTakenError extends Error {
  constructor() {
    super("TRACK_SLUG_TAKEN");
    this.name = "UgcTrackSlugTakenError";
  }
}

function normalizeVisibility(value: unknown): UgcTrackVisibility {
  if (value === "public") return "public";
  if (value === "unlisted") return "unlisted";
  return "private";
}

function normalizeStatus(value: unknown): UgcTrackStatus {
  return value === "published" ? "published" : "draft";
}

function normalizeStemAccessTier(value: unknown): UgcStemAccessTier {
  return value === "premium" ? "premium" : "free";
}

function normalizeStemAlignStatus(value: unknown): UgcStemAlignStatus {
  if (value === "aligned") return "aligned";
  if (value === "needs_review") return "needs_review";
  return "pending";
}

function normalizeStemAlignMethod(value: unknown): UgcStemAlignMethod | undefined {
  if (value === "manual") return "manual";
  if (value === "rms_correlation") return "rms_correlation";
  if (value === "transient_anchor") return "transient_anchor";
  return undefined;
}

function normalizeSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const slug = value.trim().toLowerCase();
  if (!slug) return undefined;
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug)) return undefined;
  return slug;
}

function normalizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, limit);
}

function normalizeLanguage(value: unknown): string | undefined {
  return normalizeText(value, 12);
}

function normalizeEntitlementCode(value: unknown): string | undefined {
  return normalizeText(value, 160);
}

function normalizeSizeBytes(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

function normalizeAlignmentOffsetMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(-5000, Math.min(5000, Math.round(value)));
}

function normalizeAlignmentScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const clamped = Math.max(0, Math.min(1, value));
  return Number(clamped.toFixed(3));
}

function normalizeStemDraft(
  item: unknown,
  fallbackOrder: number
): Omit<UgcTrackStemDraft, "id" | "createdAt" | "updatedAt"> | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Partial<UgcTrackStemDraft>;
  const label = normalizeText(raw.label, 120);
  if (!label) return null;
  const durationSec =
    typeof raw.durationSec === "number" && Number.isFinite(raw.durationSec)
      ? Math.max(0, Math.floor(raw.durationSec))
      : undefined;
  return {
    sortOrder:
      typeof raw.sortOrder === "number" && Number.isFinite(raw.sortOrder)
        ? Math.max(0, Math.floor(raw.sortOrder))
        : fallbackOrder,
    label,
    accessTier: normalizeStemAccessTier(raw.accessTier),
    entitlementCode: normalizeEntitlementCode(raw.entitlementCode),
    durationSec,
    assetUploadId: normalizeText(raw.assetUploadId, 120),
    assetMimeType: normalizeText(raw.assetMimeType, 120),
    assetSizeBytes: normalizeSizeBytes(raw.assetSizeBytes),
    referenceStemId: normalizeText(raw.referenceStemId, 120),
    alignmentOffsetMs: normalizeAlignmentOffsetMs(raw.alignmentOffsetMs),
    alignmentScore: normalizeAlignmentScore(raw.alignmentScore),
    alignmentStatus: normalizeStemAlignStatus(raw.alignmentStatus),
    alignmentMethod: normalizeStemAlignMethod(raw.alignmentMethod),
    alignmentMeasuredAt: normalizeText(raw.alignmentMeasuredAt, 40),
  };
}

function normalizeTrack(input: unknown): UgcTrackRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<UgcTrackRecord>;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (typeof raw.ownerId !== "string" || !raw.ownerId.trim()) return null;
  const slug = normalizeSlug(raw.slug);
  if (!slug) return null;
  const title = normalizeText(raw.title, 140);
  if (!title) return null;
  const createdAt = normalizeText(raw.createdAt, 40);
  const updatedAt = normalizeText(raw.updatedAt, 40);
  if (!createdAt || !updatedAt) return null;

  const stemsInput = Array.isArray(raw.stems) ? raw.stems : [];
  const stems: UgcTrackStemDraft[] = [];
  for (let index = 0; index < stemsInput.length; index += 1) {
    const item = stemsInput[index];
    const normalized = normalizeStemDraft(item, index);
    if (!normalized) continue;
    const source = item as Partial<UgcTrackStemDraft>;
    stems.push({
      id: typeof source.id === "string" && source.id.trim() ? source.id : randomUUID(),
      sortOrder: normalized.sortOrder,
      label: normalized.label,
      accessTier: normalized.accessTier,
      entitlementCode: normalized.entitlementCode,
      durationSec: normalized.durationSec,
      assetUploadId: normalized.assetUploadId,
      assetMimeType: normalized.assetMimeType,
      assetSizeBytes: normalized.assetSizeBytes,
      referenceStemId: normalized.referenceStemId,
      alignmentOffsetMs: normalized.alignmentOffsetMs,
      alignmentScore: normalized.alignmentScore,
      alignmentStatus: normalized.alignmentStatus,
      alignmentMethod: normalized.alignmentMethod,
      alignmentMeasuredAt: normalized.alignmentMeasuredAt,
      createdAt:
        typeof source.createdAt === "string" && source.createdAt.trim() ? source.createdAt : createdAt,
      updatedAt:
        typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt : updatedAt,
    });
  }
  stems.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    id: raw.id,
    ownerId: raw.ownerId,
    slug,
    title,
    subtitle: normalizeText(raw.subtitle, 180),
    description: normalizeText(raw.description, 1000),
    language: normalizeLanguage(raw.language),
    visibility: normalizeVisibility(raw.visibility),
    status: normalizeStatus(raw.status),
    entitlementCode: normalizeEntitlementCode(raw.entitlementCode),
    stems,
    createdAt,
    updatedAt,
    publishedAt: raw.publishedAt ? normalizeText(raw.publishedAt, 40) : null,
  };
}

function normalizeDb(input: unknown): UgcTracksDb {
  if (!input || typeof input !== "object") return EMPTY_DB;
  const raw = input as Partial<UgcTracksDb>;
  return {
    tracks: Array.isArray(raw.tracks)
      ? raw.tracks.map(normalizeTrack).filter((item): item is UgcTrackRecord => !!item)
      : [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(UGC_TRACKS_DB_PATH), { recursive: true });
}

async function readDb(): Promise<UgcTracksDb> {
  try {
    const raw = await fs.readFile(UGC_TRACKS_DB_PATH, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DB, tracks: [] };
  }
}

async function writeDb(db: UgcTracksDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    const tempPath = `${UGC_TRACKS_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, UGC_TRACKS_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: UgcTracksDb) => Promise<T> | T): Promise<T> {
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

export async function listCreatorTracksByOwner(ownerId: string): Promise<UgcTrackRecord[]> {
  const db = await readDb();
  return db.tracks
    .filter((item) => item.ownerId === ownerId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listPublicCreatorTracksByOwner(ownerId: string): Promise<UgcTrackRecord[]> {
  const db = await readDb();
  return db.tracks
    .filter((item) => item.ownerId === ownerId && item.visibility === "public" && item.status === "published")
    .sort((a, b) => {
      const aTs = new Date(a.publishedAt || a.updatedAt).getTime();
      const bTs = new Date(b.publishedAt || b.updatedAt).getTime();
      return bTs - aTs;
    });
}

export async function getCreatorTrackByIdForOwner(
  ownerId: string,
  trackId: string
): Promise<UgcTrackRecord | null> {
  const db = await readDb();
  return db.tracks.find((item) => item.id === trackId && item.ownerId === ownerId) ?? null;
}

export async function createCreatorTrackDraft(params: {
  ownerId: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  language?: string;
  visibility?: UgcTrackVisibility;
  status?: UgcTrackStatus;
  entitlementCode?: string;
  stems?: Array<{
    label?: string;
    sortOrder?: number;
    accessTier?: UgcStemAccessTier;
    entitlementCode?: string;
    durationSec?: number;
    assetUploadId?: string;
    assetMimeType?: string;
    assetSizeBytes?: number;
    referenceStemId?: string;
    alignmentOffsetMs?: number;
    alignmentScore?: number;
    alignmentStatus?: UgcStemAlignStatus;
    alignmentMethod?: UgcStemAlignMethod;
    alignmentMeasuredAt?: string;
  }>;
}): Promise<UgcTrackRecord> {
  return withDbMutation(async (db) => {
    const slug = normalizeSlug(params.slug);
    const title = normalizeText(params.title, 140);
    if (!slug || !title) throw new Error("INVALID_TRACK_PAYLOAD");
    const exists = db.tracks.some((item) => item.ownerId === params.ownerId && item.slug === slug);
    if (exists) throw new UgcTrackSlugTakenError();

    const now = new Date().toISOString();
    const status = normalizeStatus(params.status);
    const stemsInput = Array.isArray(params.stems) ? params.stems : [];
    const stems: UgcTrackStemDraft[] = [];
    for (let index = 0; index < stemsInput.length; index += 1) {
      const item = stemsInput[index];
      const normalized = normalizeStemDraft(item, index);
      if (!normalized) continue;
      stems.push({
        id: randomUUID(),
        sortOrder: normalized.sortOrder,
        label: normalized.label,
        accessTier: normalized.accessTier,
        entitlementCode: normalized.entitlementCode,
        durationSec: normalized.durationSec,
        assetUploadId: normalized.assetUploadId,
        assetMimeType: normalized.assetMimeType,
        assetSizeBytes: normalized.assetSizeBytes,
        referenceStemId: normalized.referenceStemId,
        alignmentOffsetMs: normalized.alignmentOffsetMs,
        alignmentScore: normalized.alignmentScore,
        alignmentStatus: normalized.alignmentStatus,
        alignmentMethod: normalized.alignmentMethod,
        alignmentMeasuredAt: normalized.alignmentMeasuredAt,
        createdAt: now,
        updatedAt: now,
      });
    }
    stems.sort((a, b) => a.sortOrder - b.sortOrder);

    const created: UgcTrackRecord = {
      id: randomUUID(),
      ownerId: params.ownerId,
      slug,
      title,
      subtitle: normalizeText(params.subtitle, 180),
      description: normalizeText(params.description, 1000),
      language: normalizeLanguage(params.language),
      visibility: normalizeVisibility(params.visibility),
      status,
      entitlementCode: normalizeEntitlementCode(params.entitlementCode),
      stems,
      createdAt: now,
      updatedAt: now,
      publishedAt: status === "published" ? now : null,
    };
    db.tracks.push(created);
    return created;
  });
}

export async function appendCreatorTrackStem(params: {
  ownerId: string;
  trackId: string;
  stem: {
    label?: string;
    sortOrder?: number;
    accessTier?: UgcStemAccessTier;
    entitlementCode?: string;
    durationSec?: number;
    assetUploadId?: string;
    assetMimeType?: string;
    assetSizeBytes?: number;
    referenceStemId?: string;
    alignmentOffsetMs?: number;
    alignmentScore?: number;
    alignmentStatus?: UgcStemAlignStatus;
    alignmentMethod?: UgcStemAlignMethod;
    alignmentMeasuredAt?: string;
  };
}): Promise<{ track: UgcTrackRecord; stem: UgcTrackStemDraft }> {
  return withDbMutation(async (db) => {
    const track = db.tracks.find((item) => item.id === params.trackId);
    if (!track) throw new Error("TRACK_NOT_FOUND");
    if (track.ownerId !== params.ownerId) throw new Error("TRACK_FORBIDDEN");

    const nextOrder = track.stems.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
    const normalized = normalizeStemDraft(params.stem, nextOrder);
    if (!normalized) throw new Error("INVALID_STEM_PAYLOAD");
    const occupiedOrder = track.stems.some((item) => item.sortOrder === normalized.sortOrder);
    const sortOrder = occupiedOrder ? nextOrder : normalized.sortOrder;
    const now = new Date().toISOString();
    const createdStem: UgcTrackStemDraft = {
      id: randomUUID(),
      sortOrder,
      label: normalized.label,
      accessTier: normalized.accessTier,
      entitlementCode: normalized.entitlementCode,
      durationSec: normalized.durationSec,
      assetUploadId: normalized.assetUploadId,
      assetMimeType: normalized.assetMimeType,
      assetSizeBytes: normalized.assetSizeBytes,
      referenceStemId: normalized.referenceStemId,
      alignmentOffsetMs: normalized.alignmentOffsetMs,
      alignmentScore: normalized.alignmentScore,
      alignmentStatus: normalized.alignmentStatus,
      alignmentMethod: normalized.alignmentMethod,
      alignmentMeasuredAt: normalized.alignmentMeasuredAt,
      createdAt: now,
      updatedAt: now,
    };
    track.stems.push(createdStem);
    track.stems.sort((a, b) => a.sortOrder - b.sortOrder);
    track.updatedAt = now;
    if (track.status === "published" && !track.publishedAt) {
      track.publishedAt = now;
    }
    return { track, stem: createdStem };
  });
}

export async function recomputeCreatorTrackStemAlignment(params: {
  ownerId: string;
  trackId: string;
  stemId: string;
  referenceStemId?: string;
}): Promise<{ track: UgcTrackRecord; stem: UgcTrackStemDraft; usedReferenceStemId: string }> {
  return withDbMutation(async (db) => {
    const track = db.tracks.find((item) => item.id === params.trackId);
    if (!track) throw new Error("TRACK_NOT_FOUND");
    if (track.ownerId !== params.ownerId) throw new Error("TRACK_FORBIDDEN");

    const stem = track.stems.find((item) => item.id === params.stemId);
    if (!stem) throw new Error("STEM_NOT_FOUND");

    const preferredReferenceId = normalizeText(params.referenceStemId, 120) || stem.referenceStemId;
    const referenceStem =
      (preferredReferenceId ? track.stems.find((item) => item.id === preferredReferenceId) : null) ||
      track.stems.find((item) => item.id !== stem.id) ||
      null;
    if (!referenceStem) throw new Error("REFERENCE_STEM_NOT_FOUND");
    if (!stem.assetUploadId) throw new Error("STEM_ASSET_MISSING");
    if (!referenceStem.assetUploadId) throw new Error("REFERENCE_ASSET_MISSING");

    const [stemAsset, referenceAsset] = await Promise.all([
      getUgcAssetById(stem.assetUploadId),
      getUgcAssetById(referenceStem.assetUploadId),
    ]);
    if (!stemAsset || !referenceAsset) throw new Error("ASSET_NOT_FOUND");

    const [stemBytes, referenceBytes] = await Promise.all([
      readUgcAssetBytes(stemAsset),
      readUgcAssetBytes(referenceAsset),
    ]);
    if (!stemBytes || !referenceBytes) throw new Error("ASSET_BYTES_NOT_FOUND");

    const estimated = estimateWavStemAlignment(referenceBytes, stemBytes);
    const now = new Date().toISOString();

    stem.referenceStemId = referenceStem.id;
    stem.alignmentOffsetMs = estimated.offsetMs;
    stem.alignmentScore = estimated.score;
    stem.alignmentMethod = estimated.method;
    stem.alignmentMeasuredAt = now;
    stem.alignmentStatus = estimated.score >= 0.65 ? "aligned" : "needs_review";
    stem.updatedAt = now;
    track.updatedAt = now;
    if (track.status === "published" && !track.publishedAt) track.publishedAt = now;

    return {
      track,
      stem: { ...stem },
      usedReferenceStemId: referenceStem.id,
    };
  });
}
