import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import { hasProfanity, normalizeCommentBody } from "../../../../../lib/community/moderation";
import { createCollabFeedback, getCollabRoomById, listCollabFeedbackByRoom } from "../../../../../lib/community/collab-store";
import { persistIdempotencyResult, resolveIdempotency } from "../../../../../lib/security/idempotency";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

type CreateFeedbackPayload = {
  body?: unknown;
  atMs?: unknown;
  takeId?: unknown;
  section?: unknown;
};

function parseOffset(value: string | null): number {
  const num = Number(value || "0");
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function parseLimit(value: string | null): number {
  const num = Number(value || "20");
  if (!Number.isFinite(num)) return 20;
  return Math.max(1, Math.min(100, Math.floor(num)));
}

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function parseAtMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  if (normalized < 0 || normalized > 8 * 60 * 60 * 1000) return null;
  return normalized;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-room-feedback:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { roomId } = await context.params;
  const room = await getCollabRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const takeIdRaw = request.nextUrl.searchParams.get("takeId");
  const takeId = !takeIdRaw ? undefined : normalizeText(takeIdRaw, 3, 160) ?? undefined;

  const listed = await listCollabFeedbackByRoom({
    roomId,
    offset,
    limit,
    takeId,
  });
  const nextOffset = offset + limit < listed.total ? offset + limit : null;
  return NextResponse.json({
    room,
    total: listed.total,
    offset,
    limit,
    nextOffset,
    items: listed.items,
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-room-feedback:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await context.params;

  let payload: CreateFeedbackPayload = {};
  try {
    payload = (await request.json()) as CreateFeedbackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const idempotencyScope = `community.room-feedback.post:user:${session.userId}:room:${roomId}`;
  const idempotency = await resolveIdempotency({
    scope: idempotencyScope,
    idempotencyKeyHeader: request.headers.get("idempotency-key"),
    payload,
  });
  if (!idempotency.ok) {
    if (idempotency.error === "INVALID_IDEMPOTENCY_KEY") {
      return NextResponse.json({ error: "Invalid Idempotency-Key" }, { status: 422 });
    }
    return NextResponse.json({ error: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" }, { status: 409 });
  }
  if (idempotency.mode === "replay") {
    return NextResponse.json(idempotency.responseBody, { status: idempotency.responseStatus });
  }

  const respond = async (status: number, body: unknown) => {
    if (idempotency.mode === "new") {
      await persistIdempotencyResult({
        scope: idempotencyScope,
        resolved: idempotency,
        responseStatus: status,
        responseBody: body,
      });
    }
    return NextResponse.json(body, { status });
  };

  const body = normalizeCommentBody(typeof payload.body === "string" ? payload.body : undefined);
  if (!body) return respond(422, { error: "Feedback body is required" });
  if (hasProfanity(body)) {
    return respond(422, { error: "Message blocked by moderation filter" });
  }

  const atMs = parseAtMs(payload.atMs);
  if (atMs == null) {
    return respond(422, { error: "atMs must be an integer in range 0..28800000" });
  }

  const parsedTakeId = payload.takeId == null ? null : normalizeText(payload.takeId, 3, 160);
  if (payload.takeId != null && !parsedTakeId) {
    return respond(422, { error: "takeId must be 3..160 chars" });
  }
  const takeId = parsedTakeId ?? undefined;

  const parsedSection = payload.section == null ? null : normalizeText(payload.section, 1, 80);
  if (payload.section != null && !parsedSection) {
    return respond(422, { error: "section must be 1..80 chars" });
  }
  const section = parsedSection ?? undefined;

  const created = await createCollabFeedback({
    roomId,
    userId: session.userId,
    userName: session.name || session.email || session.userId,
    body,
    atMs,
    takeId,
    section,
  });

  if (!created.ok) {
    if (created.error === "ROOM_NOT_FOUND" || created.error === "TAKE_NOT_FOUND_IN_ROOM") {
      return respond(404, { error: created.error });
    }
    return respond(409, { error: created.error });
  }

  return respond(201, { ok: true, feedback: created.feedback, room: created.room });
}
