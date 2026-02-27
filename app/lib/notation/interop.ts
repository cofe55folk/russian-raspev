export type NotationFormat = "musicxml" | "mei";

export type NotationInteropErrorCode =
  | "invalid_json"
  | "invalid_payload"
  | "invalid_xml"
  | "unsupported_format"
  | "root_mismatch";

export type NotationInteropError = {
  code: NotationInteropErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

type InteropSuccess<T> = {
  ok: true;
  data: T;
};

type InteropFailure = {
  ok: false;
  status: number;
  error: NotationInteropError;
};

export type NotationInteropResult<T> = InteropSuccess<T> | InteropFailure;

export type ValidNotationImport = {
  format: NotationFormat;
  root: string;
  content: string;
  metadata: NormalizedNotationMetadata;
};

export type NotationImportSummary = {
  format: NotationFormat;
  root: string;
  title: string | null;
  composer: string | null;
};

export type NormalizedNotationMetadata = {
  title: string | null;
  composer: string | null;
};

export type NotationExportArtifact = {
  format: NotationFormat;
  root: string;
  filename: string;
  mimeType: string;
  content: string;
};

const EXPECTED_ROOT_BY_FORMAT: Record<NotationFormat, string> = {
  musicxml: "score-partwise",
  mei: "mei",
};

const MIME_BY_FORMAT: Record<NotationFormat, string> = {
  musicxml: "application/vnd.recordare.musicxml+xml; charset=utf-8",
  mei: "application/mei+xml; charset=utf-8",
};

const FILENAME_BY_FORMAT: Record<NotationFormat, string> = {
  musicxml: "score.musicxml",
  mei: "score.mei",
};

const MINIMAL_TEMPLATE_BY_FORMAT: Record<NotationFormat, string> = {
  musicxml: `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Voice</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
`,
  mei: `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="4.0.1">
  <music>
    <body>
      <mdiv>
        <score>
          <section>
            <measure n="1">
              <staff n="1">
                <layer n="1">
                  <note pname="c" oct="4" dur="4" />
                </layer>
              </staff>
            </measure>
          </section>
        </score>
      </mdiv>
    </body>
  </music>
</mei>
`,
};

export function createNotationInteropError(
  code: NotationInteropErrorCode,
  message: string,
  details?: Record<string, unknown>
): NotationInteropError {
  return { code, message, details };
}

function fail<T>(
  status: number,
  code: NotationInteropErrorCode,
  message: string,
  details?: Record<string, unknown>
): NotationInteropResult<T> {
  return {
    ok: false,
    status,
    error: createNotationInteropError(code, message, details),
  };
}

export function normalizeNotationFormat(value: unknown): NotationFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "musicxml") return "musicxml";
  if (normalized === "mei") return "mei";
  return null;
}

function stripXmlPrefixes(xml: string): string {
  return xml.replace(/^\uFEFF/, "").trimStart();
}

function parseFirstXmlTagName(xml: string): string | null {
  let source = stripXmlPrefixes(xml);
  source = source.replace(/^<\?xml[\s\S]*?\?>\s*/i, "");

  // Remove top comments and doctype that can appear before the root element.
  while (source.startsWith("<!--")) {
    source = source.replace(/^<!--[\s\S]*?-->\s*/i, "");
  }
  source = source.replace(/^<!doctype[\s\S]*?>\s*/i, "");

  const match = source.match(/^<([A-Za-z_][\w:.-]*)\b/);
  if (!match) return null;
  return match[1] ?? null;
}

function resolveLocalName(tagName: string): string {
  const parts = tagName.split(":");
  return (parts[parts.length - 1] ?? tagName).toLowerCase();
}

function decodeXmlEntities(value: string): string {
  const decodeNumericEntity = (raw: string, radix: 10 | 16): string => {
    const codePoint = Number.parseInt(raw, radix);
    if (!Number.isFinite(codePoint)) return "";
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return "";
    }
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => decodeNumericEntity(hex, 16))
    .replace(/&#([0-9]+);/g, (_, dec: string) => decodeNumericEntity(dec, 10))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeMetadataValue(value: string | null): string | null {
  if (!value) return null;
  const withoutTags = value.replace(/<[^>]+>/g, " ");
  const normalized = decodeXmlEntities(withoutTags).replace(/\s+/g, " ").trim();
  return normalized || null;
}

function extractFirstTagValue(xml: string, tagNames: string[]): string | null {
  for (const tagName of tagNames) {
    const pattern = `<(?:[\\w-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`;
    const match = xml.match(new RegExp(pattern, "i"));
    if (match?.[1]) {
      const normalized = normalizeMetadataValue(match[1]);
      if (normalized) return normalized;
    }
  }
  return null;
}

