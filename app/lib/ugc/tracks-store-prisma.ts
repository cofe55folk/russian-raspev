import { ContentStatus, ContentVisibility, MediaAccess, MediaKind } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "../db/prisma";
import { estimateWavStemAlignment } from "./alignment";
import { getUgcAssetById, readUgcAssetBytes } from "./assets-store-file";
import type {
  UgcStemAlignMethod,
  UgcStemAlignStatus,
  UgcStemAccessTier,
  UgcTrackStemDraft,
  UgcTrackRecord,
  UgcTrackStatus,
  UgcTrackVisibility,
} from "./tracks-store-file";
import { UgcTrackSlugTakenError } from "./tracks-store-file";

const PRISMA_STEM_ALIGNMENT_DB_PATH = path.join(process.cwd(), "data", "ugc", "prisma-stem-alignment-db.json");
let alignmentWriteQueue: Promise<void> = Promise.resolve();
let alignmentMutationQueue: Promise<void> = Promise.resolve();

type StemAlignmentRecord = {
  referenceStemId?: string;
  alignmentOffsetMs?: number;
  alignmentScore?: number;
  alignmentStatus: UgcStemAlignStatus;
  alignmentMethod?: UgcStemAlignMethod;
  alignmentMeasuredAt?: string;
  updatedAt: string;
};

type StemAlignmentDb = {
  stems: Record<string, StemAlignmentRecord>;
};

const EMPTY_ALIGNMENT_DB: StemAlignmentDb = { stems: {} };

function normalizeVisibility(value: unknown): UgcTrackVisibility {
  if (value === "public") return "public";
  if (value === "unlisted") return "unlisted";
  return "private";
}

