import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import {
  addFeedbackMessage,
  getFeedbackThreadById,
  listFeedbackMessagesByThread,
} from "../../../lib/feedback/store-file";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type AddMessagePayload = {
  threadId?: string;
  message?: string;
  attachmentIds?: string[];
};

function normalizeBody(input: string | undefined): string {
  const value = (input || "").replace(/\r\n/g, "\n").trim();
  return value.slice(0, 2000);
}

function normalizeAttachmentIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    )
  ).slice(0, 5);
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`feedback-messages:get:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const threadId = request.nextUrl.searchParams.get("threadId")?.trim() || "";
  if (!threadId) return NextResponse.json({ error: "threadId is required" }, { status: 400 });

  const thread = await getFeedbackThreadById(threadId);
  if (!thread || thread.userId !== session.userId) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const messages = await listFeedbackMessagesByThread(threadId);
  return NextResponse.json({ thread, messages });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`feedback-messages:post:${ip}`, 80, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: AddMessagePayload = {};
  try {
    payload = (await request.json()) as AddMessagePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const threadId = payload.threadId?.trim() || "";
  if (!threadId) return NextResponse.json({ error: "threadId is required" }, { status: 400 });

  const message = normalizeBody(payload.message);
  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });

  const thread = await getFeedbackThreadById(threadId);
  if (!thread || thread.userId !== session.userId) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (thread.status === "closed") {
    return NextResponse.json({ error: "Thread is closed" }, { status: 409 });
  }

  try {
    const created = await addFeedbackMessage({
      threadId,
      senderRole: "user",
      senderUserId: session.userId,
      senderName: session.name || session.email || session.userId,
      body: message,
      attachmentIds: normalizeAttachmentIds(payload.attachmentIds),
    });
    if (!created) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...created });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (
      code === "FEEDBACK_ATTACHMENT_NOT_FOUND" ||
      code === "FEEDBACK_ATTACHMENT_OWNER_MISMATCH" ||
      code === "FEEDBACK_ATTACHMENT_ALREADY_USED" ||
      code === "FEEDBACK_ATTACHMENT_NOT_ALLOWED"
    ) {
      return NextResponse.json({ error: "Invalid attachmentIds" }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to send message" }, { status: 500 });
  }
}
