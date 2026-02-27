import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../../lib/auth/session";
import {
  createCommunityMessage,
  SocialConversationAccessError,
  SocialConversationNotFoundError,
  SocialConversationValidationError,
} from "../../../../../../lib/community/social-store";
import { allowRateLimit } from "../../../../../../lib/security/rateLimit";

type CreateMessagePayload = {
  body?: unknown;
};

function normalizeBody(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 2000);
}

function mapErrorToResponse(error: unknown): NextResponse {
  if (error instanceof SocialConversationValidationError) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  if (error instanceof SocialConversationAccessError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof SocialConversationNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  return NextResponse.json({ error: "MESSAGE_CREATE_FAILED" }, { status: 500 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-messages-create:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: CreateMessagePayload = {};
  try {
    payload = (await request.json()) as CreateMessagePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { id } = await context.params;
  const body = normalizeBody(payload.body);
  if (!body) return NextResponse.json({ error: "body is required" }, { status: 422 });

  try {
    const created = await createCommunityMessage({
      conversationId: id,
      senderUserId: session.userId,
      body,
    });
    return NextResponse.json({ ok: true, message: created.message, conversation: created.conversation }, { status: 201 });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
