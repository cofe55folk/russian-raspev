import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../lib/auth/session";
import { isPreviewFeatureEnabledForRequest } from "../../../../lib/feature-flags/preview";
import { allowRateLimit } from "../../../../lib/security/rateLimit";
import { createUgcAssetUpload } from "../../../../lib/ugc/assets-store-file";

const MAX_AUDIO_UPLOAD_BYTES = 64 * 1024 * 1024;

function fileNameOrDefault(file: File): string {
  const trimmed = file.name.trim();
  return trimmed || `stem-${Date.now()}.webm`;
}

function isAllowedAudioMime(mime: string): boolean {
  const value = (mime || "").toLowerCase();
  return value.startsWith("audio/") || value === "application/ogg" || value === "application/octet-stream";
}

export async function POST(request: NextRequest) {
  if (!isPreviewFeatureEnabledForRequest(request, "ugc_creator_tracks")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`ugc-assets:upload:${ip}`, 40, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart payload" }, { status: 400 });
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!isAllowedAudioMime(fileEntry.type)) {
    return NextResponse.json({ error: "Only audio files are allowed" }, { status: 400 });
  }
  if (!Number.isFinite(fileEntry.size) || fileEntry.size <= 0 || fileEntry.size > MAX_AUDIO_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File is too large" }, { status: 400 });
  }

  const bytes = new Uint8Array(await fileEntry.arrayBuffer());
  const asset = await createUgcAssetUpload({
    ownerId: session.userId,
    kind: "audio",
    originalName: fileNameOrDefault(fileEntry),
    mimeType: fileEntry.type || "audio/webm",
    sizeBytes: bytes.byteLength,
    bytes,
  });

  return NextResponse.json({
    ok: true,
    asset: {
      uploadId: asset.id,
      id: asset.id,
      kind: asset.kind,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      streamUrl: `/api/ugc/assets/${encodeURIComponent(asset.id)}/stream`,
      createdAt: asset.createdAt,
    },
  });
}
