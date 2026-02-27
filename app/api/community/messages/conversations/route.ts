import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../lib/auth/session";
import {
  createCommunityConversation,
  SocialConversationAccessError,
  SocialConversationBlockedError,
  SocialConversationNotFoundError,
  SocialConversationValidationError,
} from "../../../../lib/community/social-store";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type CreateConversationPayload = {
  type?: unknown;
  title?: unknown;
  targetUserId?: unknown;
  projectId?: unknown;
};

function parseConversationType(value: unknown): "dm" | "project" | null {
  if (value === "dm" || value === "project") return value;
  return null;
}

function normalizeText(value: unknown, minLength: number, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) return undefined;
  return normalized;
}

function mapErrorToResponse(error: unknown): NextResponse {
  if (error instanceof SocialConversationValidationError) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  if (error instanceof SocialConversationAccessError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof SocialConversationBlockedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof SocialConversationNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  return NextResponse.json({ error: "CONVERSATION_CREATE_FAILED" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-messages-conversations:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: CreateConversationPayload = {};
  try {
    payload = (await request.json()) as CreateConversationPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const type = parseConversationType(payload.type);
  if (!type) return NextResponse.json({ error: "type must be dm|project" }, { status: 422 });

  try {
    const created = await createCommunityConversation({
      initiatorUserId: session.userId,
      type,
      title: normalizeText(payload.title, 1, 180),
      targetUserId: normalizeText(payload.targetUserId, 2, 120),
      projectId: normalizeText(payload.projectId, 2, 160),
    });
    return NextResponse.json(
      {
        ok: true,
        idempotent: created.idempotent,
        conversation: created.conversation,
      },
      { status: created.idempotent ? 200 : 201 }
    );
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
