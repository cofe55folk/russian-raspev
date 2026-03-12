"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  createAppendableQueueEngine,
  createManualAppendablePcmSource,
  sliceAudioBufferToChunk,
  type AppendableQueueDebugStats,
  type ManualAppendablePcmSourceController,
} from "../components/audio/appendableQueueEngine"
import {
  createAppendableQueueMultitrackCoordinator,
  type AppendableQueueMultitrackCoordinator,
} from "../components/audio/appendableQueueMultitrackCoordinator"
import type { SoundTouchEngine } from "../components/audio/soundtouchEngine"
import {
  appendAudioDebugCaptureSamples,
  getAudioDebugCaptureArtifactSnapshot,
  initAudioDebugCaptureStore,
  recordAudioDebugCaptureClick,
  resetAudioDebugCaptureStore,
  type AudioDebugCaptureArtifact,
} from "../lib/audioDebugCaptureStore"

type AppendableQueueLabStemSnapshot = {
  stemIndex: number
  label: string
  engineInstanceId: number | null
  currentSec: number
  startupAppended: boolean
  fullAppended: boolean
  fullDecoded: boolean
  sourceBufferedUntilSec: number
  sourceQueuedSegments: number
  sourceEnded: boolean
  stats: AppendableQueueDebugStats | null
}

type AppendableQueueLabSyncSnapshot = {
  stemDriftSec: number
  transportDriftSec: number
  minLeadSec: number
  maxLeadSec: number
  minObservedLeadSec: number
  maxObservedLeadSec: number
  minLowWaterSec: number
  maxHighWaterSec: number
  minRefillTriggerSec: number
  totalUnderrunFrames: number
  totalDiscontinuityCount: number
  totalLowWaterBreachCount: number
  totalHighWaterBreachCount: number
  totalOverflowDropCount: number
  totalOverflowDroppedFrames: number
}

type AppendableQueueLabSnapshot = {
  ready: boolean
  playing: boolean
  tempo: number
  pitchSemitones: number
  supportsIndependentPitch: boolean
  dataPlaneMode: string | null
  controlPlaneMode: string | null
  preferredDataPlaneMode: string | null
  sabCapable: boolean | null
  sabReady: boolean | null
  crossOriginIsolated: boolean | null
  sabRequirement: string | null
  sampleRates: number[]
  totalAppendMessages: number
  totalAppendedBytes: number
  trackLabel: string
  stemCount: number
  transportSec: number
  startupDurationSec: number
  durationSec: number
  harnessInstanceId: number | null
  contextState: AudioContextState | "unavailable"
  allStartupAppended: boolean
  allFullDecoded: boolean
  allFullAppended: boolean
  stems: AppendableQueueLabStemSnapshot[]
  sync: AppendableQueueLabSyncSnapshot
  error: string | null
}

const LISTENING_SCENARIOS = {
  boundary: {
    label: "Boundary",
    instruction: "Listen at startup -> full handoff for seam, click, or sudden image shift.",
  },
  late_append: {
    label: "Late Append",
    instruction: "Listen for transient wobble, one-sided drop, or boundary turbulence after delayed append.",
  },
  seek_loop: {
    label: "Seek Loop",
    instruction: "Listen for gate pumping, zipper noise, or re-entry drift after repeated seek/rebase moves.",
  },
} as const

type ListeningScenarioId = keyof typeof LISTENING_SCENARIOS
type ListeningScenarioStatus = "pending" | "pass" | "fail"

type AppendableQueueListeningScenarioReport = {
  status: ListeningScenarioStatus
  notes: string
  capturedAt: string | null
  snapshot: AppendableQueueLabSnapshot | null
}

type AppendableQueueListeningReport = {
  version: 1
  updatedAt: string | null
  activeScenarioId: ListeningScenarioId | null
  scenarios: Record<ListeningScenarioId, AppendableQueueListeningScenarioReport>
}

type BoundaryAbPreviewMode = "idle" | "appendable_queue" | "source_reference"

type BoundaryAbPreviewState = {
  mode: BoundaryAbPreviewMode
  startSec: number
  durationSec: number
  updatedAt: string | null
  lastCompletedMode: Exclude<BoundaryAbPreviewMode, "idle"> | null
}

type AppendableQueueDebugApi = {
  play: () => Promise<void>
  pause: () => void
  setTempo: (tempo: number) => number
  setPitchSemitones: (semitones: number) => number
  seek: (sec: number) => number
  rebase: (sec: number) => number
  suspendContext: () => Promise<AudioContextState | "unavailable">
  resumeContext: () => Promise<AudioContextState | "unavailable">
  reset: () => void
  appendStartup: () => number
  appendStartupStem: (stemIndex: number) => boolean
  appendFullRemainder: () => number
  appendFullRemainderStem: (stemIndex: number) => number
  appendFullFrom: (sec: number) => number
  appendFullFromStem: (stemIndex: number, sec: number) => number
  stageBoundaryScenario: () => void
  stageLateAppendScenario: () => void
  playBoundaryQueueABPreview: () => Promise<void>
  playBoundaryReferenceABPreview: () => Promise<void>
  stopBoundaryABPreview: () => void
  getBoundaryABPreviewState: () => BoundaryAbPreviewState
  runBoundaryCaptureScenario: () => Promise<AudioDebugCaptureArtifact | null>
  runSeekLoopScenario: () => Promise<void>
  runLongSoakScenario: (targetSec?: number) => Promise<void>
  runInterruptionLoopScenario: () => Promise<void>
  getState: () => AppendableQueueLabSnapshot
  getListeningReport: () => AppendableQueueListeningReport
  captureOutputArtifact: () => Promise<AudioDebugCaptureArtifact | null>
  getOutputCaptureArtifact: () => AudioDebugCaptureArtifact | null
}

type HarnessStemState = {
  index: number
  label: string
  engineInstanceId: number
  engine: SoundTouchEngine
  outputGain: GainNode
  sourceController: ManualAppendablePcmSourceController
  startupBuffer: AudioBuffer
  startupFrames: number
  fullBuffer: AudioBuffer | null
  startupAppended: boolean
  fullAppended: boolean
  fullDecoded: boolean
  lastStats: AppendableQueueDebugStats | null
}

type HarnessRefState = {
  ctx: AudioContext
  masterGain: GainNode
  masterTapNode: AudioWorkletNode | null
  coordinator: AppendableQueueMultitrackCoordinator
  trackLabel: string
  durationFrames: number
  durationSec: number
  startupFrames: number
  harnessInstanceId: number
  stems: HarnessStemState[]
}

type StartupManifestSource = {
  src: string
  startupSrc: string
  startupDurationSec?: number
  estimatedTotalDurationSec?: number
}

type StartupManifestTrack = {
  slug: string
  sources: StartupManifestSource[]
}

type StartupManifest = {
  tracks: StartupManifestTrack[]
}

type AppendableQueueLabAsset = {
  slug: string
  sourceIndex: number
  label: string
  fullSrc: string
  startupSrc: string
  startupDurationSec: number
  estimatedTotalDurationSec: number
}

type AppendableQueueLabTrack = {
  slug: string
  label: string
  assets: AppendableQueueLabAsset[]
  startupDurationSec: number
  estimatedTotalDurationSec: number
}

declare global {
  interface Window {
    __rrAppendableQueueDebug?: AppendableQueueDebugApi
    webkitAudioContext?: typeof AudioContext
  }
}

const DEFAULT_TRACK_SLUG = "terek-ne-vo-daleche"
const DEFAULT_SOURCE_INDICES = [0, 1]
const STEM_OUTPUT_GAIN = 0.48
const MASTER_OUTPUT_GAIN = 0.86
const SHARED_TICK_MS = 20
const SNAPSHOT_TICK_MS = 120
const LISTENING_REPORT_STORAGE_KEY = "rr_appendable_queue_listening_report_v1"
const MASTER_TAP_WORKLET_PATH = "/worklets/audio-debug-master-tap.js"
const BOUNDARY_AB_PREVIEW_LEADIN_SEC = 0.25
const BOUNDARY_AB_PREVIEW_DURATION_SEC = 1.25
const masterTapModulePromiseByCtx = new WeakMap<AudioContext, Promise<void>>()

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

