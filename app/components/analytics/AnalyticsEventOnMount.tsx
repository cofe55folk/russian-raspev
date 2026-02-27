"use client";

import { useEffect, useRef } from "react";
import { emitAnalyticsClientEvent } from "../../lib/analytics/emitClientEvent";
import type { AnalyticsContentType, AnalyticsEventType } from "../../lib/analytics/store-file";

type Props = {
  eventType: AnalyticsEventType;
  contentType: AnalyticsContentType;
  contentId: string;
  dedupeKey?: string;
};

export default function AnalyticsEventOnMount({ eventType, contentType, contentId, dedupeKey }: Props) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    emitAnalyticsClientEvent({
      eventType,
      contentType,
      contentId,
      dedupeKey,
    });
  }, [eventType, contentType, contentId, dedupeKey]);

  return null;
}
