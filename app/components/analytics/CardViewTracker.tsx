"use client";

import { useEffect, useRef } from "react";
import { ensureAnalyticsSessionId, ensureVisitorId } from "../../lib/analytics/clientIdentity";

const ANALYTICS_PERSIST_IN_DEV = process.env.NEXT_PUBLIC_ANALYTICS_PERSIST_IN_DEV === "1";

type Props = {
  contentType: "article" | "video" | "sound" | "education";
  contentId: string;
};

function postViewEvent(contentType: Props["contentType"], contentId: string, visitorId: string, sessionId: string) {
  const dedupeKey = `view3s:${visitorId}:${sessionId}:${contentType}:${contentId}`;
  const payload = {
    contentType,
    contentId,
    eventType: "view_3s",
    visitorId,
    sessionId,
    route: typeof window !== "undefined" ? window.location.pathname : undefined,
    locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : undefined,
    source: "web",
    dedupeKey,
  };
  const body = JSON.stringify(payload);
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      navigator.sendBeacon("/api/analytics/event", new Blob([body], { type: "application/json" }));
      return;
    } catch {
      // ignore and fallback
    }
  }
  void fetch("/api/analytics/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  });
}

export default function CardViewTracker({ contentType, contentId }: Props) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const shouldPersist = process.env.NODE_ENV === "production" || ANALYTICS_PERSIST_IN_DEV;
    if (!shouldPersist) return;

    const element = markerRef.current;
    if (!element || firedRef.current) return;

    const visitorId = ensureVisitorId();
    const sessionId = ensureAnalyticsSessionId();
    let timer: number | null = null;

    const startTimer = () => {
      if (timer || firedRef.current) return;
      timer = window.setTimeout(() => {
        firedRef.current = true;
        postViewEvent(contentType, contentId, visitorId, sessionId);
      }, 3000);
    };

    const stopTimer = () => {
      if (!timer) return;
      window.clearTimeout(timer);
      timer = null;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
          startTimer();
        } else {
          stopTimer();
        }
      },
      { threshold: [0.55] }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      stopTimer();
    };
  }, [contentId, contentType]);

  return <span ref={markerRef} aria-hidden="true" className="sr-only" />;
}
