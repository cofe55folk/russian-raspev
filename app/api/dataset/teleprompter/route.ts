import { createHash } from "node:crypto"
import { mkdir, appendFile, readFile } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"

type DatasetRow = Record<string, unknown>

type DatasetPayload = {
  snapshotId?: string
  rows?: DatasetRow[]
}

function normalizeDatasetValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeDatasetValue(item))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, normalizeDatasetValue((value as Record<string, unknown>)[key])])
    )
  }
  return value
}

function normalizeDatasetRowForSignature(row: DatasetRow): DatasetRow {
  const { exported_at: _exportedAt, ingested_at: _ingestedAt, snapshot_id: _snapshotId, ...rest } = row
  return Object.fromEntries(
    Object.keys(rest)
      .sort()
      .map((key) => [key, normalizeDatasetValue(rest[key])])
  )
}

function computeDatasetSnapshotSignature(rows: DatasetRow[]): string {
  const normalizedRows = rows
    .map((row) => normalizeDatasetRowForSignature(row))
    .sort((left, right) => Number(left.line_index ?? 0) - Number(right.line_index ?? 0))
  return createHash("sha1").update(JSON.stringify(normalizedRows)).digest("hex")
}

async function findDuplicateSnapshot(
  datasetPath: string,
  rows: DatasetRow[]
): Promise<{ snapshotId: string; signature: string } | null> {
  const firstRow = rows[0]
  const songScope = typeof firstRow?.song_scope === "string" ? firstRow.song_scope : ""
  const sourceUrl = typeof firstRow?.source_url === "string" ? firstRow.source_url : ""
  if (!songScope || !sourceUrl) return null

  let existingText = ""
  try {
    existingText = await readFile(datasetPath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null
    throw error
  }

  const incomingSignature = computeDatasetSnapshotSignature(rows)
  const groupedSnapshots = new Map<string, DatasetRow[]>()
  for (const line of existingText.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as DatasetRow
      if (parsed.song_scope !== songScope || parsed.source_url !== sourceUrl) continue
      const snapshotId =
        typeof parsed.snapshot_id === "string" && parsed.snapshot_id.trim() ? parsed.snapshot_id : "__missing_snapshot_id__"
      const snapshotRows = groupedSnapshots.get(snapshotId)
      if (snapshotRows) {
        snapshotRows.push(parsed)
      } else {
        groupedSnapshots.set(snapshotId, [parsed])
      }
    } catch {
      continue
    }
  }

  for (const [snapshotId, snapshotRows] of groupedSnapshots) {
    if (computeDatasetSnapshotSignature(snapshotRows) === incomingSignature) {
      return { snapshotId, signature: incomingSignature }
    }
  }

  return null
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

  const duplicateSnapshot = await findDuplicateSnapshot(datasetPath, rows)
  if (duplicateSnapshot) {
    return NextResponse.json({
      ok: true,
      rowsWritten: 0,
      deduplicated: true,
      duplicateOfSnapshotId: duplicateSnapshot.snapshotId,
      signature: duplicateSnapshot.signature,
      datasetPath: "data/datasets/teleprompter-dataset.jsonl",
    })
  }

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
    deduplicated: false,
    signature: computeDatasetSnapshotSignature(rows),
    datasetPath: "data/datasets/teleprompter-dataset.jsonl",
  })
}
