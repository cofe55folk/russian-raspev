import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import {
  listEventsForAdmin,
  setEventStatusByAdmin,
  upsertEventByAdmin,
  type AdminEventInput,
  type EventStatus,
} from "../../../lib/eventsCatalog";
import { DEFAULT_LOCALE, isLocale } from "../../../lib/i18n/types";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type UpsertPayload = {
  event?: AdminEventInput;
  actor?: string;
  source?: string;
};

type StatusPayload = {
  slug?: string;
  status?: EventStatus;
  actor?: string;
  source?: string;
};

function safeSecretCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function validateAdminSecret(request: NextRequest): NextResponse | null {
  const configuredSecret = process.env.RR_ADMIN_API_SECRET?.trim() || "";
  if (!configuredSecret) {
    return NextResponse.json({ error: "Admin API secret is not configured" }, { status: 503 });
  }
  const providedSecret = request.headers.get("x-rr-admin-secret")?.trim() || "";
  if (!providedSecret || !safeSecretCompare(providedSecret, configuredSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function resolveLocale(request: NextRequest): "ru" | "en" {
  const fromQuery = request.nextUrl.searchParams.get("locale");
  if (isLocale(fromQuery)) return fromQuery;
  const fromHeader = request.headers.get("x-rr-locale");
  if (isLocale(fromHeader)) return fromHeader;
  return DEFAULT_LOCALE;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`admin-events:get:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const authError = validateAdminSecret(request);
  if (authError) return authError;

  const locale = resolveLocale(request);
  const events = listEventsForAdmin(locale);
  return NextResponse.json({ events });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`admin-events:post:${ip}`, 90, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const authError = validateAdminSecret(request);
  if (authError) return authError;

  let payload: UpsertPayload = {};
  try {
    payload = (await request.json()) as UpsertPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = upsertEventByAdmin({
    input: payload.event,
    actor: payload.actor?.trim() || "admin-api",
    source: payload.source?.trim() || "admin-events-api",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    created: Boolean(result.created),
    event: result.event,
  });
}

export async function PATCH(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`admin-events:patch:${ip}`, 90, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const authError = validateAdminSecret(request);
  if (authError) return authError;

  let payload: StatusPayload = {};
  try {
    payload = (await request.json()) as StatusPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = setEventStatusByAdmin({
    slug: payload.slug?.trim() || "",
    status: (payload.status as EventStatus) || "draft",
    actor: payload.actor?.trim() || "admin-api",
    source: payload.source?.trim() || "admin-events-api",
  });
  if (!result.ok) {
    const statusCode = result.error === "Event not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  return NextResponse.json({
    ok: true,
    event: result.event,
  });
}
