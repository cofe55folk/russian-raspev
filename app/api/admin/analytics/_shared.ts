import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import { allowRateLimit } from "../../../lib/security/rateLimit";

export type AdminAnalyticsErrorCode = "UNAUTHORIZED" | "RATE_LIMITED" | "ADMIN_SECRET_NOT_CONFIGURED";

type AdminAnalyticsErrorPayload = {
  error: string;
  code: AdminAnalyticsErrorCode;
  status: 401 | 429 | 503;
};

function buildError(
  status: AdminAnalyticsErrorPayload["status"],
  code: AdminAnalyticsErrorCode,
  error: string
) {
  return NextResponse.json<AdminAnalyticsErrorPayload>({ error, code, status }, { status });
}

function safeSecretCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function getClientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function validateAdminSecret(request: NextRequest): NextResponse | null {
  const configuredSecret = process.env.RR_ADMIN_API_SECRET?.trim() || "";
  if (!configuredSecret) {
    return buildError(503, "ADMIN_SECRET_NOT_CONFIGURED", "Admin API secret is not configured");
  }

  const providedSecret = request.headers.get("x-rr-admin-secret")?.trim() || "";
  if (!providedSecret || !safeSecretCompare(providedSecret, configuredSecret)) {
    return buildError(401, "UNAUTHORIZED", "Unauthorized");
  }

  return null;
}

export function validateAdminRateLimit(
  request: NextRequest,
  params: {
    keyPrefix: string;
    limit: number;
    windowMs: number;
  }
): NextResponse | null {
  const ip = getClientIp(request);
  if (!allowRateLimit(`${params.keyPrefix}:${ip}`, params.limit, params.windowMs)) {
    return buildError(429, "RATE_LIMITED", "Too many requests");
  }
  return null;
}
