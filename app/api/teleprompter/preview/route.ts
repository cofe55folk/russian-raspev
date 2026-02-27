import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, normalize, sep } from "node:path"

import { NextResponse } from "next/server"

type PreviewLineInput = {
  time?: unknown
  text?: unknown
}

type PreviewPayload = {
  sourceUrl?: unknown
  lines?: PreviewLineInput[]
}

function resolvePublicAudioPath(sourceUrl: string): string | null {
  const cleanUrl = sourceUrl.split("#")[0]?.split("?")[0] ?? ""
  if (!cleanUrl.startsWith("/audio/")) return null
  if (!cleanUrl.endsWith(".json")) return null

  const relativePath = cleanUrl.replace(/^\/+/, "")
  const fullPath = normalize(join(process.cwd(), "public", relativePath))
  const audioRoot = normalize(join(process.cwd(), "public", "audio") + sep)
  if (!fullPath.startsWith(audioRoot)) return null
  return fullPath
}

export async function POST(req: Request) {
  let payload: PreviewPayload
  try {
    payload = (await req.json()) as PreviewPayload
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl : ""
  const targetPath = resolvePublicAudioPath(sourceUrl)
  if (!targetPath) {
    return NextResponse.json({ ok: false, error: "invalid_source_url" }, { status: 400 })
  }

  const inputLines = Array.isArray(payload.lines) ? payload.lines : []
  if (!inputLines.length) {
    return NextResponse.json({ ok: false, error: "lines_required" }, { status: 400 })
  }

  const lines = inputLines.map((line, index) => {
    const rawTime = Number(line?.time)
    const time = Number.isFinite(rawTime) ? Math.max(0, Number(rawTime.toFixed(3))) : index
    const text = typeof line?.text === "string" ? line.text : ""
    return { time, text }
  })

  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(lines, null, 2)}\n`, "utf8")

  return NextResponse.json({
    ok: true,
    path: sourceUrl,
    linesWritten: lines.length,
  })
}
