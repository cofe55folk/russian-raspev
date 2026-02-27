import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type PhotoArchiveErrorCode =
  | "INVALID_JSON"
  | "INVALID_MULTIPART"
  | "FILE_REQUIRED"
  | "FILE_INVALID_TYPE"
  | "FILE_TOO_LARGE"
  | "ASSET_NOT_FOUND"
  | "CONTEXT_INCOMPLETE"
  | "RIGHTS_INCOMPLETE"
  | "RIGHTS_DISPUTED";

export type PhotoContextInput = {
  title: string;
  description?: string;
  shootingType: "field_historical" | "museum_object" | "reconstruction" | "festival" | "theatre" | "unknown";
  depictedPlaceLabel: string;
  depictedGeoPrecision: "point" | "approx" | "region";
  depictedGeoJson?: unknown;
  photoDateFrom?: string;
  photoDateTo?: string;
  costumeDateFrom?: string;
  costumeDateTo?: string;
  attributionBasis?: string;
};

export type PhotoRightsInput = {
  rightsStatus: "unknown" | "in_copyright" | "public_domain" | "open_license" | "restricted" | "disputed";
  holderName: string;
  holderContact?: string;
  rightsStatement?: string;
  licenseCode?: string;
  sourceEvidence: string;
  verificationState: "unverified" | "source_based" | "expert_verified" | "disputed";
  isDisputed: boolean;
  disputeNote?: string;
};

export type PhotoArchiveAssetRecord = {
  id: string;
  ownerId: string;
  objectKey: string;
  sourceFileName?: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  state: "uploaded" | "processing" | "ready" | "failed";
  visibility: "private" | "unlisted" | "public";
  publishStatus: "draft" | "scheduled" | "published" | "archived";
  publishedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  context: PhotoContextInput;
  rights: PhotoRightsInput;
};

type PhotoArchiveDb = {
  version: 1;
  updatedAt: string;
  assets: PhotoArchiveAssetRecord[];
};

const PHOTO_ARCHIVE_DB_PATH = path.join(process.cwd(), "data", "photo", "archive-db.json");
const PHOTO_ARCHIVE_ASSETS_DIR = path.join(process.cwd(), "data", "photo", "assets");
const MAX_IMAGE_UPLOAD_BYTES = 32 * 1024 * 1024;

const SHOOTING_TYPES = new Set([
  "field_historical",
  "museum_object",
  "reconstruction",
  "festival",
  "theatre",
  "unknown",
]);
const GEO_PRECISION = new Set(["point", "approx", "region"]);
const RIGHTS_STATUS = new Set(["unknown", "in_copyright", "public_domain", "open_license", "restricted", "disputed"]);
const RIGHTS_VERIFICATION = new Set(["unverified", "source_based", "expert_verified", "disputed"]);

let writeQueue: Promise<void> = Promise.resolve();
let mutationQueue: Promise<void> = Promise.resolve();

type ValidateResult<T> = { ok: true; value: T } | { ok: false; code: PhotoArchiveErrorCode; message: string };

function toSafeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function toOptionalText(value: unknown, maxLength: number): string | undefined {
  if (value == null) return undefined;
  const normalized = toSafeText(value, 0, maxLength);
  if (!normalized) return undefined;
  return normalized;
}

function parseDateOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function parseJsonField(raw: FormDataEntryValue | null): unknown {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return "__invalid_json__";
  }
}

async function ensureDirForPath(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function emptyDb(): PhotoArchiveDb {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    assets: [],
  };
}

async function readDb(): Promise<PhotoArchiveDb> {
  try {
    const raw = await fs.readFile(PHOTO_ARCHIVE_DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<PhotoArchiveDb>;
    const assets = Array.isArray(parsed.assets) ? (parsed.assets as PhotoArchiveAssetRecord[]) : [];
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      assets,
    };
  } catch {
    return emptyDb();
  }
}

