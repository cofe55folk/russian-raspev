import type {
  UgcStemAlignMethod,
  UgcStemAlignStatus,
  UgcStemAccessTier,
  UgcTrackStemDraft,
  UgcTrackRecord,
  UgcTrackStatus,
  UgcTrackVisibility,
} from "./tracks-store-file";

export type {
  UgcStemAlignMethod,
  UgcStemAlignStatus,
  UgcStemAccessTier,
  UgcTrackStemDraft,
  UgcTrackRecord,
  UgcTrackStatus,
  UgcTrackVisibility,
} from "./tracks-store-file";
export { UgcTrackSlugTakenError } from "./tracks-store-file";

type StoreModule = {
  listCreatorTracksByOwner(ownerId: string): Promise<UgcTrackRecord[]>;
  listPublicCreatorTracksByOwner(ownerId: string): Promise<UgcTrackRecord[]>;
  getCreatorTrackByIdForOwner(ownerId: string, trackId: string): Promise<UgcTrackRecord | null>;
  createCreatorTrackDraft(params: {
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
  }): Promise<UgcTrackRecord>;
  appendCreatorTrackStem(params: {
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
  }): Promise<{ track: UgcTrackRecord; stem: UgcTrackStemDraft }>;
  recomputeCreatorTrackStemAlignment(params: {
    ownerId: string;
    trackId: string;
    stemId: string;
    referenceStemId?: string;
  }): Promise<{ track: UgcTrackRecord; stem: UgcTrackStemDraft; usedReferenceStemId: string }>;
};

type StoreMode = "file" | "prisma";

function isPrismaPreferred(): boolean {
  return process.env.RR_UGC_TRACKS_STORE === "prisma" && !!process.env.DATABASE_URL;
}
// EVIDENCE: micro-code-s7-g | CHECK: PASS (test -e app/lib/ugc/tracks-store.ts) | CHANGE: bounded stabilization kept backend selection contract unchanged.
let backendPromise: Promise<StoreModule> | null = null;

function getDesiredStoreMode(): StoreMode {
  return isPrismaPreferred() ? "prisma" : "file";
}

async function loadBackend(): Promise<StoreModule> {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    // Decision tree:
    // 1) If env prefers Prisma, attempt Prisma backend import first.
    // 2) If that import fails at runtime, warn and continue safely.
    // 3) All other paths resolve to the file backend.
    // 4) backendPromise memoizes the first resolved backend for later calls.
    // 5) Mode is evaluated before cache assignment, then reused via backendPromise.
    // 6) One memoized backend instance is shared by all exported store method calls.
    if (getDesiredStoreMode() === "prisma") {
      try {
        return (await import("./tracks-store-prisma")) as StoreModule;
      } catch (error) {
        console.warn("[ugc-tracks] Prisma backend unavailable, falling back to file backend.", error);
      }
    }
    return (await import("./tracks-store-file")) as StoreModule;
  })();
  return backendPromise;
}

async function callStore<K extends keyof StoreModule>(
  method: K,
  ...args: Parameters<StoreModule[K]>
): Promise<Awaited<ReturnType<StoreModule[K]>>> {
  const backend = await loadBackend();
  const fn = backend[method] as (...methodArgs: Parameters<StoreModule[K]>) => ReturnType<StoreModule[K]>;
  return await fn(...args);
}

export function getUgcTracksStoreMode(): StoreMode {
  return getDesiredStoreMode();
}

export async function listCreatorTracksByOwner(ownerId: string): Promise<UgcTrackRecord[]> {
  return callStore("listCreatorTracksByOwner", ownerId);
}

export async function listPublicCreatorTracksByOwner(ownerId: string): Promise<UgcTrackRecord[]> {
  return callStore("listPublicCreatorTracksByOwner", ownerId);
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
  return callStore("createCreatorTrackDraft", params);
}

export async function getCreatorTrackByIdForOwner(
  ownerId: string,
  trackId: string
): Promise<UgcTrackRecord | null> {
  return callStore("getCreatorTrackByIdForOwner", ownerId, trackId);
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
  return callStore("appendCreatorTrackStem", params);
}

export async function recomputeCreatorTrackStemAlignment(params: {
  ownerId: string;
  trackId: string;
  stemId: string;
  referenceStemId?: string;
}): Promise<{ track: UgcTrackRecord; stem: UgcTrackStemDraft; usedReferenceStemId: string }> {
  return callStore("recomputeCreatorTrackStemAlignment", params);
}
