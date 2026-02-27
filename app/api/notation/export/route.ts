import { NextResponse } from "next/server";
import {
  buildNotationExportArtifact,
  createNotationInteropError,
  normalizeNotationFormat,
  type NotationFormat,
} from "../../../lib/notation/interop";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawFormat = url.searchParams.get("format");

  let format: NotationFormat = "musicxml";
  if (rawFormat) {
    const normalized = normalizeNotationFormat(rawFormat);
    if (!normalized) {
      return NextResponse.json(
        {
          ok: false,
          error: createNotationInteropError("unsupported_format", "Supported formats are 'musicxml' and 'mei'.", {
            receivedFormat: rawFormat,
            supportedFormats: ["musicxml", "mei"],
          }),
        },
        { status: 400 }
      );
    }
    format = normalized;
  }

  const artifact = buildNotationExportArtifact(format);
  return new Response(artifact.content, {
    status: 200,
    headers: {
      "content-type": artifact.mimeType,
      "content-disposition": `attachment; filename=\"${artifact.filename}\"`,
      "x-notation-format": artifact.format,
      "x-notation-root": artifact.root,
      "cache-control": "no-store",
    },
  });
}
