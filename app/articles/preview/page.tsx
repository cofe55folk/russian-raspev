"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ArticleBlocksRenderer from "../../components/articles/ArticleBlocksRenderer";
import PageHero from "../../components/PageHero";
import { useI18n } from "../../components/i18n/I18nProvider";
import { DRAFT_KEY, parseStoredDraft, type ArticleDraft } from "../../lib/articlesDraft";
import { getArticleCreateHref, getArticlesHref } from "../../lib/i18n/routing";
import type {
  ArticleItem,
} from "../../lib/articlesCatalog";

function getDraft(): ArticleDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return parseStoredDraft(raw);
  } catch {
    return null;
  }
}

export default function ArticlesPreviewPage() {
  const { locale, t } = useI18n();
  const [draft] = useState<ArticleDraft | null>(() => getDraft());

  const article = useMemo<ArticleItem | null>(() => {
    if (!draft) return null;
    return {
      slug: draft.slug || "preview",
      title: draft.title || t("articles.draft.fallbackTitle"),
      subtitle: draft.subtitle || "",
      coverImage: draft.coverImage || undefined,
      sourceLabel: draft.sourceLabel || undefined,
      sourceUrl: draft.sourceUrl || undefined,
      sections: [],
      blocks: draft.blocks,
    };
  }, [draft, t]);

  return (
    <main className="rr-article-main">
      <PageHero
        title={article?.title || t("articles.preview.title")}
        subtitle={article?.subtitle || t("articles.preview.subtitle")}
      />

      <section className="rr-article-shell mt-8">
        <article className="rr-article-panel p-6 md:p-8">
          <div className="rr-article-meta mb-6 flex flex-wrap items-center gap-3">
            <Link data-testid="articles-preview-back-editor" href={getArticleCreateHref(locale)} className="rr-article-link">
              {t("articles.preview.backEditor")}
            </Link>
            <Link data-testid="articles-preview-back-catalog" href={getArticlesHref(locale)} className="rr-article-link">
              {t("articles.preview.backCatalog")}
            </Link>
          </div>

          {!article?.blocks?.length ? (
            <div data-testid="articles-preview-empty" className="rounded-sm border border-[#3b3f47] bg-[#23262d] p-5 text-sm text-[#aab0bb]">
              <p>{t("articles.preview.empty")}</p>
              <p className="mt-1">
                {t("articles.preview.emptyHint")}{" "}
                <Link href={getArticleCreateHref(locale)} className="rr-article-link">
                  {t("articles.preview.backEditor")}
                </Link>
                .
              </p>
            </div>
          ) : (
            <ArticleBlocksRenderer blocks={article.blocks} tone="dark" className="rr-article-reader" />
          )}
        </article>
      </section>
    </main>
  );
}
