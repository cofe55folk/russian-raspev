import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import { attachTakeToCollabSlot } from "../../../../../lib/community/collab-store";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ slotId: string }>;
};

type AttachTakePayload = {
  sourceTakeId?: unknown;
  note?: unknown;
};

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-slot-take:post:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slotId } = await context.params;

  let payload: AttachTakePayload = {};
  try {
    payload = (await request.json()) as AttachTakePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const sourceTakeId = normalizeText(payload.sourceTakeId, 3, 160);
  if (!sourceTakeId) {
    return NextResponse.json({ error: "sourceTakeId must be 3..160 chars" }, { status: 422 });
  }

  const parsedNote = payload.note == null ? null : normalizeText(payload.note, 0, 500);
  if (payload.note != null && parsedNote == null) {
    return NextResponse.json({ error: "note must be <=500 chars" }, { status: 422 });
  }
  const note = parsedNote ?? undefined;

  const attached = await attachTakeToCollabSlot({
    slotId,
    submittedByUserId: session.userId,
    sourceTakeId,
    note,
  });

  if (!attached.ok) {
    if (attached.error === "SLOT_NOT_FOUND" || attached.error === "ROOM_NOT_FOUND") {
      return NextResponse.json({ error: attached.error }, { status: 404 });
    }
    return NextResponse.json({ error: attached.error }, { status: 409 });
  }

  return NextResponse.json(
    {
      ok: true,
      room: attached.room,
      slot: attached.slot,
      take: attached.take,
    },
    { status: 201 }
  );
}
