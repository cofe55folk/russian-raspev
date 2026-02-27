"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { emitAnalyticsClientEvent } from "../../lib/analytics/emitClientEvent";
import type { AnalyticsContentType, AnalyticsEventType } from "../../lib/analytics/store-file";

type Props = {
  href: string;
  className?: string;
  dataTestId?: string;
  children: ReactNode;
  analyticsEventType: AnalyticsEventType;
  analyticsContentType: AnalyticsContentType;
  analyticsContentId: string;
  analyticsDedupeKey?: string;
};

const PAGE_MOUNTED_AT_MS = Date.now();

export default function AnalyticsTrackedLink({
  href,
  className,
  dataTestId,
  children,
  analyticsEventType,
  analyticsContentType,
  analyticsContentId,
  analyticsDedupeKey,
}: Props) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={dataTestId}
      onClick={() => {
        const shouldAttachClickLatency =
          analyticsEventType === "search_click" || analyticsEventType === "search_recovery_click";
        const clickLatencySec = shouldAttachClickLatency
          ? Math.max(1, Math.ceil((Date.now() - PAGE_MOUNTED_AT_MS) / 1000))
          : undefined;
        emitAnalyticsClientEvent({
          eventType: analyticsEventType,
          contentType: analyticsContentType,
          contentId: analyticsContentId,
          dedupeKey: analyticsDedupeKey,
          timeSpentSec: clickLatencySec,
        });
      }}
    >
      {children}
    </Link>
  );
}