function normalizeStatus(value: unknown): UgcTrackStatus {
  return value === "published" ? "published" : "draft";
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
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function toPrismaVisibility(value: UgcTrackVisibility): ContentVisibility {
  if (value === "public") return ContentVisibility.public;
  if (value === "unlisted") return ContentVisibility.unlisted;
  return ContentVisibility.private;
}

function toPrismaStatus(value: UgcTrackStatus): ContentStatus {
  return value === "published" ? ContentStatus.published : ContentStatus.draft;
}

function fromPrismaVisibility(value: ContentVisibility): UgcTrackVisibility {
  return normalizeVisibility(value);
}

function fromPrismaStatus(value: ContentStatus): UgcTrackStatus {
  return normalizeStatus(value);
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

function normalizeAlignmentRecord(input: unknown): StemAlignmentRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<StemAlignmentRecord>;
  const updatedAt = normalizeText(raw.updatedAt, 40);
  if (!updatedAt) return null;
  return {
    referenceStemId: normalizeText(raw.referenceStemId, 120),
    alignmentOffsetMs: normalizeAlignmentOffsetMs(raw.alignmentOffsetMs),
    alignmentScore: normalizeAlignmentScore(raw.alignmentScore),
    alignmentStatus: normalizeStemAlignStatus(raw.alignmentStatus),
    alignmentMethod: normalizeStemAlignMethod(raw.alignmentMethod),
    alignmentMeasuredAt: normalizeText(raw.alignmentMeasuredAt, 40),
    updatedAt,
  };
}

function normalizeAlignmentDb(input: unknown): StemAlignmentDb {
  if (!input || typeof input !== "object") return { ...EMPTY_ALIGNMENT_DB, stems: {} };
  const raw = input as Partial<StemAlignmentDb>;
  const stemsSource = raw.stems && typeof raw.stems === "object" ? raw.stems : {};
  const stems: Record<string, StemAlignmentRecord> = {};
  for (const [stemId, meta] of Object.entries(stemsSource)) {
    const key = normalizeText(stemId, 120);
    const normalizedMeta = normalizeAlignmentRecord(meta);
    if (!key || !normalizedMeta) continue;
    stems[key] = normalizedMeta;
  }
  return { stems };
}

async function ensureAlignmentDir() {
  await fs.mkdir(path.dirname(PRISMA_STEM_ALIGNMENT_DB_PATH), { recursive: true });
}

async function readAlignmentDb(): Promise<StemAlignmentDb> {
  try {
    const raw = await fs.readFile(PRISMA_STEM_ALIGNMENT_DB_PATH, "utf8");
    return normalizeAlignmentDb(JSON.parse(raw));
  } catch {
    return { ...EMPTY_ALIGNMENT_DB, stems: {} };
  }
}

async function writeAlignmentDb(db: StemAlignmentDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  alignmentWriteQueue = alignmentWriteQueue.then(async () => {
    await ensureAlignmentDir();
    const tempPath = `${PRISMA_STEM_ALIGNMENT_DB_PATH}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, PRISMA_STEM_ALIGNMENT_DB_PATH);
  });
  await alignmentWriteQueue;
}

async function withAlignmentMutation<T>(mutator: (db: StemAlignmentDb) => Promise<T> | T): Promise<T> {
  const previous = alignmentMutationQueue;
  let unlock: () => void = () => {};
  alignmentMutationQueue = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  try {
    const db = await readAlignmentDb();
    const result = await mutator(db);
    await writeAlignmentDb(db);
    return result;
  } finally {
    unlock();
  }
}

async function getAlignmentMap(): Promise<Record<string, StemAlignmentRecord>> {
  const db = await readAlignmentDb();
  return db.stems;
}

function hasExplicitAlignmentData(record: StemAlignmentRecord): boolean {
  return !!(
    record.referenceStemId ||
    typeof record.alignmentOffsetMs === "number" ||
    typeof record.alignmentScore === "number" ||
    record.alignmentMethod ||
    record.alignmentMeasuredAt ||
    record.alignmentStatus !== "pending"
  );
}

async function upsertStemAlignment(stemId: string, record: StemAlignmentRecord): Promise<void> {
  await withAlignmentMutation(async (db) => {
    if (hasExplicitAlignmentData(record)) {
      db.stems[stemId] = record;
      return;
    }
    delete db.stems[stemId];
  });
}

function buildAlignmentRecord(input: {
  referenceStemId?: string;
  alignmentOffsetMs?: number;
  alignmentScore?: number;
  alignmentStatus?: UgcStemAlignStatus;
  alignmentMethod?: UgcStemAlignMethod;
  alignmentMeasuredAt?: string;
  updatedAt: string;
}): StemAlignmentRecord {
  return {
    referenceStemId: normalizeText(input.referenceStemId, 120),
    alignmentOffsetMs: normalizeAlignmentOffsetMs(input.alignmentOffsetMs),
    alignmentScore: normalizeAlignmentScore(input.alignmentScore),
    alignmentStatus: normalizeStemAlignStatus(input.alignmentStatus),
    alignmentMethod: normalizeStemAlignMethod(input.alignmentMethod),
    alignmentMeasuredAt: normalizeText(input.alignmentMeasuredAt, 40),
    updatedAt: normalizeText(input.updatedAt, 40) || new Date().toISOString(),
  };
}

type PrismaStemRow = {
  id: string;
  sortOrder: number;
  label: string;
  accessTier: string;
  entitlementCode: string | null;
  durationSec: number | null;
  assetId: string;
  asset: {
    mimeType: string;
    byteSize: number;
  };
  createdAt: Date;
  updatedAt: Date;
};

function toStemDraft(stem: PrismaStemRow, alignmentByStemId: Record<string, StemAlignmentRecord>): UgcTrackStemDraft {
  const alignment = alignmentByStemId[stem.id];
  return {
    id: stem.id,
    sortOrder: stem.sortOrder,
    label: stem.label,
    accessTier: normalizeStemAccessTier(stem.accessTier),
    entitlementCode: stem.entitlementCode ?? undefined,
    durationSec: typeof stem.durationSec === "number" ? stem.durationSec : undefined,
    assetUploadId: stem.assetId,
    assetMimeType: stem.asset?.mimeType || undefined,
    assetSizeBytes: typeof stem.asset?.byteSize === "number" ? stem.asset.byteSize : undefined,
    referenceStemId: alignment?.referenceStemId,
    alignmentOffsetMs: alignment?.alignmentOffsetMs,
    alignmentScore: alignment?.alignmentScore,
    alignmentStatus: normalizeStemAlignStatus(alignment?.alignmentStatus),
    alignmentMethod: normalizeStemAlignMethod(alignment?.alignmentMethod),
    alignmentMeasuredAt: alignment?.alignmentMeasuredAt,
    createdAt: stem.createdAt.toISOString(),
    updatedAt: stem.updatedAt.toISOString(),
  };
}

function toTrackRecord(
  input: {
    id: string;
    ownerId: string;
    slug: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    language: string | null;
    visibility: ContentVisibility;
    status: ContentStatus;
    entitlementCode: string | null;
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
    stems?: PrismaStemRow[];
  },
  alignmentByStemId: Record<string, StemAlignmentRecord>
): UgcTrackRecord {
  const stems: UgcTrackStemDraft[] = Array.isArray(input.stems)
    ? input.stems.map((stem) => toStemDraft(stem, alignmentByStemId)).sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  return {
    id: input.id,
    ownerId: input.ownerId,
    slug: input.slug,
    title: input.title,
    subtitle: input.subtitle ?? undefined,
    description: input.description ?? undefined,
    language: input.language ?? undefined,
    visibility: fromPrismaVisibility(input.visibility),
    status: fromPrismaStatus(input.status),
    entitlementCode: input.entitlementCode ?? undefined,
    stems,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
    publishedAt: input.publishedAt ? input.publishedAt.toISOString() : null,
  };
}

async function ensurePrismaAssetForStem(params: {
  ownerId: string;
  assetId: string;
  assetMimeType?: string;
  assetSizeBytes?: number;
}) {
  const existing = await prisma.creatorMediaAsset.findUnique({
    where: { id: params.assetId },
    select: { id: true, ownerId: true },
  });
  if (existing) {
    if (existing.ownerId !== params.ownerId) throw new Error("ASSET_FORBIDDEN");
    return;
  }
  await prisma.creatorMediaAsset.create({
    data: {
      id: params.assetId,
      ownerId: params.ownerId,
      objectKey: `ugc-file:${params.assetId}`,
      kind: MediaKind.audio,
      access: MediaAccess.private,
      mimeType: normalizeText(params.assetMimeType, 120) || "application/octet-stream",
      byteSize: normalizeSizeBytes(params.assetSizeBytes) ?? 0,
    },
  });
}

async function loadTrackSelectionByOwner(ownerId: string, trackId: string) {
  return prisma.creatorTrack.findFirst({
    where: { id: trackId, ownerId },
    select: {
      id: true,
      ownerId: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      language: true,
      visibility: true,
      status: true,
      entitlementCode: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      stems: {
        orderBy: [{ sortOrder: "asc" }],
        select: {
          id: true,
          sortOrder: true,
          label: true,
          accessTier: true,
          entitlementCode: true,
          durationSec: true,
          assetId: true,
          asset: {
            select: {
              mimeType: true,
              byteSize: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

export async function listCreatorTracksByOwner(ownerId: string): Promise<UgcTrackRecord[]> {
  const [tracks, alignmentByStemId] = await Promise.all([
    prisma.creatorTrack.findMany({
      where: { ownerId },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        ownerId: true,
        slug: true,
        title: true,
        subtitle: true,
        description: true,
        language: true,
        visibility: true,
        status: true,
        entitlementCode: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        stems: {
          orderBy: [{ sortOrder: "asc" }],
          select: {
            id: true,
            sortOrder: true,
            label: true,
            accessTier: true,
            entitlementCode: true,
            durationSec: true,
            assetId: true,
            asset: {
              select: {
                mimeType: true,
                byteSize: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    getAlignmentMap(),
  ]);
  return tracks.map((track) => toTrackRecord(track, alignmentByStemId));
}

export async function listPublicCreatorTracksByOwner(ownerId: string): Promise<UgcTrackRecord[]> {
  const [tracks, alignmentByStemId] = await Promise.all([
    prisma.creatorTrack.findMany({
      where: {
        ownerId,
        visibility: ContentVisibility.public,
        status: ContentStatus.published,
      },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        ownerId: true,
        slug: true,
        title: true,
        subtitle: true,
        description: true,
        language: true,
        visibility: true,
        status: true,
        entitlementCode: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        stems: {
          orderBy: [{ sortOrder: "asc" }],
          select: {
            id: true,
            sortOrder: true,
            label: true,
            accessTier: true,
            entitlementCode: true,
            durationSec: true,
            assetId: true,
            asset: {
              select: {
                mimeType: true,
                byteSize: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    getAlignmentMap(),
  ]);
  return tracks.map((track) => toTrackRecord(track, alignmentByStemId));
}

export async function getCreatorTrackByIdForOwner(
  ownerId: string,
  trackId: string
): Promise<UgcTrackRecord | null> {
  const [track, alignmentByStemId] = await Promise.all([loadTrackSelectionByOwner(ownerId, trackId), getAlignmentMap()]);
  return track ? toTrackRecord(track, alignmentByStemId) : null;
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
  const slug = normalizeSlug(params.slug);
  const title = normalizeText(params.title, 140);
  if (!slug || !title) throw new Error("INVALID_TRACK_PAYLOAD");
  const status = normalizeStatus(params.status);
  try {
    const created = await prisma.creatorTrack.create({
      data: {
        ownerId: params.ownerId,
        slug,
        title,
        subtitle: normalizeText(params.subtitle, 180) ?? null,
        description: normalizeText(params.description, 1000) ?? null,
        language: normalizeText(params.language, 12) ?? null,
        visibility: toPrismaVisibility(normalizeVisibility(params.visibility)),
        status: toPrismaStatus(status),
        entitlementCode: normalizeText(params.entitlementCode, 160) ?? null,
        publishedAt: status === "published" ? new Date() : null,
      },
      select: {
        id: true,
        ownerId: true,
        slug: true,
        title: true,
        subtitle: true,
        description: true,
        language: true,
        visibility: true,
        status: true,
        entitlementCode: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        stems: {
          orderBy: [{ sortOrder: "asc" }],
          select: {
            id: true,
            sortOrder: true,
            label: true,
            accessTier: true,
            entitlementCode: true,
            durationSec: true,
            assetId: true,
            asset: {
              select: {
                mimeType: true,
                byteSize: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    return toTrackRecord(created, {});
  } catch (error) {
    if (error instanceof Error && /Unique constraint failed/i.test(error.message)) {
      throw new UgcTrackSlugTakenError();
    }
    throw error;
  }
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
  const label = normalizeText(params.stem.label, 120);
  const assetId = normalizeText(params.stem.assetUploadId, 120);
  if (!label || !assetId) throw new Error("INVALID_STEM_PAYLOAD");

  const track = await prisma.creatorTrack.findFirst({
    where: { id: params.trackId, ownerId: params.ownerId },
    select: { id: true, stems: { select: { sortOrder: true } } },
  });
  if (!track) throw new Error("TRACK_NOT_FOUND");
  const nextSortOrder = track.stems.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
  const requestedSortOrder =
    typeof params.stem.sortOrder === "number" && Number.isFinite(params.stem.sortOrder)
      ? Math.max(0, Math.floor(params.stem.sortOrder))
      : nextSortOrder;
  const sortOrder = track.stems.some((item) => item.sortOrder === requestedSortOrder) ? nextSortOrder : requestedSortOrder;

  await ensurePrismaAssetForStem({
    ownerId: params.ownerId,
    assetId,
    assetMimeType: params.stem.assetMimeType,
    assetSizeBytes: params.stem.assetSizeBytes,
  });

  const created = await prisma.creatorTrackStem.create({
    data: {
      trackId: params.trackId,
      assetId,
      sortOrder,
      label,
      accessTier: normalizeStemAccessTier(params.stem.accessTier),
      entitlementCode: normalizeText(params.stem.entitlementCode, 160) ?? null,
      durationSec:
        typeof params.stem.durationSec === "number" && Number.isFinite(params.stem.durationSec)
          ? Math.max(0, Math.floor(params.stem.durationSec))
          : null,
    },
    select: {
      id: true,
      sortOrder: true,
      label: true,
      accessTier: true,
      entitlementCode: true,
      durationSec: true,
      assetId: true,
      asset: {
        select: {
          mimeType: true,
          byteSize: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
  });

  const nowIso = new Date().toISOString();
  const alignmentRecord = buildAlignmentRecord({
    referenceStemId: params.stem.referenceStemId,
    alignmentOffsetMs: params.stem.alignmentOffsetMs,
    alignmentScore: params.stem.alignmentScore,
    alignmentStatus: params.stem.alignmentStatus,
    alignmentMethod: params.stem.alignmentMethod,
    alignmentMeasuredAt: params.stem.alignmentMeasuredAt,
    updatedAt: nowIso,
  });
  await upsertStemAlignment(created.id, alignmentRecord);

  const refreshedTrack = await getCreatorTrackByIdForOwner(params.ownerId, params.trackId);
  if (!refreshedTrack) throw new Error("TRACK_NOT_FOUND");
  const createdStem =
    refreshedTrack.stems.find((item) => item.id === created.id) ||
    toStemDraft(created, { [created.id]: alignmentRecord });
  return { track: refreshedTrack, stem: createdStem };
}

export async function recomputeCreatorTrackStemAlignment(params: {
  ownerId: string;
  trackId: string;
  stemId: string;
  referenceStemId?: string;
}): Promise<{ track: UgcTrackRecord; stem: UgcTrackStemDraft; usedReferenceStemId: string }> {
  const track = await loadTrackSelectionByOwner(params.ownerId, params.trackId);
  if (!track) throw new Error("TRACK_NOT_FOUND");

  const stem = track.stems.find((item) => item.id === params.stemId);
  if (!stem) throw new Error("STEM_NOT_FOUND");

  const preferredReferenceId = normalizeText(params.referenceStemId, 120);
  const currentAlignment = (await getAlignmentMap())[stem.id];
  const fallbackReferenceId = currentAlignment?.referenceStemId;
  const referenceStem =
    (preferredReferenceId ? track.stems.find((item) => item.id === preferredReferenceId) : null) ||
    (fallbackReferenceId ? track.stems.find((item) => item.id === fallbackReferenceId) : null) ||
    track.stems.find((item) => item.id !== stem.id) ||
    null;
  if (!referenceStem) throw new Error("REFERENCE_STEM_NOT_FOUND");
  if (!stem.assetId) throw new Error("STEM_ASSET_MISSING");
  if (!referenceStem.assetId) throw new Error("REFERENCE_ASSET_MISSING");

  const [stemAsset, referenceAsset] = await Promise.all([
    getUgcAssetById(stem.assetId),
    getUgcAssetById(referenceStem.assetId),
  ]);
  if (!stemAsset || !referenceAsset) throw new Error("ASSET_NOT_FOUND");

  const [stemBytes, referenceBytes] = await Promise.all([readUgcAssetBytes(stemAsset), readUgcAssetBytes(referenceAsset)]);
  if (!stemBytes || !referenceBytes) throw new Error("ASSET_BYTES_NOT_FOUND");

  const estimated = estimateWavStemAlignment(referenceBytes, stemBytes);
  const nowIso = new Date().toISOString();
  const alignmentRecord = buildAlignmentRecord({
    referenceStemId: referenceStem.id,
    alignmentOffsetMs: estimated.offsetMs,
    alignmentScore: estimated.score,
    alignmentStatus: estimated.score >= 0.65 ? "aligned" : "needs_review",
    alignmentMethod: estimated.method,
    alignmentMeasuredAt: nowIso,
    updatedAt: nowIso,
  });
  await upsertStemAlignment(stem.id, alignmentRecord);

  const refreshedTrack = await getCreatorTrackByIdForOwner(params.ownerId, params.trackId);
  if (!refreshedTrack) throw new Error("TRACK_NOT_FOUND");
  const resolvedStem = refreshedTrack.stems.find((item) => item.id === stem.id);
  if (!resolvedStem) throw new Error("STEM_NOT_FOUND");
  return {
    track: refreshedTrack,
    stem: resolvedStem,
    usedReferenceStemId: referenceStem.id,
  };
}
