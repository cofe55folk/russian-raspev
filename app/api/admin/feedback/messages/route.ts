import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  addFeedbackMessage,
  getFeedbackThreadById,
  listFeedbackMessagesByThread,
} from "../../../../lib/feedback/store-file";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type AdminMessagePayload = {
  threadId?: string;
  message?: string;
  senderName?: string;
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

function normalizeBody(input: string | undefined): string {
  const value = (input || "").replace(/\r\n/g, "\n").trim();
  return value.slice(0, 2000);
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`admin-feedback-messages:get:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const adminError = validateAdminSecret(request);
  if (adminError) return adminError;

  const threadId = request.nextUrl.searchParams.get("threadId")?.trim() || "";
  if (!threadId) return NextResponse.json({ error: "threadId is required" }, { status: 400 });

  const thread = await getFeedbackThreadById(threadId);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const messages = await listFeedbackMessagesByThread(threadId);
  return NextResponse.json({ thread, messages });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`admin-feedback-messages:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const adminError = validateAdminSecret(request);
  if (adminError) return adminError;

  let payload: AdminMessagePayload = {};
  try {
    payload = (await request.json()) as AdminMessagePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const threadId = payload.threadId?.trim() || "";
  if (!threadId) return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  const message = normalizeBody(payload.message);
  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });

  const thread = await getFeedbackThreadById(threadId);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const created = await addFeedbackMessage({
    threadId,
    senderRole: "admin",
    senderName: payload.senderName?.trim() || "Куратор",
    body: message,
  });
  if (!created) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  return NextResponse.json({ ok: true, ...created });
}