function extractMusicXmlComposer(xml: string): string | null {
  const creatorComposer = xml.match(
    /<(?:[\w-]+:)?creator\b[^>]*\btype\s*=\s*(['"])composer\1[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?creator>/i
  );
  if (creatorComposer?.[2]) {
    const normalized = normalizeMetadataValue(creatorComposer[2]);
    if (normalized) return normalized;
  }
  return extractFirstTagValue(xml, ["creator", "composer"]);
}

function extractMeiComposer(xml: string): string | null {
  const persNameComposer = xml.match(
    /<(?:[\w-]+:)?persName\b[^>]*\brole\s*=\s*(['"])composer\1[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?persName>/i
  );
  if (persNameComposer?.[2]) {
    const normalized = normalizeMetadataValue(persNameComposer[2]);
    if (normalized) return normalized;
  }
  return extractFirstTagValue(xml, ["composer", "persName"]);
}

export function normalizeNotationMetadata(
  format: NotationFormat,
  content: string
): NormalizedNotationMetadata {
  if (format === "musicxml") {
    return {
      title: extractFirstTagValue(content, ["movement-title", "work-title", "title"]),
      composer: extractMusicXmlComposer(content),
    };
  }
  return {
    title: extractFirstTagValue(content, ["title", "titlePart"]),
    composer: extractMeiComposer(content),
  };
}

export function extractXmlRoot(xml: string): string | null {
  const rawTag = parseFirstXmlTagName(xml);
  if (!rawTag) return null;
  return resolveLocalName(rawTag);
}

export function inferNotationFormatFromRoot(root: string): NotationFormat | null {
  if (root === "score-partwise") return "musicxml";
  if (root === "mei") return "mei";
  return null;
}

export function expectedRootForFormat(format: NotationFormat): string {
  return EXPECTED_ROOT_BY_FORMAT[format];
}

export function getMinimalNotationTemplate(format: NotationFormat): string {
  return MINIMAL_TEMPLATE_BY_FORMAT[format];
}

export function getNotationMimeType(format: NotationFormat): string {
  return MIME_BY_FORMAT[format];
}

export function getNotationFilename(format: NotationFormat): string {
  return FILENAME_BY_FORMAT[format];
}

export function summarizeNotationImport(input: ValidNotationImport): NotationImportSummary {
  return {
    format: input.format,
    root: input.root,
    title: input.metadata.title,
    composer: input.metadata.composer,
  };
}

export function buildNotationExportArtifact(format: NotationFormat): NotationExportArtifact {
  return {
    format,
    root: expectedRootForFormat(format),
    filename: getNotationFilename(format),
    mimeType: getNotationMimeType(format),
    content: getMinimalNotationTemplate(format),
  };
}

export function validateNotationImport(input: {
  format?: unknown;
  content?: unknown;
}): NotationInteropResult<ValidNotationImport> {
  const rawContent = typeof input.content === "string" ? input.content : "";
  const content = rawContent.trim();
  if (!content) {
    return fail(
      400,
      "invalid_payload",
      "Field 'content' is required and must be a non-empty XML string.",
      {
        field: "content",
        reason: "required_non_empty_xml",
      }
    );
  }

  const root = extractXmlRoot(content);
  if (!root) {
    return fail(422, "invalid_xml", "Unable to parse XML root element from payload content.");
  }

  const hasFormatField = input.format !== undefined && input.format !== null && `${input.format}`.trim() !== "";
  const explicitFormat = normalizeNotationFormat(input.format);
  if (hasFormatField && !explicitFormat) {
    return fail(400, "unsupported_format", "Supported formats are 'musicxml' and 'mei'.", {
      receivedFormat: input.format,
      supportedFormats: ["musicxml", "mei"],
    });
  }

  const format = explicitFormat ?? inferNotationFormatFromRoot(root);
  if (!format) {
    return fail(422, "root_mismatch", "Unsupported XML root for notation import.", {
      actualRoot: root,
      expectedRoots: Object.values(EXPECTED_ROOT_BY_FORMAT),
    });
  }

  const expectedRoot = expectedRootForFormat(format);
  if (root !== expectedRoot) {
    return fail(422, "root_mismatch", "Notation root does not match requested format.", {
      format,
      expectedRoot,
      actualRoot: root,
    });
  }

  return {
    ok: true,
    data: {
      format,
      root,
      content,
      metadata: normalizeNotationMetadata(format, content),
    },
  };
}
