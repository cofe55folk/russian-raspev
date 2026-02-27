import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import {
  createCollabSlot,
  getCollabRoomById,
  listCollabSlotsByRoom,
} from "../../../../../lib/community/collab-store";
import { persistIdempotencyResult, resolveIdempotency } from "../../../../../lib/security/idempotency";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

type CreateSlotPayload = {
  title?: unknown;
  role?: unknown;
};

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-room-slots:get:${ip}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { roomId } = await context.params;
  const room = await getCollabRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const slots = await listCollabSlotsByRoom(roomId);
  return NextResponse.json({ room, total: slots.length, items: slots });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-room-slots:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await context.params;

  let payload: CreateSlotPayload = {};
  try {
    payload = (await request.json()) as CreateSlotPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const idempotencyScope = `community.room-slots.post:user:${session.userId}:room:${roomId}`;
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

  const title = normalizeText(payload.title, 2, 120);
  if (!title) return respond(422, { error: "title must be 2..120 chars" });

  const parsedRole = payload.role == null ? null : normalizeText(payload.role, 1, 80);
  if (payload.role != null && !parsedRole) {
    return respond(422, { error: "role must be 1..80 chars" });
  }
  const role = parsedRole ?? undefined;

  const slot = await createCollabSlot({
    roomId,
    title,
    role,
    createdByUserId: session.userId,
  });
  if (!slot) return respond(404, { error: "Room not found" });

  return respond(201, { ok: true, slot });
}
