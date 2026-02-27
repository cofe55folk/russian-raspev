import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import { getCommunityProjectById, listCommunityProjectEvents } from "../../../../../lib/community/project-store";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

function parseLimit(value: string | null): number {
  const num = Number(value || "50");
  if (!Number.isFinite(num)) return 50;
  return Math.max(1, Math.min(200, Math.floor(num)));
}

export async function GET(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`community-project-timeline:get:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const project = await getCommunityProjectById(projectId);
  if (!project) return NextResponse.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const items = await listCommunityProjectEvents({ projectId, limit });
  return NextResponse.json({
    projectId,
    total: items.length,
    items,
  });
}
