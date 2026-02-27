import Link from "next/link";
import { notFound } from "next/navigation";
import ArticleBlocksRenderer from "../../components/articles/ArticleBlocksRenderer";
import ArticleReadingProgress from "../../components/articles/ArticleReadingProgress";
import ArticleToc, { type ArticleTocItem } from "../../components/articles/ArticleToc";
import EngagementTracker from "../../components/analytics/EngagementTracker";
import CommentsPanel from "../../components/community/CommentsPanel";
import ContentReactionsBar from "../../components/community/ContentReactionsBar";
import PageHero from "../../components/PageHero";
import { estimateArticleReadMinutes, getArticleBySlug, getArticleSubtitle, getArticleTitle } from "../../lib/articlesCatalog";
import { formatDateForLocale } from "../../lib/i18n/format";
import { I18N_MESSAGES } from "../../lib/i18n/messages";
import { getArticleHref, getArticlesHref } from "../../lib/i18n/routing";
import { readRequestLocale } from "../../lib/i18n/server";

type Props = {
  params: Promise<{ slug: string }>;
};

function compactTocTitle(raw: string, level: 2 | 3) {
  const text = raw.replace(/\s+/g, " ").trim();
  const withoutTail = level === 3 ? text.replace(/\s*\([^)]*\)\s*$/, "").trim() : text;
  const limit = level === 2 ? 64 : 54;
  if (withoutTail.length <= limit) return withoutTail;
  return `${withoutTail.slice(0, limit - 1).trimEnd()}…`;
}

