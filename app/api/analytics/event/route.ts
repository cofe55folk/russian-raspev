import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import {
  createAnalyticsEvent,
  isAnalyticsContentType,
  type AnalyticsEventType,
} from "../../../lib/analytics/store-file";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type EventPayload = {
  contentType?: string;
  contentId?: string;
  eventType?: AnalyticsEventType;
  progressPercent?: number;
  timeSpentSec?: number;
  visitorId?: string;
  sessionId?: string;
  route?: string;
  locale?: string;
  source?: string;
  dedupeKey?: string;
};

function normalizeEventType(value: unknown): AnalyticsEventType | null {
  if (value === "view_3s") return "view_3s";
  if (value === "progress_25") return "progress_25";
  if (value === "progress_50") return "progress_50";
  if (value === "progress_75") return "progress_75";
  if (value === "progress_100") return "progress_100";
  if (value === "time_spent") return "time_spent";
  if (value === "search_submit") return "search_submit";
  if (value === "search_click") return "search_click";
  if (value === "search_zero_results_view") return "search_zero_results_view";
  if (value === "search_recovery_click") return "search_recovery_click";
  if (value === "paywall_seen") return "paywall_seen";
  if (value === "paywall_click") return "paywall_click";
  if (value === "purchase") return "purchase";
  if (value === "donate_view") return "donate_view";
  if (value === "donate_amount_select") return "donate_amount_select";
  if (value === "donate_checkout_start") return "donate_checkout_start";
  if (value === "donate_checkout_success") return "donate_checkout_success";
  if (value === "donate_checkout_fail") return "donate_checkout_fail";
  return null;
}

function normalizeProgress(value: unknown): 25 | 50 | 75 | 100 | undefined {
  const num = Number(value);
  if (num === 25 || num === 50 || num === 75 || num === 100) return num;
  return undefined;
}

function normalizeVisitorId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 96);
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 96);
}

function normalizeRoute(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 220);
}

function normalizeLocale(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 8);
}

function normalizeSource(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 64);
}

function normalizeDedupeKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 220);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`analytics-event:post:${ip}`, 600, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let payload: EventPayload = {};
  try {
    payload = (await request.json()) as EventPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!isAnalyticsContentType(payload.contentType)) {
    return NextResponse.json({ error: "Invalid contentType" }, { status: 400 });
  }
  const contentId = payload.contentId?.trim() || "";
  if (!contentId) {
    return NextResponse.json({ error: "contentId is required" }, { status: 400 });
  }

  const eventType = normalizeEventType(payload.eventType);
  if (!eventType) {
    return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
  }

  const session = await readAuthSessionFromRequest(request);
  const result = await createAnalyticsEvent({
    contentType: payload.contentType,
    contentId: contentId.slice(0, 180),
    eventType,
    progressPercent: normalizeProgress(payload.progressPercent),
    timeSpentSec: typeof payload.timeSpentSec === "number" ? payload.timeSpentSec : undefined,
    userId: session?.userId,
    visitorId: normalizeVisitorId(payload.visitorId),
    sessionId: normalizeSessionId(payload.sessionId),
    route: normalizeRoute(payload.route),
    locale: normalizeLocale(payload.locale),
    source: normalizeSource(payload.source),
    dedupeKey: normalizeDedupeKey(payload.dedupeKey),
  });

  return NextResponse.json(
    { ok: true, deduped: result.deduped, eventId: result.event.id },
    { status: result.deduped ? 200 : 201 }
  );
}
