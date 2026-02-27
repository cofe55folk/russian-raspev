import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"

export const runtime = "nodejs"

type ClientErrorPayload = {
  type?: unknown
  message?: unknown
  stack?: unknown
  source?: unknown
  line?: unknown
  column?: unknown
  href?: unknown
  userAgent?: unknown
  ts?: unknown
}

export async function POST(req: Request) {
  let payload: ClientErrorPayload
  try {
    payload = (await req.json()) as ClientErrorPayload
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  const row = {
    type: typeof payload.type === "string" ? payload.type : "error",
    message: typeof payload.message === "string" ? payload.message : "",
    stack: typeof payload.stack === "string" ? payload.stack : "",
    source: typeof payload.source === "string" ? payload.source : "",
    line: Number.isFinite(Number(payload.line)) ? Number(payload.line) : null,
    column: Number.isFinite(Number(payload.column)) ? Number(payload.column) : null,
    href: typeof payload.href === "string" ? payload.href : "",
    user_agent: typeof payload.userAgent === "string" ? payload.userAgent : "",
    client_ts: typeof payload.ts === "string" ? payload.ts : "",
    ingested_at: new Date().toISOString(),
  }

  const logDir = join(process.cwd(), "data", "logs")
  const logPath = join(logDir, "client-errors.ndjson")
  await mkdir(logDir, { recursive: true })
  await appendFile(logPath, `${JSON.stringify(row)}\n`, "utf8")

  return NextResponse.json({ ok: true })
}