function normalizeForCompare(value: string) {
  return value.replace(/[«»"]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;
  const article = getArticleBySlug(slug);
  if (!article) return notFound();
  const localizedTitle = getArticleTitle(article, locale);
  const localizedSubtitle = getArticleSubtitle(article, locale);
  const readMinutes = estimateArticleReadMinutes(article);
  const publishedAtLabel = article.publishedAt ? formatDateForLocale(article.publishedAt, locale) : "";
  const sectionHeadings = article.sections
    .map((section, idx) => ({
      id: `section-${idx + 1}`,
      title: compactTocTitle(section.heading ?? "", 2),
      level: 2 as const,
      originalTitle: section.heading ?? "",
    }))
    .filter((item): item is { id: string; title: string; level: 2; originalTitle: string } => !!item.title);
  const blockHeadings = (article.blocks ?? [])
    .map((block) => {
      if (block.type === "text") {
        const headingMatch = block.html.match(/<h([23])[^>]*>(.*?)<\/h\1>/i);
        if (!headingMatch) return null;
        const stripped = (headingMatch[2] ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!stripped) return null;
        const level = Number(headingMatch[1]) === 3 ? (3 as const) : (2 as const);
        return {
          id: `article-block-${block.id}`,
          title: compactTocTitle(stripped, level),
          level,
          originalTitle: stripped,
        };
      }
      return null;
    })
    .filter((item): item is { id: string; title: string; level: 2 | 3; originalTitle: string } => !!item)
    .filter((item) => normalizeForCompare(item.originalTitle) !== normalizeForCompare(localizedTitle))
    .slice(0, 24);
  const tocItems: ArticleTocItem[] = (blockHeadings.length ? blockHeadings : sectionHeadings).map((item) => ({
    id: item.id,
    title: item.title,
    level: item.level,
  }));

  return (
    <main className="rr-article-main rr-article-main-read">
      <EngagementTracker contentType="article" contentId={article.slug} mode="article" />
      <ArticleReadingProgress />
      <PageHero title={localizedTitle} subtitle={localizedSubtitle} />

      <section className="rr-article-shell mt-4">
        <div data-testid="article-meta-bar" className="rr-article-meta-bar">
          {article.publishedAt ? <span>{t("article.meta.date")}: {publishedAtLabel}</span> : null}
          <span>{t("article.meta.reading")}: ~{readMinutes} {t("common.minutesShort")}</span>
          <span>{t("article.meta.blocks")}: {article.blocks?.length ?? article.sections.length}</span>
        </div>
      </section>

      <section className="rr-article-shell mt-8 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <article className="rr-article-panel rr-article-read-panel p-6 md:p-8">
          <div className="rr-article-meta mb-6 flex flex-wrap items-center gap-3">
            <Link data-testid="article-all-link" href={getArticlesHref(locale)} className="rr-article-link">
              {t("article.allArticles")}
            </Link>
            {article.publishedAt ? <span>{t("article.meta.date")}: {publishedAtLabel}</span> : null}
            {article.sourceUrl ? (
              <a href={article.sourceUrl} target="_blank" rel="noreferrer" className="rr-article-link">
                {article.sourceLabel ?? t("common.source")}
              </a>
            ) : null}
          </div>

          {tocItems.length ? (
            <details className="mb-6 rounded-lg border border-[#3b3f47] bg-[#26282e] px-3 py-2 xl:hidden" data-testid="article-mobile-toc">
              <summary className="cursor-pointer text-sm font-semibold text-[#dce2ef]">{t("article.toc")}</summary>
              <ArticleToc items={tocItems} mode="mobile" />
            </details>
          ) : null}

          {article.blocks?.length ? (
            <ArticleBlocksRenderer
              blocks={article.blocks}
              tone="dark"
              renderProfile={article.slug === "oi-ty-porushka-paranya" ? "vk-compat" : "default"}
              className="rr-article-reader"
              anchorPrefix="article-block"
              articleId={article.slug}
              articleTitle={localizedTitle}
              syncGlobalPlaylist
              syncGlobalVideoPlaylist
            />
          ) : (
            <div className="rr-article-reader space-y-8">
              {article.sections.map((section, sectionIdx) => (
                <section key={`${article.slug}-${sectionIdx}`} id={`section-${sectionIdx + 1}`} className="space-y-4">
                  {section.heading ? <h2 className="text-2xl font-semibold text-[#f0f1f4]">{section.heading}</h2> : null}
                  <div className="space-y-3 text-base leading-7 text-[#d7dbe2] md:text-lg">
                    {section.paragraphs.map((paragraph, idx) => (
                      <p key={`${article.slug}-${sectionIdx}-p-${idx}`}>{paragraph}</p>
                    ))}
                  </div>

                  {section.audios?.length ? (
                    <div className="space-y-3 rounded-sm bg-[#23262d] p-4">
                      {section.audios.map((audio, idx) => (
                        <div key={`${article.slug}-${sectionIdx}-a-${idx}`} className="space-y-1">
                          <div className="text-sm font-medium text-[#e6e8ec]">{audio.title}</div>
                          <audio controls preload="none" className="w-full">
                            <source src={audio.src} />
                          </audio>
                          {audio.note ? <div className="text-xs text-[#9aa3b2]">{audio.note}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          )}
        </article>

        <aside className="hidden xl:block">
          <div data-testid="article-aside-meta" className="rr-article-panel sticky top-24 space-y-3 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#9aa3b2]">{t("article.about")}</div>
            <div className="space-y-1 text-sm text-[#c8cdd6]">
              {article.publishedAt ? <div>{t("article.meta.date")}: {publishedAtLabel}</div> : null}
              <div>{t("article.meta.blocks")}: {article.blocks?.length ?? article.sections.length}</div>
              <div>{t("article.meta.reading")}: ~{readMinutes} {t("common.minutesShort")}</div>
            </div>
            {tocItems.length ? (
              <div className="space-y-2 border-t border-[#3b3f47] pt-3">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#9aa3b2]">{t("article.toc")}</div>
                <ArticleToc items={tocItems} mode="desktop" />
              </div>
            ) : null}
          </div>
        </aside>
      </section>

      <section className="rr-article-shell mt-5">
        <ContentReactionsBar
          contentType="article"
          contentId={article.slug}
          contentTitle={localizedTitle}
          contentHref={getArticleHref(locale, article.slug)}
          tone="dark"
          testId="article-reactions"
        />
      </section>

      <section className="rr-article-shell mt-5 pb-10">
        <CommentsPanel
          contentType="article"
          contentId={article.slug}
          contentTitle={localizedTitle}
          contentHref={getArticleHref(locale, article.slug)}
          testId="article-comments"
        />
      </section>
    </main>
  );
}
