import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import {
  createFeedbackThread,
  type FeedbackContextType,
  type FeedbackThreadChannel,
  listFeedbackThreadsByUser,
} from "../../../lib/feedback/store-file";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type CreateThreadPayload = {
  subject?: string;
  message?: string;
  channel?: FeedbackThreadChannel;
  contextType?: FeedbackContextType;
  contextId?: string;
  contextTitle?: string;
  contextSlug?: string;
  attachmentIds?: string[];
};

function normalizeSubject(input: string | undefined): string {
  const value = (input || "").trim();
  if (!value) return "Обратная связь";
  return value.slice(0, 120);
}

function normalizeBody(input: string | undefined): string {
  const value = (input || "").replace(/\r\n/g, "\n").trim();
  return value.slice(0, 2000);
}

function normalizeOptional(input: string | undefined, maxLength: number): string | undefined {
  const value = (input || "").trim();
  if (!value) return undefined;
  return value.slice(0, maxLength);
}

function normalizeChannel(input: unknown): FeedbackThreadChannel {
  return input === "curator" ? "curator" : "general";
}

function normalizeContextType(input: unknown): FeedbackContextType {
  if (input === "course_video") return "course_video";
  if (input === "course_audio") return "course_audio";
  if (input === "course_text") return "course_text";
  if (input === "material_offer") return "material_offer";
  return "general";
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
  if (!allowRateLimit(`feedback-threads:get:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const threads = await listFeedbackThreadsByUser(session.userId);
  return NextResponse.json({ threads });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`feedback-threads:post:${ip}`, 40, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: CreateThreadPayload = {};
  try {
    payload = (await request.json()) as CreateThreadPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const subject = normalizeSubject(payload.subject);
  const message = normalizeBody(payload.message);
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    const created = await createFeedbackThread({
      userId: session.userId,
      userEmail: session.email || "",
      userName: session.name || session.email || session.userId,
      subject,
      firstMessageBody: message,
      channel: normalizeChannel(payload.channel),
      contextType: normalizeContextType(payload.contextType),
      contextId: normalizeOptional(payload.contextId, 180),
      contextTitle: normalizeOptional(payload.contextTitle, 220),
      contextSlug: normalizeOptional(payload.contextSlug, 120),
      attachmentIds: normalizeAttachmentIds(payload.attachmentIds),
    });

    return NextResponse.json({ ok: true, ...created }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (
      code === "FEEDBACK_ATTACHMENT_NOT_FOUND" ||
      code === "FEEDBACK_ATTACHMENT_OWNER_MISMATCH" ||
      code === "FEEDBACK_ATTACHMENT_ALREADY_USED"
    ) {
      return NextResponse.json({ error: "Invalid attachmentIds" }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create thread" }, { status: 500 });
  }
}
