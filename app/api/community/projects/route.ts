import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import {
  createCommunityProject,
  listCommunityProjects,
  type CommunityProjectRole,
} from "../../../lib/community/project-store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type CreateProjectPayload = {
  name?: unknown;
  description?: unknown;
  members?: unknown;
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

function normalizeMembers(raw: unknown): { ok: true; value: Array<{ userId: string; role: CommunityProjectRole }> } | { ok: false } {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false };
  const seen = new Set<string>();
  const members: Array<{ userId: string; role: CommunityProjectRole }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false };
    const userId = normalizeText((item as { userId?: unknown }).userId, 2, 120);
    const role = parseRole((item as { role?: unknown }).role);
    if (!userId || !role) return { ok: false };
    if (seen.has(userId)) continue;
    seen.add(userId);
    members.push({ userId, role });
  }
  return { ok: true, value: members };
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-projects:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const offset = parseOffset(request.nextUrl.searchParams.get("offset"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const mineOnly = request.nextUrl.searchParams.get("mine") === "1";

  const listed = await listCommunityProjects({
    offset,
    limit,
    memberUserId: mineOnly ? session.userId : undefined,
  });
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
  if (!allowRateLimit(`community-projects:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: CreateProjectPayload = {};
  try {
    payload = (await request.json()) as CreateProjectPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const name = normalizeText(payload.name, 2, 120);
  if (!name) {
    return NextResponse.json({ error: "name must be 2..120 chars" }, { status: 422 });
  }

  const description = payload.description == null ? undefined : normalizeText(payload.description, 1, 500) || null;
  if (payload.description != null && description == null) {
    return NextResponse.json({ error: "description must be 1..500 chars" }, { status: 422 });
  }

  const parsedMembers = normalizeMembers(payload.members);
  if (!parsedMembers.ok) {
    return NextResponse.json({ error: "members must be [{ userId, role(owner|editor|viewer) }]" }, { status: 422 });
  }

  const project = await createCommunityProject({
    name,
    description: description || undefined,
    createdByUserId: session.userId,
    members: parsedMembers.value,
  });

  return NextResponse.json({ ok: true, project }, { status: 201 });
}
