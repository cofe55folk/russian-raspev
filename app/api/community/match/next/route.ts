import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../lib/auth/session";
import { takeNextCommunityMatch } from "../../../../lib/community/match-store";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

const DEFAULT_COOLDOWN_SEC = 120;

type MatchNextPayload = {
  cooldownSec?: unknown;
  now?: unknown;
};

function parseCooldownSec(value: unknown): number {
  if (value == null) return DEFAULT_COOLDOWN_SEC;
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_COOLDOWN_SEC;
  return Math.max(1, Math.min(3600, Math.trunc(num)));
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
  if (!allowRateLimit(`community-match-next:post:${ip}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: MatchNextPayload = {};
  try {
    payload = (await request.json()) as MatchNextPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsedNow = parseNow(payload.now);
  if (parsedNow === null) {
    return NextResponse.json({ error: "now must be valid ISO datetime string" }, { status: 422 });
  }

  const next = await takeNextCommunityMatch({
    requesterUserId: session.userId,
    requesterName: session.name,
    cooldownSec: parseCooldownSec(payload.cooldownSec),
    now: parsedNow,
  });

  if (!next.ok) {
    return NextResponse.json(next, { status: 409 });
  }

  if (next.status === "matched") {
    return NextResponse.json({
      ok: true,
      status: "matched",
      queueSize: next.queueSize,
      match: next.match,
      counterpart: next.counterpart,
      roomDraft: next.match.roomDraft,
      roomDraftParams: next.roomDraftParams,
      transition: next.transition,
    });
  }

  if (next.status === "cooldown") {
    return NextResponse.json({
      ok: true,
      status: "cooldown",
      queueSize: next.queueSize,
      cooldownUntil: next.cooldownUntil,
    });
  }

  return NextResponse.json({
    ok: true,
    status: "waiting",
    queueSize: next.queueSize,
  });
}
