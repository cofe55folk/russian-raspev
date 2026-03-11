"use client"

type StartupManifestSource = {
  strategy?: "handoff" | "splice"
  src: string
  startupSrc: string
  startupDurationSec?: number
  tailSrc?: string
  tailStartSec?: number
  tailDurationSec?: number
  estimatedTotalDurationSec?: number
  channels?: number
  sampleRate?: number
}

type StartupManifestTrack = {
  slug: string
  sources: StartupManifestSource[]
}

type StartupManifest = {
  tracks?: StartupManifestTrack[]
}

export type AppendableStartupManifestMatch = {
  slug: string
  sources: StartupManifestSource[]
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
  const normalizedTrackSources = tracks.map((track) => normalizePublicAssetPath(track.src))

  for (const track of candidates) {
    if (!Array.isArray(track.sources) || track.sources.length !== normalizedTrackSources.length) continue
    const matches = track.sources.every((source, index) => {
      return normalizePublicAssetPath(source.src) === normalizedTrackSources[index]
    })
    if (!matches) continue
    return {
      slug: typeof track.slug === "string" ? track.slug : "",
      sources: track.sources.map((source) => ({
        strategy: source.strategy ?? "splice",
        src: normalizePublicAssetPath(source.src),
        startupSrc: normalizePublicAssetPath(source.startupSrc),
        startupDurationSec: source.startupDurationSec,
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
