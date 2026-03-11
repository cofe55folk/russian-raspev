"use client"

type StartupManifestContinuationPlanEntry = {
  startSec?: number
  durationSec?: number
  label?: string
}

export type AppendableStartupManifestContinuationChunk = {
  src: string
  startSec?: number
  durationSec?: number
  label?: string | null
}

export type AppendableStartupManifestSource = {
  strategy?: "handoff" | "splice"
  src: string
  startupSrc: string
  startupDurationSec?: number
  continuationChunks?: AppendableStartupManifestContinuationChunk[]
  tailSrc?: string
  tailStartSec?: number
  tailDurationSec?: number
  estimatedTotalDurationSec?: number
  channels?: number
  sampleRate?: number
}

type StartupManifestTrack = {
  slug: string
  sources: AppendableStartupManifestSource[]
}

type StartupManifest = {
  continuationChunks?: StartupManifestContinuationPlanEntry[]
  tracks?: StartupManifestTrack[]
}

export type AppendableStartupManifestMatch = {
  slug: string
  continuationPlan: Array<{
    startSec: number
    durationSec: number
    label: string | null
  }>
  sources: AppendableStartupManifestSource[]
}

const STARTUP_MANIFEST_PATH = "/audio-startup/startup-chunks-manifest.json"

let startupManifestPromise: Promise<StartupManifest | null> | null = null

export function normalizePublicAssetPath(path: string): string {
  const trimmed = path.trim()
  const withoutPublic = trimmed.replace(/^public(?=\/)/, "")
  if (!withoutPublic) return ""
  return withoutPublic.startsWith("/") ? withoutPublic : `/${withoutPublic}`
}

async function loadStartupManifest(): Promise<StartupManifest | null> {
  if (startupManifestPromise) return startupManifestPromise
  startupManifestPromise = (async () => {
    try {
      const response = await fetch(STARTUP_MANIFEST_PATH, { cache: "force-cache" })
      if (!response.ok) return null
      return (await response.json()) as StartupManifest
    } catch {
      return null
    }
  })()
  return startupManifestPromise
}

export async function resolveAppendableStartupManifestMatch(
  tracks: Array<{ src: string }>
): Promise<AppendableStartupManifestMatch | null> {
  if (!tracks.length) return null
  const manifest = await loadStartupManifest()
  const candidates = Array.isArray(manifest?.tracks) ? manifest.tracks : []
  const continuationPlan = Array.isArray(manifest?.continuationChunks)
    ? manifest.continuationChunks
        .filter(
          (entry): entry is { startSec?: number; durationSec?: number; label?: string } =>
            !!entry &&
            typeof entry.startSec === "number" &&
            Number.isFinite(entry.startSec) &&
            entry.startSec >= 0 &&
            typeof entry.durationSec === "number" &&
            Number.isFinite(entry.durationSec) &&
            entry.durationSec > 0
        )
        .map((entry) => ({
          startSec: entry.startSec as number,
          durationSec: entry.durationSec as number,
          label: typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : null,
        }))
    : []
  const normalizedTrackSources = tracks.map((track) => normalizePublicAssetPath(track.src))

  for (const track of candidates) {
    if (!Array.isArray(track.sources) || track.sources.length !== normalizedTrackSources.length) continue
    const matches = track.sources.every((source, index) => {
      return normalizePublicAssetPath(source.src) === normalizedTrackSources[index]
    })
    if (!matches) continue
    return {
      slug: typeof track.slug === "string" ? track.slug : "",
      continuationPlan,
      sources: track.sources.map((source) => ({
        strategy: source.strategy ?? "splice",
        src: normalizePublicAssetPath(source.src),
        startupSrc: normalizePublicAssetPath(source.startupSrc),
        startupDurationSec: source.startupDurationSec,
        continuationChunks: Array.isArray(source.continuationChunks)
          ? source.continuationChunks
              .filter(
                (chunk): chunk is AppendableStartupManifestContinuationChunk =>
                  !!chunk && typeof chunk.src === "string" && chunk.src.trim().length > 0
              )
              .map((chunk) => ({
                src: normalizePublicAssetPath(chunk.src),
                startSec: chunk.startSec,
                durationSec: chunk.durationSec,
                label: typeof chunk.label === "string" && chunk.label.trim().length > 0 ? chunk.label.trim() : null,
              }))
          : undefined,
        tailSrc: typeof source.tailSrc === "string" ? normalizePublicAssetPath(source.tailSrc) : undefined,
        tailStartSec: source.tailStartSec,
        tailDurationSec: source.tailDurationSec,
        estimatedTotalDurationSec: source.estimatedTotalDurationSec,
        channels: source.channels,
        sampleRate: source.sampleRate,
      })),
    }
  }

  return null
}

export async function listAppendableStartupManifestSlugs(): Promise<string[]> {
  const manifest = await loadStartupManifest()
  const candidates = Array.isArray(manifest?.tracks) ? manifest.tracks : []
  return Array.from(
    new Set(
      candidates
        .map((track) => (typeof track.slug === "string" ? track.slug.trim().toLowerCase() : ""))
        .filter(Boolean)
    )
  )
}
