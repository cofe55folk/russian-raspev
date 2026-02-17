import { mkdir, appendFile } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"

type DatasetRow = Record<string, unknown>

type DatasetPayload = {
  snapshotId?: string
  rows?: DatasetRow[]
}

export async function POST(req: Request) {
  let payload: DatasetPayload
  try {
    payload = (await req.json()) as DatasetPayload
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : []
  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "rows_required" }, { status: 400 })
  }

  const datasetDir = join(process.cwd(), "data", "datasets")
  const datasetPath = join(datasetDir, "teleprompter-dataset.jsonl")

  await mkdir(datasetDir, { recursive: true })

  const now = new Date().toISOString()
  const snapshotId = typeof payload.snapshotId === "string" && payload.snapshotId ? payload.snapshotId : `snapshot-${Date.now()}`
  const lines = rows
    .map((row) => JSON.stringify({ ...row, snapshot_id: snapshotId, ingested_at: now }))
    .join("\n") + "\n"

  await appendFile(datasetPath, lines, "utf8")

  return NextResponse.json({
    ok: true,
    rowsWritten: rows.length,
    snapshotId,
    datasetPath: "data/datasets/teleprompter-dataset.jsonl",
  })
}
