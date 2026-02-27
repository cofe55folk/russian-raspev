import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest, sessionHasEntitlement } from "../../../lib/auth/session";
import { issueMediaAccessToken } from "../../../lib/media/accessToken";
import { isAllowedMediaSourcePath } from "../../../lib/media/sourcePolicy";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type SignPayload = {
  src?: string;
  entitlementCode?: string;
  ttlSec?: number;
};

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`media-sign:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: SignPayload = {};
  try {
    payload = (await request.json()) as SignPayload;
  } catch {}

  const src = typeof payload.src === "string" ? payload.src : "";
  if (!isAllowedMediaSourcePath(src)) {
    return NextResponse.json({ error: "Only /audio/ and /video/ paths are allowed" }, { status: 400 });
  }

  const entitlementCode = typeof payload.entitlementCode === "string" && payload.entitlementCode.trim()
    ? payload.entitlementCode
    : null;
  const session = await readAuthSessionFromRequest(request);
  if (!sessionHasEntitlement(session, entitlementCode)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ttlSec = typeof payload.ttlSec === "number" && Number.isFinite(payload.ttlSec)
    ? Math.max(15, Math.min(60 * 10, Math.floor(payload.ttlSec)))
    : 60 * 5;
  const exp = Date.now() + ttlSec * 1000;
  const token = issueMediaAccessToken({ src, exp, entitlementCode: entitlementCode ?? undefined });

  return NextResponse.json({
    url: `/api/media/stream?token=${encodeURIComponent(token)}`,
    expiresAt: new Date(exp).toISOString(),
  });
}
