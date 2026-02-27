import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../lib/auth/session";
import { reportCommunityMatchUser } from "../../../../lib/community/match-store";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type MatchReportPayload = {
  targetUserId?: unknown;
  reason?: unknown;
  requestId?: unknown;
  now?: unknown;
};

function parseUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) return null;
  return normalized;
}

function parseReason(value: unknown): string | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  if (normalized.length > 500) return null;
  return normalized;
}

function parseRequestId(value: unknown): string | undefined | null {
  if (value == null) return undefined;
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
  if (!allowRateLimit(`community-match-report:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: MatchReportPayload = {};
  try {
    payload = (await request.json()) as MatchReportPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const targetUserId = parseUserId(payload.targetUserId);
  if (!targetUserId) {
    return NextResponse.json({ error: "targetUserId must be non-empty string" }, { status: 422 });
  }

  const reason = parseReason(payload.reason);
  if (reason === null) {
    return NextResponse.json({ error: "reason must be <=500 chars" }, { status: 422 });
  }

  const requestId = parseRequestId(payload.requestId);
  if (requestId === null) {
    return NextResponse.json({ error: "requestId must be <=200 chars" }, { status: 422 });
  }

  const parsedNow = parseNow(payload.now);
  if (parsedNow === null) {
    return NextResponse.json({ error: "now must be valid ISO datetime string" }, { status: 422 });
  }

  try {
    const result = await reportCommunityMatchUser({
      reporterUserId: session.userId,
      offenderUserId: targetUserId,
      reason,
      clientRequestId: requestId,
      now: parsedNow,
    });

    return NextResponse.json({
      ok: true,
      status: result.idempotent ? "duplicate" : "accepted",
      cooldownUntil: result.cooldownUntil,
    });
  } catch {
    return NextResponse.json({ error: "REPORT_FAILED" }, { status: 500 });
  }
}