function normalizePublicAssetPath(path: string) {
  const trimmed = path.trim()
  if (trimmed.startsWith("public/")) return `/${trimmed.slice("public/".length)}`
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function createEmptySyncSnapshot(): AppendableQueueLabSyncSnapshot {
  return {
    stemDriftSec: 0,
    transportDriftSec: 0,
    minLeadSec: 0,
    maxLeadSec: 0,
    minObservedLeadSec: 0,
    maxObservedLeadSec: 0,
    minLowWaterSec: 0,
    maxHighWaterSec: 0,
    minRefillTriggerSec: 0,
    totalUnderrunFrames: 0,
    totalDiscontinuityCount: 0,
    totalLowWaterBreachCount: 0,
    totalHighWaterBreachCount: 0,
    totalOverflowDropCount: 0,
    totalOverflowDroppedFrames: 0,
  }
}

function createUnavailableSnapshot(error: string | null = null): AppendableQueueLabSnapshot {
  return {
    ready: false,
    playing: false,
    tempo: 1,
    pitchSemitones: 0,
    supportsIndependentPitch: false,
    dataPlaneMode: null,
    controlPlaneMode: null,
    preferredDataPlaneMode: null,
    sabCapable: null,
    sabReady: null,
    crossOriginIsolated: null,
    sabRequirement: null,
    sampleRates: [],
    totalAppendMessages: 0,
    totalAppendedBytes: 0,
    trackLabel: "loading...",
    stemCount: 0,
    transportSec: 0,
    startupDurationSec: 0,
    durationSec: 0,
    harnessInstanceId: null,
    contextState: "unavailable",
    allStartupAppended: false,
    allFullDecoded: false,
    allFullAppended: false,
    stems: [],
    sync: createEmptySyncSnapshot(),
    error,
  }
}

function createListeningReport(): AppendableQueueListeningReport {
  return {
    version: 1,
    updatedAt: null,
    activeScenarioId: null,
    scenarios: {
      boundary: { status: "pending", notes: "", capturedAt: null, snapshot: null },
      late_append: { status: "pending", notes: "", capturedAt: null, snapshot: null },
      seek_loop: { status: "pending", notes: "", capturedAt: null, snapshot: null },
    },
  }
}

function createBoundaryAbPreviewState(): BoundaryAbPreviewState {
  return {
    mode: "idle",
    startSec: 0,
    durationSec: 0,
    updatedAt: null,
    lastCompletedMode: null,
  }
}

function cloneSnapshot(snapshot: AppendableQueueLabSnapshot): AppendableQueueLabSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AppendableQueueLabSnapshot
}

function restoreListeningReport(rawValue: string | null): AppendableQueueListeningReport | null {
  if (!rawValue) return null
  try {
    const parsed = JSON.parse(rawValue) as Partial<AppendableQueueListeningReport>
    const base = createListeningReport()
    if (typeof parsed.updatedAt === "string") base.updatedAt = parsed.updatedAt
    if (parsed.activeScenarioId && parsed.activeScenarioId in LISTENING_SCENARIOS) {
      base.activeScenarioId = parsed.activeScenarioId as ListeningScenarioId
    }

    for (const scenarioId of Object.keys(LISTENING_SCENARIOS) as ListeningScenarioId[]) {
      const parsedScenario = parsed.scenarios?.[scenarioId]
      if (!parsedScenario) continue
      base.scenarios[scenarioId] = {
        status:
          parsedScenario.status === "pass" || parsedScenario.status === "fail" ? parsedScenario.status : "pending",
        notes: typeof parsedScenario.notes === "string" ? parsedScenario.notes : "",
        capturedAt: typeof parsedScenario.capturedAt === "string" ? parsedScenario.capturedAt : null,
        snapshot: parsedScenario.snapshot ? (parsedScenario.snapshot as AppendableQueueLabSnapshot) : null,
      }
    }
    return base
  } catch {
    return null
  }
}

function buildListeningSummary(report: AppendableQueueListeningReport) {
  const lines = [
    `activeScenario: ${report.activeScenarioId ?? "-"}`,
    `updatedAt: ${report.updatedAt ?? "-"}`,
  ]
  for (const scenarioId of Object.keys(LISTENING_SCENARIOS) as ListeningScenarioId[]) {
    const scenario = report.scenarios[scenarioId]
    lines.push(
      `${scenarioId}: ${scenario.status} | capturedAt=${scenario.capturedAt ?? "-"} | notes=${scenario.notes || "-"}`
    )
  }
  return lines.join("\n")
}

function pickLabTrack(manifest: StartupManifest, search: string): AppendableQueueLabTrack {
  const params = new URLSearchParams(search)
  const requestedSlug = params.get("slug")?.trim() || DEFAULT_TRACK_SLUG
  const sourceIndices = Array.from(
    new Set(
      (params.get("sources") ?? DEFAULT_SOURCE_INDICES.join(","))
        .split(",")
        .map((entry) => Number.parseInt(entry.trim(), 10))
        .filter((value) => Number.isFinite(value) && value >= 0)
    )
  )
  const candidateTracks = manifest.tracks.filter((entry) => entry.sources.length >= 2)
  const track =
    candidateTracks.find((entry) => entry.slug === requestedSlug) ??
    candidateTracks.find((entry) => entry.slug === DEFAULT_TRACK_SLUG) ??
    candidateTracks[0]
  if (!track || track.sources.length < 2) {
    throw new Error("appendable queue multitrack lab requires a manifest track with at least two sources")
  }

  const resolvedIndices = sourceIndices
    .filter((index) => index >= 0 && index < track.sources.length)
    .concat(DEFAULT_SOURCE_INDICES)
    .concat(track.sources.map((_, index) => index))
    .filter((index, position, entries) => entries.indexOf(index) === position)
    .slice(0, 2)
  if (resolvedIndices.length < 2) {
    throw new Error("appendable queue multitrack lab could not resolve two source indices")
  }

  const assets = resolvedIndices.map((sourceIndex) => {
    const source = track.sources[sourceIndex]
    return {
      slug: track.slug,
      sourceIndex,
      label: `${track.slug} #${sourceIndex + 1}`,
      fullSrc: normalizePublicAssetPath(source.src),
      startupSrc: normalizePublicAssetPath(source.startupSrc),
      startupDurationSec: Math.max(0.1, Number(source.startupDurationSec) || 10),
      estimatedTotalDurationSec: Math.max(
        Number(source.startupDurationSec) || 10,
        Number(source.estimatedTotalDurationSec) || Number(source.startupDurationSec) || 10
      ),
    }
  })

  return {
    slug: track.slug,
    label: `${track.slug} (${resolvedIndices.map((index) => `#${index + 1}`).join(" + ")})`,
    assets,
    startupDurationSec: Math.max(...assets.map((asset) => asset.startupDurationSec)),
    estimatedTotalDurationSec: Math.max(...assets.map((asset) => asset.estimatedTotalDurationSec)),
  }
}

async function fetchJson<T>(src: string): Promise<T> {
  const response = await fetch(src)
  if (!response.ok) {
    throw new Error(`failed to fetch ${src} (${response.status})`)
  }
  return (await response.json()) as T
}

async function fetchDecodeAudioBuffer(ctx: AudioContext, src: string): Promise<AudioBuffer> {
  const response = await fetch(src)
  if (!response.ok) {
    throw new Error(`failed to fetch ${src} (${response.status})`)
  }
  const bytes = await response.arrayBuffer()
  return ctx.decodeAudioData(bytes.slice(0))
}

function formatNumber(value: number | null | undefined, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-"
  return value.toFixed(digits)
}

function ensureMasterTapWorkletModule(ctx: AudioContext): Promise<void> {
  const existing = masterTapModulePromiseByCtx.get(ctx)
  if (existing) return existing
  const promise = ctx.audioWorklet.addModule(MASTER_TAP_WORKLET_PATH)
  masterTapModulePromiseByCtx.set(ctx, promise)
  return promise
}

function disposeHarnessResources(
  ctx: AudioContext | null | undefined,
  masterGain: GainNode | null | undefined,
  masterTapNode: AudioWorkletNode | null,
  stems: HarnessStemState[] | null | undefined
) {
  for (const stem of Array.isArray(stems) ? stems : []) {
    try {
      stem.engine.destroy()
    } catch {}
    try {
      stem.outputGain.disconnect()
    } catch {}
  }
  try {
    masterGain?.disconnect()
  } catch {}
  try {
    if (masterTapNode) {
      masterTapNode.port.onmessage = null
      masterTapNode.disconnect()
    }
  } catch {}
  void ctx?.close().catch(() => {})
}

