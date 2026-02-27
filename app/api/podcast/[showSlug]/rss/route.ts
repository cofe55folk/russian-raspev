import { NextResponse } from "next/server";
import { encodePodcastMediaAssetId, getPodcastShowWithEpisodes } from "../../../../lib/podcast/podcast-store";

const FALLBACK_SITE_URL = "http://localhost:3000";

function inferAudioMimeType(sourcePath: string): string {
  const normalized = sourcePath.trim().toLowerCase();
  if (normalized.endsWith(".m4a")) return "audio/mp4";
  if (normalized.endsWith(".aac")) return "audio/aac";
  if (normalized.endsWith(".wav")) return "audio/wav";
  if (normalized.endsWith(".ogg")) return "audio/ogg";
  return "audio/mpeg";
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeDescription(value: string | undefined, fallback: string): string {
  const normalized = (value || "").trim();
  if (!normalized) return fallback;
  return normalized;
}

function toPubDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return new Date(0).toUTCString();
  return parsed.toUTCString();
}

export async function GET(request: Request, context: { params: Promise<{ showSlug: string }> }) {
  const { showSlug } = await context.params;
  const data = await getPodcastShowWithEpisodes(showSlug);
  if (!data) {
    return NextResponse.json({ error: "Podcast show not found" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin || FALLBACK_SITE_URL;
  const rssUrl = `${baseUrl}/api/podcast/${encodeURIComponent(data.show.slug)}/rss`;
  const showPageUrl = `${baseUrl}/podcast/${encodeURIComponent(data.show.slug)}`;

  const itemsXml = data.episodes
    .map((episode) => {
      const episodeUrl = `${baseUrl}/podcast/${encodeURIComponent(data.show.slug)}/${encodeURIComponent(episode.slug)}`;
      const assetId = encodePodcastMediaAssetId(data.show.slug, episode.slug);
      const enclosureUrl = `${baseUrl}/api/podcast/media/${encodeURIComponent(assetId)}`;
      const enclosureType = inferAudioMimeType(episode.audioUrl);
      const episodeDescription = normalizeDescription(episode.description, `Episode of ${data.show.title}`);
      return [
        "<item>",
        `<title>${escapeXml(episode.title)}</title>`,
        `<description>${escapeXml(episodeDescription)}</description>`,
        `<link>${escapeXml(episodeUrl)}</link>`,
        `<guid isPermaLink=\"false\">${escapeXml(`${data.show.slug}:${episode.slug}`)}</guid>`,
        `<pubDate>${escapeXml(toPubDate(episode.publishedAt))}</pubDate>`,
        `<enclosure url=\"${escapeXml(enclosureUrl)}\" type=\"${escapeXml(enclosureType)}\" />`,
        "</item>",
      ].join("");
    })
    .join("");

  const showDescription = normalizeDescription(data.show.description, `Podcast show ${data.show.title}`);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${escapeXml(data.show.title)}</title>`,
    `<description>${escapeXml(showDescription)}</description>`,
    `<link>${escapeXml(showPageUrl)}</link>`,
    `<atom:link href=\"${escapeXml(rssUrl)}\" rel=\"self\" type=\"application/rss+xml\" />`,
    `<lastBuildDate>${escapeXml(new Date().toUTCString())}</lastBuildDate>`,
    itemsXml,
    "</channel>",
    "</rss>",
  ].join("");

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
