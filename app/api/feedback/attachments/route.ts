import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { createFeedbackUpload } from "../../../lib/feedback/store-file";
import { allowRateLimit } from "../../../lib/security/rateLimit";

const MAX_AUDIO_UPLOAD_BYTES = 12 * 1024 * 1024;

function fileNameOrDefault(file: File): string {
  const trimmed = file.name.trim();
  return trimmed || `voice-${Date.now()}.webm`;
}

function isAllowedAudioMime(mime: string): boolean {
  const value = (mime || "").toLowerCase();
  return value.startsWith("audio/") || value === "application/ogg";
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`feedback-attachments:post:${ip}`, 45, 60_000)) {
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
  const upload = await createFeedbackUpload({
    userId: session.userId,
    originalName: fileNameOrDefault(fileEntry),
    mimeType: fileEntry.type || "audio/webm",
    sizeBytes: bytes.byteLength,
    bytes,
  });

  return NextResponse.json({
    ok: true,
    upload: {
      uploadId: upload.id,
      id: upload.id,
      kind: "audio",
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      downloadUrl: `/api/feedback/attachments/${encodeURIComponent(upload.id)}`,
    },
  });
}
