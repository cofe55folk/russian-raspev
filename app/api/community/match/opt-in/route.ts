import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../lib/auth/session";
import { setCommunityMatchOptIn } from "../../../../lib/community/match-store";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type MatchOptInPayload = {
  optIn?: unknown;
  now?: unknown;
};

function parseOptIn(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
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
  if (!allowRateLimit(`community-match-opt-in:post:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: MatchOptInPayload = {};
  try {
    payload = (await request.json()) as MatchOptInPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const optIn = parseOptIn(payload.optIn);
  if (optIn == null) {
    return NextResponse.json({ error: "optIn must be boolean" }, { status: 422 });
  }

  const parsedNow = parseNow(payload.now);
  if (parsedNow === null) {
    return NextResponse.json({ error: "now must be valid ISO datetime string" }, { status: 422 });
  }

  const result = await setCommunityMatchOptIn({
    userId: session.userId,
    name: session.name,
    optIn,
    now: parsedNow,
  });

  return NextResponse.json({
    ok: true,
    optedIn: result.optedIn,
    queueSize: result.queueSize,
    cooldownUntil: result.cooldownUntil,
  });
}
