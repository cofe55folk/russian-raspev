"use client";

import { useEffect, useMemo, useRef } from "react";
import { ensureAnalyticsSessionId, ensureVisitorId } from "../../lib/analytics/clientIdentity";

type AnalyticsContentType = "article" | "video" | "sound" | "education";
type AnalyticsEventType = "view_3s" | "progress_25" | "progress_50" | "progress_75" | "progress_100" | "time_spent";

type EngagementTrackerProps = {
  contentType: AnalyticsContentType;
  contentId: string;
  mode?: "page" | "article";
};

const HEARTBEAT_MS = 15_000;

export default function EngagementTracker({ contentType, contentId, mode = "page" }: EngagementTrackerProps) {
  const normalizedContentId = useMemo(() => contentId.trim().slice(0, 180), [contentId]);
  const sentEventsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!normalizedContentId) return;

    const visitorId = ensureVisitorId();
    const sessionId = ensureAnalyticsSessionId();
    let activeStartedAt = Date.now();
    let accumulatedActiveMs = 0;
    let timeSliceSeq = 0;

    const sendEvent = (
      eventType: AnalyticsEventType,
      payload: { progressPercent?: number; timeSpentSec?: number; dedupeKey?: string } = {}
    ) => {
      const body = {
        contentType,
        contentId: normalizedContentId,
        eventType,
        progressPercent: payload.progressPercent,
        timeSpentSec: payload.timeSpentSec,
        visitorId,
        sessionId,
        route: window.location.pathname,
        locale: document.documentElement.lang?.slice(0, 2),
        source: "web",
        dedupeKey: payload.dedupeKey,
      };

      const text = JSON.stringify(body);
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
          const blob = new Blob([text], { type: "application/json" });
          navigator.sendBeacon("/api/analytics/event", blob);
          return;
        } catch {
          // Fallback to fetch.
        }
      }

      void fetch("/api/analytics/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
        keepalive: true,
      });
    };

    const sendEventOnce = (
      eventType: AnalyticsEventType,
      payload: { progressPercent?: number } = {},
      dedupeKey?: string
    ) => {
      const key = dedupeKey || `${eventType}:${payload.progressPercent ?? ""}`;
      if (sentEventsRef.current.has(key)) return;
      sentEventsRef.current.add(key);
      sendEvent(eventType, { ...payload, dedupeKey });
    };

    const viewTimer = window.setTimeout(() => {
      const dedupeKey = `view3s:${visitorId}:${sessionId}:${contentType}:${normalizedContentId}`;
      sendEventOnce("view_3s", {}, dedupeKey);
    }, 3000);

    const flushTimeSpent = () => {
      const now = Date.now();
      if (activeStartedAt > 0) {
        accumulatedActiveMs += Math.max(0, now - activeStartedAt);
        activeStartedAt = now;
      }
      const wholeSeconds = Math.floor(accumulatedActiveMs / 1000);
      if (wholeSeconds <= 0) return;
      accumulatedActiveMs -= wholeSeconds * 1000;
      const dedupeKey = `timespent:${visitorId}:${sessionId}:${contentType}:${normalizedContentId}:${timeSliceSeq}`;
      timeSliceSeq += 1;
      sendEvent("time_spent", {
        timeSpentSec: wholeSeconds,
        dedupeKey,
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushTimeSpent();
        activeStartedAt = 0;
        return;
      }
      if (activeStartedAt === 0) {
        activeStartedAt = Date.now();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    const heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      flushTimeSpent();
    }, HEARTBEAT_MS);

    const maybeEmitProgress = (percent: number) => {
      if (percent >= 25) {
        sendEventOnce(
          "progress_25",
          { progressPercent: 25 },
          `progress:25:${visitorId}:${contentType}:${normalizedContentId}`
        );
      }
      if (percent >= 50) {
        sendEventOnce(
          "progress_50",
          { progressPercent: 50 },
          `progress:50:${visitorId}:${contentType}:${normalizedContentId}`
        );
      }
      if (percent >= 75) {
        sendEventOnce(
          "progress_75",
          { progressPercent: 75 },
          `progress:75:${visitorId}:${contentType}:${normalizedContentId}`
        );
      }
      if (percent >= 100) {
        sendEventOnce(
          "progress_100",
          { progressPercent: 100 },
          `progress:100:${visitorId}:${contentType}:${normalizedContentId}`
        );
      }
    };

    const onScroll = () => {
      const doc = document.documentElement;
      const total = Math.max(0, doc.scrollHeight - window.innerHeight);
      const progress = total <= 0 ? 100 : Math.min(100, Math.max(0, (window.scrollY / total) * 100));
      maybeEmitProgress(progress);
    };

    if (mode === "article") {
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    return () => {
      window.clearTimeout(viewTimer);
      window.clearInterval(heartbeatTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (mode === "article") {
        window.removeEventListener("scroll", onScroll);
      }
      flushTimeSpent();
    };
  }, [contentType, mode, normalizedContentId]);

  return null;
}
