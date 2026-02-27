"use client";

import { useEffect, useState } from "react";

export default function ArticleReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop;
      const scrollHeight = doc.scrollHeight - doc.clientHeight;
      const value = scrollHeight <= 0 ? 0 : Math.min(100, Math.max(0, (scrollTop / scrollHeight) * 100));
      setProgress(value);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="sticky top-0 z-20 h-1 w-full bg-transparent">
      <div
        className="h-full bg-[#6ea7ff] transition-[width] duration-100"
        style={{ width: `${progress.toFixed(2)}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