async function writeDb(db: PhotoArchiveDb): Promise<void> {
  const payload = `${JSON.stringify(db, null, 2)}\n`;
  writeQueue = writeQueue.then(async () => {
    await ensureDirForPath(PHOTO_ARCHIVE_DB_PATH);
    const tmpPath = `${PHOTO_ARCHIVE_DB_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, PHOTO_ARCHIVE_DB_PATH);
  });
  await writeQueue;
}

async function withDbMutation<T>(mutator: (db: PhotoArchiveDb) => Promise<T> | T): Promise<T> {
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

function safeExtensionFromFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (!ext) return "";
  if (!/^\.[a-z0-9]{1,10}$/.test(ext)) return "";
  return ext;
}

function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validatePhotoContext(value: unknown): ValidateResult<PhotoContextInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, code: "CONTEXT_INCOMPLETE", message: "context must be an object" };
  }
  const raw = value as Record<string, unknown>;
  const title = toSafeText(raw.title, 1, 240);
  const depictedPlaceLabel = toSafeText(raw.depictedPlaceLabel, 1, 240);
  const shootingType = typeof raw.shootingType === "string" ? raw.shootingType.trim().toLowerCase() : "";
  const depictedGeoPrecision = typeof raw.depictedGeoPrecision === "string" ? raw.depictedGeoPrecision.trim().toLowerCase() : "";
  const photoDateFrom = parseDateOrNull(raw.photoDateFrom);
  const photoDateTo = parseDateOrNull(raw.photoDateTo);
  const costumeDateFrom = parseDateOrNull(raw.costumeDateFrom);
  const costumeDateTo = parseDateOrNull(raw.costumeDateTo);

  if (!title) return { ok: false, code: "CONTEXT_INCOMPLETE", message: "context.title is required" };
  if (!depictedPlaceLabel) {
    return { ok: false, code: "CONTEXT_INCOMPLETE", message: "context.depictedPlaceLabel is required" };
  }
  if (!SHOOTING_TYPES.has(shootingType)) {
    return { ok: false, code: "CONTEXT_INCOMPLETE", message: "context.shootingType is invalid" };
  }
  if (!GEO_PRECISION.has(depictedGeoPrecision)) {
    return { ok: false, code: "CONTEXT_INCOMPLETE", message: "context.depictedGeoPrecision is invalid" };
  }
  if (!photoDateFrom && !photoDateTo) {
    return {
      ok: false,
      code: "CONTEXT_INCOMPLETE",
      message: "context.photoDateFrom or context.photoDateTo is required",
    };
  }
  if ((raw.photoDateFrom != null && !photoDateFrom) || (raw.photoDateTo != null && !photoDateTo)) {
    return { ok: false, code: "CONTEXT_INCOMPLETE", message: "photo dates must be valid ISO date values" };
  }
  if ((raw.costumeDateFrom != null && !costumeDateFrom) || (raw.costumeDateTo != null && !costumeDateTo)) {
    return { ok: false, code: "CONTEXT_INCOMPLETE", message: "costume dates must be valid ISO date values" };
  }

  return {
    ok: true,
    value: {
      title,
      description: toOptionalText(raw.description, 2000),
      shootingType: shootingType as PhotoContextInput["shootingType"],
      depictedPlaceLabel,
      depictedGeoPrecision: depictedGeoPrecision as PhotoContextInput["depictedGeoPrecision"],
      depictedGeoJson: raw.depictedGeoJson ?? undefined,
      photoDateFrom: photoDateFrom ?? undefined,
      photoDateTo: photoDateTo ?? undefined,
      costumeDateFrom: costumeDateFrom ?? undefined,
      costumeDateTo: costumeDateTo ?? undefined,
      attributionBasis: toOptionalText(raw.attributionBasis, 1200),
    },
  };
}

export function validatePhotoRights(value: unknown): ValidateResult<PhotoRightsInput> {
  if (!value || typeof value !== "object") {
    return { ok: false, code: "RIGHTS_INCOMPLETE", message: "rights must be an object" };
  }
  const raw = value as Record<string, unknown>;
  const rightsStatus = typeof raw.rightsStatus === "string" ? raw.rightsStatus.trim().toLowerCase() : "";
  const holderName = toSafeText(raw.holderName, 1, 240);
  const sourceEvidence = toSafeText(raw.sourceEvidence, 1, 3000);
  const verificationState = typeof raw.verificationState === "string" ? raw.verificationState.trim().toLowerCase() : "";
  const isDisputed = toBool(raw.isDisputed) || rightsStatus === "disputed" || verificationState === "disputed";

  if (!RIGHTS_STATUS.has(rightsStatus)) {
    return { ok: false, code: "RIGHTS_INCOMPLETE", message: "rights.rightsStatus is invalid" };
  }
  if (!holderName) return { ok: false, code: "RIGHTS_INCOMPLETE", message: "rights.holderName is required" };
  if (!sourceEvidence) {
    return { ok: false, code: "RIGHTS_INCOMPLETE", message: "rights.sourceEvidence is required" };
  }
  if (!RIGHTS_VERIFICATION.has(verificationState)) {
    return { ok: false, code: "RIGHTS_INCOMPLETE", message: "rights.verificationState is invalid" };
  }

  return {
    ok: true,
    value: {
      rightsStatus: rightsStatus as PhotoRightsInput["rightsStatus"],
      holderName,
      holderContact: toOptionalText(raw.holderContact, 240),
      rightsStatement: toOptionalText(raw.rightsStatement, 1000),
      licenseCode: toOptionalText(raw.licenseCode, 120),
      sourceEvidence,
      verificationState: verificationState as PhotoRightsInput["verificationState"],
      isDisputed,
      disputeNote: toOptionalText(raw.disputeNote, 1200),
    },
  };
}

export function ensurePublishable(asset: PhotoArchiveAssetRecord): ValidateResult<true> {
  const contextResult = validatePhotoContext(asset.context);
  if (!contextResult.ok) return contextResult;
  const rightsResult = validatePhotoRights(asset.rights);
  if (!rightsResult.ok) return rightsResult;
  if (asset.rights.isDisputed || asset.rights.rightsStatus === "disputed" || asset.rights.verificationState === "disputed") {
    return { ok: false, code: "RIGHTS_DISPUTED", message: "Rights are disputed and cannot be published." };
  }
  return { ok: true, value: true };
}

export async function createPhotoArchiveAssetUpload(params: {
  ownerId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  context: PhotoContextInput;
  rights: PhotoRightsInput;
}): Promise<PhotoArchiveAssetRecord> {
  const ownerId = toSafeText(params.ownerId, 1, 120);
  if (!ownerId) throw new Error("INVALID_OWNER_ID");
  if (!params.mimeType.toLowerCase().startsWith("image/")) throw new Error("FILE_INVALID_TYPE");
  if (params.bytes.byteLength <= 0 || params.bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  const fileExt = safeExtensionFromFileName(params.fileName) || ".bin";
  const assetId = randomUUID();
  const objectFile = `${assetId}${fileExt}`;
  const objectRel = path.join("data", "photo", "assets", objectFile);
  const objectAbs = path.resolve(process.cwd(), objectRel);
  const now = new Date().toISOString();
  const checksumSha256 = sha256Hex(params.bytes);

  await fs.mkdir(PHOTO_ARCHIVE_ASSETS_DIR, { recursive: true });
  const tmpPath = `${objectAbs}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, Buffer.from(params.bytes));
  await fs.rename(tmpPath, objectAbs);

  const record: PhotoArchiveAssetRecord = {
    id: assetId,
    ownerId,
    objectKey: objectRel,
    sourceFileName: toOptionalText(params.fileName, 300),
    mimeType: params.mimeType,
    byteSize: params.bytes.byteLength,
    checksumSha256,
    state: "ready",
    visibility: "private",
    publishStatus: "draft",
    createdAt: now,
    updatedAt: now,
    context: params.context,
    rights: params.rights,
  };

  await withDbMutation(async (db) => {
    db.assets.push(record);
    db.updatedAt = now;
  });

  return record;
}

export async function getPhotoArchiveAssetById(assetId: string): Promise<PhotoArchiveAssetRecord | null> {
  const normalized = toSafeText(assetId, 1, 120);
  if (!normalized) return null;
  const db = await readDb();
  return db.assets.find((item) => item.id === normalized) ?? null;
}

export async function publishPhotoArchiveAsset(assetId: string): Promise<
  | { ok: true; asset: PhotoArchiveAssetRecord }
  | { ok: false; code: PhotoArchiveErrorCode; message: string }
> {
  const normalized = toSafeText(assetId, 1, 120);
  if (!normalized) return { ok: false, code: "ASSET_NOT_FOUND", message: "Asset not found." };

  return withDbMutation(async (db) => {
    const index = db.assets.findIndex((item) => item.id === normalized);
    if (index < 0) return { ok: false as const, code: "ASSET_NOT_FOUND" as const, message: "Asset not found." };
    const current = db.assets[index];
    const publishable = ensurePublishable(current);
    if (!publishable.ok) {
      return { ok: false as const, code: publishable.code, message: publishable.message };
    }
    const now = new Date().toISOString();
    const published: PhotoArchiveAssetRecord = {
      ...current,
      publishStatus: "published",
      publishedAt: now,
      visibility: current.visibility === "private" ? "public" : current.visibility,
      updatedAt: now,
    };
    db.assets[index] = published;
    db.updatedAt = now;
    return { ok: true as const, asset: published };
  });
}

export async function parsePhotoArchiveUploadForm(formData: FormData): Promise<
  | {
      ok: true;
      file: File;
      bytes: Uint8Array;
      context: PhotoContextInput;
      rights: PhotoRightsInput;
    }
  | { ok: false; code: PhotoArchiveErrorCode; message: string }
> {
  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return { ok: false, code: "FILE_REQUIRED", message: "file is required" };
  }
  if (!fileEntry.type.toLowerCase().startsWith("image/")) {
    return { ok: false, code: "FILE_INVALID_TYPE", message: "Only image/* files are allowed" };
  }
  if (!Number.isFinite(fileEntry.size) || fileEntry.size <= 0 || fileEntry.size > MAX_IMAGE_UPLOAD_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "Image size exceeds upload limit" };
  }

  const contextRaw = parseJsonField(formData.get("context"));
  if (contextRaw === "__invalid_json__") {
    return { ok: false, code: "INVALID_JSON", message: "context must be valid JSON" };
  }
  const rightsRaw = parseJsonField(formData.get("rights"));
  if (rightsRaw === "__invalid_json__") {
    return { ok: false, code: "INVALID_JSON", message: "rights must be valid JSON" };
  }

  const context = validatePhotoContext(contextRaw);
  if (!context.ok) return context;

  const rights = validatePhotoRights(rightsRaw);
  if (!rights.ok) return rights;

  const bytes = new Uint8Array(await fileEntry.arrayBuffer());
  return {
    ok: true,
    file: fileEntry,
    bytes,
    context: context.value,
    rights: rights.value,
  };
}

export function getPhotoArchiveUploadLimitBytes(): number {
  return MAX_IMAGE_UPLOAD_BYTES;
}
