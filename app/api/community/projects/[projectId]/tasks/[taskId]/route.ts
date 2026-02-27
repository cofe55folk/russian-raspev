import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../../lib/auth/session";
import {
  upsertCommunityProjectTask,
  type CommunityProjectTaskKind,
  type CommunityProjectTaskStatus,
} from "../../../../../../lib/community/project-store";
import { allowRateLimit } from "../../../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ projectId: string; taskId: string }>;
};

type UpdateTaskPayload = {
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-project-task:patch:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: UpdateTaskPayload = {};
  try {
    payload = (await request.json()) as UpdateTaskPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { projectId, taskId } = await context.params;
  const title = payload.title == null ? undefined : normalizeText(payload.title, 2, 180) || "";
  if (payload.title != null && !title) return NextResponse.json({ error: "title must be 2..180 chars" }, { status: 422 });

  const kind = payload.kind == null ? undefined : parseTaskKind(payload.kind);
  if (payload.kind != null && !kind) return NextResponse.json({ error: "invalid task kind" }, { status: 422 });

  const status = payload.status == null ? undefined : parseTaskStatus(payload.status);
  if (payload.status != null && !status) return NextResponse.json({ error: "invalid task status" }, { status: 422 });

  const assigneeUserId =
    payload.assigneeUserId == null ? undefined : normalizeText(payload.assigneeUserId, 2, 120) || undefined;

  const result = await upsertCommunityProjectTask({
    projectId,
    taskId,
    actorUserId: session.userId,
    title,
    kind: kind || undefined,
    status: status || undefined,
    assigneeUserId,
  });

  if (!result.ok) {
    if (result.error === "PROJECT_NOT_FOUND" || result.error === "TASK_NOT_FOUND") {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    created: result.created,
    task: result.task,
  });
}
