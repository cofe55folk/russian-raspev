"use client";

import { useRouter } from "next/navigation";

type BackButtonProps = {
  href?: string;
};

export default function BackButton({ href }: BackButtonProps) {
  const router = useRouter();

  const onBack = () => {
    if (href) {
      router.push(href);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  };

  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-2 rounded-sm border border-white/40 bg-black/20 px-3 py-1.5 text-sm text-white hover:bg-black/35"
      aria-label="Назад"
      title="Назад"
    >
      <span aria-hidden>←</span>
      <span>Назад</span>
    </button>
  );
}
