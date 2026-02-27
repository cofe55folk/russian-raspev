"use client";

import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useI18n } from "./i18n/I18nProvider";

type BackButtonProps = {
  href?: string;
};

export default function BackButton({ href }: BackButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  const onBack = () => {
    if (href) {
      router.push(href);
      return;
    }
    if (pathname && pathname !== "/") {
      const normalized = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
      const parent = normalized.slice(0, normalized.lastIndexOf("/"));
      router.push(parent || "/");
      return;
    }
    router.push("/");
  };

  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-2 rounded-sm border border-white/40 bg-black/20 px-3 py-1.5 text-sm text-white hover:bg-black/35"
      aria-label={t("backButton.label")}
      title={t("backButton.label")}
    >
      <span aria-hidden>←</span>
      <span>{t("backButton.label")}</span>
    </button>
  );
}
