import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import {
  getCommunityConversationForUser,
  SocialConversationAccessError,
  SocialConversationNotFoundError,
  SocialConversationValidationError,
} from "../../../../../lib/community/social-store";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";

function parseLimit(value: string | null): number {
  const num = Number(value || "50");
  if (!Number.isFinite(num)) return 50;
  return Math.max(1, Math.min(100, Math.floor(num)));
}

function parseCursor(value: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 160);
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
  return NextResponse.json({ error: "CONVERSATION_FETCH_FAILED" }, { status: 500 });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-messages-conversation:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  try {
    const conversation = await getCommunityConversationForUser({
      conversationId: id,
      userId: session.userId,
      limit: parseLimit(request.nextUrl.searchParams.get("limit")),
      cursor: parseCursor(request.nextUrl.searchParams.get("cursor")),
    });
    return NextResponse.json({
      conversation: conversation.conversation,
      total: conversation.total,
      nextCursor: conversation.nextCursor,
      items: conversation.items,
    });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
