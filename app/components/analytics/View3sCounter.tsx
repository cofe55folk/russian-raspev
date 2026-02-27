"use client";

import { useEffect, useState } from "react";

type Props = {
  contentType: "article" | "video" | "sound" | "education";
  contentId: string;
  className?: string;
  testId?: string;
};

export default function View3sCounter({ contentType, contentId, className = "", testId }: Props) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/analytics/content?contentType=${encodeURIComponent(contentType)}&contentId=${encodeURIComponent(contentId)}`,
          { cache: "no-store" }
        );
        const payload = (await response.json()) as { view3sCount?: number };
        if (!response.ok) return;
        if (!cancelled) setCount(typeof payload.view3sCount === "number" ? payload.view3sCount : 0);
      } catch {
        // Counter is optional UI.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contentType, contentId]);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`.trim()} data-testid={testId}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
        <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6z" />
        <circle cx="12" cy="12" r="2.9" />
      </svg>
      <span>{count ?? "-"}</span>
    </span>
  );
}
