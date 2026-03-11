"use client"

const APPENDABLE_QUEUE_TARGET_PREVIEW_PREFIX = "multitrack_appendable_queue_target:"
const APPENDABLE_QUEUE_TARGET_STORAGE_KEY = "rr_audio_appendable_queue_activation_targets"

export type AppendablePilotActivationState = {
  activationConfigured: boolean
  activationAllowed: boolean
  matchedTarget: string | null
  configuredTargets: string[]
  currentTargets: string[]
}

type ResolveAppendablePilotActivationInput = {
  trackScopeId: string
  activationTargets?: Array<string | null | undefined>
}

function normalizeActivationTarget(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase()
}

function parseActivationTargets(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[\n,]/)
    .map((item) => normalizeActivationTarget(item))
    .filter(Boolean)
}

function readPreviewFlagTargets(prefix: string): string[] {
  if (typeof document === "undefined") return []
  const cookieName = "rr_preview_flags"
  const prefixCookie = `${cookieName}=`
  const rawCookie = document.cookie
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(prefixCookie))
  if (!rawCookie) return []
  const rawValue = rawCookie.slice(prefixCookie.length)
  let decoded = rawValue
  try {
    decoded = decodeURIComponent(rawValue)
  } catch {}
  return decoded
    .split(",")
    .map((item) => normalizeActivationTarget(item))
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice(prefix.length))
    .filter(Boolean)
}

function uniqueTargets(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeActivationTarget(value)).filter(Boolean)))
}

export function resolveClientAppendablePilotActivation({
  trackScopeId,
  activationTargets = [],
}: ResolveAppendablePilotActivationInput): AppendablePilotActivationState {
  const configuredTargets = uniqueTargets([
    ...parseActivationTargets(process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_ACTIVATION_TARGETS),
    ...readPreviewFlagTargets(APPENDABLE_QUEUE_TARGET_PREVIEW_PREFIX),
    ...(typeof window !== "undefined"
      ? parseActivationTargets(window.localStorage.getItem(APPENDABLE_QUEUE_TARGET_STORAGE_KEY))
      : []),
  ])
  const currentTargets = uniqueTargets([trackScopeId, ...activationTargets])
  const activationConfigured = configuredTargets.length > 0
  const allowAll = configuredTargets.includes("*") || configuredTargets.includes("all")
  const matchedTarget = allowAll ? "*" : currentTargets.find((target) => configuredTargets.includes(target)) ?? null

  return {
    activationConfigured,
    activationAllowed: !activationConfigured || !!matchedTarget,
    matchedTarget,
    configuredTargets,
    currentTargets,
  }
}
