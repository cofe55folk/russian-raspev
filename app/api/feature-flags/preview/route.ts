import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import {
  PREVIEW_FLAGS_COOKIE,
  getPreviewFlagsFromRequest,
  normalizePreviewFeatureKey,
  serializePreviewFlags,
  withPreviewFlag,
} from "../../../lib/feature-flags/preview";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type UpdatePreviewPayload = {
  key?: string;
  enabled?: boolean;
};

function cookieMaxAge(flagsRaw: string): number {
  return flagsRaw ? 60 * 60 * 24 * 365 : 0;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`preview-flags:get:${ip}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const flags = Array.from(getPreviewFlagsFromRequest(request)).sort();
  return NextResponse.json({
    flags,
  });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`preview-flags:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: UpdatePreviewPayload = {};
  try {
    payload = (await request.json()) as UpdatePreviewPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const key = normalizePreviewFeatureKey(payload.key);
  if (!key || typeof payload.enabled !== "boolean") {
    return NextResponse.json({ error: "Invalid preview feature payload" }, { status: 422 });
  }

  const current = getPreviewFlagsFromRequest(request);
  const next = withPreviewFlag(current, key, payload.enabled);
  const raw = serializePreviewFlags(next);

  const response = NextResponse.json({
    ok: true,
    flags: Array.from(next).sort(),
  });
  response.cookies.set(PREVIEW_FLAGS_COOKIE, raw, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAge(raw),
  });
  return response;
}
