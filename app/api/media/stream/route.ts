import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest, sessionHasEntitlement } from "../../../lib/auth/session";
import { verifyMediaAccessToken } from "../../../lib/media/accessToken";
import { isAllowedMediaSourcePath } from "../../../lib/media/sourcePolicy";
import { allowRateLimit } from "../../../lib/security/rateLimit";

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`media-stream:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token is required" }, { status: 400 });

  const payload = verifyMediaAccessToken(token);
  if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  if (Date.now() >= payload.exp) return NextResponse.json({ error: "Token expired" }, { status: 401 });
  if (!isAllowedMediaSourcePath(payload.src)) {
    return NextResponse.json({ error: "Invalid media source" }, { status: 400 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!sessionHasEntitlement(session, payload.entitlementCode ?? null)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.redirect(new URL(payload.src, request.url));
}
