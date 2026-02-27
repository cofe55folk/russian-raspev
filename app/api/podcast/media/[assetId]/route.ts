import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getPodcastMediaAssetById } from "../../../../lib/podcast/podcast-store";

const PUBLIC_ROOT = path.join(process.cwd(), "public");

function inferContentType(sourcePath: string): string {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  return "application/octet-stream";
}

function toPublicFilePath(audioUrl: string): string | null {
  if (!audioUrl.startsWith("/")) return null;
  const resolved = path.resolve(PUBLIC_ROOT, `.${audioUrl}`);
  if (!resolved.startsWith(PUBLIC_ROOT)) return null;
  return resolved;
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;

  const rawStart = match[1] || "";
  const rawEnd = match[2] || "";

  if (!rawStart && !rawEnd) return null;

  if (!rawStart && rawEnd) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const boundedSuffix = Math.min(size, Math.floor(suffixLength));
    return {
      start: Math.max(0, size - boundedSuffix),
      end: Math.max(0, size - 1),
    };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start < 0) return null;

  const parsedStart = Math.floor(start);
  const parsedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(parsedEnd)) return null;

  const boundedEnd = Math.min(size - 1, Math.floor(parsedEnd));
  if (parsedStart >= size || boundedEnd < parsedStart) return null;

  return { start: parsedStart, end: boundedEnd };
}

function baseHeaders(contentType: string, size: number, stat: { mtime: Date; mtimeMs: number }): Headers {
  return new Headers({
    "content-type": contentType,
    "accept-ranges": "bytes",
    "content-length": String(size),
    "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    "last-modified": stat.mtime.toUTCString(),
    etag: `W/\"${size}-${Math.floor(stat.mtimeMs)}\"`,
    "x-content-type-options": "nosniff",
  });
}

async function handleRequest(
  request: NextRequest,
  params: { assetId: string },
  method: "GET" | "HEAD"
): Promise<Response> {
  const media = await getPodcastMediaAssetById(params.assetId);
  if (!media) {
    return Response.json({ error: "Podcast media asset not found" }, { status: 404 });
  }

  const filePath = toPublicFilePath(media.episode.audioUrl);
  if (!filePath) {
    return Response.json({ error: "Unsupported media source" }, { status: 400 });
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return Response.json({ error: "Media file not found" }, { status: 404 });
  }

  if (!stat.isFile()) {
    return Response.json({ error: "Media file not found" }, { status: 404 });
  }

  const size = stat.size;
  const contentType = inferContentType(filePath);
  const rangeHeader = request.headers.get("range");

  if (!rangeHeader) {
    const headers = baseHeaders(contentType, size, stat);
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    const nodeStream = createReadStream(filePath);
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, { status: 200, headers });
  }

  const parsedRange = parseRange(rangeHeader, size);
  if (!parsedRange) {
    const headers = baseHeaders(contentType, 0, stat);
    headers.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const { start, end } = parsedRange;
  const chunkLength = end - start + 1;
  const headers = baseHeaders(contentType, chunkLength, stat);
  headers.set("content-range", `bytes ${start}-${end}/${size}`);

  if (method === "HEAD") {
    return new Response(null, { status: 206, headers });
  }

  const nodeStream = createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, { status: 206, headers });
}

export async function GET(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const params = await context.params;
  return handleRequest(request, params, "GET");
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const params = await context.params;
  return handleRequest(request, params, "HEAD");
}