export default function AppendableQueueLabPage() {
  const harnessRef = useRef<HarnessRefState | null>(null)
  const outputCaptureArtifactRef = useRef<AudioDebugCaptureArtifact | null>(null)
  const outputCaptureFlushResolversRef = useRef(new Map<string, (ok: boolean) => void>())
  const listeningReportRef = useRef<AppendableQueueListeningReport>(createListeningReport())
  const boundaryAbPreviewRef = useRef<BoundaryAbPreviewState>(createBoundaryAbPreviewState())
  const boundaryAbPreviewRuntimeRef = useRef<{
    mode: BoundaryAbPreviewMode
    stopTimer: number | null
    sources: AudioBufferSourceNode[]
    gains: GainNode[]
  }>({
    mode: "idle",
    stopTimer: null,
    sources: [],
    gains: [],
  })
  const [snapshot, setSnapshot] = useState<AppendableQueueLabSnapshot>(createUnavailableSnapshot())
  const [listeningReport, setListeningReport] = useState<AppendableQueueListeningReport | null>(null)
  const [outputCaptureArtifact, setOutputCaptureArtifact] = useState<AudioDebugCaptureArtifact | null>(null)
  const [outputCaptureStatus, setOutputCaptureStatus] = useState("idle")
  const [boundaryAbPreview, setBoundaryAbPreview] = useState<BoundaryAbPreviewState>(createBoundaryAbPreviewState())

  const syncSnapshot = useCallback((nextError: string | null = null) => {
    const harness = harnessRef.current
    if (!harness) {
      setSnapshot((current) => ({
        ...current,
        ready: false,
        error: nextError ?? current.error,
      }))
      return
    }

    const coordinatorSnapshot = harness.coordinator.getSnapshot()

    setSnapshot({
      ready: true,
      playing: coordinatorSnapshot.playing,
      tempo: coordinatorSnapshot.tempo,
      pitchSemitones: coordinatorSnapshot.pitchSemitones,
      supportsIndependentPitch: coordinatorSnapshot.supportsIndependentPitch,
      dataPlaneMode: coordinatorSnapshot.dataPlaneMode,
      controlPlaneMode: coordinatorSnapshot.controlPlaneMode,
      preferredDataPlaneMode: coordinatorSnapshot.preferredDataPlaneMode,
      sabCapable: coordinatorSnapshot.sabCapable,
      sabReady: coordinatorSnapshot.sabReady,
      crossOriginIsolated: coordinatorSnapshot.crossOriginIsolated,
      sabRequirement: coordinatorSnapshot.sabRequirement,
      sampleRates: coordinatorSnapshot.sampleRates,
      totalAppendMessages: coordinatorSnapshot.totalAppendMessages,
      totalAppendedBytes: coordinatorSnapshot.totalAppendedBytes,
      trackLabel: harness.trackLabel,
      stemCount: coordinatorSnapshot.stemCount,
      transportSec: coordinatorSnapshot.transportSec,
      startupDurationSec: Number((harness.startupFrames / harness.ctx.sampleRate).toFixed(3)),
      durationSec: Number(harness.durationSec.toFixed(3)),
      harnessInstanceId: harness.harnessInstanceId,
      contextState: harness.ctx.state,
      allStartupAppended: coordinatorSnapshot.allStartupAppended,
      allFullDecoded: coordinatorSnapshot.allFullDecoded,
      allFullAppended: coordinatorSnapshot.allFullAppended,
      stems: coordinatorSnapshot.stems,
      sync: coordinatorSnapshot.sync,
      error: nextError,
    })
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    let cancelled = false
    let sharedTickTimer: number | null = null
    let snapshotTimer: number | null = null

    const init = async () => {
      const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext
      if (!AudioContextCtor || typeof AudioWorkletNode === "undefined") {
        syncSnapshot("AudioWorklet is unavailable in this browser")
        return
      }

      try {
        const ctx = new AudioContextCtor()
        const manifest = await fetchJson<StartupManifest>("/audio-startup/startup-chunks-manifest.json")
        const track = pickLabTrack(manifest, window.location.search)
        const startupBuffers = await Promise.all(track.assets.map((asset) => fetchDecodeAudioBuffer(ctx, asset.startupSrc)))
        const sampleRate = startupBuffers[0]?.sampleRate ?? 44100
        if (startupBuffers.some((buffer) => buffer.sampleRate !== sampleRate)) {
          throw new Error("appendable queue multitrack lab requires matching sample rates across startup stems")
        }

        const durationFrames = Math.max(1, Math.floor(track.estimatedTotalDurationSec * sampleRate))
        const startupFrames = Math.max(...startupBuffers.map((buffer) => Math.max(1, buffer.length)))
        const masterGain = ctx.createGain()
        masterGain.gain.value = MASTER_OUTPUT_GAIN
        let masterTapNode: AudioWorkletNode | null = null
        initAudioDebugCaptureStore(ctx.sampleRate)
        resetAudioDebugCaptureStore()
        setOutputCaptureArtifact(null)
        setOutputCaptureStatus("armed")
        try {
          await ensureMasterTapWorkletModule(ctx)
          masterTapNode = new AudioWorkletNode(ctx, "audio-debug-master-tap", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [Math.max(1, Number(ctx.destination.channelCount) || 2)],
            processorOptions: {
              channelCount: Math.max(1, Number(ctx.destination.channelCount) || 2),
              chunkFrames: 4096,
              clickThreshold: 0.045,
              clickCooldownFrames: Math.max(1024, Math.floor(ctx.sampleRate * 0.06)),
            },
          })
          masterTapNode.port.onmessage = (event: MessageEvent<unknown>) => {
            const data = event.data as
              | {
                  type?: string
                  frames?: number
                  samples?: ArrayBuffer
                  deltaAbs?: number
                  frameCursorFrames?: number
                  outputSec?: number
                  token?: string
                }
              | undefined
            if (!data || typeof data !== "object") return
            if (data.type === "chunk" && data.samples instanceof ArrayBuffer) {
              appendAudioDebugCaptureSamples(new Int16Array(data.samples))
              return
            }
            if (data.type === "click") {
              recordAudioDebugCaptureClick({
                ts: new Date().toISOString(),
                deltaAbs: Number((typeof data.deltaAbs === "number" ? data.deltaAbs : 0).toFixed(6)),
                frameCursorFrames:
                  typeof data.frameCursorFrames === "number" ? Math.max(0, Math.floor(data.frameCursorFrames)) : 0,
                outputSec: Number((typeof data.outputSec === "number" ? data.outputSec : 0).toFixed(6)),
                trackCurrentSec: harnessRef.current?.coordinator.getSnapshot().transportSec ?? null,
              })
              return
            }
            if (data.type === "flush_ack" && typeof data.token === "string") {
              const resolve = outputCaptureFlushResolversRef.current.get(data.token)
              if (!resolve) return
              outputCaptureFlushResolversRef.current.delete(data.token)
              resolve(true)
            }
          }
          masterGain.connect(masterTapNode)
          masterTapNode.connect(ctx.destination)
        } catch {
          masterTapNode = null
          masterGain.connect(ctx.destination)
          setOutputCaptureStatus("tap_fallback")
        }

        const builtStems: HarnessStemState[] = []
        for (let index = 0; index < track.assets.length; index += 1) {
          const asset = track.assets[index]
          const startupBuffer = startupBuffers[index]
          const sourceController = createManualAppendablePcmSource({
            sampleRate: startupBuffer.sampleRate,
            channelCount: startupBuffer.numberOfChannels,
            durationFrames,
          })
          const outputGain = ctx.createGain()
          outputGain.gain.value = STEM_OUTPUT_GAIN
          const engine = await createAppendableQueueEngine(ctx, sourceController.source, {
            enableIndependentPitch: true,
            externalTick: true,
            onStats: (stats) => {
              const current = harnessRef.current
              if (!current || current.ctx !== ctx) return
              const stem = current.stems[index]
              if (!stem) return
              stem.lastStats = stats
              syncSnapshot()
            },
          })
          engine.connect(outputGain)
          outputGain.connect(masterGain)
          builtStems.push({
            index,
            label: asset.label,
            engineInstanceId: Date.now() + index,
            engine,
            outputGain,
            sourceController,
            startupBuffer,
            startupFrames: Math.max(1, startupBuffer.length),
            fullBuffer: null,
            startupAppended: false,
            fullAppended: false,
            fullDecoded: false,
            lastStats: null,
          })
        }

        if (cancelled) {
          disposeHarnessResources(ctx, masterGain, masterTapNode, builtStems)
          return
        }

        const coordinator = createAppendableQueueMultitrackCoordinator({
          ctx,
          sampleRate,
          durationFrames,
          stems: builtStems.map((stem) => ({
            stemIndex: stem.index,
            label: stem.label,
            engine: stem.engine,
            engineInstanceId: stem.engineInstanceId,
            getLastStats: () => stem.lastStats,
            getSourceBufferedUntilSec: () => stem.sourceController.getState().bufferedUntilFrame / ctx.sampleRate,
            getSourceQueuedSegments: () => stem.sourceController.getState().queuedSegments,
            isSourceEnded: () => stem.sourceController.getState().ended,
            isStartupAppended: () => stem.startupAppended,
            isFullAppended: () => stem.fullAppended,
            isFullDecoded: () => stem.fullDecoded,
          })),
        })

        harnessRef.current = {
          ctx,
          masterGain,
          masterTapNode,
          coordinator,
          trackLabel: track.label,
          durationFrames,
          durationSec: durationFrames / sampleRate,
          startupFrames,
          harnessInstanceId: Date.now(),
          stems: builtStems,
        }

        const tickAll = (force = false) => {
          const current = harnessRef.current
          if (!current) return
          current.coordinator.tick({ force })
        }

        const appendStartupStem = (stemIndex: number) => {
          const current = harnessRef.current
          if (!current) return false
          const stem = current.stems[stemIndex]
          if (!stem || stem.startupAppended) return false
          const startupChunk = sliceAudioBufferToChunk(stem.startupBuffer, 0, stem.startupFrames, { final: false })
          if (!startupChunk) return false
          stem.sourceController.appendChunk(startupChunk)
          stem.startupAppended = true
          tickAll(true)
          syncSnapshot()
          return true
        }

        const appendStartup = () => {
          const current = harnessRef.current
          if (!current) return 0
          let appendedCount = 0
          for (const stem of current.stems) {
            if (appendStartupStem(stem.index)) appendedCount += 1
          }
          return appendedCount
        }

        const appendFullFromStem = (stemIndex: number, sec: number) => {
          const current = harnessRef.current
          if (!current) return 0
          const stem = current.stems[stemIndex]
          if (!stem?.fullBuffer) return 0
          const startFrame = clamp(Math.floor(sec * stem.fullBuffer.sampleRate), 0, stem.fullBuffer.length)
          const fullChunk = sliceAudioBufferToChunk(
            stem.fullBuffer,
            startFrame,
            Math.max(1, stem.fullBuffer.length - startFrame),
            { final: true }
          )
          if (!fullChunk) return 0
          stem.sourceController.appendChunk(fullChunk)
          stem.fullAppended = true
          stem.sourceController.markEnded()
          tickAll(true)
          syncSnapshot()
          return fullChunk.frameCount
        }

        const appendFullFrom = (sec: number) => {
          const current = harnessRef.current
          if (!current) return 0
          let totalFrames = 0
          for (const stem of current.stems) {
            totalFrames += appendFullFromStem(stem.index, sec)
          }
          return totalFrames
        }

        const getBoundaryPreviewWindow = () => {
          const current = harnessRef.current
          if (!current) {
            return {
              startSec: 0,
              durationSec: BOUNDARY_AB_PREVIEW_DURATION_SEC,
            }
          }
          const startupDurationSec = current.startupFrames / current.ctx.sampleRate
          const durationSec = Math.min(
            BOUNDARY_AB_PREVIEW_DURATION_SEC,
            Math.max(0.8, current.durationSec - startupDurationSec)
          )
          const startSec = clamp(
            startupDurationSec + BOUNDARY_AB_PREVIEW_LEADIN_SEC,
            0,
            Math.max(0, current.durationSec - durationSec - 0.05)
          )
          return {
            startSec: Number(startSec.toFixed(3)),
            durationSec: Number(durationSec.toFixed(3)),
          }
        }

        const stopBoundaryAbPreview = (completedMode?: Exclude<BoundaryAbPreviewMode, "idle"> | null) => {
          const current = harnessRef.current
          const runtime = boundaryAbPreviewRuntimeRef.current
          if (runtime.stopTimer != null) {
            window.clearTimeout(runtime.stopTimer)
            runtime.stopTimer = null
          }
          if (runtime.mode === "appendable_queue") {
            current?.coordinator.pause()
          }
          for (const source of runtime.sources) {
            try {
              source.stop()
            } catch {}
            try {
              source.disconnect()
            } catch {}
          }
          for (const gain of runtime.gains) {
            try {
              gain.disconnect()
            } catch {}
          }
          const nextCompletedMode =
            completedMode ?? (runtime.mode === "idle" ? null : runtime.mode)
          runtime.mode = "idle"
          runtime.sources = []
          runtime.gains = []
          setBoundaryAbPreview((state) => ({
            mode: "idle",
            startSec: state.startSec,
            durationSec: state.durationSec,
            updatedAt: new Date().toISOString(),
            lastCompletedMode: nextCompletedMode ?? state.lastCompletedMode,
          }))
          syncSnapshot()
        }

        const setTempo = (nextTempo: number) => {
          const current = harnessRef.current
          if (!current) return 1
          const appliedTempo = current.coordinator.setTempo(nextTempo)
          syncSnapshot()
          return appliedTempo
        }

        const setPitchSemitones = (nextPitchSemitones: number) => {
          const current = harnessRef.current
          if (!current) return 0
          const appliedPitchSemitones = current.coordinator.setPitchSemitones(nextPitchSemitones)
          syncSnapshot()
          return appliedPitchSemitones
        }

        const seekCommon = (sec: number, mode: "seek" | "rebase") => {
          const current = harnessRef.current
          if (!current) return 0
          const safeSec =
            mode === "rebase" ? current.coordinator.rebaseSeconds(sec) : current.coordinator.seekSeconds(sec)
          syncSnapshot()
          return safeSec
        }

        const play = async () => {
          const current = harnessRef.current
          if (!current) return
          if (boundaryAbPreviewRuntimeRef.current.mode === "source_reference") {
            stopBoundaryAbPreview()
          }
          appendStartup()
          if (current.ctx.state !== "running") {
            await current.ctx.resume()
          }
          current.coordinator.tick({ force: true })
          current.coordinator.start()
          syncSnapshot()
        }

        const pause = () => {
          const current = harnessRef.current
          if (!current) return
          if (boundaryAbPreviewRuntimeRef.current.mode !== "idle") {
            stopBoundaryAbPreview()
            return
          }
          current.coordinator.pause()
          syncSnapshot()
        }

        const reset = () => {
          const current = harnessRef.current
          if (!current) return
          stopBoundaryAbPreview()
          current.coordinator.pause()
          current.coordinator.setTempo(1)
          resetAudioDebugCaptureStore()
          setOutputCaptureArtifact(null)
          setOutputCaptureStatus("armed")
          for (const stem of current.stems) {
            stem.sourceController.clear()
            stem.startupAppended = false
            stem.fullAppended = false
            stem.lastStats = null
          }
          current.coordinator.seekSeconds(0)
          appendStartup()
          current.coordinator.tick({ force: true })
          syncSnapshot()
        }

        appendStartup()
        tickAll(true)

        for (let index = 0; index < track.assets.length; index += 1) {
          const asset = track.assets[index]
          void (async () => {
            try {
              const fullBuffer = await fetchDecodeAudioBuffer(ctx, asset.fullSrc)
              const current = harnessRef.current
              if (!current || current.ctx !== ctx) return
              const stem = current.stems[index]
              if (!stem) return
              stem.fullBuffer = fullBuffer
              stem.fullDecoded = true
              current.durationFrames = Math.max(current.durationFrames, fullBuffer.length)
              current.durationSec = Math.max(current.durationSec, fullBuffer.duration)
              syncSnapshot()
            } catch (error) {
              const current = harnessRef.current
              if (!current || current.ctx !== ctx) return
              syncSnapshot(error instanceof Error ? error.message : "full stem decode failed")
            }
          })()
        }

        const stageBoundaryScenario = () => {
          const current = harnessRef.current
          if (!current) return
          reset()
          current.stems.forEach((stem) => {
            appendFullFromStem(stem.index, stem.startupFrames / stem.startupBuffer.sampleRate)
          })
          syncSnapshot()
        }

        const stageLateAppendScenario = () => {
          reset()
          syncSnapshot()
        }

        const playBoundaryQueueABPreview = async () => {
          const current = harnessRef.current
          if (!current) return
          stopBoundaryAbPreview()
          stageBoundaryScenario()
          const { startSec, durationSec } = getBoundaryPreviewWindow()
          seekCommon(startSec, "rebase")
          if (current.ctx.state !== "running") {
            await current.ctx.resume()
          }
          current.coordinator.tick({ force: true })
          current.coordinator.start()
          boundaryAbPreviewRuntimeRef.current.mode = "appendable_queue"
          boundaryAbPreviewRuntimeRef.current.stopTimer = window.setTimeout(() => {
            stopBoundaryAbPreview("appendable_queue")
          }, Math.ceil((durationSec + 0.12) * 1000))
          setBoundaryAbPreview({
            mode: "appendable_queue",
            startSec,
            durationSec,
            updatedAt: new Date().toISOString(),
            lastCompletedMode: boundaryAbPreviewRef.current.lastCompletedMode,
          })
          syncSnapshot()
        }

        const playBoundaryReferenceABPreview = async () => {
          const current = harnessRef.current
          if (!current) return
          if (!current.stems.every((stem) => stem.fullBuffer)) {
            syncSnapshot("boundary source reference requires decoded full stems")
            return
          }
          stopBoundaryAbPreview()
          current.coordinator.pause()
          if (current.ctx.state !== "running") {
            await current.ctx.resume()
          }
          const { startSec, durationSec } = getBoundaryPreviewWindow()
          const runtime = boundaryAbPreviewRuntimeRef.current
          const sources: AudioBufferSourceNode[] = []
          const gains: GainNode[] = []
          for (const stem of current.stems) {
            if (!stem.fullBuffer) continue
            const source = current.ctx.createBufferSource()
            source.buffer = stem.fullBuffer
            const gain = current.ctx.createGain()
            gain.gain.value = STEM_OUTPUT_GAIN
            source.connect(gain)
            gain.connect(current.masterGain)
            source.start(0, startSec, durationSec)
            sources.push(source)
            gains.push(gain)
          }
          runtime.mode = "source_reference"
          runtime.sources = sources
          runtime.gains = gains
          runtime.stopTimer = window.setTimeout(() => {
            stopBoundaryAbPreview("source_reference")
          }, Math.ceil((durationSec + 0.12) * 1000))
          setBoundaryAbPreview({
            mode: "source_reference",
            startSec,
            durationSec,
            updatedAt: new Date().toISOString(),
            lastCompletedMode: boundaryAbPreviewRef.current.lastCompletedMode,
          })
          syncSnapshot()
        }

        const runSeekLoopScenario = async () => {
          stageBoundaryScenario()
          await play()
          const wait = (delayMs: number) =>
            new Promise<void>((resolve) => {
              window.setTimeout(resolve, delayMs)
            })
          await wait(700)
          seekCommon(6, "rebase")
          await wait(650)
          seekCommon(2.4, "seek")
          await wait(650)
          seekCommon(8.8, "rebase")
          await wait(650)
          seekCommon(4.2, "seek")
          syncSnapshot()
        }

        const suspendContext = async (): Promise<AudioContextState | "unavailable"> => {
          const current = harnessRef.current
          if (!current) return "unavailable"
          try {
            await current.ctx.suspend()
          } catch {}
          syncSnapshot()
          return current.ctx.state
        }

        const resumeContext = async (): Promise<AudioContextState | "unavailable"> => {
          const current = harnessRef.current
          if (!current) return "unavailable"
          try {
            await current.ctx.resume()
          } catch {}
          current.coordinator.tick({ force: true })
          syncSnapshot()
          return current.ctx.state
        }

        const waitForTransportAtLeast = (targetSec: number, timeoutMs = 20_000) =>
          new Promise<void>((resolve, reject) => {
            const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
            const tick = () => {
              const current = harnessRef.current
              if (!current) {
                reject(new Error("appendable queue harness unavailable"))
                return
              }
              const transportSec = current.coordinator.getSnapshot().transportSec
              if (transportSec >= targetSec) {
                resolve()
                return
              }
              const now = typeof performance !== "undefined" ? performance.now() : Date.now()
              if (now - startedAt > timeoutMs) {
                reject(new Error(`timed out waiting for transport >= ${targetSec}`))
                return
              }
              window.setTimeout(tick, 40)
            }
            tick()
          })

        const runBoundaryCaptureScenario = async () => {
          const current = harnessRef.current
          if (!current) return null
          stopBoundaryAbPreview()
          stageBoundaryScenario()
          setOutputCaptureStatus("auto_running")
          await play()
          const startupDurationSec = current.startupFrames / current.ctx.sampleRate
          await waitForTransportAtLeast(startupDurationSec + 1.2)
          setOutputCaptureStatus("auto_flushing")
          const artifact = await flushOutputCapture()
          pause()
          syncSnapshot()
          return artifact
        }

        const runLongSoakScenario = async (targetSec = 12) => {
          const current = harnessRef.current
          if (!current) return
          stageBoundaryScenario()
          await play()
          const startupDurationSec = current.startupFrames / current.ctx.sampleRate
          const safeTargetSec = clamp(startupDurationSec + Math.max(1, targetSec), 1, Math.max(1, current.durationSec - 0.35))
          await waitForTransportAtLeast(safeTargetSec, Math.max(20_000, Math.ceil((safeTargetSec + 4) * 1000)))
          syncSnapshot()
        }

        const runInterruptionLoopScenario = async () => {
          stageBoundaryScenario()
          await play()
          const wait = (delayMs: number) =>
            new Promise<void>((resolve) => {
              window.setTimeout(resolve, delayMs)
            })
          await wait(700)
          await suspendContext()
          await wait(350)
          await resumeContext()
          await wait(550)
          await suspendContext()
          await wait(250)
          await resumeContext()
          await wait(650)
          syncSnapshot()
        }

        window.__rrAppendableQueueDebug = {
          play,
          pause,
          setTempo,
          setPitchSemitones,
          seek: (sec) => seekCommon(sec, "seek"),
          rebase: (sec) => seekCommon(sec, "rebase"),
          suspendContext,
          resumeContext,
          reset,
          appendStartup,
          appendStartupStem,
          appendFullRemainder: () => {
            const current = harnessRef.current
            if (!current) return 0
            return current.stems.reduce(
              (sum, stem) => sum + appendFullFromStem(stem.index, stem.startupFrames / stem.startupBuffer.sampleRate),
              0
            )
          },
          appendFullRemainderStem: (stemIndex) => {
            const current = harnessRef.current
            if (!current) return 0
            const stem = current.stems[stemIndex]
            if (!stem) return 0
            return appendFullFromStem(stemIndex, stem.startupFrames / stem.startupBuffer.sampleRate)
          },
          appendFullFrom,
          appendFullFromStem,
          stageBoundaryScenario,
          stageLateAppendScenario,
          playBoundaryQueueABPreview,
          playBoundaryReferenceABPreview,
          stopBoundaryABPreview: () => stopBoundaryAbPreview(),
          getBoundaryABPreviewState: () => boundaryAbPreviewRef.current,
          runBoundaryCaptureScenario,
          runSeekLoopScenario,
          runLongSoakScenario,
          runInterruptionLoopScenario,
          getState: () => {
            const current = harnessRef.current
            if (!current) return createUnavailableSnapshot()
            const coordinatorSnapshot = current.coordinator.getSnapshot()
            return {
              ready: true,
              playing: coordinatorSnapshot.playing,
              tempo: coordinatorSnapshot.tempo,
              pitchSemitones: coordinatorSnapshot.pitchSemitones,
              supportsIndependentPitch: coordinatorSnapshot.supportsIndependentPitch,
              dataPlaneMode: coordinatorSnapshot.dataPlaneMode,
              controlPlaneMode: coordinatorSnapshot.controlPlaneMode,
              preferredDataPlaneMode: coordinatorSnapshot.preferredDataPlaneMode,
              sabCapable: coordinatorSnapshot.sabCapable,
              sabReady: coordinatorSnapshot.sabReady,
              crossOriginIsolated: coordinatorSnapshot.crossOriginIsolated,
              sabRequirement: coordinatorSnapshot.sabRequirement,
              sampleRates: coordinatorSnapshot.sampleRates,
              totalAppendMessages: coordinatorSnapshot.totalAppendMessages,
              totalAppendedBytes: coordinatorSnapshot.totalAppendedBytes,
              trackLabel: current.trackLabel,
              stemCount: coordinatorSnapshot.stemCount,
              transportSec: coordinatorSnapshot.transportSec,
              startupDurationSec: Number((current.startupFrames / current.ctx.sampleRate).toFixed(3)),
              durationSec: Number(current.durationSec.toFixed(3)),
              harnessInstanceId: current.harnessInstanceId,
              contextState: current.ctx.state,
              allStartupAppended: coordinatorSnapshot.allStartupAppended,
              allFullDecoded: coordinatorSnapshot.allFullDecoded,
              allFullAppended: coordinatorSnapshot.allFullAppended,
              stems: coordinatorSnapshot.stems,
              sync: coordinatorSnapshot.sync,
              error: null,
            }
          },
          getListeningReport: () => listeningReportRef.current,
          captureOutputArtifact: flushOutputCapture,
          getOutputCaptureArtifact: () => outputCaptureArtifactRef.current,
        }

        sharedTickTimer = window.setInterval(
          () => tickAll(harnessRef.current?.coordinator.isPlaying() === true),
          SHARED_TICK_MS
        )
        snapshotTimer = window.setInterval(() => syncSnapshot(), SNAPSHOT_TICK_MS)
        syncSnapshot()
      } catch (error) {
        syncSnapshot(error instanceof Error ? error.message : "appendable queue multitrack lab init failed")
      }
    }

    void init()

    return () => {
      cancelled = true
      if (sharedTickTimer != null) window.clearInterval(sharedTickTimer)
      if (snapshotTimer != null) window.clearInterval(snapshotTimer)
      const harness = harnessRef.current
      harnessRef.current = null
      window.__rrAppendableQueueDebug = undefined
      if (!harness) return
      const previewRuntime = boundaryAbPreviewRuntimeRef.current
      if (previewRuntime.stopTimer != null) {
        window.clearTimeout(previewRuntime.stopTimer)
        previewRuntime.stopTimer = null
      }
      for (const source of previewRuntime.sources) {
        try {
          source.stop()
        } catch {}
        try {
          source.disconnect()
        } catch {}
      }
      for (const gain of previewRuntime.gains) {
        try {
          gain.disconnect()
        } catch {}
      }
      previewRuntime.mode = "idle"
      previewRuntime.sources = []
      previewRuntime.gains = []
      for (const resolve of outputCaptureFlushResolversRef.current.values()) {
        resolve(false)
      }
      outputCaptureFlushResolversRef.current.clear()
      disposeHarnessResources(harness.ctx, harness.masterGain, harness.masterTapNode, harness.stems)
    }
  }, [syncSnapshot])

  const overviewLines = useMemo(
    () => [
      ["ready", snapshot.ready ? "yes" : "no"],
      ["context", snapshot.contextState],
      ["playing", snapshot.playing ? "yes" : "no"],
      ["tempo", formatNumber(snapshot.tempo)],
      ["pitchSemi", formatNumber(snapshot.pitchSemitones)],
      ["supportsPitch", snapshot.supportsIndependentPitch ? "yes" : "no"],
      ["dataPlane", snapshot.dataPlaneMode ?? "-"],
      ["controlPlane", snapshot.controlPlaneMode ?? "-"],
      ["preferredDataPlane", snapshot.preferredDataPlaneMode ?? "-"],
      ["sabReady", snapshot.sabReady == null ? "-" : snapshot.sabReady ? "yes" : "no"],
      ["sabCapable", snapshot.sabCapable == null ? "-" : snapshot.sabCapable ? "yes" : "no"],
      ["crossOriginIsolated", snapshot.crossOriginIsolated == null ? "-" : snapshot.crossOriginIsolated ? "yes" : "no"],
      ["sabRequirement", snapshot.sabRequirement ?? "-"],
      ["sampleRates", snapshot.sampleRates.length ? snapshot.sampleRates.join(", ") : "-"],
      ["appendMessages", String(snapshot.totalAppendMessages)],
      ["appendedMiB", formatNumber(snapshot.totalAppendedBytes / (1024 * 1024), 3)],
      ["track", snapshot.trackLabel],
      ["stems", String(snapshot.stemCount)],
      ["harnessInstanceId", snapshot.harnessInstanceId == null ? "-" : String(snapshot.harnessInstanceId)],
      ["transportSec", formatNumber(snapshot.transportSec)],
      ["startupDurationSec", formatNumber(snapshot.startupDurationSec)],
      ["durationSec", formatNumber(snapshot.durationSec)],
    ],
    [snapshot]
  )

  const syncLines = useMemo(
    () => [
      ["stemDriftSec", formatNumber(snapshot.sync.stemDriftSec, 4)],
      ["transportDriftSec", formatNumber(snapshot.sync.transportDriftSec, 4)],
      ["minLeadSec", formatNumber(snapshot.sync.minLeadSec)],
      ["maxLeadSec", formatNumber(snapshot.sync.maxLeadSec)],
      ["minObservedLeadSec", formatNumber(snapshot.sync.minObservedLeadSec)],
      ["maxObservedLeadSec", formatNumber(snapshot.sync.maxObservedLeadSec)],
      ["minLowWaterSec", formatNumber(snapshot.sync.minLowWaterSec)],
      ["maxHighWaterSec", formatNumber(snapshot.sync.maxHighWaterSec)],
      ["minRefillTriggerSec", formatNumber(snapshot.sync.minRefillTriggerSec)],
      ["totalUnderrunFrames", String(snapshot.sync.totalUnderrunFrames)],
      ["totalDiscontinuityCount", String(snapshot.sync.totalDiscontinuityCount)],
      ["totalLowWaterBreaches", String(snapshot.sync.totalLowWaterBreachCount)],
      ["totalHighWaterBreaches", String(snapshot.sync.totalHighWaterBreachCount)],
      ["totalOverflowDrops", String(snapshot.sync.totalOverflowDropCount)],
      ["totalOverflowDroppedFrames", String(snapshot.sync.totalOverflowDroppedFrames)],
      ["allStartupAppended", snapshot.allStartupAppended ? "yes" : "no"],
      ["allFullDecoded", snapshot.allFullDecoded ? "yes" : "no"],
      ["allFullAppended", snapshot.allFullAppended ? "yes" : "no"],
    ],
    [snapshot]
  )

  const clickEventLines = useMemo(() => {
    const artifact = outputCaptureArtifact
    if (!artifact) return []
    return artifact.clickEvents.slice(-6).map((event) => ({
      ts: event.ts,
      outputSec: formatNumber(event.outputSec),
      trackCurrentSec: formatNumber(event.trackCurrentSec),
      deltaAbs: formatNumber(event.deltaAbs, 6),
    }))
  }, [outputCaptureArtifact])

  const resolvedListeningReport = listeningReport ?? createListeningReport()

  useEffect(() => {
    listeningReportRef.current = resolvedListeningReport
  }, [resolvedListeningReport])

  useEffect(() => {
    boundaryAbPreviewRef.current = boundaryAbPreview
  }, [boundaryAbPreview])

  useEffect(() => {
    outputCaptureArtifactRef.current = outputCaptureArtifact
  }, [outputCaptureArtifact])

  const flushOutputCapture = useCallback(async () => {
    const harness = harnessRef.current
    const node = harness?.masterTapNode
    if (!node) {
      setOutputCaptureStatus("missing_tap")
      return null
    }
    const token = `boundary-capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setOutputCaptureStatus("flushing")
    const flushResult = await new Promise<boolean>((resolve) => {
      outputCaptureFlushResolversRef.current.set(token, resolve)
      try {
        node.port.postMessage({ type: "flush", token })
      } catch {
        outputCaptureFlushResolversRef.current.delete(token)
        resolve(false)
        return
      }
      window.setTimeout(() => {
        const pending = outputCaptureFlushResolversRef.current.get(token)
        if (!pending) return
        outputCaptureFlushResolversRef.current.delete(token)
        pending(false)
      }, 800)
    })
    const artifact = getAudioDebugCaptureArtifactSnapshot()
    setOutputCaptureArtifact(artifact)
    setOutputCaptureStatus(flushResult ? "captured" : "flush_timeout")
    return artifact
  }, [])

  const downloadOutputCaptureWav = useCallback(() => {
    if (typeof window === "undefined") return
    const artifact = outputCaptureArtifactRef.current
    if (!artifact?.wavBase64) return
    const binary = window.atob(artifact.wavBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: artifact.format })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `appendable-queue-boundary-capture-${Date.now()}.wav`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
  }, [])

  const downloadOutputCaptureJson = useCallback(() => {
    if (typeof window === "undefined") return
    const artifact = outputCaptureArtifactRef.current
    if (!artifact) return
    const payload = {
      exportedAt: new Date().toISOString(),
      trackLabel: snapshot.trackLabel,
      harnessInstanceId: snapshot.harnessInstanceId,
      snapshot: cloneSnapshot(snapshot),
      artifact,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `appendable-queue-boundary-capture-${Date.now()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
  }, [snapshot])

  useEffect(() => {
    if (typeof window === "undefined") return
    setListeningReport(restoreListeningReport(window.localStorage.getItem(LISTENING_REPORT_STORAGE_KEY)) ?? createListeningReport())
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || listeningReport == null) return
    window.localStorage.setItem(LISTENING_REPORT_STORAGE_KEY, JSON.stringify(listeningReport))
  }, [listeningReport])

  const stageListeningScenario = useCallback((scenarioId: ListeningScenarioId) => {
    setListeningReport((current) => {
      const base = current ?? createListeningReport()
      return {
        ...base,
        activeScenarioId: scenarioId,
        updatedAt: new Date().toISOString(),
      }
    })

    const api = window.__rrAppendableQueueDebug
    if (!api) return
    resetAudioDebugCaptureStore()
    setOutputCaptureArtifact(null)
    setOutputCaptureStatus("armed")
    if (scenarioId === "boundary") {
      api.stageBoundaryScenario()
      return
    }
    if (scenarioId === "late_append") {
      api.stageLateAppendScenario()
      return
    }
    void api.runSeekLoopScenario()
  }, [])

  const captureListeningScenario = useCallback(
    (scenarioId: ListeningScenarioId) => {
      setListeningReport((current) => {
        const base = current ?? createListeningReport()
        return {
          ...base,
          activeScenarioId: scenarioId,
          updatedAt: new Date().toISOString(),
          scenarios: {
            ...base.scenarios,
            [scenarioId]: {
              ...base.scenarios[scenarioId],
              capturedAt: new Date().toISOString(),
              snapshot: cloneSnapshot(snapshot),
            },
          },
        }
      })
    },
    [snapshot]
  )

  const setListeningScenarioStatus = useCallback((scenarioId: ListeningScenarioId, status: ListeningScenarioStatus) => {
    setListeningReport((current) => {
      const base = current ?? createListeningReport()
      return {
        ...base,
        activeScenarioId: scenarioId,
        updatedAt: new Date().toISOString(),
        scenarios: {
          ...base.scenarios,
          [scenarioId]: {
            ...base.scenarios[scenarioId],
            status,
          },
        },
      }
    })
  }, [])

  const setListeningScenarioNotes = useCallback((scenarioId: ListeningScenarioId, notes: string) => {
    setListeningReport((current) => {
      const base = current ?? createListeningReport()
      return {
        ...base,
        updatedAt: new Date().toISOString(),
        scenarios: {
          ...base.scenarios,
          [scenarioId]: {
            ...base.scenarios[scenarioId],
            notes,
          },
        },
      }
    })
  }, [])

  const resetListeningReport = useCallback(() => {
    setListeningReport(createListeningReport())
  }, [])

  const downloadListeningReport = useCallback(() => {
    if (typeof window === "undefined") return
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      trackLabel: snapshot.trackLabel,
      harnessInstanceId: snapshot.harnessInstanceId,
      currentSnapshot: cloneSnapshot(snapshot),
      report: resolvedListeningReport,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `appendable-queue-listening-report-${snapshot.trackLabel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "lab"}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
  }, [resolvedListeningReport, snapshot])

  const copyListeningSummary = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(buildListeningSummary(resolvedListeningReport))
  }, [resolvedListeningReport])

  const listeningSummaryLines = useMemo(() => {
    const scenarioIds = Object.keys(LISTENING_SCENARIOS) as ListeningScenarioId[]
    const passCount = scenarioIds.filter((scenarioId) => resolvedListeningReport.scenarios[scenarioId].status === "pass").length
    const failCount = scenarioIds.filter((scenarioId) => resolvedListeningReport.scenarios[scenarioId].status === "fail").length
    return [
      ["activeScenario", resolvedListeningReport.activeScenarioId ?? "-"],
      ["pass", String(passCount)],
      ["fail", String(failCount)],
      ["updatedAt", resolvedListeningReport.updatedAt ?? "-"],
    ]
  }, [resolvedListeningReport])

  const boundaryAbSummaryLines = useMemo(
    () => [
      ["mode", boundaryAbPreview.mode],
      ["startSec", formatNumber(boundaryAbPreview.startSec)],
      ["durationSec", formatNumber(boundaryAbPreview.durationSec)],
      ["lastCompleted", boundaryAbPreview.lastCompletedMode ?? "-"],
      ["updatedAt", boundaryAbPreview.updatedAt ?? "-"],
    ],
    [boundaryAbPreview]
  )

  return (
    <main className="min-h-screen bg-[#0b1016] px-6 py-10 text-[#edf1f6]">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.18em] text-[#89a1bb]">Appendable Queue Lab</p>
          <h1 className="mt-2 text-3xl font-semibold">Two-stem shared-clock appendable queue harness</h1>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-[#b8c7d8]">
            Narrow multitrack debug page for the phase-one queue primitive. It runs two long-lived worklets from one
            track, startup PCM is appended at init for both stems, the shared transport is controlled through{" "}
            <code>window.__rrAppendableQueueDebug</code>, and refill is coordinated through one external tick.
          </p>
        </div>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-[#1f2c3b] bg-[#101821] p-6">
            <div className="mb-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void window.__rrAppendableQueueDebug?.play()}
                className="rounded-md bg-[#d7a55a] px-4 py-2 text-sm font-semibold text-[#08131d]"
              >
                Play
              </button>
              <button
                type="button"
                onClick={() => window.__rrAppendableQueueDebug?.pause()}
                className="rounded-md border border-[#34506b] px-4 py-2 text-sm text-[#d7e2ee]"
              >
                Pause
              </button>
              <button
                type="button"
                onClick={() => window.__rrAppendableQueueDebug?.setPitchSemitones(-4)}
                className="rounded-md border border-[#34506b] px-4 py-2 text-sm text-[#d7e2ee]"
              >
                Pitch -4
              </button>
              <button
                type="button"
                onClick={() => window.__rrAppendableQueueDebug?.setPitchSemitones(0)}
                className="rounded-md border border-[#34506b] px-4 py-2 text-sm text-[#d7e2ee]"
              >
                Pitch 0
              </button>
              <button
                type="button"
                onClick={() => window.__rrAppendableQueueDebug?.setPitchSemitones(4)}
                className="rounded-md border border-[#34506b] px-4 py-2 text-sm text-[#d7e2ee]"
              >
                Pitch +4
              </button>
              <button
                type="button"
                onClick={() => window.__rrAppendableQueueDebug?.appendStartup()}
                className="rounded-md border border-[#34506b] px-4 py-2 text-sm text-[#d7e2ee]"
              >
                Append startup all
              </button>
              <button
                type="button"
                onClick={() => window.__rrAppendableQueueDebug?.appendFullRemainder()}
                className="rounded-md border border-[#34506b] px-4 py-2 text-sm text-[#d7e2ee]"
              >
                Append full all
              </button>
              <button
                type="button"
                onClick={() => window.__rrAppendableQueueDebug?.seek(0)}
                className="rounded-md border border-[#34506b] px-4 py-2 text-sm text-[#d7e2ee]"
              >
                Seek 0
              </button>
              <button
                type="button"
                onClick={() => window.__rrAppendableQueueDebug?.rebase(6)}
                className="rounded-md border border-[#34506b] px-4 py-2 text-sm text-[#d7e2ee]"
              >
                Rebase 6s
              </button>
              <button
                type="button"
                onClick={() => window.__rrAppendableQueueDebug?.reset()}
                className="rounded-md border border-[#7b3842] px-4 py-2 text-sm text-[#ffd6d6]"
              >
                Reset
              </button>
            </div>

            <div className="mb-5 rounded-xl border border-[#1f2c3b] bg-[#0d151d] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-[#89a1bb]">Listening Gate</div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[#c4d2df]">
                    Stage one scenario, listen, capture the current snapshot, and mark pass or fail. The report is stored
                    in localStorage and can be exported as one JSON artifact.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="listening-copy-summary"
                    onClick={() => void copyListeningSummary()}
                    className="rounded-md border border-[#34506b] px-3 py-1.5 text-xs text-[#d7e2ee]"
                  >
                    Copy summary
                  </button>
                  <button
                    type="button"
                    data-testid="listening-download-report"
                    onClick={downloadListeningReport}
                    className="rounded-md border border-[#34506b] px-3 py-1.5 text-xs text-[#d7e2ee]"
                  >
                    Download report
                  </button>
                  <button
                    type="button"
                    data-testid="listening-reset-report"
                    onClick={resetListeningReport}
                    className="rounded-md border border-[#7b3842] px-3 py-1.5 text-xs text-[#ffd6d6]"
                  >
                    Reset report
                  </button>
                </div>
              </div>
              <div
                data-testid="listening-report-summary"
                className="mt-4 grid gap-3 rounded-lg bg-[#0c131b] p-3 text-sm text-[#d7e2ee] md:grid-cols-4"
              >
                {listeningSummaryLines.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 md:block">
                    <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">{label}</div>
                    <div className="mt-1 font-mono text-[#edf1f6]">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 text-sm text-[#c4d2df] lg:grid-cols-3">
                {(Object.keys(LISTENING_SCENARIOS) as ListeningScenarioId[]).map((scenarioId) => {
                  const scenarioMeta = LISTENING_SCENARIOS[scenarioId]
                  const scenarioReport = resolvedListeningReport.scenarios[scenarioId]
                  const isActive = resolvedListeningReport.activeScenarioId === scenarioId
                  const statusTone =
                    scenarioReport.status === "pass"
                      ? "bg-emerald-700/30 text-emerald-200 border-emerald-500/40"
                      : scenarioReport.status === "fail"
                        ? "bg-rose-700/30 text-rose-200 border-rose-500/40"
                        : "bg-slate-700/30 text-slate-200 border-slate-500/40"

                  return (
                    <div
                      key={scenarioId}
                      className={`rounded-lg border p-3 ${isActive ? "border-[#d7a55a] bg-[#101821]" : "border-[#1f2c3b] bg-[#0c131b]"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[#edf1f6]">{scenarioMeta.label}</div>
                          <div
                            data-testid={`listening-status-${scenarioId}`}
                            className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] ${statusTone}`}
                          >
                            {scenarioReport.status}
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid={`listening-stage-${scenarioId}`}
                          onClick={() => stageListeningScenario(scenarioId)}
                          className="rounded-md border border-[#34506b] px-3 py-1.5 text-xs text-[#d7e2ee]"
                        >
                          {scenarioId === "seek_loop" ? "Run" : "Stage"}
                        </button>
                      </div>
                      <p className="mt-3 leading-6">{scenarioMeta.instruction}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid={`listening-capture-${scenarioId}`}
                          onClick={() => captureListeningScenario(scenarioId)}
                          className="rounded-md border border-[#34506b] px-3 py-1.5 text-xs text-[#d7e2ee]"
                        >
                          Capture snapshot
                        </button>
                        <button
                          type="button"
                          data-testid={`listening-pass-${scenarioId}`}
                          onClick={() => setListeningScenarioStatus(scenarioId, "pass")}
                          className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-200"
                        >
                          Mark pass
                        </button>
                        <button
                          type="button"
                          data-testid={`listening-fail-${scenarioId}`}
                          onClick={() => setListeningScenarioStatus(scenarioId, "fail")}
                          className="rounded-md border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200"
                        >
                          Mark fail
                        </button>
                      </div>
                      <label className="mt-3 block text-xs uppercase tracking-[0.12em] text-[#89a1bb]">
                        Notes
                        <textarea
                          data-testid={`listening-note-${scenarioId}`}
                          value={scenarioReport.notes}
                          onChange={(event) => setListeningScenarioNotes(scenarioId, event.currentTarget.value)}
                          rows={4}
                          className="mt-2 w-full rounded-lg border border-[#1f2c3b] bg-[#091018] px-3 py-2 text-sm normal-case tracking-normal text-[#edf1f6] outline-none"
                        />
                      </label>
                      <div className="mt-3 text-xs text-[#89a1bb]">
                        capturedAt: {scenarioReport.capturedAt ?? "-"}
                      </div>
                      {scenarioReport.snapshot ? (
                        <div className="mt-3 grid gap-2 text-xs text-[#d7e2ee]">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[#89a1bb]">transportSec</span>
                            <span className="font-mono">{formatNumber(scenarioReport.snapshot.transportSec)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[#89a1bb]">stemDriftSec</span>
                            <span className="font-mono">{formatNumber(scenarioReport.snapshot.sync.stemDriftSec, 4)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[#89a1bb]">underrunFrames</span>
                            <span className="font-mono">{scenarioReport.snapshot.sync.totalUnderrunFrames}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[#89a1bb]">discontinuityCount</span>
                            <span className="font-mono">{scenarioReport.snapshot.sync.totalDiscontinuityCount}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mb-5 rounded-xl border border-[#1f2c3b] bg-[#0d151d] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-[#89a1bb]">Boundary A/B Listen</div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[#c4d2df]">
                    Compare `appendable queue` against plain `full-source reference` on the same post-boundary window.
                    If both variants sound the same, the current `10.5s..10.8s` cluster is source material, not a queue seam.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="boundary-ab-play-queue"
                    onClick={() => void window.__rrAppendableQueueDebug?.playBoundaryQueueABPreview()}
                    disabled={!snapshot.allFullDecoded}
                    className="rounded-md border border-[#d7a55a]/50 px-3 py-1.5 text-xs text-[#f4d7a3] disabled:opacity-50"
                  >
                    Play appendable A
                  </button>
                  <button
                    type="button"
                    data-testid="boundary-ab-play-reference"
                    onClick={() => void window.__rrAppendableQueueDebug?.playBoundaryReferenceABPreview()}
                    disabled={!snapshot.allFullDecoded}
                    className="rounded-md border border-[#6aa2d7]/50 px-3 py-1.5 text-xs text-[#d5e8fb] disabled:opacity-50"
                  >
                    Play source reference B
                  </button>
                  <button
                    type="button"
                    data-testid="boundary-ab-stop"
                    onClick={() => window.__rrAppendableQueueDebug?.stopBoundaryABPreview()}
                    className="rounded-md border border-[#34506b] px-3 py-1.5 text-xs text-[#d7e2ee]"
                  >
                    Stop A/B
                  </button>
                </div>
              </div>
              <div
                data-testid="boundary-ab-summary"
                className="mt-4 grid gap-3 rounded-lg bg-[#0c131b] p-3 text-sm text-[#d7e2ee] md:grid-cols-5"
              >
                {boundaryAbSummaryLines.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 md:block">
                    <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">{label}</div>
                    <div className="mt-1 font-mono text-[#edf1f6]">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg bg-[#0c131b] p-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">How To Use</div>
                  <ol className="mt-3 space-y-2 text-sm leading-6 text-[#d7e2ee]">
                    <li>1. Press `Play appendable A` and listen for the boundary window.</li>
                    <li>2. Press `Play source reference B` immediately after.</li>
                    <li>3. Alternate A/B a few times without touching other controls.</li>
                    <li>4. If A and B sound the same, treat the current cluster as source material.</li>
                  </ol>
                </div>
                <div className="rounded-lg bg-[#0c131b] p-3 text-sm leading-6 text-[#d7e2ee]">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">Target Window</div>
                  <p className="mt-3">
                    The preview starts shortly after the <code>startup -&gt; full</code> boundary and plays a short fixed
                    slice around the known cluster. This is meant for fast perceptual A/B, not for long playback.
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-5 rounded-xl border border-[#1f2c3b] bg-[#0d151d] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-[#89a1bb]">Boundary Output Capture</div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[#c4d2df]">
                    Use this after `Boundary`: let playback cross the seam, pause, then flush the mono master-tap buffer.
                    Download the captured WAV/JSON so we can inspect real output around the clicks at `7s..10s`.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="output-capture-run-boundary"
                    onClick={() => void window.__rrAppendableQueueDebug?.runBoundaryCaptureScenario()}
                    className="rounded-md border border-[#d7a55a]/50 px-3 py-1.5 text-xs text-[#f4d7a3]"
                  >
                    Run boundary auto-capture
                  </button>
                  <button
                    type="button"
                    data-testid="output-capture-flush"
                    onClick={() => void flushOutputCapture()}
                    className="rounded-md border border-[#34506b] px-3 py-1.5 text-xs text-[#d7e2ee]"
                  >
                    Capture output now
                  </button>
                  <button
                    type="button"
                    data-testid="output-capture-download-wav"
                    onClick={downloadOutputCaptureWav}
                    disabled={!outputCaptureArtifact}
                    className="rounded-md border border-[#34506b] px-3 py-1.5 text-xs text-[#d7e2ee] disabled:opacity-50"
                  >
                    Download WAV
                  </button>
                  <button
                    type="button"
                    data-testid="output-capture-download-json"
                    onClick={downloadOutputCaptureJson}
                    disabled={!outputCaptureArtifact}
                    className="rounded-md border border-[#34506b] px-3 py-1.5 text-xs text-[#d7e2ee] disabled:opacity-50"
                  >
                    Download capture JSON
                  </button>
                </div>
              </div>
              <div
                data-testid="output-capture-summary"
                className="mt-4 grid gap-3 rounded-lg bg-[#0c131b] p-3 text-sm text-[#d7e2ee] md:grid-cols-5"
              >
                <div className="flex items-center justify-between gap-3 md:block">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">status</div>
                  <div className="mt-1 font-mono text-[#edf1f6]">{outputCaptureStatus}</div>
                </div>
                <div className="flex items-center justify-between gap-3 md:block">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">durationSec</div>
                  <div className="mt-1 font-mono text-[#edf1f6]">
                    {formatNumber(outputCaptureArtifact?.durationSec)}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 md:block">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">artifactStart</div>
                  <div className="mt-1 font-mono text-[#edf1f6]">
                    {formatNumber(outputCaptureArtifact?.artifactStartOffsetSec)}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 md:block">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">artifactEnd</div>
                  <div className="mt-1 font-mono text-[#edf1f6]">
                    {formatNumber(outputCaptureArtifact?.artifactEndOffsetSec)}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 md:block">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">clickEvents</div>
                  <div className="mt-1 font-mono text-[#edf1f6]">
                    {outputCaptureArtifact?.clickEvents.length ?? 0}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg bg-[#0c131b] p-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">How To Use</div>
                  <ol className="mt-3 space-y-2 text-sm leading-6 text-[#d7e2ee]">
                    <li>1. Fast path: press `Run boundary auto-capture`.</li>
                    <li>2. Manual path: `Boundary` -&gt; `Stage` -&gt; `Play`.</li>
                    <li>3. Wait until after the seam window, then `Pause` and press `Capture output now`.</li>
                    <li>4. Download `WAV` and `capture JSON`.</li>
                  </ol>
                </div>
                <div className="rounded-lg bg-[#0c131b] p-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[#89a1bb]">Recent Click Events</div>
                  <div className="mt-3 space-y-2 text-xs text-[#d7e2ee]">
                    {clickEventLines.length > 0 ? (
                      clickEventLines.map((event) => (
                        <div key={`${event.ts}-${event.outputSec}`} className="rounded-md bg-[#091018] px-3 py-2">
                          <div>outputSec: {event.outputSec}</div>
                          <div>trackCurrentSec: {event.trackCurrentSec}</div>
                          <div>deltaAbs: {event.deltaAbs}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-md bg-[#091018] px-3 py-2 text-[#89a1bb]">No click events captured yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl bg-[#0c131b] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[#89a1bb]">Overview</div>
                <div className="mt-3 space-y-2 text-sm">
                  {overviewLines.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">{label}</span>
                      <span className="text-right font-mono text-[#edf1f6]">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-[#0c131b] p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-[#89a1bb]">Shared Sync</div>
                <div className="mt-3 space-y-2 text-sm">
                  {syncLines.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">{label}</span>
                      <span className="text-right font-mono text-[#edf1f6]">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {snapshot.stems.map((stem) => (
                <div key={stem.stemIndex} className="rounded-xl bg-[#0c131b] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.14em] text-[#89a1bb]">Stem {stem.stemIndex + 1}</div>
                      <div className="mt-1 text-sm font-semibold text-[#edf1f6]">{stem.label}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.__rrAppendableQueueDebug?.appendFullRemainderStem(stem.stemIndex)}
                      className="rounded-md border border-[#34506b] px-3 py-1.5 text-xs text-[#d7e2ee]"
                    >
                      Append full
                    </button>
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">engineInstanceId</span>
                      <span className="font-mono text-[#edf1f6]">{stem.engineInstanceId ?? "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">currentSec</span>
                      <span className="font-mono text-[#edf1f6]">{formatNumber(stem.currentSec)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">startupAppended</span>
                      <span className="font-mono text-[#edf1f6]">{stem.startupAppended ? "yes" : "no"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">fullDecoded</span>
                      <span className="font-mono text-[#edf1f6]">{stem.fullDecoded ? "yes" : "no"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">fullAppended</span>
                      <span className="font-mono text-[#edf1f6]">{stem.fullAppended ? "yes" : "no"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">bufferedUntilSec</span>
                      <span className="font-mono text-[#edf1f6]">{formatNumber(stem.sourceBufferedUntilSec)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">queuedSegments</span>
                      <span className="font-mono text-[#edf1f6]">{stem.sourceQueuedSegments}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">ended</span>
                      <span className="font-mono text-[#edf1f6]">{stem.sourceEnded ? "yes" : "no"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">leadSec</span>
                      <span className="font-mono text-[#edf1f6]">{formatNumber(stem.stats?.bufferLeadSec)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">dataPlane</span>
                      <span className="font-mono text-[#edf1f6]">{stem.stats?.dataPlaneMode ?? "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">preferredDataPlane</span>
                      <span className="font-mono text-[#edf1f6]">{stem.stats?.preferredDataPlaneMode ?? "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">sabReady</span>
                      <span className="font-mono text-[#edf1f6]">
                        {stem.stats?.sabReady == null ? "-" : stem.stats.sabReady ? "yes" : "no"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">sampleRate</span>
                      <span className="font-mono text-[#edf1f6]">{stem.stats?.sampleRate ?? "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">appendMessages</span>
                      <span className="font-mono text-[#edf1f6]">{stem.stats?.appendMessageCount ?? "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">appendedMiB</span>
                      <span className="font-mono text-[#edf1f6]">
                        {stem.stats ? formatNumber(stem.stats.appendedBytes / (1024 * 1024), 3) : "-"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">underrunFrames</span>
                      <span className="font-mono text-[#edf1f6]">{stem.stats?.underrunFrames ?? "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#9fb4ca]">discontinuityCount</span>
                      <span className="font-mono text-[#edf1f6]">{stem.stats?.discontinuityCount ?? "-"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {snapshot.error ? (
              <div className="mt-4 rounded-xl border border-[#7b3842] bg-[#2b1115] px-4 py-3 text-sm text-[#ffd6d6]">
                {snapshot.error}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-[#1f2c3b] bg-[#101821] p-6">
            <div className="text-xs uppercase tracking-[0.14em] text-[#89a1bb]">Live snapshot</div>
            <pre className="mt-4 overflow-auto rounded-xl bg-[#0c131b] p-4 text-xs leading-5 text-[#d7e2ee]">
              {JSON.stringify(snapshot, null, 2)}
            </pre>
            <div className="mt-6 text-xs uppercase tracking-[0.14em] text-[#89a1bb]">Listening report</div>
            <pre
              data-testid="listening-report-json"
              className="mt-4 overflow-auto rounded-xl bg-[#0c131b] p-4 text-xs leading-5 text-[#d7e2ee]"
            >
              {JSON.stringify(resolvedListeningReport, null, 2)}
            </pre>
          </div>
        </section>
      </div>
    </main>
  )
}
