import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import {
  getCommunityProjectById,
  listCommunityProjectTasks,
  upsertCommunityProjectTask,
  type CommunityProjectTaskKind,
  type CommunityProjectTaskStatus,
} from "../../../../../lib/community/project-store";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

type CreateTaskPayload = {
  title?: unknown;
  kind?: unknown;
  status?: unknown;
  assigneeUserId?: unknown;
};

function normalizeText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function parseTaskKind(value: unknown): CommunityProjectTaskKind | null {
  if (
    value === "transcription" ||
    value === "translation" ||
    value === "notation" ||
    value === "article" ||
    value === "multitrack" ||
    value === "other"
  ) {
    return value;
  }
  return null;
}

function parseTaskStatus(value: unknown): CommunityProjectTaskStatus | null {
  if (value === "todo" || value === "in_progress" || value === "done") return value;
  return null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-project-tasks:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const project = await getCommunityProjectById(projectId);
  if (!project) return NextResponse.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });

  const tasks = await listCommunityProjectTasks(projectId);
  return NextResponse.json({
    project,
    total: tasks.length,
    items: tasks,
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-project-tasks:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;

  let payload: CreateTaskPayload = {};
  try {
    payload = (await request.json()) as CreateTaskPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const title = normalizeText(payload.title, 2, 180);
  if (!title) {
    return NextResponse.json({ error: "title must be 2..180 chars" }, { status: 422 });
  }

  const kind = payload.kind == null ? "other" : parseTaskKind(payload.kind);
  if (!kind) return NextResponse.json({ error: "invalid task kind" }, { status: 422 });

  const status = payload.status == null ? "todo" : parseTaskStatus(payload.status);
  if (!status) return NextResponse.json({ error: "invalid task status" }, { status: 422 });

  const assigneeUserId =
    payload.assigneeUserId == null ? undefined : normalizeText(payload.assigneeUserId, 2, 120) || undefined;

  const result = await upsertCommunityProjectTask({
    projectId,
    actorUserId: session.userId,
    title,
    kind,
    status,
    assigneeUserId,
  });

  if (!result.ok) {
    if (result.error === "PROJECT_NOT_FOUND") return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json(
    {
      ok: true,
      created: result.created,
      task: result.task,
    },
    { status: 201 }
  );
}
