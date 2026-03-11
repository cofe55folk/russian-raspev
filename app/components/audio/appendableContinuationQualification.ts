"use client"

import type {
  AppendableStartupManifestContinuationChunk,
  AppendableStartupManifestMatch,
} from "./appendableStartupManifest"

const CONTINUATION_TOLERANCE_SEC = 0.05

export type AppendableContinuationQualificationStatus = "off" | "qualified" | "fallback"
export type AppendableContinuationQualificationReason =
  | "flag_off"
  | "no_continuation_plan"
  | "missing_source_chunks"
  | "source_chunk_count_mismatch"
  | "source_layout_mismatch"
  | "chunk_alignment_mismatch"
  | "chunk_before_startup_end"
  | "chunk_gap_after_startup"
  | "chunk_gap"
  | "chunk_overlap"
  | "coverage_beyond_estimated_duration"

export type AppendableQualifiedContinuationChunk = {
  src: string
  startSec: number
  durationSec: number
  endSec: number
  label: string | null
}

export type AppendableContinuationQualification = {
  status: AppendableContinuationQualificationStatus
  reason: AppendableContinuationQualificationReason | null
  availableGroupCount: number
  plannedGroupCount: number
  coverageEndSec: number | null
  sourceGroups: AppendableQualifiedContinuationChunk[][]
}

function normalizeQualifiedChunk(
  chunk: AppendableStartupManifestContinuationChunk | null | undefined
): AppendableQualifiedContinuationChunk | null {
  if (!chunk) return null
  if (typeof chunk.src !== "string" || chunk.src.trim().length === 0) return null
  if (typeof chunk.startSec !== "number" || !Number.isFinite(chunk.startSec) || chunk.startSec < 0) return null
  if (typeof chunk.durationSec !== "number" || !Number.isFinite(chunk.durationSec) || chunk.durationSec <= 0) return null
  return {
    src: chunk.src,
    startSec: chunk.startSec,
    durationSec: chunk.durationSec,
    endSec: chunk.startSec + chunk.durationSec,
    label: typeof chunk.label === "string" && chunk.label.trim().length > 0 ? chunk.label.trim() : null,
  }
}

function diffExceedsTolerance(left: number, right: number) {
  return Math.abs(left - right) > CONTINUATION_TOLERANCE_SEC
}

function createContinuationQualification(
  partial: Partial<AppendableContinuationQualification> & Pick<AppendableContinuationQualification, "status" | "reason">
): AppendableContinuationQualification {
  return {
    status: partial.status,
    reason: partial.reason,
    availableGroupCount: partial.availableGroupCount ?? 0,
    plannedGroupCount: partial.plannedGroupCount ?? 0,
    coverageEndSec:
      typeof partial.coverageEndSec === "number" && Number.isFinite(partial.coverageEndSec)
        ? Number(partial.coverageEndSec.toFixed(3))
        : null,
    sourceGroups: partial.sourceGroups ?? [],
  }
}

