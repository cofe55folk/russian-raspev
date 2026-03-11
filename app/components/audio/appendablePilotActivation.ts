"use client"

const APPENDABLE_QUEUE_TARGET_PREVIEW_PREFIX = "multitrack_appendable_queue_target:"
const APPENDABLE_QUEUE_TARGET_STORAGE_KEY = "rr_audio_appendable_queue_activation_targets"
const APPENDABLE_QUEUE_SAFE_ROLLOUT_PREVIEW_PREFIX = "multitrack_appendable_queue_safe_rollout:"
const APPENDABLE_QUEUE_SAFE_ROLLOUT_STORAGE_KEY = "rr_audio_appendable_queue_safe_rollout_targets"

export type AppendablePilotActivationMode = "unscoped" | "targeted_pilot" | "safe_rollout"

export type AppendablePilotActivationState = {
  activationConfigured: boolean
  activationAllowed: boolean
  matchedTarget: string | null
  configuredTargets: string[]
  targetedPilotConfiguredTargets: string[]
  safeRolloutConfiguredTargets: string[]
  currentTargets: string[]
  activationMode: AppendablePilotActivationMode
  tempoControlUnlocked: boolean
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

function readClientStoredTargets(storageKey: string): string[] {
  if (typeof window === "undefined") return []
  return parseActivationTargets(window.localStorage.getItem(storageKey))
}

function writeClientStoredTargets(storageKey: string, targets: string[]): string[] {
  if (typeof window === "undefined") return []
  const nextTargets = uniqueTargets(targets)
  if (nextTargets.length) {
    window.localStorage.setItem(storageKey, nextTargets.join(","))
  } else {
    window.localStorage.removeItem(storageKey)
  }
  return nextTargets
}

export function addClientAppendableSafeRolloutTarget(target: string): string[] {
  return writeClientStoredTargets(APPENDABLE_QUEUE_SAFE_ROLLOUT_STORAGE_KEY, [
    ...readClientStoredTargets(APPENDABLE_QUEUE_SAFE_ROLLOUT_STORAGE_KEY),
    target,
  ])
}

export function removeClientAppendableSafeRolloutTarget(target: string): string[] {
  const normalizedTarget = normalizeActivationTarget(target)
  return writeClientStoredTargets(
    APPENDABLE_QUEUE_SAFE_ROLLOUT_STORAGE_KEY,
    readClientStoredTargets(APPENDABLE_QUEUE_SAFE_ROLLOUT_STORAGE_KEY).filter((entry) => entry !== normalizedTarget)
  )
}

export function resolveClientAppendablePilotActivation({
  trackScopeId,
  activationTargets = [],
}: ResolveAppendablePilotActivationInput): AppendablePilotActivationState {
  const targetedPilotConfiguredTargets = uniqueTargets([
    ...parseActivationTargets(process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_ACTIVATION_TARGETS),
    ...readPreviewFlagTargets(APPENDABLE_QUEUE_TARGET_PREVIEW_PREFIX),
    ...(typeof window !== "undefined"
      ? parseActivationTargets(window.localStorage.getItem(APPENDABLE_QUEUE_TARGET_STORAGE_KEY))
      : []),
  ])
  const safeRolloutConfiguredTargets = uniqueTargets([
    ...parseActivationTargets(process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_SAFE_ROLLOUT_TARGETS),
    ...readPreviewFlagTargets(APPENDABLE_QUEUE_SAFE_ROLLOUT_PREVIEW_PREFIX),
    ...readClientStoredTargets(APPENDABLE_QUEUE_SAFE_ROLLOUT_STORAGE_KEY),
  ])
  const configuredTargets = uniqueTargets([...targetedPilotConfiguredTargets, ...safeRolloutConfiguredTargets])
  const currentTargets = uniqueTargets([trackScopeId, ...activationTargets])
  const activationConfigured = configuredTargets.length > 0
  const allowAllTargeted =
    targetedPilotConfiguredTargets.includes("*") || targetedPilotConfiguredTargets.includes("all")
  const allowAllSafe = safeRolloutConfiguredTargets.includes("*") || safeRolloutConfiguredTargets.includes("all")
  const targetedPilotMatch = allowAllTargeted
    ? "*"
    : currentTargets.find((target) => targetedPilotConfiguredTargets.includes(target)) ?? null
  const safeRolloutMatch = targetedPilotMatch
    ? null
    : allowAllSafe
      ? "*"
      : currentTargets.find((target) => safeRolloutConfiguredTargets.includes(target)) ?? null
  const matchedTarget = targetedPilotMatch ?? safeRolloutMatch
  const activationMode: AppendablePilotActivationMode = targetedPilotMatch
    ? "targeted_pilot"
    : safeRolloutMatch
      ? "safe_rollout"
      : "unscoped"

  return {
    activationConfigured,
    activationAllowed: !activationConfigured || !!matchedTarget,
    matchedTarget,
    configuredTargets,
    targetedPilotConfiguredTargets,
    safeRolloutConfiguredTargets,
    currentTargets,
    activationMode,
    tempoControlUnlocked: activationMode !== "safe_rollout",
  }
}
