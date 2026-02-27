"use client";

import { useEffect, useMemo, useState } from "react";

export type ArticleTocItem = {
  id: string;
  title: string;
  level: 2 | 3;
};

type Props = {
  items: ArticleTocItem[];
  mode?: "desktop" | "mobile";
};

function findActiveId(items: ArticleTocItem[]): string | null {
  if (!items.length) return null;

  const visible = items
    .map((item) => {
      const element = document.getElementById(item.id);
      if (!element) return null;
      const top = element.getBoundingClientRect().top;
      return { id: item.id, top };
    })
    .filter((row): row is { id: string; top: number } => row !== null);

  if (!visible.length) return null;

  const fromTop = visible.filter((row) => row.top <= 140);
  if (fromTop.length) return fromTop[fromTop.length - 1]!.id;

  return visible[0]!.id;
}

export default function ArticleToc({ items, mode = "desktop" }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const normalizedItems = useMemo(() => items.slice(0, 30), [items]);

  useEffect(() => {
    const update = () => {
      const hash = window.location.hash.replace(/^#/, "").trim();
      if (hash && normalizedItems.some((item) => item.id === hash)) {
        setActiveId(hash);
        return;
      }
      setActiveId(findActiveId(normalizedItems));
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("hashchange", update);
    };
  }, [normalizedItems]);

  if (!normalizedItems.length) return null;

  return (
    <div className={mode === "mobile" ? "mt-2 space-y-1" : "max-h-[70vh] space-y-1 overflow-auto pr-1"}>
      {normalizedItems.map((item, index) => {
        const prev = index > 0 ? normalizedItems[index - 1] : null;
        const isActive = item.id === activeId;
        const baseClass = mode === "mobile" ? "block text-sm hover:text-white" : "block text-sm hover:text-white";
        const indentClass = item.level === 3 ? "pl-4 text-[13px] leading-5" : "font-medium leading-5";
        const groupClass = item.level === 2 && prev ? "mt-2.5 border-t border-[#343b46] pt-2" : "";
        const colorClass = isActive
          ? "text-[#9cc4ff] rr-article-toc-active"
          : mode === "mobile"
            ? "text-[#c8cdd6]"
            : "text-[#d7dbe2]";

        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`${baseClass} ${indentClass} ${groupClass} ${colorClass}`}
            data-testid={isActive ? "article-toc-active" : undefined}
            aria-current={isActive ? "true" : undefined}
            title={item.title}
          >
            {item.level === 3 ? <span className="mr-1.5 text-[#617086]">·</span> : null}
            {item.title}
          </a>
        );
      })}
    </div>
  );
}
