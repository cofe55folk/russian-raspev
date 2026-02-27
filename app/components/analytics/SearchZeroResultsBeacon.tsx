"use client";

import { useEffect } from "react";
import { emitAnalyticsClientEvent } from "../../lib/analytics/emitClientEvent";
import { ensureAnalyticsSessionId, ensureVisitorId } from "../../lib/analytics/clientIdentity";

type Props = {
  query: string;
};

export default function SearchZeroResultsBeacon({ query }: Props) {
  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) return;

    const visitorId = ensureVisitorId();
    const sessionId = ensureAnalyticsSessionId();
    const dedupeBucket = Math.floor(Date.now() / (1000 * 60 * 10));
    const dedupeKey = `search-zero-results:${visitorId}:${sessionId}:${normalized}:${dedupeBucket}`;

    emitAnalyticsClientEvent({
      eventType: "search_zero_results_view",
      contentType: "search",
      contentId: normalized.slice(0, 180),
      dedupeKey,
    });
  }, [query]);

  return null;
}
