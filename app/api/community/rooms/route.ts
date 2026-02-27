import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import {
  createCollabRoom,
  listCollabRooms,
  type CollabReferenceContentType,
  type CollabRoomStatus,
} from "../../../lib/community/collab-store";
import { persistIdempotencyResult, resolveIdempotency } from "../../../lib/security/idempotency";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type CreateRoomPayload = {
  title?: unknown;
  description?: unknown;
  referenceContentType?: unknown;
  referenceContentId?: unknown;
};

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

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

function parseRoomStatus(value: string | null): CollabRoomStatus | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "active" || normalized === "archived") return normalized;
  return undefined;
}

function parseReferenceContentType(value: unknown): CollabReferenceContentType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "sound" || normalized === "article" || normalized === "video" || normalized === "education") {
    return normalized;
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-rooms:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const status = parseRoomStatus(request.nextUrl.searchParams.get("status"));

  const listed = await listCollabRooms({ offset, limit, status });
  const nextOffset = offset + limit < listed.total ? offset + limit : null;
  return NextResponse.json({
    total: listed.total,
    offset,
    limit,
    nextOffset,
    items: listed.items,
  });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-rooms:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: CreateRoomPayload = {};
  try {
    payload = (await request.json()) as CreateRoomPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const idempotencyScope = `community.rooms.post:user:${session.userId}`;
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
  if (!title) {
    return respond(422, { error: "title must be 2..120 chars" });
  }

  const parsedDescription = payload.description == null ? null : normalizeText(payload.description, 0, 500);
  if (payload.description != null && parsedDescription == null) {
    return respond(422, { error: "description must be <=500 chars" });
  }
  const description = parsedDescription ?? undefined;

  const referenceContentType = payload.referenceContentType == null ? undefined : parseReferenceContentType(payload.referenceContentType);
  if (payload.referenceContentType != null && !referenceContentType) {
    return respond(422, { error: "invalid referenceContentType" });
  }

  const parsedReferenceContentId =
    payload.referenceContentId == null ? null : normalizeText(payload.referenceContentId, 1, 180);
  if (payload.referenceContentId != null && !parsedReferenceContentId) {
    return respond(422, { error: "referenceContentId must be 1..180 chars" });
  }
  const referenceContentId = parsedReferenceContentId ?? undefined;

  const room = await createCollabRoom({
    title,
    description,
    referenceContentType,
    referenceContentId,
    createdByUserId: session.userId,
  });

  return respond(201, { ok: true, room });
}
