import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import { getCollabRoomById } from "../../../../../lib/community/collab-store";
import {
  getCommunityProjectById,
  linkRoomToCommunityProject,
  listCommunityProjectRoomLinks,
  type CommunityProjectRole,
} from "../../../../../lib/community/project-store";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

type LinkRoomPayload = {
  roomId?: unknown;
  role?: unknown;
};

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function parseRole(value: unknown): CommunityProjectRole | null {
  if (value === "owner" || value === "editor" || value === "viewer") return value;
  return null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-project-rooms:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const project = await getCommunityProjectById(projectId);
  if (!project) return NextResponse.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });

  const items = await listCommunityProjectRoomLinks(projectId);
  return NextResponse.json({
    projectId,
    total: items.length,
    items,
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-project-rooms:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: LinkRoomPayload = {};
  try {
    payload = (await request.json()) as LinkRoomPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { projectId } = await context.params;
  const roomId = normalizeText(payload.roomId, 2, 120);
  if (!roomId) {
    return NextResponse.json({ error: "roomId must be 2..120 chars" }, { status: 422 });
  }
  const role = parseRole(payload.role);
  if (!role) {
    return NextResponse.json({ error: "role must be owner|editor|viewer" }, { status: 422 });
  }

  const room = await getCollabRoomById(roomId);
  if (!room) return NextResponse.json({ error: "ROOM_NOT_FOUND" }, { status: 404 });

  const linked = await linkRoomToCommunityProject({
    projectId,
    roomId,
    role,
    linkedByUserId: session.userId,
  });
  if (!linked.ok) {
    return NextResponse.json({ error: linked.error }, { status: 404 });
  }

  return NextResponse.json(
    {
      ok: true,
      idempotent: linked.idempotent,
      link: linked.link,
      room: {
        id: room.id,
        title: room.title,
        status: room.status,
      },
    },
    { status: linked.idempotent ? 200 : 201 }
  );
}
