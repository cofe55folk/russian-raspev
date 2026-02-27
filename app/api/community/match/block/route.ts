import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../lib/auth/session";
import { blockCommunityMatchUser } from "../../../../lib/community/match-store";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type MatchBlockPayload = {
  targetUserId?: unknown;
  now?: unknown;
};

function parseUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) return null;
  return normalized;
}

function parseNow(value: unknown): Date | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-match-block:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: MatchBlockPayload = {};
  try {
    payload = (await request.json()) as MatchBlockPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const targetUserId = parseUserId(payload.targetUserId);
  if (!targetUserId) {
    return NextResponse.json({ error: "targetUserId must be non-empty string" }, { status: 422 });
  }

  const parsedNow = parseNow(payload.now);
  if (parsedNow === null) {
    return NextResponse.json({ error: "now must be valid ISO datetime string" }, { status: 422 });
  }

  try {
    const result = await blockCommunityMatchUser({
      blockerUserId: session.userId,
      blockedUserId: targetUserId,
      now: parsedNow,
    });

    return NextResponse.json({
      ok: true,
      status: result.idempotent ? "already_blocked" : "blocked",
    });
  } catch {
    return NextResponse.json({ error: "BLOCK_FAILED" }, { status: 500 });
  }
}