export function qualifyAppendableContinuationChunks(options: {
  enabled: boolean
  startupDurationSec: number
  manifestMatch: AppendableStartupManifestMatch | null
}): AppendableContinuationQualification {
  const { enabled, startupDurationSec, manifestMatch } = options
  if (!manifestMatch) {
    return createContinuationQualification({
      status: enabled ? "fallback" : "off",
      reason: enabled ? "missing_source_chunks" : "flag_off",
    })
  }

  const sourceGroups = manifestMatch.sources.map((source) =>
    Array.isArray(source.continuationChunks)
      ? source.continuationChunks
          .map((chunk) => normalizeQualifiedChunk(chunk))
          .filter((chunk): chunk is AppendableQualifiedContinuationChunk => !!chunk)
      : []
  )
  const availableGroupCount = sourceGroups.length ? Math.min(...sourceGroups.map((groups) => groups.length)) : 0
  if (!enabled) {
    return createContinuationQualification({
      status: "off",
      reason: "flag_off",
      availableGroupCount,
      plannedGroupCount: 0,
    })
  }

  const continuationPlan = manifestMatch.continuationPlan.map((chunk) => ({
    startSec: chunk.startSec,
    durationSec: chunk.durationSec,
    endSec: chunk.startSec + chunk.durationSec,
    label: chunk.label,
  }))

  if (!continuationPlan.length) {
    return createContinuationQualification({
      status: "fallback",
      reason: "no_continuation_plan",
      availableGroupCount,
      sourceGroups,
    })
  }

  if (sourceGroups.some((groups) => groups.length === 0)) {
    return createContinuationQualification({
      status: "fallback",
      reason: "missing_source_chunks",
      availableGroupCount,
      sourceGroups,
    })
  }

  if (sourceGroups.some((groups) => groups.length !== continuationPlan.length)) {
    return createContinuationQualification({
      status: "fallback",
      reason: "source_chunk_count_mismatch",
      availableGroupCount,
      sourceGroups,
    })
  }

  const referenceSampleRate = manifestMatch.sources[0]?.sampleRate
  const referenceChannels = manifestMatch.sources[0]?.channels
  if (
    manifestMatch.sources.some(
      (source) =>
        (typeof referenceSampleRate === "number" &&
          typeof source.sampleRate === "number" &&
          source.sampleRate !== referenceSampleRate) ||
        (typeof referenceChannels === "number" && typeof source.channels === "number" && source.channels !== referenceChannels)
    )
  ) {
    return createContinuationQualification({
      status: "fallback",
      reason: "source_layout_mismatch",
      availableGroupCount,
      sourceGroups,
    })
  }

  for (let groupIndex = 0; groupIndex < continuationPlan.length; groupIndex += 1) {
    const planChunk = continuationPlan[groupIndex]
    if (!planChunk) continue
    if (groupIndex === 0) {
      const startupDelta = planChunk.startSec - startupDurationSec
      if (startupDelta > CONTINUATION_TOLERANCE_SEC) {
        return createContinuationQualification({
          status: "fallback",
          reason: "chunk_gap_after_startup",
          availableGroupCount,
          sourceGroups,
        })
      }
      if (startupDelta < -CONTINUATION_TOLERANCE_SEC) {
        return createContinuationQualification({
          status: "fallback",
          reason: "chunk_before_startup_end",
          availableGroupCount,
          sourceGroups,
        })
      }
    } else {
      const previousChunk = continuationPlan[groupIndex - 1]
      if (previousChunk) {
        const coverageDelta = planChunk.startSec - previousChunk.endSec
        if (coverageDelta > CONTINUATION_TOLERANCE_SEC) {
          return createContinuationQualification({
            status: "fallback",
            reason: "chunk_gap",
            availableGroupCount,
            sourceGroups,
          })
        }
        if (coverageDelta < -CONTINUATION_TOLERANCE_SEC) {
          return createContinuationQualification({
            status: "fallback",
            reason: "chunk_overlap",
            availableGroupCount,
            sourceGroups,
          })
        }
      }
    }

    for (let sourceIndex = 0; sourceIndex < sourceGroups.length; sourceIndex += 1) {
      const groups = sourceGroups[sourceIndex]
      const sourceChunk = groups?.[groupIndex]
      if (!sourceChunk) {
        return createContinuationQualification({
          status: "fallback",
          reason: "missing_source_chunks",
          availableGroupCount,
          sourceGroups,
        })
      }
      if (
        diffExceedsTolerance(sourceChunk.startSec, planChunk.startSec) ||
        diffExceedsTolerance(sourceChunk.durationSec, planChunk.durationSec)
      ) {
        return createContinuationQualification({
          status: "fallback",
          reason: "chunk_alignment_mismatch",
          availableGroupCount,
          sourceGroups,
        })
      }

      const estimatedTotalDurationSec = manifestMatch.sources[sourceIndex]?.estimatedTotalDurationSec
      if (
        typeof estimatedTotalDurationSec === "number" &&
        Number.isFinite(estimatedTotalDurationSec) &&
        sourceChunk.endSec > estimatedTotalDurationSec + CONTINUATION_TOLERANCE_SEC
      ) {
        return createContinuationQualification({
          status: "fallback",
          reason: "coverage_beyond_estimated_duration",
          availableGroupCount,
          sourceGroups,
        })
      }
    }
  }

  return createContinuationQualification({
    status: "qualified",
    reason: null,
    availableGroupCount,
    plannedGroupCount: continuationPlan.length,
    coverageEndSec: continuationPlan[continuationPlan.length - 1]?.endSec ?? null,
    sourceGroups,
  })
}
