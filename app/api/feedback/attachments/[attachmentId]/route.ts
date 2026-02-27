import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../lib/auth/session";
import {
  getFeedbackThreadById,
  getFeedbackUploadById,
  readFeedbackUploadBytes,
} from "../../../../lib/feedback/store-file";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

function safeSecretCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function hasValidAdminSecret(request: NextRequest): boolean {
  const configuredSecret = process.env.RR_ADMIN_API_SECRET?.trim() || "";
  if (!configuredSecret) return false;

  const headerSecret = request.headers.get("x-rr-admin-secret")?.trim() || "";
  if (headerSecret && safeSecretCompare(headerSecret, configuredSecret)) return true;

  const querySecret = request.nextUrl.searchParams.get("adminSecret")?.trim() || "";
  if (querySecret && safeSecretCompare(querySecret, configuredSecret)) return true;

  return false;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { attachmentId } = await context.params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`feedback-attachments:get:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const upload = await getFeedbackUploadById(attachmentId);
  if (!upload) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  const adminAccess = hasValidAdminSecret(request);
  if (!adminAccess) {
    const session = await readAuthSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!upload.threadId) {
      if (upload.userId !== session.userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      const thread = await getFeedbackThreadById(upload.threadId);
      if (!thread || thread.userId !== session.userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const bytes = await readFeedbackUploadBytes(upload);
  if (!bytes) return NextResponse.json({ error: "Attachment file is missing" }, { status: 404 });

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": upload.mimeType || "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=0, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
