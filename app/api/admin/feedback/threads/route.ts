import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  listFeedbackThreadsForAdmin,
  setFeedbackThreadStatus,
  type FeedbackThreadStatus,
} from "../../../../lib/feedback/store-file";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type UpdateThreadPayload = {
  threadId?: string;
  status?: FeedbackThreadStatus;
};

function safeSecretCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function validateAdminSecret(request: NextRequest): NextResponse | null {
  const configuredSecret = process.env.RR_ADMIN_API_SECRET?.trim() || "";
  if (!configuredSecret) {
    return NextResponse.json({ error: "Admin API secret is not configured" }, { status: 503 });
  }
  const providedSecret = request.headers.get("x-rr-admin-secret")?.trim() || "";
  if (!providedSecret || !safeSecretCompare(providedSecret, configuredSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`admin-feedback-threads:get:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const adminError = validateAdminSecret(request);
  if (adminError) return adminError;

  const threads = await listFeedbackThreadsForAdmin();
  return NextResponse.json({ threads });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`admin-feedback-threads:post:${ip}`, 80, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const adminError = validateAdminSecret(request);
  if (adminError) return adminError;

  let payload: UpdateThreadPayload = {};
  try {
    payload = (await request.json()) as UpdateThreadPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const threadId = payload.threadId?.trim() || "";
  const status = payload.status;
  if (!threadId || (status !== "open" && status !== "closed")) {
    return NextResponse.json({ error: "Invalid threadId or status" }, { status: 400 });
  }

  const updated = await setFeedbackThreadStatus({ threadId, status });
  if (!updated) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  return NextResponse.json({ ok: true, thread: updated });
}
