import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../../lib/auth/session";
import {
  markCommunityConversationRead,
  SocialConversationAccessError,
  SocialConversationNotFoundError,
  SocialConversationValidationError,
} from "../../../../../../lib/community/social-store";
import { allowRateLimit } from "../../../../../../lib/security/rateLimit";

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
  return NextResponse.json({ error: "READ_MARK_FAILED" }, { status: 500 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-messages-read:post:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  try {
    const marked = await markCommunityConversationRead({
      conversationId: id,
      userId: session.userId,
    });
    return NextResponse.json({ ok: true, ...marked });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
