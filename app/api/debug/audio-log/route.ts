import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"

type AudioDebugLogPayload = {
  entries?: unknown
  pathname?: unknown
  text?: unknown
  userAgent?: unknown
  audioArtifact?: unknown
}

const MAX_TEXT_LENGTH = 250_000
const MAX_USER_AGENT_LENGTH = 1_024
const MAX_AUDIO_ARTIFACT_BASE64_LENGTH = 3_500_000

function sanitizeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "unknown"
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "disabled_in_production" }, { status: 403 })
  }

  let payload: AudioDebugLogPayload
  try {
    payload = (await req.json()) as AudioDebugLogPayload
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  const text = typeof payload.text === "string" ? payload.text.slice(0, MAX_TEXT_LENGTH) : ""
  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: "text_required" }, { status: 400 })
  }

  const entries = Array.isArray(payload.entries) ? payload.entries : []
  const pathname = typeof payload.pathname === "string" ? payload.pathname : ""
  const userAgent = typeof payload.userAgent === "string" ? payload.userAgent.slice(0, MAX_USER_AGENT_LENGTH) : ""
  const audioArtifact =
    payload.audioArtifact && typeof payload.audioArtifact === "object"
        ? (payload.audioArtifact as {
          format?: unknown
          sampleRate?: unknown
          channels?: unknown
          durationSec?: unknown
          captureWindowSec?: unknown
          totalCapturedSec?: unknown
          artifactStartOffsetSec?: unknown
          artifactEndOffsetSec?: unknown
          wavBase64?: unknown
          clickEvents?: unknown
        })
      : null
  const savedAt = new Date().toISOString()
  const stamp = savedAt.replace(/[:.]/g, "-")
  const fileSlug = sanitizeSlug(pathname || "sound")
  const relativeDir = join("tmp", "audio-debug", "browser")
  const targetDir = join(process.cwd(), relativeDir)
  const fileStem = `${stamp}-${fileSlug}`
  const fileName = `${fileStem}.json`
  const targetPath = join(targetDir, fileName)
  const latestPath = join(targetDir, "latest.json")
  let audioFileRelativePath: string | null = null

  await mkdir(targetDir, { recursive: true })

  if (
    audioArtifact?.format === "audio/wav" &&
    typeof audioArtifact.wavBase64 === "string" &&
    audioArtifact.wavBase64.length > 0 &&
    audioArtifact.wavBase64.length <= MAX_AUDIO_ARTIFACT_BASE64_LENGTH
  ) {
    const wavBytes = Buffer.from(audioArtifact.wavBase64, "base64")
    const audioFileName = `${fileStem}.wav`
    const audioTargetPath = join(targetDir, audioFileName)
    await writeFile(audioTargetPath, wavBytes)
    audioFileRelativePath = join(relativeDir, audioFileName)
  }

  const body = {
    savedAt,
    pathname,
    userAgent,
    entryCount: entries.length,
    audioArtifact: audioFileRelativePath
        ? {
          file: audioFileRelativePath,
          format: audioArtifact?.format,
          sampleRate: typeof audioArtifact?.sampleRate === "number" ? audioArtifact.sampleRate : null,
          channels: typeof audioArtifact?.channels === "number" ? audioArtifact.channels : null,
          durationSec: typeof audioArtifact?.durationSec === "number" ? audioArtifact.durationSec : null,
          captureWindowSec: typeof audioArtifact?.captureWindowSec === "number" ? audioArtifact.captureWindowSec : null,
          totalCapturedSec: typeof audioArtifact?.totalCapturedSec === "number" ? audioArtifact.totalCapturedSec : null,
          artifactStartOffsetSec:
            typeof audioArtifact?.artifactStartOffsetSec === "number" ? audioArtifact.artifactStartOffsetSec : null,
          artifactEndOffsetSec:
            typeof audioArtifact?.artifactEndOffsetSec === "number" ? audioArtifact.artifactEndOffsetSec : null,
          clickEvents: Array.isArray(audioArtifact?.clickEvents) ? audioArtifact.clickEvents : [],
        }
      : null,
    entries,
    text,
  }

  await writeFile(targetPath, `${JSON.stringify(body, null, 2)}\n`, "utf8")
  await writeFile(latestPath, `${JSON.stringify(body, null, 2)}\n`, "utf8")

  return NextResponse.json({
    ok: true,
    entryCount: entries.length,
    file: join(relativeDir, fileName),
    latest: join(relativeDir, "latest.json"),
    audio: audioFileRelativePath,
  })
}
