"use client";

import { ensureAnalyticsSessionId, ensureVisitorId } from "./clientIdentity";
import type { AnalyticsContentType, AnalyticsEventType } from "./store-file";

type EmitPayload = {
  contentType: AnalyticsContentType;
  contentId: string;
  eventType: AnalyticsEventType;
  progressPercent?: number;
  timeSpentSec?: number;
  dedupeKey?: string;
};

export function emitAnalyticsClientEvent(payload: EmitPayload): void {
  const visitorId = ensureVisitorId();
  const sessionId = ensureAnalyticsSessionId();
  const body = {
    ...payload,
    visitorId,
    sessionId,
    route: typeof window !== "undefined" ? window.location.pathname : undefined,
    locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : undefined,
    source: "web",
  };
  const json = JSON.stringify(body);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([json], { type: "application/json" });
      navigator.sendBeacon("/api/analytics/event", blob);
      return;
    } catch {
      // fallback to fetch
    }
  }

  void fetch("/api/analytics/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: json,
    keepalive: true,
  });
}
