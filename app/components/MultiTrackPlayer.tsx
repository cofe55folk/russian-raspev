"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  createAppendableQueueEngine,
  createAudioBufferAppendableSource,
  createManualAppendablePcmSource,
  sliceAudioBufferToChunk,
} from "./audio/appendableQueueEngine"
import { createAppendableQueueMultitrackCoordinator, type AppendableQueueMultitrackCoordinator } from "./audio/appendableQueueMultitrackCoordinator"
import {
  addClientAppendableSafeRolloutTargets,
  addClientAppendableSafeRolloutTarget,
  removeClientAppendableSafeRolloutTarget,
  resolveClientAppendablePilotActivation,
  type AppendablePilotActivationState,
} from "./audio/appendablePilotActivation"
import { resolveAudioPilotRouting, type AudioPilotEngineMode } from "./audio/audioPilotRouting"
import { listAppendableStartupManifestSlugs, resolveAppendableStartupManifestMatch } from "./audio/appendableStartupManifest"
import {
  qualifyAppendableContinuationChunks,
  type AppendableContinuationQualificationReason,
  type AppendableContinuationQualificationStatus,
} from "./audio/appendableContinuationQualification"
import { createSoundTouchEngine, type AudioEngineCapabilities, type SoundTouchEngine } from "./audio/soundtouchEngine"
import { createMediaStreamingEngine } from "./audio/mediaStreamingEngine"
import { createRingBufferWorkletEngine } from "./audio/ringBufferWorkletEngine"
import { clearGlobalAudio, requestGlobalAudio, type GlobalAudioController } from "../lib/globalAudioManager"
import { emitMiniPlayerTelemetry } from "../lib/analytics/emitMiniPlayerTelemetry"
import {
  formatAudioDebugBuffer,
  getAudioDebugBufferSnapshot,
  isAudioDebugCaptureEnabled,
  isAudioDebugEnabled,
  isAudioTtfpEnabled,
  logAudioDebug,
  logAudioTtfp,
  subscribeAudioDebugBuffer,
} from "../lib/audioDebugLogStore"
import {
  appendAudioDebugCaptureSamples,
  getAudioDebugCaptureArtifactSnapshot,
  initAudioDebugCaptureStore,
  recordAudioDebugCaptureClick,
  resetAudioDebugCaptureStore,
} from "../lib/audioDebugCaptureStore"
import { I18N_MESSAGES, type I18nKey } from "../lib/i18n/messages"
import { createRecordingV2OpfsWriter, type RecordingV2OpfsWriter } from "../lib/ugc/recording-v2-opfs-client"
import { drainRecordingV2UploadQueue, enqueueRecordingV2Upload, uploadRecordingV2TakeFromOpfs } from "../lib/ugc/recording-v2-upload-client"

export type StartupChunkTrackDef = {
  pilotKey?: string
  strategy?: "handoff" | "splice"
  startupSrc: string
  tailSrc?: string
  startupDurationSec?: number
  tailStartSec?: number
  tailDurationSec?: number
  estimatedTotalDurationSec?: number
  crossfadeSec?: number
}
export type TrackDef = { name: string; src: string; defaultVolume?: number; startupChunk?: StartupChunkTrackDef }
type WavePeaks = { min: Float32Array; max: Float32Array }
type TeleprompterLine = { time: number; text: string }
type TeleprompterAnchorMap = Record<number, number>
type TeleprompterTextOverrideMap = Record<number, string>
type TeleprompterDraftState = {
  savedAt: string
  lines: TeleprompterLine[]
  anchors: TeleprompterAnchorMap
  textOverrides: TeleprompterTextOverrideMap
}
type TeleprompterBackupPayload = {
  draft_saved_at?: unknown
  lines_raw?: unknown
  lines?: unknown
  lines_effective?: unknown
  anchors?: unknown
  text_overrides?: unknown
  textOverrides?: unknown
}
type ExportFormat = "m4a" | "mp3" | "wav"
type UiLang = "ru" | "en"
type RecordingMode = "compatibility" | "local_master"
type EngineMode = AudioPilotEngineMode
type AppendableQueueRuntimeProbeSnapshot = {
  active: boolean
  sampleAtMs: number | null
  currentSec: number | null
  transportSec: number | null
  supportsTempo: boolean | null
  supportsIndependentPitch: boolean | null
  tempo: number | null
  pitchSemitones: number | null
  dataPlaneMode: string | null
  controlPlaneMode: string | null
  preferredDataPlaneMode: string | null
  sabCapable: boolean | null
  sabReady: boolean | null
  crossOriginIsolated: boolean | null
  sabRequirement: string | null
  sampleRates: number[]
  appendMessageCount: number
  appendedMiB: number | null
  stemDriftSec: number | null
  transportDriftSec: number | null
  minLeadSec: number | null
  maxLeadSec: number | null
  minObservedLeadSec: number | null
  maxObservedLeadSec: number | null
  minLowWaterSec: number | null
  maxHighWaterSec: number | null
  minRefillTriggerSec: number | null
  dropDeltaSec: number | null
  cleanSoakSec: number | null
  readyThresholdSec: number | null
  totalUnderrunFrames: number
  totalDiscontinuityCount: number
  totalLowWaterBreachCount: number
  totalHighWaterBreachCount: number
  totalOverflowDropCount: number
  totalOverflowDroppedFrames: number
}
type AppendableQueueSourceProgressSnapshot = {
  mode: "off" | "full_buffer" | "startup_head_manifest" | "startup_head_continuation_chunks"
  manifestSlug: string | null
  startupDurationSec: number | null
  allStartupAppended: boolean
  allFullDecoded: boolean
  allFullAppended: boolean
  continuationQualification: AppendableContinuationQualificationStatus
  continuationQualificationReason: AppendableContinuationQualificationReason | null
  safeRolloutCandidateQualified: boolean
  safeRolloutCandidateTarget: string | null
  continuationChunkGroupsAvailable: number
  continuationChunkGroupsPlanned: number
  continuationChunkGroupsDecoded: number
  continuationChunkGroupsAppended: number
  continuationCoverageEndSec: number | null
  minSourceBufferedUntilSec: number | null
  maxSourceBufferedUntilSec: number | null
  minQueuedSegments: number | null
  maxQueuedSegments: number | null
  allSourceEnded: boolean
}
type AppendableRoutePilotChecklistStatus =
  | "waiting_for_flags"
  | "blocked_by_targeting"
  | "play_to_activate_probe"
  | "soak_in_progress"
  | "ready_for_manual_pilot"
  | "attention_required"
type AppendableRoutePilotReportStatus = "pending" | "pass" | "fail"
type AppendableRouteQualificationSnapshot = {
  targetSoakSec: number | null
  observedCleanSoakSec: number | null
  passed: boolean | null
  reason: string | null
}
type AppendableRouteStressSnapshot = {
  holdPerSeekSec: number | null
  seekSequenceSec: number[]
  completedSeeks: number
  passed: boolean | null
  reason: string | null
}
type AppendableRouteVisibilityState = "visible" | "hidden"
type AppendableRouteVisibilityEvent =
  | "window:blur"
  | "window:focus"
  | "window:pagehide"
  | "window:pageshow"
  | "document:hidden"
  | "document:visible"
type AppendableRouteVisibilitySnapshot = {
  currentState: AppendableRouteVisibilityState | null
  lostForeground: boolean
  blurCount: number
  focusCount: number
  pageHideCount: number
  pageShowCount: number
  visibilityHiddenCount: number
  visibilityVisibleCount: number
  hiddenWhilePlayingCount: number
  focusWhilePlayingCount: number
  lastEvent: AppendableRouteVisibilityEvent | null
  lastEventAt: string | null
}
type AppendableRouteTransportSnapshot = {
  supportsTempo: boolean | null
  supportsIndependentPitch: boolean | null
  tempo: number | null
  pitchSemitones: number | null
  dataPlaneMode: string | null
  controlPlaneMode: string | null
  preferredDataPlaneMode: string | null
  sabCapable: boolean | null
  sabReady: boolean | null
  crossOriginIsolated: boolean | null
  sabRequirement: string | null
  sampleRates: number[]
  appendMessageCount: number
  appendedMiB: number | null
  minLeadSec: number | null
  maxLeadSec: number | null
  minObservedLeadSec: number | null
  maxObservedLeadSec: number | null
  minLowWaterSec: number | null
  maxHighWaterSec: number | null
  minRefillTriggerSec: number | null
  totalUnderrunFrames: number
  totalDiscontinuityCount: number
  totalLowWaterBreachCount: number
  totalHighWaterBreachCount: number
  totalOverflowDropCount: number
  totalOverflowDroppedFrames: number
  passed: boolean | null
  reason: string | null
}
type AppendableRoutePitchSnapshot = {
  scenario: string | null
  shadowEnabled: boolean
  supportsTempo: boolean | null
  supportsIndependentPitch: boolean | null
  targetTempo: number | null
  observedTempo: number | null
  targetPitchSemitones: number | null
  observedPitchSemitones: number | null
  passed: boolean | null
  reason: string | null
}
type AppendableRouteRolloutSnapshot = {
  status: AppendableRoutePilotReportStatus
  gateReady: boolean
  transportPassed: boolean | null
  qualificationPassed: boolean | null
  stressPassed: boolean | null
  reason: string | null
}
type AppendableRoutePilotReportSnapshot = {
  capturedAt: string
  trackScopeId: string
  audioMode: EngineMode
  gate: {
    status: AppendableRoutePilotChecklistStatus
    statusLabel: string
  }
  flags: {
    appendableQueuePilotEnabled: boolean
    appendableQueueMultistemPilotEnabled: boolean
    appendableQueueStartupHeadPilotEnabled: boolean
    appendableQueueContinuationChunksPilotEnabled: boolean
    appendableQueueShadowPitchEnabled: boolean
  }
  activation: {
    configured: boolean
    allowed: boolean
    mode: "unscoped" | "targeted_pilot" | "safe_rollout"
    tempoControlUnlocked: boolean
    pitchShadowActive: boolean
    matchedTarget: string | null
    currentTargets: string[]
    configuredTargets: string[]
    targetedPilotConfiguredTargets: string[]
    safeRolloutConfiguredTargets: string[]
  }
  probe: AppendableQueueRuntimeProbeSnapshot
  sourceProgress: AppendableQueueSourceProgressSnapshot
  transport: AppendableRouteTransportSnapshot
  qualification: AppendableRouteQualificationSnapshot
  stress: AppendableRouteStressSnapshot
  visibility: AppendableRouteVisibilitySnapshot
  pitch: AppendableRoutePitchSnapshot
  rollout: AppendableRouteRolloutSnapshot
}
type AppendableRoutePilotReport = {
  version: 1
  updatedAt: string | null
  status: AppendableRoutePilotReportStatus
  notes: string
  snapshot: AppendableRoutePilotReportSnapshot | null
}
type AppendableRoutePilotDebugState = {
  trackScopeId: string
  playing: boolean
  audioMode: EngineMode
  checklist: {
    status: AppendableRoutePilotChecklistStatus
    statusLabel: string
    steps: string[]
  }
  runtimeProbe: AppendableQueueRuntimeProbeSnapshot
  sourceProgress: AppendableQueueSourceProgressSnapshot
  report: AppendableRoutePilotReport
}
type AppendableRoutePilotDebugApi = {
  play: () => Promise<void>
  pause: () => void
  seek: (sec: number) => number
  setTempo: (tempo: number) => { tempo: number; pitchSemitones: number }
  setPitchSemitones: (semi: number) => { tempo: number; pitchSemitones: number }
  captureReport: () => AppendableRoutePilotReportSnapshot
  saveCurrentDiagnostics: () => void
  markPass: () => void
  markFail: () => void
  resetReport: () => void
  downloadReport: () => void
  downloadPacket: () => void
  getState: () => AppendableRoutePilotDebugState
  runQuickPilot: (seekSec?: number | null) => Promise<AppendableRoutePilotDebugState>
  runSoakPilot: (durationSec?: number | null) => Promise<AppendableRoutePilotDebugState>
  runQualificationPilot: (durationSec?: number | null) => Promise<AppendableRoutePilotDebugState>
  runStressPilot: (holdSec?: number | null) => Promise<AppendableRoutePilotDebugState>
  runPitchShadowPilot: (
    tempo?: number | null,
    pitchSemitones?: number | null,
    settleMs?: number | null
  ) => Promise<AppendableRoutePilotDebugState>
}
type NavHandoffState = {
  trackScopeId: string
  positionSec: number
  loopOn: boolean
  playing: boolean
  ts: number
}
type StartupChunkRuntimeState = {
  enabled: boolean
  strategy: "handoff" | "splice"
  stage: "startup" | "tail" | "full"
  startupDurationSec: number
  crossfadeSec: number
  tailStartSec: number | null
  tailDurationSec: number | null
  estimatedTotalDurationSec: number | null
  tailBuffers: AudioBuffer[] | null
  tailBuffersReady: boolean
  fullBuffers: AudioBuffer[] | null
  fullBuffersReady: boolean
  handoffInProgress: boolean
  handoffComplete: boolean
  deferredPeaksScheduled: boolean
  tailDecodeStartedAtMs: number | null
  tailDecodeReadyAtMs: number | null
  fullDecodeStartedAtMs: number | null
  fullDecodeReadyAtMs: number | null
}
type AppendableStartupHeadStemRuntimeState = {
  sourceController: ReturnType<typeof createManualAppendablePcmSource>
  startupFrames: number
  startupAppended: boolean
  fullDecoded: boolean
  fullAppended: boolean
  continuationChunkFrames: number
}
type AppendableStartupHeadRuntimeState = {
  mode: "full_buffer" | "startup_head_manifest" | "startup_head_continuation_chunks"
  manifestSlug: string | null
  startupDurationSec: number | null
  continuationQualification: AppendableContinuationQualificationStatus
  continuationQualificationReason: AppendableContinuationQualificationReason | null
  continuationChunkGroupsAvailable: number
  continuationChunkGroupsPlanned: number
  continuationChunkGroupsDecoded: number
  continuationChunkGroupsAppended: number
  continuationCoverageEndSec: number | null
  stems: AppendableStartupHeadStemRuntimeState[]
}
type AppendableContinuationPreflightState = {
  manifestSlug: string | null
  qualification: AppendableContinuationQualificationStatus
  qualificationReason: AppendableContinuationQualificationReason | null
  safeRolloutCandidateQualified: boolean
  safeRolloutCandidateTarget: string | null
  availableGroupCount: number
  plannedGroupCount: number
  coverageEndSec: number | null
}
type StartupChunkSwapPlan = {
  swapLabel: "tail_handoff" | "full_handoff" | "handoff"
  sourceOffsetSec: number
  stageAfterSwap: StartupChunkRuntimeState["stage"]
  disableRuntimeAfterSwap: boolean
}
type GuestTakeMeta = {
  id: string
  title: string
  createdAt: string
  sourceKey: string
  referenceTrackIndex: number
  deviceProfileId?: string
  offsetSec?: number
  score?: number | null
  syncQuality?: GuestSyncQuality
  durationSec?: number
}
type GuestTakesState = {
  activeTakeId: string | null
  takes: GuestTakeMeta[]
}
type DeviceLatencyProfile = {
  id: string
  label: string
  offsetSec: number
  updatedAt: string
}
type GuestDriftTelemetrySnapshot = {
  sampleCount: number
  avgAbsDriftMs: number
  maxAbsDriftMs: number
  softCorrections: number
  hardCorrections: number
}
type RecorderCapabilitySnapshot = {
  capturedAt: string
  recordingEngine: "media_recorder_v1" | "recording_v2_preview"
  recordingV2FlagEnabled: boolean
  mimeType: string
  mediaRecorderSupported: boolean
  audioWorkletSupported: boolean
  opfsSupported: boolean
  baseLatencyMs: number | null
  outputLatencyMs: number | null
  inputLatencyMs: number | null
  inputSampleRate: number | null
  inputSampleSize: number | null
  inputChannelCount: number | null
  inputEchoCancellation: boolean | null
  inputNoiseSuppression: boolean | null
  inputAutoGainControl: boolean | null
  dropoutCount: number
  recoveryCount: number
  workletTapActive: boolean
  workletFramesCaptured: number
  workletChunkReports: number
  workletTapErrors: number
  opfsWriterActive: boolean
  opfsBytesWritten: number
  opfsChunkCount: number
  opfsWriteErrors: number
  uploadState: string
}
type RecorderV2TapStats = {
  framesCaptured: number
  chunkReports: number
  errors: number
}

type AudioDebugMasterTapStats = {
  framesCaptured: number
  chunkReports: number
  clickReports: number
  errors: number
}

type AudioTtfpStage =
  | "click"
  | "play_call"
  | "ctx_resumed"
  | "seek_applied"
  | "engines_start"
  | "gate_open"
  | "playing_state"

type AudioTtfpAttempt = {
  id: number
  trackScopeId: string
  trigger: string
  startedAtMs: number
  startedAtIso: string
  stages: Partial<Record<AudioTtfpStage, number>>
  finalized: boolean
}

declare global {
  interface Window {
    __rrAppendableRoutePilotDebug?: AppendableRoutePilotDebugApi
  }
}

const TELEPROMPTER_LEAD_SEC = 0.18
const COUNT_IN_BEATS = 3
const COUNT_IN_BPM = 72
const DEFAULT_REVERB_AMOUNT = 0.2
const DEFAULT_SPEED = 1
const DEFAULT_PITCH_SEMITONES = 0
const MASTER_HEADROOM_GAIN = 0.82
const TRACK_HEADROOM_GAIN = 0.92
const TRACK_MAX_GAIN = 1
const GUEST_MAX_GAIN = 1
const DEFAULT_GUEST_SYNC_SEC = 0.22
const GLOBAL_GUEST_SYNC_STORAGE_KEY = "rr_guest_sync_offset_sec:global_v1"
const NAV_HANDOFF_STORAGE_KEY = "rr_multitrack_nav_handoff_v1"
const NAV_HANDOFF_TTL_MS = 20_000
const FORCE_AUTOPLAY_STORAGE_KEY = "rr_force_autoplay_next_mount"
const GUEST_TAKES_MAX = 12
const GUEST_DEVICE_PROFILE_STORAGE_KEY = "rr_guest_device_latency_profile_v1"
const APPENDABLE_ROUTE_PILOT_REPORT_STORAGE_KEY_PREFIX = "rr_appendable_route_pilot_report"
const GUEST_STARTUP_BIAS_SEC = 0
const GUEST_STARTUP_BIAS_DECAY_SEC = 3.5
const GUEST_SYNC_MIN_SEC = -2.5
const GUEST_SYNC_MAX_SEC = 2.5
const GUEST_DRIFT_SOFT_FIX_SEC = 0.024
const GUEST_DRIFT_HARD_FIX_SEC = 0.095
const GUEST_DRIFT_RATE_NUDGE_LIMIT = 0.025
const GUEST_DRIFT_RATE_GAIN = 0.35
const GUEST_DRIFT_SAMPLE_THROTTLE_MS = 120
const GUEST_DRIFT_HARD_FIX_COOLDOWN_MS = 1100
const GUEST_DRIFT_TELEMETRY_FLUSH_MS = 20_000
const RECORD_HEADPHONES_STORAGE_KEY = "rr_record_headphones_confirmed_v1"
const PLAYER_LONGTASK_UI_FLUSH_MIN_MS = 250
const GUEST_CALIBRATE_MAX_ABS_SEC = 1.4
const GUEST_CALIBRATE_SEARCH_SWING_SEC = 0.55
const GUEST_CALIBRATE_MAX_JUMP_SEC = 0.65
const GUEST_CALIBRATE_FINE_BIN_SEC = 0.01
const GUEST_CALIBRATE_FINE_WINDOW_SEC = 0.18
const PREVIEW_FLAGS_COOKIE = "rr_preview_flags_v1"
const PROGRESSIVE_LOAD_PREVIEW_FLAG = "multitrack_progressive_load"
const STARTUP_CHUNK_PREVIEW_FLAG = "multitrack_startup_chunk_pilot"
const STARTUP_CHUNK_SPLICE_PREVIEW_FLAG = "multitrack_startup_splice_pilot"
const STREAMING_BUFFER_PREVIEW_FLAG = "multitrack_streaming_pilot"
const APPENDABLE_QUEUE_PILOT_PREVIEW_FLAG = "multitrack_appendable_queue_pilot"
const APPENDABLE_QUEUE_MULTISTEM_PILOT_PREVIEW_FLAG = "multitrack_appendable_queue_multistem_pilot"
const APPENDABLE_QUEUE_STARTUP_HEAD_PREVIEW_FLAG = "multitrack_appendable_queue_startup_head"
const APPENDABLE_QUEUE_CONTINUATION_CHUNKS_PREVIEW_FLAG = "multitrack_appendable_queue_continuation_chunks"
const RINGBUFFER_PILOT_PREVIEW_FLAG = "multitrack_ringbuffer_pilot"
const RECORDING_ENGINE_V2_PREVIEW_FLAG = "recording_engine_v2"
const TRACK_DECODE_MAX_ATTEMPTS = 2
const TRACK_DECODE_TIMEOUT_MS = 6000
const RINGBUFFER_ENGINE_INIT_TIMEOUT_MS = 2200
const AUDIO_CTX_RESUME_TIMEOUT_MS = 1600
const PENDING_PLAY_READY_TIMEOUT_MS = 5200
const LARGE_TRACK_BYTES_THRESHOLD = 16 * 1024 * 1024
const TEMPO_PITCH_SMOOTH_MS = 140
const AUDIO_TTFP_STORAGE_KEY = "rr_audio_ttfp"
const AUDIO_TTFP_SAMPLE_WINDOW = 30
const AUDIO_TTFP_API_PATH = "/api/analytics/audio-ttfp"
const AUDIO_TTFP_PERSIST_IN_DEV = process.env.NEXT_PUBLIC_AUDIO_TTFP_PERSIST === "1"
const DEFERRED_PEAKS_IDLE_DELAY_MS = 140
const DEFERRED_PEAKS_WHILE_PLAYING_DELAY_MS = 2600
const DEFERRED_PEAKS_RINGBUFFER_WHILE_PLAYING_DELAY_MS = 9000
const DEFERRED_PEAKS_STARTUP_CHUNK_POST_HANDOFF_DELAY_MS = 5200
const DEFERRED_PEAKS_BUCKETS = 1200
const WAVEFORM_PREVIEW_IDLE_DELAY_MS = 80
const WAVEFORM_PREVIEW_WHILE_PLAYING_DELAY_MS = 220
const WAVEFORM_PREVIEW_DURATION_THRESHOLD_SEC = 90
const WAVEFORM_PREVIEW_PROBES_PER_BUCKET = 24
const WAVEFORM_FULL_PEAKS_PLAYING_YIELD_EVERY_BUCKETS = 4
const WAVEFORM_FULL_PEAKS_PLAYING_MAX_SLICE_MS = 1
const WAVEFORM_FULL_PEAKS_PLAYING_YIELD_DELAY_MS = 12
const WAVEFORM_FULL_PEAKS_RINGBUFFER_PLAYING_YIELD_EVERY_BUCKETS = 2
const WAVEFORM_FULL_PEAKS_RINGBUFFER_PLAYING_YIELD_DELAY_MS = 20
const WAVEFORM_FULL_PEAKS_IDLE_CALLBACK_TIMEOUT_MS = 1600
const WAVEFORM_FULL_PEAKS_BETWEEN_TRACKS_DELAY_MS = 16
const WAVEFORM_FULL_PEAKS_RINGBUFFER_BETWEEN_TRACKS_DELAY_MS = 48
const STARTUP_CHUNK_HANDOFF_OVERLAP_SEC = 0.24
const STARTUP_CHUNK_HANDOFF_LEAD_SEC = 0.8
const STARTUP_CHUNK_SPLICE_DEFAULT_CROSSFADE_SEC = 0.34
const WAVEFORM_PEAKS_CACHE_LIMIT = 96
const RINGBUFFER_RUNTIME_PROBE_INTERVAL_MS = 2000
const RINGBUFFER_RUNTIME_PROBE_LOG_INTERVAL_MS = 8000
const RINGBUFFER_RUNTIME_PROBE_DROP_DELTA_SEC = 0.22
const APPENDABLE_QUEUE_RUNTIME_PROBE_INTERVAL_MS = 2000
const APPENDABLE_QUEUE_RUNTIME_PROBE_LOG_INTERVAL_MS = 8000
const APPENDABLE_QUEUE_RUNTIME_PROBE_DROP_DELTA_SEC = 0.22
const APPENDABLE_QUEUE_RUNTIME_READY_SOAK_SEC = 3
const APPENDABLE_ROUTE_SOAK_PILOT_DURATION_SEC = 8
const APPENDABLE_ROUTE_QUALIFICATION_PILOT_DURATION_SEC = 6
const APPENDABLE_ROUTE_QUALIFICATION_GRACE_SEC = 0.5
const APPENDABLE_ROUTE_STRESS_PILOT_HOLD_SEC = 2.5
const APPENDABLE_ROUTE_STRESS_PILOT_SEEK_SEQUENCE_SEC = [18, 46]
const SEEK_SMOOTH_DEBOUNCE_MS = 28
const SEEK_SMOOTH_CLOSE_RAMP_SEC = 0.008
const SEEK_SMOOTH_OPEN_RAMP_SEC = 0.03
const SEEK_SMOOTH_RESUME_DELAY_MS = 16
const SEEK_SMOOTH_RINGBUFFER_RESUME_DELAY_MS = 28
const SEEK_SMOOTH_RINGBUFFER_OPEN_RAMP_SEC = 0.042
const SEEK_SMOOTH_RINGBUFFER_BUFFERED_THRESHOLD_SEC = 0.18
const SEEK_SMOOTH_RINGBUFFER_FAST_RESUME_DELAY_MS = 8
const SEEK_SMOOTH_RINGBUFFER_FAST_OPEN_RAMP_SEC = 0.024
const SEEK_SMOOTH_RINGBUFFER_CLOSE_FLOOR_GAIN = 0.18
const SEEK_SMOOTH_RINGBUFFER_CROSSFADE_MID_GAIN = 0.58
const SEEK_SMOOTH_RINGBUFFER_CROSSFADE_MID_RAMP_SEC = 0.012
const SEEK_SMOOTH_RINGBUFFER_FAST_CROSSFADE_MID_RAMP_SEC = 0.008
const SCRUB_PREVIEW_LIVE_MIN_DELTA_SEC = 0.06
const SCRUB_PREVIEW_LIVE_MIN_INTERVAL_MS = 56
const TELEPROMPTER_AUTOCOLLECT_ENV_ENABLED = process.env.NEXT_PUBLIC_TELEPROMPTER_AUTOCOLLECT === "1"

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function readOptionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function createAppendableQueueRuntimeProbeSnapshot(): AppendableQueueRuntimeProbeSnapshot {
  return {
    active: false,
    sampleAtMs: null,
    currentSec: null,
    transportSec: null,
    supportsTempo: null,
    supportsIndependentPitch: null,
    tempo: null,
    pitchSemitones: null,
    dataPlaneMode: null,
    controlPlaneMode: null,
    preferredDataPlaneMode: null,
    sabCapable: null,
    sabReady: null,
    crossOriginIsolated: null,
    sabRequirement: null,
    sampleRates: [],
    appendMessageCount: 0,
    appendedMiB: null,
    stemDriftSec: null,
    transportDriftSec: null,
    minLeadSec: null,
    maxLeadSec: null,
    minObservedLeadSec: null,
    maxObservedLeadSec: null,
    minLowWaterSec: null,
    maxHighWaterSec: null,
    minRefillTriggerSec: null,
    dropDeltaSec: null,
    cleanSoakSec: null,
    readyThresholdSec: APPENDABLE_QUEUE_RUNTIME_READY_SOAK_SEC,
    totalUnderrunFrames: 0,
    totalDiscontinuityCount: 0,
    totalLowWaterBreachCount: 0,
    totalHighWaterBreachCount: 0,
    totalOverflowDropCount: 0,
    totalOverflowDroppedFrames: 0,
  }
}

function cloneAppendableQueueRuntimeProbeSnapshot(
  snapshot: AppendableQueueRuntimeProbeSnapshot
): AppendableQueueRuntimeProbeSnapshot {
  return {
    active: snapshot.active,
    sampleAtMs: snapshot.sampleAtMs,
    currentSec: snapshot.currentSec,
    transportSec: snapshot.transportSec,
    supportsTempo: snapshot.supportsTempo,
    supportsIndependentPitch: snapshot.supportsIndependentPitch,
    tempo: snapshot.tempo,
    pitchSemitones: snapshot.pitchSemitones,
    dataPlaneMode: snapshot.dataPlaneMode,
    controlPlaneMode: snapshot.controlPlaneMode,
    preferredDataPlaneMode: snapshot.preferredDataPlaneMode,
    sabCapable: snapshot.sabCapable,
    sabReady: snapshot.sabReady,
    crossOriginIsolated: snapshot.crossOriginIsolated,
    sabRequirement: snapshot.sabRequirement,
    sampleRates: snapshot.sampleRates.slice(),
    appendMessageCount: snapshot.appendMessageCount,
    appendedMiB: snapshot.appendedMiB,
    stemDriftSec: snapshot.stemDriftSec,
    transportDriftSec: snapshot.transportDriftSec,
    minLeadSec: snapshot.minLeadSec,
    maxLeadSec: snapshot.maxLeadSec,
    minObservedLeadSec: snapshot.minObservedLeadSec,
    maxObservedLeadSec: snapshot.maxObservedLeadSec,
    minLowWaterSec: snapshot.minLowWaterSec,
    maxHighWaterSec: snapshot.maxHighWaterSec,
    minRefillTriggerSec: snapshot.minRefillTriggerSec,
    dropDeltaSec: snapshot.dropDeltaSec,
    cleanSoakSec: snapshot.cleanSoakSec,
    readyThresholdSec: snapshot.readyThresholdSec,
    totalUnderrunFrames: snapshot.totalUnderrunFrames,
    totalDiscontinuityCount: snapshot.totalDiscontinuityCount,
    totalLowWaterBreachCount: snapshot.totalLowWaterBreachCount,
    totalHighWaterBreachCount: snapshot.totalHighWaterBreachCount,
    totalOverflowDropCount: snapshot.totalOverflowDropCount,
    totalOverflowDroppedFrames: snapshot.totalOverflowDroppedFrames,
  }
}

function createAppendableQueueSourceProgressSnapshot(): AppendableQueueSourceProgressSnapshot {
  return {
    mode: "off",
    manifestSlug: null,
    startupDurationSec: null,
    allStartupAppended: false,
    allFullDecoded: false,
    allFullAppended: false,
    continuationQualification: "off",
    continuationQualificationReason: null,
    safeRolloutCandidateQualified: false,
    safeRolloutCandidateTarget: null,
    continuationChunkGroupsAvailable: 0,
    continuationChunkGroupsPlanned: 0,
    continuationChunkGroupsDecoded: 0,
    continuationChunkGroupsAppended: 0,
    continuationCoverageEndSec: null,
    minSourceBufferedUntilSec: null,
    maxSourceBufferedUntilSec: null,
    minQueuedSegments: null,
    maxQueuedSegments: null,
    allSourceEnded: false,
  }
}

function cloneAppendableQueueSourceProgressSnapshot(
  snapshot: AppendableQueueSourceProgressSnapshot
): AppendableQueueSourceProgressSnapshot {
  return {
    mode: snapshot.mode,
    manifestSlug: snapshot.manifestSlug,
    startupDurationSec: snapshot.startupDurationSec,
    allStartupAppended: snapshot.allStartupAppended,
    allFullDecoded: snapshot.allFullDecoded,
    allFullAppended: snapshot.allFullAppended,
    continuationQualification: snapshot.continuationQualification,
    continuationQualificationReason: snapshot.continuationQualificationReason,
    safeRolloutCandidateQualified: snapshot.safeRolloutCandidateQualified,
    safeRolloutCandidateTarget: snapshot.safeRolloutCandidateTarget,
    continuationChunkGroupsAvailable: snapshot.continuationChunkGroupsAvailable,
    continuationChunkGroupsPlanned: snapshot.continuationChunkGroupsPlanned,
    continuationChunkGroupsDecoded: snapshot.continuationChunkGroupsDecoded,
    continuationChunkGroupsAppended: snapshot.continuationChunkGroupsAppended,
    continuationCoverageEndSec: snapshot.continuationCoverageEndSec,
    minSourceBufferedUntilSec: snapshot.minSourceBufferedUntilSec,
    maxSourceBufferedUntilSec: snapshot.maxSourceBufferedUntilSec,
    minQueuedSegments: snapshot.minQueuedSegments,
    maxQueuedSegments: snapshot.maxQueuedSegments,
    allSourceEnded: snapshot.allSourceEnded,
  }
}

function createAppendableContinuationPreflightState(): AppendableContinuationPreflightState {
  return {
    manifestSlug: null,
    qualification: "off",
    qualificationReason: null,
    safeRolloutCandidateQualified: false,
    safeRolloutCandidateTarget: null,
    availableGroupCount: 0,
    plannedGroupCount: 0,
    coverageEndSec: null,
  }
}

function readAppendableQueueSourceProgressSnapshot(
  coordinator: AppendableQueueMultitrackCoordinator | null,
  runtime: AppendableStartupHeadRuntimeState | null,
  preflight?: AppendableContinuationPreflightState | null
): AppendableQueueSourceProgressSnapshot {
  if (!coordinator) {
    return {
      ...createAppendableQueueSourceProgressSnapshot(),
      manifestSlug: preflight?.manifestSlug ?? null,
      continuationQualification: preflight?.qualification ?? "off",
      continuationQualificationReason: preflight?.qualificationReason ?? null,
      safeRolloutCandidateQualified: !!preflight?.safeRolloutCandidateQualified,
      safeRolloutCandidateTarget: preflight?.safeRolloutCandidateTarget ?? null,
      continuationChunkGroupsAvailable: preflight?.availableGroupCount ?? 0,
      continuationChunkGroupsPlanned: preflight?.plannedGroupCount ?? 0,
      continuationCoverageEndSec:
        typeof preflight?.coverageEndSec === "number" && Number.isFinite(preflight.coverageEndSec)
          ? Number(preflight.coverageEndSec.toFixed(3))
          : null,
    }
  }
  const snapshot = coordinator.getSnapshot()
  const sourceBufferedUntilSecs = snapshot.stems
    .map((stem) => stem.sourceBufferedUntilSec)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
  const queuedSegments = snapshot.stems
    .map((stem) => stem.sourceQueuedSegments)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
  return {
    mode: runtime?.mode ?? "full_buffer",
    manifestSlug: runtime?.manifestSlug ?? preflight?.manifestSlug ?? null,
    startupDurationSec:
      typeof runtime?.startupDurationSec === "number" && Number.isFinite(runtime.startupDurationSec)
        ? Number(runtime.startupDurationSec.toFixed(3))
        : null,
    allStartupAppended: snapshot.allStartupAppended,
    allFullDecoded: snapshot.allFullDecoded,
    allFullAppended: snapshot.allFullAppended,
    continuationQualification: runtime?.continuationQualification ?? preflight?.qualification ?? "off",
    continuationQualificationReason: runtime?.continuationQualificationReason ?? preflight?.qualificationReason ?? null,
    safeRolloutCandidateQualified:
      !!(runtime?.manifestSlug ?? preflight?.manifestSlug) &&
      (runtime?.continuationQualification ?? preflight?.qualification) === "qualified",
    safeRolloutCandidateTarget:
      (runtime?.continuationQualification ?? preflight?.qualification) === "qualified"
        ? runtime?.manifestSlug ?? preflight?.safeRolloutCandidateTarget ?? preflight?.manifestSlug ?? null
        : null,
    continuationChunkGroupsAvailable: runtime?.continuationChunkGroupsAvailable ?? preflight?.availableGroupCount ?? 0,
    continuationChunkGroupsPlanned: runtime?.continuationChunkGroupsPlanned ?? preflight?.plannedGroupCount ?? 0,
    continuationChunkGroupsDecoded: runtime?.continuationChunkGroupsDecoded ?? 0,
    continuationChunkGroupsAppended: runtime?.continuationChunkGroupsAppended ?? 0,
    continuationCoverageEndSec:
      typeof runtime?.continuationCoverageEndSec === "number" && Number.isFinite(runtime.continuationCoverageEndSec)
        ? Number(runtime.continuationCoverageEndSec.toFixed(3))
        : typeof preflight?.coverageEndSec === "number" && Number.isFinite(preflight.coverageEndSec)
          ? Number(preflight.coverageEndSec.toFixed(3))
        : null,
    minSourceBufferedUntilSec: sourceBufferedUntilSecs.length ? Number(Math.min(...sourceBufferedUntilSecs).toFixed(3)) : null,
    maxSourceBufferedUntilSec: sourceBufferedUntilSecs.length ? Number(Math.max(...sourceBufferedUntilSecs).toFixed(3)) : null,
    minQueuedSegments: queuedSegments.length ? Math.min(...queuedSegments) : null,
    maxQueuedSegments: queuedSegments.length ? Math.max(...queuedSegments) : null,
    allSourceEnded: snapshot.stems.length ? snapshot.stems.every((stem) => stem.sourceEnded) : false,
  }
}

function createAppendableRoutePilotReport(): AppendableRoutePilotReport {
  return {
    version: 1,
    updatedAt: null,
    status: "pending",
    notes: "",
    snapshot: null,
  }
}

function createAppendableRouteQualificationSnapshot(): AppendableRouteQualificationSnapshot {
  return {
    targetSoakSec: null,
    observedCleanSoakSec: null,
    passed: null,
    reason: null,
  }
}

function cloneAppendableRouteQualificationSnapshot(
  snapshot: AppendableRouteQualificationSnapshot
): AppendableRouteQualificationSnapshot {
  return {
    targetSoakSec: snapshot.targetSoakSec,
    observedCleanSoakSec: snapshot.observedCleanSoakSec,
    passed: snapshot.passed,
    reason: snapshot.reason,
  }
}

function createAppendableRouteStressSnapshot(): AppendableRouteStressSnapshot {
  return {
    holdPerSeekSec: null,
    seekSequenceSec: [],
    completedSeeks: 0,
    passed: null,
    reason: null,
  }
}

function createAppendableRouteVisibilitySnapshot(): AppendableRouteVisibilitySnapshot {
  return {
    currentState: null,
    lostForeground: false,
    blurCount: 0,
    focusCount: 0,
    pageHideCount: 0,
    pageShowCount: 0,
    visibilityHiddenCount: 0,
    visibilityVisibleCount: 0,
    hiddenWhilePlayingCount: 0,
    focusWhilePlayingCount: 0,
    lastEvent: null,
    lastEventAt: null,
  }
}

function createAppendableRouteTransportSnapshot(): AppendableRouteTransportSnapshot {
  return {
    supportsTempo: null,
    supportsIndependentPitch: null,
    tempo: null,
    pitchSemitones: null,
    dataPlaneMode: null,
    controlPlaneMode: null,
    preferredDataPlaneMode: null,
    sabCapable: null,
    sabReady: null,
    crossOriginIsolated: null,
    sabRequirement: null,
    sampleRates: [],
    appendMessageCount: 0,
    appendedMiB: null,
    minLeadSec: null,
    maxLeadSec: null,
    minObservedLeadSec: null,
    maxObservedLeadSec: null,
    minLowWaterSec: null,
    maxHighWaterSec: null,
    minRefillTriggerSec: null,
    totalUnderrunFrames: 0,
    totalDiscontinuityCount: 0,
    totalLowWaterBreachCount: 0,
    totalHighWaterBreachCount: 0,
    totalOverflowDropCount: 0,
    totalOverflowDroppedFrames: 0,
    passed: null,
    reason: null,
  }
}

function createAppendableRoutePitchSnapshot(): AppendableRoutePitchSnapshot {
  return {
    scenario: null,
    shadowEnabled: false,
    supportsTempo: null,
    supportsIndependentPitch: null,
    targetTempo: null,
    observedTempo: null,
    targetPitchSemitones: null,
    observedPitchSemitones: null,
    passed: null,
    reason: null,
  }
}

function createAppendableRouteRolloutSnapshot(): AppendableRouteRolloutSnapshot {
  return {
    status: "pending",
    gateReady: false,
    transportPassed: null,
    qualificationPassed: null,
    stressPassed: null,
    reason: null,
  }
}

function cloneAppendableRouteStressSnapshot(snapshot: AppendableRouteStressSnapshot): AppendableRouteStressSnapshot {
  return {
    holdPerSeekSec: snapshot.holdPerSeekSec,
    seekSequenceSec: snapshot.seekSequenceSec.slice(),
    completedSeeks: snapshot.completedSeeks,
    passed: snapshot.passed,
    reason: snapshot.reason,
  }
}

function cloneAppendableRouteVisibilitySnapshot(
  snapshot: AppendableRouteVisibilitySnapshot
): AppendableRouteVisibilitySnapshot {
  return {
    currentState: snapshot.currentState,
    lostForeground: snapshot.lostForeground,
    blurCount: snapshot.blurCount,
    focusCount: snapshot.focusCount,
    pageHideCount: snapshot.pageHideCount,
    pageShowCount: snapshot.pageShowCount,
    visibilityHiddenCount: snapshot.visibilityHiddenCount,
    visibilityVisibleCount: snapshot.visibilityVisibleCount,
    hiddenWhilePlayingCount: snapshot.hiddenWhilePlayingCount,
    focusWhilePlayingCount: snapshot.focusWhilePlayingCount,
    lastEvent: snapshot.lastEvent,
    lastEventAt: snapshot.lastEventAt,
  }
}

function hasAppendableRouteQualificationEvidence(snapshot: AppendableRouteQualificationSnapshot): boolean {
  return (
    snapshot.targetSoakSec != null ||
    snapshot.observedCleanSoakSec != null ||
    snapshot.passed != null ||
    snapshot.reason != null
  )
}

function hasAppendableRouteStressEvidence(snapshot: AppendableRouteStressSnapshot): boolean {
  return (
    snapshot.holdPerSeekSec != null ||
    snapshot.seekSequenceSec.length > 0 ||
    snapshot.completedSeeks > 0 ||
    snapshot.passed != null ||
    snapshot.reason != null
  )
}

function hasAppendableRouteVisibilityEvidence(snapshot: AppendableRouteVisibilitySnapshot): boolean {
  return (
    snapshot.currentState != null ||
    snapshot.lostForeground ||
    snapshot.blurCount > 0 ||
    snapshot.focusCount > 0 ||
    snapshot.pageHideCount > 0 ||
    snapshot.pageShowCount > 0 ||
    snapshot.visibilityHiddenCount > 0 ||
    snapshot.visibilityVisibleCount > 0 ||
    snapshot.hiddenWhilePlayingCount > 0 ||
    snapshot.focusWhilePlayingCount > 0 ||
    snapshot.lastEvent != null ||
    snapshot.lastEventAt != null
  )
}

function cloneAppendableRouteTransportSnapshot(
  snapshot: AppendableRouteTransportSnapshot
): AppendableRouteTransportSnapshot {
  return {
    supportsTempo: snapshot.supportsTempo,
    supportsIndependentPitch: snapshot.supportsIndependentPitch,
    tempo: snapshot.tempo,
    pitchSemitones: snapshot.pitchSemitones,
    dataPlaneMode: snapshot.dataPlaneMode,
    controlPlaneMode: snapshot.controlPlaneMode,
    preferredDataPlaneMode: snapshot.preferredDataPlaneMode,
    sabCapable: snapshot.sabCapable,
    sabReady: snapshot.sabReady,
    crossOriginIsolated: snapshot.crossOriginIsolated,
    sabRequirement: snapshot.sabRequirement,
    sampleRates: snapshot.sampleRates.slice(),
    appendMessageCount: snapshot.appendMessageCount,
    appendedMiB: snapshot.appendedMiB,
    minLeadSec: snapshot.minLeadSec,
    maxLeadSec: snapshot.maxLeadSec,
    minObservedLeadSec: snapshot.minObservedLeadSec,
    maxObservedLeadSec: snapshot.maxObservedLeadSec,
    minLowWaterSec: snapshot.minLowWaterSec,
    maxHighWaterSec: snapshot.maxHighWaterSec,
    minRefillTriggerSec: snapshot.minRefillTriggerSec,
    totalUnderrunFrames: snapshot.totalUnderrunFrames,
    totalDiscontinuityCount: snapshot.totalDiscontinuityCount,
    totalLowWaterBreachCount: snapshot.totalLowWaterBreachCount,
    totalHighWaterBreachCount: snapshot.totalHighWaterBreachCount,
    totalOverflowDropCount: snapshot.totalOverflowDropCount,
    totalOverflowDroppedFrames: snapshot.totalOverflowDroppedFrames,
    passed: snapshot.passed,
    reason: snapshot.reason,
  }
}

function cloneAppendableRoutePitchSnapshot(snapshot: AppendableRoutePitchSnapshot): AppendableRoutePitchSnapshot {
  return {
    scenario: snapshot.scenario,
    shadowEnabled: snapshot.shadowEnabled,
    supportsTempo: snapshot.supportsTempo,
    supportsIndependentPitch: snapshot.supportsIndependentPitch,
    targetTempo: snapshot.targetTempo,
    observedTempo: snapshot.observedTempo,
    targetPitchSemitones: snapshot.targetPitchSemitones,
    observedPitchSemitones: snapshot.observedPitchSemitones,
    passed: snapshot.passed,
    reason: snapshot.reason,
  }
}

function hasAppendableRouteTransportEvidence(snapshot: AppendableRouteTransportSnapshot): boolean {
  return (
    snapshot.supportsTempo != null ||
    snapshot.supportsIndependentPitch != null ||
    snapshot.tempo != null ||
    snapshot.pitchSemitones != null ||
    snapshot.dataPlaneMode != null ||
    snapshot.controlPlaneMode != null ||
    snapshot.preferredDataPlaneMode != null ||
    snapshot.sabCapable != null ||
    snapshot.sabReady != null ||
    snapshot.crossOriginIsolated != null ||
    snapshot.sabRequirement != null ||
    snapshot.sampleRates.length > 0 ||
    snapshot.appendMessageCount > 0 ||
    snapshot.appendedMiB != null ||
    snapshot.minLeadSec != null ||
    snapshot.maxLeadSec != null ||
    snapshot.minObservedLeadSec != null ||
    snapshot.maxObservedLeadSec != null ||
    snapshot.minLowWaterSec != null ||
    snapshot.maxHighWaterSec != null ||
    snapshot.minRefillTriggerSec != null ||
    snapshot.totalUnderrunFrames > 0 ||
    snapshot.totalDiscontinuityCount > 0 ||
    snapshot.totalLowWaterBreachCount > 0 ||
    snapshot.totalHighWaterBreachCount > 0 ||
    snapshot.totalOverflowDropCount > 0 ||
    snapshot.totalOverflowDroppedFrames > 0 ||
    snapshot.passed != null ||
    snapshot.reason != null
  )
}

function hasAppendableRoutePitchEvidence(snapshot: AppendableRoutePitchSnapshot): boolean {
  return (
    snapshot.scenario != null ||
    snapshot.shadowEnabled ||
    snapshot.supportsTempo != null ||
    snapshot.supportsIndependentPitch != null ||
    snapshot.targetTempo != null ||
    snapshot.observedTempo != null ||
    snapshot.targetPitchSemitones != null ||
    snapshot.observedPitchSemitones != null ||
    snapshot.passed != null ||
    snapshot.reason != null
  )
}

function cloneAppendableRouteRolloutSnapshot(snapshot: AppendableRouteRolloutSnapshot): AppendableRouteRolloutSnapshot {
  return {
    status: snapshot.status,
    gateReady: snapshot.gateReady,
    transportPassed: snapshot.transportPassed,
    qualificationPassed: snapshot.qualificationPassed,
    stressPassed: snapshot.stressPassed,
    reason: snapshot.reason,
  }
}

function preferLatestNullableNumber(current: number | null, previous: number | null): number | null {
  return current != null ? current : previous
}

function mergeMaxNullableNumber(current: number | null, previous: number | null): number | null {
  if (current == null) return previous
  if (previous == null) return current
  return Math.max(current, previous)
}

function mergeMinNullableNumber(current: number | null, previous: number | null): number | null {
  if (current == null) return previous
  if (previous == null) return current
  return Math.min(current, previous)
}

function mergeAppendableRouteTransportSnapshot(
  snapshot: AppendableRouteTransportSnapshot,
  previousSnapshot: AppendableRouteTransportSnapshot | null
): AppendableRouteTransportSnapshot {
  if (!previousSnapshot) return cloneAppendableRouteTransportSnapshot(snapshot)
  return {
    supportsTempo: snapshot.supportsTempo ?? previousSnapshot.supportsTempo,
    supportsIndependentPitch: snapshot.supportsIndependentPitch ?? previousSnapshot.supportsIndependentPitch,
    tempo: preferLatestNullableNumber(snapshot.tempo, previousSnapshot.tempo),
    pitchSemitones: preferLatestNullableNumber(snapshot.pitchSemitones, previousSnapshot.pitchSemitones),
    dataPlaneMode: snapshot.dataPlaneMode ?? previousSnapshot.dataPlaneMode,
    controlPlaneMode: snapshot.controlPlaneMode ?? previousSnapshot.controlPlaneMode,
    preferredDataPlaneMode: snapshot.preferredDataPlaneMode ?? previousSnapshot.preferredDataPlaneMode,
    sabCapable: snapshot.sabCapable ?? previousSnapshot.sabCapable,
    sabReady: snapshot.sabReady ?? previousSnapshot.sabReady,
    crossOriginIsolated: snapshot.crossOriginIsolated ?? previousSnapshot.crossOriginIsolated,
    sabRequirement: snapshot.sabRequirement ?? previousSnapshot.sabRequirement,
    sampleRates: snapshot.sampleRates.length ? snapshot.sampleRates.slice() : previousSnapshot.sampleRates.slice(),
    appendMessageCount: Math.max(snapshot.appendMessageCount, previousSnapshot.appendMessageCount),
    appendedMiB: mergeMaxNullableNumber(snapshot.appendedMiB, previousSnapshot.appendedMiB),
    minLeadSec: preferLatestNullableNumber(snapshot.minLeadSec, previousSnapshot.minLeadSec),
    maxLeadSec: preferLatestNullableNumber(snapshot.maxLeadSec, previousSnapshot.maxLeadSec),
    minObservedLeadSec: mergeMinNullableNumber(snapshot.minObservedLeadSec, previousSnapshot.minObservedLeadSec),
    maxObservedLeadSec: mergeMaxNullableNumber(snapshot.maxObservedLeadSec, previousSnapshot.maxObservedLeadSec),
    minLowWaterSec: mergeMinNullableNumber(snapshot.minLowWaterSec, previousSnapshot.minLowWaterSec),
    maxHighWaterSec: mergeMaxNullableNumber(snapshot.maxHighWaterSec, previousSnapshot.maxHighWaterSec),
    minRefillTriggerSec: mergeMinNullableNumber(snapshot.minRefillTriggerSec, previousSnapshot.minRefillTriggerSec),
    totalUnderrunFrames: Math.max(snapshot.totalUnderrunFrames, previousSnapshot.totalUnderrunFrames),
    totalDiscontinuityCount: Math.max(snapshot.totalDiscontinuityCount, previousSnapshot.totalDiscontinuityCount),
    totalLowWaterBreachCount: Math.max(snapshot.totalLowWaterBreachCount, previousSnapshot.totalLowWaterBreachCount),
    totalHighWaterBreachCount: Math.max(snapshot.totalHighWaterBreachCount, previousSnapshot.totalHighWaterBreachCount),
    totalOverflowDropCount: Math.max(snapshot.totalOverflowDropCount, previousSnapshot.totalOverflowDropCount),
    totalOverflowDroppedFrames: Math.max(
      snapshot.totalOverflowDroppedFrames,
      previousSnapshot.totalOverflowDroppedFrames
    ),
    passed: snapshot.passed ?? previousSnapshot.passed,
    reason: snapshot.reason ?? previousSnapshot.reason,
  }
}

function mergeAppendableRouteVisibilitySnapshot(
  snapshot: AppendableRouteVisibilitySnapshot,
  previousSnapshot: AppendableRouteVisibilitySnapshot | null
): AppendableRouteVisibilitySnapshot {
  if (!previousSnapshot) return cloneAppendableRouteVisibilitySnapshot(snapshot)
  return {
    currentState: snapshot.currentState ?? previousSnapshot.currentState,
    lostForeground: snapshot.lostForeground || previousSnapshot.lostForeground,
    blurCount: Math.max(snapshot.blurCount, previousSnapshot.blurCount),
    focusCount: Math.max(snapshot.focusCount, previousSnapshot.focusCount),
    pageHideCount: Math.max(snapshot.pageHideCount, previousSnapshot.pageHideCount),
    pageShowCount: Math.max(snapshot.pageShowCount, previousSnapshot.pageShowCount),
    visibilityHiddenCount: Math.max(snapshot.visibilityHiddenCount, previousSnapshot.visibilityHiddenCount),
    visibilityVisibleCount: Math.max(snapshot.visibilityVisibleCount, previousSnapshot.visibilityVisibleCount),
    hiddenWhilePlayingCount: Math.max(snapshot.hiddenWhilePlayingCount, previousSnapshot.hiddenWhilePlayingCount),
    focusWhilePlayingCount: Math.max(snapshot.focusWhilePlayingCount, previousSnapshot.focusWhilePlayingCount),
    lastEvent: snapshot.lastEvent ?? previousSnapshot.lastEvent,
    lastEventAt: snapshot.lastEventAt ?? previousSnapshot.lastEventAt,
  }
}

function mergeAppendableRoutePilotEvidenceSnapshot(
  snapshot: AppendableRoutePilotReportSnapshot,
  previousSnapshot: AppendableRoutePilotReportSnapshot | null
): AppendableRoutePilotReportSnapshot {
  if (!previousSnapshot || previousSnapshot.trackScopeId !== snapshot.trackScopeId) return snapshot
  return {
    ...snapshot,
    transport: hasAppendableRouteTransportEvidence(snapshot.transport)
      ? mergeAppendableRouteTransportSnapshot(snapshot.transport, previousSnapshot.transport)
      : cloneAppendableRouteTransportSnapshot(previousSnapshot.transport),
    qualification: hasAppendableRouteQualificationEvidence(snapshot.qualification)
      ? cloneAppendableRouteQualificationSnapshot(snapshot.qualification)
      : cloneAppendableRouteQualificationSnapshot(previousSnapshot.qualification),
    stress: hasAppendableRouteStressEvidence(snapshot.stress)
      ? cloneAppendableRouteStressSnapshot(snapshot.stress)
      : cloneAppendableRouteStressSnapshot(previousSnapshot.stress),
    visibility: hasAppendableRouteVisibilityEvidence(snapshot.visibility)
      ? mergeAppendableRouteVisibilitySnapshot(snapshot.visibility, previousSnapshot.visibility)
      : cloneAppendableRouteVisibilitySnapshot(previousSnapshot.visibility),
    pitch: hasAppendableRoutePitchEvidence(snapshot.pitch)
      ? cloneAppendableRoutePitchSnapshot(snapshot.pitch)
      : cloneAppendableRoutePitchSnapshot(previousSnapshot.pitch),
  }
}

function withAppendableRouteTransportSnapshot(
  snapshot: AppendableRoutePilotReportSnapshot
): AppendableRoutePilotReportSnapshot {
  const probe = snapshot.probe
  const transport = cloneAppendableRouteTransportSnapshot({
    supportsTempo: probe.supportsTempo,
    supportsIndependentPitch: probe.supportsIndependentPitch,
    tempo: probe.tempo,
    pitchSemitones: probe.pitchSemitones,
    dataPlaneMode: probe.dataPlaneMode,
    controlPlaneMode: probe.controlPlaneMode,
    preferredDataPlaneMode: probe.preferredDataPlaneMode,
    sabCapable: probe.sabCapable,
    sabReady: probe.sabReady,
    crossOriginIsolated: probe.crossOriginIsolated,
    sabRequirement: probe.sabRequirement,
    sampleRates: probe.sampleRates.slice(),
    appendMessageCount: probe.appendMessageCount,
    appendedMiB: probe.appendedMiB,
    minLeadSec: probe.minLeadSec,
    maxLeadSec: probe.maxLeadSec,
    minObservedLeadSec: probe.minObservedLeadSec,
    maxObservedLeadSec: probe.maxObservedLeadSec,
    minLowWaterSec: probe.minLowWaterSec,
    maxHighWaterSec: probe.maxHighWaterSec,
    minRefillTriggerSec: probe.minRefillTriggerSec,
    totalUnderrunFrames: probe.totalUnderrunFrames,
    totalDiscontinuityCount: probe.totalDiscontinuityCount,
    totalLowWaterBreachCount: probe.totalLowWaterBreachCount,
    totalHighWaterBreachCount: probe.totalHighWaterBreachCount,
    totalOverflowDropCount: probe.totalOverflowDropCount,
    totalOverflowDroppedFrames: probe.totalOverflowDroppedFrames,
    passed: null,
    reason: null,
  })

  if (!probe.active) {
    return {
      ...snapshot,
      transport,
    }
  }

  const supportedDataPlane = probe.dataPlaneMode === "postmessage_pcm" || probe.dataPlaneMode === "sab_ring"

  if (!supportedDataPlane) {
    transport.passed = false
    transport.reason = `data_plane:${probe.dataPlaneMode ?? "missing"}`
  } else if (probe.controlPlaneMode !== "message_port") {
    transport.passed = false
    transport.reason = `control_plane:${probe.controlPlaneMode ?? "missing"}`
  } else if (probe.sampleRates.length === 0) {
    transport.passed = false
    transport.reason = "sample_rates:missing"
  } else if (probe.sampleRates.length !== 1) {
    transport.passed = false
    transport.reason = "sample_rates:mixed"
  } else if (probe.dataPlaneMode === "postmessage_pcm" && probe.appendMessageCount <= 0) {
    transport.passed = false
    transport.reason = "append_messages:missing"
  } else if (probe.dataPlaneMode === "sab_ring" && (!probe.appendedMiB || probe.appendedMiB <= 0)) {
    transport.passed = false
    transport.reason = "appended_mib:missing"
  } else {
    transport.passed = true
    transport.reason = null
  }

  return {
    ...snapshot,
    transport,
  }
}

function withAppendableRouteRolloutSnapshot(
  snapshot: AppendableRoutePilotReportSnapshot
): AppendableRoutePilotReportSnapshot {
  const gateReady = snapshot.gate.status === "ready_for_manual_pilot"
  const transportPassed = snapshot.transport.passed
  const qualificationPassed = snapshot.qualification.passed
  const stressPassed = snapshot.stress.passed
  let status: AppendableRoutePilotReportStatus = "pending"
  let reason: string | null = null

  if (snapshot.gate.status === "attention_required") {
    status = "fail"
    reason = `gate:${snapshot.gate.status}`
  } else if (!gateReady) {
    reason = `gate:${snapshot.gate.status}`
  } else if (transportPassed == null) {
    reason = snapshot.transport.reason ? `transport:${snapshot.transport.reason}` : "transport:missing"
  } else if (!transportPassed) {
    status = "fail"
    reason = snapshot.transport.reason ? `transport:${snapshot.transport.reason}` : "transport:failed"
  } else if (qualificationPassed == null) {
    reason = "qualification:missing"
  } else if (!qualificationPassed) {
    status = "fail"
    reason = snapshot.qualification.reason ? `qualification:${snapshot.qualification.reason}` : "qualification:failed"
  } else if (stressPassed == null) {
    reason = "stress:missing"
  } else if (!stressPassed) {
    status = "fail"
    reason = snapshot.stress.reason ? `stress:${snapshot.stress.reason}` : "stress:failed"
  } else {
    status = "pass"
  }

  return {
    ...snapshot,
    rollout: {
      status,
      gateReady,
      transportPassed,
      qualificationPassed,
      stressPassed,
      reason,
    },
  }
}

function withAppendableRoutePitchSnapshot(
  snapshot: AppendableRoutePilotReportSnapshot,
  options: {
    scenario: string
    shadowEnabled: boolean
    targetTempo: number | null
    targetPitchSemitones: number | null
  }
): AppendableRoutePilotReportSnapshot {
  const safeTargetTempo =
    typeof options.targetTempo === "number" && Number.isFinite(options.targetTempo)
      ? Number(Math.min(4, Math.max(0.25, options.targetTempo)).toFixed(3))
      : null
  const safeTargetPitchSemitones =
    typeof options.targetPitchSemitones === "number" && Number.isFinite(options.targetPitchSemitones)
      ? Math.min(12, Math.max(-12, Math.round(options.targetPitchSemitones)))
      : null
  const observedTempo = snapshot.probe.tempo
  const observedPitchSemitones = snapshot.probe.pitchSemitones
  let passed = false
  let reason: string | null = null

  if (!options.shadowEnabled) {
    reason = "shadow_disabled"
  } else if (!snapshot.probe.active) {
    reason = "probe_inactive"
  } else if (snapshot.probe.supportsIndependentPitch !== true) {
    reason = "pitch_locked"
  } else if (safeTargetTempo != null && snapshot.probe.supportsTempo !== true) {
    reason = "tempo_locked"
  } else if (
    safeTargetTempo != null &&
    (observedTempo == null || Math.abs(observedTempo - safeTargetTempo) > 0.02)
  ) {
    reason = "tempo_not_converged"
  } else if (
    safeTargetPitchSemitones != null &&
    (observedPitchSemitones == null || Math.abs(observedPitchSemitones - safeTargetPitchSemitones) > 0.02)
  ) {
    reason = "pitch_not_converged"
  } else {
    passed = true
  }

  return {
    ...snapshot,
    pitch: {
      scenario: options.scenario,
      shadowEnabled: options.shadowEnabled,
      supportsTempo: snapshot.probe.supportsTempo,
      supportsIndependentPitch: snapshot.probe.supportsIndependentPitch,
      targetTempo: safeTargetTempo,
      observedTempo,
      targetPitchSemitones: safeTargetPitchSemitones,
      observedPitchSemitones,
      passed,
      reason,
    },
  }
}

function withAppendableRouteQualificationSnapshot(
  snapshot: AppendableRoutePilotReportSnapshot,
  targetSoakSec: number
): AppendableRoutePilotReportSnapshot {
  const observedCleanSoakSec = snapshot.probe.cleanSoakSec
  const safeTargetSoakSec = Math.max(1, Math.min(60, targetSoakSec))
  const cleanRuntime =
    snapshot.probe.totalUnderrunFrames === 0 && snapshot.probe.totalDiscontinuityCount === 0
  const soakFloor = Math.max(0, safeTargetSoakSec - APPENDABLE_ROUTE_QUALIFICATION_GRACE_SEC)
  let passed = false
  let reason: string | null = null

  if (snapshot.gate.status !== "ready_for_manual_pilot") {
    reason = `gate:${snapshot.gate.status}`
  } else if (!cleanRuntime) {
    reason = "runtime_not_clean"
  } else if (observedCleanSoakSec == null || observedCleanSoakSec < soakFloor) {
    reason = "clean_soak_below_target"
  } else {
    passed = true
  }

  return {
    ...snapshot,
    qualification: {
      targetSoakSec: safeTargetSoakSec,
      observedCleanSoakSec,
      passed,
      reason,
    },
  }
}

function withAppendableRouteStressSnapshot(
  snapshot: AppendableRoutePilotReportSnapshot,
  options: { holdPerSeekSec: number; seekSequenceSec: number[]; completedSeeks: number }
): AppendableRoutePilotReportSnapshot {
  const holdPerSeekSec = Math.max(1, Math.min(20, options.holdPerSeekSec))
  const seekSequenceSec = options.seekSequenceSec
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, value))
  const completedSeeks = Math.max(0, Math.min(seekSequenceSec.length, options.completedSeeks))
  const cleanRuntime =
    snapshot.probe.totalUnderrunFrames === 0 && snapshot.probe.totalDiscontinuityCount === 0
  let passed = false
  let reason: string | null = null

  if (snapshot.gate.status !== "ready_for_manual_pilot") {
    reason = `gate:${snapshot.gate.status}`
  } else if (!cleanRuntime) {
    reason = "runtime_not_clean"
  } else if (completedSeeks < seekSequenceSec.length) {
    reason = "incomplete_seek_sequence"
  } else {
    passed = true
  }

  return {
    ...snapshot,
    stress: {
      holdPerSeekSec,
      seekSequenceSec,
      completedSeeks,
      passed,
      reason,
    },
  }
}

function cloneAppendableRoutePilotReport(report: AppendableRoutePilotReport): AppendableRoutePilotReport {
  return {
    version: 1,
    updatedAt: report.updatedAt,
    status: report.status,
    notes: report.notes,
        snapshot: report.snapshot
      ? {
          capturedAt: report.snapshot.capturedAt,
          trackScopeId: report.snapshot.trackScopeId,
          audioMode: report.snapshot.audioMode,
          gate: {
            status: report.snapshot.gate.status,
            statusLabel: report.snapshot.gate.statusLabel,
          },
          flags: {
            appendableQueuePilotEnabled: report.snapshot.flags.appendableQueuePilotEnabled,
            appendableQueueMultistemPilotEnabled: report.snapshot.flags.appendableQueueMultistemPilotEnabled,
            appendableQueueStartupHeadPilotEnabled: report.snapshot.flags.appendableQueueStartupHeadPilotEnabled,
            appendableQueueContinuationChunksPilotEnabled:
              report.snapshot.flags.appendableQueueContinuationChunksPilotEnabled,
            appendableQueueShadowPitchEnabled: report.snapshot.flags.appendableQueueShadowPitchEnabled,
          },
          activation: {
            configured: report.snapshot.activation.configured,
            allowed: report.snapshot.activation.allowed,
            mode: report.snapshot.activation.mode,
            tempoControlUnlocked: report.snapshot.activation.tempoControlUnlocked,
            pitchShadowActive: report.snapshot.activation.pitchShadowActive,
            matchedTarget: report.snapshot.activation.matchedTarget,
            currentTargets: report.snapshot.activation.currentTargets.slice(),
            configuredTargets: report.snapshot.activation.configuredTargets.slice(),
            targetedPilotConfiguredTargets: report.snapshot.activation.targetedPilotConfiguredTargets.slice(),
            safeRolloutConfiguredTargets: report.snapshot.activation.safeRolloutConfiguredTargets.slice(),
          },
          probe: cloneAppendableQueueRuntimeProbeSnapshot(report.snapshot.probe),
          sourceProgress: cloneAppendableQueueSourceProgressSnapshot(report.snapshot.sourceProgress),
          transport: cloneAppendableRouteTransportSnapshot(report.snapshot.transport),
          qualification: cloneAppendableRouteQualificationSnapshot(report.snapshot.qualification),
          stress: cloneAppendableRouteStressSnapshot(report.snapshot.stress),
          visibility: cloneAppendableRouteVisibilitySnapshot(report.snapshot.visibility),
          pitch: cloneAppendableRoutePitchSnapshot(report.snapshot.pitch),
          rollout: cloneAppendableRouteRolloutSnapshot(report.snapshot.rollout),
        }
      : null,
  }
}

function restoreAppendableRoutePilotReport(raw: string | null): AppendableRoutePilotReport | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AppendableRoutePilotReport> | null
    if (!parsed || parsed.version !== 1) return null
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      status: parsed.status === "pass" || parsed.status === "fail" ? parsed.status : "pending",
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
      snapshot:
        parsed.snapshot &&
        typeof parsed.snapshot === "object" &&
        typeof parsed.snapshot.capturedAt === "string" &&
        typeof parsed.snapshot.trackScopeId === "string"
          ? {
              capturedAt: parsed.snapshot.capturedAt,
              trackScopeId: parsed.snapshot.trackScopeId,
              audioMode:
                parsed.snapshot.audioMode === "appendable_queue_worklet" ||
                parsed.snapshot.audioMode === "ringbuffer_worklet" ||
                parsed.snapshot.audioMode === "streaming_media"
                  ? parsed.snapshot.audioMode
                  : "soundtouch",
              gate: {
                status:
                  parsed.snapshot.gate?.status === "blocked_by_targeting" ||
                  parsed.snapshot.gate?.status === "play_to_activate_probe" ||
                  parsed.snapshot.gate?.status === "soak_in_progress" ||
                  parsed.snapshot.gate?.status === "ready_for_manual_pilot" ||
                  parsed.snapshot.gate?.status === "attention_required"
                    ? parsed.snapshot.gate.status
                    : "waiting_for_flags",
                statusLabel:
                  typeof parsed.snapshot.gate?.statusLabel === "string" ? parsed.snapshot.gate.statusLabel : "unknown",
              },
              flags: {
                appendableQueuePilotEnabled: !!parsed.snapshot.flags?.appendableQueuePilotEnabled,
                appendableQueueMultistemPilotEnabled: !!parsed.snapshot.flags?.appendableQueueMultistemPilotEnabled,
                appendableQueueStartupHeadPilotEnabled: !!parsed.snapshot.flags?.appendableQueueStartupHeadPilotEnabled,
                appendableQueueContinuationChunksPilotEnabled:
                  !!parsed.snapshot.flags?.appendableQueueContinuationChunksPilotEnabled,
                appendableQueueShadowPitchEnabled: !!parsed.snapshot.flags?.appendableQueueShadowPitchEnabled,
              },
              activation: {
                configured: !!parsed.snapshot.activation?.configured,
                allowed: parsed.snapshot.activation?.allowed == null ? true : !!parsed.snapshot.activation?.allowed,
                mode:
                  parsed.snapshot.activation?.mode === "targeted_pilot" ||
                  parsed.snapshot.activation?.mode === "safe_rollout"
                    ? parsed.snapshot.activation.mode
                    : "unscoped",
                tempoControlUnlocked:
                  parsed.snapshot.activation?.tempoControlUnlocked == null
                    ? true
                    : !!parsed.snapshot.activation?.tempoControlUnlocked,
                pitchShadowActive: !!parsed.snapshot.activation?.pitchShadowActive,
                matchedTarget:
                  typeof parsed.snapshot.activation?.matchedTarget === "string"
                    ? parsed.snapshot.activation.matchedTarget
                    : null,
                currentTargets: Array.isArray(parsed.snapshot.activation?.currentTargets)
                  ? parsed.snapshot.activation.currentTargets.filter(
                      (target): target is string => typeof target === "string" && target.trim().length > 0
                    )
                  : [],
                configuredTargets: Array.isArray(parsed.snapshot.activation?.configuredTargets)
                  ? parsed.snapshot.activation.configuredTargets.filter(
                      (target): target is string => typeof target === "string" && target.trim().length > 0
                    )
                  : [],
                targetedPilotConfiguredTargets: Array.isArray(parsed.snapshot.activation?.targetedPilotConfiguredTargets)
                  ? parsed.snapshot.activation.targetedPilotConfiguredTargets.filter(
                      (target): target is string => typeof target === "string" && target.trim().length > 0
                    )
                  : [],
                safeRolloutConfiguredTargets: Array.isArray(parsed.snapshot.activation?.safeRolloutConfiguredTargets)
                  ? parsed.snapshot.activation.safeRolloutConfiguredTargets.filter(
                      (target): target is string => typeof target === "string" && target.trim().length > 0
                    )
                  : [],
              },
              probe: cloneAppendableQueueRuntimeProbeSnapshot({
                ...createAppendableQueueRuntimeProbeSnapshot(),
                ...(parsed.snapshot.probe ?? {}),
              }),
              sourceProgress: cloneAppendableQueueSourceProgressSnapshot({
                ...createAppendableQueueSourceProgressSnapshot(),
                ...(parsed.snapshot.sourceProgress ?? {}),
              }),
              transport:
                parsed.snapshot.transport && typeof parsed.snapshot.transport === "object"
                  ? {
                      supportsTempo:
                        typeof parsed.snapshot.transport.supportsTempo === "boolean"
                          ? parsed.snapshot.transport.supportsTempo
                          : null,
                      supportsIndependentPitch:
                        typeof parsed.snapshot.transport.supportsIndependentPitch === "boolean"
                          ? parsed.snapshot.transport.supportsIndependentPitch
                          : null,
                      tempo:
                        typeof parsed.snapshot.transport.tempo === "number" &&
                        Number.isFinite(parsed.snapshot.transport.tempo)
                          ? parsed.snapshot.transport.tempo
                          : null,
                      pitchSemitones:
                        typeof parsed.snapshot.transport.pitchSemitones === "number" &&
                        Number.isFinite(parsed.snapshot.transport.pitchSemitones)
                          ? parsed.snapshot.transport.pitchSemitones
                          : null,
                      dataPlaneMode:
                        typeof parsed.snapshot.transport.dataPlaneMode === "string"
                          ? parsed.snapshot.transport.dataPlaneMode
                          : null,
                      controlPlaneMode:
                        typeof parsed.snapshot.transport.controlPlaneMode === "string"
                          ? parsed.snapshot.transport.controlPlaneMode
                          : null,
                      preferredDataPlaneMode:
                        typeof parsed.snapshot.transport.preferredDataPlaneMode === "string"
                          ? parsed.snapshot.transport.preferredDataPlaneMode
                          : null,
                      sabCapable:
                        typeof parsed.snapshot.transport.sabCapable === "boolean"
                          ? parsed.snapshot.transport.sabCapable
                          : null,
                      sabReady:
                        typeof parsed.snapshot.transport.sabReady === "boolean"
                          ? parsed.snapshot.transport.sabReady
                          : null,
                      crossOriginIsolated:
                        typeof parsed.snapshot.transport.crossOriginIsolated === "boolean"
                          ? parsed.snapshot.transport.crossOriginIsolated
                          : null,
                      sabRequirement:
                        typeof parsed.snapshot.transport.sabRequirement === "string"
                          ? parsed.snapshot.transport.sabRequirement
                          : null,
                      sampleRates: Array.isArray(parsed.snapshot.transport.sampleRates)
                        ? parsed.snapshot.transport.sampleRates.filter(
                            (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
                          )
                        : [],
                      appendMessageCount:
                        typeof parsed.snapshot.transport.appendMessageCount === "number" &&
                        Number.isFinite(parsed.snapshot.transport.appendMessageCount)
                          ? parsed.snapshot.transport.appendMessageCount
                          : 0,
                      appendedMiB:
                        typeof parsed.snapshot.transport.appendedMiB === "number" &&
                        Number.isFinite(parsed.snapshot.transport.appendedMiB)
                          ? parsed.snapshot.transport.appendedMiB
                          : null,
                      minLeadSec:
                        typeof parsed.snapshot.transport.minLeadSec === "number" &&
                        Number.isFinite(parsed.snapshot.transport.minLeadSec)
                          ? parsed.snapshot.transport.minLeadSec
                          : null,
                      maxLeadSec:
                        typeof parsed.snapshot.transport.maxLeadSec === "number" &&
                        Number.isFinite(parsed.snapshot.transport.maxLeadSec)
                          ? parsed.snapshot.transport.maxLeadSec
                          : null,
                      minObservedLeadSec:
                        typeof parsed.snapshot.transport.minObservedLeadSec === "number" &&
                        Number.isFinite(parsed.snapshot.transport.minObservedLeadSec)
                          ? parsed.snapshot.transport.minObservedLeadSec
                          : null,
                      maxObservedLeadSec:
                        typeof parsed.snapshot.transport.maxObservedLeadSec === "number" &&
                        Number.isFinite(parsed.snapshot.transport.maxObservedLeadSec)
                          ? parsed.snapshot.transport.maxObservedLeadSec
                          : null,
                      minLowWaterSec:
                        typeof parsed.snapshot.transport.minLowWaterSec === "number" &&
                        Number.isFinite(parsed.snapshot.transport.minLowWaterSec)
                          ? parsed.snapshot.transport.minLowWaterSec
                          : null,
                      maxHighWaterSec:
                        typeof parsed.snapshot.transport.maxHighWaterSec === "number" &&
                        Number.isFinite(parsed.snapshot.transport.maxHighWaterSec)
                          ? parsed.snapshot.transport.maxHighWaterSec
                          : null,
                      minRefillTriggerSec:
                        typeof parsed.snapshot.transport.minRefillTriggerSec === "number" &&
                        Number.isFinite(parsed.snapshot.transport.minRefillTriggerSec)
                          ? parsed.snapshot.transport.minRefillTriggerSec
                          : null,
                      totalUnderrunFrames:
                        typeof parsed.snapshot.transport.totalUnderrunFrames === "number" &&
                        Number.isFinite(parsed.snapshot.transport.totalUnderrunFrames)
                          ? parsed.snapshot.transport.totalUnderrunFrames
                          : 0,
                      totalDiscontinuityCount:
                        typeof parsed.snapshot.transport.totalDiscontinuityCount === "number" &&
                        Number.isFinite(parsed.snapshot.transport.totalDiscontinuityCount)
                          ? parsed.snapshot.transport.totalDiscontinuityCount
                          : 0,
                      totalLowWaterBreachCount:
                        typeof parsed.snapshot.transport.totalLowWaterBreachCount === "number" &&
                        Number.isFinite(parsed.snapshot.transport.totalLowWaterBreachCount)
                          ? parsed.snapshot.transport.totalLowWaterBreachCount
                          : 0,
                      totalHighWaterBreachCount:
                        typeof parsed.snapshot.transport.totalHighWaterBreachCount === "number" &&
                        Number.isFinite(parsed.snapshot.transport.totalHighWaterBreachCount)
                          ? parsed.snapshot.transport.totalHighWaterBreachCount
                          : 0,
                      totalOverflowDropCount:
                        typeof parsed.snapshot.transport.totalOverflowDropCount === "number" &&
                        Number.isFinite(parsed.snapshot.transport.totalOverflowDropCount)
                          ? parsed.snapshot.transport.totalOverflowDropCount
                          : 0,
                      totalOverflowDroppedFrames:
                        typeof parsed.snapshot.transport.totalOverflowDroppedFrames === "number" &&
                        Number.isFinite(parsed.snapshot.transport.totalOverflowDroppedFrames)
                          ? parsed.snapshot.transport.totalOverflowDroppedFrames
                          : 0,
                      passed:
                        typeof parsed.snapshot.transport.passed === "boolean"
                          ? parsed.snapshot.transport.passed
                          : null,
                      reason:
                        typeof parsed.snapshot.transport.reason === "string"
                          ? parsed.snapshot.transport.reason
                          : null,
                    }
                  : createAppendableRouteTransportSnapshot(),
              qualification:
                parsed.snapshot.qualification && typeof parsed.snapshot.qualification === "object"
                  ? {
                      targetSoakSec:
                        typeof parsed.snapshot.qualification.targetSoakSec === "number" &&
                        Number.isFinite(parsed.snapshot.qualification.targetSoakSec)
                          ? parsed.snapshot.qualification.targetSoakSec
                          : null,
                      observedCleanSoakSec:
                        typeof parsed.snapshot.qualification.observedCleanSoakSec === "number" &&
                        Number.isFinite(parsed.snapshot.qualification.observedCleanSoakSec)
                          ? parsed.snapshot.qualification.observedCleanSoakSec
                          : null,
                      passed:
                        typeof parsed.snapshot.qualification.passed === "boolean"
                          ? parsed.snapshot.qualification.passed
                          : null,
                      reason:
                        typeof parsed.snapshot.qualification.reason === "string"
                          ? parsed.snapshot.qualification.reason
                          : null,
                    }
                  : createAppendableRouteQualificationSnapshot(),
              stress:
                parsed.snapshot.stress && typeof parsed.snapshot.stress === "object"
                  ? {
                      holdPerSeekSec:
                        typeof parsed.snapshot.stress.holdPerSeekSec === "number" &&
                        Number.isFinite(parsed.snapshot.stress.holdPerSeekSec)
                          ? parsed.snapshot.stress.holdPerSeekSec
                          : null,
                      seekSequenceSec: Array.isArray(parsed.snapshot.stress.seekSequenceSec)
                        ? parsed.snapshot.stress.seekSequenceSec.filter(
                            (value): value is number => typeof value === "number" && Number.isFinite(value)
                          )
                        : [],
                      completedSeeks:
                        typeof parsed.snapshot.stress.completedSeeks === "number" &&
                        Number.isFinite(parsed.snapshot.stress.completedSeeks)
                          ? parsed.snapshot.stress.completedSeeks
                          : 0,
                      passed:
                        typeof parsed.snapshot.stress.passed === "boolean" ? parsed.snapshot.stress.passed : null,
                      reason:
                        typeof parsed.snapshot.stress.reason === "string" ? parsed.snapshot.stress.reason : null,
                    }
                  : createAppendableRouteStressSnapshot(),
              visibility:
                parsed.snapshot.visibility && typeof parsed.snapshot.visibility === "object"
                  ? (() => {
                      const legacyVisibility = parsed.snapshot.visibility as {
                        wasHidden?: unknown
                        lostForeground?: unknown
                      }
                      return {
                      currentState:
                        parsed.snapshot.visibility.currentState === "visible" ||
                        parsed.snapshot.visibility.currentState === "hidden"
                          ? parsed.snapshot.visibility.currentState
                          : null,
                      lostForeground:
                        legacyVisibility.lostForeground == null ? !!legacyVisibility.wasHidden : !!legacyVisibility.lostForeground,
                      blurCount:
                        typeof parsed.snapshot.visibility.blurCount === "number" &&
                        Number.isFinite(parsed.snapshot.visibility.blurCount)
                          ? parsed.snapshot.visibility.blurCount
                          : 0,
                      focusCount:
                        typeof parsed.snapshot.visibility.focusCount === "number" &&
                        Number.isFinite(parsed.snapshot.visibility.focusCount)
                          ? parsed.snapshot.visibility.focusCount
                          : 0,
                      pageHideCount:
                        typeof parsed.snapshot.visibility.pageHideCount === "number" &&
                        Number.isFinite(parsed.snapshot.visibility.pageHideCount)
                          ? parsed.snapshot.visibility.pageHideCount
                          : 0,
                      pageShowCount:
                        typeof parsed.snapshot.visibility.pageShowCount === "number" &&
                        Number.isFinite(parsed.snapshot.visibility.pageShowCount)
                          ? parsed.snapshot.visibility.pageShowCount
                          : 0,
                      visibilityHiddenCount:
                        typeof parsed.snapshot.visibility.visibilityHiddenCount === "number" &&
                        Number.isFinite(parsed.snapshot.visibility.visibilityHiddenCount)
                          ? parsed.snapshot.visibility.visibilityHiddenCount
                          : 0,
                      visibilityVisibleCount:
                        typeof parsed.snapshot.visibility.visibilityVisibleCount === "number" &&
                        Number.isFinite(parsed.snapshot.visibility.visibilityVisibleCount)
                          ? parsed.snapshot.visibility.visibilityVisibleCount
                          : 0,
                      hiddenWhilePlayingCount:
                        typeof parsed.snapshot.visibility.hiddenWhilePlayingCount === "number" &&
                        Number.isFinite(parsed.snapshot.visibility.hiddenWhilePlayingCount)
                          ? parsed.snapshot.visibility.hiddenWhilePlayingCount
                          : 0,
                      focusWhilePlayingCount:
                        typeof parsed.snapshot.visibility.focusWhilePlayingCount === "number" &&
                        Number.isFinite(parsed.snapshot.visibility.focusWhilePlayingCount)
                          ? parsed.snapshot.visibility.focusWhilePlayingCount
                          : 0,
                      lastEvent:
                        parsed.snapshot.visibility.lastEvent === "window:blur" ||
                        parsed.snapshot.visibility.lastEvent === "window:focus" ||
                        parsed.snapshot.visibility.lastEvent === "window:pagehide" ||
                        parsed.snapshot.visibility.lastEvent === "window:pageshow" ||
                        parsed.snapshot.visibility.lastEvent === "document:hidden" ||
                        parsed.snapshot.visibility.lastEvent === "document:visible"
                          ? parsed.snapshot.visibility.lastEvent
                          : null,
                      lastEventAt:
                        typeof parsed.snapshot.visibility.lastEventAt === "string"
                          ? parsed.snapshot.visibility.lastEventAt
                          : null,
                    }})()
                  : createAppendableRouteVisibilitySnapshot(),
              pitch:
                parsed.snapshot.pitch && typeof parsed.snapshot.pitch === "object"
                  ? {
                      scenario:
                        typeof parsed.snapshot.pitch.scenario === "string" ? parsed.snapshot.pitch.scenario : null,
                      shadowEnabled: !!parsed.snapshot.pitch.shadowEnabled,
                      supportsTempo:
                        typeof parsed.snapshot.pitch.supportsTempo === "boolean"
                          ? parsed.snapshot.pitch.supportsTempo
                          : null,
                      supportsIndependentPitch:
                        typeof parsed.snapshot.pitch.supportsIndependentPitch === "boolean"
                          ? parsed.snapshot.pitch.supportsIndependentPitch
                          : null,
                      targetTempo:
                        typeof parsed.snapshot.pitch.targetTempo === "number" &&
                        Number.isFinite(parsed.snapshot.pitch.targetTempo)
                          ? parsed.snapshot.pitch.targetTempo
                          : null,
                      observedTempo:
                        typeof parsed.snapshot.pitch.observedTempo === "number" &&
                        Number.isFinite(parsed.snapshot.pitch.observedTempo)
                          ? parsed.snapshot.pitch.observedTempo
                          : null,
                      targetPitchSemitones:
                        typeof parsed.snapshot.pitch.targetPitchSemitones === "number" &&
                        Number.isFinite(parsed.snapshot.pitch.targetPitchSemitones)
                          ? parsed.snapshot.pitch.targetPitchSemitones
                          : null,
                      observedPitchSemitones:
                        typeof parsed.snapshot.pitch.observedPitchSemitones === "number" &&
                        Number.isFinite(parsed.snapshot.pitch.observedPitchSemitones)
                          ? parsed.snapshot.pitch.observedPitchSemitones
                          : null,
                      passed:
                        typeof parsed.snapshot.pitch.passed === "boolean" ? parsed.snapshot.pitch.passed : null,
                      reason:
                        typeof parsed.snapshot.pitch.reason === "string" ? parsed.snapshot.pitch.reason : null,
                    }
                  : createAppendableRoutePitchSnapshot(),
              rollout:
                parsed.snapshot.rollout && typeof parsed.snapshot.rollout === "object"
                  ? {
                      status:
                        parsed.snapshot.rollout.status === "pass" || parsed.snapshot.rollout.status === "fail"
                          ? parsed.snapshot.rollout.status
                          : "pending",
                      gateReady: !!parsed.snapshot.rollout.gateReady,
                      transportPassed:
                        typeof parsed.snapshot.rollout.transportPassed === "boolean"
                          ? parsed.snapshot.rollout.transportPassed
                          : null,
                      qualificationPassed:
                        typeof parsed.snapshot.rollout.qualificationPassed === "boolean"
                          ? parsed.snapshot.rollout.qualificationPassed
                          : null,
                      stressPassed:
                        typeof parsed.snapshot.rollout.stressPassed === "boolean"
                          ? parsed.snapshot.rollout.stressPassed
                          : null,
                      reason:
                        typeof parsed.snapshot.rollout.reason === "string" ? parsed.snapshot.rollout.reason : null,
                    }
                  : createAppendableRouteRolloutSnapshot(),
            }
          : null,
    }
  } catch {
    return null
  }
}

function formatOptionalFixed(value: number | null | undefined, digits = 3) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—"
}

function resolveAppendableRoutePilotAutoStatus(
  snapshot: AppendableRoutePilotReportSnapshot
): AppendableRoutePilotReportStatus {
  return snapshot.rollout.status
}

function getStartupChunkHandoffAtSec(runtime: StartupChunkRuntimeState): number {
  return Math.max(
    0,
    runtime.startupDurationSec -
      Math.max(runtime.crossfadeSec, STARTUP_CHUNK_HANDOFF_OVERLAP_SEC, STARTUP_CHUNK_HANDOFF_LEAD_SEC)
  )
}

function getStartupChunkTailHandoffAtSec(runtime: StartupChunkRuntimeState): number {
  if (runtime.tailStartSec == null || !Number.isFinite(runtime.tailStartSec)) {
    return getStartupChunkHandoffAtSec(runtime)
  }
  return Math.max(runtime.tailStartSec, getStartupChunkHandoffAtSec(runtime))
}

function getStartupChunkFullHandoffAtSec(runtime: StartupChunkRuntimeState): number {
  if (runtime.tailStartSec == null || runtime.tailDurationSec == null) {
    return getStartupChunkHandoffAtSec(runtime)
  }
  return Math.max(
    getStartupChunkTailHandoffAtSec(runtime),
    runtime.tailStartSec + runtime.tailDurationSec - Math.max(runtime.crossfadeSec, STARTUP_CHUNK_HANDOFF_OVERLAP_SEC)
  )
}

function getStartupChunkEffectiveDurationSec(
  sourceWindowDurationSec: number,
  sourceOffsetSec: number,
  reportedDurationSec?: number
): number | undefined {
  if (Number.isFinite(reportedDurationSec as number) && (reportedDurationSec as number) > 0) {
    return reportedDurationSec as number
  }
  if (sourceWindowDurationSec <= 0) return undefined
  return sourceOffsetSec > 0 ? sourceOffsetSec + sourceWindowDurationSec : sourceWindowDurationSec
}

function getStartupChunkSwapPlan(
  runtime: StartupChunkRuntimeState,
  safePosSec: number
): StartupChunkSwapPlan | null {
  if (runtime.strategy === "splice") {
    const tailHandoffAtSec = getStartupChunkTailHandoffAtSec(runtime)
    const fullHandoffAtSec = getStartupChunkFullHandoffAtSec(runtime)
    if (runtime.stage === "startup" && safePosSec >= fullHandoffAtSec && runtime.fullBuffersReady && runtime.fullBuffers?.length) {
      return {
        swapLabel: "full_handoff",
        sourceOffsetSec: 0,
        stageAfterSwap: "full",
        disableRuntimeAfterSwap: true,
      }
    }
    if (runtime.stage === "startup" && safePosSec >= tailHandoffAtSec && runtime.tailBuffersReady && runtime.tailBuffers?.length) {
      return {
        swapLabel: "tail_handoff",
        sourceOffsetSec: runtime.tailStartSec ?? 0,
        stageAfterSwap: "tail",
        disableRuntimeAfterSwap: false,
      }
    }
    if (runtime.fullBuffersReady && runtime.fullBuffers?.length) {
      return {
        swapLabel: "full_handoff",
        sourceOffsetSec: 0,
        stageAfterSwap: "full",
        disableRuntimeAfterSwap: true,
      }
    }
    return null
  }

  if (runtime.fullBuffersReady && runtime.fullBuffers?.length) {
    return {
      swapLabel: "handoff",
      sourceOffsetSec: 0,
      stageAfterSwap: "full",
      disableRuntimeAfterSwap: true,
    }
  }

  return null
}

const RECORD_STREAM_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
  },
}

type PianoKey = {
  note: string
  freq: number
  isBlack?: boolean
  kbd?: string
  kbdRu?: string
  left?: number
}

type WavePeaksCacheEntry = {
  peaks: WavePeaks
  quality: "preview" | "full"
  updatedAt: number
}

const waveformPeaksCache = new Map<string, WavePeaksCacheEntry>()

function getWavePeaksCacheKey(src: string, buckets = DEFERRED_PEAKS_BUCKETS) {
  return `${src}::${buckets}`
}

function readCachedWavePeaksEntry(src: string, buckets = DEFERRED_PEAKS_BUCKETS): WavePeaksCacheEntry | null {
  const entry = waveformPeaksCache.get(getWavePeaksCacheKey(src, buckets))
  if (!entry) return null
  // Touch for simple LRU behavior.
  waveformPeaksCache.delete(getWavePeaksCacheKey(src, buckets))
  waveformPeaksCache.set(getWavePeaksCacheKey(src, buckets), { ...entry, updatedAt: Date.now() })
  return entry
}

function readCachedWavePeaks(src: string, buckets = DEFERRED_PEAKS_BUCKETS): WavePeaks | null {
  return readCachedWavePeaksEntry(src, buckets)?.peaks ?? null
}

function readCachedFullWavePeaks(src: string, buckets = DEFERRED_PEAKS_BUCKETS): WavePeaks | null {
  const entry = readCachedWavePeaksEntry(src, buckets)
  if (!entry || entry.quality !== "full") return null
  return entry.peaks
}

function writeCachedWavePeaks(
  src: string,
  peaks: WavePeaks,
  buckets = DEFERRED_PEAKS_BUCKETS,
  quality: "preview" | "full" = "full"
) {
  const key = getWavePeaksCacheKey(src, buckets)
  const existing = waveformPeaksCache.get(key)
  if (existing?.quality === "full" && quality === "preview") {
    waveformPeaksCache.delete(key)
    waveformPeaksCache.set(key, {
      ...existing,
      updatedAt: Date.now(),
    })
    return
  }
  waveformPeaksCache.delete(key)
  waveformPeaksCache.set(key, {
    peaks,
    quality,
    updatedAt: Date.now(),
  })
  while (waveformPeaksCache.size > WAVEFORM_PEAKS_CACHE_LIMIT) {
    const oldestKey = waveformPeaksCache.keys().next().value
    if (!oldestKey) break
    waveformPeaksCache.delete(oldestKey)
  }
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const
const PIANO_WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23] as const
const PIANO_BLACK_OFFSETS = [
  { semi: 1, afterWhiteIndex: 0 },
  { semi: 3, afterWhiteIndex: 1 },
  { semi: 6, afterWhiteIndex: 3 },
  { semi: 8, afterWhiteIndex: 4 },
  { semi: 10, afterWhiteIndex: 5 },
  { semi: 13, afterWhiteIndex: 7 },
  { semi: 15, afterWhiteIndex: 8 },
  { semi: 18, afterWhiteIndex: 10 },
  { semi: 20, afterWhiteIndex: 11 },
  { semi: 22, afterWhiteIndex: 12 },
] as const
const PIANO_WHITE_KEYS_EN = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "z", "x", "c", "v"] as const
const PIANO_WHITE_KEYS_RU = ["ф", "ы", "в", "а", "п", "р", "о", "л", "д", "ж", "я", "ч", "с", "м"] as const
const PIANO_BLACK_KEYS_EN = ["w", "e", "t", "y", "u", "o", "p", "1", "2", "3"] as const
const PIANO_BLACK_KEYS_RU = ["ц", "у", "е", "н", "г", "щ", "з", "1", "2", "3"] as const
const OCTAVE_NAMES = ["Субконтр", "Контр", "Большая", "Малая", "1-я", "2-я", "3-я", "4-я"] as const

const MULTITRACK_LEGACY_MESSAGES: Record<UiLang, Record<string, string>> = {
  ru: {
    "multitrack.volume": "Громкость",
    "multitrack.reverb": "Реверб",
    "multitrack.speed": "Скорость",
    "multitrack.pitch": "Высота",
    "multitrack.pan": "Пан",
    "multitrack.solo": "Соло",
    "multitrack.mute": "Выкл",
    "multitrack.save": "Скачать",
    "multitrack.export": "Экспорт...",
    "multitrack.soloFmtM4a": "Соло · m4a",
    "multitrack.soloFmtMp3": "Соло · mp3 320",
    "multitrack.soloFmtWav": "Соло · wav",
    "multitrack.guestPanelTitle": "Гостевая дорожка",
    "multitrack.loadingAudio": "Загрузка аудио...",
    "multitrack.goToStartAria": "В начало",
    "multitrack.goToStartTitle": "В начало (без воспроизведения)",
    "multitrack.playAria": "Воспроизвести",
    "multitrack.pauseAria": "Пауза",
    "multitrack.playButton": "▶ Воспроизвести",
    "multitrack.pauseButton": "Пауза",
    "multitrack.repeatTrackAria": "Повтор трека",
    "multitrack.repeatTrackTitle": "Повтор трека",
    "multitrack.recordGuestStartAria": "Записать гостевую дорожку",
    "multitrack.recordGuestStopAria": "Остановить запись гостевой дорожки",
    "multitrack.recordGuestStartTitle": "Записать гостевую дорожку",
    "multitrack.recordGuestStopTitle": "Стоп записи",
    "multitrack.recSoloHint": "Выберите один голос Solo для записи",
    "multitrack.trackPositionAria": "Позиция трека",
    "multitrack.masterVolumeAria": "Громкость мастер-канала",
    "multitrack.speedAria": "Скорость воспроизведения",
    "multitrack.calibrating": "Подбор...",
    "multitrack.delayDetected": "Задержка подобрана",
    "multitrack.delayPending": "Ожидает подбора",
    "multitrack.syncCheck": "Проверка синхронизации",
    "multitrack.countInPrefix": "Отсчёт",
    "multitrack.left": "Л",
    "multitrack.right": "П",
    "multitrack.volShort": "Гр.",
    "multitrack.tempoLocked": "Нельзя менять скорость в текущем режиме",
    "multitrack.pitchLocked": "Нельзя менять высоту в текущем режиме",
    "multitrack.teleprompterTitle": "Суфлёр",
    "multitrack.teleprompterEmptyHint": "Подключи таймкоды для суфлёра",
    "multitrack.syncUnknown": "Нет данных",
    "multitrack.delay": "Задержка",
    "multitrack.recordChecklist": "Чек-лист записи",
    "multitrack.guestGoToStartAria": "К началу гостевой",
    "multitrack.guestWithTrackStart": "Гость + трек",
    "multitrack.guestWithTrackStop": "Остановить Гость + трек",
    "multitrack.guestRepeatFragmentTitle": "Повтор фрагмента",
    "multitrack.guestPanAria": "Панорама гостя",
    "multitrack.guestVolumeAria": "Громкость гостя",
    "multitrack.guestDelayAria": "Задержка гостя",
    "multitrack.takes": "Дубли",
    "multitrack.activateTake": "Активировать дубль",
    "multitrack.pianoShow": "Показать фортепиано",
    "multitrack.pianoHide": "Скрыть фортепиано",
    "multitrack.teleprompterSettingsShow": "Показать настройки суфлёра",
  },
  en: {
    "multitrack.volume": "Volume",
    "multitrack.reverb": "Reverb",
    "multitrack.speed": "Speed",
    "multitrack.pitch": "Pitch",
    "multitrack.pan": "Pan",
    "multitrack.solo": "Solo",
    "multitrack.mute": "Mute",
    "multitrack.save": "Save",
    "multitrack.export": "Export...",
    "multitrack.soloFmtM4a": "Solo · m4a",
    "multitrack.soloFmtMp3": "Solo · mp3 320",
    "multitrack.soloFmtWav": "Solo · wav",
    "multitrack.guestPanelTitle": "Guest track",
    "multitrack.loadingAudio": "Loading audio...",
    "multitrack.goToStartAria": "Go to start",
    "multitrack.goToStartTitle": "Go to start (without playback)",
    "multitrack.playAria": "Play",
    "multitrack.pauseAria": "Pause",
    "multitrack.playButton": "▶ Play",
    "multitrack.pauseButton": "Pause",
    "multitrack.repeatTrackAria": "Repeat track",
    "multitrack.repeatTrackTitle": "Repeat track",
    "multitrack.recordGuestStartAria": "Record guest track",
    "multitrack.recordGuestStopAria": "Stop guest track recording",
    "multitrack.recordGuestStartTitle": "Record guest track",
    "multitrack.recordGuestStopTitle": "Stop recording",
    "multitrack.recSoloHint": "Select one solo voice for recording",
    "multitrack.trackPositionAria": "Track position",
    "multitrack.masterVolumeAria": "Master volume",
    "multitrack.speedAria": "Playback speed",
    "multitrack.calibrating": "Calibrating...",
    "multitrack.delayDetected": "Delay calibrated",
    "multitrack.delayPending": "Calibration pending",
    "multitrack.syncCheck": "Sync check",
    "multitrack.countInPrefix": "Count-in",
    "multitrack.left": "L",
    "multitrack.right": "R",
    "multitrack.volShort": "Vol",
    "multitrack.tempoLocked": "Tempo is locked in this mode",
    "multitrack.pitchLocked": "Pitch is locked in this mode",
    "multitrack.teleprompterTitle": "Teleprompter",
    "multitrack.teleprompterEmptyHint": "Attach timed lyrics for teleprompter",
    "multitrack.syncUnknown": "Unknown",
    "multitrack.delay": "Delay",
    "multitrack.recordChecklist": "Recording checklist",
    "multitrack.guestGoToStartAria": "Go to guest start",
    "multitrack.guestWithTrackStart": "Guest + track",
    "multitrack.guestWithTrackStop": "Stop Guest + track",
    "multitrack.guestRepeatFragmentTitle": "Repeat fragment",
    "multitrack.guestPanAria": "Guest pan",
    "multitrack.guestVolumeAria": "Guest volume",
    "multitrack.guestDelayAria": "Guest delay",
    "multitrack.takes": "Takes",
    "multitrack.activateTake": "Activate take",
    "multitrack.pianoShow": "Show piano",
    "multitrack.pianoHide": "Hide piano",
    "multitrack.teleprompterSettingsShow": "Show teleprompter settings",
  },
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}
function formatTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s < 10 ? "0" : ""}${s}`
}

function hasClientPreviewFlag(flagKey: string): boolean {
  if (typeof document === "undefined") return false
  const prefix = `${PREVIEW_FLAGS_COOKIE}=`
  const rawCookie = document.cookie
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(prefix))
  if (!rawCookie) return false
  const rawValue = rawCookie.slice(prefix.length)
  let decoded = rawValue
  try {
    decoded = decodeURIComponent(rawValue)
  } catch {}
  return decoded
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(flagKey)
}

function hasClientStorageFlag(storageKey: string): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(storageKey) === "1"
  } catch {
    return false
  }
}

function readClientAudioPilotFlag(envEnabled: boolean, previewFlag: string, storageKey: string): boolean {
  return envEnabled || hasClientPreviewFlag(previewFlag) || hasClientStorageFlag(storageKey)
}

function resolveClientAudioPilotRouting({
  trackCount,
  appendableActivationConfigured = false,
  appendableActivationAllowed = true,
  implicitAppendableQueuePilotEnabled = false,
  implicitAppendableQueueMultistemPilotEnabled = false,
}: {
  trackCount: number
  appendableActivationConfigured?: boolean
  appendableActivationAllowed?: boolean
  implicitAppendableQueuePilotEnabled?: boolean
  implicitAppendableQueueMultistemPilotEnabled?: boolean
}) {
  return resolveAudioPilotRouting({
    trackCount,
    streamingBufferPilotEnabled: readClientAudioPilotFlag(
      process.env.NEXT_PUBLIC_AUDIO_STREAMING_PILOT === "1",
      STREAMING_BUFFER_PREVIEW_FLAG,
      "rr_audio_streaming_pilot"
    ),
    appendableQueuePilotEnabled:
      implicitAppendableQueuePilotEnabled ||
      readClientAudioPilotFlag(
        process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_PILOT === "1",
        APPENDABLE_QUEUE_PILOT_PREVIEW_FLAG,
        "rr_audio_appendable_queue_pilot"
      ),
    appendableQueueMultistemPilotEnabled:
      implicitAppendableQueueMultistemPilotEnabled ||
      readClientAudioPilotFlag(
        process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_MULTISTEM_PILOT === "1",
        APPENDABLE_QUEUE_MULTISTEM_PILOT_PREVIEW_FLAG,
        "rr_audio_appendable_queue_multistem_pilot"
      ),
    ringBufferPilotEnabled: readClientAudioPilotFlag(
      process.env.NEXT_PUBLIC_AUDIO_RINGBUFFER_PILOT === "1",
      RINGBUFFER_PILOT_PREVIEW_FLAG,
      "rr_audio_ringbuffer_pilot"
    ),
    appendableActivationConfigured,
    appendableActivationAllowed,
  })
}

function getEngineModeCapabilities(mode: EngineMode): AudioEngineCapabilities {
  switch (mode) {
    case "streaming_media":
      return {
        supportsTempo: true,
        supportsIndependentPitch: false,
      }
    case "appendable_queue_worklet":
    case "ringbuffer_worklet":
      return {
        supportsTempo: false,
        supportsIndependentPitch: false,
      }
    case "soundtouch":
    default:
      return {
        supportsTempo: true,
        supportsIndependentPitch: true,
      }
  }
}

function applyAppendableActivationPolicyToCapabilities(
  mode: EngineMode,
  capabilities: AudioEngineCapabilities,
  activation: AppendablePilotActivationState
): AudioEngineCapabilities {
  if (mode !== "appendable_queue_worklet") return capabilities
  return {
    supportsTempo: capabilities.supportsTempo && activation.tempoControlUnlocked,
    supportsIndependentPitch: capabilities.supportsIndependentPitch,
  }
}

function shouldPreferProgressiveLoad(trackList: TrackDef[]): boolean {
  if (typeof navigator === "undefined") return false
  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
  if (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4) return true
  return trackList.length >= 6
}

function buildGuestTakeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `take-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function resolveUiLangFromDocument(): UiLang {
  if (typeof window !== "undefined") {
    const pathname = window.location.pathname.toLowerCase()
    if (pathname === "/en" || pathname.startsWith("/en/")) return "en"
    return "ru"
  }
  if (typeof document === "undefined") return "ru"
  const langAttr = document.documentElement.lang?.toLowerCase() || "ru"
  return langAttr.startsWith("en") ? "en" : "ru"
}

function midiToFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function midiToNote(midi: number) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

function buildTrackScopeId(trackList: TrackDef[]): string {
  const raw = trackList.map((t) => t.src).join("|")
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return normalized.slice(0, 180) || "default"
}

function readAudioPerfNowMs(): number {
  if (typeof performance !== "undefined" && Number.isFinite(performance.now())) {
    return performance.now()
  }
  return Date.now()
}

function calcPercentileMs(values: number[], percentile: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const clamped = Math.max(0, Math.min(100, percentile))
  const rank = Math.ceil((clamped / 100) * sorted.length)
  const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1))
  return Number(sorted[idx].toFixed(1))
}

function toLatencyMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value * 1000))
}

function toTrackSettingNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

function toTrackSettingBool(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null
  return value
}

function isOpfsAvailable(): boolean {
  if (typeof navigator === "undefined") return false
  const navWithStorage = navigator as Navigator & { storage?: { getDirectory?: () => Promise<unknown> } }
  return typeof navWithStorage.storage?.getDirectory === "function"
}

function buildRecorderCapabilitySnapshot(params: {
  ctx: AudioContext | null
  stream: MediaStream | null
  mimeType: string
  recordingV2FlagEnabled: boolean
  dropoutCount: number
  recoveryCount: number
  workletTapActive?: boolean
  workletFramesCaptured?: number
  workletChunkReports?: number
  workletTapErrors?: number
  opfsWriterActive?: boolean
  opfsBytesWritten?: number
  opfsChunkCount?: number
  opfsWriteErrors?: number
  uploadState?: string
}): RecorderCapabilitySnapshot {
  const inputTrack = params.stream?.getAudioTracks?.()?.[0]
  const inputSettings = inputTrack?.getSettings?.() as
    | (MediaTrackSettings & {
        latency?: number
        echoCancellation?: boolean
        noiseSuppression?: boolean
        autoGainControl?: boolean
      })
    | undefined
  const ctxWithOutput = params.ctx as AudioContext & { outputLatency?: number }
  const hasAudioWorklet = Boolean(params.ctx?.audioWorklet) || typeof AudioWorkletNode !== "undefined"
  return {
    capturedAt: new Date().toISOString(),
    recordingEngine: params.recordingV2FlagEnabled ? "recording_v2_preview" : "media_recorder_v1",
    recordingV2FlagEnabled: params.recordingV2FlagEnabled,
    mimeType: params.mimeType || "default",
    mediaRecorderSupported: typeof MediaRecorder !== "undefined",
    audioWorkletSupported: hasAudioWorklet,
    opfsSupported: isOpfsAvailable(),
    baseLatencyMs: toLatencyMs(params.ctx?.baseLatency),
    outputLatencyMs: toLatencyMs(ctxWithOutput?.outputLatency),
    inputLatencyMs: toLatencyMs(inputSettings?.latency),
    inputSampleRate: toTrackSettingNumber(inputSettings?.sampleRate),
    inputSampleSize: toTrackSettingNumber(inputSettings?.sampleSize),
    inputChannelCount: toTrackSettingNumber(inputSettings?.channelCount),
    inputEchoCancellation: toTrackSettingBool(inputSettings?.echoCancellation),
    inputNoiseSuppression: toTrackSettingBool(inputSettings?.noiseSuppression),
    inputAutoGainControl: toTrackSettingBool(inputSettings?.autoGainControl),
    dropoutCount: Math.max(0, Math.floor(params.dropoutCount)),
    recoveryCount: Math.max(0, Math.floor(params.recoveryCount)),
    workletTapActive: !!params.workletTapActive,
    workletFramesCaptured: Math.max(0, Math.floor(params.workletFramesCaptured ?? 0)),
    workletChunkReports: Math.max(0, Math.floor(params.workletChunkReports ?? 0)),
    workletTapErrors: Math.max(0, Math.floor(params.workletTapErrors ?? 0)),
    opfsWriterActive: !!params.opfsWriterActive,
    opfsBytesWritten: Math.max(0, Math.floor(params.opfsBytesWritten ?? 0)),
    opfsChunkCount: Math.max(0, Math.floor(params.opfsChunkCount ?? 0)),
    opfsWriteErrors: Math.max(0, Math.floor(params.opfsWriteErrors ?? 0)),
    uploadState: typeof params.uploadState === "string" ? params.uploadState : "idle",
  }
}

const CYRILLIC_VOWEL = "[АЕЁИОУЫЭЮЯаеёиоуыэюя]"
const MELISMA_GROUP_RE = /\(([^()]*)\)/g
const MELISMA_UNDERSCORE_RE = new RegExp(`^_(${CYRILLIC_VOWEL})_$`, "u")
const MELISMA_HTML_U_RE = new RegExp(`^<u>\\s*(${CYRILLIC_VOWEL})\\s*<\\/u>$`, "iu")
const MELISMA_COMBINING_RE = new RegExp(`^(${CYRILLIC_VOWEL})[\\u0331\\u0332]+$`, "u")

function extractMarkedMelismaVowel(rawInner: string): string | null {
  const inner = rawInner.trim()
  const byUnderscore = inner.match(MELISMA_UNDERSCORE_RE)?.[1]
  if (byUnderscore) return byUnderscore
  const byHtmlUnderline = inner.match(MELISMA_HTML_U_RE)?.[1]
  if (byHtmlUnderline) return byHtmlUnderline
  const byCombining = inner.match(MELISMA_COMBINING_RE)?.[1]
  if (byCombining) return byCombining
  return null
}

function renderTeleprompterLineText(text: string) {
  if (!text) return text
  MELISMA_GROUP_RE.lastIndex = 0
  const matches = Array.from(text.matchAll(MELISMA_GROUP_RE))
  if (!matches.length) return text

  const out: React.ReactNode[] = []
  let cursor = 0
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const start = match.index ?? 0
    if (start > cursor) out.push(text.slice(cursor, start))

    const vowel = extractMarkedMelismaVowel(match[1] ?? "")
    if (vowel) {
      out.push("(")
      out.push(
        <span key={`melisma-${start}-${i}`} className="underline decoration-[1.5px] underline-offset-[2px]">
          {vowel}
        </span>
      )
      out.push(")")
    } else {
      out.push(match[0])
    }
    cursor = start + match[0].length
  }
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

function normalizeTeleprompterLines(input: unknown): TeleprompterLine[] {
  if (!Array.isArray(input)) return []
  return input.map((line, idx) => {
    const candidate = line as Partial<TeleprompterLine> | null
    const rawTime = Number(candidate?.time)
    return {
      time: Number.isFinite(rawTime) ? Math.max(0, Number(rawTime.toFixed(3))) : idx * 2,
      text: typeof candidate?.text === "string" ? candidate.text : "",
    }
  })
}

function normalizeTeleprompterAnchors(input: unknown): TeleprompterAnchorMap {
  if (!input || typeof input !== "object") return {}
  const normalized: TeleprompterAnchorMap = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const idx = Number(k)
    const t = Number(v)
    if (Number.isFinite(idx) && Number.isFinite(t) && idx >= 0 && t >= 0) normalized[idx] = Number(t.toFixed(3))
  }
  return normalized
}

function normalizeTeleprompterTextOverrides(input: unknown): TeleprompterTextOverrideMap {
  if (!input || typeof input !== "object") return {}
  const normalized: TeleprompterTextOverrideMap = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const idx = Number(k)
    if (Number.isFinite(idx) && idx >= 0 && typeof v === "string") normalized[idx] = v
  }
  return normalized
}

function parseTeleprompterDraftState(raw: string | null): TeleprompterDraftState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TeleprompterDraftState> | null
    if (!parsed || typeof parsed !== "object") return null
    return {
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
      lines: normalizeTeleprompterLines(parsed.lines),
      anchors: normalizeTeleprompterAnchors(parsed.anchors),
      textOverrides: normalizeTeleprompterTextOverrides(parsed.textOverrides),
    }
  } catch {
    return null
  }
}

function buildTeleprompterLinesSignature(lines: TeleprompterLine[]): string {
  if (!lines.length) return ""
  return lines.map((line) => `${line.time.toFixed(3)}\u0001${line.text}`).join("\u0002")
}

function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return ""
  const candidates = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ]
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return ""
}

function mimeByExportFormat(format: ExportFormat): string {
  if (format === "m4a") return "audio/mp4;codecs=mp4a.40.2"
  if (format === "mp3") return "audio/mpeg"
  return "audio/wav"
}

function estimateLatencyCompensationSec(ctx: AudioContext | null, stream: MediaStream | null): number {
  const baseLatency = ctx?.baseLatency ?? 0
  const outputLatency = typeof (ctx as AudioContext & { outputLatency?: number })?.outputLatency === "number"
    ? ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0)
    : 0
  const inputTrack = stream?.getAudioTracks?.()?.[0]
  const inputSettings = inputTrack?.getSettings?.() as (MediaTrackSettings & { latency?: number }) | undefined
  const inputLatency = typeof inputSettings?.latency === "number" ? inputSettings.latency : 0
  const raw = baseLatency + outputLatency + inputLatency
  return clamp(raw, 0, 0.35)
}

function encodeStereoWav(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
  const frames = Math.min(left.length, right.length)
  const bytesPerSample = 2
  const channels = 2
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]))
    const r = Math.max(-1, Math.min(1, right[i]))
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true)
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true)
    offset += 4
  }

  return new Blob([buffer], { type: "audio/wav" })
}

async function normalizeRecordedBlobToStereoWav(input: Blob): Promise<Blob> {
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return input

  const arr = await input.arrayBuffer()
  const ctx = new AudioContextCtor()
  try {
    const decoded = await ctx.decodeAudioData(arr.slice(0))
    const left = decoded.getChannelData(0)
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0)
    return encodeStereoWav(left, right, decoded.sampleRate)
  } catch {
    return input
  } finally {
    void ctx.close()
  }
}

/** =========================
 *  PEAKS + WAVE DRAW
 *  ========================= */
function computePeaks(buffer: AudioBuffer, buckets: number): WavePeaks {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const safeBuckets = Math.max(1, Math.min(buckets, length))

  const min = new Float32Array(safeBuckets)
  const max = new Float32Array(safeBuckets)
  for (let i = 0; i < safeBuckets; i++) {
    min[i] = 1
    max[i] = -1
  }

  const samplesPerBucket = Math.max(1, Math.floor(length / safeBuckets))
  for (let b = 0; b < safeBuckets; b++) {
    const start = b * samplesPerBucket
    const end = Math.min(length, start + samplesPerBucket)

    let localMin = 1
    let localMax = -1

    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c)
      for (let i = start; i < end; i++) {
        const v = data[i]
        if (v < localMin) localMin = v
        if (v > localMax) localMax = v
      }
    }

    min[b] = localMin
    max[b] = localMax
  }

  return { min, max }
}

async function computePeaksProgressive(
  buffer: AudioBuffer,
  buckets: number,
  opts?: { yieldEveryBuckets?: number; maxSliceMs?: number; yieldDelayMs?: number }
): Promise<WavePeaks> {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const safeBuckets = Math.max(1, Math.min(buckets, length))
  const min = new Float32Array(safeBuckets)
  const max = new Float32Array(safeBuckets)
  for (let i = 0; i < safeBuckets; i++) {
    min[i] = 1
    max[i] = -1
  }

  const channelData = new Array<Float32Array>(channels)
  for (let c = 0; c < channels; c++) channelData[c] = buffer.getChannelData(c)

  const samplesPerBucket = Math.max(1, Math.floor(length / safeBuckets))
  const yieldEveryBuckets = Math.max(4, opts?.yieldEveryBuckets ?? 18)
  const maxSliceMs = Math.max(1, opts?.maxSliceMs ?? 6)
  const yieldDelayMs = Math.max(0, opts?.yieldDelayMs ?? 0)
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
  let sliceStartedAt = nowMs()

  for (let b = 0; b < safeBuckets; b++) {
    const start = b * samplesPerBucket
    const end = Math.min(length, start + samplesPerBucket)

    let localMin = 1
    let localMax = -1

    for (let c = 0; c < channels; c++) {
      const data = channelData[c]
      for (let i = start; i < end; i++) {
        const v = data[i]
        if (v < localMin) localMin = v
        if (v > localMax) localMax = v
      }
    }

    min[b] = localMin
    max[b] = localMax

    if ((b + 1) % yieldEveryBuckets === 0 && nowMs() - sliceStartedAt >= maxSliceMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, yieldDelayMs))
      sliceStartedAt = nowMs()
    }
  }

  return { min, max }
}

function computePreviewPeaks(
  buffer: AudioBuffer,
  buckets: number,
  opts?: { probesPerBucket?: number }
): WavePeaks {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const safeBuckets = Math.max(1, Math.min(buckets, length))
  const min = new Float32Array(safeBuckets)
  const max = new Float32Array(safeBuckets)
  for (let i = 0; i < safeBuckets; i++) {
    min[i] = 1
    max[i] = -1
  }

  const probesPerBucket = Math.max(8, opts?.probesPerBucket ?? WAVEFORM_PREVIEW_PROBES_PER_BUCKET)
  const channelData = new Array<Float32Array>(channels)
  for (let c = 0; c < channels; c++) channelData[c] = buffer.getChannelData(c)

  const samplesPerBucket = Math.max(1, Math.floor(length / safeBuckets))
  for (let b = 0; b < safeBuckets; b++) {
    const start = b * samplesPerBucket
    const end = Math.min(length, start + samplesPerBucket)
    const span = Math.max(1, end - start)
    const step = Math.max(1, Math.floor(span / probesPerBucket))

    let localMin = 1
    let localMax = -1

    for (let c = 0; c < channels; c++) {
      const data = channelData[c]
      const inspect = (sampleIndex: number) => {
        const clamped = Math.max(start, Math.min(end - 1, sampleIndex))
        const value = data[clamped]
        if (value < localMin) localMin = value
        if (value > localMax) localMax = value
      }

      inspect(start)
      inspect(start + Math.floor(span / 2))
      inspect(end - 1)

      for (let i = start; i < end; i += step) {
        const value = data[i]
        if (value < localMin) localMin = value
        if (value > localMax) localMax = value
      }
    }

    if (localMin > localMax) {
      localMin = -0.02
      localMax = 0.02
    }
    min[b] = localMin
    max[b] = localMax
  }

  return { min, max }
}

function makeFlatPeaks(buckets = 1200): WavePeaks {
  const min = new Float32Array(buckets)
  const max = new Float32Array(buckets)
  for (let i = 0; i < buckets; i++) {
    min[i] = -0.02
    max[i] = 0.02
  }
  return { min, max }
}

function drawWaveform(canvas: HTMLCanvasElement, peaks: WavePeaks, progress01: number) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  const W = Math.max(1, Math.floor(cssW * dpr))
  const H = Math.max(1, Math.floor(cssH * dpr))
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = "rgba(255,255,255,0.05)"
  ctx.fillRect(0, 0, W, H)

  const mid = H / 2
  const amp = H * 0.42
  const peaksLen = peaks.min.length
  const idxAt = (x: number) => Math.min(peaksLen - 1, Math.floor((x / (W - 1)) * peaksLen))

  // base
  ctx.lineWidth = 1
  ctx.strokeStyle = "rgba(255,255,255,0.32)"
  ctx.beginPath()
  for (let x = 0; x < W; x++) {
    const idx = idxAt(x)
    const y1 = mid + peaks.min[idx] * amp
    const y2 = mid + peaks.max[idx] * amp
    ctx.moveTo(x + 0.5, y1)
    ctx.lineTo(x + 0.5, y2)
  }
  ctx.stroke()

  // progress overlay
  const progX = Math.floor(W * clamp(progress01, 0, 1))
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, progX, H)
  ctx.clip()

  ctx.strokeStyle = "rgba(255,255,255,0.9)"
  ctx.beginPath()
  for (let x = 0; x < W; x++) {
    const idx = idxAt(x)
    const y1 = mid + peaks.min[idx] * amp
    const y2 = mid + peaks.max[idx] * amp
    ctx.moveTo(x + 0.5, y1)
    ctx.lineTo(x + 0.5, y2)
  }
  ctx.stroke()
  ctx.restore()

  // playhead
  ctx.fillStyle = "rgba(255,255,255,0.85)"
  ctx.fillRect(progX, 0, Math.max(1, Math.floor(1 * dpr)), H)
}

function buildRmsEnvelopeByTime(buffer: AudioBuffer, binSec = 0.02, maxSec = 60): Float32Array {
  const channels = buffer.numberOfChannels
  const totalSamples = buffer.length
  const sampleRate = buffer.sampleRate
  const maxSamples = Math.min(totalSamples, Math.floor(sampleRate * maxSec))
  const binSamples = Math.max(64, Math.floor(sampleRate * binSec))
  const bins = Math.max(1, Math.floor(maxSamples / binSamples))
  const env = new Float32Array(bins)

  const chData: Float32Array[] = []
  for (let c = 0; c < channels; c++) chData.push(buffer.getChannelData(c))

  for (let b = 0; b < bins; b++) {
    const start = b * binSamples
    const end = Math.min(maxSamples, start + binSamples)
    let acc = 0
    let count = 0
    for (let i = start; i < end; i++) {
      let v = 0
      for (let c = 0; c < channels; c++) v += chData[c][i]
      v /= channels
      acc += v * v
      count += 1
    }
    env[b] = count > 0 ? Math.sqrt(acc / count) : 0
  }
  return env
}

function estimateOffsetByCorrelation(
  mainEnv: Float32Array,
  guestEnv: Float32Array,
  maxLagBins: number,
  preferredLagBins = 0
) {
  return estimateOffsetByCorrelationInRange(mainEnv, guestEnv, -Math.max(1, maxLagBins), Math.max(1, maxLagBins), preferredLagBins)
}

function estimateOffsetByCorrelationInRange(
  mainEnv: Float32Array,
  guestEnv: Float32Array,
  minLagBins: number,
  maxLagBins: number,
  preferredLagBins = 0
) {
  const low = Math.min(minLagBins, maxLagBins)
  const high = Math.max(minLagBins, maxLagBins)
  const range = Math.max(1, high - low)
  let bestLag = 0
  let bestScore = -Infinity

  for (let lag = low; lag <= high; lag++) {
    const startMain = lag < 0 ? -lag : 0
    const startGuest = lag > 0 ? lag : 0
    const n = Math.min(mainEnv.length - startMain, guestEnv.length - startGuest)
    if (n < 40) continue

    let sumX = 0
    let sumY = 0
    for (let i = 0; i < n; i++) {
      sumX += mainEnv[startMain + i]
      sumY += guestEnv[startGuest + i]
    }
    const meanX = sumX / n
    const meanY = sumY / n

    let sumXY = 0
    let sumXX = 0
    let sumYY = 0
    for (let i = 0; i < n; i++) {
      const x = mainEnv[startMain + i] - meanX
      const y = guestEnv[startGuest + i] - meanY
      sumXY += x * y
      sumXX += x * x
      sumYY += y * y
    }
    if (sumXX <= 1e-12 || sumYY <= 1e-12) continue
    const corr = sumXY / Math.sqrt(sumXX * sumYY)
    const lagPenalty = 0.06 * (Math.abs(lag - preferredLagBins) / Math.max(1, range))
    const score = corr - lagPenalty
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  return { lagBins: bestLag, score: bestScore }
}

type GuestSyncQuality = "unknown" | "low" | "ok" | "good"

function classifyGuestSyncQuality(score: number): GuestSyncQuality {
  if (!Number.isFinite(score)) return "unknown"
  if (score >= 0.34) return "good"
  if (score >= 0.2) return "ok"
  return "low"
}

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timeout after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId)
  }
}

function createSilentBuffer(ctx: AudioContext, durationSec: number, sampleRate = 44_100) {
  const safeDuration = clamp(durationSec, 1, 60 * 20)
  const frameCount = Math.max(1, Math.floor(sampleRate * safeDuration))
  return ctx.createBuffer(2, frameCount, sampleRate)
}

/** =========================
 *  REVERB
 *  ========================= */
function makeImpulseResponse(ctx: AudioContext) {
  const seconds = 2.0
  const decay = 4.8
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const impulse = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const t = i / length
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay)
    }
  }
  return impulse
}

/** =========================
 *  SLIDER WITH CENTER MARK
 *  ========================= */
function CenterMarkedSlider(props: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  ariaLabel?: string
  className?: string
  title?: string
  leftLabel?: string
  rightLabel?: string
}) {
  const { value, min, max, step, onChange, ariaLabel, className, title, leftLabel, rightLabel } = props
  const centerPct = min === max ? 50 : clamp(((0 - min) / (max - min)) * 100, 0, 100)

  return (
    <div className={`relative ${className ?? ""}`} title={title}>
      {leftLabel ? <span className="pointer-events-none absolute -left-3 top-1/2 -translate-y-1/2 text-[10px] text-white/60">{leftLabel}</span> : null}
      {rightLabel ? <span className="pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/60">{rightLabel}</span> : null}
      <div
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/45"
        style={{ left: `${centerPct}%` }}
      />
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="w-full range-thin"
      />
    </div>
  )
}

type MultiTrackPlayerProps = {
  tracks?: TrackDef[]
  appendableActivationTargets?: string[]
  onTimeChange?: (timeSec: number) => void
  seekToSeconds?: number | null
  teleprompterSourceUrl?: string | null
  teleprompterExpandedText?: string[]
  onControllerReady?: (controller: GlobalAudioController | null) => void
  onPlaybackStateChange?: (playing: boolean) => void
  onTrackSetReady?: (trackScopeId: string) => void
  registerGlobalAudio?: boolean
  persistOnUnmount?: boolean
  showDetailedSections?: boolean
  showControlsBeforeReady?: boolean
  topStatusBanner?: { href: string; text: string } | null
}

export default function MultiTrackPlayer({
  tracks: inputTracks,
  appendableActivationTargets = [],
  onTimeChange,
  seekToSeconds,
  teleprompterSourceUrl,
  teleprompterExpandedText,
  onControllerReady,
  onPlaybackStateChange,
  onTrackSetReady,
  registerGlobalAudio = true,
  persistOnUnmount = false,
  showDetailedSections = true,
  showControlsBeforeReady = false,
  topStatusBanner = null,
}: MultiTrackPlayerProps = {}) {
  const tracks: TrackDef[] = useMemo(
    () => [
      { name: "Селезень 01", src: "/audio/selezen/selezen-01.m4a" },
      { name: "Селезень 02", src: "/audio/selezen/selezen-02.m4a" },
      { name: "Селезень 03", src: "/audio/selezen/selezen-03.m4a" },
    ],
    []
  )
  const trackList = inputTracks?.length ? inputTracks : tracks
  const trackScopeId = useMemo(() => buildTrackScopeId(trackList), [trackList])
  const initialAppendablePilotActivation = resolveClientAppendablePilotActivation({
    trackScopeId,
    activationTargets: appendableActivationTargets,
  })
  const initialTrackVolumes = useMemo(
    () => trackList.map((track) => clamp(track.defaultVolume ?? 1, 0, TRACK_MAX_GAIN)),
    [trackList]
  )
  const guestSyncStorageKey = useMemo(() => `rr_guest_sync_offset_sec:${trackScopeId}`, [trackScopeId])
  const guestRecordStorageKey = useMemo(() => `guest:${trackScopeId}`, [trackScopeId])
  const guestTakesStorageKey = useMemo(() => `rr_guest_takes:${trackScopeId}:v1`, [trackScopeId])
  const guestSyncMetricsStorageKey = useMemo(() => `rr_guest_sync_metrics:${trackScopeId}:v1`, [trackScopeId])
  const guestDriftMetricsStorageKey = useMemo(() => `rr_guest_drift_metrics:${trackScopeId}:v1`, [trackScopeId])
  const appendableRoutePilotReportStorageKey = useMemo(
    () => `${APPENDABLE_ROUTE_PILOT_REPORT_STORAGE_KEY_PREFIX}:${trackScopeId}:v1`,
    [trackScopeId]
  )

  const ctxRef = useRef<AudioContext | null>(null)
  const globalControllerRef = useRef<GlobalAudioController | null>(null)
  const onTrackSetReadyRef = useRef(onTrackSetReady)
  const globalControllerIdRef = useRef(`rr-multitrack:${Math.random().toString(36).slice(2)}`)
  const enginesRef = useRef<(SoundTouchEngine | null)[]>(trackList.map(() => null))
  const appendableQueueCoordinatorRef = useRef<AppendableQueueMultitrackCoordinator | null>(null)
  const appendableStartupHeadRuntimeRef = useRef<AppendableStartupHeadRuntimeState | null>(null)
  const appendableContinuationPreflightRef = useRef<AppendableContinuationPreflightState>(
    createAppendableContinuationPreflightState()
  )
  const appendableQueueSharedTickTimerRef = useRef<number | null>(null)
  const appendableQueueSharedTickWorkerRef = useRef<Worker | null>(null)
  const appendableQueueRuntimeProbeTimerRef = useRef<number | null>(null)
  const appendableQueueSourceProgressTimerRef = useRef<number | null>(null)
  const appendableQueueRuntimeProbeLastLogAtMsRef = useRef(0)
  const appendableQueueRuntimeProbeLastMinLeadSecRef = useRef<number | null>(null)
  const appendableQueueRuntimeProbeCleanSinceMsRef = useRef<number | null>(null)

  // gate (anti-cascade + clean start/stop)
  const engineGateRef = useRef<GainNode[]>([])

  // per-track nodes
  const trackGainRef = useRef<GainNode[]>([])
  const panRef = useRef<StereoPannerNode[]>([])

  // master
  const masterInRef = useRef<GainNode | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const masterLimiterRef = useRef<DynamicsCompressorNode | null>(null)
  const wetGainRef = useRef<GainNode | null>(null)
  const dryGainRef = useRef<GainNode | null>(null)
  const audioDebugMasterTapNodeRef = useRef<AudioWorkletNode | null>(null)
  const audioDebugMasterTapCtxRef = useRef<AudioContext | null>(null)
  const audioDebugMasterTapModuleLoadedCtxRef = useRef<AudioContext | null>(null)
  const audioDebugMasterTapChunkLoggedRef = useRef(false)
  const audioDebugMasterTapStatsRef = useRef<AudioDebugMasterTapStats>({
    framesCaptured: 0,
    chunkReports: 0,
    clickReports: 0,
    errors: 0,
  })
  const flushAudioDebugMasterTap = useCallback((token: string | null = null) => {
    const node = audioDebugMasterTapNodeRef.current
    if (!node) {
      if (typeof window !== "undefined" && token) {
        window.dispatchEvent(
          new CustomEvent("rr-audio-debug-flush-complete", {
            detail: { token, ok: false, reason: "missing_node" },
          })
        )
      }
      return false
    }
    try {
      node.port.postMessage({ type: "flush", token })
      logAudioDebug("audio:master_tap_flush", token ? { token } : {})
      return true
    } catch {
      logAudioDebug("audio:master_tap_flush_error", token ? { token } : {})
      if (typeof window !== "undefined" && token) {
        window.dispatchEvent(
          new CustomEvent("rr-audio-debug-flush-complete", {
            detail: { token, ok: false, reason: "post_failed" },
          })
        )
      }
      return false
    }
  }, [])

  // transport
  const rafRef = useRef<number | null>(null)
  const pendingRafRef = useRef<number | null>(null)
  const pendingLastFrameMsRef = useRef(0)
  const ringbufferSharedTickTimerRef = useRef<number | null>(null)
  const ringbufferSharedTickWorkerRef = useRef<Worker | null>(null)
  const isPlayingRef = useRef(false)
  const positionSecRef = useRef(0)
  const soundtouchBufferSizeRef = useRef(2048)
  const startupChunkRuntimeRef = useRef<StartupChunkRuntimeState | null>(null)
  const startupChunkFinalizeTimerRef = useRef<number | null>(null)
  const pendingPlayRef = useRef(false)
  const pendingStartPositionRef = useRef<number | null>(null)
  const forceZeroStartRef = useRef(false)
  const playInFlightRef = useRef(false)
  const gateWarmupTimersRef = useRef<number[]>([])
  const smoothSeekTimerRef = useRef<number | null>(null)
  const smoothSeekResumeGateTimerRef = useRef<number | null>(null)
  const pendingPlayWatchdogTimerRef = useRef<number | null>(null)
  const pendingSmoothSeekSecRef = useRef<number | null>(null)
  const ringbufferRuntimeProbeTimerRef = useRef<number | null>(null)
  const ringbufferRuntimeProbeLastLogAtMsRef = useRef(0)
  const ringbufferRuntimeProbeLastMinBufferedSecRef = useRef<number | null>(null)
  const deferredPeaksIdleCallbackRef = useRef<number | null>(null)
  const deferredPeaksSchedulerRef = useRef<(delayMs: number) => void>(() => {})
  const playStartGuardRef = useRef<{ requestedSec: number; startedAtMs: number; corrected: boolean } | null>(null)
  const firstFrameProbeArmedRef = useRef(false)
  const audioTtfpAttemptRef = useRef<AudioTtfpAttempt | null>(null)
  const audioTtfpSequenceRef = useRef(0)
  const audioTtfpSamplesRef = useRef<number[]>([])
  const activeTrackScopeRef = useRef(trackScopeId)
  const readyRef = useRef(false)
  const navResumePositionRef = useRef<number | null>(null)
  const navResumePlayRef = useRef(false)

  // params
  const tempoRef = useRef(1)
  const pitchSemiRef = useRef(0)

  // UI
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [mainPlayPending, setMainPlayPending] = useState(false)
  const [loopOn, setLoopOn] = useState(false)
  const loopOnRef = useRef(loopOn)
  const initialAudioPilotRouting = resolveClientAudioPilotRouting({
    trackCount: trackList.length,
    appendableActivationConfigured: initialAppendablePilotActivation.activationConfigured,
    appendableActivationAllowed: initialAppendablePilotActivation.activationAllowed,
    implicitAppendableQueuePilotEnabled: initialAppendablePilotActivation.activationMode === "safe_rollout",
    implicitAppendableQueueMultistemPilotEnabled: initialAppendablePilotActivation.activationMode === "safe_rollout",
  })
  const [progressiveLoadEnabled, setProgressiveLoadEnabled] = useState(
    () => hasClientPreviewFlag(PROGRESSIVE_LOAD_PREVIEW_FLAG) || shouldPreferProgressiveLoad(trackList)
  )
  const [startupChunkPilotEnabled] = useState(
    () =>
      process.env.NEXT_PUBLIC_AUDIO_STARTUP_CHUNK_PILOT === "1" ||
      hasClientPreviewFlag(STARTUP_CHUNK_PREVIEW_FLAG) ||
      hasClientStorageFlag("rr_audio_startup_chunk_pilot")
  )
  const [startupChunkSplicePilotEnabled] = useState(
    () =>
      process.env.NEXT_PUBLIC_AUDIO_STARTUP_SPLICE_PILOT === "1" ||
      hasClientPreviewFlag(STARTUP_CHUNK_SPLICE_PREVIEW_FLAG) ||
      hasClientStorageFlag("rr_audio_startup_splice_pilot")
  )
  const [startupChunkSplicePilotKey] = useState(
    () =>
      process.env.NEXT_PUBLIC_AUDIO_STARTUP_SPLICE_PILOT_KEY?.trim().toLowerCase() ||
      (typeof window !== "undefined"
        ? window.localStorage.getItem("rr_audio_startup_splice_pilot_key")?.trim().toLowerCase() || ""
        : "")
  )
  const [streamingBufferPilotEnabled, setStreamingBufferPilotEnabled] = useState(
    () => initialAudioPilotRouting.useStreamingPilot
  )
  const [appendableQueuePilotEnabled, setAppendableQueuePilotEnabled] = useState(
    () =>
      readClientAudioPilotFlag(
        process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_PILOT === "1",
        APPENDABLE_QUEUE_PILOT_PREVIEW_FLAG,
        "rr_audio_appendable_queue_pilot"
      )
  )
  const [appendableQueueMultistemPilotEnabled, setAppendableQueueMultistemPilotEnabled] = useState(
    () =>
      readClientAudioPilotFlag(
        process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_MULTISTEM_PILOT === "1",
        APPENDABLE_QUEUE_MULTISTEM_PILOT_PREVIEW_FLAG,
        "rr_audio_appendable_queue_multistem_pilot"
      )
  )
  const [appendableQueueStartupHeadPilotEnabled] = useState(
    () =>
      readClientAudioPilotFlag(
        process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_STARTUP_HEAD_PILOT === "1",
        APPENDABLE_QUEUE_STARTUP_HEAD_PREVIEW_FLAG,
        "rr_audio_appendable_queue_startup_head_pilot"
      )
  )
  const [appendableQueueContinuationChunksPilotEnabled] = useState(
    () =>
      readClientAudioPilotFlag(
        process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_CONTINUATION_CHUNKS_PILOT === "1",
        APPENDABLE_QUEUE_CONTINUATION_CHUNKS_PREVIEW_FLAG,
        "rr_audio_appendable_queue_continuation_chunks_pilot"
      )
  )
  const [appendableQueueShadowPitchEnabled] = useState(() =>
    hasClientStorageFlag("rr_audio_appendable_queue_shadow_pitch_enabled")
  )
  const [appendableActivationStorageRevision, setAppendableActivationStorageRevision] = useState(0)
  const appendablePilotActivation = useMemo(
    () =>
      resolveClientAppendablePilotActivation({
        trackScopeId,
        activationTargets: appendableActivationTargets,
      }),
    [appendableActivationStorageRevision, appendableActivationTargets, trackScopeId]
  )
  const appendableSafeRolloutImplicitFlagsEnabled = appendablePilotActivation.activationMode === "safe_rollout"
  const effectiveAppendableQueuePilotEnabled =
    appendableQueuePilotEnabled || appendableSafeRolloutImplicitFlagsEnabled
  const effectiveAppendableQueueMultistemPilotEnabled =
    appendableQueueMultistemPilotEnabled || appendableSafeRolloutImplicitFlagsEnabled
  const appendableRoutePitchShadowActive =
    appendableQueueShadowPitchEnabled &&
    appendablePilotActivation.activationMode !== "safe_rollout" &&
    appendableQueuePilotEnabled &&
    appendableQueueMultistemPilotEnabled
  const [appendableQueueRuntimeProbeSnapshot, setAppendableQueueRuntimeProbeSnapshot] = useState<AppendableQueueRuntimeProbeSnapshot>(
    () => createAppendableQueueRuntimeProbeSnapshot()
  )
  const [appendableQueueSourceProgressSnapshot, setAppendableQueueSourceProgressSnapshot] =
    useState<AppendableQueueSourceProgressSnapshot>(() => createAppendableQueueSourceProgressSnapshot())
  const [appendableRouteVisibilitySnapshot, setAppendableRouteVisibilitySnapshot] = useState<AppendableRouteVisibilitySnapshot>(
    () => createAppendableRouteVisibilitySnapshot()
  )
  const appendableRouteVisibilitySnapshotRef = useRef<AppendableRouteVisibilitySnapshot>(
    createAppendableRouteVisibilitySnapshot()
  )
  const appendableRouteVisibilityInitialPageShowRecordedRef = useRef(false)
  const [appendableRoutePilotReport, setAppendableRoutePilotReport] = useState<AppendableRoutePilotReport>(() =>
    createAppendableRoutePilotReport()
  )
  const [appendableRoutePilotReportHydratedStorageKey, setAppendableRoutePilotReportHydratedStorageKey] = useState<
    string | null
  >(null)
  const appendableRoutePilotReportRef = useRef<AppendableRoutePilotReport>(appendableRoutePilotReport)
  const [appendableRouteQuickPilotRunning, setAppendableRouteQuickPilotRunning] = useState(false)
  const [appendableRouteSoakPilotRunning, setAppendableRouteSoakPilotRunning] = useState(false)
  const [appendableRouteQualificationPilotRunning, setAppendableRouteQualificationPilotRunning] = useState(false)
  const [appendableRouteStressPilotRunning, setAppendableRouteStressPilotRunning] = useState(false)
  const [appendableRouteQuickPilotMessage, setAppendableRouteQuickPilotMessage] = useState<string | null>(null)
  const [ringBufferPilotEnabled, setRingBufferPilotEnabled] = useState(
    () =>
      readClientAudioPilotFlag(
        process.env.NEXT_PUBLIC_AUDIO_RINGBUFFER_PILOT === "1",
        RINGBUFFER_PILOT_PREVIEW_FLAG,
        "rr_audio_ringbuffer_pilot"
      )
  )
  const [activeEngineMode, setActiveEngineMode] = useState<EngineMode>(() => initialAudioPilotRouting.engineMode)
  const [activeEngineCapabilities, setActiveEngineCapabilities] = useState<AudioEngineCapabilities>(() =>
    applyAppendableActivationPolicyToCapabilities(
      initialAudioPilotRouting.engineMode,
      getEngineModeCapabilities(initialAudioPilotRouting.engineMode),
      initialAppendablePilotActivation
    )
  )
  const [recordingEngineV2Enabled, setRecordingEngineV2Enabled] = useState(false)
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("compatibility")

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const [muted, setMuted] = useState<boolean[]>(trackList.map(() => false))
  const [solo, setSolo] = useState<boolean[]>(trackList.map(() => false))
  const [panUI, setPanUI] = useState<number[]>(trackList.map(() => 0))
  const [volUI, setVolUI] = useState<number[]>(initialTrackVolumes)

  const [masterVol, setMasterVol] = useState(1)
  const [reverbAmount, setReverbAmount] = useState(DEFAULT_REVERB_AMOUNT)

  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [pitchSemi, setPitchSemi] = useState(DEFAULT_PITCH_SEMITONES)

  // waveform
  const waveCanvasesRef = useRef<(HTMLCanvasElement | null)[]>([])
  const peaksRef = useRef<(WavePeaks | null)[]>(trackList.map(() => null))
  const waveformSourceBuffersRef = useRef<AudioBuffer[]>([])
  const [waveReady, setWaveReady] = useState(false)
  const lastExternalSeekRef = useRef<number | null>(null)
  const [teleprompterLines, setTeleprompterLines] = useState<TeleprompterLine[]>([])
  const [teleprompterLoadState, setTeleprompterLoadState] = useState<"idle" | "loading" | "ready" | "missing" | "empty" | "error">("idle")
  const [teleprompterAnchorEditMode, setTeleprompterAnchorEditMode] = useState(false)
  const [teleprompterAnchors, setTeleprompterAnchors] = useState<TeleprompterAnchorMap>({})
  const [teleprompterTextEditMode, setTeleprompterTextEditMode] = useState(false)
  const [teleprompterTextOverrides, setTeleprompterTextOverrides] = useState<TeleprompterTextOverrideMap>({})
  const [teleprompterAutoCollect, setTeleprompterAutoCollect] = useState(false)
  const [teleprompterSettingsOpen, setTeleprompterSettingsOpen] = useState(false)
  const [teleprompterCollectState, setTeleprompterCollectState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [teleprompterCollectInfo, setTeleprompterCollectInfo] = useState("")
  const [teleprompterPreviewSaveState, setTeleprompterPreviewSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [teleprompterPreviewSaveInfo, setTeleprompterPreviewSaveInfo] = useState("")
  const [teleprompterPreviewAutoSave, setTeleprompterPreviewAutoSave] = useState(true)
  const [teleprompterBulkTextEditOpen, setTeleprompterBulkTextEditOpen] = useState(false)
  const [audioDebugCopyState, setAudioDebugCopyState] = useState<"idle" | "copied" | "error">("idle")
  const audioDebugEntries = useSyncExternalStore(
    subscribeAudioDebugBuffer,
    getAudioDebugBufferSnapshot,
    getAudioDebugBufferSnapshot
  )
  const recentAudioDebugEntries = useMemo(() => audioDebugEntries.slice(-12).reverse(), [audioDebugEntries])
  const [teleprompterBulkTextValue, setTeleprompterBulkTextValue] = useState("")
  const [teleprompterBulkTextInfo, setTeleprompterBulkTextInfo] = useState("")
  const [teleprompterBackupInfo, setTeleprompterBackupInfo] = useState("")
  const [teleprompterDraftDirty, setTeleprompterDraftDirty] = useState(false)
  const [teleprompterDraftSavedAt, setTeleprompterDraftSavedAt] = useState("")
  const [showPiano, setShowPiano] = useState(false)
  const [pianoVolume, setPianoVolume] = useState(0.95)
  const [pianoBaseOctave, setPianoBaseOctave] = useState(3)
  const [recording, setRecording] = useState(false)
  const [countInBeat, setCountInBeat] = useState<number | null>(null)
  const [guestTrackUrl, setGuestTrackUrl] = useState<string | null>(null)
  const [guestTakes, setGuestTakes] = useState<GuestTakeMeta[]>([])
  const [activeGuestTakeId, setActiveGuestTakeId] = useState<string | null>(null)
  const [recordHeadphonesConfirmed, setRecordHeadphonesConfirmed] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return window.localStorage.getItem(RECORD_HEADPHONES_STORAGE_KEY) === "1"
    } catch {
      return false
    }
  })
  const [referenceLockEnabled, setReferenceLockEnabled] = useState(true)
  const [recordReferenceIndex, setRecordReferenceIndex] = useState<number | null>(null)
  const [recordChecklistOpen, setRecordChecklistOpen] = useState(false)
  const [guestSyncRuns, setGuestSyncRuns] = useState(0)
  const [guestLowConfidenceRuns, setGuestLowConfidenceRuns] = useState(0)
  const [playerLongTaskCount, setPlayerLongTaskCount] = useState(0)
  const [playerLongTaskMaxMs, setPlayerLongTaskMaxMs] = useState(0)
  const [recordDropoutCount, setRecordDropoutCount] = useState(0)
  const [recordRecoveryCount, setRecordRecoveryCount] = useState(0)
  const [recordingCapabilitySnapshot, setRecordingCapabilitySnapshot] = useState<RecorderCapabilitySnapshot | null>(null)
  const [recordingV2OpfsActive, setRecordingV2OpfsActive] = useState(false)
  const [recordingV2OpfsBytes, setRecordingV2OpfsBytes] = useState(0)
  const [recordingV2OpfsChunks, setRecordingV2OpfsChunks] = useState(0)
  const [recordingV2OpfsErrors, setRecordingV2OpfsErrors] = useState(0)
  const [recordingV2UploadState, setRecordingV2UploadState] = useState<"idle" | "uploading" | "uploaded" | "queued" | "failed">("idle")
  const [guestDriftSampleCount, setGuestDriftSampleCount] = useState(0)
  const [guestDriftAvgMs, setGuestDriftAvgMs] = useState(0)
  const [guestDriftMaxMs, setGuestDriftMaxMs] = useState(0)
  const [guestDriftSoftCorrections, setGuestDriftSoftCorrections] = useState(0)
  const [guestDriftHardCorrections, setGuestDriftHardCorrections] = useState(0)
  const [deviceLatencyProfile, setDeviceLatencyProfile] = useState<DeviceLatencyProfile | null>(null)
  const [bluetoothRouteRisk, setBluetoothRouteRisk] = useState(false)
  const guestTrackUrlRef = useRef<string | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingV2TapNodeRef = useRef<AudioWorkletNode | null>(null)
  const recordingV2TapSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const recordingV2TapSinkRef = useRef<GainNode | null>(null)
  const recordingV2TapModuleLoadedRef = useRef(false)
  const recordingV2TapStatsRef = useRef<RecorderV2TapStats>({
    framesCaptured: 0,
    chunkReports: 0,
    errors: 0,
  })
  const recordChunksRef = useRef<BlobPart[]>([])
  const recordStreamRef = useRef<MediaStream | null>(null)
  const countInTimerRef = useRef<number | null>(null)
  const recordArmingRef = useRef(false)
  const tempoPitchRealignTimerRef = useRef<number | null>(null)
  const tempoPitchSmoothRafRef = useRef<number | null>(null)
  const tempoAppliedRef = useRef(DEFAULT_SPEED)
  const pitchAppliedRef = useRef(DEFAULT_PITCH_SEMITONES)
  const tempoPitchSmoothFromRef = useRef({ tempo: DEFAULT_SPEED, pitch: DEFAULT_PITCH_SEMITONES })
  const tempoPitchSmoothStartedAtRef = useRef(0)
  const guestAudioRef = useRef<HTMLAudioElement | null>(null)
  const guestCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const guestPeaksRef = useRef<WavePeaks | null>(null)
  const guestScrubRef = useRef(false)
  const guestSyncGuardRef = useRef(false)
  const guestTransportLinkedRef = useRef(false)
  const guestNeedsRecalibrateRef = useRef(false)
  const guestLastDriftFixAtRef = useRef(0)
  const guestRateNudgeRef = useRef(1)
  const guestDriftSampleAbsTotalMsRef = useRef(0)
  const guestDriftSampleCountRef = useRef(0)
  const guestDriftMaxMsRef = useRef(0)
  const playerLongTaskCountRef = useRef(0)
  const playerLongTaskMaxMsRef = useRef(0)
  const playerLongTaskUiFlushAtRef = useRef(0)
  const recordDropoutCountRef = useRef(0)
  const recordRecoveryCountRef = useRef(0)
  const recordingCapabilitySnapshotRef = useRef<RecorderCapabilitySnapshot | null>(null)
  const recordingV2OpfsWriterRef = useRef<RecordingV2OpfsWriter | null>(null)
  const recordingV2TakeSessionIdRef = useRef<string | null>(null)
  const recordingV2ChunkSeqRef = useRef(0)
  const recordingV2WriteChainRef = useRef<Promise<void>>(Promise.resolve())
  const recordingV2OpfsStatsRef = useRef({
    bytes: 0,
    chunks: 0,
    errors: 0,
  })
  const guestDriftSoftFixRef = useRef(0)
  const guestDriftHardFixRef = useRef(0)
  const guestDriftLastSampleAtRef = useRef(0)
  const guestDriftUiUpdateAtRef = useRef(0)
  const guestDriftTelemetryPendingRef = useRef<GuestDriftTelemetrySnapshot>({
    sampleCount: 0,
    avgAbsDriftMs: 0,
    maxAbsDriftMs: 0,
    softCorrections: 0,
    hardCorrections: 0,
  })
  const guestDriftTelemetryLastFlushAtRef = useRef(0)
  const guestDriftTelemetryTimerRef = useRef<number | null>(null)
  const guestStartGuardTimerRef = useRef<number | null>(null)
  const [guestWaveReady, setGuestWaveReady] = useState(false)
  const [guestCurrentTime, setGuestCurrentTime] = useState(0)
  const [guestDuration, setGuestDuration] = useState(0)
  const [guestIsPlaying, setGuestIsPlaying] = useState(false)
  const [guestSoloMode, setGuestSoloMode] = useState(false)
  const [guestMuted, setGuestMuted] = useState(false)
  const [guestLoop, setGuestLoop] = useState(false)
  const [guestPanelOpen, setGuestPanelOpen] = useState(false)
  const [guestPan, setGuestPan] = useState(0)
  const [guestVolume, setGuestVolume] = useState(1)
  const [guestDownloadMenuOpen, setGuestDownloadMenuOpen] = useState(false)
  const [guestDuetMixOpen, setGuestDuetMixOpen] = useState(false)
  const [duetGuestLevel, setDuetGuestLevel] = useState(100)
  const [duetSoloLevel, setDuetSoloLevel] = useState(100)
  const [duetFormat, setDuetFormat] = useState<ExportFormat>("wav")
  const [guestExportingDuet, setGuestExportingDuet] = useState(false)
  const [guestSyncOffsetSec, setGuestSyncOffsetSec] = useState(0)
  const guestSyncOffsetRef = useRef(0)
  const guestSyncLoadedRef = useRef(false)
  const guestStartupBiasStartedAtRef = useRef(0)
  const guestStartupBiasSecRef = useRef(0)
  const guestCalibrateTimerRef = useRef<number | null>(null)
  const [guestCalibrating, setGuestCalibrating] = useState(false)
  const guestCalibratingRef = useRef(false)
  const [guestCalibrateReady, setGuestCalibrateReady] = useState(false)
  const [guestCalibrateScore, setGuestCalibrateScore] = useState<number | null>(null)
  const guestCalibrateScoreRef = useRef<number | null>(null)
  const [guestSyncQuality, setGuestSyncQuality] = useState<GuestSyncQuality>("unknown")
  const guestSyncQualityRef = useRef<GuestSyncQuality>("unknown")
  const calibrationMutedRef = useRef(false)
  const guestActionBusyRef = useRef(false)
  const [guestActionBusy, setGuestActionBusy] = useState(false)
  const recordReferenceIndexRef = useRef<number | null>(null)
  const lastManualOffsetRef = useRef<number | null>(null)
  const effectiveTeleprompterSourceUrl = useMemo(
    () => teleprompterSourceUrl ?? null,
    [teleprompterSourceUrl]
  )
  const teleprompterLinesStorageKey = useMemo(
    () => `rr_teleprompter_lines:${trackScopeId}:${effectiveTeleprompterSourceUrl ?? "local_only"}`,
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterStateStorageKey = useMemo(
    () => `rr_teleprompter_state:${trackScopeId}:${effectiveTeleprompterSourceUrl ?? "local_only"}`,
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterAnchorStorageKey = useMemo(
    () => (effectiveTeleprompterSourceUrl ? `rr_teleprompter_anchors:${trackScopeId}:${effectiveTeleprompterSourceUrl}` : null),
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterTextStorageKey = useMemo(
    () => (effectiveTeleprompterSourceUrl ? `rr_teleprompter_text_overrides:${trackScopeId}:${effectiveTeleprompterSourceUrl}` : null),
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterAutoCollectStorageKey = useMemo(
    () => (effectiveTeleprompterSourceUrl ? `rr_teleprompter_auto_collect:${trackScopeId}:${effectiveTeleprompterSourceUrl}` : null),
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterAutoCollectAllowed = TELEPROMPTER_AUTOCOLLECT_ENV_ENABLED
  const teleprompterPreviewAutoSaveStorageKey = useMemo(
    () => (effectiveTeleprompterSourceUrl ? `rr_teleprompter_preview_auto_save:${trackScopeId}:${effectiveTeleprompterSourceUrl}` : null),
    [effectiveTeleprompterSourceUrl, trackScopeId]
  )
  const teleprompterAutoCollectPrimedRef = useRef(false)
  const teleprompterPreviewAutoSavePrimedRef = useRef(false)
  const teleprompterPreviewKnownSignatureRef = useRef("")
  const teleprompterDraftDirtyRef = useRef(false)
  const teleprompterSkipDirtyMarkRef = useRef(false)
  const calibrationGuestVolumeRef = useRef(1)
  const calibrationGuestGainRef = useRef(1)
  const guestTogetherFirstStartRef = useRef(true)
  const guestPanNodeRef = useRef<StereoPannerNode | null>(null)
  const guestGainNodeRef = useRef<GainNode | null>(null)
  const guestSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const [recSoloHint, setRecSoloHint] = useState(false)
  const [uiLang, setUiLang] = useState<UiLang>("ru")
  const [isHydrated, setIsHydrated] = useState(false)
  const teleprompterLinesRef = useRef<TeleprompterLine[]>([])
  const teleprompterAnchorsRef = useRef<TeleprompterAnchorMap>({})
  const teleprompterTextOverridesRef = useRef<TeleprompterTextOverrideMap>({})
  const teleprompterBackupInputRef = useRef<HTMLInputElement | null>(null)

  const setMainPlayingState = useCallback(
    (playing: boolean) => {
      isPlayingRef.current = playing
      setIsPlaying(playing)
      setMainPlayPending(false)
      onPlaybackStateChange?.(playing)
    },
    [onPlaybackStateChange]
  )

  const beginAudioTtfpAttempt = useCallback((trigger: string) => {
    if (!isAudioTtfpEnabled()) return
    const nextId = audioTtfpSequenceRef.current + 1
    audioTtfpSequenceRef.current = nextId
    const attempt: AudioTtfpAttempt = {
      id: nextId,
      trackScopeId,
      trigger,
      startedAtMs: readAudioPerfNowMs(),
      startedAtIso: new Date().toISOString(),
      stages: {},
      finalized: false,
    }
    audioTtfpAttemptRef.current = attempt
  }, [trackScopeId])

  const markAudioTtfpStage = useCallback((stage: AudioTtfpStage, extra?: Record<string, unknown>) => {
    if (!isAudioTtfpEnabled()) return
    const attempt = audioTtfpAttemptRef.current
    if (!attempt || attempt.finalized) return
    if (attempt.trackScopeId !== trackScopeId) return
    if (typeof attempt.stages[stage] === "number") return
    const ts = readAudioPerfNowMs()
    attempt.stages[stage] = ts
    logAudioDebug("ttfp:stage", {
      id: attempt.id,
      trigger: attempt.trigger,
      stage,
      elapsedMs: Number((ts - attempt.startedAtMs).toFixed(1)),
      ...extra,
    })
  }, [trackScopeId])

  const abortAudioTtfpAttempt = useCallback((reason: string) => {
    const attempt = audioTtfpAttemptRef.current
    if (!attempt || attempt.finalized) return
    attempt.finalized = true
    audioTtfpAttemptRef.current = null
    logAudioDebug("ttfp:abort", {
      id: attempt.id,
      trigger: attempt.trigger,
      reason,
      elapsedMs: Number((readAudioPerfNowMs() - attempt.startedAtMs).toFixed(1)),
    })
  }, [])

  const flushAudioTtfpAttempt = useCallback((finalStage: AudioTtfpStage) => {
    if (!isAudioTtfpEnabled()) return
    const attempt = audioTtfpAttemptRef.current
    if (!attempt || attempt.finalized) return
    if (attempt.trackScopeId !== trackScopeId) return
    const finalTs = attempt.stages[finalStage] ?? readAudioPerfNowMs()
    const ttfpMs = Math.max(0, Number((finalTs - attempt.startedAtMs).toFixed(1)))
    if (ttfpMs <= 0) {
      attempt.finalized = true
      audioTtfpAttemptRef.current = null
      return
    }

    const stageDelta = (from: AudioTtfpStage, to: AudioTtfpStage): number | undefined => {
      const fromTs = attempt.stages[from]
      const toTs = attempt.stages[to]
      if (typeof fromTs !== "number" || typeof toTs !== "number") return undefined
      return Math.max(0, Number((toTs - fromTs).toFixed(1)))
    }

    const samples = audioTtfpSamplesRef.current
    samples.push(ttfpMs)
    if (samples.length > AUDIO_TTFP_SAMPLE_WINDOW) samples.splice(0, samples.length - AUDIO_TTFP_SAMPLE_WINDOW)
    const p50Ms = calcPercentileMs(samples, 50)
    const p95Ms = calcPercentileMs(samples, 95)

    const payload = {
      trackScopeId: attempt.trackScopeId,
      trigger: attempt.trigger,
      finalStage,
      ttfpMs,
      sampleCount: samples.length,
      p50Ms,
      p95Ms,
      clickToPlayMs: stageDelta("click", "play_call"),
      playToCtxResumeMs: stageDelta("play_call", "ctx_resumed"),
      ctxResumeToSeekMs: stageDelta("ctx_resumed", "seek_applied"),
      seekToEngineStartMs: stageDelta("seek_applied", "engines_start"),
      engineStartToGateOpenMs: stageDelta("engines_start", "gate_open"),
      gateOpenToPlayingMs: stageDelta("gate_open", "playing_state"),
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
      locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      startedAt: attempt.startedAtIso,
    }

    logAudioTtfp(payload)

    // In dev diagnostics mode keep metrics in console only by default:
    // file-backed analytics writes can trigger Fast Refresh and distort audio behavior.
    const shouldPersist =
      process.env.NODE_ENV === "production" || AUDIO_TTFP_PERSIST_IN_DEV
    if (!shouldPersist) {
      attempt.finalized = true
      audioTtfpAttemptRef.current = null
      return
    }

    const json = JSON.stringify(payload)
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const blob = new Blob([json], { type: "application/json" })
        navigator.sendBeacon(AUDIO_TTFP_API_PATH, blob)
      } catch {
        void fetch(AUDIO_TTFP_API_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json,
          keepalive: true,
        })
      }
    } else {
      void fetch(AUDIO_TTFP_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
        keepalive: true,
      })
    }

    attempt.finalized = true
    audioTtfpAttemptRef.current = null
  }, [trackScopeId])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      if (window.sessionStorage.getItem(FORCE_AUTOPLAY_STORAGE_KEY) === "1") {
        pendingPlayRef.current = true
        window.sessionStorage.removeItem(FORCE_AUTOPLAY_STORAGE_KEY)
      }
      const raw = window.sessionStorage.getItem(NAV_HANDOFF_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as NavHandoffState
      if (!parsed || typeof parsed !== "object") return
      if (parsed.trackScopeId !== trackScopeId) return
      if (!parsed.playing) return
      if (!Number.isFinite(parsed.positionSec)) return
      if (Date.now() - parsed.ts > NAV_HANDOFF_TTL_MS) return

      navResumePositionRef.current = Math.max(0, parsed.positionSec)
      navResumePlayRef.current = true
      setLoopOn(!!parsed.loopOn)
      window.sessionStorage.removeItem(NAV_HANDOFF_STORAGE_KEY)
    } catch {}
  }, [trackScopeId])

  useEffect(() => {
    loopOnRef.current = loopOn
  }, [loopOn])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(RECORD_HEADPHONES_STORAGE_KEY, recordHeadphonesConfirmed ? "1" : "0")
    } catch {}
  }, [recordHeadphonesConfirmed])

  const t = useMemo(() => {
    const msg = (key: I18nKey) => {
      const legacyLocalized = MULTITRACK_LEGACY_MESSAGES[uiLang][key]
      const legacyRu = MULTITRACK_LEGACY_MESSAGES.ru[key]
      const localized = I18N_MESSAGES[uiLang][key]
      const enLocalized = I18N_MESSAGES.en[key]
      if (key.startsWith("multitrack.") && uiLang === "ru") {
        if (localized === key || localized === enLocalized) {
          return legacyRu ?? localized
        }
      }
      if (localized !== key) return localized
      const ruFallback = I18N_MESSAGES.ru[key]
      if (ruFallback !== key) return ruFallback
      return legacyLocalized ?? legacyRu ?? key
    }
    return {
      volume: msg("multitrack.volume"),
      reverb: msg("multitrack.reverb"),
      speed: msg("multitrack.speed"),
      pitch: msg("multitrack.pitch"),
      pan: msg("multitrack.pan"),
      solo: msg("multitrack.solo"),
      mute: msg("multitrack.mute"),
      save: msg("multitrack.save"),
      export: msg("multitrack.export"),
      soloFmtM4a: msg("multitrack.soloFmtM4a"),
      soloFmtMp3: msg("multitrack.soloFmtMp3"),
      soloFmtWav: msg("multitrack.soloFmtWav"),
      duet: msg("multitrack.duet"),
      duetGuest: msg("multitrack.duetGuest"),
      duetSoloTrack: msg("multitrack.duetSoloTrack"),
      duetFormat: msg("multitrack.duetFormat"),
      saveDuet: msg("multitrack.saveDuet"),
      delay: msg("multitrack.delay"),
      syncCheck: msg("multitrack.syncCheck"),
      syncGood: msg("multitrack.syncGood"),
      syncOk: msg("multitrack.syncOk"),
      syncLow: msg("multitrack.syncLow"),
      syncUnknown: msg("multitrack.syncUnknown"),
      recordChecklist: msg("multitrack.recordChecklist"),
      referenceLock: msg("multitrack.referenceLock"),
      headphonesCheck: msg("multitrack.headphonesCheck"),
      selectReference: msg("multitrack.selectReference"),
      referenceAutoSolo: msg("multitrack.referenceAutoSolo"),
      referenceLockActive: msg("multitrack.referenceLockActive"),
      takes: msg("multitrack.takes"),
      activateTake: msg("multitrack.activateTake"),
      syncRuns: msg("multitrack.syncRuns"),
      lowConfidenceRuns: msg("multitrack.lowConfidenceRuns"),
      longTaskCount: "long_task_count",
      longTaskMax: "max_long_task_ms",
      progressiveLoadFlag: "multitrack_progressive_load",
      startupChunkFlag: "multitrack_startup_chunk_pilot",
      startupChunkSpliceFlag: "multitrack_startup_splice_pilot",
      streamingBufferFlag: "multitrack_streaming_pilot",
      appendableQueueFlag: "multitrack_appendable_queue_pilot",
      ringBufferFlag: "multitrack_ringbuffer_pilot",
      recordingV2Flag: "recording_engine_v2",
      recordingEngine: "recording_engine",
      recorderDropouts: "input_dropouts",
      recorderRecoveries: "input_recoveries",
      recorderBaseLatency: "base_latency_ms",
      recorderOutputLatency: "output_latency_ms",
      recorderInputLatency: "input_latency_ms",
      recorderInputSettings: "input_settings",
      recorderCapabilities: "capabilities",
      recorderTapActive: "worklet_tap_active",
      recorderTapFrames: "worklet_frames",
      recorderTapChunks: "worklet_chunks",
      recorderTapErrors: "worklet_tap_errors",
      recorderOpfsActive: "opfs_writer_active",
      recorderOpfsBytes: "opfs_bytes",
      recorderOpfsChunks: "opfs_chunks",
      recorderOpfsErrors: "opfs_errors",
      recorderUploadState: "upload_state",
      recordingModeLabel: msg("multitrack.recordingModeLabel"),
      recordingModeCompatibility: msg("multitrack.recordingModeCompatibility"),
      recordingModeLocalMaster: msg("multitrack.recordingModeLocalMaster"),
      recordingModeFallbackHint: msg("multitrack.recordingModeFallbackHint"),
      driftSamples: msg("multitrack.driftSamples"),
      driftAvg: msg("multitrack.driftAvg"),
      driftMax: msg("multitrack.driftMax"),
      softDriftFixes: msg("multitrack.softDriftFixes"),
      hardDriftFixes: msg("multitrack.hardDriftFixes"),
      deviceProfile: msg("multitrack.deviceProfile"),
      bluetoothRisk: msg("multitrack.bluetoothRisk"),
      left: msg("multitrack.left"),
      right: msg("multitrack.right"),
      volShort: msg("multitrack.volShort"),
      loadingAudio: msg("multitrack.loadingAudio"),
      goToStartAria: msg("multitrack.goToStartAria"),
      goToStartTitle: msg("multitrack.goToStartTitle"),
      playAria: msg("multitrack.playAria"),
      pauseAria: msg("multitrack.pauseAria"),
      playButton: msg("multitrack.playButton"),
      pauseButton: msg("multitrack.pauseButton"),
      repeatTrackAria: msg("multitrack.repeatTrackAria"),
      repeatTrackTitle: msg("multitrack.repeatTrackTitle"),
      recordGuestStartAria: msg("multitrack.recordGuestStartAria"),
      recordGuestStopAria: msg("multitrack.recordGuestStopAria"),
      recordGuestStartTitle: msg("multitrack.recordGuestStartTitle"),
      recordGuestStopTitle: msg("multitrack.recordGuestStopTitle"),
      recSoloHint: msg("multitrack.recSoloHint"),
      trackPositionAria: msg("multitrack.trackPositionAria"),
      masterVolumeAria: msg("multitrack.masterVolumeAria"),
      speedAria: msg("multitrack.speedAria"),
      guestPanelTitle: msg("multitrack.guestPanelTitle"),
      calibrating: msg("multitrack.calibrating"),
      delayDetected: msg("multitrack.delayDetected"),
      delayPending: msg("multitrack.delayPending"),
      countInPrefix: msg("multitrack.countInPrefix"),
      guestGoToStartAria: msg("multitrack.guestGoToStartAria"),
      guestGoToStartTitle: msg("multitrack.guestGoToStartTitle"),
      guestWithTrackStart: msg("multitrack.guestWithTrackStart"),
      guestWithTrackStop: msg("multitrack.guestWithTrackStop"),
      guestRepeatFragmentTitle: msg("multitrack.guestRepeatFragmentTitle"),
      guestPanAria: msg("multitrack.guestPanAria"),
      guestVolumeAria: msg("multitrack.guestVolumeAria"),
      guestDelayAria: msg("multitrack.guestDelayAria"),
      guestWaveformTitle: msg("multitrack.guestWaveformTitle"),
      trackWaveformTitle: msg("multitrack.trackWaveformTitle"),
      pianoShow: msg("multitrack.pianoShow"),
      pianoHide: msg("multitrack.pianoHide"),
      pianoVolumeLabel: msg("multitrack.pianoVolumeLabel"),
      pianoVolumeAria: msg("multitrack.pianoVolumeAria"),
      pianoOctaveRangeLabel: msg("multitrack.pianoOctaveRangeLabel"),
      pianoOctaveRangeAria: msg("multitrack.pianoOctaveRangeAria"),
      pianoHint: msg("multitrack.pianoHint"),
      songFallbackTitle: msg("multitrack.songFallbackTitle"),
      songFallbackSubtitle: msg("multitrack.songFallbackSubtitle"),
      safePanFallback: msg("multitrack.safePanFallback"),
      guestStartSyncFailed: msg("multitrack.guestStartSyncFailed"),
      recordStartInProgress: msg("multitrack.recordStartInProgress"),
      recordRequireSingleSolo: msg("multitrack.recordRequireSingleSolo"),
      recordRequireHeadphones: msg("multitrack.recordRequireHeadphones"),
      recordMicDisconnected: msg("multitrack.recordMicDisconnected"),
      recordMicError: msg("multitrack.recordMicError"),
      recordTooShort: msg("multitrack.recordTooShort"),
      recordSyncAutoCheckFailed: msg("multitrack.recordSyncAutoCheckFailed"),
      recordSyncUnstable: msg("multitrack.recordSyncUnstable"),
      recordAlreadyRunning: msg("multitrack.recordAlreadyRunning"),
      recordStartFailed: msg("multitrack.recordStartFailed"),
      recordMicPermissionDenied: msg("multitrack.recordMicPermissionDenied"),
      recordTakeLoadFailed: msg("multitrack.recordTakeLoadFailed"),
      guestPlaybackFailed: msg("multitrack.guestPlaybackFailed"),
      guestTrackModeRequireSolo: msg("multitrack.guestTrackModeRequireSolo"),
      referenceLockRequireSoloBeforeStart: msg("multitrack.referenceLockRequireSoloBeforeStart"),
      calibrateRequireSolo: msg("multitrack.calibrateRequireSolo"),
      calibrateRequireTake: msg("multitrack.calibrateRequireTake"),
      audioEngineNotReady: msg("multitrack.audioEngineNotReady"),
      calibrateMeasureFailed: msg("multitrack.calibrateMeasureFailed"),
      exportRequireTake: msg("multitrack.exportRequireTake"),
      exportFallbackWav: msg("multitrack.exportFallbackWav"),
      exportMp3Unavailable: msg("multitrack.exportMp3Unavailable"),
      exportM4aUnavailable: msg("multitrack.exportM4aUnavailable"),
      exportSoloFailed: msg("multitrack.exportSoloFailed"),
      exportDuetRequireSolo: msg("multitrack.exportDuetRequireSolo"),
      exportDuetUnsupported: msg("multitrack.exportDuetUnsupported"),
      exportDuetCalibrateFailed: msg("multitrack.exportDuetCalibrateFailed"),
      exportDuetTrackLoadFailed: msg("multitrack.exportDuetTrackLoadFailed"),
      exportDuetFallbackWav: msg("multitrack.exportDuetFallbackWav"),
      exportDuetFailed: msg("multitrack.exportDuetFailed"),
      tempoLocked: msg("multitrack.tempoLocked"),
      pitchLocked: msg("multitrack.pitchLocked"),
      referenceLockTrackChangeBlocked: msg("multitrack.referenceLockTrackChangeBlocked"),
      referenceLockSoloRequired: msg("multitrack.referenceLockSoloRequired"),
      guestFilePlaybackFailed: msg("multitrack.guestFilePlaybackFailed"),
      teleprompterTitle: msg("multitrack.teleprompterTitle"),
      teleprompterEmptyHint: msg("multitrack.teleprompterEmptyHint"),
      teleprompterLoadLoading: msg("multitrack.teleprompterLoadLoading"),
      teleprompterLoadMissing: msg("multitrack.teleprompterLoadMissing"),
      teleprompterLoadEmpty: msg("multitrack.teleprompterLoadEmpty"),
      teleprompterLoadError: msg("multitrack.teleprompterLoadError"),
      teleprompterLoadIdle: msg("multitrack.teleprompterLoadIdle"),
      teleprompterLineAriaPrefix: msg("multitrack.teleprompterLineAriaPrefix"),
      teleprompterSettingsShow: msg("multitrack.teleprompterSettingsShow"),
      teleprompterSettingsHide: msg("multitrack.teleprompterSettingsHide"),
      teleprompterMarkupShow: msg("multitrack.teleprompterMarkupShow"),
      teleprompterMarkupHide: msg("multitrack.teleprompterMarkupHide"),
      teleprompterEditorShow: msg("multitrack.teleprompterEditorShow"),
      teleprompterEditorHide: msg("multitrack.teleprompterEditorHide"),
      teleprompterPasteBulk: msg("multitrack.teleprompterPasteBulk"),
      teleprompterAnchorCurrent: msg("multitrack.teleprompterAnchorCurrent"),
      teleprompterCopyJson: msg("multitrack.teleprompterCopyJson"),
      teleprompterDownloadJson: msg("multitrack.teleprompterDownloadJson"),
      teleprompterBackupDownload: msg("multitrack.teleprompterBackupDownload"),
      teleprompterBackupRestore: msg("multitrack.teleprompterBackupRestore"),
      teleprompterCopyDatasetJsonl: msg("multitrack.teleprompterCopyDatasetJsonl"),
      teleprompterDownloadDatasetJsonl: msg("multitrack.teleprompterDownloadDatasetJsonl"),
      teleprompterSaveDataset: msg("multitrack.teleprompterSaveDataset"),
      teleprompterRewritePreview: msg("multitrack.teleprompterRewritePreview"),
      teleprompterAutoPreviewOn: msg("multitrack.teleprompterAutoPreviewOn"),
      teleprompterAutoPreviewOff: msg("multitrack.teleprompterAutoPreviewOff"),
      teleprompterAutoCollectOn: msg("multitrack.teleprompterAutoCollectOn"),
      teleprompterAutoCollectOff: msg("multitrack.teleprompterAutoCollectOff"),
      teleprompterResetAnchors: msg("multitrack.teleprompterResetAnchors"),
      teleprompterResetText: msg("multitrack.teleprompterResetText"),
      teleprompterDatasetStatus: msg("multitrack.teleprompterDatasetStatus"),
      teleprompterDraftStatus: msg("multitrack.teleprompterDraftStatus"),
      teleprompterDraftDirty: msg("multitrack.teleprompterDraftDirty"),
      teleprompterDraftSaved: msg("multitrack.teleprompterDraftSaved"),
      teleprompterPreviewStatus: msg("multitrack.teleprompterPreviewStatus"),
      teleprompterBackupStatus: msg("multitrack.teleprompterBackupStatus"),
      teleprompterBulkHint: msg("multitrack.teleprompterBulkHint"),
      teleprompterApply: msg("multitrack.teleprompterApply"),
      teleprompterCancel: msg("multitrack.teleprompterCancel"),
      teleprompterBackupImporting: msg("multitrack.teleprompterBackupImporting"),
      teleprompterBackupImportedPrefix: msg("multitrack.teleprompterBackupImportedPrefix"),
      teleprompterLinesWord: msg("multitrack.teleprompterLinesWord"),
      teleprompterImportErrorPrefix: msg("multitrack.teleprompterImportErrorPrefix"),
      teleprompterCollectSaving: msg("multitrack.teleprompterCollectSaving"),
      teleprompterCollectSavedPrefix: msg("multitrack.teleprompterCollectSavedPrefix"),
      teleprompterErrorPrefix: msg("multitrack.teleprompterErrorPrefix"),
      teleprompterBulkCreatedPrefix: msg("multitrack.teleprompterBulkCreatedPrefix"),
      teleprompterBulkAppliedPrefix: msg("multitrack.teleprompterBulkAppliedPrefix"),
      teleprompterPreviewPathMissing: msg("multitrack.teleprompterPreviewPathMissing"),
      teleprompterPreviewAutosaving: msg("multitrack.teleprompterPreviewAutosaving"),
      teleprompterPreviewSaving: msg("multitrack.teleprompterPreviewSaving"),
      teleprompterPreviewAutosavedPrefix: msg("multitrack.teleprompterPreviewAutosavedPrefix"),
      teleprompterPreviewSavedPrefix: msg("multitrack.teleprompterPreviewSavedPrefix"),
    }
  }, [uiLang])

  const appendablePilotChecklistState = useMemo(() => {
    const routing = resolveAudioPilotRouting({
      trackCount: trackList.length,
      streamingBufferPilotEnabled,
      appendableQueuePilotEnabled: effectiveAppendableQueuePilotEnabled,
      appendableQueueMultistemPilotEnabled: effectiveAppendableQueueMultistemPilotEnabled,
      ringBufferPilotEnabled,
      appendableActivationConfigured: appendablePilotActivation.activationConfigured,
      appendableActivationAllowed: appendablePilotActivation.activationAllowed,
    })
    const flagsReady = routing.appendableFlagsReady
    const modeReady = activeEngineMode === "appendable_queue_worklet"
    const probeActive = appendableQueueRuntimeProbeSnapshot.active
    const cleanRuntime =
      appendableQueueRuntimeProbeSnapshot.totalUnderrunFrames === 0 &&
      appendableQueueRuntimeProbeSnapshot.totalDiscontinuityCount === 0
    const readyThresholdSec =
      appendableQueueRuntimeProbeSnapshot.readyThresholdSec ?? APPENDABLE_QUEUE_RUNTIME_READY_SOAK_SEC
    const cleanSoakSec = appendableQueueRuntimeProbeSnapshot.cleanSoakSec ?? 0
    const readySoakMet = cleanSoakSec >= Math.max(0, readyThresholdSec - 0.001)
    const safeRolloutMode = appendablePilotActivation.activationMode === "safe_rollout"
    const safeRolloutSourceGateReason = safeRolloutMode
      ? appendableQueueSourceProgressSnapshot.continuationQualification === "qualified"
        ? appendableQueueSourceProgressSnapshot.mode === "startup_head_continuation_chunks"
          ? null
          : `unexpected_source_mode:${appendableQueueSourceProgressSnapshot.mode}`
        : appendableQueueSourceProgressSnapshot.continuationQualification === "fallback"
          ? appendableQueueSourceProgressSnapshot.continuationQualificationReason ?? "continuation_preflight_failed"
          : appendableQueueSourceProgressSnapshot.mode === "full_buffer"
            ? "continuation_qualification_missing"
            : null
      : null
    const safeRolloutCandidateTarget = appendableQueueSourceProgressSnapshot.safeRolloutCandidateTarget

    let status:
      | "waiting_for_flags"
      | "blocked_by_targeting"
      | "play_to_activate_probe"
      | "soak_in_progress"
      | "ready_for_manual_pilot"
      | "attention_required" = "waiting_for_flags"
    if (flagsReady && modeReady && probeActive && cleanRuntime && readySoakMet && !safeRolloutSourceGateReason) {
      status = "ready_for_manual_pilot"
    } else if (routing.appendableBlockedByTargeting) {
      status = "blocked_by_targeting"
    } else if (routing.appendableBlockedByStreaming) {
      status = "attention_required"
    } else if (safeRolloutSourceGateReason) {
      status = "attention_required"
    } else if (flagsReady && modeReady && probeActive && !cleanRuntime) {
      status = "attention_required"
    } else if (flagsReady && modeReady && probeActive && cleanRuntime) {
      status = "soak_in_progress"
    } else if (flagsReady && modeReady) {
      status = "play_to_activate_probe"
    }

    const statusLabel =
      uiLang === "ru"
        ? status === "ready_for_manual_pilot"
          ? "готов к ручному pilot"
        : status === "soak_in_progress"
          ? `идет runtime soak (${cleanSoakSec.toFixed(1)} / ${readyThresholdSec.toFixed(1)}s)`
        : status === "blocked_by_targeting"
            ? "track-set не включен в appendable rollout"
          : routing.appendableBlockedByStreaming
            ? "appendable pilot перекрыт streaming mode"
          : safeRolloutSourceGateReason
            ? `safe rollout fallback: ${safeRolloutSourceGateReason}`
          : status === "play_to_activate_probe"
            ? "запусти playback для runtime probe"
            : status === "attention_required"
              ? "нужна проверка runtime"
              : "включи оба appendable флага"
        : status === "ready_for_manual_pilot"
          ? "ready for manual pilot"
        : status === "soak_in_progress"
          ? `runtime soak in progress (${cleanSoakSec.toFixed(1)} / ${readyThresholdSec.toFixed(1)}s)`
        : status === "blocked_by_targeting"
            ? "track set is not targeted for appendable rollout"
          : routing.appendableBlockedByStreaming
            ? "appendable pilot is blocked by streaming mode"
          : safeRolloutSourceGateReason
            ? `safe rollout fallback: ${safeRolloutSourceGateReason}`
          : status === "play_to_activate_probe"
            ? "start playback to activate runtime probe"
            : status === "attention_required"
              ? "runtime attention required"
              : "enable both appendable flags"

    const steps =
      routing.appendableBlockedByTargeting
        ? uiLang === "ru"
          ? appendableQueueSourceProgressSnapshot.safeRolloutCandidateQualified && safeRolloutCandidateTarget
            ? [
                `1. Добавь \`${safeRolloutCandidateTarget}\` в \`rr_audio_appendable_queue_safe_rollout_targets\`.`,
                "2. Оставь включенными `appendable queue` и `appendable multistem`; startup flags здесь не нужны.",
                "3. Перезагрузи `/sound/...` route и проверь, что `appendable activation mode = safe_rollout`.",
              ]
            : [
                "1. Добавь текущий route slug или trackScopeId в `rr_audio_appendable_queue_activation_targets`.",
                "2. Оставь включенными `appendable queue` и `appendable multistem`.",
                "3. Перезагрузи `/sound/...` route и проверь, что `audio mode = appendable_queue_worklet`.",
              ]
          : [
              ...(appendableQueueSourceProgressSnapshot.safeRolloutCandidateQualified && safeRolloutCandidateTarget
                ? [
                    `1. Add \`${safeRolloutCandidateTarget}\` to \`rr_audio_appendable_queue_safe_rollout_targets\`.`,
                    "2. Keep `appendable queue` and `appendable multistem` enabled; startup flags are not required here.",
                    "3. Reload the `/sound/...` route and confirm `appendable activation mode = safe_rollout`.",
                  ]
                : [
                    "1. Add the current route slug or trackScopeId to `rr_audio_appendable_queue_activation_targets`.",
                    "2. Keep `appendable queue` and `appendable multistem` enabled.",
                    "3. Reload the `/sound/...` route and confirm `audio mode = appendable_queue_worklet`.",
                  ]),
            ]
        : routing.appendableBlockedByStreaming
        ? uiLang === "ru"
          ? [
              "1. Отключи `streaming` flag для route-level appendable pilot.",
              "2. Оставь включенными `appendable queue` и `appendable multistem`.",
              "3. Перезагрузи `/sound/...` route и проверь, что `audio mode = appendable_queue_worklet`.",
            ]
          : [
              "1. Disable the `streaming` flag for the route-level appendable pilot.",
              "2. Keep `appendable queue` and `appendable multistem` enabled.",
              "3. Reload the `/sound/...` route and confirm `audio mode = appendable_queue_worklet`.",
            ]
        : safeRolloutSourceGateReason
        ? uiLang === "ru"
          ? [
              `1. Проверь reason code safe rollout fallback: ${safeRolloutSourceGateReason}.`,
              "2. Сверь manifest continuation plan across stems и root-level continuationChunks contract.",
              "3. Пока qualification не станет `qualified`, route должен оставаться на appendable `full_buffer`.",
            ]
          : [
              `1. Review the safe rollout fallback reason code: ${safeRolloutSourceGateReason}.`,
              "2. Recheck the manifest continuation plan across stems and the root-level continuationChunks contract.",
              "3. Until qualification becomes `qualified`, the route should stay on appendable `full_buffer`.",
            ]
        : status === "soak_in_progress"
        ? uiLang === "ru"
          ? [
              "1. Оставь playback и appendable route активными без новых seek/pause.",
              `2. Дождиcь непрерывного clean runtime soak не меньше ${readyThresholdSec.toFixed(1)}s.`,
              "3. Если underrun/discontinuity появятся раньше, route не должен считаться ready.",
            ]
          : [
              "1. Keep playback and the appendable route running without new seek/pause input.",
              `2. Wait until the clean runtime soak reaches at least ${readyThresholdSec.toFixed(1)}s.`,
              "3. If underrun/discontinuity appears before that, the route must not be considered ready.",
            ]
        : appendablePilotActivation.activationMode === "safe_rollout"
        ? uiLang === "ru"
          ? [
              "1. Safe rollout path держит tempo locked на `1.0` и pitch выключенным.",
              "2. Нажми `Воспроизвести` на обычном `/sound/...` route.",
              "3. Проверь, что `audio mode = appendable_queue_worklet` и `tempo: off / pitch: off`.",
              "4. Убедись, что runtime probe active и underrun/discontinuity = 0.",
            ]
          : [
              "1. The safe rollout path keeps tempo locked at `1.0` and pitch disabled.",
              "2. Press `Play` on the normal `/sound/...` route.",
              "3. Confirm `audio mode = appendable_queue_worklet` and `tempo: off / pitch: off`.",
              "4. Verify the runtime probe is active and underrun/discontinuity remain 0.",
            ]
        : uiLang === "ru"
        ? [
            "1. Включи `appendable queue` и `appendable multistem` flags.",
            "2. Нажми `Воспроизвести` на обычном `/sound/...` route.",
            "3. Проверь, что `appendable queue probe = active` и underrun/discontinuity = 0.",
            "4. Сделай seek через основной слайдер и убедись, что probe остается active.",
          ]
        : [
            "1. Enable both `appendable queue` and `appendable multistem` flags.",
            "2. Press `Play` on the normal `/sound/...` route.",
            "3. Confirm `appendable queue probe = active` and underrun/discontinuity = 0.",
            "4. Perform one seek on the main slider and confirm the probe stays active.",
          ]

    return {
      status,
      statusLabel,
      steps,
    }
  }, [
    activeEngineMode,
    appendablePilotActivation.activationAllowed,
    appendablePilotActivation.activationConfigured,
    appendablePilotActivation.activationMode,
    effectiveAppendableQueueMultistemPilotEnabled,
    effectiveAppendableQueuePilotEnabled,
    ringBufferPilotEnabled,
    appendableQueueRuntimeProbeSnapshot.active,
    appendableQueueRuntimeProbeSnapshot.cleanSoakSec,
    appendableQueueRuntimeProbeSnapshot.readyThresholdSec,
    appendableQueueRuntimeProbeSnapshot.totalDiscontinuityCount,
    appendableQueueRuntimeProbeSnapshot.totalUnderrunFrames,
    appendableQueueSourceProgressSnapshot.continuationQualification,
    appendableQueueSourceProgressSnapshot.continuationQualificationReason,
    appendableQueueSourceProgressSnapshot.safeRolloutCandidateQualified,
    appendableQueueSourceProgressSnapshot.safeRolloutCandidateTarget,
    appendableQueueSourceProgressSnapshot.mode,
    streamingBufferPilotEnabled,
    trackList.length,
    uiLang,
  ])

  const appendableSafeRolloutCandidateTarget = appendableQueueSourceProgressSnapshot.safeRolloutCandidateTarget
  const appendableSafeRolloutCandidateConfigured =
    !!appendableSafeRolloutCandidateTarget &&
    appendablePilotActivation.safeRolloutConfiguredTargets.includes(appendableSafeRolloutCandidateTarget)

  const toggleCurrentRouteSafeRolloutTarget = useCallback(() => {
    const target = appendableQueueSourceProgressSnapshot.safeRolloutCandidateTarget
    if (!target) return
    const nextTargets = appendablePilotActivation.safeRolloutConfiguredTargets.includes(target)
      ? removeClientAppendableSafeRolloutTarget(target)
      : addClientAppendableSafeRolloutTarget(target)
    setAppendableActivationStorageRevision((current) => current + 1)
    setAppendableRouteQuickPilotMessage(
      uiLang === "ru"
        ? nextTargets.includes(target)
          ? `safe rollout target добавлен: ${target}`
          : `safe rollout target удален: ${target}`
        : nextTargets.includes(target)
          ? `safe rollout target added: ${target}`
          : `safe rollout target removed: ${target}`
    )
  }, [
    appendablePilotActivation.safeRolloutConfiguredTargets,
    appendableQueueSourceProgressSnapshot.safeRolloutCandidateTarget,
    uiLang,
  ])

  const applyQualifiedSafeRolloutCohort = useCallback(() => {
    void (async () => {
      const manifestTargets = await listAppendableStartupManifestSlugs()
      if (!manifestTargets.length) {
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru" ? "qualified safe rollout cohort не найден" : "qualified safe rollout cohort not found"
        )
        return
      }
      const nextTargets = addClientAppendableSafeRolloutTargets(manifestTargets)
      setAppendableActivationStorageRevision((current) => current + 1)
      setAppendableRouteQuickPilotMessage(
        uiLang === "ru"
          ? `qualified safe rollout cohort применен: ${manifestTargets.length} route / configured ${nextTargets.length}`
          : `qualified safe rollout cohort applied: ${manifestTargets.length} routes / configured ${nextTargets.length}`
      )
    })()
  }, [uiLang])

  const commitAppendableRoutePilotReport = useCallback(
    (
      next:
        | AppendableRoutePilotReport
        | ((current: AppendableRoutePilotReport) => AppendableRoutePilotReport)
    ) => {
      if (typeof next !== "function") {
        appendableRoutePilotReportRef.current = next
      }
      setAppendableRoutePilotReport((current) => {
        const resolved = typeof next === "function" ? next(current) : next
        appendableRoutePilotReportRef.current = resolved
        return resolved
      })
    },
    []
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    commitAppendableRoutePilotReport(
      restoreAppendableRoutePilotReport(window.localStorage.getItem(appendableRoutePilotReportStorageKey)) ??
        createAppendableRoutePilotReport()
    )
    setAppendableRoutePilotReportHydratedStorageKey(appendableRoutePilotReportStorageKey)
  }, [appendableRoutePilotReportStorageKey, commitAppendableRoutePilotReport])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (appendableRoutePilotReportHydratedStorageKey !== appendableRoutePilotReportStorageKey) return
    try {
      window.localStorage.setItem(appendableRoutePilotReportStorageKey, JSON.stringify(appendableRoutePilotReport))
    } catch {}
  }, [
    appendableRoutePilotReport,
    appendableRoutePilotReportHydratedStorageKey,
    appendableRoutePilotReportStorageKey,
  ])

  useEffect(() => {
    appendableRouteVisibilitySnapshotRef.current = appendableRouteVisibilitySnapshot
  }, [appendableRouteVisibilitySnapshot])

  useEffect(() => {
    const nextVisibilitySnapshot = createAppendableRouteVisibilitySnapshot()
    appendableRouteVisibilitySnapshotRef.current = nextVisibilitySnapshot
    appendableRouteVisibilityInitialPageShowRecordedRef.current = false
    setAppendableRouteVisibilitySnapshot(nextVisibilitySnapshot)
  }, [trackScopeId])

  const persistAppendableRoutePilotReportToStorage = useCallback((report: AppendableRoutePilotReport) => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(appendableRoutePilotReportStorageKey, JSON.stringify(report))
    } catch {}
  }, [appendableRoutePilotReportStorageKey])

  const buildAppendableRoutePilotSnapshot = useCallback((visibilityOverride?: AppendableRouteVisibilitySnapshot): AppendableRoutePilotReportSnapshot => {
    const capturedAt = new Date().toISOString()
    const probe = cloneAppendableQueueRuntimeProbeSnapshot(appendableQueueRuntimeProbeSnapshot)
    if (probe.supportsTempo == null) {
      probe.supportsTempo = activeEngineCapabilities.supportsTempo
    }
    if (probe.supportsIndependentPitch == null) {
      probe.supportsIndependentPitch = activeEngineCapabilities.supportsIndependentPitch
    }
    if (probe.tempo == null) {
      probe.tempo = Number(tempoRef.current.toFixed(3))
    }
    if (probe.pitchSemitones == null) {
      probe.pitchSemitones = Number(pitchSemiRef.current.toFixed(3))
    }
    return {
      capturedAt,
      trackScopeId,
      audioMode: activeEngineMode,
      gate: {
        status: appendablePilotChecklistState.status,
        statusLabel: appendablePilotChecklistState.statusLabel,
      },
      flags: {
        appendableQueuePilotEnabled: effectiveAppendableQueuePilotEnabled,
        appendableQueueMultistemPilotEnabled: effectiveAppendableQueueMultistemPilotEnabled,
        appendableQueueStartupHeadPilotEnabled,
        appendableQueueContinuationChunksPilotEnabled,
        appendableQueueShadowPitchEnabled,
      },
      activation: {
        configured: appendablePilotActivation.activationConfigured,
        allowed: appendablePilotActivation.activationAllowed,
        mode: appendablePilotActivation.activationMode,
        tempoControlUnlocked: appendablePilotActivation.tempoControlUnlocked,
        pitchShadowActive: appendableRoutePitchShadowActive,
        matchedTarget: appendablePilotActivation.matchedTarget,
        currentTargets: appendablePilotActivation.currentTargets.slice(),
        configuredTargets: appendablePilotActivation.configuredTargets.slice(),
        targetedPilotConfiguredTargets: appendablePilotActivation.targetedPilotConfiguredTargets.slice(),
        safeRolloutConfiguredTargets: appendablePilotActivation.safeRolloutConfiguredTargets.slice(),
      },
      probe,
      sourceProgress: cloneAppendableQueueSourceProgressSnapshot(appendableQueueSourceProgressSnapshot),
      transport: createAppendableRouteTransportSnapshot(),
      qualification: createAppendableRouteQualificationSnapshot(),
      stress: createAppendableRouteStressSnapshot(),
      visibility: cloneAppendableRouteVisibilitySnapshot(
        visibilityOverride ?? appendableRouteVisibilitySnapshotRef.current
      ),
      pitch: createAppendableRoutePitchSnapshot(),
      rollout: createAppendableRouteRolloutSnapshot(),
    }
  }, [
    activeEngineMode,
    activeEngineCapabilities.supportsIndependentPitch,
    activeEngineCapabilities.supportsTempo,
    appendablePilotActivation.activationAllowed,
    appendablePilotActivation.activationConfigured,
    appendablePilotActivation.activationMode,
    appendablePilotActivation.configuredTargets,
    appendablePilotActivation.currentTargets,
    appendablePilotActivation.matchedTarget,
    appendablePilotActivation.safeRolloutConfiguredTargets,
    appendablePilotActivation.targetedPilotConfiguredTargets,
    appendablePilotActivation.tempoControlUnlocked,
    appendablePilotChecklistState.status,
    appendablePilotChecklistState.statusLabel,
    effectiveAppendableQueueMultistemPilotEnabled,
    effectiveAppendableQueuePilotEnabled,
    appendableQueueStartupHeadPilotEnabled,
    appendableQueueContinuationChunksPilotEnabled,
    appendableQueueShadowPitchEnabled,
    appendableRoutePitchShadowActive,
    appendableQueueRuntimeProbeSnapshot,
    appendableQueueSourceProgressSnapshot,
    trackScopeId,
  ])

  const buildAppendableRoutePilotReportWithSnapshot = useCallback(
    (
      snapshot: AppendableRoutePilotReportSnapshot,
      options?: { status?: AppendableRoutePilotReportStatus; autoStatus?: boolean }
    ): AppendableRoutePilotReport => {
      const currentReport = appendableRoutePilotReportRef.current
      const nextSnapshot = withAppendableRouteRolloutSnapshot(
        mergeAppendableRoutePilotEvidenceSnapshot(withAppendableRouteTransportSnapshot(snapshot), currentReport.snapshot)
      )
      const nextStatus =
        options?.status ??
        (options?.autoStatus
          ? resolveAppendableRoutePilotAutoStatus(nextSnapshot)
          : currentReport.status)
      return {
        ...currentReport,
        updatedAt: nextSnapshot.capturedAt,
        status: nextStatus,
        snapshot: nextSnapshot,
      }
    },
    []
  )

  const captureAppendableRoutePilotSnapshot = useCallback(() => {
    const snapshot = buildAppendableRoutePilotSnapshot()
    const nextReport = buildAppendableRoutePilotReportWithSnapshot(snapshot)
    commitAppendableRoutePilotReport(nextReport)
    return cloneAppendableRoutePilotReport(nextReport).snapshot ?? snapshot
  }, [buildAppendableRoutePilotReportWithSnapshot, buildAppendableRoutePilotSnapshot, commitAppendableRoutePilotReport])

  const setAppendableRoutePilotNotes = useCallback((notes: string) => {
    commitAppendableRoutePilotReport((current) => ({
      ...current,
      notes,
      updatedAt: new Date().toISOString(),
    }))
  }, [commitAppendableRoutePilotReport])

  const markAppendableRoutePilotReport = useCallback(
    (status: AppendableRoutePilotReportStatus) => {
      const snapshot = buildAppendableRoutePilotSnapshot()
      commitAppendableRoutePilotReport(buildAppendableRoutePilotReportWithSnapshot(snapshot, { status }))
    },
    [buildAppendableRoutePilotReportWithSnapshot, buildAppendableRoutePilotSnapshot, commitAppendableRoutePilotReport]
  )

  const resetAppendableRoutePilotReport = useCallback(() => {
    commitAppendableRoutePilotReport(createAppendableRoutePilotReport())
  }, [commitAppendableRoutePilotReport])

  const downloadAppendableRoutePilotReport = useCallback((reportOverride?: AppendableRoutePilotReport) => {
    const now = new Date()
    const pad2 = (n: number) => String(n).padStart(2, "0")
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
    const report = reportOverride ?? appendableRoutePilotReportRef.current
    const payload = {
      ...report,
      exportedAt: now.toISOString(),
      trackScopeId,
      tracks: trackList.map((track) => ({ name: track.name, src: track.src })),
      checklistStatus: appendablePilotChecklistState.status,
      checklistStatusLabel: appendablePilotChecklistState.statusLabel,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `appendable-route-pilot-${trackScopeId.slice(0, 56)}-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [appendablePilotChecklistState.status, appendablePilotChecklistState.statusLabel, trackList, trackScopeId])

  const downloadAppendableRoutePilotPacket = useCallback((reportOverride?: AppendableRoutePilotReport) => {
    const now = new Date()
    const pad2 = (n: number) => String(n).padStart(2, "0")
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
    const audioDebugEntriesSnapshot = getAudioDebugBufferSnapshot()
    const report = reportOverride ?? appendableRoutePilotReportRef.current
    const payload = {
      exportedAt: now.toISOString(),
      trackScopeId,
      tracks: trackList.map((track) => ({ name: track.name, src: track.src })),
      checklist: {
        status: appendablePilotChecklistState.status,
        statusLabel: appendablePilotChecklistState.statusLabel,
        steps: appendablePilotChecklistState.steps,
      },
      report,
      runtimeProbe: cloneAppendableQueueRuntimeProbeSnapshot(appendableQueueRuntimeProbeSnapshot),
      audioDebug: {
        entries: audioDebugEntriesSnapshot,
        formatted: formatAudioDebugBuffer(audioDebugEntriesSnapshot),
        captureArtifact: getAudioDebugCaptureArtifactSnapshot(),
      },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `appendable-route-pilot-packet-${trackScopeId.slice(0, 56)}-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [
    appendablePilotChecklistState.status,
    appendablePilotChecklistState.statusLabel,
    appendablePilotChecklistState.steps,
    appendableQueueRuntimeProbeSnapshot,
    trackList,
    trackScopeId,
  ])


  const localMasterCapable = recordingEngineV2Enabled && isOpfsAvailable() && typeof AudioWorkletNode !== "undefined"

  const pianoKeys = useMemo<PianoKey[]>(() => {
    const baseMidi = 12 * (pianoBaseOctave + 1)
    const white: PianoKey[] = PIANO_WHITE_OFFSETS.map((semi, i) => {
      const midi = baseMidi + semi
      return {
        note: midiToNote(midi),
        freq: midiToFreq(midi),
        kbd: PIANO_WHITE_KEYS_EN[i],
        kbdRu: PIANO_WHITE_KEYS_RU[i],
      }
    })
    const black: PianoKey[] = PIANO_BLACK_OFFSETS.map((entry, i) => {
      const midi = baseMidi + entry.semi
      return {
        note: midiToNote(midi),
        freq: midiToFreq(midi),
        isBlack: true,
        kbd: PIANO_BLACK_KEYS_EN[i],
        kbdRu: PIANO_BLACK_KEYS_RU[i],
        left: ((entry.afterWhiteIndex + 1) / 14) * 100,
      }
    })
    return [...white, ...black]
  }, [pianoBaseOctave])

  useEffect(() => {
    const syncLang = () => {
      setUiLang(resolveUiLangFromDocument())
    }
    syncLang()
    const observer = new MutationObserver(syncLang)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] })
    window.addEventListener("popstate", syncLang)
    return () => {
      observer.disconnect()
      window.removeEventListener("popstate", syncLang)
    }
  }, [])

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    onTrackSetReadyRef.current = onTrackSetReady
  }, [onTrackSetReady])

  const beginGuestProgrammaticAction = () => {
    guestSyncGuardRef.current = true
  }
  const endGuestProgrammaticAction = () => {
    guestSyncGuardRef.current = false
  }

  const getStartupBiasSec = () => {
    if (guestCalibratingRef.current) return 0
    const base = guestStartupBiasSecRef.current
    if (!base) return 0
    const elapsed = (Date.now() - guestStartupBiasStartedAtRef.current) / 1000
    if (elapsed <= 0) return base
    if (elapsed >= GUEST_STARTUP_BIAS_DECAY_SEC) return 0
    return base * (1 - elapsed / GUEST_STARTUP_BIAS_DECAY_SEC)
  }

  const flushRecorderCapabilityTelemetry = useCallback(
    (reason: "start" | "stop" | "error" | "unmount", snapshotOverride?: RecorderCapabilitySnapshot | null) => {
      const snapshot = snapshotOverride ?? recordingCapabilitySnapshotRef.current
      if (!snapshot) return
      const payload = {
        trackScopeId,
        reason,
        ...snapshot,
        route: typeof window !== "undefined" ? window.location.pathname : undefined,
        locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }
      const json = JSON.stringify(payload)
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
          const blob = new Blob([json], { type: "application/json" })
          navigator.sendBeacon("/api/analytics/recording-probe", blob)
          return
        } catch {
          // fallback below
        }
      }
      void fetch("/api/analytics/recording-probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
        keepalive: true,
      })
    },
    [trackScopeId]
  )

  const buildCurrentRecorderSnapshot = useCallback(
    (params: { mimeType: string; stream: MediaStream | null }): RecorderCapabilitySnapshot => {
      return buildRecorderCapabilitySnapshot({
        ctx: ctxRef.current,
        stream: params.stream,
        mimeType: params.mimeType,
        recordingV2FlagEnabled: recordingEngineV2Enabled && recordingMode === "local_master",
        dropoutCount: recordDropoutCountRef.current,
        recoveryCount: recordRecoveryCountRef.current,
        workletTapActive: !!recordingV2TapNodeRef.current,
        workletFramesCaptured: recordingV2TapStatsRef.current.framesCaptured,
        workletChunkReports: recordingV2TapStatsRef.current.chunkReports,
        workletTapErrors: recordingV2TapStatsRef.current.errors,
        opfsWriterActive: !!recordingV2OpfsWriterRef.current,
        opfsBytesWritten: recordingV2OpfsStatsRef.current.bytes,
        opfsChunkCount: recordingV2OpfsStatsRef.current.chunks,
        opfsWriteErrors: recordingV2OpfsStatsRef.current.errors,
        uploadState: recordingV2UploadState,
      })
    },
    [recordingEngineV2Enabled, recordingMode, recordingV2UploadState]
  )

  const flushGuestSyncTelemetry = useCallback(
    async (reason: "periodic" | "pause" | "hard_stop" | "unmount", force = false) => {
      const pending = guestDriftTelemetryPendingRef.current
      if (!force && pending.sampleCount <= 0) return
      if (pending.sampleCount <= 0) return

      const payload = {
        trackScopeId,
        reason,
        sampleCount: pending.sampleCount,
        avgAbsDriftMs: Number(pending.avgAbsDriftMs.toFixed(2)),
        maxAbsDriftMs: Number(pending.maxAbsDriftMs.toFixed(2)),
        softCorrections: pending.softCorrections,
        hardCorrections: pending.hardCorrections,
        route: typeof window !== "undefined" ? window.location.pathname : undefined,
        locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }
      const json = JSON.stringify(payload)

      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
          const blob = new Blob([json], { type: "application/json" })
          navigator.sendBeacon("/api/analytics/guest-sync", blob)
        } catch {
          // fallback below
          void fetch("/api/analytics/guest-sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: json,
            keepalive: true,
          })
        }
      } else {
        void fetch("/api/analytics/guest-sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json,
          keepalive: true,
        })
      }

      guestDriftTelemetryPendingRef.current = {
        sampleCount: 0,
        avgAbsDriftMs: 0,
        maxAbsDriftMs: 0,
        softCorrections: 0,
        hardCorrections: 0,
      }
      guestDriftTelemetryLastFlushAtRef.current = Date.now()
    },
    [trackScopeId]
  )

  const commitGuestDriftUiSnapshot = useCallback((force = false) => {
    const now = Date.now()
    if (!force && now - guestDriftUiUpdateAtRef.current < 320) return
    guestDriftUiUpdateAtRef.current = now
    const sampleCount = guestDriftSampleCountRef.current
    const avg = sampleCount > 0 ? guestDriftSampleAbsTotalMsRef.current / sampleCount : 0
    setGuestDriftSampleCount(sampleCount)
    setGuestDriftAvgMs(Number(avg.toFixed(1)))
    setGuestDriftMaxMs(Math.round(guestDriftMaxMsRef.current))
    setGuestDriftSoftCorrections(guestDriftSoftFixRef.current)
    setGuestDriftHardCorrections(guestDriftHardFixRef.current)
  }, [])

  const registerGuestDriftSample = useCallback(
    (driftSec: number, correction: "none" | "soft" | "hard") => {
      const absDriftMs = Math.abs(driftSec * 1000)
      guestDriftSampleCountRef.current += 1
      guestDriftSampleAbsTotalMsRef.current += absDriftMs
      guestDriftMaxMsRef.current = Math.max(guestDriftMaxMsRef.current, absDriftMs)
      if (correction === "soft") guestDriftSoftFixRef.current += 1
      if (correction === "hard") guestDriftHardFixRef.current += 1

      const pending = guestDriftTelemetryPendingRef.current
      const nextCount = pending.sampleCount + 1
      pending.avgAbsDriftMs = (pending.avgAbsDriftMs * pending.sampleCount + absDriftMs) / nextCount
      pending.sampleCount = nextCount
      pending.maxAbsDriftMs = Math.max(pending.maxAbsDriftMs, absDriftMs)
      if (correction === "soft") pending.softCorrections += 1
      if (correction === "hard") pending.hardCorrections += 1
      commitGuestDriftUiSnapshot(correction !== "none")
    },
    [commitGuestDriftUiSnapshot]
  )

  const getGuestTargetSec = useCallback(
    (mainPosSec: number) => {
      const hardwareBias = 0
      const startupBias = getStartupBiasSec()
      const offset = guestSyncOffsetRef.current + hardwareBias + startupBias
      return clamp(mainPosSec + offset, 0, guestDuration || mainPosSec + offset)
    },
    [guestDuration]
  )

  const syncGuestToMain = (mainPosSec: number, force = false) => {
    if (!guestTransportLinkedRef.current) return
    const guestAudio = guestAudioRef.current
    if (!guestAudio) return
    if (!force && guestAudio.paused) return
    const target = getGuestTargetSec(mainPosSec)
    const drift = guestAudio.currentTime - target
    const now = Date.now()
    const absDrift = Math.abs(drift)
    const canHardFix = now - guestLastDriftFixAtRef.current >= GUEST_DRIFT_HARD_FIX_COOLDOWN_MS
    if (force || (absDrift >= GUEST_DRIFT_HARD_FIX_SEC && canHardFix)) {
      guestLastDriftFixAtRef.current = now
      beginGuestProgrammaticAction()
      guestAudio.currentTime = target
      setGuestCurrentTime(target)
      endGuestProgrammaticAction()
      guestAudio.playbackRate = 1
      guestRateNudgeRef.current = 1
      registerGuestDriftSample(drift, "hard")
      return
    }

    if (absDrift >= GUEST_DRIFT_SOFT_FIX_SEC && !guestAudio.paused) {
      const nudgeRate = clamp(1 - drift * GUEST_DRIFT_RATE_GAIN, 1 - GUEST_DRIFT_RATE_NUDGE_LIMIT, 1 + GUEST_DRIFT_RATE_NUDGE_LIMIT)
      guestAudio.playbackRate = nudgeRate
      guestRateNudgeRef.current = nudgeRate
      registerGuestDriftSample(drift, "soft")
      return
    }

    if (absDrift <= 0.008 && Math.abs(guestRateNudgeRef.current - 1) > 0.0005) {
      guestAudio.playbackRate = 1
      guestRateNudgeRef.current = 1
    }
    registerGuestDriftSample(drift, "none")
  }

  const seekGuestAudioForStart = async (mainPosSec: number) => {
    const guestAudio = guestAudioRef.current
    if (!guestAudio) return
    const target = getGuestTargetSec(mainPosSec)

    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        guestAudio.removeEventListener("seeked", onSeeked)
        window.clearTimeout(timer)
        resolve()
      }
      const onSeeked = () => finish()
      const timer = window.setTimeout(finish, 160)
      guestAudio.addEventListener("seeked", onSeeked, { once: true })
      beginGuestProgrammaticAction()
      guestAudio.currentTime = target
      setGuestCurrentTime(target)
      endGuestProgrammaticAction()
    })
  }

  const waitForGuestAudioReady = async (audio: HTMLAudioElement, timeoutMs = 900) => {
    if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        audio.removeEventListener("loadeddata", onReady)
        audio.removeEventListener("canplay", onReady)
        window.clearTimeout(timer)
        resolve()
      }
      const onReady = () => finish()
      const timer = window.setTimeout(finish, timeoutMs)
      audio.addEventListener("loadeddata", onReady)
      audio.addEventListener("canplay", onReady)
    })
  }

  const clearGuestStartGuardTimer = () => {
    if (guestStartGuardTimerRef.current != null) {
      window.clearTimeout(guestStartGuardTimerRef.current)
      guestStartGuardTimerRef.current = null
    }
  }

  const guardGuestStart = () => {
    const guestGain = guestGainNodeRef.current
    if (!guestGain) return
    const ctx = guestGain.context
    const now = ctx.currentTime
    guestGain.gain.cancelScheduledValues(now)
    guestGain.gain.setValueAtTime(0, now)
    guestStartGuardTimerRef.current = window.setTimeout(() => {
      const now2 = ctx.currentTime
      guestGain.gain.cancelScheduledValues(now2)
      guestGain.gain.setValueAtTime(0, now2)
      guestGain.gain.linearRampToValueAtTime(1, now2 + 0.08)
      guestStartGuardTimerRef.current = null
    }, 120)
  }

  const ensureGuestPlaybackGraph = async () => {
    const ctx = ctxRef.current
    const audio = guestAudioRef.current
    if (!ctx || !audio) return false
    await ctx.resume()
    if (guestSourceNodeRef.current && guestPanNodeRef.current && guestGainNodeRef.current) return true

    try {
      const source = ctx.createMediaElementSource(audio)
      const merger = ctx.createChannelMerger(2)
      const pan = ctx.createStereoPanner()
      const gain = ctx.createGain()
      pan.pan.value = guestPan
      gain.gain.value = guestMuted ? 0 : guestVolume

      // Duplicate channel 0 to both L/R before panning to avoid one-ear playback on mono/left-only sources.
      source.connect(merger, 0, 0)
      source.connect(merger, 0, 1)
      merger.connect(pan)
      pan.connect(gain)
      gain.connect(ctx.destination)

      guestSourceNodeRef.current = source
      guestPanNodeRef.current = pan
      guestGainNodeRef.current = gain
      // Safari may suspend muted media elements; keep element unmuted but with zero direct volume.
      audio.muted = false
      audio.volume = 0
      return true
    } catch {
      return false
    }
  }

  const primeGuestAudioAutoplay = async () => {
    const audio = guestAudioRef.current
    if (!audio || !audio.src || !audio.paused) return
    const prevMuted = audio.muted
    const prevVolume = audio.volume
    try {
      audio.muted = true
      audio.volume = 0
      await audio.play()
      audio.pause()
    } catch {
      // ignore: prime best-effort only
    } finally {
      audio.muted = prevMuted
      audio.volume = prevVolume
    }
  }

  /** =========================
   *  CLICK-FREE RAMP HELPERS
   *  ========================= */
  const rampGainTo = (node: GainNode | null | undefined, target: number, rampSec = 0.045) => {
    if (!node) return
    const ctx = node.context
    const now = ctx.currentTime
    const g = node.gain
    const safeTarget = Number.isFinite(target) ? target : 0
    const rawFrom = g.value
    const from = Number.isFinite(rawFrom) ? rawFrom : safeTarget

    try {
      g.cancelScheduledValues(now)
      if (Math.abs(from - safeTarget) < 0.0005) {
        g.setValueAtTime(safeTarget, now)
        return
      }
      g.setValueAtTime(from, now)
      g.linearRampToValueAtTime(safeTarget, now + rampSec)
    } catch {
      g.value = safeTarget
    }
  }

  const applyTempoPitchToEngines = useCallback((tempo: number, pitchSemi: number) => {
    tempoAppliedRef.current = tempo
    pitchAppliedRef.current = pitchSemi
    const appendableCoordinator =
      activeEngineMode === "appendable_queue_worklet" && enginesRef.current.length > 1
        ? appendableQueueCoordinatorRef.current
        : null
    if (appendableCoordinator) {
      appendableCoordinator.setTempo(tempo)
    } else {
      enginesRef.current.forEach((eng) => {
        eng?.setTempo(tempo)
      })
    }
    enginesRef.current.forEach((eng) => {
      eng?.setPitchSemitones(pitchSemi)
    })
  }, [activeEngineMode])

  const cancelTempoPitchSmoothing = useCallback(() => {
    if (tempoPitchSmoothRafRef.current == null) return
    window.cancelAnimationFrame(tempoPitchSmoothRafRef.current)
    tempoPitchSmoothRafRef.current = null
  }, [])

  const scheduleTempoPitchSmoothing = useCallback(
    (targetTempo: number, targetPitchSemi: number) => {
      cancelTempoPitchSmoothing()
      const startTempo = tempoAppliedRef.current
      const startPitch = pitchAppliedRef.current
      if (Math.abs(startTempo - targetTempo) < 0.0005 && Math.abs(startPitch - targetPitchSemi) < 0.0005) {
        applyTempoPitchToEngines(targetTempo, targetPitchSemi)
        return
      }
      tempoPitchSmoothFromRef.current = { tempo: startTempo, pitch: startPitch }
      tempoPitchSmoothStartedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now()
      const tick = () => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now()
        const elapsed = now - tempoPitchSmoothStartedAtRef.current
        const progress = clamp(elapsed / TEMPO_PITCH_SMOOTH_MS, 0, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        const tempo = tempoPitchSmoothFromRef.current.tempo + (targetTempo - tempoPitchSmoothFromRef.current.tempo) * eased
        const pitch = tempoPitchSmoothFromRef.current.pitch + (targetPitchSemi - tempoPitchSmoothFromRef.current.pitch) * eased
        applyTempoPitchToEngines(tempo, pitch)
        if (progress >= 1) {
          tempoPitchSmoothRafRef.current = null
          return
        }
        tempoPitchSmoothRafRef.current = window.requestAnimationFrame(tick)
      }
      tempoPitchSmoothRafRef.current = window.requestAnimationFrame(tick)
    },
    [applyTempoPitchToEngines, cancelTempoPitchSmoothing]
  )

  const setAppendableRouteDebugTempo = useCallback(
    (tempo: number) => {
      const safeTempo = Math.min(4, Math.max(0.25, Number.isFinite(tempo) ? tempo : tempoRef.current))
      if (
        recording ||
        countInBeat != null ||
        guestTransportLinkedRef.current ||
        !activeEngineCapabilities.supportsTempo
      ) {
        setRecordError(t.tempoLocked)
        return {
          tempo: Number(tempoRef.current.toFixed(3)),
          pitchSemitones: Number(pitchSemiRef.current.toFixed(3)),
        }
      }
      setSpeed(safeTempo)
      tempoRef.current = safeTempo
      applyTempoPitchToEngines(safeTempo, pitchSemiRef.current)
      return {
        tempo: Number(safeTempo.toFixed(3)),
        pitchSemitones: Number(pitchSemiRef.current.toFixed(3)),
      }
    },
    [activeEngineCapabilities.supportsTempo, applyTempoPitchToEngines, countInBeat, recording, t.tempoLocked]
  )

  const setAppendableRouteDebugPitchSemitones = useCallback(
    (semi: number) => {
      const safeSemi = Math.min(12, Math.max(-12, Math.round(Number.isFinite(semi) ? semi : pitchSemiRef.current)))
      if (
        recording ||
        countInBeat != null ||
        guestTransportLinkedRef.current ||
        !activeEngineCapabilities.supportsIndependentPitch
      ) {
        setRecordError(t.pitchLocked)
        return {
          tempo: Number(tempoRef.current.toFixed(3)),
          pitchSemitones: Number(pitchSemiRef.current.toFixed(3)),
        }
      }
      setPitchSemi(safeSemi)
      pitchSemiRef.current = safeSemi
      applyTempoPitchToEngines(tempoRef.current, safeSemi)
      return {
        tempo: Number(tempoRef.current.toFixed(3)),
        pitchSemitones: safeSemi,
      }
    },
    [
      activeEngineCapabilities.supportsIndependentPitch,
      applyTempoPitchToEngines,
      countInBeat,
      recording,
      t.pitchLocked,
    ]
  )

  useEffect(() => {
    guestSyncOffsetRef.current = guestSyncOffsetSec
  }, [guestSyncOffsetSec])

  useEffect(() => {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return
    const supportedEntryTypes = (PerformanceObserver as typeof PerformanceObserver & { supportedEntryTypes?: string[] }).supportedEntryTypes
    if (!Array.isArray(supportedEntryTypes) || !supportedEntryTypes.includes("longtask")) return

    let rafId: number | null = null
    const flushLongTaskUi = () => {
      rafId = null
      setPlayerLongTaskCount(playerLongTaskCountRef.current)
      setPlayerLongTaskMaxMs(Math.round(playerLongTaskMaxMsRef.current))
      playerLongTaskUiFlushAtRef.current = performance.now()
    }
    const scheduleUiFlush = () => {
      if (rafId != null) return
      rafId = window.requestAnimationFrame(flushLongTaskUi)
    }

    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries()
      if (!entries.length) return
      for (const entry of entries) {
        const dur = Number(entry.duration)
        if (!Number.isFinite(dur) || dur <= 0) continue
        playerLongTaskCountRef.current += 1
        if (dur > playerLongTaskMaxMsRef.current) playerLongTaskMaxMsRef.current = dur
      }
      const now = performance.now()
      if (now - playerLongTaskUiFlushAtRef.current >= PLAYER_LONGTASK_UI_FLUSH_MIN_MS) {
        scheduleUiFlush()
      }
    })

    observer.observe({ entryTypes: ["longtask"] })
    flushLongTaskUi()
    return () => {
      observer.disconnect()
      if (rafId != null) window.cancelAnimationFrame(rafId)
    }
  }, [])

  useEffect(() => {
    recordingCapabilitySnapshotRef.current = recordingCapabilitySnapshot
  }, [recordingCapabilitySnapshot])

  useEffect(() => {
    guestTrackUrlRef.current = guestTrackUrl
  }, [guestTrackUrl])

  const scheduleBlobUrlRevoke = useCallback((url: string | null | undefined, delayMs = 1500) => {
    if (!url || typeof window === "undefined") return
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url)
      } catch {}
    }, delayMs)
  }, [])

  useEffect(() => {
    guestCalibratingRef.current = guestCalibrating
  }, [guestCalibrating])

  useEffect(() => {
    guestCalibrateScoreRef.current = guestCalibrateScore
  }, [guestCalibrateScore])

  useEffect(() => {
    guestSyncQualityRef.current = guestSyncQuality
  }, [guestSyncQuality])

  useEffect(() => {
    recordReferenceIndexRef.current = recordReferenceIndex
  }, [recordReferenceIndex])

  useEffect(() => {
    const currentOffset = guestSyncOffsetSec
    const prev = lastManualOffsetRef.current
    if (prev == null) {
      lastManualOffsetRef.current = currentOffset
      return
    }
    if (!guestCalibratingRef.current && Math.abs(currentOffset - prev) >= 0.004) {
      guestNeedsRecalibrateRef.current = true
    }
    lastManualOffsetRef.current = currentOffset
  }, [guestSyncOffsetSec])

  useEffect(() => {
    setGuestTrackUrl((prev) => {
      scheduleBlobUrlRevoke(prev, 2000)
      return null
    })
    setGuestTakes([])
    setActiveGuestTakeId(null)
    setGuestWaveReady(false)
    setGuestCurrentTime(0)
    setGuestDuration(0)
    setGuestIsPlaying(false)
    setGuestCalibrateScore(null)
    setGuestSyncQuality("unknown")
    setRecordReferenceIndex(null)
    setRecordHeadphonesConfirmed(false)
    setGuestSyncRuns(0)
    setGuestLowConfidenceRuns(0)
    setGuestDriftSampleCount(0)
    setGuestDriftAvgMs(0)
    setGuestDriftMaxMs(0)
    setGuestDriftSoftCorrections(0)
    setGuestDriftHardCorrections(0)
    setBluetoothRouteRisk(false)
    guestDriftSampleCountRef.current = 0
    guestDriftSampleAbsTotalMsRef.current = 0
    guestDriftMaxMsRef.current = 0
    guestDriftSoftFixRef.current = 0
    guestDriftHardFixRef.current = 0
    guestDriftLastSampleAtRef.current = 0
    guestDriftUiUpdateAtRef.current = 0
    guestDriftTelemetryPendingRef.current = {
      sampleCount: 0,
      avgAbsDriftMs: 0,
      maxAbsDriftMs: 0,
      softCorrections: 0,
      hardCorrections: 0,
    }

    try {
      const stored = localStorage.getItem(guestSyncStorageKey)
      const globalStored = localStorage.getItem(GLOBAL_GUEST_SYNC_STORAGE_KEY)
      if (stored) {
        const parsed = Number(stored)
        if (Number.isFinite(parsed)) setGuestSyncOffsetSec(clamp(parsed, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC))
        else setGuestSyncOffsetSec(DEFAULT_GUEST_SYNC_SEC)
      } else if (globalStored) {
        const parsedGlobal = Number(globalStored)
        if (Number.isFinite(parsedGlobal)) setGuestSyncOffsetSec(clamp(parsedGlobal, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC))
        else setGuestSyncOffsetSec(DEFAULT_GUEST_SYNC_SEC)
      } else {
        setGuestSyncOffsetSec(DEFAULT_GUEST_SYNC_SEC)
      }
    } catch {
      setGuestSyncOffsetSec(DEFAULT_GUEST_SYNC_SEC)
    }

    try {
      const rawMetrics = localStorage.getItem(guestSyncMetricsStorageKey)
      if (rawMetrics) {
        const parsed = JSON.parse(rawMetrics) as { syncRuns?: unknown; lowConfidenceRuns?: unknown }
        const syncRunsValue = Number(parsed?.syncRuns)
        const lowRunsValue = Number(parsed?.lowConfidenceRuns)
        setGuestSyncRuns(Number.isFinite(syncRunsValue) ? Math.max(0, Math.floor(syncRunsValue)) : 0)
        setGuestLowConfidenceRuns(Number.isFinite(lowRunsValue) ? Math.max(0, Math.floor(lowRunsValue)) : 0)
      }
    } catch {}
    try {
      const rawDriftMetrics = localStorage.getItem(guestDriftMetricsStorageKey)
      if (rawDriftMetrics) {
        const parsed = JSON.parse(rawDriftMetrics) as Partial<GuestDriftTelemetrySnapshot>
        const sampleCount = Math.max(0, Math.floor(Number(parsed.sampleCount) || 0))
        const avgAbsDriftMs = Math.max(0, Number(parsed.avgAbsDriftMs) || 0)
        const maxAbsDriftMs = Math.max(0, Number(parsed.maxAbsDriftMs) || 0)
        const softCorrections = Math.max(0, Math.floor(Number(parsed.softCorrections) || 0))
        const hardCorrections = Math.max(0, Math.floor(Number(parsed.hardCorrections) || 0))
        guestDriftSampleCountRef.current = sampleCount
        guestDriftSampleAbsTotalMsRef.current = avgAbsDriftMs * sampleCount
        guestDriftMaxMsRef.current = maxAbsDriftMs
        guestDriftSoftFixRef.current = softCorrections
        guestDriftHardFixRef.current = hardCorrections
        setGuestDriftSampleCount(sampleCount)
        setGuestDriftAvgMs(Number(avgAbsDriftMs.toFixed(1)))
        setGuestDriftMaxMs(Math.round(maxAbsDriftMs))
        setGuestDriftSoftCorrections(softCorrections)
        setGuestDriftHardCorrections(hardCorrections)
      }
    } catch {}

    guestSyncLoadedRef.current = true

    loadGuestRecording().catch(() => {})
    // loadGuestRecording depends only on guestRecordStorageKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestDriftMetricsStorageKey, guestRecordStorageKey, guestSyncMetricsStorageKey, guestSyncStorageKey, scheduleBlobUrlRevoke])

  useEffect(() => {
    if (!guestSyncLoadedRef.current) return
    try {
      localStorage.setItem(guestSyncStorageKey, String(guestSyncOffsetSec))
      localStorage.setItem(GLOBAL_GUEST_SYNC_STORAGE_KEY, String(guestSyncOffsetSec))
    } catch {}
  }, [guestSyncOffsetSec, guestSyncStorageKey])

  useEffect(() => {
    if (!guestTrackUrl && guestTakes.length === 0) return
    setGuestPanelOpen(true)
  }, [guestTakes.length, guestTrackUrl])

  useEffect(() => {
    try {
      const payload: GuestTakesState = {
        activeTakeId: activeGuestTakeId,
        takes: guestTakes.slice(0, GUEST_TAKES_MAX),
      }
      localStorage.setItem(guestTakesStorageKey, JSON.stringify(payload))
    } catch {}
  }, [activeGuestTakeId, guestTakes, guestTakesStorageKey])

  useEffect(() => {
    try {
      localStorage.setItem(
        guestSyncMetricsStorageKey,
        JSON.stringify({
          syncRuns: guestSyncRuns,
          lowConfidenceRuns: guestLowConfidenceRuns,
        })
      )
    } catch {}
  }, [guestLowConfidenceRuns, guestSyncMetricsStorageKey, guestSyncRuns])

  useEffect(() => {
    try {
      localStorage.setItem(
        guestDriftMetricsStorageKey,
        JSON.stringify({
          sampleCount: guestDriftSampleCount,
          avgAbsDriftMs: Number(guestDriftAvgMs.toFixed(1)),
          maxAbsDriftMs: guestDriftMaxMs,
          softCorrections: guestDriftSoftCorrections,
          hardCorrections: guestDriftHardCorrections,
        } satisfies GuestDriftTelemetrySnapshot)
      )
    } catch {}
  }, [
    guestDriftAvgMs,
    guestDriftHardCorrections,
    guestDriftMaxMs,
    guestDriftMetricsStorageKey,
    guestDriftSampleCount,
    guestDriftSoftCorrections,
  ])

  useEffect(() => {
    if (guestDriftTelemetryTimerRef.current != null) {
      window.clearInterval(guestDriftTelemetryTimerRef.current)
      guestDriftTelemetryTimerRef.current = null
    }
    guestDriftTelemetryTimerRef.current = window.setInterval(() => {
      if (guestDriftTelemetryPendingRef.current.sampleCount <= 0) return
      void flushGuestSyncTelemetry("periodic")
    }, GUEST_DRIFT_TELEMETRY_FLUSH_MS)
    return () => {
      if (guestDriftTelemetryTimerRef.current != null) {
        window.clearInterval(guestDriftTelemetryTimerRef.current)
        guestDriftTelemetryTimerRef.current = null
      }
      void flushGuestSyncTelemetry("unmount", true)
    }
  }, [flushGuestSyncTelemetry])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(GUEST_DEVICE_PROFILE_STORAGE_KEY)
      if (!raw) {
        setDeviceLatencyProfile(null)
        return
      }
      const parsed = JSON.parse(raw) as Partial<DeviceLatencyProfile> | null
      const offset = Number(parsed?.offsetSec)
      if (
        !parsed ||
        typeof parsed.id !== "string" ||
        typeof parsed.label !== "string" ||
        !Number.isFinite(offset) ||
        typeof parsed.updatedAt !== "string"
      ) {
        setDeviceLatencyProfile(null)
        return
      }
      setDeviceLatencyProfile({
        id: parsed.id,
        label: parsed.label,
        offsetSec: Math.max(-1, Math.min(1, offset)),
        updatedAt: parsed.updatedAt,
      })
    } catch {
      setDeviceLatencyProfile(null)
    }
  }, [])

  useEffect(() => {
    try {
      if (!deviceLatencyProfile) {
        localStorage.removeItem(GUEST_DEVICE_PROFILE_STORAGE_KEY)
        return
      }
      localStorage.setItem(GUEST_DEVICE_PROFILE_STORAGE_KEY, JSON.stringify(deviceLatencyProfile))
    } catch {}
  }, [deviceLatencyProfile])

  useEffect(() => {
    setProgressiveLoadEnabled(
      hasClientPreviewFlag(PROGRESSIVE_LOAD_PREVIEW_FLAG) || shouldPreferProgressiveLoad(trackList)
    )
  }, [trackList])

  useEffect(() => {
    const enabled = readClientAudioPilotFlag(
      process.env.NEXT_PUBLIC_AUDIO_STREAMING_PILOT === "1",
      STREAMING_BUFFER_PREVIEW_FLAG,
      "rr_audio_streaming_pilot"
    )
    setStreamingBufferPilotEnabled(enabled)
  }, [])

  useEffect(() => {
    const enabled = readClientAudioPilotFlag(
      process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_PILOT === "1",
      APPENDABLE_QUEUE_PILOT_PREVIEW_FLAG,
      "rr_audio_appendable_queue_pilot"
    )
    setAppendableQueuePilotEnabled(enabled)
  }, [])

  useEffect(() => {
    const enabled = readClientAudioPilotFlag(
      process.env.NEXT_PUBLIC_AUDIO_APPENDABLE_QUEUE_MULTISTEM_PILOT === "1",
      APPENDABLE_QUEUE_MULTISTEM_PILOT_PREVIEW_FLAG,
      "rr_audio_appendable_queue_multistem_pilot"
    )
    setAppendableQueueMultistemPilotEnabled(enabled)
  }, [])

  useEffect(() => {
    const enabled = readClientAudioPilotFlag(
      process.env.NEXT_PUBLIC_AUDIO_RINGBUFFER_PILOT === "1",
      RINGBUFFER_PILOT_PREVIEW_FLAG,
      "rr_audio_ringbuffer_pilot"
    )
    setRingBufferPilotEnabled(enabled)
  }, [])

  useEffect(() => {
    if (isReady) return
    const nextRouting = resolveAudioPilotRouting({
      trackCount: trackList.length,
      streamingBufferPilotEnabled,
      appendableQueuePilotEnabled: effectiveAppendableQueuePilotEnabled,
      appendableQueueMultistemPilotEnabled: effectiveAppendableQueueMultistemPilotEnabled,
      ringBufferPilotEnabled,
      appendableActivationConfigured: appendablePilotActivation.activationConfigured,
      appendableActivationAllowed: appendablePilotActivation.activationAllowed,
    })
    setActiveEngineMode(nextRouting.engineMode)
    setActiveEngineCapabilities(
      applyAppendableActivationPolicyToCapabilities(
        nextRouting.engineMode,
        getEngineModeCapabilities(nextRouting.engineMode),
        appendablePilotActivation
      )
    )
  }, [
    appendablePilotActivation.activationAllowed,
    appendablePilotActivation.activationConfigured,
    appendablePilotActivation.activationMode,
    appendablePilotActivation.tempoControlUnlocked,
    effectiveAppendableQueueMultistemPilotEnabled,
    effectiveAppendableQueuePilotEnabled,
    isReady,
    ringBufferPilotEnabled,
    streamingBufferPilotEnabled,
    trackList.length,
  ])

  useEffect(() => {
    setRecordingEngineV2Enabled(hasClientPreviewFlag(RECORDING_ENGINE_V2_PREVIEW_FLAG))
  }, [])

  useEffect(() => {
    if (!recordingEngineV2Enabled) return
    void (async () => {
      try {
        const drained = await drainRecordingV2UploadQueue(2)
        if (drained.completed > 0) setRecordingV2UploadState("uploaded")
      } catch {
        // ignore background queue drain errors
      }
    })()
  }, [recordingEngineV2Enabled])

  useEffect(() => {
    if (!recordingEngineV2Enabled || !localMasterCapable) {
      setRecordingMode("compatibility")
    }
  }, [localMasterCapable, recordingEngineV2Enabled])

  useEffect(() => {
    const node = guestPanNodeRef.current
    if (!node) return
    try {
      const now = node.context.currentTime
      node.pan.cancelScheduledValues(now)
      node.pan.setValueAtTime(node.pan.value, now)
      node.pan.linearRampToValueAtTime(guestPan, now + 0.03)
    } catch {
      // Fallback to direct element output if pan node becomes unstable.
      const audio = guestAudioRef.current
      if (audio) {
        audio.volume = 1
        audio.muted = false
      }
      setRecordError(t.safePanFallback)
    }
  }, [guestPan, t.safePanFallback])

  useEffect(() => {
    const gain = guestGainNodeRef.current
    const audio = guestAudioRef.current
    if (gain) {
      const now = gain.context.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(guestMuted ? 0 : guestVolume, now + 0.03)
      return
    }
    if (audio) {
      audio.muted = guestMuted
      audio.volume = guestMuted ? 0 : Math.min(1, guestVolume)
    }
  }, [guestMuted, guestVolume])

  const teardownAudioDebugMasterTap = useCallback(() => {
    const node = audioDebugMasterTapNodeRef.current
    const ctx = audioDebugMasterTapCtxRef.current
    const limiter = masterLimiterRef.current
    try {
      if (node) {
        node.port.onmessage = null
        node.disconnect()
      }
    } catch {}
    try {
      limiter?.disconnect()
    } catch {}
    try {
      if (ctx && limiter) {
        limiter.connect(ctx.destination)
      }
    } catch {}
    audioDebugMasterTapNodeRef.current = null
    audioDebugMasterTapCtxRef.current = null
  }, [])

  const setupAudioDebugMasterTap = useCallback(async (): Promise<boolean> => {
    const ctx = ctxRef.current
    const limiter = masterLimiterRef.current
    if (!ctx || !limiter || !isAudioDebugEnabled()) return false
    if (typeof AudioWorkletNode === "undefined" || !ctx.audioWorklet) return false

    if (audioDebugMasterTapNodeRef.current && audioDebugMasterTapCtxRef.current === ctx) {
      resetAudioDebugCaptureStore()
      initAudioDebugCaptureStore(ctx.sampleRate)
      return true
    }

    try {
      logAudioDebug("audio:master_tap_begin", {
        sampleRate: ctx.sampleRate,
        destinationChannels: Math.max(1, Number(ctx.destination.channelCount) || 2),
      })
      if (audioDebugMasterTapModuleLoadedCtxRef.current !== ctx) {
        await ctx.audioWorklet.addModule("/worklets/audio-debug-master-tap.js")
        audioDebugMasterTapModuleLoadedCtxRef.current = ctx
      }
      teardownAudioDebugMasterTap()
      initAudioDebugCaptureStore(ctx.sampleRate)
      audioDebugMasterTapStatsRef.current = {
        framesCaptured: 0,
        chunkReports: 0,
        clickReports: 0,
        errors: 0,
      }
      audioDebugMasterTapChunkLoggedRef.current = false
      const node = new AudioWorkletNode(ctx, "audio-debug-master-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [Math.max(1, Number(ctx.destination.channelCount) || 2)],
        processorOptions: {
          channelCount: Math.max(1, Number(ctx.destination.channelCount) || 2),
          chunkFrames: 4096,
          clickThreshold: 0.07,
          clickCooldownFrames: Math.max(1024, Math.floor(ctx.sampleRate * 0.08)),
        },
      })
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data as
          | {
              type?: string
              frames?: number
              samples?: ArrayBuffer
              deltaAbs?: number
              frameCursorFrames?: number
              outputSec?: number
              droppedMessages?: number
            }
          | undefined
        if (!data || typeof data !== "object") return
        if (data.type === "chunk" && data.samples instanceof ArrayBuffer) {
          appendAudioDebugCaptureSamples(new Int16Array(data.samples))
          audioDebugMasterTapStatsRef.current.framesCaptured += Math.max(0, Math.floor(data.frames ?? 0))
          audioDebugMasterTapStatsRef.current.chunkReports += 1
          if (!audioDebugMasterTapChunkLoggedRef.current) {
            audioDebugMasterTapChunkLoggedRef.current = true
            logAudioDebug("audio:master_tap_chunk", {
              frames: Math.max(0, Math.floor(data.frames ?? 0)),
              sampleRate: ctx.sampleRate,
            })
          }
          return
        }
        if (data.type === "click") {
          const deltaAbs = typeof data.deltaAbs === "number" ? Math.max(0, data.deltaAbs) : 0
          const frameCursorFrames =
            typeof data.frameCursorFrames === "number" ? Math.max(0, Math.floor(data.frameCursorFrames)) : 0
          const outputSec = typeof data.outputSec === "number" ? Math.max(0, data.outputSec) : 0
          const droppedMessages =
            typeof data.droppedMessages === "number" ? Math.max(0, Math.floor(data.droppedMessages)) : 0
          audioDebugMasterTapStatsRef.current.clickReports += 1
          audioDebugMasterTapStatsRef.current.errors += droppedMessages
          const clickPayload = {
            ts: new Date().toISOString(),
            deltaAbs: Number(deltaAbs.toFixed(6)),
            frameCursorFrames,
            outputSec: Number(outputSec.toFixed(3)),
            trackCurrentSec: Number(positionSecRef.current.toFixed(3)),
          }
          recordAudioDebugCaptureClick(clickPayload)
          logAudioDebug("audio:output_click", clickPayload)
          return
        }
        if (data.type === "flush_ack") {
          const token = typeof (data as { token?: unknown }).token === "string" ? (data as { token: string }).token : null
          const framesFlushed =
            typeof (data as { framesFlushed?: unknown }).framesFlushed === "number"
              ? Math.max(0, Math.floor((data as { framesFlushed: number }).framesFlushed))
              : 0
          logAudioDebug("audio:master_tap_flush_ack", {
            token,
            framesFlushed,
          })
          if (typeof window !== "undefined" && token) {
            window.dispatchEvent(
              new CustomEvent("rr-audio-debug-flush-complete", {
                detail: { token, ok: true, framesFlushed },
              })
            )
          }
        }
      }
      try {
        limiter.disconnect()
      } catch {}
      limiter.connect(node)
      node.connect(ctx.destination)
      audioDebugMasterTapNodeRef.current = node
      audioDebugMasterTapCtxRef.current = ctx
      logAudioDebug("audio:master_tap_ready", {
        sampleRate: ctx.sampleRate,
      })
      return true
    } catch {
      audioDebugMasterTapStatsRef.current.errors += 1
      logAudioDebug("audio:master_tap_error", {
        errors: audioDebugMasterTapStatsRef.current.errors,
      })
      teardownAudioDebugMasterTap()
      return false
    }
  }, [teardownAudioDebugMasterTap])

  const teardownRecordingV2Tap = useCallback(() => {
    const node = recordingV2TapNodeRef.current
    const source = recordingV2TapSourceRef.current
    const sink = recordingV2TapSinkRef.current
    try {
      if (node) {
        node.port.onmessage = null
        node.disconnect()
      }
    } catch {}
    try {
      source?.disconnect()
    } catch {}
    try {
      sink?.disconnect()
    } catch {}
    recordingV2TapNodeRef.current = null
    recordingV2TapSourceRef.current = null
    recordingV2TapSinkRef.current = null
  }, [])

  const setupRecordingV2Tap = useCallback(
    async (stream: MediaStream): Promise<boolean> => {
      if (!recordingEngineV2Enabled) return false
      const ctx = ctxRef.current
      if (!ctx || typeof AudioWorkletNode === "undefined" || !ctx.audioWorklet) return false
      try {
        if (!recordingV2TapModuleLoadedRef.current) {
          await ctx.audioWorklet.addModule("/worklets/recording-v2-pcm-tap.js")
          recordingV2TapModuleLoadedRef.current = true
        }
        teardownRecordingV2Tap()
        recordingV2TapStatsRef.current = {
          framesCaptured: 0,
          chunkReports: 0,
          errors: 0,
        }
        const source = ctx.createMediaStreamSource(stream)
        const node = new AudioWorkletNode(ctx, "recording-v2-pcm-tap")
        const sink = ctx.createGain()
        sink.gain.value = 0
        source.connect(node)
        node.connect(sink)
        sink.connect(ctx.destination)
        node.port.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data as Partial<{
            type: string
            frames: number
            chunks: number
            dropped: number
          }>
          if (data?.type !== "stats") return
          const frames = typeof data.frames === "number" ? Math.max(0, Math.floor(data.frames)) : 0
          const chunks = typeof data.chunks === "number" ? Math.max(0, Math.floor(data.chunks)) : 0
          const dropped = typeof data.dropped === "number" ? Math.max(0, Math.floor(data.dropped)) : 0
          recordingV2TapStatsRef.current.framesCaptured += frames
          recordingV2TapStatsRef.current.chunkReports += chunks
          recordingV2TapStatsRef.current.errors += dropped
        }
        recordingV2TapNodeRef.current = node
        recordingV2TapSourceRef.current = source
        recordingV2TapSinkRef.current = sink
        return true
      } catch {
        teardownRecordingV2Tap()
        recordingV2TapStatsRef.current.errors += 1
        return false
      }
    },
    [recordingEngineV2Enabled, teardownRecordingV2Tap]
  )

  const closeRecordingV2OpfsWriter = useCallback(async () => {
    const writer = recordingV2OpfsWriterRef.current
    recordingV2OpfsWriterRef.current = null
    if (!writer) return
    try {
      await writer.close()
    } catch {}
  }, [])

  const disposeTrackAudioGraph = useCallback(() => {
    try {
      enginesRef.current.forEach((eng) => {
        try {
          eng?.destroy()
        } catch {}
      })
    } catch {}
    try {
      engineGateRef.current.forEach((node) => {
        try {
          node.disconnect()
        } catch {}
      })
    } catch {}
    try {
      trackGainRef.current.forEach((node) => {
        try {
          node.disconnect()
        } catch {}
      })
    } catch {}
    try {
      panRef.current.forEach((node) => {
        try {
          node.disconnect()
        } catch {}
      })
    } catch {}
    enginesRef.current = []
    engineGateRef.current = []
    trackGainRef.current = []
    panRef.current = []
    appendableQueueCoordinatorRef.current = null
    appendableStartupHeadRuntimeRef.current = null
    appendableContinuationPreflightRef.current = createAppendableContinuationPreflightState()
  }, [])

  /** =========================
   *  INIT (once)
   *  ========================= */
  useEffect(() => {
    if (typeof window === "undefined") return
    const handleFlush = (event: Event) => {
      const token =
        event instanceof CustomEvent && event.detail && typeof event.detail.token === "string" ? event.detail.token : null
      flushAudioDebugMasterTap(token)
    }
    window.addEventListener("rr-audio-debug-flush-capture", handleFlush)
    return () => {
      window.removeEventListener("rr-audio-debug-flush-capture", handleFlush)
    }
  }, [flushAudioDebugMasterTap])

  useEffect(() => {
    let cancelled = false
    const fetchControllers: AbortController[] = []
    let deferredPeaksTimer: number | null = null
    let previewPeaksTimer: number | null = null
    let durationProbeTimer: number | null = null

    const init = async () => {
      readyRef.current = false
      setIsReady(false)
      appendableStartupHeadRuntimeRef.current = null
      appendableContinuationPreflightRef.current = createAppendableContinuationPreflightState()
      disposeTrackAudioGraph()
      let ctx = ctxRef.current
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioContext()
        ctxRef.current = ctx
      }

      // master graph (create once per context)
      let masterIn = masterInRef.current
      if (!masterIn || !dryGainRef.current || !wetGainRef.current || !masterGainRef.current || !masterLimiterRef.current) {
        masterIn = ctx.createGain()
        const dryGain = ctx.createGain()
        const wetGain = ctx.createGain()
        const convolver = ctx.createConvolver()
        const masterGain = ctx.createGain()
        const limiter = ctx.createDynamicsCompressor()
        limiter.threshold.value = -8
        limiter.knee.value = 10
        limiter.ratio.value = 12
        limiter.attack.value = 0.003
        limiter.release.value = 0.12

        masterInRef.current = masterIn
        dryGainRef.current = dryGain
        wetGainRef.current = wetGain
        masterGainRef.current = masterGain
        masterLimiterRef.current = limiter

        masterIn.connect(dryGain)
        masterIn.connect(convolver)
        convolver.connect(wetGain)

        dryGain.connect(masterGain)
        wetGain.connect(masterGain)
        masterGain.connect(limiter)
        convolver.buffer = makeImpulseResponse(ctx)
      }

      if (isAudioDebugCaptureEnabled()) {
        await setupAudioDebugMasterTap()
      } else {
        teardownAudioDebugMasterTap()
        try {
          masterLimiterRef.current?.disconnect()
        } catch {}
        try {
          masterLimiterRef.current?.connect(ctx.destination)
        } catch {}
      }

      if (masterGainRef.current) {
        masterGainRef.current.gain.value = (guestSoloMode ? 0 : clamp(masterVol, 0, 1)) * MASTER_HEADROOM_GAIN
      }
      if (wetGainRef.current) wetGainRef.current.gain.value = reverbAmount
      if (dryGainRef.current) dryGainRef.current.gain.value = 1 - reverbAmount

      const audioPilotRouting = resolveAudioPilotRouting({
        trackCount: trackList.length,
        streamingBufferPilotEnabled,
        appendableQueuePilotEnabled: effectiveAppendableQueuePilotEnabled,
        appendableQueueMultistemPilotEnabled: effectiveAppendableQueueMultistemPilotEnabled,
        ringBufferPilotEnabled,
        appendableActivationConfigured: appendablePilotActivation.activationConfigured,
        appendableActivationAllowed: appendablePilotActivation.activationAllowed,
      })
      const useStreamingPilot = audioPilotRouting.useStreamingPilot
      const useAppendableQueueMultistemPilot = audioPilotRouting.useAppendableQueueMultistemPilot
      const useAppendableQueuePilot = audioPilotRouting.useAppendableQueuePilot
      const useRingBufferPilot = audioPilotRouting.useRingBufferPilot
      const useAppendableQualifiedRolloutAutoIngest = appendablePilotActivation.activationMode === "safe_rollout"
      const appendableManifestDiagnosticsRequested =
        effectiveAppendableQueuePilotEnabled &&
        effectiveAppendableQueueMultistemPilotEnabled &&
        !useStreamingPilot &&
        !useRingBufferPilot
      const appendableStartupManifestDiagnosticMatch = appendableManifestDiagnosticsRequested
        ? await resolveAppendableStartupManifestMatch(trackList)
        : null
      const appendableStartupHeadRequested =
        appendableQueueStartupHeadPilotEnabled || useAppendableQualifiedRolloutAutoIngest
      const appendableStartupManifestMatch =
        useAppendableQueuePilot && appendableStartupHeadRequested ? appendableStartupManifestDiagnosticMatch : null
      const manifestStartupDurationCandidates = appendableStartupManifestDiagnosticMatch?.sources
        .map((source) => source.startupDurationSec ?? 0)
        .filter((value): value is number => Number.isFinite(value) && value > 0)
      const manifestStartupDurationSec =
        manifestStartupDurationCandidates && manifestStartupDurationCandidates.length
          ? Math.min(...manifestStartupDurationCandidates)
          : null
      const appendableContinuationDiagnosticQualification =
        appendableStartupManifestDiagnosticMatch &&
        typeof manifestStartupDurationSec === "number" &&
        Number.isFinite(manifestStartupDurationSec)
          ? qualifyAppendableContinuationChunks({
              enabled: true,
              startupDurationSec: manifestStartupDurationSec,
              manifestMatch: appendableStartupManifestDiagnosticMatch,
            })
          : null
      const appendableQualifiedRolloutContinuationQualification =
        useAppendableQualifiedRolloutAutoIngest ? appendableContinuationDiagnosticQualification : null
      appendableContinuationPreflightRef.current = appendableContinuationDiagnosticQualification
        ? {
            manifestSlug: appendableStartupManifestDiagnosticMatch?.slug || null,
            qualification: appendableContinuationDiagnosticQualification.status,
            qualificationReason: appendableContinuationDiagnosticQualification.reason,
            safeRolloutCandidateQualified: appendableContinuationDiagnosticQualification.status === "qualified",
            safeRolloutCandidateTarget:
              appendableContinuationDiagnosticQualification.status === "qualified"
                ? appendableStartupManifestDiagnosticMatch?.slug || null
                : null,
            availableGroupCount: appendableContinuationDiagnosticQualification.availableGroupCount,
            plannedGroupCount: appendableContinuationDiagnosticQualification.plannedGroupCount,
            coverageEndSec: appendableContinuationDiagnosticQualification.coverageEndSec,
          }
        : createAppendableContinuationPreflightState()
      setAppendableQueueSourceProgressSnapshot(
        readAppendableQueueSourceProgressSnapshot(null, null, appendableContinuationPreflightRef.current)
      )
      const useAppendableQualifiedRolloutStartupHead =
        appendableQualifiedRolloutContinuationQualification?.status === "qualified"
      const useAppendableStartupHeadPilot =
        !!appendableStartupManifestMatch &&
        useAppendableQueuePilot &&
        !useStreamingPilot &&
        !useRingBufferPilot &&
        (appendableQueueStartupHeadPilotEnabled || useAppendableQualifiedRolloutStartupHead)
      const useStartupChunkPilot =
        startupChunkPilotEnabled &&
        !useAppendableQueuePilot &&
        !useStreamingPilot &&
        !useRingBufferPilot &&
        trackList.length > 0 &&
        trackList.every((track) => !!track.startupChunk?.startupSrc && (track.startupChunk?.strategy ?? "handoff") === "handoff")
      const useStartupChunkSplicePilot =
        startupChunkSplicePilotEnabled &&
        !useStartupChunkPilot &&
        !useAppendableQueuePilot &&
        !useStreamingPilot &&
        !useRingBufferPilot &&
        trackList.length > 0 &&
        startupChunkSplicePilotKey.length > 0 &&
        trackList.every(
          (track) =>
            !!track.startupChunk?.startupSrc &&
            !!track.startupChunk?.tailSrc &&
            (track.startupChunk?.pilotKey ?? "") === startupChunkSplicePilotKey &&
            (track.startupChunk?.strategy ?? "handoff") === "splice"
        )
      const useProgressiveLoad =
        hasClientPreviewFlag(PROGRESSIVE_LOAD_PREVIEW_FLAG) || shouldPreferProgressiveLoad(trackList)
      let schedulePreviewPeaks: (delayMs: number) => void = () => {}
      let scheduleDeferredPeaks: (delayMs: number) => void = () => {}
      let startBackgroundStartupChunkDecode: (() => void) | null = null

      // Load per-track and tolerate decode failures to avoid blocking the entire player.
      const decodeWarnings: string[] = []
      const fallbackDurationSec = 600
      const decodeTrackBufferFromSrc = async (
        trackIndex: number,
        src: string,
        sourceRole: "startup" | "tail" | "full" | "continuation"
      ): Promise<{ buffer: AudioBuffer; byteLength: number }> => {
        const track = trackList[trackIndex]
        for (let attempt = 1; attempt <= TRACK_DECODE_MAX_ATTEMPTS; attempt++) {
          const controller = new AbortController()
          fetchControllers.push(controller)
          const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
          logAudioDebug("audio:decode_track_begin", {
            trackIndex,
            trackName: track.name,
            attempt,
            src,
            sourceRole,
          })
          try {
            const res = await promiseWithTimeout(
              fetch(src, { signal: controller.signal }),
              TRACK_DECODE_TIMEOUT_MS,
              `fetch ${src}`
            )
            if (!res.ok) throw new Error(`Fetch failed: ${src} (${res.status})`)
            const arr = await promiseWithTimeout(
              res.arrayBuffer(),
              TRACK_DECODE_TIMEOUT_MS,
              `arrayBuffer ${src}`
            )
            const decoded = await promiseWithTimeout(
              ctx.decodeAudioData(arr.slice(0)),
              TRACK_DECODE_TIMEOUT_MS,
              `decode ${src}`
            )
            const elapsedMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
            logAudioDebug("audio:decode_track_ready", {
              trackIndex,
              trackName: track.name,
              attempt,
              sourceRole,
              elapsedMs: Number(elapsedMs.toFixed(1)),
              bytes: arr.byteLength,
              durationSec: Number((decoded.duration || 0).toFixed(3)),
            })
            return {
              buffer: decoded,
              byteLength: arr.byteLength,
            }
          } catch (err) {
            const isAbort = err instanceof DOMException && err.name === "AbortError"
            const isTimeout = err instanceof Error && /timeout after/i.test(err.message)
            const elapsedMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
            logAudioDebug("audio:decode_track_retry", {
              trackIndex,
              trackName: track.name,
              attempt,
              sourceRole,
              elapsedMs: Number(elapsedMs.toFixed(1)),
              reason: err instanceof Error ? err.message : "unknown decode error",
            })
            try {
              controller.abort()
            } catch {}
            if (isAbort || isTimeout || attempt >= TRACK_DECODE_MAX_ATTEMPTS) {
              const reason = err instanceof Error ? err.message : "unknown decode error"
              decodeWarnings.push(`${track.name}: ${reason}`)
              break
            }
          }
        }
        // Keep transport behavior predictable when one of stems cannot be decoded.
        logAudioDebug("audio:decode_track_fallback", {
          trackIndex,
          trackName: track.name,
          sourceRole,
          durationSec: fallbackDurationSec,
        })
        return {
          buffer: createSilentBuffer(ctx, fallbackDurationSec),
          byteLength: 0,
        }
      }
      const decodeTrackBuffer = async (trackIndex: number) =>
        decodeTrackBufferFromSrc(trackIndex, trackList[trackIndex].src, "full")

      let buffers: AudioBuffer[] = []
      let appendableStartupHeadInit:
        | {
            manifestSlug: string | null
            startupDurationSec: number
            estimatedTotalDurationSec: number
            durationFrames: number
            sampleRate: number
            continuationQualification: AppendableContinuationQualificationStatus
            continuationQualificationReason: AppendableContinuationQualificationReason | null
            continuationChunkGroupsAvailable: number
            continuationChunkGroupsPlanned: number
            continuationCoverageEndSec: number | null
            stems: Array<
              AppendableStartupHeadStemRuntimeState & {
                startupBuffer: AudioBuffer
                continuationChunks: Array<{
                  src: string
                  startSec: number
                  durationSec: number
                  label: string | null
                }>
              }
            >
          }
        | null = null
      waveformSourceBuffersRef.current = []
      if (!useStreamingPilot && trackList.length > 0) {
        if (useAppendableStartupHeadPilot && appendableStartupManifestMatch) {
          const startupDecoded = await Promise.all(
            appendableStartupManifestMatch.sources.map((source, trackIndex) =>
              decodeTrackBufferFromSrc(trackIndex, source.startupSrc, "startup")
            )
          )
          buffers = startupDecoded.map((decoded) => decoded.buffer)
          waveformSourceBuffersRef.current = buffers
          const sampleRate = buffers[0]?.sampleRate ?? ctx.sampleRate
          if (buffers.some((buffer) => buffer.sampleRate !== sampleRate)) {
            throw new Error("appendable startup head pilot requires matching sample rates across startup stems")
          }
          const startupDurationCandidates = appendableStartupManifestMatch.sources
            .map((source, index) => source.startupDurationSec ?? buffers[index]?.duration ?? 0)
            .filter((value): value is number => Number.isFinite(value) && value > 0)
          const estimatedDurationCandidates = appendableStartupManifestMatch.sources
            .map((source) => source.estimatedTotalDurationSec ?? 0)
            .filter((value): value is number => Number.isFinite(value) && value > 0)
          const startupDurationSec = startupDurationCandidates.length
            ? Math.min(...startupDurationCandidates)
            : buffers[0]?.duration ?? 0
          const estimatedTotalDurationSec = estimatedDurationCandidates.length
            ? Math.max(...estimatedDurationCandidates)
            : buffers[0]?.duration ?? 0
          const appendableContinuationChunksRequested =
            appendableQueueContinuationChunksPilotEnabled || useAppendableQualifiedRolloutStartupHead
          const continuationQualification = qualifyAppendableContinuationChunks({
            enabled: appendableContinuationChunksRequested,
            startupDurationSec,
            manifestMatch: appendableStartupManifestMatch,
          })
          appendableContinuationPreflightRef.current = {
            manifestSlug: appendableStartupManifestMatch.slug || null,
            qualification: continuationQualification.status,
            qualificationReason: continuationQualification.reason,
            safeRolloutCandidateQualified: continuationQualification.status === "qualified",
            safeRolloutCandidateTarget:
              continuationQualification.status === "qualified"
                ? appendableStartupManifestMatch.slug || null
                : null,
            availableGroupCount: continuationQualification.availableGroupCount,
            plannedGroupCount: continuationQualification.plannedGroupCount,
            coverageEndSec: continuationQualification.coverageEndSec,
          }
          const continuationChunkGroupsPlanned =
            continuationQualification.status === "qualified" ? continuationQualification.plannedGroupCount : 0
          const durationFrames = Math.max(
            ...buffers.map((buffer, index) => {
              const estimatedFrames = Math.floor(
                Math.max(
                  buffer.length,
                  (appendableStartupManifestMatch.sources[index]?.estimatedTotalDurationSec ?? 0) * sampleRate
                )
              )
              return Math.max(buffer.length, estimatedFrames)
            })
          )
          const stems = buffers.map((startupBuffer, index) => {
            const continuationChunks =
              continuationChunkGroupsPlanned > 0
                ? (continuationQualification.sourceGroups[index] ?? [])
                    .slice(0, continuationChunkGroupsPlanned)
                    .map((chunk) => ({
                      src: chunk.src,
                      startSec: chunk.startSec,
                      durationSec: chunk.durationSec,
                      label: chunk.label,
                    }))
                : []
            const sourceController = createManualAppendablePcmSource({
              sampleRate: startupBuffer.sampleRate,
              channelCount: startupBuffer.numberOfChannels,
              durationFrames,
            })
            const startupFrames = Math.max(1, startupBuffer.length)
            const startupChunk = sliceAudioBufferToChunk(startupBuffer, 0, startupFrames, { final: false })
            if (!startupChunk) {
              throw new Error("appendable startup head pilot could not build startup chunk")
            }
            sourceController.appendChunk(startupChunk)
            return {
              sourceController,
              startupBuffer,
              startupFrames,
              startupAppended: true,
              fullDecoded: false,
              fullAppended: false,
              continuationChunkFrames: 0,
              continuationChunks,
            }
          })
          appendableStartupHeadInit = {
            manifestSlug: appendableStartupManifestMatch.slug || null,
            startupDurationSec,
            estimatedTotalDurationSec,
            durationFrames,
            sampleRate,
            continuationQualification: continuationQualification.status,
            continuationQualificationReason: continuationQualification.reason,
            continuationChunkGroupsAvailable: continuationQualification.availableGroupCount,
            continuationChunkGroupsPlanned,
            continuationCoverageEndSec: continuationQualification.coverageEndSec,
            stems,
          }
          appendableStartupHeadRuntimeRef.current = {
            mode: continuationChunkGroupsPlanned > 0 ? "startup_head_continuation_chunks" : "startup_head_manifest",
            manifestSlug: appendableStartupManifestMatch.slug || null,
            startupDurationSec,
            continuationQualification: continuationQualification.status,
            continuationQualificationReason: continuationQualification.reason,
            continuationChunkGroupsAvailable: continuationQualification.availableGroupCount,
            continuationChunkGroupsPlanned,
            continuationChunkGroupsDecoded: 0,
            continuationChunkGroupsAppended: 0,
            continuationCoverageEndSec: continuationQualification.coverageEndSec,
            stems,
          }
          if (!cancelled) {
            setDuration(estimatedTotalDurationSec || buffers[0]?.duration || 0)
          }
          logAudioDebug("appendable_queue:startup_head_pilot_enabled", {
            manifestSlug: appendableStartupManifestMatch.slug || null,
            tracks: trackList.length,
            startupDurationSec: Number(startupDurationSec.toFixed(3)),
            estimatedTotalDurationSec: Number(estimatedTotalDurationSec.toFixed(3)),
            continuationQualification: continuationQualification.status,
            continuationQualificationReason: continuationQualification.reason,
            continuationChunkGroupsAvailable: continuationQualification.availableGroupCount,
            continuationChunkGroupsPlanned,
            continuationCoverageEndSec:
              typeof continuationQualification.coverageEndSec === "number"
                ? Number(continuationQualification.coverageEndSec.toFixed(3))
                : null,
          })
        } else if (useStartupChunkPilot || useStartupChunkSplicePilot) {
          const startupDecoded = await Promise.all(
            trackList.map((track, trackIndex) =>
              decodeTrackBufferFromSrc(trackIndex, track.startupChunk?.startupSrc ?? track.src, "startup")
            )
          )
          buffers = startupDecoded.map((decoded) => decoded.buffer)
          const startupDurationCandidates = trackList
            .map((track, trackIndex) => track.startupChunk?.startupDurationSec ?? buffers[trackIndex]?.duration ?? 0)
            .filter((value): value is number => Number.isFinite(value) && value > 0)
          const estimatedDurationCandidates = trackList
            .map((track) => track.startupChunk?.estimatedTotalDurationSec ?? 0)
            .filter((value): value is number => Number.isFinite(value) && value > 0)
          const crossfadeCandidates = trackList
            .map((track) =>
              track.startupChunk?.crossfadeSec ??
              (useStartupChunkSplicePilot ? STARTUP_CHUNK_SPLICE_DEFAULT_CROSSFADE_SEC : 0.12)
            )
            .filter((value): value is number => Number.isFinite(value) && value > 0)
          const startupDurationSec = startupDurationCandidates.length
            ? Math.min(...startupDurationCandidates)
            : buffers[0]?.duration ?? 0
          const estimatedTotalDurationSec = estimatedDurationCandidates.length
            ? Math.max(...estimatedDurationCandidates)
            : buffers[0]?.duration ?? 0
          const crossfadeSec = clamp(crossfadeCandidates.length ? Math.max(...crossfadeCandidates) : 0.12, 0.05, 0.4)
          const tailStartCandidates = trackList
            .map((track) => track.startupChunk?.tailStartSec ?? 0)
            .filter((value): value is number => Number.isFinite(value) && value >= 0)
          const tailDurationCandidates = trackList
            .map((track) => track.startupChunk?.tailDurationSec ?? 0)
            .filter((value): value is number => Number.isFinite(value) && value > 0)
          const tailStartSec = useStartupChunkSplicePilot && tailStartCandidates.length ? Math.min(...tailStartCandidates) : null
          const tailDurationSec =
            useStartupChunkSplicePilot && tailDurationCandidates.length ? Math.min(...tailDurationCandidates) : null
          startupChunkRuntimeRef.current = {
            enabled: true,
            strategy: useStartupChunkSplicePilot ? "splice" : "handoff",
            stage: "startup",
            startupDurationSec,
            crossfadeSec,
            tailStartSec,
            tailDurationSec,
            estimatedTotalDurationSec,
            tailBuffers: null,
            tailBuffersReady: false,
            fullBuffers: null,
            fullBuffersReady: false,
            handoffInProgress: false,
            handoffComplete: false,
            deferredPeaksScheduled: false,
            tailDecodeStartedAtMs: null,
            tailDecodeReadyAtMs: null,
            fullDecodeStartedAtMs: null,
            fullDecodeReadyAtMs: null,
          }
          if (useStartupChunkSplicePilot) {
            const runtime = startupChunkRuntimeRef.current
            if (runtime) {
              runtime.tailDecodeStartedAtMs = readAudioPerfNowMs()
              logAudioDebug("startup_chunk:eager_tail_decode_begin", {
                tracks: trackList.length,
              })
              const decodedTail = await Promise.all(
                trackList.map((track, trackIndex) =>
                  decodeTrackBufferFromSrc(trackIndex, track.startupChunk?.tailSrc ?? track.src, "tail")
                )
              )
              if (cancelled) return
              runtime.tailBuffers = decodedTail.map((item) => item.buffer)
              runtime.tailBuffersReady = true
              runtime.tailDecodeReadyAtMs = readAudioPerfNowMs()
              const tailDecodeStartedAtMs = runtime.tailDecodeStartedAtMs ?? runtime.tailDecodeReadyAtMs
              logAudioDebug("startup_chunk:eager_tail_decode_ready", {
                tracks: runtime.tailBuffers.length,
                elapsedMs: Number((runtime.tailDecodeReadyAtMs - tailDecodeStartedAtMs).toFixed(1)),
                tailStartSec: runtime.tailStartSec != null ? Number(runtime.tailStartSec.toFixed(3)) : null,
                tailDurationSec: runtime.tailDurationSec != null ? Number(runtime.tailDurationSec.toFixed(3)) : null,
              })
            }
          }
          if (!cancelled) {
            setDuration(estimatedTotalDurationSec || buffers[0]?.duration || 0)
          }
          logAudioDebug(useStartupChunkSplicePilot ? "startup_chunk:splice_pilot_enabled" : "startup_chunk:pilot_enabled", {
            tracks: trackList.length,
            startupDurationSec: Number(startupDurationSec.toFixed(3)),
            estimatedTotalDurationSec: Number(estimatedTotalDurationSec.toFixed(3)),
            crossfadeSec: Number(crossfadeSec.toFixed(3)),
            tailStartSec: tailStartSec != null ? Number(tailStartSec.toFixed(3)) : null,
            tailDurationSec: tailDurationSec != null ? Number(tailDurationSec.toFixed(3)) : null,
          })
          startBackgroundStartupChunkDecode = () => {
            const runtime = startupChunkRuntimeRef.current
            if (!runtime) return
            void (async () => {
              try {
                if (runtime.strategy === "splice" && !runtime.tailBuffersReady && runtime.tailDecodeStartedAtMs == null) {
                  runtime.tailDecodeStartedAtMs = readAudioPerfNowMs()
                  logAudioDebug("startup_chunk:background_tail_decode_begin", {
                    tracks: trackList.length,
                  })
                  const decodedTail = await Promise.all(
                    trackList.map((track, trackIndex) =>
                      decodeTrackBufferFromSrc(trackIndex, track.startupChunk?.tailSrc ?? track.src, "tail")
                    )
                  )
                  if (cancelled) return
                  runtime.tailBuffers = decodedTail.map((item) => item.buffer)
                  runtime.tailBuffersReady = true
                  runtime.tailDecodeReadyAtMs = readAudioPerfNowMs()
                  const tailDecodeStartedAtMs = runtime.tailDecodeStartedAtMs ?? runtime.tailDecodeReadyAtMs
                  logAudioDebug("startup_chunk:background_tail_decode_ready", {
                    tracks: runtime.tailBuffers.length,
                    elapsedMs: Number((runtime.tailDecodeReadyAtMs - tailDecodeStartedAtMs).toFixed(1)),
                    tailStartSec: runtime.tailStartSec != null ? Number(runtime.tailStartSec.toFixed(3)) : null,
                    tailDurationSec: runtime.tailDurationSec != null ? Number(runtime.tailDurationSec.toFixed(3)) : null,
                  })
                }
                if (runtime.fullDecodeStartedAtMs != null) return
                runtime.fullDecodeStartedAtMs = readAudioPerfNowMs()
                logAudioDebug("startup_chunk:background_full_decode_begin", {
                  tracks: trackList.length,
                })
                const decodedFull = await Promise.all(trackList.map((_, trackIndex) => decodeTrackBuffer(trackIndex)))
                if (cancelled) return
                const fullBuffers = decodedFull.map((item) => item.buffer)
                runtime.fullBuffers = fullBuffers
                runtime.fullBuffersReady = true
                runtime.fullDecodeReadyAtMs = readAudioPerfNowMs()
                const fullDecodeStartedAtMs = runtime.fullDecodeStartedAtMs ?? runtime.fullDecodeReadyAtMs
                waveformSourceBuffersRef.current = fullBuffers
                const fullDurationSec = fullBuffers[0]?.duration ?? runtime.estimatedTotalDurationSec ?? 0
                if (fullDurationSec > 0) {
                  setDuration(fullDurationSec)
                }
                logAudioDebug("startup_chunk:background_full_decode_ready", {
                  tracks: fullBuffers.length,
                  elapsedMs: Number((runtime.fullDecodeReadyAtMs - fullDecodeStartedAtMs).toFixed(1)),
                  durationSec: Number(fullDurationSec.toFixed(3)),
                })
                schedulePreviewPeaks(isPlayingRef.current ? WAVEFORM_PREVIEW_WHILE_PLAYING_DELAY_MS : WAVEFORM_PREVIEW_IDLE_DELAY_MS)
                if (!isPlayingRef.current) {
                  runtime.deferredPeaksScheduled = true
                  scheduleDeferredPeaks(DEFERRED_PEAKS_IDLE_DELAY_MS)
                } else {
                  logAudioDebug("startup_chunk:deferred_peaks_wait_handoff", {
                    scope: trackScopeId,
                    handoffAtSec: Number(
                      (runtime.strategy === "splice"
                        ? getStartupChunkFullHandoffAtSec(runtime)
                        : getStartupChunkHandoffAtSec(runtime)
                      ).toFixed(3)
                    ),
                  })
                }
                const handoffAtSec =
                  runtime.strategy === "splice" ? getStartupChunkFullHandoffAtSec(runtime) : getStartupChunkHandoffAtSec(runtime)
                if (isPlayingRef.current && positionSecRef.current >= handoffAtSec) {
                  void performStartupChunkHandoff("background_full_decode_ready", positionSecRef.current)
                }
              } catch (error) {
                if (cancelled) return
                logAudioDebug("startup_chunk:background_full_decode_failed", {
                  reason: error instanceof Error ? error.message : "unknown startup full decode error",
                })
              }
            })()
          }
        } else {
          const restIndexes = trackList.map((_, index) => index).filter((index) => index !== 0)
          buffers = new Array(trackList.length)
          const firstDecoded = await decodeTrackBuffer(0)
          buffers[0] = firstDecoded.buffer
          if (!cancelled) {
            setDuration(firstDecoded.buffer.duration || 0)
          }
          const shouldDecodeSequentially =
            useProgressiveLoad || firstDecoded.byteLength >= LARGE_TRACK_BYTES_THRESHOLD
          if (shouldDecodeSequentially) {
            for (const trackIndex of restIndexes) {
              const decoded = await decodeTrackBuffer(trackIndex)
              buffers[trackIndex] = decoded.buffer
            }
          } else {
            const decodedRest = await Promise.all(restIndexes.map((trackIndex) => decodeTrackBuffer(trackIndex)))
            decodedRest.forEach((decoded, idx) => {
              buffers[restIndexes[idx]] = decoded.buffer
            })
          }
          waveformSourceBuffersRef.current = buffers
          startupChunkRuntimeRef.current = null
        }
      }

      if (decodeWarnings.length) {
        console.warn("Audio decode fallback activated:", decodeWarnings.join(" | "))
      }

      if (cancelled) return
      setDuration(
        useStreamingPilot
          ? 0
          : useAppendableStartupHeadPilot
            ? appendableStartupHeadInit?.estimatedTotalDurationSec ?? buffers[0]?.duration ?? 0
          : (useStartupChunkPilot || useStartupChunkSplicePilot)
            ? startupChunkRuntimeRef.current?.estimatedTotalDurationSec ?? buffers[0]?.duration ?? 0
            : (buffers[0]?.duration ?? 0)
      )

      // engines + per-track chain
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : ""
      const isWebKit =
        /Safari\//.test(ua) &&
        !/Chrome\//.test(ua) &&
        !/Chromium\//.test(ua) &&
        !/Edg\//.test(ua)
      const soundtouchBufferSize = isWebKit ? 4096 : 2048
      soundtouchBufferSizeRef.current = soundtouchBufferSize
      let aggregateCapabilities: AudioEngineCapabilities = {
        supportsTempo: true,
        supportsIndependentPitch: true,
      }

      const registerEngine = (engine: SoundTouchEngine, i: number) => {
        enginesRef.current[i] = engine
        const capabilities = engine.getCapabilities()
        aggregateCapabilities = {
          supportsTempo: aggregateCapabilities.supportsTempo && capabilities.supportsTempo,
          supportsIndependentPitch:
            aggregateCapabilities.supportsIndependentPitch && capabilities.supportsIndependentPitch,
        }

        // gate
        const gate = ctx.createGain()
        // Keep gates open by default for fresh graphs; engines are silent until start() anyway.
        // This avoids Safari races where a 0-initialized gate may stay muted after rapid switches.
        gate.gain.value = 1
        engineGateRef.current[i] = gate

        // track chain
        const g = ctx.createGain()
        g.gain.value = clamp(initialTrackVolumes[i] ?? 1, 0, TRACK_MAX_GAIN) * TRACK_HEADROOM_GAIN
        const p = ctx.createStereoPanner()

        gate.connect(g)
        g.connect(p)
        p.connect(masterIn)

        trackGainRef.current[i] = g
        panRef.current[i] = p

        engine.connect(gate)
        engine.setTempo(tempoRef.current)
        engine.setPitchSemitones(pitchSemiRef.current)
      }

      let engineMode: EngineMode = "soundtouch"
      appendableQueueCoordinatorRef.current = null
      if (
        effectiveAppendableQueuePilotEnabled &&
        !useStreamingPilot &&
        buffers.length !== 1 &&
        !useAppendableQueueMultistemPilot
      ) {
        logAudioDebug("audio:appendable_queue_pilot_skipped", {
          requested: true,
          reason: "multistem_pilot_disabled",
          trackCount: buffers.length,
        })
      }

      if (useStreamingPilot) {
        engineMode = "streaming_media"
        trackList.forEach((track, i) => {
          const engine = createMediaStreamingEngine(ctx, track.src, { preload: "auto" })
          registerEngine(engine, i)
        })
        if (typeof window !== "undefined") {
          const deadlineTs = Date.now() + 12_000
          durationProbeTimer = window.setInterval(() => {
            if (cancelled) return
            const probeDuration = enginesRef.current[0]?.getDurationSeconds?.() ?? 0
            if (probeDuration > 0.5) {
              setDuration(probeDuration)
              window.clearInterval(durationProbeTimer!)
              durationProbeTimer = null
              logAudioDebug("audio:streaming_duration_ready", {
                durationSec: Number(probeDuration.toFixed(3)),
              })
              return
            }
            if (Date.now() >= deadlineTs) {
              window.clearInterval(durationProbeTimer!)
              durationProbeTimer = null
            }
          }, 220)
        }
      } else if (useAppendableQueuePilot) {
        engineMode = "appendable_queue_worklet"
        const createdAppendableEngines: SoundTouchEngine[] = []
        try {
          if (!appendableStartupHeadInit) {
            const continuationPreflight = appendableContinuationPreflightRef.current
            appendableStartupHeadRuntimeRef.current = {
              mode: "full_buffer",
              manifestSlug: null,
              startupDurationSec: null,
              continuationQualification: continuationPreflight.qualification,
              continuationQualificationReason: continuationPreflight.qualificationReason,
              continuationChunkGroupsAvailable: continuationPreflight.availableGroupCount,
              continuationChunkGroupsPlanned: continuationPreflight.plannedGroupCount,
              continuationChunkGroupsDecoded: 0,
              continuationChunkGroupsAppended: 0,
              continuationCoverageEndSec: continuationPreflight.coverageEndSec,
              stems: [],
            }
          }
          if (buffers.length === 1) {
            const source = appendableStartupHeadInit
              ? appendableStartupHeadInit.stems[0]?.sourceController.source
              : createAudioBufferAppendableSource(buffers[0])
            if (!source) {
              throw new Error("appendable startup head pilot missing source controller")
            }
            const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
            logAudioDebug("audio:appendable_queue_engine_begin", {
              trackIndex: 0,
              durationSec: Number((buffers[0]?.duration ?? 0).toFixed(3)),
              startupHeadMode: appendableStartupHeadRuntimeRef.current?.mode ?? "full_buffer",
            })
            const engine = await promiseWithTimeout(
              createAppendableQueueEngine(ctx, source, {
                enableIndependentPitch: appendableRoutePitchShadowActive,
              }),
              RINGBUFFER_ENGINE_INIT_TIMEOUT_MS,
              "appendable queue engine #0"
            )
            const elapsedMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
            logAudioDebug("audio:appendable_queue_engine_ready", {
              trackIndex: 0,
              elapsedMs: Number(elapsedMs.toFixed(1)),
            })
            registerEngine(engine, 0)
          } else {
            const sampleRate = appendableStartupHeadInit?.sampleRate ?? buffers[0]?.sampleRate ?? ctx.sampleRate
            const durationFrames =
              appendableStartupHeadInit?.durationFrames ??
              buffers.reduce((maxFrames, buffer) => Math.max(maxFrames, buffer.length), 0)
            for (let i = 0; i < buffers.length; i += 1) {
              const source = appendableStartupHeadInit
                ? appendableStartupHeadInit.stems[i]?.sourceController.source
                : createAudioBufferAppendableSource(buffers[i])
              if (!source) {
                throw new Error(`appendable startup head pilot missing source controller for track #${i}`)
              }
              const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
              logAudioDebug("audio:appendable_queue_engine_begin", {
                trackIndex: i,
                durationSec: Number((buffers[i]?.duration ?? 0).toFixed(3)),
                multitrack: true,
                startupHeadMode: appendableStartupHeadRuntimeRef.current?.mode ?? "full_buffer",
              })
              const engine = await promiseWithTimeout(
                createAppendableQueueEngine(ctx, source, {
                  externalTick: true,
                  enableIndependentPitch: appendableRoutePitchShadowActive,
                }),
                RINGBUFFER_ENGINE_INIT_TIMEOUT_MS,
                `appendable queue engine #${i}`
              )
              createdAppendableEngines[i] = engine
              const elapsedMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
              logAudioDebug("audio:appendable_queue_engine_ready", {
                trackIndex: i,
                elapsedMs: Number(elapsedMs.toFixed(1)),
                multitrack: true,
              })
            }
            createdAppendableEngines.forEach((engine, index) => {
              registerEngine(engine, index)
            })
            appendableQueueCoordinatorRef.current = createAppendableQueueMultitrackCoordinator({
              ctx,
              sampleRate,
              durationFrames,
              stems: createdAppendableEngines.map((engine, index) => {
                const startupStem = appendableStartupHeadInit?.stems[index] ?? null
                return {
                  stemIndex: index,
                  label: trackList[index]?.name ?? `Track ${index + 1}`,
                  engine,
                  getSourceBufferedUntilSec: startupStem
                    ? () => startupStem.sourceController.getState().bufferedUntilFrame / sampleRate
                    : () => buffers[index]?.duration ?? 0,
                  getSourceQueuedSegments: startupStem
                    ? () => startupStem.sourceController.getState().queuedSegments
                    : () => 1,
                  isSourceEnded: startupStem ? () => startupStem.sourceController.getState().ended : () => true,
                  isStartupAppended: startupStem ? () => startupStem.startupAppended : () => true,
                  isFullAppended: startupStem ? () => startupStem.fullAppended : () => true,
                  isFullDecoded: startupStem ? () => startupStem.fullDecoded : () => true,
                }
              }),
            })
            logAudioDebug("audio:appendable_queue_multitrack_ready", {
              trackCount: createdAppendableEngines.length,
              durationSec: Number(((durationFrames || 0) / sampleRate).toFixed(3)),
              startupHeadMode: appendableStartupHeadRuntimeRef.current?.mode ?? "full_buffer",
            })
            appendableQueueCoordinatorRef.current.tick({ force: true })
              setAppendableQueueSourceProgressSnapshot(
                readAppendableQueueSourceProgressSnapshot(
                  appendableQueueCoordinatorRef.current,
                  appendableStartupHeadRuntimeRef.current,
                  appendableContinuationPreflightRef.current
                )
              )
          }

          if (appendableStartupHeadInit) {
            startBackgroundStartupChunkDecode = () => {
              void (async () => {
              try {
                const runtime = appendableStartupHeadRuntimeRef.current
                if (appendableStartupHeadInit.continuationChunkGroupsPlanned > 0) {
                  for (let groupIndex = 0; groupIndex < appendableStartupHeadInit.continuationChunkGroupsPlanned; groupIndex += 1) {
                    try {
                      logAudioDebug("appendable_queue:continuation_chunk_group_begin", {
                        manifestSlug: appendableStartupHeadInit.manifestSlug,
                        groupIndex,
                        tracks: trackList.length,
                      })
                      const decodedGroup = await Promise.all(
                        appendableStartupHeadInit.stems.map((stem, trackIndex) =>
                          decodeTrackBufferFromSrc(trackIndex, stem.continuationChunks[groupIndex].src, "continuation")
                        )
                      )
                      if (cancelled) return
                      decodedGroup.forEach((decoded, index) => {
                        const stem = appendableStartupHeadInit.stems[index]
                        const continuationMeta = stem?.continuationChunks[groupIndex]
                        if (!stem || !continuationMeta) return
                        const continuationBuffer = decoded.buffer
                        const startFrame = Math.max(
                          stem.sourceController.getState().bufferedUntilFrame,
                          Math.floor(continuationMeta.startSec * continuationBuffer.sampleRate)
                        )
                        const continuationChunk = sliceAudioBufferToChunk(
                          continuationBuffer,
                          0,
                          continuationBuffer.length,
                          { final: false }
                        )
                        if (!continuationChunk) return
                        stem.sourceController.appendChunk({
                          ...continuationChunk,
                          startFrame,
                          final: false,
                        })
                        stem.continuationChunkFrames += continuationChunk.frameCount
                      })
                      if (runtime) {
                        runtime.continuationChunkGroupsDecoded = Math.max(runtime.continuationChunkGroupsDecoded, groupIndex + 1)
                        runtime.continuationChunkGroupsAppended = Math.max(runtime.continuationChunkGroupsAppended, groupIndex + 1)
                      }
                      appendableQueueCoordinatorRef.current?.tick({ force: true })
                      setAppendableQueueSourceProgressSnapshot(
                        readAppendableQueueSourceProgressSnapshot(
                          appendableQueueCoordinatorRef.current,
                          appendableStartupHeadRuntimeRef.current,
                          appendableContinuationPreflightRef.current
                        )
                      )
                      logAudioDebug("appendable_queue:continuation_chunk_group_ready", {
                        manifestSlug: appendableStartupHeadInit.manifestSlug,
                        groupIndex,
                        tracks: decodedGroup.length,
                      })
                    } catch (error) {
                      logAudioDebug("appendable_queue:continuation_chunk_group_failed", {
                        manifestSlug: appendableStartupHeadInit.manifestSlug,
                        groupIndex,
                        reason: error instanceof Error ? error.message : "unknown continuation chunk decode error",
                      })
                      break
                    }
                  }
                }
                logAudioDebug("appendable_queue:startup_head_full_decode_begin", {
                  manifestSlug: appendableStartupHeadInit.manifestSlug,
                  tracks: trackList.length,
                })
                const decodedFull = await Promise.all(trackList.map((_, trackIndex) => decodeTrackBuffer(trackIndex)))
                if (cancelled) return
                const fullBuffers = decodedFull.map((item) => item.buffer)
                waveformSourceBuffersRef.current = fullBuffers
                const fullDurationSec = Math.max(
                  appendableStartupHeadInit.estimatedTotalDurationSec,
                  ...fullBuffers.map((buffer) => buffer.duration || 0)
                )
                if (fullDurationSec > 0) {
                  setDuration(fullDurationSec)
                }
                appendableStartupHeadInit.stems.forEach((stem, index) => {
                  stem.fullDecoded = true
                  const fullBuffer = fullBuffers[index]
                  if (!fullBuffer) return
                  const sourceBufferedUntilFrame = stem.sourceController.getState().bufferedUntilFrame
                  const fullChunk = sliceAudioBufferToChunk(
                    fullBuffer,
                    sourceBufferedUntilFrame,
                    Math.max(1, fullBuffer.length - sourceBufferedUntilFrame),
                    { final: true }
                  )
                  if (fullChunk) {
                    stem.sourceController.appendChunk(fullChunk)
                  }
                  stem.sourceController.markEnded()
                  stem.fullAppended = true
                })
                appendableQueueCoordinatorRef.current?.tick({ force: true })
                setAppendableQueueSourceProgressSnapshot(
                  readAppendableQueueSourceProgressSnapshot(
                    appendableQueueCoordinatorRef.current,
                    appendableStartupHeadRuntimeRef.current,
                    appendableContinuationPreflightRef.current
                  )
                )
                schedulePreviewPeaks(isPlayingRef.current ? WAVEFORM_PREVIEW_WHILE_PLAYING_DELAY_MS : WAVEFORM_PREVIEW_IDLE_DELAY_MS)
                if (!isPlayingRef.current) {
                  scheduleDeferredPeaks(DEFERRED_PEAKS_IDLE_DELAY_MS)
                }
                logAudioDebug("appendable_queue:startup_head_full_decode_ready", {
                  manifestSlug: appendableStartupHeadInit.manifestSlug,
                  tracks: fullBuffers.length,
                  durationSec: Number(fullDurationSec.toFixed(3)),
                })
              } catch (error) {
                if (cancelled) return
                logAudioDebug("appendable_queue:startup_head_full_decode_failed", {
                  manifestSlug: appendableStartupHeadInit.manifestSlug,
                  reason: error instanceof Error ? error.message : "unknown startup head full decode error",
                })
              }
              })()
            }
          }
        } catch (error) {
          createdAppendableEngines.forEach((engine) => {
            try {
              engine.destroy()
            } catch {}
          })
          appendableQueueCoordinatorRef.current = null
          logAudioDebug("audio:appendable_queue_engine_fallback", {
            trackIndex: createdAppendableEngines.length > 1 ? null : 0,
            trackCount: buffers.length,
            reason: error instanceof Error ? error.message : "unknown appendable queue init error",
          })
          for (let i = 0; i < buffers.length; i += 1) {
            const fallback = createSoundTouchEngine(ctx, buffers[i], { bufferSize: soundtouchBufferSize })
            registerEngine(fallback, i)
          }
          engineMode = "soundtouch"
        }
      } else if (useRingBufferPilot) {
        engineMode = "ringbuffer_worklet"
        for (let i = 0; i < buffers.length; i += 1) {
          try {
            let lastRingbufferIssueLogAt = 0
            let lastLoggedUnderrunFrames = 0
            let lastLoggedReadWrapCount = 0
            let lastLoggedWriteWrapCount = 0
            logAudioDebug("audio:ringbuffer_engine_begin", {
              trackIndex: i,
              durationSec: Number((buffers[i]?.duration ?? 0).toFixed(3)),
            })
            const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
            const engine = await promiseWithTimeout(
              createRingBufferWorkletEngine(ctx, buffers[i], {
                externalTick: true,
                onStats: (stats) => {
                  const hasWrapAdvance =
                    stats.readWrapCount > lastLoggedReadWrapCount || stats.writeWrapCount > lastLoggedWriteWrapCount
                  if (hasWrapAdvance) {
                    lastLoggedReadWrapCount = stats.readWrapCount
                    lastLoggedWriteWrapCount = stats.writeWrapCount
                    logAudioDebug("ringbuffer:wrap_event", {
                      trackIndex: i,
                      readWrapCount: stats.readWrapCount,
                      writeWrapCount: stats.writeWrapCount,
                      lastReadWrapDeltaMax: stats.lastReadWrapDeltaMax,
                      availableFrames: stats.availableFrames,
                      minAvailableFrames: stats.minAvailableFrames,
                      maxAvailableFrames: stats.maxAvailableFrames,
                      queueEstimateFrames: stats.queueEstimateFrames,
                      sourceFrameCursorSec: stats.sourceFrameCursorSec,
                    })
                  }
                  const lowWaterBreach = stats.minAvailableFrames <= stats.lowWaterFrames
                  const hasNewUnderrun = stats.underrunFrames > lastLoggedUnderrunFrames
                  if (!lowWaterBreach && !hasNewUnderrun) return
                  const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now()
                  if (!hasNewUnderrun && nowMs - lastRingbufferIssueLogAt < 800) return
                  lastRingbufferIssueLogAt = nowMs
                  lastLoggedUnderrunFrames = stats.underrunFrames
                  logAudioDebug("ringbuffer:stats", {
                    trackIndex: i,
                    ...stats,
                  })
                },
              }),
              RINGBUFFER_ENGINE_INIT_TIMEOUT_MS,
              `ringbuffer engine #${i}`
            )
            const elapsedMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
            logAudioDebug("audio:ringbuffer_engine_ready", {
              trackIndex: i,
              elapsedMs: Number(elapsedMs.toFixed(1)),
            })
            registerEngine(engine, i)
          } catch (error) {
            logAudioDebug("audio:ringbuffer_engine_fallback", {
              trackIndex: i,
              reason: error instanceof Error ? error.message : "unknown ringbuffer init error",
            })
            console.warn(`RingBuffer worklet fallback to SoundTouch on track #${i}:`, error)
            const fallback = createSoundTouchEngine(ctx, buffers[i], { bufferSize: soundtouchBufferSize })
            registerEngine(fallback, i)
            engineMode = "soundtouch"
          }
        }
      } else {
        engineMode = "soundtouch"
        buffers.forEach((buffer, i) => {
          const engine = createSoundTouchEngine(ctx, buffer, { bufferSize: soundtouchBufferSize })
          registerEngine(engine, i)
        })
      }

      setIsReady(true)
      readyRef.current = true
      setActiveEngineMode(engineMode)
      setActiveEngineCapabilities(
        applyAppendableActivationPolicyToCapabilities(engineMode, aggregateCapabilities, appendablePilotActivation)
      )
      logAudioDebug("audio:init_graph", {
        engines: useStreamingPilot ? trackList.length : buffers.length,
        mode: engineMode,
        startupChunkPilotEnabled: useStartupChunkPilot,
        startupChunkSplicePilotEnabled: useStartupChunkSplicePilot,
        startupChunkSplicePilotKey: startupChunkSplicePilotKey || null,
        appendableQueuePilotEnabled: effectiveAppendableQueuePilotEnabled,
        appendableActivationMode: appendablePilotActivation.activationMode,
        appendableTempoUnlocked: appendablePilotActivation.tempoControlUnlocked,
        appendablePitchShadowActive: appendableRoutePitchShadowActive,
        ringBufferPilotEnabled,
        streamingBufferPilotEnabled,
        soundtouchBufferSize,
        isWebKit,
      })
      onTrackSetReadyRef.current?.(trackScopeId)

      // peaks: draw lightweight placeholders immediately,
      // then warm them up in two steps:
      // 1) cheap preview envelope to replace flat placeholders quickly,
      // 2) full-resolution peaks in a later background task.
      schedulePreviewPeaks = (delayMs: number) => {
        if (typeof window === "undefined") return
        if (previewPeaksTimer != null) window.clearTimeout(previewPeaksTimer)
        logAudioDebug("waveform:preview_peaks_scheduled", {
          delayMs,
          playing: isPlayingRef.current,
          scope: trackScopeId,
        })
        previewPeaksTimer = window.setTimeout(() => {
          previewPeaksTimer = null
          void computePreviewWaveformPeaks()
        }, delayMs)
      }
      scheduleDeferredPeaks = (delayMs: number) => {
        if (typeof window === "undefined") return
        if (deferredPeaksTimer != null) window.clearTimeout(deferredPeaksTimer)
        cancelDeferredPeaksIdleCallback()
        logAudioDebug("waveform:deferred_peaks_scheduled", {
          delayMs,
          playing: isPlayingRef.current,
          scope: trackScopeId,
        })
        deferredPeaksTimer = window.setTimeout(() => {
          deferredPeaksTimer = null
          const runDeferredPeaks = () => {
            deferredPeaksIdleCallbackRef.current = null
            void computeDeferredPeaks()
          }
          if (isPlayingRef.current) {
            if (typeof window.requestIdleCallback === "function") {
              deferredPeaksIdleCallbackRef.current = window.requestIdleCallback(runDeferredPeaks, {
                timeout: WAVEFORM_FULL_PEAKS_IDLE_CALLBACK_TIMEOUT_MS,
              })
            } else {
              deferredPeaksIdleCallbackRef.current = window.setTimeout(runDeferredPeaks, 0)
            }
            return
          }
          runDeferredPeaks()
        }, delayMs)
      }
      deferredPeaksSchedulerRef.current = scheduleDeferredPeaks
      const computePreviewWaveformPeaks = async () => {
        if (useStreamingPilot) return
        if (cancelled) return
        const waveformBuffers = waveformSourceBuffersRef.current
        if (!waveformBuffers.length) return

        const peaksArr: (WavePeaks | null)[] = [...peaksRef.current]
        let cacheHits = 0
        let computedTracks = 0
        for (let i = 0; i < waveformBuffers.length; i++) {
          if (cancelled) return
          const trackSrc = trackList[i]?.src ?? `track-${i}`
          const buckets = DEFERRED_PEAKS_BUCKETS
          const cachedPeaks = readCachedWavePeaks(trackSrc, buckets)
          if (cachedPeaks) {
            peaksArr[i] = cachedPeaks
            cacheHits += 1
            continue
          }
          try {
            const previewPeaks = computePreviewPeaks(waveformBuffers[i], buckets, {
              probesPerBucket: WAVEFORM_PREVIEW_PROBES_PER_BUCKET,
            })
            peaksArr[i] = previewPeaks
            writeCachedWavePeaks(trackSrc, previewPeaks, buckets, "preview")
            computedTracks += 1
          } catch {
            peaksArr[i] = makeFlatPeaks(buckets)
          }
          if (i < waveformBuffers.length - 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
        }
        if (cancelled) return
        peaksRef.current = peaksArr
        setWaveReady(true)
        logAudioDebug("waveform:preview_peaks_ready", {
          scope: trackScopeId,
          tracks: peaksArr.length,
          cacheHits,
          computedTracks,
        })
      }
      const computeDeferredPeaks = async () => {
        if (useStreamingPilot) return
        if (cancelled) return
        const waveformBuffers = waveformSourceBuffersRef.current
        if (!waveformBuffers.length) return

        const peaksArr: (WavePeaks | null)[] = []
        let fullCacheHits = 0
        let upgradedFromPreview = 0
        for (let i = 0; i < waveformBuffers.length; i++) {
          if (cancelled) return
          const trackSrc = trackList[i]?.src ?? `track-${i}`
          const buckets = DEFERRED_PEAKS_BUCKETS
          const cachedFullPeaks = readCachedFullWavePeaks(trackSrc, buckets)
          if (cachedFullPeaks) {
            peaksArr[i] = cachedFullPeaks
            fullCacheHits += 1
            continue
          }
          const cachedPreviewPeaks = readCachedWavePeaks(trackSrc, buckets)
          if (cachedPreviewPeaks) {
            peaksArr[i] = cachedPreviewPeaks
          }
          try {
            const computedPeaks = await computePeaksProgressive(waveformBuffers[i], buckets, {
              yieldEveryBuckets:
                isPlayingRef.current && useRingBufferPilot
                  ? WAVEFORM_FULL_PEAKS_RINGBUFFER_PLAYING_YIELD_EVERY_BUCKETS
                  : isPlayingRef.current
                    ? WAVEFORM_FULL_PEAKS_PLAYING_YIELD_EVERY_BUCKETS
                    : 12,
              maxSliceMs: isPlayingRef.current ? WAVEFORM_FULL_PEAKS_PLAYING_MAX_SLICE_MS : 3,
              yieldDelayMs:
                isPlayingRef.current && useRingBufferPilot
                  ? WAVEFORM_FULL_PEAKS_RINGBUFFER_PLAYING_YIELD_DELAY_MS
                  : isPlayingRef.current
                    ? 4
                    : 0,
            })
            peaksArr[i] = computedPeaks
            writeCachedWavePeaks(trackSrc, computedPeaks, buckets, "full")
            if (cachedPreviewPeaks) upgradedFromPreview += 1
          } catch {
            peaksArr[i] = peaksArr[i] ?? makeFlatPeaks(buckets)
          }
          if (i < waveformBuffers.length - 1) {
            await new Promise<void>((resolve) =>
              setTimeout(
                resolve,
                isPlayingRef.current && useRingBufferPilot
                  ? WAVEFORM_FULL_PEAKS_RINGBUFFER_BETWEEN_TRACKS_DELAY_MS
                  : isPlayingRef.current
                    ? WAVEFORM_FULL_PEAKS_BETWEEN_TRACKS_DELAY_MS
                    : 0
              )
            )
          }
        }
        if (cancelled) return
        peaksRef.current = peaksArr
        setWaveReady(true)
        logAudioDebug("waveform:deferred_peaks_ready", {
          scope: trackScopeId,
          tracks: peaksArr.length,
          fullCacheHits,
          upgradedFromPreview,
        })
      }
      requestAnimationFrame(() => {
        if (cancelled) return
        const waveformBuffers = waveformSourceBuffersRef.current
        const tracksForPeaks = useStreamingPilot ? trackList.length : (waveformBuffers.length || trackList.length)
        const startupRuntime = startupChunkRuntimeRef.current
        const shouldWaitForFullWaveform =
          !useStreamingPilot && !!startupRuntime?.enabled && !startupRuntime.fullBuffersReady
        const shouldDeferFullPeaksUntilHandoff =
          !useStreamingPilot &&
          !!startupRuntime?.enabled &&
          startupRuntime.fullBuffersReady &&
          !startupRuntime.handoffComplete &&
          isPlayingRef.current
        const placeholderPeaks: (WavePeaks | null)[] = []
        const shouldWarmPreview =
          !useStreamingPilot &&
          !shouldWaitForFullWaveform &&
          (isPlayingRef.current || waveformBuffers.some((buffer) => buffer.duration >= WAVEFORM_PREVIEW_DURATION_THRESHOLD_SEC))
        let missingPreviewPeaks = false
        let missingDeferredPeaks = false
        let cacheHits = 0
        let previewCacheHits = 0
        let fullCacheHits = 0
        for (let i = 0; i < tracksForPeaks; i++) {
          const trackSrc = trackList[i]?.src ?? `track-${i}`
          const cachedEntry = readCachedWavePeaksEntry(trackSrc, DEFERRED_PEAKS_BUCKETS)
          if (cachedEntry) {
            placeholderPeaks[i] = cachedEntry.peaks
            cacheHits += 1
            if (cachedEntry.quality === "full") {
              fullCacheHits += 1
            } else {
              previewCacheHits += 1
              missingDeferredPeaks = true
            }
            continue
          }
          placeholderPeaks[i] = makeFlatPeaks(DEFERRED_PEAKS_BUCKETS)
          missingPreviewPeaks = true
          missingDeferredPeaks = true
        }
        peaksRef.current = placeholderPeaks
        setWaveReady(true)
        if (shouldWaitForFullWaveform) {
          logAudioDebug("startup_chunk:waveform_wait_full_buffers", {
            scope: trackScopeId,
            tracks: tracksForPeaks,
          })
          return
        }
        if (shouldWarmPreview && !useStreamingPilot && waveformBuffers.length > 0 && missingPreviewPeaks) {
          schedulePreviewPeaks(isPlayingRef.current ? WAVEFORM_PREVIEW_WHILE_PLAYING_DELAY_MS : WAVEFORM_PREVIEW_IDLE_DELAY_MS)
        }
        if (shouldDeferFullPeaksUntilHandoff) {
          logAudioDebug("startup_chunk:deferred_peaks_wait_handoff", {
            scope: trackScopeId,
            handoffAtSec: Number(getStartupChunkHandoffAtSec(startupRuntime).toFixed(3)),
          })
        } else if (!useStreamingPilot && waveformBuffers.length > 0 && missingDeferredPeaks) {
          scheduleDeferredPeaks(
            isPlayingRef.current
              ? useRingBufferPilot
                ? DEFERRED_PEAKS_RINGBUFFER_WHILE_PLAYING_DELAY_MS
                : DEFERRED_PEAKS_WHILE_PLAYING_DELAY_MS
              : DEFERRED_PEAKS_IDLE_DELAY_MS
          )
        } else if (!useStreamingPilot && cacheHits > 0) {
          logAudioDebug("waveform:deferred_peaks_cache_hit", {
            scope: trackScopeId,
            tracks: tracksForPeaks,
            cacheHits,
            fullCacheHits,
            previewCacheHits,
          })
        }
      })
      startBackgroundStartupChunkDecode?.()
    }

    init().catch((e) => console.error("Audio init error:", e))
    return () => {
      cancelled = true
      cancelDeferredPeaksIdleCallback()
      deferredPeaksSchedulerRef.current = () => {}
      if (typeof window !== "undefined" && previewPeaksTimer != null) window.clearTimeout(previewPeaksTimer)
      if (typeof window !== "undefined" && deferredPeaksTimer != null) window.clearTimeout(deferredPeaksTimer)
      if (typeof window !== "undefined" && durationProbeTimer != null) window.clearInterval(durationProbeTimer)
      if (typeof window !== "undefined" && startupChunkFinalizeTimerRef.current != null) {
        window.clearTimeout(startupChunkFinalizeTimerRef.current)
        startupChunkFinalizeTimerRef.current = null
      }
      fetchControllers.forEach((controller) => controller.abort())
      readyRef.current = false
      if (persistOnUnmount && isPlayingRef.current) return
      disposeTrackAudioGraph()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appendablePilotActivation.activationAllowed,
    appendablePilotActivation.activationConfigured,
    appendablePilotActivation.activationMode,
    appendablePilotActivation.tempoControlUnlocked,
    effectiveAppendableQueueMultistemPilotEnabled,
    effectiveAppendableQueuePilotEnabled,
    appendableQueueContinuationChunksPilotEnabled,
    appendableRoutePitchShadowActive,
    appendableQueueStartupHeadPilotEnabled,
    disposeTrackAudioGraph,
    persistOnUnmount,
    ringBufferPilotEnabled,
    streamingBufferPilotEnabled,
    trackScopeId,
  ])

  useEffect(() => {
    return () => {
      if (persistOnUnmount && isPlayingRef.current) return
      if (typeof window !== "undefined" && isPlayingRef.current) {
        const handoff: NavHandoffState = {
          trackScopeId,
          positionSec: positionSecRef.current,
          loopOn: loopOnRef.current,
          playing: true,
          ts: Date.now(),
        }
        try {
          window.sessionStorage.setItem(NAV_HANDOFF_STORAGE_KEY, JSON.stringify(handoff))
        } catch {}
      }
      try {
        disposeTrackAudioGraph()
      } catch {}
      if (typeof window !== "undefined" && startupChunkFinalizeTimerRef.current != null) {
        window.clearTimeout(startupChunkFinalizeTimerRef.current)
        startupChunkFinalizeTimerRef.current = null
      }
      deferredPeaksSchedulerRef.current = () => {}
      startupChunkRuntimeRef.current = null
      waveformSourceBuffersRef.current = []
      teardownAudioDebugMasterTap()
      teardownRecordingV2Tap()
      void closeRecordingV2OpfsWriter()
      const ctx = ctxRef.current
      if (ctx && ctx.state !== "closed") {
        void ctx.close()
      }
      ctxRef.current = null
      masterInRef.current = null
      masterGainRef.current = null
      masterLimiterRef.current = null
      wetGainRef.current = null
      dryGainRef.current = null
    }
  }, [closeRecordingV2OpfsWriter, disposeTrackAudioGraph, persistOnUnmount, teardownAudioDebugMasterTap, teardownRecordingV2Tap, trackScopeId])

  const setEngineGateTarget = useCallback((target: number, opts?: { immediate?: boolean; rampSec?: number }) => {
    const safeTarget = clamp(target, 0, 1)
    const immediate = opts?.immediate ?? false
    const rampSec = Math.max(0, opts?.rampSec ?? 0.02)
    engineGateRef.current.forEach((node) => {
      if (!node) return
      const g = node.gain
      const now = node.context.currentTime
      const current = Number.isFinite(g.value) ? g.value : safeTarget
      try {
        g.cancelScheduledValues(now)
        g.setValueAtTime(current, now)
        if (immediate || rampSec === 0) g.setValueAtTime(safeTarget, now)
        else g.linearRampToValueAtTime(safeTarget, now + rampSec)
      } catch {
        try {
          g.value = safeTarget
        } catch {}
      }
    })
  }, [])

  const setRingbufferSeekResumeEnvelope = useCallback((opts?: { totalRampSec?: number; midRampSec?: number }) => {
    const totalRampSec = Math.max(0, opts?.totalRampSec ?? SEEK_SMOOTH_RINGBUFFER_OPEN_RAMP_SEC)
    const midRampSec = clamp(opts?.midRampSec ?? SEEK_SMOOTH_RINGBUFFER_CROSSFADE_MID_RAMP_SEC, 0, totalRampSec)
    const midGain = clamp(SEEK_SMOOTH_RINGBUFFER_CROSSFADE_MID_GAIN, 0, 1)
    engineGateRef.current.forEach((node) => {
      if (!node) return
      const g = node.gain
      const now = node.context.currentTime
      const current = Number.isFinite(g.value) ? g.value : midGain
      const firstTarget = Math.max(current, midGain)
      const firstRampEnd = now + midRampSec
      const finalRampEnd = now + totalRampSec
      try {
        g.cancelScheduledValues(now)
        g.setValueAtTime(current, now)
        if (midRampSec > 0 && firstTarget > current) {
          g.linearRampToValueAtTime(firstTarget, firstRampEnd)
        } else {
          g.setValueAtTime(firstTarget, now)
        }
        if (finalRampEnd > firstRampEnd) {
          g.linearRampToValueAtTime(1, finalRampEnd)
        } else {
          g.setValueAtTime(1, now)
        }
      } catch {
        try {
          g.value = 1
        } catch {}
      }
    })
  }, [])

  const stopEnginesHard = useCallback((opts?: { muteGates?: boolean }) => {
    if (opts?.muteGates ?? true) {
      setEngineGateTarget(0, { rampSec: 0.02 })
    }
    const coordinator =
      activeEngineMode === "appendable_queue_worklet" && enginesRef.current.length > 1
        ? appendableQueueCoordinatorRef.current
        : null
    if (coordinator) {
      coordinator.pause()
      return
    }
    enginesRef.current.forEach((eng) => {
      try {
        eng?.stop()
      } catch {}
    })
  }, [activeEngineMode, setEngineGateTarget])

  const wrapEngineWithAbsoluteOffset = useCallback(
    (engine: SoundTouchEngine, offsetSec: number, reportedDurationSec?: number): SoundTouchEngine => {
      const safeOffsetSec = Number.isFinite(offsetSec) ? Math.max(0, offsetSec) : 0
      const safeDurationSec =
        Number.isFinite(reportedDurationSec as number) && (reportedDurationSec as number) > 0
          ? Math.max(safeOffsetSec, reportedDurationSec as number)
          : undefined
      return {
        getCapabilities: engine.getCapabilities,
        connect: (node) => engine.connect(node),
        disconnect: () => engine.disconnect(),
        start: () => engine.start(),
        stop: () => engine.stop(),
        seekSeconds: (sec) => engine.seekSeconds(Math.max(0, sec - safeOffsetSec)),
        getSourcePositionSeconds: () => safeOffsetSec + engine.getSourcePositionSeconds(),
        getDurationSeconds: () => safeDurationSec ?? (safeOffsetSec + (engine.getDurationSeconds?.() ?? 0)),
        getBufferedSeconds: engine.getBufferedSeconds ? () => engine.getBufferedSeconds?.() ?? 0 : undefined,
        getDebugState: engine.getDebugState
          ? () => ({
              ...engine.getDebugState?.(),
              offsetSec: safeOffsetSec,
              reportedDurationSec: safeDurationSec ?? null,
            })
          : undefined,
        tickPlayback: engine.tickPlayback ? (plan) => engine.tickPlayback?.(plan) : undefined,
        setTempo: (tempo) => engine.setTempo(tempo),
        setPitchSemitones: (semitones) => engine.setPitchSemitones(semitones),
        destroy: () => engine.destroy(),
      }
    },
    []
  )

  const replaceEnginesWithSoundTouchBuffers = useCallback(
    (
      buffers: AudioBuffer[],
      posSec: number,
      opts?: { keepPlaying?: boolean; openRampSec?: number; sourceOffsetSec?: number; reportedDurationSec?: number }
    ) => {
      const ctx = ctxRef.current
      if (!ctx || !buffers.length || buffers.length !== engineGateRef.current.length) return false
      const nextEngines: SoundTouchEngine[] = []
      const nextGates: GainNode[] = []
      const previousEngines = enginesRef.current.slice()
      const previousGates = engineGateRef.current.slice()
      const keepPlaying = opts?.keepPlaying ?? isPlayingRef.current
      const sourceOffsetSec =
        Number.isFinite(opts?.sourceOffsetSec as number) && (opts?.sourceOffsetSec as number) > 0
          ? (opts?.sourceOffsetSec as number)
          : 0
      const reportedDurationSec =
        Number.isFinite(opts?.reportedDurationSec as number) && (opts?.reportedDurationSec as number) > 0
          ? (opts?.reportedDurationSec as number)
          : undefined
      const sourceWindowDurationSec = buffers[0]?.duration ?? 0
      const effectiveDurationSec = getStartupChunkEffectiveDurationSec(
        sourceWindowDurationSec,
        sourceOffsetSec,
        reportedDurationSec
      )
      const safePosSec = clamp(posSec, 0, effectiveDurationSec ?? posSec)
      const rampGate = (node: GainNode, target: number, rampSec: number) => {
        const safeTarget = clamp(target, 0, 1)
        const now = node.context.currentTime
        const current = Number.isFinite(node.gain.value) ? node.gain.value : safeTarget
        try {
          node.gain.cancelScheduledValues(now)
          node.gain.setValueAtTime(current, now)
          if (rampSec <= 0) {
            node.gain.setValueAtTime(safeTarget, now)
          } else {
            node.gain.linearRampToValueAtTime(safeTarget, now + rampSec)
          }
        } catch {
          try {
            node.gain.value = safeTarget
          } catch {}
        }
      }
      try {
        if (!keepPlaying) {
          buffers.forEach((buffer, index) => {
            const gate = engineGateRef.current[index]
            if (!gate) {
              throw new Error(`missing engine gate for startup handoff track #${index}`)
            }
            const baseEngine = createSoundTouchEngine(ctx, buffer, { bufferSize: soundtouchBufferSizeRef.current })
            const nextEngine =
              sourceOffsetSec > 0 || reportedDurationSec != null
                ? wrapEngineWithAbsoluteOffset(baseEngine, sourceOffsetSec, reportedDurationSec)
                : baseEngine
            nextEngine.connect(gate)
            nextEngine.setTempo(tempoRef.current)
            nextEngine.setPitchSemitones(pitchSemiRef.current)
            nextEngine.seekSeconds(safePosSec)
            nextEngines[index] = nextEngine
          })
          previousEngines.forEach((engine) => {
            try {
              engine?.stop()
            } catch {}
          })
          previousEngines.forEach((engine) => {
            try {
              engine?.destroy()
            } catch {}
          })
          enginesRef.current = nextEngines
          return true
        }

        const overlapSec = Math.max(STARTUP_CHUNK_HANDOFF_OVERLAP_SEC, opts?.openRampSec ?? 0.05)
        buffers.forEach((buffer, index) => {
          const trackGain = trackGainRef.current[index]
          if (!trackGain) {
            throw new Error(`missing track gain for startup handoff track #${index}`)
          }
          const nextGate = ctx.createGain()
          nextGate.gain.value = 0
          nextGate.connect(trackGain)
          const baseEngine = createSoundTouchEngine(ctx, buffer, { bufferSize: soundtouchBufferSizeRef.current })
          const nextEngine =
            sourceOffsetSec > 0 || reportedDurationSec != null
              ? wrapEngineWithAbsoluteOffset(baseEngine, sourceOffsetSec, reportedDurationSec)
              : baseEngine
          nextEngine.connect(nextGate)
          nextEngine.setTempo(tempoRef.current)
          nextEngine.setPitchSemitones(pitchSemiRef.current)
          nextEngine.seekSeconds(safePosSec)
          nextEngine.start()
          nextEngines[index] = nextEngine
          nextGates[index] = nextGate
        })

        previousGates.forEach((gate) => {
          if (!gate) return
          rampGate(gate, 0, overlapSec)
        })
        nextGates.forEach((gate) => {
          rampGate(gate, 1, overlapSec)
        })

        enginesRef.current = nextEngines
        engineGateRef.current = nextGates

        if (typeof window !== "undefined" && startupChunkFinalizeTimerRef.current != null) {
          window.clearTimeout(startupChunkFinalizeTimerRef.current)
        }
        if (typeof window !== "undefined") {
          startupChunkFinalizeTimerRef.current = window.setTimeout(() => {
            startupChunkFinalizeTimerRef.current = null
            previousEngines.forEach((engine) => {
              try {
                engine?.stop()
              } catch {}
            })
            previousEngines.forEach((engine) => {
              try {
                engine?.destroy()
              } catch {}
            })
            previousGates.forEach((gate) => {
              try {
                gate?.disconnect()
              } catch {}
            })
          }, Math.ceil(overlapSec * 1000) + 24)
        }
        return true
      } catch (error) {
        nextEngines.forEach((engine) => {
          try {
            engine.destroy()
          } catch {}
        })
        nextGates.forEach((gate) => {
          try {
            gate.disconnect()
          } catch {}
        })
        if (keepPlaying) {
          previousGates.forEach((gate) => {
            if (!gate) return
            rampGate(gate, 1, 0.02)
          })
        }
        logAudioDebug("startup_chunk:engine_swap_failed", {
          posSec: Number(safePosSec.toFixed(3)),
          reason: error instanceof Error ? error.message : "unknown engine swap error",
        })
        return false
      }
    },
    []
  )

  const performStartupChunkHandoff = useCallback(
    async (reason: string, targetPosSec?: number) => {
      const runtime = startupChunkRuntimeRef.current
      if (!runtime || !runtime.enabled || runtime.handoffComplete || runtime.handoffInProgress) {
        return false
      }
      runtime.handoffInProgress = true
      const requestedPosSec =
        typeof targetPosSec === "number" && Number.isFinite(targetPosSec) ? targetPosSec : positionSecRef.current
      const safePosSec = clamp(
        requestedPosSec,
        0,
        runtime.estimatedTotalDurationSec ?? runtime.fullBuffers?.[0]?.duration ?? requestedPosSec
      )

      let swapLabel = "handoff"
      let nextBuffers: AudioBuffer[] | null = null
      let sourceOffsetSec = 0
      let stageAfterSwap: StartupChunkRuntimeState["stage"] = runtime.stage
      let disableRuntimeAfterSwap = false
      const swapPlan = getStartupChunkSwapPlan(runtime, safePosSec)

      if (swapPlan) {
        swapLabel = swapPlan.swapLabel
        sourceOffsetSec = swapPlan.sourceOffsetSec
        stageAfterSwap = swapPlan.stageAfterSwap
        disableRuntimeAfterSwap = swapPlan.disableRuntimeAfterSwap
        if (swapPlan.swapLabel === "tail_handoff") {
          nextBuffers = runtime.tailBuffers
        } else {
          nextBuffers = runtime.fullBuffers
        }
      }

      if (!nextBuffers?.length) {
        runtime.handoffInProgress = false
        return false
      }

      logAudioDebug(`startup_chunk:${swapLabel}_begin`, {
        reason,
        posSec: Number(safePosSec.toFixed(3)),
        startupDurationSec: Number(runtime.startupDurationSec.toFixed(3)),
        tailStartSec: runtime.tailStartSec != null ? Number(runtime.tailStartSec.toFixed(3)) : null,
        tailDurationSec: runtime.tailDurationSec != null ? Number(runtime.tailDurationSec.toFixed(3)) : null,
        crossfadeSec: Number(runtime.crossfadeSec.toFixed(3)),
        overlapSec: Number(Math.max(STARTUP_CHUNK_HANDOFF_OVERLAP_SEC, runtime.crossfadeSec).toFixed(3)),
      })
      const swapped = replaceEnginesWithSoundTouchBuffers(nextBuffers, safePosSec, {
        keepPlaying: isPlayingRef.current,
        openRampSec: runtime.crossfadeSec,
        sourceOffsetSec,
        reportedDurationSec: runtime.estimatedTotalDurationSec ?? nextBuffers[0]?.duration ?? undefined,
      })
      runtime.handoffInProgress = false
      if (!swapped) {
        logAudioDebug(`startup_chunk:${swapLabel}_failed`, {
          reason,
          posSec: Number(safePosSec.toFixed(3)),
        })
        return false
      }

      runtime.stage = stageAfterSwap
      runtime.handoffComplete = disableRuntimeAfterSwap
      runtime.enabled = !disableRuntimeAfterSwap
      const nextDurationSec = runtime.estimatedTotalDurationSec ?? nextBuffers[0]?.duration ?? 0
      if (nextDurationSec > 0) {
        setDuration(nextDurationSec)
      }
      logAudioDebug(`startup_chunk:${swapLabel}_ready`, {
        reason,
        posSec: Number(safePosSec.toFixed(3)),
        durationSec: Number(nextDurationSec.toFixed(3)),
        stage: stageAfterSwap,
        overlapSec: Number(Math.max(STARTUP_CHUNK_HANDOFF_OVERLAP_SEC, runtime.crossfadeSec).toFixed(3)),
      })
      if (disableRuntimeAfterSwap && !runtime.deferredPeaksScheduled) {
        runtime.deferredPeaksScheduled = true
        const deferredDelayMs = isPlayingRef.current ? DEFERRED_PEAKS_STARTUP_CHUNK_POST_HANDOFF_DELAY_MS : DEFERRED_PEAKS_IDLE_DELAY_MS
        deferredPeaksSchedulerRef.current(deferredDelayMs)
        logAudioDebug("startup_chunk:deferred_peaks_resume", {
          reason,
          delayMs: deferredDelayMs,
        })
      }
      return true
    },
    [replaceEnginesWithSoundTouchBuffers]
  )

  useEffect(() => {
    // New track set must start from a clean transport state.
    const previousScope = activeTrackScopeRef.current
    if (previousScope === trackScopeId) return
    activeTrackScopeRef.current = trackScopeId
    readyRef.current = false
    if (pendingRafRef.current != null) {
      cancelAnimationFrame(pendingRafRef.current)
      pendingRafRef.current = null
    }
    pendingLastFrameMsRef.current = 0
    pendingPlayRef.current = false
    pendingStartPositionRef.current = 0
    forceZeroStartRef.current = true
    playStartGuardRef.current = null
    firstFrameProbeArmedRef.current = false
    abortAudioTtfpAttempt("track_scope_switch")
    if (typeof window !== "undefined") {
      for (const timerId of gateWarmupTimersRef.current) {
        window.clearTimeout(timerId)
      }
      gateWarmupTimersRef.current = []
    }
    clearSmoothSeekTimers()
    clearPendingPlayWatchdog()
    cancelDeferredPeaksIdleCallback()
    if (typeof window !== "undefined" && startupChunkFinalizeTimerRef.current != null) {
      window.clearTimeout(startupChunkFinalizeTimerRef.current)
      startupChunkFinalizeTimerRef.current = null
    }
    resetAudioDebugCaptureStore()
    startupChunkRuntimeRef.current = null
    waveformSourceBuffersRef.current = []
    setMainPlayPending(false)
    setMainPlayingState(false)
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // Do not force-close gates during scope switch; disposed graph/engines are enough to silence.
    // Closing to 0 here occasionally leaves next start in muted state on Safari.
    stopEnginesHard({ muteGates: false })
    disposeTrackAudioGraph()
    positionSecRef.current = 0
    setCurrentTime(0)
    logAudioDebug("switch:reset_position", {
      from: previousScope,
      to: trackScopeId,
      positionSec: 0,
    })

    peaksRef.current = trackList.map(() => null)
    waveCanvasesRef.current = trackList.map(() => null)

    setMuted(trackList.map(() => false))
    setSolo(trackList.map(() => false))
    setPanUI(trackList.map(() => 0))
    setVolUI(initialTrackVolumes)

    // Restore FX defaults only when switching to another track set.
    // Loop/repeat of the same track does not change trackScopeId, so manual values stay intact.
    setReverbAmount(DEFAULT_REVERB_AMOUNT)
    setSpeed(DEFAULT_SPEED)
    tempoRef.current = DEFAULT_SPEED
    setPitchSemi(DEFAULT_PITCH_SEMITONES)
    pitchSemiRef.current = DEFAULT_PITCH_SEMITONES
    cancelTempoPitchSmoothing()
    applyTempoPitchToEngines(DEFAULT_SPEED, DEFAULT_PITCH_SEMITONES)
  }, [
    abortAudioTtfpAttempt,
    applyTempoPitchToEngines,
    cancelTempoPitchSmoothing,
    disposeTrackAudioGraph,
    initialTrackVolumes,
    setMainPlayingState,
    stopEnginesHard,
    trackList,
    trackScopeId,
  ])

  useEffect(() => {
    if (activeEngineMode !== "appendable_queue_worklet") return
    if (appendablePilotActivation.activationMode !== "safe_rollout") return
    if (tempoRef.current === DEFAULT_SPEED && pitchSemiRef.current === DEFAULT_PITCH_SEMITONES) return
    setSpeed(DEFAULT_SPEED)
    tempoRef.current = DEFAULT_SPEED
    setPitchSemi(DEFAULT_PITCH_SEMITONES)
    pitchSemiRef.current = DEFAULT_PITCH_SEMITONES
    cancelTempoPitchSmoothing()
    applyTempoPitchToEngines(DEFAULT_SPEED, DEFAULT_PITCH_SEMITONES)
  }, [
    activeEngineMode,
    appendablePilotActivation.activationMode,
    applyTempoPitchToEngines,
    cancelTempoPitchSmoothing,
  ])

  /** =========================
   *  APPLY UI -> AUDIO (with smoothing)
   *  ========================= */
  useEffect(() => {
    if (calibrationMutedRef.current) return
    const target = (guestSoloMode ? 0 : clamp(masterVol, 0, 1)) * MASTER_HEADROOM_GAIN
    rampGainTo(masterGainRef.current, target, 0.05)
  }, [masterVol, guestSoloMode])

  useEffect(() => {
    if (!wetGainRef.current || !dryGainRef.current) return
    rampGainTo(wetGainRef.current, reverbAmount, 0.05)
    rampGainTo(dryGainRef.current, 1 - reverbAmount, 0.05)
  }, [reverbAmount])

  const applyMuteSoloVolume = (m: boolean[], s: boolean[], v: number[]) => {
    const anySolo = s.some(Boolean)
    trackGainRef.current.forEach((g, i) => {
      if (!g) return
      const base = clamp(v[i] ?? 1, 0, TRACK_MAX_GAIN) * TRACK_HEADROOM_GAIN
      const factor = anySolo ? (s[i] ? 1 : 0) : (m[i] ? 0 : 1)
      rampGainTo(g, base * factor, 0.035)
    })
  }

  const applyPan = (p: number[]) => {
    panRef.current.forEach((node, i) => {
      if (!node) return
      node.pan.value = p[i] ?? 0
    })
  }

  /** =========================
   *  ACTIVE TRACK (highlight)
   *  ========================= */
  const isTrackAudible = (i: number) => {
    const anySolo = solo.some(Boolean)
    if (anySolo) return !!solo[i]
    return !muted[i]
  }

  const selectedSoloTrackIndex = useMemo(() => {
    const indexes = solo
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0)
    return indexes.length === 1 ? indexes[0] : -1
  }, [solo])

  useEffect(() => {
    if (!referenceLockEnabled) return
    if (recordReferenceIndex == null && selectedSoloTrackIndex >= 0) {
      setRecordReferenceIndex(selectedSoloTrackIndex)
    }
  }, [recordReferenceIndex, referenceLockEnabled, selectedSoloTrackIndex])

  /** =========================
   *  ENGINE CONTROL
   *  ========================= */
  const getActiveAppendableQueueCoordinator = () =>
    activeEngineMode === "appendable_queue_worklet" && enginesRef.current.length > 1
      ? appendableQueueCoordinatorRef.current
      : null

  const startEngines = () => {
    markAudioTtfpStage("engines_start")
    // Safari/WebKit occasionally keeps gate automation pinned at 0 during track switch.
    // Open gates immediately on start to avoid "playing but silent" first seconds.
    setEngineGateTarget(1, { immediate: true, rampSec: 0 })
    markAudioTtfpStage("gate_open")
    const coordinator = getActiveAppendableQueueCoordinator()
    if (coordinator) {
      coordinator.start()
      return
    }
    enginesRef.current.forEach((eng) => {
      try {
        eng?.start()
      } catch {}
    })
  }

  /** =========================
   *  ANIMATION + END-OF-TRACK RESET
   *  ========================= */
  const animate = () => {
    if (!isPlayingRef.current) return
    const e0 = enginesRef.current[0]
    if (!e0) return

    const pos = e0.getSourcePositionSeconds()
    if (firstFrameProbeArmedRef.current) {
      firstFrameProbeArmedRef.current = false
      const startGuard = playStartGuardRef.current
      logAudioDebug("play:first_frame_probe", {
        posSec: Number(pos.toFixed(3)),
        requestedSec: startGuard ? Number(startGuard.requestedSec.toFixed(3)) : null,
      })
    }
    const startupRuntime = startupChunkRuntimeRef.current
    if (
      startupRuntime?.enabled &&
      !startupRuntime.handoffComplete &&
      !startupRuntime.handoffInProgress
    ) {
      const handoffAtSec =
        startupRuntime.strategy === "splice"
          ? startupRuntime.stage === "startup"
            ? getStartupChunkTailHandoffAtSec(startupRuntime)
            : getStartupChunkFullHandoffAtSec(startupRuntime)
          : getStartupChunkHandoffAtSec(startupRuntime)
      if (pos >= handoffAtSec) {
        void performStartupChunkHandoff("playback_threshold", pos)
      }
    }
    const shouldLoop = loopOnRef.current

    // End of track.
    if (duration > 0 && pos >= duration - 0.01) {
      // During active recording, hard-stop recording exactly at main-track boundary.
      if (recording) {
        stopGuestRecording()
        return
      }
      // Stop playback.
      setMainPlayingState(false)
      stopEnginesHard({ muteGates: !shouldLoop })
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null

      // Move cursor to start.
      positionSecRef.current = 0
      setCurrentTime(0)
      const appendableCoordinator = getActiveAppendableQueueCoordinator()
      if (appendableCoordinator) appendableCoordinator.seekSeconds(0)
      else enginesRef.current.forEach((eng) => eng?.seekSeconds(0))

      // If loopOn is enabled, restart.
      if (shouldLoop) {
        emitMiniPlayerTelemetry({
          controllerId: globalControllerIdRef.current,
          action: "track_loop_restart",
          endStreamReason: "loop_restart",
          playing: true,
          currentSec: 0,
          durationSec: duration,
          loopOn: true,
          route: typeof window !== "undefined" ? window.location.pathname : "",
          locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : "",
        })
        // No extra delay needed, start immediately.
        setMainPlayingState(true)
        startEngines()
        logAudioDebug("loop:restart_gain_snapshot", {
          master: masterGainRef.current?.gain.value ?? null,
          gates: engineGateRef.current.map((g) => (g ? Number(g.gain.value.toFixed(4)) : null)),
          tracks: trackGainRef.current.map((g) => (g ? Number(g.gain.value.toFixed(4)) : null)),
        })
        rafRef.current = requestAnimationFrame(animate)
      } else {
        emitMiniPlayerTelemetry({
          controllerId: globalControllerIdRef.current,
          action: "track_end",
          endStreamReason: "track_ended",
          playing: false,
          currentSec: duration,
          durationSec: duration,
          loopOn: false,
          route: typeof window !== "undefined" ? window.location.pathname : "",
          locale: typeof document !== "undefined" ? document.documentElement.lang?.slice(0, 2) : "",
        })
        if (registerGlobalAudio) clearGlobalAudio(globalControllerIdRef.current)
      }
      return
    }

    if (isScrubbingRef.current) {
      const previewPos = scrubPreviewPositionRef.current
      if (typeof previewPos === "number" && Number.isFinite(previewPos)) {
        positionSecRef.current = previewPos
        setCurrentTime(previewPos)
      }
      rafRef.current = requestAnimationFrame(animate)
      return
    }

    positionSecRef.current = pos
    setCurrentTime(pos)
    rafRef.current = requestAnimationFrame(animate)
  }

  const redrawTrackWaveforms = useCallback(() => {
    if (!waveReady) return
    const p = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0
    for (let i = 0; i < trackList.length; i++) {
      const canvas = waveCanvasesRef.current[i]
      const peaks = peaksRef.current[i]
      if (canvas && peaks) drawWaveform(canvas, peaks, p)
    }
  }, [currentTime, duration, trackList.length, waveReady])

  useEffect(() => {
    redrawTrackWaveforms()
  }, [redrawTrackWaveforms])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (ringbufferSharedTickWorkerRef.current) {
      ringbufferSharedTickWorkerRef.current.terminate()
      ringbufferSharedTickWorkerRef.current = null
    }
    if (ringbufferSharedTickTimerRef.current != null) {
      window.clearInterval(ringbufferSharedTickTimerRef.current)
      ringbufferSharedTickTimerRef.current = null
    }
    if (!isPlaying || activeEngineMode !== "ringbuffer_worklet") return

    const tickAll = () => {
      const ringbufferDebugStates = enginesRef.current
        .map((engine) => {
          const debugState = engine?.getDebugState?.()
          return debugState && typeof debugState === "object" ? debugState : null
        })
        .filter((value): value is Record<string, number | string | null | undefined> => !!value)
      const queueEstimateFrames = ringbufferDebugStates
        .map((state) => state.queueEstimateFrames)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const lowWaterFrames = ringbufferDebugStates
        .map((state) => state.lowWaterFrames)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const pushChunkFrames = ringbufferDebugStates
        .map((state) => state.pushChunkFrames)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const sharedMinQueueEstimateFrames = queueEstimateFrames.length ? Math.min(...queueEstimateFrames) : undefined
      const minLowWaterFrames = lowWaterFrames.length ? Math.min(...lowWaterFrames) : undefined
      const maxPushChunkFrames = pushChunkFrames.length ? Math.max(...pushChunkFrames) : undefined
      const tickPlan =
        typeof sharedMinQueueEstimateFrames === "number"
          ? {
              sharedMinQueueEstimateFrames,
              queueSlackFrames: typeof maxPushChunkFrames === "number" ? Math.floor(maxPushChunkFrames / 2) : undefined,
              chunkBudget:
                typeof minLowWaterFrames === "number" && sharedMinQueueEstimateFrames < minLowWaterFrames ? 2 : 1,
            }
          : undefined

      enginesRef.current.forEach((engine) => {
        try {
          engine?.tickPlayback?.(tickPlan)
        } catch {}
      })
    }

    tickAll()
    if (typeof Worker === "function") {
      try {
        const worker = new Worker("/workers/rr-ringbuffer-ticker.js")
        const handleMessage = (event: MessageEvent<{ type?: string }>) => {
          if (event.data?.type !== "tick") return
          tickAll()
        }
        worker.addEventListener("message", handleMessage)
        worker.postMessage({ type: "start", intervalMs: 20 })
        ringbufferSharedTickWorkerRef.current = worker
        logAudioDebug("ringbuffer:shared_tick_mode", {
          mode: "worker",
          intervalMs: 20,
        })
        return () => {
          worker.removeEventListener("message", handleMessage)
          worker.postMessage({ type: "stop" })
          worker.terminate()
          if (ringbufferSharedTickWorkerRef.current === worker) {
            ringbufferSharedTickWorkerRef.current = null
          }
          if (ringbufferSharedTickTimerRef.current != null) {
            window.clearInterval(ringbufferSharedTickTimerRef.current)
            ringbufferSharedTickTimerRef.current = null
          }
        }
      } catch (error) {
        logAudioDebug("ringbuffer:shared_tick_mode", {
          mode: "timer_fallback",
          intervalMs: 20,
          reason: error instanceof Error ? error.message : "worker init failed",
        })
      }
    } else {
      logAudioDebug("ringbuffer:shared_tick_mode", {
        mode: "timer_fallback",
        intervalMs: 20,
        reason: "worker unsupported",
      })
    }

    ringbufferSharedTickTimerRef.current = window.setInterval(tickAll, 20)
    return () => {
      if (ringbufferSharedTickWorkerRef.current) {
        ringbufferSharedTickWorkerRef.current.terminate()
        ringbufferSharedTickWorkerRef.current = null
      }
      if (ringbufferSharedTickTimerRef.current != null) {
        window.clearInterval(ringbufferSharedTickTimerRef.current)
        ringbufferSharedTickTimerRef.current = null
      }
    }
  }, [activeEngineMode, isPlaying])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (appendableQueueSharedTickWorkerRef.current) {
      appendableQueueSharedTickWorkerRef.current.terminate()
      appendableQueueSharedTickWorkerRef.current = null
    }
    if (appendableQueueSharedTickTimerRef.current != null) {
      window.clearInterval(appendableQueueSharedTickTimerRef.current)
      appendableQueueSharedTickTimerRef.current = null
    }
    const coordinator = appendableQueueCoordinatorRef.current
    if (!isPlaying || activeEngineMode !== "appendable_queue_worklet" || !coordinator || enginesRef.current.length <= 1) {
      return
    }

    const tickAll = () => {
      coordinator.tick({ force: coordinator.isPlaying() })
    }

    tickAll()
    if (typeof Worker === "function") {
      try {
        const worker = new Worker("/workers/rr-ringbuffer-ticker.js")
        const handleMessage = (event: MessageEvent<{ type?: string }>) => {
          if (event.data?.type !== "tick") return
          tickAll()
        }
        worker.addEventListener("message", handleMessage)
        worker.postMessage({ type: "start", intervalMs: 20 })
        appendableQueueSharedTickWorkerRef.current = worker
        logAudioDebug("appendable_queue:shared_tick_mode", {
          mode: "worker",
          intervalMs: 20,
          trackCount: enginesRef.current.length,
        })
        return () => {
          worker.removeEventListener("message", handleMessage)
          worker.postMessage({ type: "stop" })
          worker.terminate()
          if (appendableQueueSharedTickWorkerRef.current === worker) {
            appendableQueueSharedTickWorkerRef.current = null
          }
          if (appendableQueueSharedTickTimerRef.current != null) {
            window.clearInterval(appendableQueueSharedTickTimerRef.current)
            appendableQueueSharedTickTimerRef.current = null
          }
        }
      } catch (error) {
        logAudioDebug("appendable_queue:shared_tick_mode", {
          mode: "timer_fallback",
          intervalMs: 20,
          trackCount: enginesRef.current.length,
          reason: error instanceof Error ? error.message : "worker init failed",
        })
      }
    } else {
      logAudioDebug("appendable_queue:shared_tick_mode", {
        mode: "timer_fallback",
        intervalMs: 20,
        trackCount: enginesRef.current.length,
        reason: "worker unsupported",
      })
    }

    appendableQueueSharedTickTimerRef.current = window.setInterval(tickAll, 20)
    return () => {
      if (appendableQueueSharedTickWorkerRef.current) {
        appendableQueueSharedTickWorkerRef.current.terminate()
        appendableQueueSharedTickWorkerRef.current = null
      }
      if (appendableQueueSharedTickTimerRef.current != null) {
        window.clearInterval(appendableQueueSharedTickTimerRef.current)
        appendableQueueSharedTickTimerRef.current = null
      }
    }
  }, [activeEngineMode, isPlaying])

  const commitAppendableRouteVisibilitySnapshot = useCallback((snapshot: AppendableRouteVisibilitySnapshot) => {
    appendableRouteVisibilitySnapshotRef.current = snapshot
    setAppendableRouteVisibilitySnapshot(snapshot)
  }, [])

  const recordAppendableRouteVisibilityEvent = useCallback(
    (
      event: "window:blur" | "window:focus" | "window:pagehide" | "window:pageshow" | "document:visibility",
      options?: { persistReport?: boolean }
    ) => {
      if (typeof document === "undefined") return
      const visibilityState: AppendableRouteVisibilityState = document.visibilityState === "hidden" ? "hidden" : "visible"
      const persistedEvent: AppendableRouteVisibilityEvent =
        event === "document:visibility" ? `document:${visibilityState}` : event
      const current = appendableRouteVisibilitySnapshotRef.current
      const nextSnapshot: AppendableRouteVisibilitySnapshot = {
        currentState: visibilityState,
        lostForeground:
          current.lostForeground ||
          event === "window:blur" ||
          event === "window:pagehide" ||
          visibilityState === "hidden",
        blurCount: current.blurCount + (event === "window:blur" ? 1 : 0),
        focusCount: current.focusCount + (event === "window:focus" ? 1 : 0),
        pageHideCount: current.pageHideCount + (event === "window:pagehide" ? 1 : 0),
        pageShowCount: current.pageShowCount + (event === "window:pageshow" ? 1 : 0),
        visibilityHiddenCount: current.visibilityHiddenCount + (persistedEvent === "document:hidden" ? 1 : 0),
        visibilityVisibleCount: current.visibilityVisibleCount + (persistedEvent === "document:visible" ? 1 : 0),
        hiddenWhilePlayingCount:
          current.hiddenWhilePlayingCount + (persistedEvent === "document:hidden" && isPlayingRef.current ? 1 : 0),
        focusWhilePlayingCount:
          current.focusWhilePlayingCount +
          ((event === "window:focus" || event === "window:pageshow") && isPlayingRef.current ? 1 : 0),
        lastEvent: persistedEvent,
        lastEventAt: new Date().toISOString(),
      }
      commitAppendableRouteVisibilitySnapshot(nextSnapshot)
      logAudioDebug("audio:focus_state", {
        event: persistedEvent,
        currentSec: Number(positionSecRef.current.toFixed(3)),
        visibilityState,
        playing: isPlayingRef.current,
        mode: activeEngineMode,
      })
      const canPersistLifecycleReport =
        event === "window:pagehide" ||
        appendableRoutePilotReportHydratedStorageKey === appendableRoutePilotReportStorageKey
      if (options?.persistReport && canPersistLifecycleReport) {
        const nextReport = buildAppendableRoutePilotReportWithSnapshot(buildAppendableRoutePilotSnapshot(nextSnapshot), {
          autoStatus: true,
        })
        commitAppendableRoutePilotReport(nextReport)
        persistAppendableRoutePilotReportToStorage(nextReport)
      }
    },
    [
      activeEngineMode,
      buildAppendableRoutePilotReportWithSnapshot,
      buildAppendableRoutePilotSnapshot,
      appendableRoutePilotReportHydratedStorageKey,
      appendableRoutePilotReportStorageKey,
      commitAppendableRoutePilotReport,
      commitAppendableRouteVisibilitySnapshot,
      persistAppendableRoutePilotReportToStorage,
    ]
  )

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return

    const handleBlur = () => {
      recordAppendableRouteVisibilityEvent("window:blur")
    }

    const handleFocus = () => {
      recordAppendableRouteVisibilityEvent("window:focus")
    }

    const handlePageHide = () => {
      recordAppendableRouteVisibilityEvent("window:pagehide", { persistReport: true })
    }

    const handlePageShow = () => {
      recordAppendableRouteVisibilityEvent("window:pageshow", { persistReport: true })
    }

    const handleVisibilityChange = () => {
      recordAppendableRouteVisibilityEvent("document:visibility")
    }

    commitAppendableRouteVisibilitySnapshot({
      ...appendableRouteVisibilitySnapshotRef.current,
      currentState: document.visibilityState === "hidden" ? "hidden" : "visible",
    })
    if (!appendableRouteVisibilityInitialPageShowRecordedRef.current) {
      appendableRouteVisibilityInitialPageShowRecordedRef.current = true
      recordAppendableRouteVisibilityEvent("window:pageshow", { persistReport: true })
    }
    window.addEventListener("blur", handleBlur)
    window.addEventListener("focus", handleFocus)
    window.addEventListener("pagehide", handlePageHide)
    window.addEventListener("pageshow", handlePageShow)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("blur", handleBlur)
      window.removeEventListener("focus", handleFocus)
      window.removeEventListener("pagehide", handlePageHide)
      window.removeEventListener("pageshow", handlePageShow)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [commitAppendableRouteVisibilitySnapshot, recordAppendableRouteVisibilityEvent])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!isPlaying || activeEngineMode !== "ringbuffer_worklet") {
      if (ringbufferRuntimeProbeTimerRef.current != null) {
        window.clearInterval(ringbufferRuntimeProbeTimerRef.current)
        ringbufferRuntimeProbeTimerRef.current = null
      }
      ringbufferRuntimeProbeLastLogAtMsRef.current = 0
      ringbufferRuntimeProbeLastMinBufferedSecRef.current = null
      return
    }

    const sample = () => {
      const ringbufferDebugStates = enginesRef.current
        .map((engine) => {
          const debugState = engine?.getDebugState?.()
          return debugState && typeof debugState === "object" ? debugState : null
        })
        .filter((value): value is Record<string, number | string | null | undefined> => !!value)
      const bufferedSecs = enginesRef.current
        .map((engine) => engine?.getBufferedSeconds?.())
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      if (!bufferedSecs.length) return

      const minBufferedSec = Math.min(...bufferedSecs)
      const maxBufferedSec = Math.max(...bufferedSecs)
      const avgBufferedSec = bufferedSecs.reduce((sum, value) => sum + value, 0) / bufferedSecs.length
      const queueEstimateSecs = ringbufferDebugStates
        .map((state) => state.queueEstimateSec)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const queueEstimateFrames = ringbufferDebugStates
        .map((state) => state.queueEstimateFrames)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const refillCounts = ringbufferDebugStates
        .map((state) => state.refillCount)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const pushCounts = ringbufferDebugStates
        .map((state) => state.pushCount)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const sourceCursorSecs = ringbufferDebugStates
        .map((state) => state.sourceFrameCursorSec)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const pushChunkSecs = ringbufferDebugStates
        .map((state) => state.pushChunkSec)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const refillTriggerSecs = ringbufferDebugStates
        .map((state) => state.refillTriggerSec)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const highWaterSecs = ringbufferDebugStates
        .map((state) => state.highWaterSec)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const readWrapCounts = ringbufferDebugStates
        .map((state) => state.readWrapCount)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const writeWrapCounts = ringbufferDebugStates
        .map((state) => state.writeWrapCount)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const readWrapDeltaMaxes = ringbufferDebugStates
        .map((state) => state.lastReadWrapDeltaMax)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      const nowMs = readAudioPerfNowMs()
      const lastLogAtMs = ringbufferRuntimeProbeLastLogAtMsRef.current
      const lastMinBufferedSec = ringbufferRuntimeProbeLastMinBufferedSecRef.current
      const dropDeltaSec =
        typeof lastMinBufferedSec === "number" ? Math.max(0, lastMinBufferedSec - minBufferedSec) : 0
      const dueHeartbeat = lastLogAtMs === 0 || nowMs - lastLogAtMs >= RINGBUFFER_RUNTIME_PROBE_LOG_INTERVAL_MS
      const notableDrop = dropDeltaSec >= RINGBUFFER_RUNTIME_PROBE_DROP_DELTA_SEC

      if (dueHeartbeat || notableDrop) {
        ringbufferRuntimeProbeLastLogAtMsRef.current = nowMs
        logAudioDebug("ringbuffer:runtime_probe", {
          currentSec: Number(positionSecRef.current.toFixed(3)),
          minBufferedSec: Number(minBufferedSec.toFixed(3)),
          maxBufferedSec: Number(maxBufferedSec.toFixed(3)),
          avgBufferedSec: Number(avgBufferedSec.toFixed(3)),
          dropDeltaSec: Number(dropDeltaSec.toFixed(3)),
          minQueueEstimateSec: queueEstimateSecs.length ? Number(Math.min(...queueEstimateSecs).toFixed(3)) : null,
          maxQueueEstimateSec: queueEstimateSecs.length ? Number(Math.max(...queueEstimateSecs).toFixed(3)) : null,
          minQueueEstimateFrames: queueEstimateFrames.length ? Math.min(...queueEstimateFrames) : null,
          maxQueueEstimateFrames: queueEstimateFrames.length ? Math.max(...queueEstimateFrames) : null,
          refillCounts,
          pushCounts,
          sourceCursorSecs,
          pushChunkSecs,
          refillTriggerSecs,
          highWaterSecs,
          readWrapCounts,
          writeWrapCounts,
          readWrapDeltaMaxes,
          gates: engineGateRef.current.map((g) => (g ? Number(g.gain.value.toFixed(4)) : null)),
        })
      }

      ringbufferRuntimeProbeLastMinBufferedSecRef.current = minBufferedSec
    }

    sample()
    ringbufferRuntimeProbeTimerRef.current = window.setInterval(sample, RINGBUFFER_RUNTIME_PROBE_INTERVAL_MS)

    return () => {
      if (ringbufferRuntimeProbeTimerRef.current != null) {
        window.clearInterval(ringbufferRuntimeProbeTimerRef.current)
        ringbufferRuntimeProbeTimerRef.current = null
      }
    }
  }, [activeEngineMode, isPlaying])

  useEffect(() => {
    if (typeof window === "undefined") return
    const coordinator = appendableQueueCoordinatorRef.current
    if (!isPlaying || activeEngineMode !== "appendable_queue_worklet" || !coordinator || enginesRef.current.length <= 1) {
      if (appendableQueueRuntimeProbeTimerRef.current != null) {
        window.clearInterval(appendableQueueRuntimeProbeTimerRef.current)
        appendableQueueRuntimeProbeTimerRef.current = null
      }
      appendableQueueRuntimeProbeLastLogAtMsRef.current = 0
      appendableQueueRuntimeProbeLastMinLeadSecRef.current = null
      appendableQueueRuntimeProbeCleanSinceMsRef.current = null
      setAppendableQueueRuntimeProbeSnapshot((current) =>
        current.active || current.sampleAtMs != null ? createAppendableQueueRuntimeProbeSnapshot() : current
      )
      return
    }

    const sample = () => {
      const snapshot = coordinator.getSnapshot()
      const debugStates = enginesRef.current
        .map((engine) => {
          const debugState = engine?.getDebugState?.()
          return debugState && typeof debugState === "object" ? debugState : null
        })
        .filter((value): value is Record<string, number | string | boolean | null | undefined> => !!value)
      const dataPlaneModes = Array.from(
        new Set(
          debugStates
            .map((state) => state.dataPlaneMode)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        )
      )
      const controlPlaneModes = Array.from(
        new Set(
          debugStates
            .map((state) => state.controlPlaneMode)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        )
      )
      const preferredDataPlaneModes = Array.from(
        new Set(
          debugStates
            .map((state) => state.preferredDataPlaneMode)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        )
      )
      const sabCapabilities = Array.from(
        new Set(debugStates.map((state) => readOptionalBoolean(state.sabCapable)).filter((value): value is boolean => value != null))
      )
      const sabReadyStates = Array.from(
        new Set(debugStates.map((state) => readOptionalBoolean(state.sabReady)).filter((value): value is boolean => value != null))
      )
      const crossOriginIsolatedStates = Array.from(
        new Set(
          debugStates
            .map((state) => readOptionalBoolean(state.crossOriginIsolated))
            .filter((value): value is boolean => value != null)
        )
      )
      const supportsTempoStates = Array.from(
        new Set(debugStates.map((state) => readOptionalBoolean(state.supportsTempo)).filter((value): value is boolean => value != null))
      )
      const supportsIndependentPitchStates = Array.from(
        new Set(
          debugStates
            .map((state) => readOptionalBoolean(state.supportsIndependentPitch))
            .filter((value): value is boolean => value != null)
        )
      )
      const tempoStates = Array.from(
        new Set(
          debugStates
            .map((state) => readOptionalFiniteNumber(state.tempo))
            .filter((value): value is number => value != null)
            .map((value) => Number(value.toFixed(3)))
        )
      )
      const pitchSemitoneStates = Array.from(
        new Set(
          debugStates
            .map((state) => readOptionalFiniteNumber(state.pitchSemitones))
            .filter((value): value is number => value != null)
            .map((value) => Number(value.toFixed(3)))
        )
      )
      const sabRequirements = Array.from(
        new Set(
          debugStates
            .map((state) => state.sabRequirement)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        )
      )
      const sampleRates = Array.from(
        new Set(
          debugStates
            .map((state) => state.sampleRate)
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
        )
      ).sort((a, b) => a - b)
      const appendMessageCount = debugStates.reduce(
        (sum, state) =>
          sum + (typeof state.appendMessageCount === "number" ? state.appendMessageCount : typeof state.appendCount === "number" ? state.appendCount : 0),
        0
      )
      const appendedBytes = debugStates.reduce(
        (sum, state) => sum + (typeof state.appendedBytes === "number" ? state.appendedBytes : 0),
        0
      )
      const minLeadSec = snapshot.sync.minLeadSec
      const nowMs = readAudioPerfNowMs()
      const lastLogAtMs = appendableQueueRuntimeProbeLastLogAtMsRef.current
      const lastMinLeadSec = appendableQueueRuntimeProbeLastMinLeadSecRef.current
      const dropDeltaSec =
        typeof lastMinLeadSec === "number" ? Math.max(0, lastMinLeadSec - minLeadSec) : 0
      const cleanRuntime =
        snapshot.sync.totalUnderrunFrames === 0 && snapshot.sync.totalDiscontinuityCount === 0
      if (cleanRuntime) {
        if (appendableQueueRuntimeProbeCleanSinceMsRef.current == null) {
          appendableQueueRuntimeProbeCleanSinceMsRef.current = nowMs
        }
      } else {
        appendableQueueRuntimeProbeCleanSinceMsRef.current = null
      }
      const cleanSoakSec =
        cleanRuntime && appendableQueueRuntimeProbeCleanSinceMsRef.current != null
          ? Math.max(0, (nowMs - appendableQueueRuntimeProbeCleanSinceMsRef.current) / 1000)
          : 0
      const dueHeartbeat = lastLogAtMs === 0 || nowMs - lastLogAtMs >= APPENDABLE_QUEUE_RUNTIME_PROBE_LOG_INTERVAL_MS
      const notableDrop = dropDeltaSec >= APPENDABLE_QUEUE_RUNTIME_PROBE_DROP_DELTA_SEC

      setAppendableQueueRuntimeProbeSnapshot({
        active: true,
        sampleAtMs: nowMs,
        currentSec: Number(positionSecRef.current.toFixed(3)),
        transportSec: snapshot.transportSec,
        supportsTempo:
          supportsTempoStates.length === 1 ? supportsTempoStates[0] : activeEngineCapabilities.supportsTempo,
        supportsIndependentPitch:
          supportsIndependentPitchStates.length === 1
            ? supportsIndependentPitchStates[0]
            : activeEngineCapabilities.supportsIndependentPitch,
        tempo: tempoStates.length === 1 ? tempoStates[0] : Number(tempoRef.current.toFixed(3)),
        pitchSemitones:
          pitchSemitoneStates.length === 1 ? pitchSemitoneStates[0] : Number(pitchSemiRef.current.toFixed(3)),
        dataPlaneMode:
          dataPlaneModes.length === 1 ? dataPlaneModes[0] : dataPlaneModes.length ? dataPlaneModes.join(",") : null,
        controlPlaneMode:
          controlPlaneModes.length === 1 ? controlPlaneModes[0] : controlPlaneModes.length ? controlPlaneModes.join(",") : null,
        preferredDataPlaneMode:
          preferredDataPlaneModes.length === 1
            ? preferredDataPlaneModes[0]
            : preferredDataPlaneModes.length
              ? preferredDataPlaneModes.join(",")
              : null,
        sabCapable: sabCapabilities.length === 1 ? sabCapabilities[0] : null,
        sabReady: sabReadyStates.length === 1 ? sabReadyStates[0] : null,
        crossOriginIsolated: crossOriginIsolatedStates.length === 1 ? crossOriginIsolatedStates[0] : null,
        sabRequirement: sabRequirements.length === 1 ? sabRequirements[0] : sabRequirements.length ? sabRequirements.join(",") : null,
        sampleRates,
        appendMessageCount,
        appendedMiB: Number((appendedBytes / (1024 * 1024)).toFixed(3)),
        stemDriftSec: snapshot.sync.stemDriftSec,
        transportDriftSec: snapshot.sync.transportDriftSec,
        minLeadSec: Number(snapshot.sync.minLeadSec.toFixed(3)),
        maxLeadSec: Number(snapshot.sync.maxLeadSec.toFixed(3)),
        minObservedLeadSec: Number(snapshot.sync.minObservedLeadSec.toFixed(3)),
        maxObservedLeadSec: Number(snapshot.sync.maxObservedLeadSec.toFixed(3)),
        minLowWaterSec: Number(snapshot.sync.minLowWaterSec.toFixed(3)),
        maxHighWaterSec: Number(snapshot.sync.maxHighWaterSec.toFixed(3)),
        minRefillTriggerSec: Number(snapshot.sync.minRefillTriggerSec.toFixed(3)),
        dropDeltaSec: Number(dropDeltaSec.toFixed(3)),
        cleanSoakSec: Number(cleanSoakSec.toFixed(3)),
        readyThresholdSec: APPENDABLE_QUEUE_RUNTIME_READY_SOAK_SEC,
        totalUnderrunFrames: snapshot.sync.totalUnderrunFrames,
        totalDiscontinuityCount: snapshot.sync.totalDiscontinuityCount,
        totalLowWaterBreachCount: snapshot.sync.totalLowWaterBreachCount,
        totalHighWaterBreachCount: snapshot.sync.totalHighWaterBreachCount,
        totalOverflowDropCount: snapshot.sync.totalOverflowDropCount,
        totalOverflowDroppedFrames: snapshot.sync.totalOverflowDroppedFrames,
      })

      if (dueHeartbeat || notableDrop) {
        appendableQueueRuntimeProbeLastLogAtMsRef.current = nowMs
        logAudioDebug("appendable_queue:runtime_probe", {
          currentSec: Number(positionSecRef.current.toFixed(3)),
          transportSec: snapshot.transportSec,
          stemDriftSec: snapshot.sync.stemDriftSec,
          transportDriftSec: snapshot.sync.transportDriftSec,
          dataPlaneMode: dataPlaneModes.length === 1 ? dataPlaneModes[0] : dataPlaneModes,
          controlPlaneMode: controlPlaneModes.length === 1 ? controlPlaneModes[0] : controlPlaneModes,
          preferredDataPlaneMode:
            preferredDataPlaneModes.length === 1 ? preferredDataPlaneModes[0] : preferredDataPlaneModes,
          sabCapable: sabCapabilities.length === 1 ? sabCapabilities[0] : sabCapabilities,
          sabReady: sabReadyStates.length === 1 ? sabReadyStates[0] : sabReadyStates,
          crossOriginIsolated:
            crossOriginIsolatedStates.length === 1 ? crossOriginIsolatedStates[0] : crossOriginIsolatedStates,
          sabRequirement: sabRequirements.length === 1 ? sabRequirements[0] : sabRequirements,
          sampleRates,
          appendMessageCount,
          appendedMiB: Number((appendedBytes / (1024 * 1024)).toFixed(3)),
          minLeadSec: Number(snapshot.sync.minLeadSec.toFixed(3)),
          maxLeadSec: Number(snapshot.sync.maxLeadSec.toFixed(3)),
          minObservedLeadSec: Number(snapshot.sync.minObservedLeadSec.toFixed(3)),
          maxObservedLeadSec: Number(snapshot.sync.maxObservedLeadSec.toFixed(3)),
          minLowWaterSec: Number(snapshot.sync.minLowWaterSec.toFixed(3)),
          maxHighWaterSec: Number(snapshot.sync.maxHighWaterSec.toFixed(3)),
          minRefillTriggerSec: Number(snapshot.sync.minRefillTriggerSec.toFixed(3)),
          dropDeltaSec: Number(dropDeltaSec.toFixed(3)),
          cleanSoakSec: Number(cleanSoakSec.toFixed(3)),
          readyThresholdSec: APPENDABLE_QUEUE_RUNTIME_READY_SOAK_SEC,
          totalUnderrunFrames: snapshot.sync.totalUnderrunFrames,
          totalDiscontinuityCount: snapshot.sync.totalDiscontinuityCount,
          totalLowWaterBreachCount: snapshot.sync.totalLowWaterBreachCount,
          totalHighWaterBreachCount: snapshot.sync.totalHighWaterBreachCount,
          totalOverflowDropCount: snapshot.sync.totalOverflowDropCount,
          totalOverflowDroppedFrames: snapshot.sync.totalOverflowDroppedFrames,
          availableFrames: debugStates.map((state) => state.availableFrames).filter((value) => typeof value === "number"),
          appendCounts: debugStates.map((state) => state.appendCount).filter((value) => typeof value === "number"),
          generations: debugStates.map((state) => state.generation).filter((value) => typeof value === "number"),
          bufferLeadSecs: debugStates.map((state) => state.bufferLeadSec).filter((value) => typeof value === "number"),
          gates: engineGateRef.current.map((g) => (g ? Number(g.gain.value.toFixed(4)) : null)),
        })
      }

      appendableQueueRuntimeProbeLastMinLeadSecRef.current = minLeadSec
    }

    sample()
    appendableQueueRuntimeProbeTimerRef.current = window.setInterval(sample, APPENDABLE_QUEUE_RUNTIME_PROBE_INTERVAL_MS)

    return () => {
      if (appendableQueueRuntimeProbeTimerRef.current != null) {
        window.clearInterval(appendableQueueRuntimeProbeTimerRef.current)
        appendableQueueRuntimeProbeTimerRef.current = null
      }
      appendableQueueRuntimeProbeCleanSinceMsRef.current = null
    }
  }, [
    activeEngineCapabilities.supportsIndependentPitch,
    activeEngineCapabilities.supportsTempo,
    activeEngineMode,
    isPlaying,
  ])

  useEffect(() => {
    if (typeof window === "undefined") return
    const coordinator = appendableQueueCoordinatorRef.current
    if (activeEngineMode !== "appendable_queue_worklet" || !coordinator) {
      if (appendableQueueSourceProgressTimerRef.current != null) {
        window.clearInterval(appendableQueueSourceProgressTimerRef.current)
        appendableQueueSourceProgressTimerRef.current = null
      }
      setAppendableQueueSourceProgressSnapshot(
        readAppendableQueueSourceProgressSnapshot(
          null,
          appendableStartupHeadRuntimeRef.current,
          appendableContinuationPreflightRef.current
        )
      )
      return
    }

    const sample = () => {
    setAppendableQueueSourceProgressSnapshot(
      readAppendableQueueSourceProgressSnapshot(
        coordinator,
        appendableStartupHeadRuntimeRef.current,
        appendableContinuationPreflightRef.current
      )
    )
    }

    sample()
    appendableQueueSourceProgressTimerRef.current = window.setInterval(sample, 350)

    return () => {
      if (appendableQueueSourceProgressTimerRef.current != null) {
        window.clearInterval(appendableQueueSourceProgressTimerRef.current)
        appendableQueueSourceProgressTimerRef.current = null
      }
    }
  }, [activeEngineMode, trackScopeId])

  useEffect(() => {
    if (!showDetailedSections) return
    if (typeof window === "undefined") return
    const rafId = window.requestAnimationFrame(() => {
      redrawTrackWaveforms()
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [redrawTrackWaveforms, showDetailedSections, trackScopeId])

  useEffect(() => {
    onTimeChange?.(currentTime)
  }, [currentTime, onTimeChange])

  useEffect(() => {
    let cancelled = false

    const loadTeleprompter = async () => {
      let hasLocalDraft = false
      setTeleprompterLoadState(effectiveTeleprompterSourceUrl ? "loading" : "idle")
      try {
        const draftState = parseTeleprompterDraftState(localStorage.getItem(teleprompterStateStorageKey))
        if (draftState?.lines.length) {
          setTeleprompterLines(draftState.lines)
          setTeleprompterDraftSavedAt(draftState.savedAt)
          hasLocalDraft = true
          setTeleprompterLoadState("ready")
        } else {
          const rawLocal = localStorage.getItem(teleprompterLinesStorageKey)
          const normalized = normalizeTeleprompterLines(rawLocal ? JSON.parse(rawLocal) : [])
          if (normalized.length > 0) {
            setTeleprompterLines(normalized)
            hasLocalDraft = true
            setTeleprompterLoadState("ready")
          }
        }
      } catch {}

      if (!effectiveTeleprompterSourceUrl) {
        if (!hasLocalDraft) setTeleprompterLines([])
        setTeleprompterLoadState(hasLocalDraft ? "ready" : "idle")
        return
      }

      try {
        const res = await fetch(effectiveTeleprompterSourceUrl)
        if (res.status === 404) {
          if (!hasLocalDraft) setTeleprompterLines([])
          setTeleprompterLoadState(hasLocalDraft ? "ready" : "missing")
          return
        }
        if (!res.ok) throw new Error(`Teleprompter fetch failed: ${effectiveTeleprompterSourceUrl}`)
        const base = normalizeTeleprompterLines((await res.json()) as TeleprompterLine[])
        if (cancelled) return

        if (!teleprompterExpandedText?.length) {
          setTeleprompterLines(base)
          setTeleprompterLoadState(base.length > 0 ? "ready" : "empty")
          return
        }

        const expanded: TeleprompterLine[] = []
        let textIdx = 0
        for (let i = 0; i < base.length; i++) {
          const curr = base[i]
          const next = base[i + 1]
          const halfStep = next ? Math.max((next.time - curr.time) / 2, 0.35) : 2.2
          const first = teleprompterExpandedText[textIdx] ?? curr.text
          const second = teleprompterExpandedText[textIdx + 1] ?? curr.text
          expanded.push({ time: curr.time, text: first })
          expanded.push({ time: curr.time + halfStep, text: second })
          textIdx += 2
        }

        setTeleprompterLines(expanded)
        setTeleprompterLoadState(expanded.length > 0 ? "ready" : "empty")
      } catch (e) {
        console.error("Teleprompter load error:", e)
        if (cancelled) return
        if (!hasLocalDraft) {
          setTeleprompterLines([])
          setTeleprompterLoadState("error")
        } else {
          setTeleprompterLoadState("ready")
        }
      }
    }

    void loadTeleprompter()

    return () => {
      cancelled = true
    }
  }, [effectiveTeleprompterSourceUrl, teleprompterExpandedText, teleprompterLinesStorageKey, teleprompterStateStorageKey])

  useEffect(() => {
    try {
      if (!teleprompterLines.length) {
        localStorage.removeItem(teleprompterLinesStorageKey)
      } else {
        localStorage.setItem(teleprompterLinesStorageKey, JSON.stringify(teleprompterLines))
      }
    } catch {}
  }, [teleprompterLines, teleprompterLinesStorageKey])

  useEffect(() => {
    if (!teleprompterAnchorStorageKey) return
    try {
      const draftState = parseTeleprompterDraftState(localStorage.getItem(teleprompterStateStorageKey))
      if (draftState) {
        setTeleprompterAnchors(draftState.anchors)
        return
      }
      const raw = localStorage.getItem(teleprompterAnchorStorageKey)
      const parsed = raw ? JSON.parse(raw) : null
      setTeleprompterAnchors(normalizeTeleprompterAnchors(parsed))
    } catch {
      setTeleprompterAnchors({})
    }
  }, [teleprompterAnchorStorageKey, teleprompterStateStorageKey])

  useEffect(() => {
    teleprompterAnchorsRef.current = teleprompterAnchors
  }, [teleprompterAnchors])

  useEffect(() => {
    if (!teleprompterAnchorStorageKey) return
    try {
      localStorage.setItem(teleprompterAnchorStorageKey, JSON.stringify(teleprompterAnchors))
    } catch {}
  }, [teleprompterAnchorStorageKey, teleprompterAnchors])

  useEffect(() => {
    if (!teleprompterTextStorageKey) return
    try {
      const draftState = parseTeleprompterDraftState(localStorage.getItem(teleprompterStateStorageKey))
      if (draftState) {
        setTeleprompterTextOverrides(draftState.textOverrides)
        return
      }
      const raw = localStorage.getItem(teleprompterTextStorageKey)
      const parsed = raw ? JSON.parse(raw) : null
      setTeleprompterTextOverrides(normalizeTeleprompterTextOverrides(parsed))
    } catch {
      setTeleprompterTextOverrides({})
    }
  }, [teleprompterStateStorageKey, teleprompterTextStorageKey])

  useEffect(() => {
    teleprompterTextOverridesRef.current = teleprompterTextOverrides
  }, [teleprompterTextOverrides])

  useEffect(() => {
    if (!teleprompterTextStorageKey) return
    try {
      localStorage.setItem(teleprompterTextStorageKey, JSON.stringify(teleprompterTextOverrides))
    } catch {}
  }, [teleprompterTextOverrides, teleprompterTextStorageKey])

  useEffect(() => {
    if (!teleprompterAutoCollectStorageKey) return
    if (!teleprompterAutoCollectAllowed) {
      setTeleprompterAutoCollect(false)
      try {
        localStorage.setItem(teleprompterAutoCollectStorageKey, "0")
      } catch {}
      teleprompterAutoCollectPrimedRef.current = false
      return
    }
    try {
      const raw = localStorage.getItem(teleprompterAutoCollectStorageKey)
      setTeleprompterAutoCollect(raw === "1")
    } catch {
      setTeleprompterAutoCollect(false)
    }
    teleprompterAutoCollectPrimedRef.current = false
  }, [teleprompterAutoCollectAllowed, teleprompterAutoCollectStorageKey])

  useEffect(() => {
    if (!teleprompterAutoCollectStorageKey) return
    if (!teleprompterAutoCollectAllowed) {
      try {
        localStorage.setItem(teleprompterAutoCollectStorageKey, "0")
      } catch {}
      return
    }
    try {
      localStorage.setItem(teleprompterAutoCollectStorageKey, teleprompterAutoCollect ? "1" : "0")
    } catch {}
  }, [teleprompterAutoCollect, teleprompterAutoCollectAllowed, teleprompterAutoCollectStorageKey])

  useEffect(() => {
    if (!teleprompterPreviewAutoSaveStorageKey) return
    try {
      const raw = localStorage.getItem(teleprompterPreviewAutoSaveStorageKey)
      setTeleprompterPreviewAutoSave(raw !== "0")
    } catch {
      setTeleprompterPreviewAutoSave(true)
    }
    teleprompterPreviewAutoSavePrimedRef.current = false
    teleprompterPreviewKnownSignatureRef.current = ""
  }, [teleprompterPreviewAutoSaveStorageKey])

  useEffect(() => {
    if (!teleprompterPreviewAutoSaveStorageKey) return
    try {
      localStorage.setItem(teleprompterPreviewAutoSaveStorageKey, teleprompterPreviewAutoSave ? "1" : "0")
    } catch {}
  }, [teleprompterPreviewAutoSave, teleprompterPreviewAutoSaveStorageKey])

  useEffect(() => {
    teleprompterLinesRef.current = teleprompterLines
  }, [teleprompterLines])

  useEffect(() => {
    teleprompterDraftDirtyRef.current = false
    setTeleprompterDraftDirty(false)
    setTeleprompterDraftSavedAt("")
    setTeleprompterBackupInfo("")
  }, [teleprompterStateStorageKey])

  const stopPendingTransport = useCallback(() => {
    if (pendingRafRef.current != null) {
      cancelAnimationFrame(pendingRafRef.current)
      pendingRafRef.current = null
    }
    pendingLastFrameMsRef.current = 0
  }, [])

  const clearGateWarmupTimers = useCallback(() => {
    if (typeof window === "undefined") return
    for (const timerId of gateWarmupTimersRef.current) {
      window.clearTimeout(timerId)
    }
    gateWarmupTimersRef.current = []
  }, [])

  const clearSmoothSeekTimers = useCallback(() => {
    if (typeof window === "undefined") return
    if (smoothSeekTimerRef.current != null) {
      window.clearTimeout(smoothSeekTimerRef.current)
      smoothSeekTimerRef.current = null
    }
    if (smoothSeekResumeGateTimerRef.current != null) {
      window.clearTimeout(smoothSeekResumeGateTimerRef.current)
      smoothSeekResumeGateTimerRef.current = null
    }
    pendingSmoothSeekSecRef.current = null
  }, [])

  const clearPendingPlayWatchdog = useCallback(() => {
    if (typeof window === "undefined") return
    if (pendingPlayWatchdogTimerRef.current != null) {
      window.clearTimeout(pendingPlayWatchdogTimerRef.current)
      pendingPlayWatchdogTimerRef.current = null
    }
  }, [])

  const cancelDeferredPeaksIdleCallback = useCallback(() => {
    if (typeof window === "undefined") return
    const idleId = deferredPeaksIdleCallbackRef.current
    if (idleId == null) return
    if (typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId)
    } else {
      window.clearTimeout(idleId)
    }
    deferredPeaksIdleCallbackRef.current = null
  }, [])

  const scheduleGateWarmup = useCallback((reason: string) => {
    if (typeof window === "undefined") return
    clearGateWarmupTimers()
    const delays = [0, 40, 120, 260, 520, 900]
    for (const delayMs of delays) {
      const timerId = window.setTimeout(() => {
        if (!isPlayingRef.current) return
        setEngineGateTarget(1, { immediate: true, rampSec: 0 })
        const gateValues = engineGateRef.current.map((g) => (g ? Number(g.gain.value) : null))
        const hasAnyGate = gateValues.some((value) => typeof value === "number" && Number.isFinite(value))
        const allNearZero = hasAnyGate && gateValues.every((value) => value == null || value <= 0.001)
        if (allNearZero) {
          logAudioDebug("gate:warmup_force_open", {
            reason,
            delayMs,
            gates: gateValues.map((value) => (typeof value === "number" ? Number(value.toFixed(4)) : null)),
          })
        }

        const startGuard = playStartGuardRef.current
        if (!startGuard || startGuard.corrected) return
        if (startGuard.requestedSec > 0.001) return
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now()
        const elapsedMs = nowMs - startGuard.startedAtMs
        // Only apply startup correction in the immediate warmup window.
        // Delayed timers after long main-thread stalls are not a valid signal.
        if (elapsedMs > 420) return
        const sourcePosSec = enginesRef.current[0]?.getSourcePositionSeconds?.() ?? null
        if (typeof sourcePosSec !== "number" || !Number.isFinite(sourcePosSec)) return
        const expectedPosSec = startGuard.requestedSec + elapsedMs / 1000
        const overshootSec = sourcePosSec - expectedPosSec
        // Correct only when source position jumped materially beyond expected progress.
        if (sourcePosSec < 0.35 || overshootSec < 0.45) return
        startGuard.corrected = true
        positionSecRef.current = 0
        setCurrentTime(0)
        const appendableCoordinator = getActiveAppendableQueueCoordinator()
        if (appendableCoordinator) appendableCoordinator.seekSeconds(0)
        else enginesRef.current.forEach((eng) => eng?.seekSeconds(0))
        logAudioDebug("play:start_position_corrected", {
          reason,
          delayMs,
          elapsedMs: Number(elapsedMs.toFixed(1)),
          expectedPosSec: Number(expectedPosSec.toFixed(3)),
          overshootSec: Number(overshootSec.toFixed(3)),
          observedPosSec: Number(sourcePosSec.toFixed(3)),
        })
      }, delayMs)
      gateWarmupTimersRef.current.push(timerId)
    }
  }, [clearGateWarmupTimers, setEngineGateTarget])

  const startPendingTransport = useCallback(() => {
    if (pendingRafRef.current != null) return
    const step = () => {
      if (!pendingPlayRef.current || readyRef.current || isPlayingRef.current) {
        stopPendingTransport()
        return
      }
      // Do not advance timeline while transport is pending.
      // Simulated progress during preload created a silent "intermediate" state
      // and visible jitter when real playback started.
      pendingRafRef.current = requestAnimationFrame(step)
    }
    pendingRafRef.current = requestAnimationFrame(step)
  }, [stopPendingTransport])

  useEffect(() => {
    if (typeof window === "undefined") return
    clearPendingPlayWatchdog()
    if (!mainPlayPending || isReady || isPlayingRef.current) return
    pendingPlayWatchdogTimerRef.current = window.setTimeout(() => {
      pendingPlayWatchdogTimerRef.current = null
      if (!pendingPlayRef.current || readyRef.current || isPlayingRef.current) return
      logAudioDebug("play:pending_ready_watchdog", {
        scope: trackScopeId,
        elapsedMs: PENDING_PLAY_READY_TIMEOUT_MS,
      })
      pendingPlayRef.current = false
      pendingStartPositionRef.current = null
      stopPendingTransport()
      setMainPlayPending(false)
      abortAudioTtfpAttempt("pending_ready_timeout")
    }, PENDING_PLAY_READY_TIMEOUT_MS)
    return () => {
      clearPendingPlayWatchdog()
    }
  }, [
    abortAudioTtfpAttempt,
    clearPendingPlayWatchdog,
    isReady,
    mainPlayPending,
    stopPendingTransport,
    trackScopeId,
  ])

  /** =========================
   *  TRANSPORT
   *  ========================= */
  const play = async (trigger = "auto") => {
    if (playInFlightRef.current) {
      // Coalesce duplicate play requests fired by multiple UI layers.
      // A second concurrent start can seek/restart on top of an active start
      // and manifests as intro swallow or "silent until next toggle".
      logAudioDebug("play:coalesced", { trigger })
      return
    }
    playInFlightRef.current = true
    try {
    if (isAudioTtfpEnabled()) {
      const active = audioTtfpAttemptRef.current
      if (!active || active.finalized || active.trackScopeId !== trackScopeId) {
        beginAudioTtfpAttempt(trigger)
      }
      markAudioTtfpStage("play_call")
    }

    const ctx = ctxRef.current
    if (!ctx || !readyRef.current) {
      if (ctx) {
        if (ctx.state !== "running") {
          try {
            await promiseWithTimeout(ctx.resume(), AUDIO_CTX_RESUME_TIMEOUT_MS, `ctx.resume ${trigger}`)
            markAudioTtfpStage("ctx_resumed", { primed: true })
          } catch (error) {
            logAudioDebug("audio:ctx_resume_timeout", {
              trigger,
              state: ctx.state,
              primed: true,
              reason: error instanceof Error ? error.message : "unknown ctx resume error",
            })
            stopPendingTransport()
            setMainPlayPending(false)
            pendingPlayRef.current = false
            pendingStartPositionRef.current = null
            abortAudioTtfpAttempt("ctx_resume_timeout")
            return
          }
        } else {
          void ctx.resume().catch(() => {})
        }
      }
      pendingPlayRef.current = true
      if (pendingStartPositionRef.current == null) {
        pendingStartPositionRef.current = positionSecRef.current
      }
      setMainPlayPending(true)
      startPendingTransport()
      return
    }
    stopPendingTransport()
    setMainPlayPending(false)
    pendingPlayRef.current = false
    const pendingPos = pendingStartPositionRef.current
    pendingStartPositionRef.current = null
    if (registerGlobalAudio && globalControllerRef.current) requestGlobalAudio(globalControllerRef.current)
    if (ctx.state !== "running") {
      try {
        await promiseWithTimeout(ctx.resume(), AUDIO_CTX_RESUME_TIMEOUT_MS, `ctx.resume ${trigger}`)
      } catch (error) {
        logAudioDebug("audio:ctx_resume_timeout", {
          trigger,
          state: ctx.state,
          primed: false,
          reason: error instanceof Error ? error.message : "unknown ctx resume error",
        })
        stopPendingTransport()
        setMainPlayPending(false)
        pendingPlayRef.current = false
        pendingStartPositionRef.current = null
        abortAudioTtfpAttempt("ctx_resume_timeout")
        return
      }
    } else {
      // Safari/WebKit can occasionally resolve resume() slowly even when already running.
      // Do not block play path in this state.
      void ctx.resume().catch(() => {})
    }
    clearPendingPlayWatchdog()
    markAudioTtfpStage("ctx_resumed")
    if (guestSoloMode) setGuestSoloMode(false)
    const masterTarget = clamp(masterVol, 0, 1) * MASTER_HEADROOM_GAIN
    // Restore main bus levels before start after an explicit hard stop.
    rampGainTo(masterGainRef.current, masterTarget, 0.02)
    rampGainTo(wetGainRef.current, reverbAmount, 0.03)
    rampGainTo(dryGainRef.current, 1 - reverbAmount, 0.03)

    // If we are at track end, restart from the beginning.
    const startPos = pendingPos != null ? pendingPos : positionSecRef.current
    const forceZeroStart = forceZeroStartRef.current
    forceZeroStartRef.current = false
    const atEnd = duration > 0 && startPos >= duration - 0.02
    const explicitRestartRequested = forceZeroStart || pendingPos != null || atEnd
    if (isPlayingRef.current && !explicitRestartRequested) {
      // If already running and no explicit seek/restart was requested,
      // keep transport untouched and just ensure gates stay open.
      setEngineGateTarget(1, { immediate: true, rampSec: 0 })
      scheduleGateWarmup(`${trigger}:already_playing`)
      markAudioTtfpStage("seek_applied", { posSec: Number(positionSecRef.current.toFixed(3)) })
      markAudioTtfpStage("engines_start")
      markAudioTtfpStage("gate_open")
      markAudioTtfpStage("playing_state")
      flushAudioTtfpAttempt("playing_state")
      logAudioDebug("play:noop_already_playing", {
        trigger,
        posSec: Number(positionSecRef.current.toFixed(3)),
      })
      return
    }
    const pos = forceZeroStart ? 0 : (atEnd ? 0 : clamp(startPos, 0, duration || startPos))
    const startupRuntime = startupChunkRuntimeRef.current
    if (
      startupRuntime?.enabled &&
      !startupRuntime.handoffComplete &&
      !startupRuntime.handoffInProgress
    ) {
      const handoffAtSec =
        startupRuntime.strategy === "splice"
          ? startupRuntime.stage === "startup"
            ? getStartupChunkTailHandoffAtSec(startupRuntime)
            : getStartupChunkFullHandoffAtSec(startupRuntime)
          : getStartupChunkHandoffAtSec(startupRuntime)
      if (pos >= handoffAtSec) {
        await performStartupChunkHandoff("play_prestart", pos)
      }
    }

    positionSecRef.current = pos
    setCurrentTime(pos)
    playStartGuardRef.current = {
      requestedSec: pos,
      startedAtMs: typeof performance !== "undefined" ? performance.now() : Date.now(),
      corrected: false,
    }
    firstFrameProbeArmedRef.current = true

    if (!isPlayingRef.current) stopEnginesHard({ muteGates: false })
    const appendableCoordinator = getActiveAppendableQueueCoordinator()
    if (appendableCoordinator) appendableCoordinator.seekSeconds(pos)
    else enginesRef.current.forEach((eng) => eng?.seekSeconds(pos))
    markAudioTtfpStage("seek_applied", { posSec: Number(pos.toFixed(3)) })
    const guestAudio = guestAudioRef.current
    const hasLinkedGuest = guestTransportLinkedRef.current && !!guestAudio && !!guestTrackUrl
    if (hasLinkedGuest && guestAudio) {
      await waitForGuestAudioReady(guestAudio)
      if (guestNeedsRecalibrateRef.current || !guestCalibrateReady) {
        await calibrateGuestDelay({ silent: true, keepPosition: true })
      }
      await seekGuestAudioForStart(pos)
      guardGuestStart()
    }

    startEngines()
    scheduleGateWarmup(trigger)
    if (typeof window !== "undefined") {
      // Recovery guard: in rare races gate automation may remain pinned at 0 after play.
      // Re-open gates once if they are still effectively muted shortly after start.
      window.setTimeout(() => {
        if (!isPlayingRef.current) return
        const gateValues = engineGateRef.current.map((g) => (g ? Number(g.gain.value) : null))
        const hasAnyGate = gateValues.some((value) => typeof value === "number" && Number.isFinite(value))
        const allNearZero = hasAnyGate && gateValues.every((value) => value == null || value <= 0.001)
        if (!allNearZero) return
        setEngineGateTarget(1, { immediate: true, rampSec: 0 })
        logAudioDebug("gate:force_open_recovery", {
          gates: gateValues.map((value) => (typeof value === "number" ? Number(value.toFixed(4)) : null)),
        })
      }, 50)
    }
    setMainPlayingState(true)
    markAudioTtfpStage("playing_state")
    flushAudioTtfpAttempt("playing_state")
    logAudioDebug("play:gain_snapshot", {
      master: masterGainRef.current?.gain.value ?? null,
      gates: engineGateRef.current.map((g) => (g ? Number(g.gain.value.toFixed(4)) : null)),
      tracks: trackGainRef.current.map((g) => (g ? Number(g.gain.value.toFixed(4)) : null)),
      guestSoloMode,
      guestLinked: guestTransportLinkedRef.current,
    })

    if (hasLinkedGuest && guestAudio) {
      void (async () => {
        try {
          await guestAudio.play()
        } catch {
          try {
            // Fallback for browsers that reject delayed unmuted autoplay after async setup.
            const targetMuted = guestMuted
            guestAudio.muted = true
            await guestAudio.play()
            guestAudio.muted = targetMuted
          } catch {
            setRecordError(t.guestStartSyncFailed)
          }
        }
      })()
      ;[40, 140, 280].forEach((delayMs) => {
        window.setTimeout(() => {
          if (!guestTransportLinkedRef.current || !isPlayingRef.current) return
          syncGuestToMain(positionSecRef.current, true)
        }, delayMs)
      })
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
    } finally {
      playInFlightRef.current = false
    }
  }

  const forceStopMainTransport = (opts?: { hardDuck?: boolean; muteGates?: boolean }) => {
    stopPendingTransport()
    clearGateWarmupTimers()
    playStartGuardRef.current = null
    firstFrameProbeArmedRef.current = false
    abortAudioTtfpAttempt("force_stop")
    setMainPlayPending(false)
    pendingStartPositionRef.current = null
    setMainPlayingState(false)
    stopEnginesHard({ muteGates: opts?.muteGates ?? true })
    if (opts?.hardDuck ?? true) {
      // Hard-duck master bus to instantly cut reverb tail on stop/switch.
      rampGainTo(masterGainRef.current, 0, 0.012)
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }

  const pauseGuestSolo = () => {
    const guestAudio = guestAudioRef.current
    if (!guestAudio) return
    setGuestSoloMode(false)
    rampGainTo(masterGainRef.current, clamp(masterVol, 0, 1) * MASTER_HEADROOM_GAIN, 0.04)
    beginGuestProgrammaticAction()
    guestAudio.pause()
    endGuestProgrammaticAction()
    setGuestIsPlaying(false)
  }

  const clearGuestCalibrateTimer = () => {
    if (guestCalibrateTimerRef.current != null) {
      window.clearInterval(guestCalibrateTimerRef.current)
      guestCalibrateTimerRef.current = null
    }
  }

  const setCalibrationMute = (enabled: boolean) => {
    const audio = guestAudioRef.current
    const master = masterGainRef.current
    const guestGain = guestGainNodeRef.current
    if (enabled) {
      calibrationMutedRef.current = true
      if (audio) calibrationGuestVolumeRef.current = audio.volume
      if (guestGain) calibrationGuestGainRef.current = guestGain.gain.value
      if (master) {
        const now = master.context.currentTime
        master.gain.cancelScheduledValues(now)
        master.gain.setValueAtTime(0, now)
      }
      if (guestGain) {
        const now = guestGain.context.currentTime
        guestGain.gain.cancelScheduledValues(now)
        guestGain.gain.setValueAtTime(0, now)
      }
      if (audio) audio.volume = 0
      return
    }

    if (!calibrationMutedRef.current) return
    calibrationMutedRef.current = false
    const masterTarget = (guestSoloMode ? 0 : clamp(masterVol, 0, 1)) * MASTER_HEADROOM_GAIN
    rampGainTo(master, masterTarget, 0.05)
    if (guestGain) rampGainTo(guestGain, calibrationGuestGainRef.current, 0.04)
    if (audio) {
      if (guestGain) audio.volume = 0
      else audio.volume = calibrationGuestVolumeRef.current
    }
  }

  const openGuestDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open("rr_guest_tracks", 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("tracks")) db.createObjectStore("tracks")
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

  const saveGuestRecording = useCallback(async (blob: Blob, recordKey = guestRecordStorageKey) => {
    try {
      const db = await openGuestDb()
      const tx = db.transaction("tracks", "readwrite")
      const store = tx.objectStore("tracks")
      await new Promise<void>((resolve, reject) => {
        const req = store.put({ blob, ts: Date.now() }, recordKey)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
      db.close()
    } catch {}
  }, [guestRecordStorageKey])

  const loadGuestRecordingByKey = useCallback(async (recordKey: string): Promise<Blob | null> => {
    try {
      const db = await openGuestDb()
      const tx = db.transaction("tracks", "readonly")
      const store = tx.objectStore("tracks")
      const record = await new Promise<{ blob?: Blob } | undefined>((resolve, reject) => {
        const req = store.get(recordKey)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return record?.blob ?? null
    } catch {}
    return null
  }, [])

  const loadGuestRecording = useCallback(async (): Promise<void> => {
    const applyTakeMetaToUi = (take: GuestTakeMeta | null) => {
      if (!take) return
      setRecordReferenceIndex(take.referenceTrackIndex)
      setGuestCalibrateReady(false)
      setGuestCalibrateScore(take.score ?? null)
      setGuestSyncQuality(take.syncQuality ?? "unknown")
      if (typeof take.offsetSec === "number" && Number.isFinite(take.offsetSec)) {
        setGuestSyncOffsetSec(clamp(take.offsetSec, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC))
      }
    }

    const applyBlobAsActiveTake = (blob: Blob, takeId: string | null, takes: GuestTakeMeta[]) => {
      const url = URL.createObjectURL(blob)
      setGuestTrackUrl((prev) => {
        scheduleBlobUrlRevoke(prev)
        return url
      })
      setGuestTakes(takes)
      setActiveGuestTakeId(takeId)
      const activeTake = takeId ? takes.find((item) => item.id === takeId) ?? null : null
      applyTakeMetaToUi(activeTake)
    }

    try {
      const rawTakes = localStorage.getItem(guestTakesStorageKey)
      if (rawTakes) {
        const parsed = JSON.parse(rawTakes) as Partial<GuestTakesState> | null
        const parsedTakes = Array.isArray(parsed?.takes)
          ? parsed.takes.filter((take): take is GuestTakeMeta => {
              if (!take || typeof take !== "object") return false
              if (typeof take.id !== "string" || !take.id) return false
              if (typeof take.sourceKey !== "string" || !take.sourceKey) return false
              if (typeof take.referenceTrackIndex !== "number" || !Number.isFinite(take.referenceTrackIndex)) return false
              return true
            })
          : []
        if (parsedTakes.length > 0) {
          const safeTakes = parsedTakes.slice(0, GUEST_TAKES_MAX)
          const candidateId = typeof parsed?.activeTakeId === "string" ? parsed.activeTakeId : safeTakes[0].id
          const selectedTake = safeTakes.find((take) => take.id === candidateId) ?? safeTakes[0]
          const blob = await loadGuestRecordingByKey(selectedTake.sourceKey)
          if (blob) {
            applyBlobAsActiveTake(blob, selectedTake.id, safeTakes)
            return
          }
        }
      }
    } catch {}

    // Legacy fallback: single take key.
    try {
      const legacyBlob = await loadGuestRecordingByKey(guestRecordStorageKey)
      if (!legacyBlob) return
      const legacyId = "legacy"
      const legacyTake: GuestTakeMeta = {
        id: legacyId,
        title: "Legacy take",
        createdAt: new Date(0).toISOString(),
        sourceKey: guestRecordStorageKey,
        referenceTrackIndex: selectedSoloTrackIndex >= 0 ? selectedSoloTrackIndex : 0,
      }
      applyBlobAsActiveTake(legacyBlob, legacyId, [legacyTake])
    } catch {}
  }, [guestRecordStorageKey, guestTakesStorageKey, loadGuestRecordingByKey, scheduleBlobUrlRevoke, selectedSoloTrackIndex])

  const pause = () => {
    stopPendingTransport()
    clearPendingPlayWatchdog()
    clearSmoothSeekTimers()
    setMainPlayPending(false)
    pendingPlayRef.current = false
    pendingStartPositionRef.current = null
    clearGuestCalibrateTimer()
    clearGuestStartGuardTimer()
    forceStopMainTransport({ hardDuck: false, muteGates: false })
    logAudioDebug("pause:gain_snapshot", {
      master: masterGainRef.current?.gain.value ?? null,
      gates: engineGateRef.current.map((g) => (g ? Number(g.gain.value.toFixed(4)) : null)),
      tracks: trackGainRef.current.map((g) => (g ? Number(g.gain.value.toFixed(4)) : null)),
      guestSoloMode,
      guestLinked: guestTransportLinkedRef.current,
    })

    const guestAudio = guestAudioRef.current
    if (guestAudio && !guestAudio.paused) {
      beginGuestProgrammaticAction()
      guestAudio.pause()
      endGuestProgrammaticAction()
    }
    if (guestAudio) guestAudio.playbackRate = 1
    guestRateNudgeRef.current = 1
    void flushGuestSyncTelemetry("pause", true)
  }

  const togglePlay = () => {
    if (mainPlayPending && !isPlayingRef.current) return
    if (isPlayingRef.current) pause()
    else {
      beginAudioTtfpAttempt("ui_play")
      markAudioTtfpStage("click")
      void play("ui_play")
    }
  }

  const toggleLoop = () => {
    setLoopOn((prev) => {
      const next = !prev
      loopOnRef.current = next
      logAudioDebug("loop:toggle", { prev, next, currentSec: positionSecRef.current })
      return next
    })
  }

  const seekTo = (sec: number) => {
    const pos = clamp(sec, 0, duration || sec)
    forceZeroStartRef.current = false
    const startupRuntime = startupChunkRuntimeRef.current
    if (
      startupRuntime?.enabled &&
      !startupRuntime.handoffComplete &&
      !startupRuntime.handoffInProgress
    ) {
      const handoffAtSec =
        startupRuntime.strategy === "splice"
          ? startupRuntime.stage === "startup"
            ? getStartupChunkTailHandoffAtSec(startupRuntime)
            : getStartupChunkFullHandoffAtSec(startupRuntime)
          : getStartupChunkHandoffAtSec(startupRuntime)
      if (pos >= handoffAtSec) {
        void performStartupChunkHandoff("seek_target", pos)
      }
    }
    positionSecRef.current = pos
    if (pendingPlayRef.current || mainPlayPending) {
      pendingStartPositionRef.current = pos
    }
    setCurrentTime(pos)

    const wasPlaying = isPlayingRef.current
    const isBufferedQueueSeek =
      activeEngineMode === "ringbuffer_worklet" || activeEngineMode === "appendable_queue_worklet"

    clearSmoothSeekTimers()
    const appendableCoordinator = getActiveAppendableQueueCoordinator()

    if (!wasPlaying) {
      if (appendableCoordinator) appendableCoordinator.seekSeconds(pos)
      else enginesRef.current.forEach((eng) => eng?.seekSeconds(pos))
      if (guestTransportLinkedRef.current) {
        syncGuestToMain(pos, true)
      }
      return
    }

    setEngineGateTarget(isBufferedQueueSeek ? SEEK_SMOOTH_RINGBUFFER_CLOSE_FLOOR_GAIN : 0, {
      rampSec: SEEK_SMOOTH_CLOSE_RAMP_SEC,
    })
    pendingSmoothSeekSecRef.current = pos
    smoothSeekTimerRef.current = window.setTimeout(() => {
      smoothSeekTimerRef.current = null
      const targetPos = pendingSmoothSeekSecRef.current ?? pos
      pendingSmoothSeekSecRef.current = null
      positionSecRef.current = targetPos
      setCurrentTime(targetPos)
      if (appendableCoordinator) appendableCoordinator.seekSeconds(targetPos)
      else enginesRef.current.forEach((eng) => eng?.seekSeconds(targetPos))
      if (guestTransportLinkedRef.current) {
        syncGuestToMain(targetPos, true)
      }
      let minBufferedSec: number | null = null
      if (isBufferedQueueSeek) {
        for (const engine of enginesRef.current) {
          const bufferedSec = engine?.getBufferedSeconds?.()
          if (typeof bufferedSec !== "number" || !Number.isFinite(bufferedSec)) continue
          minBufferedSec = minBufferedSec == null ? bufferedSec : Math.min(minBufferedSec, bufferedSec)
        }
      }
      const bufferedEnough =
        isBufferedQueueSeek &&
        typeof minBufferedSec === "number" &&
        minBufferedSec >= SEEK_SMOOTH_RINGBUFFER_BUFFERED_THRESHOLD_SEC
      const gateResumeDelayMs = isBufferedQueueSeek
        ? bufferedEnough
          ? SEEK_SMOOTH_RINGBUFFER_FAST_RESUME_DELAY_MS
          : SEEK_SMOOTH_RINGBUFFER_RESUME_DELAY_MS
        : SEEK_SMOOTH_RESUME_DELAY_MS
      const gateOpenRampSec = isBufferedQueueSeek
        ? bufferedEnough
          ? SEEK_SMOOTH_RINGBUFFER_FAST_OPEN_RAMP_SEC
          : SEEK_SMOOTH_RINGBUFFER_OPEN_RAMP_SEC
        : SEEK_SMOOTH_OPEN_RAMP_SEC
      const gateCrossfadeMidRampSec = isBufferedQueueSeek
        ? bufferedEnough
          ? SEEK_SMOOTH_RINGBUFFER_FAST_CROSSFADE_MID_RAMP_SEC
          : SEEK_SMOOTH_RINGBUFFER_CROSSFADE_MID_RAMP_SEC
        : 0
      smoothSeekResumeGateTimerRef.current = window.setTimeout(() => {
        smoothSeekResumeGateTimerRef.current = null
        if (!isPlayingRef.current) return
        if (isBufferedQueueSeek) {
          setRingbufferSeekResumeEnvelope({
            totalRampSec: gateOpenRampSec,
            midRampSec: gateCrossfadeMidRampSec,
          })
          return
        }
        setEngineGateTarget(1, { rampSec: gateOpenRampSec })
      }, gateResumeDelayMs)
      logAudioDebug("seek:smoothed", {
        posSec: Number(targetPos.toFixed(3)),
        debounceMs: SEEK_SMOOTH_DEBOUNCE_MS,
        resumeDelayMs: gateResumeDelayMs,
        gateOpenRampSec: Number(gateOpenRampSec.toFixed(3)),
        gateCrossfadeMidRampSec: isBufferedQueueSeek ? Number(gateCrossfadeMidRampSec.toFixed(3)) : 0,
        mode: activeEngineMode,
        minBufferedSec: typeof minBufferedSec === "number" ? Number(minBufferedSec.toFixed(3)) : null,
        closeFloorGain: isBufferedQueueSeek ? SEEK_SMOOTH_RINGBUFFER_CLOSE_FLOOR_GAIN : 0,
        crossfadeMidGain: isBufferedQueueSeek ? SEEK_SMOOTH_RINGBUFFER_CROSSFADE_MID_GAIN : 1,
      })
    }, SEEK_SMOOTH_DEBOUNCE_MS)

    if (rafRef.current == null) rafRef.current = requestAnimationFrame(animate)
  }

  const getAppendableRoutePilotDebugState = useCallback((): AppendableRoutePilotDebugState => {
    const effectiveReport =
      typeof window !== "undefined" && appendableRoutePilotReportHydratedStorageKey !== appendableRoutePilotReportStorageKey
        ? restoreAppendableRoutePilotReport(window.localStorage.getItem(appendableRoutePilotReportStorageKey)) ??
          appendableRoutePilotReportRef.current
        : appendableRoutePilotReportRef.current
    return {
      trackScopeId,
      playing: isPlayingRef.current,
      audioMode: activeEngineMode,
      checklist: {
        status: appendablePilotChecklistState.status,
        statusLabel: appendablePilotChecklistState.statusLabel,
        steps: appendablePilotChecklistState.steps.slice(),
      },
      runtimeProbe: cloneAppendableQueueRuntimeProbeSnapshot(appendableQueueRuntimeProbeSnapshot),
      sourceProgress: cloneAppendableQueueSourceProgressSnapshot(appendableQueueSourceProgressSnapshot),
      report: cloneAppendableRoutePilotReport(effectiveReport),
    }
  }, [
    activeEngineMode,
    appendablePilotChecklistState.status,
    appendablePilotChecklistState.statusLabel,
    appendablePilotChecklistState.steps,
    appendableRoutePilotReportHydratedStorageKey,
    appendableRoutePilotReportStorageKey,
    appendableQueueRuntimeProbeSnapshot,
    appendableQueueSourceProgressSnapshot,
    trackScopeId,
  ])

  const buildAppendableRoutePilotSnapshotFromDebugState = useCallback(
    (state: AppendableRoutePilotDebugState): AppendableRoutePilotReportSnapshot => {
      const snapshot = buildAppendableRoutePilotSnapshot()
      return {
        ...snapshot,
        audioMode: state.audioMode,
        gate: {
          status: state.checklist.status,
          statusLabel: state.checklist.statusLabel,
        },
        probe: cloneAppendableQueueRuntimeProbeSnapshot(state.runtimeProbe),
        sourceProgress: cloneAppendableQueueSourceProgressSnapshot(state.sourceProgress),
      }
    },
    [buildAppendableRoutePilotSnapshot]
  )

  const runAppendableRouteQuickPilot = useCallback(
    async (seekSec: number | null = 12, options?: { downloadPacket?: boolean }) => {
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms)
        })
      const readState = () =>
        (typeof window !== "undefined" ? window.__rrAppendableRoutePilotDebug?.getState() : null) ??
        getAppendableRoutePilotDebugState()

      setAppendableRouteQuickPilotRunning(true)
      setAppendableRouteQuickPilotMessage(uiLang === "ru" ? "идет quick pilot..." : "quick pilot running...")
      try {
        await play("route_quick_pilot")
        await wait(2800)
        if (typeof seekSec === "number" && Number.isFinite(seekSec)) {
          seekTo(seekSec)
          await wait(2800)
        }
        let finalState = readState()
        for (let attempt = 0; attempt < 12; attempt += 1) {
          finalState = readState()
          if (
            finalState.checklist.status === "ready_for_manual_pilot" ||
            finalState.checklist.status === "blocked_by_targeting" ||
            finalState.checklist.status === "attention_required"
          ) {
            break
          }
          await wait(200)
        }
        const settledSnapshot = buildAppendableRoutePilotSnapshotFromDebugState(finalState)
        const nextReport = buildAppendableRoutePilotReportWithSnapshot(settledSnapshot, { autoStatus: true })
        commitAppendableRoutePilotReport(nextReport)
        finalState = {
          ...finalState,
          report: cloneAppendableRoutePilotReport(nextReport),
        }
        if (options?.downloadPacket) {
          downloadAppendableRoutePilotPacket(nextReport)
        }
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru"
            ? `quick pilot: ${finalState.checklist.statusLabel}`
            : `quick pilot: ${finalState.checklist.statusLabel}`
        )
        return finalState
      } catch (error) {
        const message = error instanceof Error ? error.message : "quick_pilot_failed"
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru" ? `quick pilot error: ${message}` : `quick pilot error: ${message}`
        )
        throw error
      } finally {
        setAppendableRouteQuickPilotRunning(false)
      }
    },
    [
      buildAppendableRoutePilotReportWithSnapshot,
      buildAppendableRoutePilotSnapshotFromDebugState,
      commitAppendableRoutePilotReport,
      downloadAppendableRoutePilotPacket,
      getAppendableRoutePilotDebugState,
      play,
      seekTo,
      uiLang,
    ]
  )

  const runAppendableRouteSoakPilot = useCallback(
    async (durationSec: number | null = APPENDABLE_ROUTE_SOAK_PILOT_DURATION_SEC, options?: { downloadPacket?: boolean }) => {
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms)
        })
      const readState = () =>
        (typeof window !== "undefined" ? window.__rrAppendableRoutePilotDebug?.getState() : null) ??
        getAppendableRoutePilotDebugState()
      const safeDurationSec =
        typeof durationSec === "number" && Number.isFinite(durationSec)
          ? Math.max(1, Math.min(60, durationSec))
          : APPENDABLE_ROUTE_SOAK_PILOT_DURATION_SEC

      setAppendableRouteSoakPilotRunning(true)
      setAppendableRouteQuickPilotMessage(
        uiLang === "ru"
          ? `идет soak pilot (${safeDurationSec.toFixed(1)}s)...`
          : `soak pilot running (${safeDurationSec.toFixed(1)}s)...`
      )
      try {
        await play("route_soak_pilot")
        await wait(safeDurationSec * 1000)
        let finalState = readState()
        for (let attempt = 0; attempt < 12; attempt += 1) {
          finalState = readState()
          if (
            finalState.checklist.status === "ready_for_manual_pilot" ||
            finalState.checklist.status === "blocked_by_targeting" ||
            finalState.checklist.status === "attention_required"
          ) {
            break
          }
          await wait(250)
        }
        const settledSnapshot = buildAppendableRoutePilotSnapshotFromDebugState(finalState)
        const nextReport = buildAppendableRoutePilotReportWithSnapshot(settledSnapshot, { autoStatus: true })
        commitAppendableRoutePilotReport(nextReport)
        finalState = {
          ...finalState,
          report: cloneAppendableRoutePilotReport(nextReport),
        }
        if (options?.downloadPacket) {
          downloadAppendableRoutePilotPacket(nextReport)
        }
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru"
            ? `soak pilot: ${finalState.checklist.statusLabel}`
            : `soak pilot: ${finalState.checklist.statusLabel}`
        )
        return finalState
      } catch (error) {
        const message = error instanceof Error ? error.message : "soak_pilot_failed"
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru" ? `soak pilot error: ${message}` : `soak pilot error: ${message}`
        )
        throw error
      } finally {
        setAppendableRouteSoakPilotRunning(false)
      }
    },
    [
      buildAppendableRoutePilotReportWithSnapshot,
      buildAppendableRoutePilotSnapshotFromDebugState,
      commitAppendableRoutePilotReport,
      downloadAppendableRoutePilotPacket,
      getAppendableRoutePilotDebugState,
      play,
      uiLang,
    ]
  )

  const runAppendableRouteQualificationPilot = useCallback(
    async (
      durationSec: number | null = APPENDABLE_ROUTE_QUALIFICATION_PILOT_DURATION_SEC,
      options?: { downloadPacket?: boolean }
    ) => {
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms)
        })
      const readState = () =>
        (typeof window !== "undefined" ? window.__rrAppendableRoutePilotDebug?.getState() : null) ??
        getAppendableRoutePilotDebugState()
      const safeDurationSec =
        typeof durationSec === "number" && Number.isFinite(durationSec)
          ? Math.max(1, Math.min(60, durationSec))
          : APPENDABLE_ROUTE_QUALIFICATION_PILOT_DURATION_SEC

      setAppendableRouteQualificationPilotRunning(true)
      setAppendableRouteQuickPilotMessage(
        uiLang === "ru"
          ? `идет qualification pilot (${safeDurationSec.toFixed(1)}s)...`
          : `qualification pilot running (${safeDurationSec.toFixed(1)}s)...`
      )
      try {
        await play("route_qualification_pilot")
        await wait(safeDurationSec * 1000)
        let finalState = readState()
        for (let attempt = 0; attempt < 12; attempt += 1) {
          finalState = readState()
          if (
            finalState.checklist.status === "ready_for_manual_pilot" ||
            finalState.checklist.status === "blocked_by_targeting" ||
            finalState.checklist.status === "attention_required"
          ) {
            break
          }
          await wait(250)
        }
        const settledSnapshot = withAppendableRouteQualificationSnapshot(
          buildAppendableRoutePilotSnapshotFromDebugState(finalState),
          safeDurationSec
        )
        const qualificationPassed = settledSnapshot.qualification.passed === true
        const nextReport = buildAppendableRoutePilotReportWithSnapshot(settledSnapshot, { autoStatus: true })
        commitAppendableRoutePilotReport(nextReport)
        finalState = {
          ...finalState,
          report: cloneAppendableRoutePilotReport(nextReport),
        }
        if (options?.downloadPacket) {
          downloadAppendableRoutePilotPacket(nextReport)
        }
        const observedLabel =
          typeof settledSnapshot.qualification.observedCleanSoakSec === "number" &&
          Number.isFinite(settledSnapshot.qualification.observedCleanSoakSec)
            ? settledSnapshot.qualification.observedCleanSoakSec.toFixed(1)
            : "—"
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru"
            ? `qualification pilot: ${qualificationPassed ? "pass" : "fail"} (${observedLabel} / ${safeDurationSec.toFixed(1)}s)`
            : `qualification pilot: ${qualificationPassed ? "pass" : "fail"} (${observedLabel} / ${safeDurationSec.toFixed(1)}s)`
        )
        return finalState
      } catch (error) {
        const message = error instanceof Error ? error.message : "qualification_pilot_failed"
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru" ? `qualification pilot error: ${message}` : `qualification pilot error: ${message}`
        )
        throw error
      } finally {
        setAppendableRouteQualificationPilotRunning(false)
      }
    },
    [
      buildAppendableRoutePilotReportWithSnapshot,
      buildAppendableRoutePilotSnapshotFromDebugState,
      commitAppendableRoutePilotReport,
      downloadAppendableRoutePilotPacket,
      getAppendableRoutePilotDebugState,
      play,
      uiLang,
    ]
  )

  const runAppendableRouteStressPilot = useCallback(
    async (
      holdSec: number | null = APPENDABLE_ROUTE_STRESS_PILOT_HOLD_SEC,
      options?: { downloadPacket?: boolean }
    ) => {
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms)
        })
      const readState = () =>
        (typeof window !== "undefined" ? window.__rrAppendableRoutePilotDebug?.getState() : null) ??
        getAppendableRoutePilotDebugState()
      const safeHoldSec =
        typeof holdSec === "number" && Number.isFinite(holdSec)
          ? Math.max(1, Math.min(20, holdSec))
          : APPENDABLE_ROUTE_STRESS_PILOT_HOLD_SEC
      const seekSequenceSec = APPENDABLE_ROUTE_STRESS_PILOT_SEEK_SEQUENCE_SEC.slice()
      let completedSeeks = 0

      setAppendableRouteStressPilotRunning(true)
      setAppendableRouteQuickPilotMessage(
        uiLang === "ru"
          ? `идет stress pilot (${seekSequenceSec.length} seek / ${safeHoldSec.toFixed(1)}s)...`
          : `stress pilot running (${seekSequenceSec.length} seeks / ${safeHoldSec.toFixed(1)}s)...`
      )
      try {
        await play("route_stress_pilot")
        await wait(2200)
        for (const seekSec of seekSequenceSec) {
          seekTo(seekSec)
          completedSeeks += 1
          await wait(safeHoldSec * 1000)
        }
        let finalState = readState()
        for (let attempt = 0; attempt < 12; attempt += 1) {
          finalState = readState()
          if (
            finalState.checklist.status === "ready_for_manual_pilot" ||
            finalState.checklist.status === "blocked_by_targeting" ||
            finalState.checklist.status === "attention_required"
          ) {
            break
          }
          await wait(250)
        }
        const settledSnapshot = withAppendableRouteStressSnapshot(buildAppendableRoutePilotSnapshotFromDebugState(finalState), {
          holdPerSeekSec: safeHoldSec,
          seekSequenceSec,
          completedSeeks,
        })
        const stressPassed = settledSnapshot.stress.passed === true
        const nextReport = buildAppendableRoutePilotReportWithSnapshot(settledSnapshot, { autoStatus: true })
        commitAppendableRoutePilotReport(nextReport)
        finalState = {
          ...finalState,
          report: cloneAppendableRoutePilotReport(nextReport),
        }
        if (options?.downloadPacket) {
          downloadAppendableRoutePilotPacket(nextReport)
        }
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru"
            ? `stress pilot: ${stressPassed ? "pass" : "fail"} (${completedSeeks}/${seekSequenceSec.length} seek)`
            : `stress pilot: ${stressPassed ? "pass" : "fail"} (${completedSeeks}/${seekSequenceSec.length} seeks)`
        )
        return finalState
      } catch (error) {
        const message = error instanceof Error ? error.message : "stress_pilot_failed"
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru" ? `stress pilot error: ${message}` : `stress pilot error: ${message}`
        )
        throw error
      } finally {
        setAppendableRouteStressPilotRunning(false)
      }
    },
    [
      buildAppendableRoutePilotReportWithSnapshot,
      buildAppendableRoutePilotSnapshotFromDebugState,
      commitAppendableRoutePilotReport,
      downloadAppendableRoutePilotPacket,
      getAppendableRoutePilotDebugState,
      play,
      seekTo,
      uiLang,
    ]
  )

  const runAppendableRoutePitchShadowPilot = useCallback(
    async (
      tempo: number | null = 1.06,
      pitchSemitones: number | null = 4,
      settleMs: number | null = 1400
    ) => {
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms)
        })
      const readState = () =>
        (typeof window !== "undefined" ? window.__rrAppendableRoutePilotDebug?.getState() : null) ??
        getAppendableRoutePilotDebugState()
      const safeTempo =
        typeof tempo === "number" && Number.isFinite(tempo) ? Math.min(4, Math.max(0.25, tempo)) : null
      const safePitchSemitones =
        typeof pitchSemitones === "number" && Number.isFinite(pitchSemitones)
          ? Math.min(12, Math.max(-12, Math.round(pitchSemitones)))
          : null
      const safeSettleMs =
        typeof settleMs === "number" && Number.isFinite(settleMs) ? Math.max(200, Math.min(5000, settleMs)) : 1400

      setAppendableRouteQuickPilotMessage(
        uiLang === "ru"
          ? `идет pitch shadow proof (${safeTempo?.toFixed(2) ?? "—"} / ${safePitchSemitones ?? "—"})...`
          : `pitch shadow proof running (${safeTempo?.toFixed(2) ?? "—"} / ${safePitchSemitones ?? "—"})...`
      )
      await play("route_pitch_shadow_pilot")
      await wait(2200)

      const previousTempo = Number(tempoRef.current.toFixed(3))
      const previousPitchSemitones = Number(pitchSemiRef.current.toFixed(3))
      try {
        if (safeTempo != null) {
          setAppendableRouteDebugTempo(safeTempo)
        }
        if (safePitchSemitones != null) {
          setAppendableRouteDebugPitchSemitones(safePitchSemitones)
        }
        await wait(safeSettleMs)

        let finalState = readState()
        for (let attempt = 0; attempt < 10; attempt += 1) {
          finalState = readState()
          if (
            finalState.runtimeProbe.active &&
            (safeTempo == null ||
              (finalState.runtimeProbe.tempo != null &&
                Math.abs(finalState.runtimeProbe.tempo - safeTempo) <= 0.02)) &&
            (safePitchSemitones == null ||
              (finalState.runtimeProbe.pitchSemitones != null &&
                Math.abs(finalState.runtimeProbe.pitchSemitones - safePitchSemitones) <= 0.02))
          ) {
            break
          }
          await wait(200)
        }

        const settledSnapshot = withAppendableRoutePitchSnapshot(
          buildAppendableRoutePilotSnapshotFromDebugState(finalState),
          {
            scenario: "route_shadow_manual_pitch",
            shadowEnabled: appendableRoutePitchShadowActive,
            targetTempo: safeTempo,
            targetPitchSemitones: safePitchSemitones,
          }
        )
        const nextReport = buildAppendableRoutePilotReportWithSnapshot(settledSnapshot, { autoStatus: true })
        commitAppendableRoutePilotReport(nextReport)
        finalState = {
          ...finalState,
          report: cloneAppendableRoutePilotReport(nextReport),
        }
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru"
            ? `pitch shadow proof: ${settledSnapshot.pitch.passed ? "pass" : "fail"}`
            : `pitch shadow proof: ${settledSnapshot.pitch.passed ? "pass" : "fail"}`
        )
        return finalState
      } catch (error) {
        const message = error instanceof Error ? error.message : "pitch_shadow_pilot_failed"
        setAppendableRouteQuickPilotMessage(
          uiLang === "ru" ? `pitch shadow proof error: ${message}` : `pitch shadow proof error: ${message}`
        )
        throw error
      } finally {
        setAppendableRouteDebugPitchSemitones(previousPitchSemitones)
        setAppendableRouteDebugTempo(previousTempo)
      }
    },
    [
      appendableRoutePitchShadowActive,
      buildAppendableRoutePilotReportWithSnapshot,
      buildAppendableRoutePilotSnapshotFromDebugState,
      commitAppendableRoutePilotReport,
      getAppendableRoutePilotDebugState,
      play,
      setAppendableRouteDebugPitchSemitones,
      setAppendableRouteDebugTempo,
      uiLang,
    ]
  )

  const saveCurrentAppendableRouteDiagnostics = useCallback(() => {
    const snapshot = buildAppendableRoutePilotSnapshot()
    const nextReport = buildAppendableRoutePilotReportWithSnapshot(snapshot, { autoStatus: true })
    commitAppendableRoutePilotReport(nextReport)
    downloadAppendableRoutePilotPacket(nextReport)
    setAppendableRouteQuickPilotMessage(
      uiLang === "ru" ? "сохранено текущее diagnostics" : "saved current diagnostics"
    )
  }, [
    buildAppendableRoutePilotReportWithSnapshot,
    buildAppendableRoutePilotSnapshot,
    commitAppendableRoutePilotReport,
    downloadAppendableRoutePilotPacket,
    uiLang,
  ])

  const saveAppendableRouteQuickPilotDiagnostics = useCallback(async () => {
    await runAppendableRouteQuickPilot(12, { downloadPacket: true })
  }, [runAppendableRouteQuickPilot])

  const saveAppendableRouteSoakPilotDiagnostics = useCallback(async () => {
    await runAppendableRouteSoakPilot(APPENDABLE_ROUTE_SOAK_PILOT_DURATION_SEC, { downloadPacket: true })
  }, [runAppendableRouteSoakPilot])

  const saveAppendableRouteQualificationPilotDiagnostics = useCallback(async () => {
    await runAppendableRouteQualificationPilot(APPENDABLE_ROUTE_QUALIFICATION_PILOT_DURATION_SEC, {
      downloadPacket: true,
    })
  }, [runAppendableRouteQualificationPilot])

  const saveAppendableRouteStressPilotDiagnostics = useCallback(async () => {
    await runAppendableRouteStressPilot(APPENDABLE_ROUTE_STRESS_PILOT_HOLD_SEC, {
      downloadPacket: true,
    })
  }, [runAppendableRouteStressPilot])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.__rrAppendableRoutePilotDebug = {
      play: () => play("route_debug_api"),
      pause: () => pause(),
      seek: (sec: number) => {
        seekTo(sec)
        return positionSecRef.current
      },
      setTempo: (tempo: number) => setAppendableRouteDebugTempo(tempo),
      setPitchSemitones: (semi: number) => setAppendableRouteDebugPitchSemitones(semi),
      captureReport: () => captureAppendableRoutePilotSnapshot(),
      saveCurrentDiagnostics: () => {
        saveCurrentAppendableRouteDiagnostics()
      },
      markPass: () => {
        markAppendableRoutePilotReport("pass")
      },
      markFail: () => {
        markAppendableRoutePilotReport("fail")
      },
      resetReport: () => {
        resetAppendableRoutePilotReport()
      },
      downloadReport: () => {
        downloadAppendableRoutePilotReport()
      },
      downloadPacket: () => {
        downloadAppendableRoutePilotPacket()
      },
      getState: () => getAppendableRoutePilotDebugState(),
      runQuickPilot: (seekSec?: number | null) => runAppendableRouteQuickPilot(seekSec ?? null),
      runSoakPilot: (durationSec?: number | null) => runAppendableRouteSoakPilot(durationSec ?? null),
      runQualificationPilot: (durationSec?: number | null) => runAppendableRouteQualificationPilot(durationSec ?? null),
      runStressPilot: (holdSec?: number | null) => runAppendableRouteStressPilot(holdSec ?? null),
      runPitchShadowPilot: (tempo?: number | null, pitchSemitones?: number | null, settleMs?: number | null) =>
        runAppendableRoutePitchShadowPilot(tempo ?? null, pitchSemitones ?? null, settleMs ?? null),
    }
    return () => {
      window.__rrAppendableRoutePilotDebug = undefined
    }
  }, [
    captureAppendableRoutePilotSnapshot,
    downloadAppendableRoutePilotPacket,
    downloadAppendableRoutePilotReport,
    getAppendableRoutePilotDebugState,
    markAppendableRoutePilotReport,
    pause,
    play,
    runAppendableRoutePitchShadowPilot,
    runAppendableRouteQualificationPilot,
    runAppendableRouteStressPilot,
    resetAppendableRoutePilotReport,
    runAppendableRouteQuickPilot,
    runAppendableRouteSoakPilot,
    saveCurrentAppendableRouteDiagnostics,
    setAppendableRouteDebugPitchSemitones,
    setAppendableRouteDebugTempo,
    seekTo,
  ])

  const goToStart = () => {
    pause()
    seekTo(0)
  }

  useEffect(() => {
    if (!isReady || !pendingPlayRef.current) return
    pendingPlayRef.current = false
    void play("pending_ready")
    // play intentionally excluded to avoid unstable callback re-triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    if (!isReady || navResumePositionRef.current == null) return
    const resumePos = navResumePositionRef.current
    const resumePlay = navResumePlayRef.current
    navResumePositionRef.current = null
    navResumePlayRef.current = false
    seekTo(resumePos)
    if (resumePlay) {
      void play("nav_resume")
    }
    // seekTo/play intentionally excluded to avoid unstable callback re-triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    globalControllerRef.current = {
      id: globalControllerIdRef.current,
      title: trackList[0]?.name ?? t.songFallbackTitle,
      subtitle: t.songFallbackSubtitle,
      prime: () => {
        const ctx = ctxRef.current
        if (!ctx) return
        void ctx.resume().catch(() => {})
      },
      stop: () => pause(),
      play: () => {
        play("controller_play").catch(() => {})
      },
      pause: () => pause(),
      toggle: () => {
        if (isPlayingRef.current) pause()
        else play("controller_toggle").catch(() => {})
      },
      prev: () => {
        seekTo(Math.max(0, positionSecRef.current - 10))
      },
      next: () => {
        seekTo(Math.min(duration || positionSecRef.current + 10, positionSecRef.current + 10))
      },
      seek: (timeSec: number) => seekTo(timeSec),
      getProgress: () => ({
        current: positionSecRef.current,
        duration,
        playing: isPlayingRef.current,
      }),
      getLoop: () => loopOnRef.current,
      setLoop: (loop: boolean) => {
        loopOnRef.current = loop
        setLoopOn(loop)
      },
    }
    onControllerReady?.(globalControllerRef.current)
    return () => {
      if (persistOnUnmount && isPlayingRef.current) return
      onControllerReady?.(null)
    }
    // play/pause are intentionally omitted to keep controller wiring stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, onControllerReady, persistOnUnmount, seekTo, t.songFallbackSubtitle, t.songFallbackTitle, trackList])

  useEffect(() => {
    if (seekToSeconds == null) return
    if (lastExternalSeekRef.current != null && Math.abs(lastExternalSeekRef.current - seekToSeconds) < 0.001) return
    lastExternalSeekRef.current = seekToSeconds
    seekTo(seekToSeconds)
    // seekTo intentionally not in deps to avoid effect loop from function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekToSeconds])

  useEffect(() => {
    return () => {
      stopPendingTransport()
      clearGateWarmupTimers()
      clearPendingPlayWatchdog()
      playStartGuardRef.current = null
      firstFrameProbeArmedRef.current = false
      pendingPlayRef.current = false
      clearGuestCalibrateTimer()
      clearGuestStartGuardTimer()
      if (tempoPitchRealignTimerRef.current != null) {
        window.clearTimeout(tempoPitchRealignTimerRef.current)
        tempoPitchRealignTimerRef.current = null
      }
      cancelTempoPitchSmoothing()
      if (countInTimerRef.current != null) {
        window.clearInterval(countInTimerRef.current)
        countInTimerRef.current = null
      }
      if (recordingCapabilitySnapshotRef.current) {
        const finalSnapshot = {
          ...recordingCapabilitySnapshotRef.current,
          dropoutCount: recordDropoutCountRef.current,
          recoveryCount: recordRecoveryCountRef.current,
          workletTapActive: !!recordingV2TapNodeRef.current,
          workletFramesCaptured: recordingV2TapStatsRef.current.framesCaptured,
          workletChunkReports: recordingV2TapStatsRef.current.chunkReports,
          workletTapErrors: recordingV2TapStatsRef.current.errors,
          opfsWriterActive: !!recordingV2OpfsWriterRef.current,
          opfsBytesWritten: recordingV2OpfsStatsRef.current.bytes,
          opfsChunkCount: recordingV2OpfsStatsRef.current.chunks,
          opfsWriteErrors: recordingV2OpfsStatsRef.current.errors,
          uploadState: recordingV2UploadState,
          capturedAt: new Date().toISOString(),
        }
        flushRecorderCapabilityTelemetry("unmount", finalSnapshot)
      }
      teardownRecordingV2Tap()
      void closeRecordingV2OpfsWriter()
      scheduleBlobUrlRevoke(guestTrackUrl, 0)
      recordStreamRef.current?.getTracks().forEach((t) => t.stop())
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop()
      }
    }
  }, [
    cancelTempoPitchSmoothing,
    clearPendingPlayWatchdog,
    clearGateWarmupTimers,
    closeRecordingV2OpfsWriter,
    flushRecorderCapabilityTelemetry,
    guestTrackUrl,
    recordingV2UploadState,
    scheduleBlobUrlRevoke,
    stopPendingTransport,
    teardownRecordingV2Tap,
  ])

  const playReferenceTone = async (freq: number) => {
    const ctx = ctxRef.current
    if (!ctx) return
    await ctx.resume()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    g.gain.value = 0.0001
    osc.frequency.value = freq
    osc.type = "sine"
    osc.connect(g)
    g.connect(ctx.destination)
    const now = ctx.currentTime
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
    osc.start(now)
    osc.stop(now + 0.38)
  }

  const playPianoTone = useCallback(async (freq: number) => {
    const ctx = ctxRef.current
    if (!ctx) return
    await ctx.resume()

    const now = ctx.currentTime
    const out = ctx.createGain()
    out.gain.value = 0.0001

    const bodyFilter = ctx.createBiquadFilter()
    bodyFilter.type = "lowpass"
    bodyFilter.frequency.setValueAtTime(5200, now)
    bodyFilter.frequency.exponentialRampToValueAtTime(1800, now + 0.48)
    bodyFilter.Q.value = 0.9

    const sparkleFilter = ctx.createBiquadFilter()
    sparkleFilter.type = "highshelf"
    sparkleFilter.frequency.value = 2500
    sparkleFilter.gain.value = 3.8

    const osc1 = ctx.createOscillator()
    osc1.type = "triangle"
    osc1.frequency.value = freq
    const g1 = ctx.createGain()
    g1.gain.value = 0.52

    const osc2 = ctx.createOscillator()
    osc2.type = "triangle"
    osc2.frequency.value = freq * 2.01
    const g2 = ctx.createGain()
    g2.gain.value = 0.2

    const osc3 = ctx.createOscillator()
    osc3.type = "sine"
    osc3.frequency.value = freq * 2.99
    const g3 = ctx.createGain()
    g3.gain.value = 0.1

    const osc4 = ctx.createOscillator()
    osc4.type = "sine"
    osc4.frequency.value = freq * 4.02
    const g4 = ctx.createGain()
    g4.gain.value = 0.045

    const noise = ctx.createBufferSource()
    const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * 0.06))
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate)
    const noiseData = noiseBuf.getChannelData(0)
    for (let i = 0; i < noiseLen; i++) noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen)
    noise.buffer = noiseBuf
    const noiseFilter = ctx.createBiquadFilter()
    noiseFilter.type = "bandpass"
    noiseFilter.frequency.value = Math.min(3800, Math.max(1200, freq * 2.7))
    noiseFilter.Q.value = 0.8
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.08, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055)

    osc1.connect(g1)
    osc2.connect(g2)
    osc3.connect(g3)
    osc4.connect(g4)
    g1.connect(bodyFilter)
    g2.connect(bodyFilter)
    g3.connect(bodyFilter)
    g4.connect(bodyFilter)
    noise.connect(noiseFilter)
    noiseFilter.connect(noiseGain)
    noiseGain.connect(bodyFilter)
    bodyFilter.connect(sparkleFilter)
    sparkleFilter.connect(out)
    out.connect(ctx.destination)

    const target = Math.max(0.05, pianoVolume) * 0.2
    out.gain.setValueAtTime(0.0001, now)
    out.gain.exponentialRampToValueAtTime(target, now + 0.008)
    out.gain.exponentialRampToValueAtTime(target * 0.44, now + 0.22)
    out.gain.exponentialRampToValueAtTime(target * 0.22, now + 0.85)
    out.gain.exponentialRampToValueAtTime(0.0001, now + 2.1)

    osc1.start(now)
    osc2.start(now)
    osc3.start(now)
    osc4.start(now)
    noise.start(now)
    const stopAt = now + 2.2
    osc1.stop(stopAt)
    osc2.stop(stopAt)
    osc3.stop(stopAt)
    osc4.stop(stopAt)
    noise.stop(now + 0.065)
  }, [pianoVolume])

  useEffect(() => {
    if (!showPiano) return
    const map = new Map<string, number>()
    for (const key of pianoKeys) {
      if (key.kbd) map.set(key.kbd.toLowerCase(), key.freq)
      if (key.kbdRu) map.set(key.kbdRu.toLowerCase(), key.freq)
    }
    const pressed = new Set<string>()
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      const freq = map.get(k)
      if (!freq) return
      if (pressed.has(k)) return
      pressed.add(k)
      e.preventDefault()
      playPianoTone(freq).catch(() => {})
    }
    const onUp = (e: KeyboardEvent) => {
      pressed.delete(e.key.toLowerCase())
    }
    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
    }
  }, [showPiano, pianoKeys, playPianoTone])

  const playCountInClick = async (isLast: boolean) => {
    const freq = isLast ? 1046.5 : 783.99
    await playReferenceTone(freq)
  }

  const startGuestRecording = async () => {
    if (recordArmingRef.current) {
      setRecordError(t.recordStartInProgress)
      return
    }
    try {
      recordArmingRef.current = true
      setRecordError(null)
      setGuestCalibrateReady(false)
      setGuestCalibrateScore(null)
      setGuestSyncQuality("unknown")
      guestTransportLinkedRef.current = false
      setRecordChecklistOpen(true)
      const localMasterEnabled = recordingMode === "local_master" && recordingEngineV2Enabled && localMasterCapable
      if (recordingMode === "local_master" && !localMasterEnabled) {
        setRecordError(t.recordingModeFallbackHint)
      }
      if (selectedSoloTrackIndex < 0) {
        setRecordError(t.recordRequireSingleSolo)
        recordArmingRef.current = false
        return
      }
      const persistedHeadphonesConfirmed = (() => {
        if (recordHeadphonesConfirmed) return true
        if (typeof window === "undefined") return false
        try {
          return window.localStorage.getItem(RECORD_HEADPHONES_STORAGE_KEY) === "1"
        } catch {
          return false
        }
      })()
      if (!recordHeadphonesConfirmed && persistedHeadphonesConfirmed) {
        setRecordHeadphonesConfirmed(true)
      }
      if (!persistedHeadphonesConfirmed) {
        setRecordError(t.recordRequireHeadphones)
        recordArmingRef.current = false
        return
      }
      if (referenceLockEnabled) {
        setRecordReferenceIndex(selectedSoloTrackIndex)
      } else {
        setRecordReferenceIndex(null)
      }

      if (countInTimerRef.current != null) {
        window.clearInterval(countInTimerRef.current)
        countInTimerRef.current = null
      }
      guestTogetherFirstStartRef.current = true
      guestStartupBiasSecRef.current = 0
      recordDropoutCountRef.current = 0
      recordRecoveryCountRef.current = 0
      setRecordDropoutCount(0)
      setRecordRecoveryCount(0)
      recordingV2TakeSessionIdRef.current = null
      recordingV2ChunkSeqRef.current = 0
      recordingV2WriteChainRef.current = Promise.resolve()
      recordingV2OpfsStatsRef.current = { bytes: 0, chunks: 0, errors: 0 }
      setRecordingV2OpfsBytes(0)
      setRecordingV2OpfsChunks(0)
      setRecordingV2OpfsErrors(0)
      setRecordingV2OpfsActive(false)
      setRecordingV2UploadState("idle")
      await closeRecordingV2OpfsWriter()

      let stream = recordStreamRef.current
      const hasLiveTrack = !!stream?.getAudioTracks().some((t) => t.readyState === "live")
      if (!hasLiveTrack) {
        stream = await navigator.mediaDevices.getUserMedia(RECORD_STREAM_CONSTRAINTS)
        recordStreamRef.current = stream
      }
      if (!stream) throw new Error("mic-stream-unavailable")
      teardownRecordingV2Tap()
      recordingV2TapStatsRef.current = {
        framesCaptured: 0,
        chunkReports: 0,
        errors: 0,
      }
      if (localMasterEnabled) {
        const tapReady = await setupRecordingV2Tap(stream)
        if (!tapReady) {
          recordingV2TapStatsRef.current.errors += 1
        }
        const sessionTakeId = buildGuestTakeId()
        recordingV2TakeSessionIdRef.current = sessionTakeId
        try {
          const writer = await createRecordingV2OpfsWriter(sessionTakeId)
          if (writer) {
            recordingV2OpfsWriterRef.current = writer
            setRecordingV2OpfsActive(true)
          } else {
            recordingV2OpfsStatsRef.current.errors += 1
            setRecordingV2OpfsErrors(recordingV2OpfsStatsRef.current.errors)
          }
        } catch {
          recordingV2OpfsStatsRef.current.errors += 1
          setRecordingV2OpfsErrors(recordingV2OpfsStatsRef.current.errors)
        }
      }
      const inputTrack = stream.getAudioTracks()[0]
      const inputLabelRaw = inputTrack?.label || "default-input"
      const inputLabel = inputLabelRaw.toLowerCase()
      const looksBluetooth = /airpods|bluetooth|buds|hands-free|headset/.test(inputLabel)
      setBluetoothRouteRisk(looksBluetooth)
      const inputSettings = inputTrack?.getSettings?.()
      const inputDeviceId = typeof inputSettings?.deviceId === "string" && inputSettings.deviceId ? inputSettings.deviceId : "default"
      const browserHint = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 24) : "browser"
      const profileId = `${browserHint}:${inputDeviceId}`
      let activeDeviceProfileId: string | undefined
      if (inputTrack) {
        inputTrack.onmute = () => {
          recordDropoutCountRef.current += 1
          setRecordDropoutCount(recordDropoutCountRef.current)
        }
        inputTrack.onunmute = () => {
          recordRecoveryCountRef.current += 1
          setRecordRecoveryCount(recordRecoveryCountRef.current)
        }
        inputTrack.onended = () => {
          setRecordError(t.recordMicDisconnected)
          setRecording(false)
          const endedSnapshot = buildCurrentRecorderSnapshot({
            stream: recordStreamRef.current,
            mimeType: recorderRef.current?.mimeType || pickRecordingMimeType(),
          })
          setRecordingCapabilitySnapshot(endedSnapshot)
          flushRecorderCapabilityTelemetry("error", endedSnapshot)
          if (recordStreamRef.current === stream) {
            recordStreamRef.current = null
          }
        }
      }
      recordChunksRef.current = []
      const mimeType = pickRecordingMimeType()
      const recordingProbe = buildCurrentRecorderSnapshot({ stream, mimeType })
      setRecordingCapabilitySnapshot(recordingProbe)
      const estimatedOffset = estimateLatencyCompensationSec(ctxRef.current, stream)
      const profileOffset = deviceLatencyProfile?.id === profileId ? deviceLatencyProfile.offsetSec : null
      const baselineOffset = Number.isFinite(profileOffset ?? NaN) ? (profileOffset as number) : estimatedOffset
      if (Number.isFinite(estimatedOffset) && estimatedOffset > 0.01) {
        setDeviceLatencyProfile({
          id: profileId,
          label: inputLabelRaw,
          offsetSec: clamp(estimatedOffset, -1, 1),
          updatedAt: new Date().toISOString(),
        })
        activeDeviceProfileId = profileId
      } else if (profileOffset != null) {
        activeDeviceProfileId = profileId
      }
      // Do not overwrite manual user calibration each time.
      if (Math.abs(guestSyncOffsetRef.current) < 0.02 && baselineOffset > 0.01) {
        setGuestSyncOffsetSec(baselineOffset)
      }
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size <= 0) return
        const writer = recordingV2OpfsWriterRef.current
        if (!writer) {
          recordChunksRef.current.push(e.data)
          return
        }
        const seq = recordingV2ChunkSeqRef.current++
        const chunk = e.data
        recordingV2WriteChainRef.current = recordingV2WriteChainRef.current
          .then(async () => {
            const appendResult = await writer.appendChunk(chunk, seq)
            recordingV2OpfsStatsRef.current.bytes = appendResult.totalBytes
            recordingV2OpfsStatsRef.current.chunks = appendResult.chunkCount
            setRecordingV2OpfsBytes(appendResult.totalBytes)
            setRecordingV2OpfsChunks(appendResult.chunkCount)
          })
          .catch(() => {
            recordingV2OpfsStatsRef.current.errors += 1
            setRecordingV2OpfsErrors(recordingV2OpfsStatsRef.current.errors)
            // Fallback path preserves current behavior if OPFS append fails mid-record.
            recordChunksRef.current.push(chunk)
          })
      }
      recorder.onerror = () => {
        recordArmingRef.current = false
        setRecordError(t.recordMicError)
        setRecording(false)
        setRecordingV2OpfsActive(false)
        setRecordingV2UploadState("failed")
        void closeRecordingV2OpfsWriter()
        const errorSnapshot = buildCurrentRecorderSnapshot({
          stream: recordStreamRef.current,
          mimeType: recorder.mimeType || mimeType,
        })
        setRecordingCapabilitySnapshot(errorSnapshot)
        flushRecorderCapabilityTelemetry("error", errorSnapshot)
      }
      recorder.onstop = () => {
        const stopSnapshot = buildCurrentRecorderSnapshot({
          stream: recordStreamRef.current,
          mimeType: recorder.mimeType || mimeType,
        })
        setRecordingCapabilitySnapshot(stopSnapshot)
        flushRecorderCapabilityTelemetry("stop", stopSnapshot)
        teardownRecordingV2Tap()
        void (async () => {
          const outMime = recorder.mimeType || mimeType || "audio/webm"
          let rawBlob = new Blob(recordChunksRef.current, { type: outMime })
          const writer = recordingV2OpfsWriterRef.current
          if (writer) {
            try {
              await recordingV2WriteChainRef.current
              const finalized = await writer.finalizeToBlob(outMime)
              if (finalized.blob.size > 0) {
                rawBlob = finalized.blob
                recordingV2OpfsStatsRef.current.bytes = finalized.byteLength
                recordingV2OpfsStatsRef.current.chunks = finalized.chunkCount
                setRecordingV2OpfsBytes(finalized.byteLength)
                setRecordingV2OpfsChunks(finalized.chunkCount)
              }
            } catch {
              recordingV2OpfsStatsRef.current.errors += 1
              setRecordingV2OpfsErrors(recordingV2OpfsStatsRef.current.errors)
            } finally {
              setRecordingV2OpfsActive(false)
              await closeRecordingV2OpfsWriter()
            }
          }
          if (rawBlob.size < 1024) {
            setRecordError(t.recordTooShort)
            setRecording(false)
            setCountInBeat(null)
            return
          }
          let finalBlob = rawBlob
          try {
            const normalizedBlob = await normalizeRecordedBlobToStereoWav(rawBlob)
            if (normalizedBlob.size > 0) {
              finalBlob = normalizedBlob
            }
          } catch {}
          const takeId = recordingV2TakeSessionIdRef.current || buildGuestTakeId()
          recordingV2TakeSessionIdRef.current = null
          const takeRecordKey = `${guestRecordStorageKey}:take:${takeId}`
          const takeCreatedAt = new Date().toISOString()
          const resolvedReferenceIndex = recordReferenceIndexRef.current
          const takeReferenceIndex = Number.isFinite(resolvedReferenceIndex ?? NaN)
            ? Math.max(0, Number(resolvedReferenceIndex))
            : Math.max(0, selectedSoloTrackIndex)

          const url = URL.createObjectURL(finalBlob)
          setGuestTrackUrl((prev) => {
            scheduleBlobUrlRevoke(prev)
            return url
          })
          saveGuestRecording(finalBlob, takeRecordKey).catch(() => {})
          const nextTake: GuestTakeMeta = {
            id: takeId,
            title: `Take ${new Date(takeCreatedAt).toLocaleTimeString(uiLang === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit" })}`,
            createdAt: takeCreatedAt,
            sourceKey: takeRecordKey,
            referenceTrackIndex: takeReferenceIndex,
            deviceProfileId: activeDeviceProfileId,
            offsetSec: guestSyncOffsetRef.current,
            score: null,
            syncQuality: "unknown",
          }
          setGuestTakes((prev) => [nextTake, ...prev].slice(0, GUEST_TAKES_MAX))
          setActiveGuestTakeId(takeId)
          if (localMasterEnabled && recordingV2OpfsStatsRef.current.bytes > 0) {
            const snapshot = recordingCapabilitySnapshotRef.current
            const uploadMeta = {
              takeId,
              sampleRate: snapshot?.inputSampleRate ?? 48_000,
              channels: snapshot?.inputChannelCount ?? 1,
              codec: "pcm_f32le" as const,
            }
            setRecordingV2UploadState("uploading")
            void (async () => {
              try {
                await uploadRecordingV2TakeFromOpfs(uploadMeta)
                setRecordingV2UploadState("uploaded")
              } catch {
                enqueueRecordingV2Upload(uploadMeta)
                setRecordingV2UploadState("queued")
              }
            })()
          }
          setRecording(false)
          setCountInBeat(null)
          const autoAligned = await calibrateGuestDelay({ silent: true, keepPosition: true, guestUrlOverride: url })
          const syncedScore = guestCalibrateScoreRef.current
          const syncedQuality = guestSyncQualityRef.current
          setGuestTakes((prev) =>
            prev.map((take) =>
              take.id === takeId
                ? {
                    ...take,
                    offsetSec: guestSyncOffsetRef.current,
                    score: syncedScore,
                    syncQuality: syncedQuality,
                    durationSec: guestDuration || undefined,
                  }
                : take
            )
          )
          if (!autoAligned) {
            setRecordError(t.recordSyncAutoCheckFailed)
          } else if (guestSyncQualityRef.current === "low") {
            setGuestLowConfidenceRuns((prev) => prev + 1)
            setRecordError(t.recordSyncUnstable)
          }
        })()
      }

      pause()
      seekTo(0)
      const guestAudio = guestAudioRef.current
      if (guestAudio) {
        guestAudio.pause()
        guestAudio.currentTime = 0
        setGuestCurrentTime(0)
      }

      let beat = COUNT_IN_BEATS
      setCountInBeat(beat)
      playCountInClick(false).catch(() => {})
      const beatMs = Math.round((60 / COUNT_IN_BPM) * 1000)

      countInTimerRef.current = window.setInterval(() => {
        beat -= 1
        if (beat <= 0) {
          if (countInTimerRef.current != null) {
            window.clearInterval(countInTimerRef.current)
            countInTimerRef.current = null
          }
          setCountInBeat(null)
          if (recorderRef.current !== recorder || recorder.state !== "inactive") {
            recordArmingRef.current = false
            setRecordError(t.recordAlreadyRunning)
            return
          }
          recorder.onstart = () => {
            setRecording(true)
            recordArmingRef.current = false
            const startSnapshot = buildCurrentRecorderSnapshot({
              stream: recordStreamRef.current,
              mimeType: recorder.mimeType || mimeType,
            })
            setRecordingCapabilitySnapshot(startSnapshot)
            flushRecorderCapabilityTelemetry("start", startSnapshot)
            play()
          }
          try {
            if (localMasterEnabled) recorder.start(1000)
            else recorder.start()
          } catch {
            recordArmingRef.current = false
            setRecording(false)
            setRecordError(t.recordStartFailed)
          }
          return
        }
        setCountInBeat(beat)
        playCountInClick(beat === 1).catch(() => {})
      }, beatMs)
    } catch {
      recordArmingRef.current = false
      teardownRecordingV2Tap()
      setRecordingV2OpfsActive(false)
      void closeRecordingV2OpfsWriter()
      setRecordError(t.recordMicPermissionDenied)
      setRecording(false)
      setCountInBeat(null)
    }
  }

  const stopGuestRecording = () => {
    recordArmingRef.current = false
    guestTransportLinkedRef.current = false
    guestCalibratingRef.current = false
    setGuestCalibrating(false)
    clearGuestCalibrateTimer()
    setCalibrationMute(false)
    if (countInTimerRef.current != null) {
      window.clearInterval(countInTimerRef.current)
      countInTimerRef.current = null
      setCountInBeat(null)
    }
    teardownRecordingV2Tap()
    setRecordingV2OpfsActive(false)
    void closeRecordingV2OpfsWriter()
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop()
    }
    setRecording(false)
    guestStartupBiasSecRef.current = 0
    pause()
  }

  const activateGuestTake = async (takeId: string) => {
    const take = guestTakes.find((item) => item.id === takeId)
    if (!take) return
    const blob = await loadGuestRecordingByKey(take.sourceKey)
    if (!blob) {
      setRecordError(t.recordTakeLoadFailed)
      return
    }
    const url = URL.createObjectURL(blob)
    setGuestTrackUrl((prev) => {
      scheduleBlobUrlRevoke(prev)
      return url
    })
    setActiveGuestTakeId(take.id)
    setRecordReferenceIndex(take.referenceTrackIndex)
    setGuestCalibrateReady(false)
    setGuestCalibrateScore(take.score ?? null)
    setGuestSyncQuality(take.syncQuality ?? "unknown")
    setGuestSyncOffsetSec(typeof take.offsetSec === "number" ? clamp(take.offsetSec, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC) : guestSyncOffsetRef.current)
    guestNeedsRecalibrateRef.current = true
    if (isPlayingRef.current || guestIsPlaying) {
      pause()
      guestTransportLinkedRef.current = false
    }
  }

  const runGuestActionLocked = useCallback(async (action: () => Promise<void>) => {
    if (guestActionBusyRef.current) return false
    guestActionBusyRef.current = true
    setGuestActionBusy(true)
    try {
      await action()
      return true
    } finally {
      guestActionBusyRef.current = false
      setGuestActionBusy(false)
    }
  }, [])

  const playGuestOnly = async () => {
    await runGuestActionLocked(async () => {
      const audio = guestAudioRef.current
      if (!audio) return
      setRecordError(null)
      setGuestCalibrateReady(false)
      guestTransportLinkedRef.current = false
      guestStartupBiasSecRef.current = 0
      setGuestSoloMode(true)
      forceStopMainTransport()
      // Hard mute main bus immediately to avoid any residual solo bleed into guest-only monitoring.
      rampGainTo(masterGainRef.current, 0, 0.015)
      const graphReady = await ensureGuestPlaybackGraph()
      audio.muted = guestMuted
      audio.volume = graphReady ? 0 : (guestMuted ? 0 : Math.min(1, guestVolume))
      try {
        await audio.play()
        setGuestIsPlaying(true)
      } catch {
        setRecordError(t.guestPlaybackFailed)
      }
    })
  }

  const playGuestWithTrack = async () => {
    await runGuestActionLocked(async () => {
      if (!guestAudioRef.current) return
      if (selectedSoloTrackIndex < 0) {
        setRecordError(t.guestTrackModeRequireSolo)
        return
      }
      if (referenceLockEnabled) {
        const locked = recordReferenceIndexRef.current
        if (locked != null && selectedSoloTrackIndex !== locked) {
          setRecordError(t.referenceLockRequireSoloBeforeStart)
          return
        }
        if (locked == null) setRecordReferenceIndex(selectedSoloTrackIndex)
      }
      setRecordError(null)
      setGuestSoloMode(false)
      await primeGuestAudioAutoplay()
      guestTransportLinkedRef.current = true
      guestStartupBiasSecRef.current = GUEST_STARTUP_BIAS_SEC
      guestStartupBiasStartedAtRef.current = Date.now()
      const audio = guestAudioRef.current
      if (audio) {
        const graphReady = await ensureGuestPlaybackGraph()
        audio.muted = guestMuted
        audio.volume = graphReady ? 0 : (guestMuted ? 0 : Math.min(1, guestVolume))
      }
      const startPos = guestTogetherFirstStartRef.current
        ? 0
        : clamp(positionSecRef.current, 0, duration || positionSecRef.current)
      guestTogetherFirstStartRef.current = false
      seekTo(startPos)

      await play("guest_with_track")
    })
  }

  const calibrateGuestDelay = async (options?: { silent?: boolean; keepPosition?: boolean; guestUrlOverride?: string }) => {
    const silent = options?.silent ?? false
    const keepPosition = options?.keepPosition ?? false
    const calibrateGuestUrl = options?.guestUrlOverride || guestTrackUrlRef.current || guestTrackUrl
    const audio = guestAudioRef.current
    if (!audio) return
    if (guestCalibratingRef.current) return
    if (selectedSoloTrackIndex < 0) {
      if (!silent) setRecordError(t.calibrateRequireSolo)
      return
    }
    if (!calibrateGuestUrl) {
      if (!silent) setRecordError(t.calibrateRequireTake)
      return
    }
    const ctx = ctxRef.current
    if (!ctx) {
      if (!silent) setRecordError(t.audioEngineNotReady)
      return
    }

    if (!silent) setRecordError(null)
    guestStartupBiasSecRef.current = 0
    guestCalibratingRef.current = true
    setGuestCalibrating(true)
    if (!silent) setGuestCalibrateReady(false)
    setGuestCalibrateScore(null)
    setGuestSyncQuality("unknown")
    setGuestSyncRuns((prev) => prev + 1)
    clearGuestCalibrateTimer()
    const originalPos = positionSecRef.current

    try {
      const [mainRes, guestRes] = await Promise.all([
        fetch(trackList[selectedSoloTrackIndex].src),
        fetch(calibrateGuestUrl),
      ])
      if (!mainRes.ok || !guestRes.ok) throw new Error("fetch")

      const [mainArr, guestArr] = await Promise.all([mainRes.arrayBuffer(), guestRes.arrayBuffer()])
      const [mainBuf, guestBuf] = await Promise.all([
        ctx.decodeAudioData(mainArr.slice(0)),
        ctx.decodeAudioData(guestArr.slice(0)),
      ])

      const attempts = [
        { binSec: 0.02, secWindow: 60, minScore: 0.18 },
        { binSec: 0.03, secWindow: 120, minScore: 0.12 },
      ] as const
      let best: { lagBins: number; score: number; binSec: number; minScore: number } | null = null
      const baseOffsetSecRaw = Number.isFinite(guestSyncOffsetRef.current) ? guestSyncOffsetRef.current : DEFAULT_GUEST_SYNC_SEC
      const baseOffsetSec = Math.abs(baseOffsetSecRaw) > 0.9 ? DEFAULT_GUEST_SYNC_SEC : baseOffsetSecRaw
      const preferredLagBinsByAttempt = attempts.map((a) => Math.round(baseOffsetSec / a.binSec))

      for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
        const attempt = attempts[attemptIndex]
        const mainEnv = buildRmsEnvelopeByTime(mainBuf, attempt.binSec, attempt.secWindow)
        const guestEnv = buildRmsEnvelopeByTime(guestBuf, attempt.binSec, attempt.secWindow)
        const maxLagBins = Math.round(Math.min(GUEST_CALIBRATE_MAX_ABS_SEC, Math.abs(baseOffsetSec) + GUEST_CALIBRATE_SEARCH_SWING_SEC) / attempt.binSec)
        const { lagBins, score } = estimateOffsetByCorrelation(mainEnv, guestEnv, maxLagBins, preferredLagBinsByAttempt[attemptIndex] ?? 0)
        if (!Number.isFinite(score)) continue
        if (!best || score > best.score) {
          best = { lagBins, score, binSec: attempt.binSec, minScore: attempt.minScore }
        }
      }

      if (!best || best.score < best.minScore) {
        throw new Error("low-correlation")
      }

      // Fine pass around coarse estimate for sub-20ms stability.
      let finalLagBins = best.lagBins
      let finalBinSec = best.binSec
      let finalScore = best.score
      try {
        const fineMainEnv = buildRmsEnvelopeByTime(mainBuf, GUEST_CALIBRATE_FINE_BIN_SEC, 90)
        const fineGuestEnv = buildRmsEnvelopeByTime(guestBuf, GUEST_CALIBRATE_FINE_BIN_SEC, 90)
        const coarseSec = best.lagBins * best.binSec
        const fineCenterLag = Math.round(coarseSec / GUEST_CALIBRATE_FINE_BIN_SEC)
        const fineWindowLag = Math.max(1, Math.round(GUEST_CALIBRATE_FINE_WINDOW_SEC / GUEST_CALIBRATE_FINE_BIN_SEC))
        const fineResult = estimateOffsetByCorrelationInRange(
          fineMainEnv,
          fineGuestEnv,
          fineCenterLag - fineWindowLag,
          fineCenterLag + fineWindowLag,
          fineCenterLag
        )
        if (Number.isFinite(fineResult.score) && fineResult.score >= best.minScore - 0.02) {
          finalLagBins = fineResult.lagBins
          finalBinSec = GUEST_CALIBRATE_FINE_BIN_SEC
          finalScore = fineResult.score
        }
      } catch {}

      const offsetSec = clamp(finalLagBins * finalBinSec, GUEST_SYNC_MIN_SEC, GUEST_SYNC_MAX_SEC)
      if (Math.abs(offsetSec - baseOffsetSec) > GUEST_CALIBRATE_MAX_JUMP_SEC) {
        throw new Error("implausible-jump")
      }
      if (Math.abs(offsetSec) > 1.6) {
        throw new Error("implausible-offset")
      }
      setGuestSyncOffsetSec(offsetSec)
      setGuestCalibrateReady(true)
      const roundedScore = Number(finalScore.toFixed(3))
      setGuestCalibrateScore(roundedScore)
      const quality = classifyGuestSyncQuality(finalScore)
      setGuestSyncQuality(quality)
      if (quality === "low") setGuestLowConfidenceRuns((prev) => prev + 1)
      guestNeedsRecalibrateRef.current = false
      if (keepPosition) {
        syncGuestToMain(originalPos, true)
      } else {
        seekTo(0)
        syncGuestToMain(0, true)
      }
      return true
    } catch {
      if (!silent) {
        setRecordError(t.calibrateMeasureFailed)
      }
      setGuestCalibrateReady(false)
      setGuestCalibrateScore(null)
      setGuestSyncQuality("unknown")
      return false
    } finally {
      guestCalibratingRef.current = false
      setGuestCalibrating(false)
    }
  }

  const resetGuestAndMainToStart = () => {
    pause()
    pauseGuestSolo()
    guestTransportLinkedRef.current = false
    guestTogetherFirstStartRef.current = false
    seekTo(0)
    const audio = guestAudioRef.current
    if (audio) {
      audio.currentTime = 0
      setGuestCurrentTime(0)
    }
  }

  const downloadByUrl = (url: string, filename: string) => {
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const encodeBufferToCompressedBlob = async (buffer: AudioBuffer, format: Exclude<ExportFormat, "wav">): Promise<Blob> => {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder unavailable")
    }
    const mimeType = mimeByExportFormat(format)
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      throw new Error(`format ${format} unsupported`)
    }
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) throw new Error("AudioContext unavailable")

    const ctx = new AudioContextCtor()
    try {
      const dest = ctx.createMediaStreamDestination()
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(dest)

      const chunks: BlobPart[] = []
      const rec = new MediaRecorder(dest.stream, { mimeType })
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      const done = new Promise<Blob>((resolve, reject) => {
        rec.onerror = () => reject(new Error("MediaRecorder error"))
        rec.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
      })

      await ctx.resume()
      rec.start()
      source.start()
      source.onended = () => {
        try {
          if (rec.state !== "inactive") rec.stop()
        } catch {}
      }
      return await done
    } finally {
      void ctx.close()
    }
  }

  const decodeAudioFromUrl = async (url: string): Promise<AudioBuffer> => {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) throw new Error("AudioContext unavailable")
    const ctx = new AudioContextCtor()
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error("fetch")
      const arr = await res.arrayBuffer()
      return await ctx.decodeAudioData(arr.slice(0))
    } finally {
      void ctx.close()
    }
  }

  const exportAudioBuffer = async (buffer: AudioBuffer, format: ExportFormat): Promise<Blob> => {
    if (format === "wav") {
      const left = buffer.getChannelData(0)
      const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)
      return encodeStereoWav(left, right, buffer.sampleRate)
    }
    return encodeBufferToCompressedBlob(buffer, format)
  }

  const exportAudioBufferWithFallback = async (
    buffer: AudioBuffer,
    preferredFormat: ExportFormat
  ): Promise<{ blob: Blob; formatUsed: ExportFormat; usedFallback: boolean }> => {
    try {
      const blob = await exportAudioBuffer(buffer, preferredFormat)
      return { blob, formatUsed: preferredFormat, usedFallback: false }
    } catch {
      if (preferredFormat === "wav") throw new Error("WAV_EXPORT_FAILED")
      const wavBlob = await exportAudioBuffer(buffer, "wav")
      return { blob: wavBlob, formatUsed: "wav", usedFallback: true }
    }
  }

  const downloadGuestSolo = async (format: ExportFormat) => {
    if (!guestTrackUrl) {
      setRecordError(t.exportRequireTake)
      return
    }
    if (guestExportingDuet) return
    setGuestDownloadMenuOpen(false)
    setGuestDuetMixOpen(false)
    setGuestExportingDuet(true)
    setRecordError(null)
    try {
      const guestBuf = await decodeAudioFromUrl(guestTrackUrl)
      const exported = await exportAudioBufferWithFallback(guestBuf, format)
      const blob = exported.blob
      const url = URL.createObjectURL(blob)
      downloadByUrl(url, `russian-raspev-guest-solo.${exported.formatUsed}`)
      if (exported.usedFallback) {
        setRecordError(t.exportFallbackWav)
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch {
      if (format === "mp3") setRecordError(t.exportMp3Unavailable)
      else if (format === "m4a") setRecordError(t.exportM4aUnavailable)
      else setRecordError(t.exportSoloFailed)
    } finally {
      setGuestExportingDuet(false)
    }
  }

  const downloadGuestDuet = async () => {
    if (!guestTrackUrl) {
      setRecordError(t.exportRequireTake)
      return
    }
    if (selectedSoloTrackIndex < 0) {
      setRecordError(t.exportDuetRequireSolo)
      return
    }
    const ctx = ctxRef.current
    if (!ctx) {
      setRecordError(t.audioEngineNotReady)
      return
    }
    const OfflineContextCtor =
      window.OfflineAudioContext ||
      (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    if (!OfflineContextCtor) {
      setRecordError(t.exportDuetUnsupported)
      return
    }

    setGuestDownloadMenuOpen(false)
    setGuestDuetMixOpen(false)
    setGuestExportingDuet(true)
    setRecordError(null)
    try {
      pause()
      setGuestSoloMode(false)
      guestTransportLinkedRef.current = false

      // Triple calibration before duet export for maximum sync precision.
      for (let i = 0; i < 3; i++) {
        const ok = await calibrateGuestDelay({ silent: true, keepPosition: true })
        if (!ok) {
          setRecordError(t.exportDuetCalibrateFailed)
          return
        }
      }

      const [mainRes, guestRes] = await Promise.all([
        fetch(trackList[selectedSoloTrackIndex].src),
        fetch(guestTrackUrl),
      ])
      if (!mainRes.ok || !guestRes.ok) {
        setRecordError(t.exportDuetTrackLoadFailed)
        return
      }
      const [mainArr, guestArr] = await Promise.all([mainRes.arrayBuffer(), guestRes.arrayBuffer()])
      const [mainBuf, guestBuf] = await Promise.all([
        ctx.decodeAudioData(mainArr.slice(0)),
        ctx.decodeAudioData(guestArr.slice(0)),
      ])

      const duetLenSec = Math.max(0.1, guestBuf.duration)
      const sampleRate = Math.max(44100, mainBuf.sampleRate, guestBuf.sampleRate)
      const totalFrames = Math.max(1, Math.ceil(duetLenSec * sampleRate))
      const offline = new OfflineContextCtor(2, totalFrames, sampleRate)

      const master = offline.createGain()
      master.gain.value = 1
      master.connect(offline.destination)

      const offsetSec = guestSyncOffsetRef.current
      const mainSrc = offline.createBufferSource()
      mainSrc.buffer = mainBuf
      const mainGain = offline.createGain()
      mainGain.gain.value = clamp(duetSoloLevel / 100, 0, 1.5)
      mainSrc.connect(mainGain)
      mainGain.connect(master)
      {
        const mainPlayableSec = Math.min(duetLenSec, Math.max(0, mainBuf.duration))
        if (mainPlayableSec > 0.01) {
          mainSrc.start(0, 0, mainPlayableSec)
        }
      }

      // Keep duet export alignment identical to live playback:
      // guestTimelineTime = mainTimelineTime + offsetSec.
      const guestSrc = offline.createBufferSource()
      guestSrc.buffer = guestBuf
      const guestGain = offline.createGain()
      guestGain.gain.value = clamp(duetGuestLevel / 100, 0, 1.5)
      guestSrc.connect(guestGain)
      guestGain.connect(master)

      if (offsetSec >= 0) {
        const guestStartInSource = offsetSec
        const guestPlayableSec = Math.min(duetLenSec, Math.max(0, guestBuf.duration - guestStartInSource))
        if (guestPlayableSec > 0.01) {
          guestSrc.start(0, guestStartInSource, guestPlayableSec)
        }
      } else {
        const guestStartInOutput = -offsetSec
        const guestPlayableSec = Math.min(Math.max(0, duetLenSec - guestStartInOutput), guestBuf.duration)
        if (guestPlayableSec > 0.01) {
          guestSrc.start(guestStartInOutput, 0, guestPlayableSec)
        }
      }

      const rendered = await offline.startRendering()
      const exported = await exportAudioBufferWithFallback(rendered, duetFormat)
      const blob = exported.blob
      const duetUrl = URL.createObjectURL(blob)
      downloadByUrl(duetUrl, `russian-raspev-guest-duet.${exported.formatUsed}`)
      if (exported.usedFallback) {
        setRecordError(t.exportDuetFallbackWav)
      }
      window.setTimeout(() => URL.revokeObjectURL(duetUrl), 1500)
    } catch {
      if (duetFormat === "mp3") setRecordError(t.exportMp3Unavailable)
      else if (duetFormat === "m4a") setRecordError(t.exportM4aUnavailable)
      else setRecordError(t.exportDuetFailed)
    } finally {
      setGuestExportingDuet(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const buildGuestWave = async () => {
      if (!guestTrackUrl || !ctxRef.current) {
        guestPeaksRef.current = null
        setGuestWaveReady(false)
        setGuestCurrentTime(0)
        setGuestDuration(0)
        return
      }

      const res = await fetch(guestTrackUrl)
      const arr = await res.arrayBuffer()
      const buffer = await ctxRef.current.decodeAudioData(arr.slice(0))
      if (cancelled) return
      guestPeaksRef.current = computePeaks(buffer, 1200)
      setGuestDuration(buffer.duration)
      setGuestWaveReady(true)
      setGuestCurrentTime(0)
    }

    buildGuestWave().catch(() => {
      guestPeaksRef.current = makeFlatPeaks(1200)
      setGuestWaveReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [guestTrackUrl])

  useEffect(() => {
    if (!guestWaveReady || !guestDuration) return
    const canvas = guestCanvasRef.current
    const peaks = guestPeaksRef.current
    if (!canvas || !peaks) return
    drawWaveform(canvas, peaks, clamp(guestCurrentTime / guestDuration, 0, 1))
  }, [guestWaveReady, guestCurrentTime, guestDuration])

  const guestSeekTo = (sec: number) => {
    const audio = guestAudioRef.current
    if (!audio || !guestDuration) return

    // Manual guest scrub should stop current playback; next Play will recalibrate/relink.
    if (isPlayingRef.current || guestIsPlaying) {
      pause()
      setGuestSoloMode(false)
      guestTransportLinkedRef.current = false
    }

    const pos = clamp(sec, 0, guestDuration)
    audio.currentTime = pos
    setGuestCurrentTime(pos)
    guestNeedsRecalibrateRef.current = true

    // Allow selecting joint playback position directly on guest waveform.
    const mappedMainPos = clamp(
      pos - (guestSyncOffsetRef.current + getStartupBiasSec()),
      0,
      duration || pos
    )
    if (guestTransportLinkedRef.current || !isPlayingRef.current) {
      seekTo(mappedMainPos)
    }
  }

  const guestScrubFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!guestDuration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const p = clamp(x / rect.width, 0, 1)
    guestSeekTo(p * guestDuration)
  }

  const onGuestWavePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
    guestScrubRef.current = true
    guestScrubFromEvent(e)
  }

  const onGuestWavePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!guestScrubRef.current) return
    guestScrubFromEvent(e)
  }

  const onGuestWavePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    guestScrubRef.current = false
    try {
      ;(e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  const effectiveTeleprompterLines = useMemo(() => {
    if (!teleprompterLines.length) return []
    return teleprompterLines.map((line, index) => ({
      ...line,
      time: teleprompterAnchors[index] ?? line.time,
      text: Object.prototype.hasOwnProperty.call(teleprompterTextOverrides, index)
        ? teleprompterTextOverrides[index]
        : line.text,
    }))
  }, [teleprompterAnchors, teleprompterLines, teleprompterTextOverrides])
  const effectiveTeleprompterSignature = useMemo(
    () => buildTeleprompterLinesSignature(effectiveTeleprompterLines),
    [effectiveTeleprompterLines]
  )

  const persistTeleprompterJson = useCallback((storageKey: string | null, value: unknown) => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {}
  }, [])

  const flushTeleprompterDraftNow = useCallback(() => {
    const lines = teleprompterLinesRef.current
    const anchors = teleprompterAnchorsRef.current
    const textOverrides = teleprompterTextOverridesRef.current
    const savedAt = new Date().toISOString()
    persistTeleprompterJson(teleprompterLinesStorageKey, lines)
    persistTeleprompterJson(teleprompterAnchorStorageKey, anchors)
    persistTeleprompterJson(teleprompterTextStorageKey, textOverrides)
    persistTeleprompterJson(teleprompterStateStorageKey, {
      savedAt,
      lines,
      anchors,
      textOverrides,
    } satisfies TeleprompterDraftState)
    teleprompterDraftDirtyRef.current = false
    setTeleprompterDraftDirty(false)
    setTeleprompterDraftSavedAt(savedAt)
  }, [
    persistTeleprompterJson,
    teleprompterAnchorStorageKey,
    teleprompterLinesStorageKey,
    teleprompterStateStorageKey,
    teleprompterTextStorageKey,
  ])

  useEffect(() => {
    if (teleprompterSkipDirtyMarkRef.current) {
      teleprompterSkipDirtyMarkRef.current = false
      return
    }
    teleprompterDraftDirtyRef.current = true
    setTeleprompterDraftDirty(true)
  }, [teleprompterAnchors, teleprompterLines, teleprompterTextOverrides])

  useEffect(() => {
    if (!teleprompterDraftDirty) return
    const timer = window.setTimeout(() => {
      flushTeleprompterDraftNow()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [flushTeleprompterDraftNow, teleprompterDraftDirty])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!teleprompterDraftDirtyRef.current) return
      flushTeleprompterDraftNow()
    }, 1200)
    return () => window.clearInterval(timer)
  }, [flushTeleprompterDraftNow])

  useEffect(() => {
    const flush = () => flushTeleprompterDraftNow()
    const flushOnHidden = () => {
      if (document.visibilityState === "hidden") flushTeleprompterDraftNow()
    }
    window.addEventListener("pagehide", flush)
    window.addEventListener("beforeunload", flush)
    document.addEventListener("visibilitychange", flushOnHidden)
    return () => {
      window.removeEventListener("pagehide", flush)
      window.removeEventListener("beforeunload", flush)
      document.removeEventListener("visibilitychange", flushOnHidden)
    }
  }, [flushTeleprompterDraftNow])

  const setTeleprompterAnchorAtCurrentTime = useCallback(
    (lineIndex: number) => {
      if (lineIndex < 0 || lineIndex >= effectiveTeleprompterLines.length) return
      const rawTime = Math.max(0, Number(currentTime.toFixed(3)))
      setTeleprompterAnchors((prevMap) => {
        const nextMap = { ...prevMap, [lineIndex]: rawTime }
        teleprompterAnchorsRef.current = nextMap
        persistTeleprompterJson(teleprompterAnchorStorageKey, nextMap)
        return nextMap
      })
    },
    [currentTime, effectiveTeleprompterLines, persistTeleprompterJson, teleprompterAnchorStorageKey]
  )

  const clearTeleprompterAnchor = useCallback((lineIndex: number) => {
    setTeleprompterAnchors((prevMap) => {
      if (!(lineIndex in prevMap)) return prevMap
      const nextMap = { ...prevMap }
      delete nextMap[lineIndex]
      teleprompterAnchorsRef.current = nextMap
      persistTeleprompterJson(teleprompterAnchorStorageKey, nextMap)
      return nextMap
    })
  }, [persistTeleprompterJson, teleprompterAnchorStorageKey])

  const setTeleprompterTextOverride = useCallback((lineIndex: number, text: string) => {
    setTeleprompterTextOverrides((prevMap) => {
      const nextMap = { ...prevMap, [lineIndex]: text }
      teleprompterTextOverridesRef.current = nextMap
      persistTeleprompterJson(teleprompterTextStorageKey, nextMap)
      return nextMap
    })
  }, [persistTeleprompterJson, teleprompterTextStorageKey])

  const clearTeleprompterTextOverride = useCallback((lineIndex: number) => {
    setTeleprompterTextOverrides((prevMap) => {
      if (!(lineIndex in prevMap)) return prevMap
      const nextMap = { ...prevMap }
      delete nextMap[lineIndex]
      teleprompterTextOverridesRef.current = nextMap
      persistTeleprompterJson(teleprompterTextStorageKey, nextMap)
      return nextMap
    })
  }, [persistTeleprompterJson, teleprompterTextStorageKey])

  const resetTeleprompterAnchors = useCallback(() => {
    teleprompterAnchorsRef.current = {}
    persistTeleprompterJson(teleprompterAnchorStorageKey, {})
    setTeleprompterAnchors({})
  }, [persistTeleprompterJson, teleprompterAnchorStorageKey])

  const resetTeleprompterTextOverrides = useCallback(() => {
    teleprompterTextOverridesRef.current = {}
    persistTeleprompterJson(teleprompterTextStorageKey, {})
    setTeleprompterTextOverrides({})
  }, [persistTeleprompterJson, teleprompterTextStorageKey])

  const copyTeleprompterAnchorsJson = useCallback(async () => {
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    const payload = {
      sourceUrl: effectiveTeleprompterSourceUrl,
      generatedAt: new Date().toISOString(),
      anchors: effectiveTeleprompterLines.map((line, index) => ({
        index,
        time: Number(line.time.toFixed(3)),
        text: line.text,
        anchored: Object.prototype.hasOwnProperty.call(teleprompterAnchors, index),
      })),
    }
    const text = JSON.stringify(payload, null, 2)
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.left = "-9999px"
    document.body.appendChild(ta)
    ta.select()
    document.execCommand("copy")
    document.body.removeChild(ta)
  }, [effectiveTeleprompterLines, teleprompterAnchors, effectiveTeleprompterSourceUrl])

  const downloadTeleprompterAnchorsJson = useCallback(() => {
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    const payload = {
      sourceUrl: effectiveTeleprompterSourceUrl,
      generatedAt: new Date().toISOString(),
      anchors: effectiveTeleprompterLines.map((line, index) => ({
        index,
        time: Number(line.time.toFixed(3)),
        text: line.text,
        anchored: Object.prototype.hasOwnProperty.call(teleprompterAnchors, index),
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "teleprompter-anchors.json"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [effectiveTeleprompterLines, teleprompterAnchors, effectiveTeleprompterSourceUrl])

  const downloadTeleprompterBackupJson = useCallback(() => {
    const now = new Date()
    const generatedAt = now.toISOString()
    const pad2 = (n: number) => String(n).padStart(2, "0")
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
    const payload = {
      backup_version: "v1",
      generated_at: generatedAt,
      song_scope: trackScopeId,
      source_url: effectiveTeleprompterSourceUrl ?? null,
      storage_keys: {
        state: teleprompterStateStorageKey,
        lines: teleprompterLinesStorageKey,
        anchors: teleprompterAnchorStorageKey,
        text_overrides: teleprompterTextStorageKey,
      },
      draft_saved_at: teleprompterDraftSavedAt || null,
      lines_raw: teleprompterLines,
      anchors: teleprompterAnchors,
      text_overrides: teleprompterTextOverrides,
      lines_effective: effectiveTeleprompterLines,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `teleprompter-backup-${trackScopeId.slice(0, 56)}-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [
    effectiveTeleprompterLines,
    effectiveTeleprompterSourceUrl,
    teleprompterAnchorStorageKey,
    teleprompterAnchors,
    teleprompterDraftSavedAt,
    teleprompterLines,
    teleprompterLinesStorageKey,
    teleprompterStateStorageKey,
    teleprompterTextOverrides,
    teleprompterTextStorageKey,
    trackScopeId,
  ])

  const triggerTeleprompterBackupImport = useCallback(() => {
    setTeleprompterBackupInfo("")
    teleprompterBackupInputRef.current?.click()
  }, [])

  const importTeleprompterBackupJson = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget
      const file = input.files?.[0]
      if (!file) return
      setTeleprompterBackupInfo(t.teleprompterBackupImporting)
      try {
        const raw = await file.text()
        const parsed = JSON.parse(raw) as TeleprompterBackupPayload
        if (!parsed || typeof parsed !== "object") throw new Error("invalid_backup_json")

        const linesInput = parsed.lines_raw ?? parsed.lines ?? parsed.lines_effective ?? []
        const nextLines = normalizeTeleprompterLines(linesInput)
        if (!nextLines.length) throw new Error("backup_has_no_lines")

        const nextAnchors = normalizeTeleprompterAnchors(parsed.anchors ?? {})
        const nextTextOverrides = normalizeTeleprompterTextOverrides(parsed.text_overrides ?? parsed.textOverrides ?? {})
        const savedAt =
          typeof parsed.draft_saved_at === "string" && parsed.draft_saved_at
            ? parsed.draft_saved_at
            : new Date().toISOString()

        teleprompterSkipDirtyMarkRef.current = true
        teleprompterLinesRef.current = nextLines
        teleprompterAnchorsRef.current = nextAnchors
        teleprompterTextOverridesRef.current = nextTextOverrides
        setTeleprompterLines(nextLines)
        setTeleprompterAnchors(nextAnchors)
        setTeleprompterTextOverrides(nextTextOverrides)

        persistTeleprompterJson(teleprompterLinesStorageKey, nextLines)
        persistTeleprompterJson(teleprompterAnchorStorageKey, nextAnchors)
        persistTeleprompterJson(teleprompterTextStorageKey, nextTextOverrides)
        persistTeleprompterJson(teleprompterStateStorageKey, {
          savedAt,
          lines: nextLines,
          anchors: nextAnchors,
          textOverrides: nextTextOverrides,
        } satisfies TeleprompterDraftState)

        teleprompterDraftDirtyRef.current = false
        setTeleprompterDraftDirty(false)
        setTeleprompterDraftSavedAt(savedAt)
        setTeleprompterBackupInfo(`${t.teleprompterBackupImportedPrefix} ${nextLines.length} ${t.teleprompterLinesWord}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : "backup_import_failed"
        setTeleprompterBackupInfo(`${t.teleprompterImportErrorPrefix} ${message}`)
      } finally {
        input.value = ""
      }
    },
    [
      persistTeleprompterJson,
      teleprompterAnchorStorageKey,
      teleprompterLinesStorageKey,
      teleprompterStateStorageKey,
      teleprompterTextStorageKey,
      t,
    ]
  )

  const datasetRows = useMemo(() => {
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    const now = new Date().toISOString()
    return effectiveTeleprompterLines.map((line, index) => {
      const next = effectiveTeleprompterLines[index + 1]
      const sourceLine = teleprompterLines[index]
      const endSec = next ? Number(next.time.toFixed(3)) : duration > line.time ? Number(duration.toFixed(3)) : null
      return {
        dataset_version: "v1",
        exported_at: now,
        song_scope: trackScopeId,
        source_url: effectiveTeleprompterSourceUrl,
        primary_track_name: trackList[0]?.name ?? null,
        primary_track_src: trackList[0]?.src ?? null,
        line_index: index,
        start_sec: Number(line.time.toFixed(3)),
        end_sec: endSec,
        duration_sec: endSec != null ? Number((endSec - line.time).toFixed(3)) : null,
        text_source: sourceLine?.text ?? line.text,
        text_final: line.text,
        is_anchor_manual: Object.prototype.hasOwnProperty.call(teleprompterAnchors, index),
        is_text_edited: Object.prototype.hasOwnProperty.call(teleprompterTextOverrides, index),
      }
    })
  }, [
    duration,
    effectiveTeleprompterLines,
    teleprompterAnchors,
    teleprompterLines,
    effectiveTeleprompterSourceUrl,
    teleprompterTextOverrides,
    trackList,
    trackScopeId,
  ])

  const postTeleprompterDatasetSnapshot = useCallback(
    async (reason: "manual" | "auto") => {
      if (!datasetRows || !datasetRows.length) return
      setTeleprompterCollectState("saving")
      setTeleprompterCollectInfo(t.teleprompterCollectSaving)
      try {
        const snapshotId = `${trackScopeId}-${reason}-${Date.now()}`
        const res = await fetch("/api/dataset/teleprompter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshotId, rows: datasetRows }),
        })
        const data = await res.json()
        if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `http_${res.status}`))
        setTeleprompterCollectState("saved")
        if (data?.deduplicated) {
          setTeleprompterCollectInfo(
            uiLang === "ru"
              ? "без изменений; identical snapshot не дописан"
              : "unchanged; identical snapshot was skipped"
          )
        } else {
          setTeleprompterCollectInfo(`${t.teleprompterCollectSavedPrefix} ${data.rowsWritten} ${t.teleprompterLinesWord}`)
        }
      } catch (e) {
        setTeleprompterCollectState("error")
        setTeleprompterCollectInfo(`${t.teleprompterErrorPrefix} ${e instanceof Error ? e.message : "save_failed"}`)
      }
    },
    [datasetRows, t, trackScopeId, uiLang]
  )

  useEffect(() => {
    if (!teleprompterAutoCollectAllowed) return
    if (!teleprompterAutoCollect) return
    if (!effectiveTeleprompterSourceUrl || !datasetRows?.length) return
    if (!teleprompterAutoCollectPrimedRef.current) {
      teleprompterAutoCollectPrimedRef.current = true
      return
    }
    const timer = window.setTimeout(() => {
      void postTeleprompterDatasetSnapshot("auto")
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [
    datasetRows,
    postTeleprompterDatasetSnapshot,
    teleprompterAnchors,
    teleprompterAutoCollectAllowed,
    teleprompterAutoCollect,
    effectiveTeleprompterSourceUrl,
    teleprompterTextOverrides,
  ])

  const copyTeleprompterDatasetJsonl = useCallback(async () => {
    if (!datasetRows || !datasetRows.length) return
    const rows = datasetRows
    const jsonl = rows.map((r) => JSON.stringify(r)).join("\n")
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(jsonl)
      return
    }
    const ta = document.createElement("textarea")
    ta.value = jsonl
    ta.style.position = "fixed"
    ta.style.left = "-9999px"
    document.body.appendChild(ta)
    ta.select()
    document.execCommand("copy")
    document.body.removeChild(ta)
  }, [datasetRows])

  const copyAudioDebugLog = useCallback(async () => {
    const text = formatAudioDebugBuffer(getAudioDebugBufferSnapshot())
    if (!text) {
      setAudioDebugCopyState("error")
      return
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement("textarea")
        ta.value = text
        ta.style.position = "fixed"
        ta.style.left = "-9999px"
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
      setAudioDebugCopyState("copied")
      window.setTimeout(() => {
        setAudioDebugCopyState((current) => (current === "copied" ? "idle" : current))
      }, 2000)
    } catch {
      setAudioDebugCopyState("error")
    }
  }, [])

  const downloadTeleprompterDatasetJsonl = useCallback(() => {
    if (!datasetRows || !datasetRows.length) return
    const rows = datasetRows
    const jsonl = rows.map((r) => JSON.stringify(r)).join("\n")
    const blob = new Blob([jsonl], { type: "application/x-ndjson" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "teleprompter-dataset.jsonl"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [datasetRows])

  const openTeleprompterBulkTextEditor = useCallback(() => {
    if (effectiveTeleprompterLines.length > 0) {
      setTeleprompterBulkTextValue(effectiveTeleprompterLines.map((line) => line.text).join("\n"))
    } else {
      setTeleprompterBulkTextValue("")
    }
    setTeleprompterBulkTextInfo("")
    setTeleprompterBulkTextEditOpen(true)
  }, [effectiveTeleprompterLines])

  const applyTeleprompterBulkText = useCallback(() => {
    const rows = teleprompterBulkTextValue.split(/\r?\n/)
    if (!rows.length) return

    if (!effectiveTeleprompterLines.length) {
      const created = rows.map((text, index) => ({
        time: Number((index * 2).toFixed(3)),
        text,
      }))
      teleprompterLinesRef.current = created
      persistTeleprompterJson(teleprompterLinesStorageKey, created)
      setTeleprompterLines(created)
      teleprompterAnchorsRef.current = {}
      persistTeleprompterJson(teleprompterAnchorStorageKey, {})
      setTeleprompterAnchors({})
      teleprompterTextOverridesRef.current = {}
      persistTeleprompterJson(teleprompterTextStorageKey, {})
      setTeleprompterTextOverrides({})
      setTeleprompterBulkTextInfo(`${t.teleprompterBulkCreatedPrefix} ${created.length} ${t.teleprompterLinesWord}`)
      setTeleprompterBulkTextEditOpen(false)
      return
    }

    const maxLines = effectiveTeleprompterLines.length
    const applied = Math.min(rows.length, maxLines)
    const nextOverrides: TeleprompterTextOverrideMap = {}
    for (let i = 0; i < applied; i++) {
      const nextText = rows[i] ?? ""
      const baseText = teleprompterLines[i]?.text ?? effectiveTeleprompterLines[i]?.text ?? ""
      if (nextText !== baseText) nextOverrides[i] = nextText
    }
    teleprompterTextOverridesRef.current = nextOverrides
    persistTeleprompterJson(teleprompterTextStorageKey, nextOverrides)
    setTeleprompterTextOverrides(nextOverrides)
    setTeleprompterBulkTextInfo(`${t.teleprompterBulkAppliedPrefix} ${applied}/${maxLines}`)
    setTeleprompterBulkTextEditOpen(false)
  }, [
    effectiveTeleprompterLines,
    persistTeleprompterJson,
    teleprompterAnchorStorageKey,
    teleprompterBulkTextValue,
    teleprompterLines,
    teleprompterLinesStorageKey,
    teleprompterTextStorageKey,
    t,
  ])

  const saveTeleprompterPreviewJson = useCallback(async (mode: "manual" | "auto" = "manual") => {
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) {
      if (mode === "manual") {
        setTeleprompterPreviewSaveState("error")
        setTeleprompterPreviewSaveInfo(t.teleprompterPreviewPathMissing)
      }
      return
    }
    setTeleprompterPreviewSaveState("saving")
    setTeleprompterPreviewSaveInfo(mode === "auto" ? t.teleprompterPreviewAutosaving : t.teleprompterPreviewSaving)
    try {
      const res = await fetch("/api/teleprompter/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: effectiveTeleprompterSourceUrl,
          lines: effectiveTeleprompterLines.map((line) => ({
            time: Number(line.time.toFixed(3)),
            text: line.text,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `http_${res.status}`))
      setTeleprompterPreviewSaveState("saved")
      setTeleprompterPreviewSaveInfo(
        `${mode === "auto" ? t.teleprompterPreviewAutosavedPrefix : t.teleprompterPreviewSavedPrefix} ${data.linesWritten} ${t.teleprompterLinesWord}`
      )
      teleprompterPreviewKnownSignatureRef.current = effectiveTeleprompterSignature
    } catch (e) {
      setTeleprompterPreviewSaveState("error")
      setTeleprompterPreviewSaveInfo(`${t.teleprompterErrorPrefix} ${e instanceof Error ? e.message : "save_failed"}`)
    }
  }, [effectiveTeleprompterLines, effectiveTeleprompterSignature, effectiveTeleprompterSourceUrl, t])

  useEffect(() => {
    if (!teleprompterPreviewAutoSave) return
    if (!effectiveTeleprompterSourceUrl || !effectiveTeleprompterLines.length) return
    if (!teleprompterPreviewAutoSavePrimedRef.current) {
      teleprompterPreviewAutoSavePrimedRef.current = true
      teleprompterPreviewKnownSignatureRef.current = effectiveTeleprompterSignature
      return
    }
    if (effectiveTeleprompterSignature === teleprompterPreviewKnownSignatureRef.current) return
    teleprompterPreviewKnownSignatureRef.current = effectiveTeleprompterSignature
    const timer = window.setTimeout(() => {
      void saveTeleprompterPreviewJson("auto")
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [
    effectiveTeleprompterLines.length,
    effectiveTeleprompterSignature,
    effectiveTeleprompterSourceUrl,
    saveTeleprompterPreviewJson,
    teleprompterPreviewAutoSave,
  ])

  const activeTeleprompterIndex = useMemo(() => {
    if (!effectiveTeleprompterLines.length) return -1
    for (let i = effectiveTeleprompterLines.length - 1; i >= 0; i--) {
      if (currentTime + TELEPROMPTER_LEAD_SEC >= effectiveTeleprompterLines[i].time) return i
    }
    return 0
  }, [currentTime, effectiveTeleprompterLines])

  const teleprompterWindow = useMemo(() => {
    if (!effectiveTeleprompterLines.length) return []
    const start = activeTeleprompterIndex >= 0 ? activeTeleprompterIndex : 0
    const end = Math.min(effectiveTeleprompterLines.length, start + 4)
    return effectiveTeleprompterLines.slice(start, end).map((line, i) => ({ line, index: start + i }))
  }, [activeTeleprompterIndex, effectiveTeleprompterLines])

  /** =========================
   *  WAVE SCRUB (drag)
   *  ========================= */
  const isScrubbingRef = useRef(false)
  const scrubPreviewPositionRef = useRef<number | null>(null)
  const scrubPreviewTimerRef = useRef<number | null>(null)
  const scrubLastCommittedPositionRef = useRef<number | null>(null)
  const scrubLastCommittedAtMsRef = useRef(0)

  const clearScrubPreviewTimer = useCallback(() => {
    if (typeof window === "undefined") return
    if (scrubPreviewTimerRef.current != null) {
      window.clearTimeout(scrubPreviewTimerRef.current)
      scrubPreviewTimerRef.current = null
    }
  }, [])

  const commitScrubPreviewSeek = useCallback((targetSec: number, immediate = false) => {
    if (typeof window === "undefined") {
      seekTo(targetSec)
      return
    }
    scrubPreviewPositionRef.current = targetSec
    positionSecRef.current = targetSec
    setCurrentTime(targetSec)

    const applySeek = () => {
      clearScrubPreviewTimer()
      seekTo(targetSec)
      scrubLastCommittedPositionRef.current = targetSec
      scrubLastCommittedAtMsRef.current = readAudioPerfNowMs()
    }

    if (immediate || !isPlayingRef.current) {
      applySeek()
      return
    }

    const lastCommittedTarget = scrubLastCommittedPositionRef.current
    const latestTargetDeltaSec =
      lastCommittedTarget == null ? Number.POSITIVE_INFINITY : Math.abs(targetSec - lastCommittedTarget)
    const sinceLastCommittedMs = readAudioPerfNowMs() - scrubLastCommittedAtMsRef.current

    if (
      latestTargetDeltaSec >= SCRUB_PREVIEW_LIVE_MIN_DELTA_SEC &&
      sinceLastCommittedMs >= SCRUB_PREVIEW_LIVE_MIN_INTERVAL_MS
    ) {
      applySeek()
      return
    }

    if (scrubPreviewTimerRef.current != null) return

    const trailingDelayMs = Math.max(0, SCRUB_PREVIEW_LIVE_MIN_INTERVAL_MS - sinceLastCommittedMs)
    scrubPreviewTimerRef.current = window.setTimeout(() => {
      scrubPreviewTimerRef.current = null
      const latestTarget = scrubPreviewPositionRef.current ?? targetSec
      const latestCommittedTarget = scrubLastCommittedPositionRef.current
      const latestCommittedDeltaSec =
        latestCommittedTarget == null ? Number.POSITIVE_INFINITY : Math.abs(latestTarget - latestCommittedTarget)
      const sinceLatestCommittedMs = readAudioPerfNowMs() - scrubLastCommittedAtMsRef.current

      if (
        latestCommittedDeltaSec < SCRUB_PREVIEW_LIVE_MIN_DELTA_SEC ||
        sinceLatestCommittedMs < SCRUB_PREVIEW_LIVE_MIN_INTERVAL_MS
      ) {
        return
      }

      seekTo(latestTarget)
      scrubLastCommittedPositionRef.current = latestTarget
      scrubLastCommittedAtMsRef.current = readAudioPerfNowMs()
    }, trailingDelayMs)
  }, [clearScrubPreviewTimer, seekTo])

  const scrubFromEvent = (e: React.PointerEvent<HTMLCanvasElement>, immediate = false) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const p = clamp(x / rect.width, 0, 1)
    const trackIndex = Number((e.currentTarget as HTMLCanvasElement).dataset.trackIndex ?? "-1")

    // In Guest+Track mode, clicking on the active Solo track should stop playback first.
    if (
      guestTransportLinkedRef.current &&
      (isPlayingRef.current || guestIsPlaying) &&
      trackIndex === selectedSoloTrackIndex
    ) {
      pause()
      setGuestSoloMode(false)
      guestTransportLinkedRef.current = false
      guestNeedsRecalibrateRef.current = true
    }

    commitScrubPreviewSeek(p * duration, immediate)
  }

  const onWavePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
    isScrubbingRef.current = true
    scrubFromEvent(e, true)
  }
  const onWavePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isScrubbingRef.current) return
    scrubFromEvent(e)
  }
  const onWavePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const finalPos = scrubPreviewPositionRef.current
    isScrubbingRef.current = false
    clearScrubPreviewTimer()
    scrubPreviewPositionRef.current = null
    if (finalPos != null) {
      positionSecRef.current = finalPos
      setCurrentTime(finalPos)
      const lastCommittedTarget = scrubLastCommittedPositionRef.current
      if (lastCommittedTarget == null || Math.abs(finalPos - lastCommittedTarget) > 0.001) {
        seekTo(finalPos)
        scrubLastCommittedPositionRef.current = finalPos
        scrubLastCommittedAtMsRef.current = readAudioPerfNowMs()
      }
    }
    try {
      ;(e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  /** =========================
   *  SPEED / PITCH
   *  ========================= */
  const scheduleTempoPitchRealign = () => {
    if (tempoPitchRealignTimerRef.current != null) {
      window.clearTimeout(tempoPitchRealignTimerRef.current)
      tempoPitchRealignTimerRef.current = null
    }
    // Intentionally disabled: forced transport realign introduced audible dropouts.
  }

  const setSpeedUI = (v: number) => {
    if (
      recording ||
      countInBeat != null ||
      guestTransportLinkedRef.current ||
      !activeEngineCapabilities.supportsTempo
    ) {
      setRecordError(t.tempoLocked)
      return
    }
    setSpeed(v)
    tempoRef.current = v
    scheduleTempoPitchSmoothing(v, pitchSemiRef.current)
    scheduleTempoPitchRealign()
  }

  const setPitchUI = (semi: number) => {
    if (
      recording ||
      countInBeat != null ||
      guestTransportLinkedRef.current ||
      !activeEngineCapabilities.supportsIndependentPitch
    ) {
      setRecordError(t.pitchLocked)
      return
    }
    setPitchSemi(semi)
    pitchSemiRef.current = semi
    scheduleTempoPitchSmoothing(tempoRef.current, semi)
    scheduleTempoPitchRealign()
  }

  /** =========================
   *  TRACK CONTROLS
   *  ========================= */
  const toggleMute = (i: number) => {
    setMuted((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      applyMuteSoloVolume(next, solo, volUI)
      return next
    })
  }

  const toggleSolo = (i: number) => {
    if (referenceLockEnabled && (recording || countInBeat != null || guestTransportLinkedRef.current)) {
      const lockedIdx = recordReferenceIndexRef.current
      if (lockedIdx != null && i !== lockedIdx) {
        setRecordError(t.referenceLockTrackChangeBlocked)
        return
      }
      if (lockedIdx != null && i === lockedIdx && solo[i]) {
        setRecordError(t.referenceLockSoloRequired)
        return
      }
    }
    setSolo((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      applyMuteSoloVolume(muted, next, volUI)
      if (next.filter(Boolean).length === 1) setRecSoloHint(false)
      return next
    })
  }

  const setPan = (i: number, value: number) => {
    setPanUI((prev) => {
      const next = [...prev]
      next[i] = value
      applyPan(next)
      return next
    })
  }

  const setVol = (i: number, value: number) => {
    setVolUI((prev) => {
      const next = [...prev]
      next[i] = clamp(value, 0, TRACK_MAX_GAIN)
      applyMuteSoloVolume(muted, solo, next)
      return next
    })
  }

  const handleMainRecClick = () => {
    if (selectedSoloTrackIndex < 0) {
      setRecSoloHint(true)
      return
    }
    setGuestPanelOpen(true)
    setRecSoloHint(false)

    // During count-in or recording, the same button acts as STOP.
    if (recording || countInBeat != null) {
      stopGuestRecording()
      return
    }

    // Fresh REC click always starts new take from the beginning.
    startGuestRecording().catch(() => {})
  }

  const syncQualityLabel =
    guestSyncQuality === "good"
      ? t.syncGood
      : guestSyncQuality === "ok"
        ? t.syncOk
        : guestSyncQuality === "low"
          ? t.syncLow
          : t.syncUnknown
  const syncQualityClass =
    guestSyncQuality === "good"
      ? "bg-emerald-700/70 text-white"
      : guestSyncQuality === "ok"
        ? "bg-sky-700/70 text-white"
        : guestSyncQuality === "low"
          ? "bg-amber-700/80 text-white"
        : "bg-zinc-800 text-white/70"
  const referenceLockActive = referenceLockEnabled && (recording || countInBeat != null || guestTransportLinkedRef.current)
  const tempoControlLocked =
    recording ||
    countInBeat != null ||
    (referenceLockEnabled && guestTransportLinkedRef.current) ||
    !activeEngineCapabilities.supportsTempo
  const pitchControlLocked =
    recording ||
    countInBeat != null ||
    (referenceLockEnabled && guestTransportLinkedRef.current) ||
    !activeEngineCapabilities.supportsIndependentPitch
  const isPendingMainStart = mainPlayPending && !isPlaying
  const guestWithTrackUiActive = guestTransportLinkedRef.current && (isPlaying || guestIsPlaying)

  /** =========================
   *  RENDER
   *  ========================= */
  return (
    <div data-testid="multitrack-root" className="relative bg-zinc-950/60 rounded-2xl p-6 md:p-8 space-y-6 text-white shadow-xl border border-white/10">
      {topStatusBanner ? (
        <Link
          href={topStatusBanner.href}
          className="absolute left-6 top-1 z-20 inline-flex max-w-[calc(100%-3rem)] rounded border border-white/15 bg-black/35 px-2 py-0.5 text-[10px] leading-4 text-white/80 hover:bg-black/45 hover:text-white md:left-8 md:max-w-[calc(100%-4rem)]"
        >
          <span className="truncate">{topStatusBanner.text}</span>
        </Link>
      ) : null}
      {!isReady && <div className="text-white/70">{t.loadingAudio}</div>}

      {isReady || (showControlsBeforeReady && isHydrated) ? (
      <>
          {/* MASTER */}
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={goToStart}
                      aria-label={t.goToStartAria}
                      className="btn-round"
                      title={t.goToStartTitle}
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 7 3 12l5 5" />
                        <path d="M4 12h10a5 5 0 1 1 0 10" />
                      </svg>
                    </button>

                    <button
                      onClick={togglePlay}
                      aria-label={isPendingMainStart ? t.loadingAudio : (isPlaying ? t.pauseAria : t.playAria)}
                      disabled={isPendingMainStart}
                      className="px-5 h-11 bg-white text-black rounded-full font-medium hover:bg-white/90 transition"
                    >
                      {isPendingMainStart ? t.loadingAudio : (isPlaying ? t.pauseButton : t.playButton)}
                    </button>

                    <button
                      onClick={toggleLoop}
                      aria-label={t.repeatTrackAria}
                      className={`btn-round ${loopOn ? "btn-round--active" : ""}`}
                      title={t.repeatTrackTitle}
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 7v5h-5" />
                        <path d="M4 17v-5h5" />
                        <path d="M18.5 12A6.5 6.5 0 0 0 7 8" />
                        <path d="M5.5 12A6.5 6.5 0 0 0 17 16" />
                      </svg>
                    </button>

                    <div className="relative">
                      <button
                        onClick={handleMainRecClick}
                        data-testid="master-record-toggle"
                        data-recording={recording || countInBeat != null ? "1" : "0"}
                        aria-label={recording || countInBeat != null ? t.recordGuestStopAria : t.recordGuestStartAria}
                        className={`btn-round ${recording || countInBeat != null ? "bg-red-700 border-red-500/70" : ""}`}
                        title={recording || countInBeat != null ? t.recordGuestStopTitle : t.recordGuestStartTitle}
                      >
                        {recording || countInBeat != null ? (
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                            <rect x="7" y="7" width="10" height="10" rx="1.5" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="7" />
                            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
                          </svg>
                        )}
                      </button>
                      {recSoloHint ? (
                        <div className="absolute left-1/2 top-[calc(100%+8px)] -translate-x-1/2 rounded bg-black/90 px-2 py-1 text-[11px] text-amber-300 whitespace-nowrap">
                          {t.recSoloHint}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-sm text-white/70">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </div>
                </div>

                <input
                  type="range"
                  aria-label={t.trackPositionAria}
                  min={0}
                  max={duration || 0}
                  step="0.005"
                  value={Math.min(currentTime, duration || currentTime)}
                  onChange={(e) => seekTo(Number(e.currentTarget.value))}
                  className="w-full range-thin"
                />

                <div className="grid grid-cols-4 gap-3 items-center max-w-[520px]">
                  <div className="space-y-1">
                    <div className="text-[11px] text-white/60">{t.volume}</div>
                    <input
                      type="range"
                      aria-label={t.masterVolumeAria}
                      min={0}
                      max={1}
                      step="0.01"
                      value={masterVol}
                      onChange={(e) => setMasterVol(Number(e.currentTarget.value))}
                      className="range-thin w-full max-w-[110px]"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-white/60">{t.reverb}</div>
                    <input
                      type="range"
                      aria-label="Reverb"
                      min={0}
                      max={1}
                      step="0.01"
                      value={reverbAmount}
                      onChange={(e) => setReverbAmount(Number(e.currentTarget.value))}
                      className="range-thin w-full max-w-[110px]"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-white/60">{t.speed}</div>
                    <div className="relative max-w-[110px]">
                      <div
                        className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/45"
                        style={{ left: `${clamp(((1 - 0.6) / (1.4 - 0.6)) * 100, 0, 100)}%` }}
                      />
                      <input
                        type="range"
                        aria-label={t.speedAria}
                        min={0.6}
                        max={1.4}
                        step="0.01"
                        value={speed}
                        onChange={(e) => setSpeedUI(Number(e.currentTarget.value))}
                        className={`w-full range-thin ${tempoControlLocked ? "opacity-60" : ""}`}
                        disabled={tempoControlLocked}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-white/60">{t.pitch}</div>
                    <div className="relative max-w-[110px]">
                      <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-[1px] h-3 bg-white/45" style={{ left: "50%" }} />
                      <input
                        type="range"
                        aria-label="Pitch"
                        min={-12}
                        max={12}
                        step={1}
                        value={pitchSemi}
                        onChange={(e) => setPitchUI(Number(e.currentTarget.value))}
                        className={`w-full range-thin ${pitchControlLocked ? "opacity-60" : ""}`}
                        disabled={pitchControlLocked}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                  <button
                    onClick={() => setGuestPanelOpen(true)}
                    data-testid="guest-panel-toggle"
                    className="rounded-sm bg-zinc-800 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700"
                  >
                    {t.guestPanelTitle}
                  </button>
                  <span className={`rounded-sm px-2 py-1 text-[11px] ${guestCalibrating ? "bg-zinc-600 text-white" : guestCalibrateReady ? "bg-emerald-700/70 text-white" : "bg-zinc-800 text-white/70"}`}>
                    {guestCalibrating ? t.calibrating : guestCalibrateReady ? t.delayDetected : t.delayPending}
                  </span>
                  <button
                    onClick={() => {
                      calibrateGuestDelay({ keepPosition: true }).catch(() => {})
                    }}
                    className="rounded-sm bg-zinc-800 px-2 py-1 text-[11px] text-white hover:bg-zinc-700"
                    disabled={guestCalibrating || guestActionBusy}
                  >
                    {t.syncCheck}
                  </button>
                  <span className={`rounded-sm px-2 py-1 text-[11px] ${syncQualityClass}`}>
                    {syncQualityLabel}
                    {guestCalibrateScore != null ? ` (${guestCalibrateScore.toFixed(2)})` : ""}
                  </span>
                  {countInBeat ? <span className="rounded-sm bg-amber-500/90 px-2 py-1 text-xs font-semibold text-black">{t.countInPrefix}: {countInBeat}</span> : null}
                </div>
              </div>

              <div className="relative overflow-visible rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="mb-2 text-xs text-white/60">{t.teleprompterTitle}</div>
                {!effectiveTeleprompterSourceUrl && teleprompterWindow.length === 0 && (
                  <div className="text-sm text-white/50">{t.teleprompterEmptyHint}</div>
                )}
                {effectiveTeleprompterSourceUrl && teleprompterWindow.length === 0 && (
                  <div className="text-sm text-white/50">
                    {teleprompterLoadState === "loading" && t.teleprompterLoadLoading}
                    {teleprompterLoadState === "missing" && t.teleprompterLoadMissing}
                    {teleprompterLoadState === "empty" && t.teleprompterLoadEmpty}
                    {teleprompterLoadState === "error" && t.teleprompterLoadError}
                    {(teleprompterLoadState === "idle" || teleprompterLoadState === "ready") && t.teleprompterLoadIdle}
                  </div>
                )}
                {teleprompterWindow.length > 0 && (
                  <div className="space-y-1">
                    {teleprompterWindow.map(({ line, index }) => {
                      const isActive = index === activeTeleprompterIndex
                      return (
                        <button
                          key={`${line.time}-${index}`}
                          onClick={() => seekTo(line.time)}
                          className={`block w-full rounded-sm px-2 py-1 text-left text-sm transition ${
                            isActive ? "bg-[#5f82aa] text-white" : "text-white/75 hover:bg-white/10"
                          }`}
                        >
                          {renderTeleprompterLineText(line.text)}
                        </button>
                      )
                    })}
                  </div>
                )}
                {(
                  <>
                    <button
                      onClick={() => setTeleprompterSettingsOpen((v) => !v)}
                      aria-label={teleprompterSettingsOpen ? t.teleprompterSettingsHide : t.teleprompterSettingsShow}
                      title={teleprompterSettingsOpen ? t.teleprompterSettingsHide : t.teleprompterSettingsShow}
                      className={`absolute bottom-2 -left-9 z-20 flex h-7 w-7 items-center justify-center rounded-full border ${teleprompterSettingsOpen ? "border-[#5f82aa] bg-[#5f82aa] text-white" : "border-white/25 bg-black/45 text-white/80 hover:bg-black/60"}`}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3.2" />
                        <path d="m19 12 .8.4m-15.6 0 .8-.4m13.5 5.8.4-.8m-12.2.8.4-.8m10.1-10.1.8-.4m-11.8.4.8-.4M12 5l.4-.8m-.8 15.6.4-.8" />
                      </svg>
                    </button>
                    {teleprompterSettingsOpen && (
                      <div className="absolute inset-x-2 bottom-10 z-20 space-y-2 rounded-md border border-white/15 bg-zinc-950/95 p-2 shadow-xl">
                        <div className="max-h-[46vh] space-y-2 overflow-auto pr-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => setTeleprompterAnchorEditMode((v) => !v)}
                              className={`rounded-sm px-2 py-1 text-xs ${teleprompterAnchorEditMode ? "bg-[#5f82aa] text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                            >
                              {teleprompterAnchorEditMode ? t.teleprompterMarkupHide : t.teleprompterMarkupShow}
                            </button>
                            <button
                              onClick={() => setTeleprompterTextEditMode((v) => !v)}
                              className={`rounded-sm px-2 py-1 text-xs ${teleprompterTextEditMode ? "bg-[#5f82aa] text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                            >
                              {teleprompterTextEditMode ? t.teleprompterEditorHide : t.teleprompterEditorShow}
                            </button>
                            <button
                              onClick={openTeleprompterBulkTextEditor}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterPasteBulk}
                            </button>
                            {activeTeleprompterIndex >= 0 && (
                              <button
                                onClick={() => setTeleprompterAnchorAtCurrentTime(activeTeleprompterIndex)}
                                className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                              >
                                {t.teleprompterAnchorCurrent}
                              </button>
                            )}
                            <button
                              onClick={() => void copyTeleprompterAnchorsJson()}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterCopyJson}
                            </button>
                            <button
                              onClick={downloadTeleprompterAnchorsJson}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterDownloadJson}
                            </button>
                            <button
                              onClick={downloadTeleprompterBackupJson}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterBackupDownload}
                            </button>
                            <button
                              onClick={triggerTeleprompterBackupImport}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterBackupRestore}
                            </button>
                            <button
                              onClick={() => void copyTeleprompterDatasetJsonl()}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterCopyDatasetJsonl}
                            </button>
                            <button
                              onClick={downloadTeleprompterDatasetJsonl}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterDownloadDatasetJsonl}
                            </button>
                            <button
                              onClick={() => void postTeleprompterDatasetSnapshot("manual")}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterSaveDataset}
                            </button>
                            <button
                              onClick={() => void saveTeleprompterPreviewJson()}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterRewritePreview}
                            </button>
                            <button
                              onClick={() => setTeleprompterPreviewAutoSave((v) => !v)}
                              className={`rounded-sm px-2 py-1 text-xs ${teleprompterPreviewAutoSave ? "bg-[#5f82aa] text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                            >
                              {teleprompterPreviewAutoSave ? t.teleprompterAutoPreviewOn : t.teleprompterAutoPreviewOff}
                            </button>
                            <button
                              onClick={() => {
                                if (!teleprompterAutoCollectAllowed) return
                                setTeleprompterAutoCollect((v) => !v)
                              }}
                              disabled={!teleprompterAutoCollectAllowed}
                              title={
                                teleprompterAutoCollectAllowed
                                  ? undefined
                                  : "Set NEXT_PUBLIC_TELEPROMPTER_AUTOCOLLECT=1 to enable auto collect"
                              }
                              className={`rounded-sm px-2 py-1 text-xs ${
                                teleprompterAutoCollect
                                  ? "bg-[#5f82aa] text-white"
                                  : teleprompterAutoCollectAllowed
                                    ? "bg-white/10 text-white/80 hover:bg-white/20"
                                    : "cursor-not-allowed bg-white/5 text-white/35"
                              }`}
                            >
                              {teleprompterAutoCollect ? t.teleprompterAutoCollectOn : t.teleprompterAutoCollectOff}
                            </button>
                            <button
                              onClick={resetTeleprompterAnchors}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterResetAnchors}
                            </button>
                            <button
                              onClick={resetTeleprompterTextOverrides}
                              className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                            >
                              {t.teleprompterResetText}
                            </button>
                            <input
                              ref={teleprompterBackupInputRef}
                              type="file"
                              accept="application/json,.json"
                              className="hidden"
                              onChange={(e) => void importTeleprompterBackupJson(e)}
                            />
                          </div>
                          <div className="text-[11px] text-white/60">
                            {t.teleprompterDatasetStatus}: {teleprompterCollectState}
                            {teleprompterCollectInfo ? ` · ${teleprompterCollectInfo}` : ""}
                          </div>
                          <div className="text-[11px] text-white/60">
                            {t.teleprompterDraftStatus}: {teleprompterDraftDirty ? t.teleprompterDraftDirty : t.teleprompterDraftSaved}
                            {teleprompterDraftSavedAt
                              ? ` · ${new Date(teleprompterDraftSavedAt).toLocaleTimeString(uiLang === "ru" ? "ru-RU" : "en-US")}`
                              : ""}
                          </div>
                          <div className="text-[11px] text-white/60">
                            {t.teleprompterPreviewStatus}: {teleprompterPreviewSaveState}
                            {teleprompterPreviewSaveInfo ? ` · ${teleprompterPreviewSaveInfo}` : ""}
                          </div>
                          {teleprompterBackupInfo ? (
                            <div className="text-[11px] text-white/60">{t.teleprompterBackupStatus}: {teleprompterBackupInfo}</div>
                          ) : null}
                          {teleprompterBulkTextInfo ? (
                            <div className="text-[11px] text-white/60">{teleprompterBulkTextInfo}</div>
                          ) : null}
                          {teleprompterBulkTextEditOpen && (
                            <div className="space-y-2 rounded-sm border border-white/10 bg-black/25 p-2">
                              <div className="text-[11px] text-white/70">
                                {t.teleprompterBulkHint}
                              </div>
                              <textarea
                                value={teleprompterBulkTextValue}
                                onChange={(e) => setTeleprompterBulkTextValue(e.currentTarget.value)}
                                rows={10}
                                className="w-full rounded-sm border border-white/15 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-[#5f82aa]"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={applyTeleprompterBulkText}
                                  className="rounded-sm bg-[#5f82aa] px-2 py-1 text-xs text-white hover:bg-[#4d729f]"
                                >
                                  {t.teleprompterApply}
                                </button>
                                <button
                                  onClick={() => setTeleprompterBulkTextEditOpen(false)}
                                  className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                                >
                                  {t.teleprompterCancel}
                                </button>
                              </div>
                            </div>
                          )}
                          {(teleprompterAnchorEditMode || teleprompterTextEditMode) && (
                            <div className="max-h-56 space-y-1 overflow-auto rounded-sm border border-white/10 bg-black/20 p-1.5">
                              {effectiveTeleprompterLines.map((line, index) => {
                                const isActive = index === activeTeleprompterIndex
                                const isAnchored = Object.prototype.hasOwnProperty.call(teleprompterAnchors, index)
                                const isTextOverridden = Object.prototype.hasOwnProperty.call(teleprompterTextOverrides, index)
                                return (
                                  <div
                                    key={`anchor-${index}-${line.time}`}
                                    className={`rounded-sm px-2 py-1 ${isActive ? "bg-[#5f82aa]/30" : "bg-transparent"}`}
                                  >
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                      <button
                                        onClick={() => seekTo(line.time)}
                                        className="truncate text-left text-xs text-white/85 hover:text-white"
                                        title={line.text}
                                      >
                                        {String(index + 1).padStart(2, "0")} · {formatTime(line.time)} · {line.text}
                                      </button>
                                      <div className="shrink-0 space-x-1">
                                        {teleprompterAnchorEditMode && (
                                          <button
                                            onClick={() => setTeleprompterAnchorAtCurrentTime(index)}
                                            className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/85 hover:bg-white/20"
                                          >
                                            Anchor now
                                          </button>
                                        )}
                                        {teleprompterAnchorEditMode && isAnchored && (
                                          <button
                                            onClick={() => clearTeleprompterAnchor(index)}
                                            className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/85 hover:bg-white/20"
                                          >
                                            Clear
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {teleprompterTextEditMode && (
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="text"
                                          value={line.text}
                                          onChange={(e) => setTeleprompterTextOverride(index, e.currentTarget.value)}
                                          className="w-full rounded-sm border border-white/20 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-white/40"
                                          aria-label={`${t.teleprompterLineAriaPrefix} ${index + 1}`}
                                        />
                                        {isTextOverridden && (
                                          <button
                                            onClick={() => clearTeleprompterTextOverride(index)}
                                            className="shrink-0 rounded bg-white/10 px-1.5 py-1 text-[11px] text-white/85 hover:bg-white/20"
                                          >
                                            Reset
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

          </div>

          {showDetailedSections ? (
          <div className="flex flex-col gap-4">
            <div className={`order-2 rounded-xl border border-white/10 bg-black/25 p-3 space-y-2 ${guestPanelOpen ? "block" : "hidden"}`}>
              {guestPanelOpen ? (
                <div className="space-y-2 pt-1">
                  <div className="rounded-sm border border-white/10 bg-black/20 p-2">
                    <button
                      onClick={() => setRecordChecklistOpen((v) => !v)}
                      data-testid="recording-checklist-toggle"
                      className="text-xs font-medium text-white/85 hover:text-white"
                    >
                      {t.recordChecklist}
                    </button>
                    {recordChecklistOpen ? (
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <label className="flex items-center gap-2 text-xs text-white/80">
                          <input
                            type="checkbox"
                            checked={recordHeadphonesConfirmed}
                            onChange={(e) => setRecordHeadphonesConfirmed(e.currentTarget.checked)}
                            data-testid="record-headphones-checkbox"
                          />
                          <span>{t.headphonesCheck}</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs text-white/80">
                          <input
                            type="checkbox"
                            checked={referenceLockEnabled}
                            onChange={(e) => setReferenceLockEnabled(e.currentTarget.checked)}
                          />
                          <span>{t.referenceLock}</span>
                        </label>
                        <label className="block text-xs text-white/70">
                          <span>{t.selectReference}</span>
                          <select
                            value={recordReferenceIndex ?? ""}
                            onChange={(e) => {
                              const raw = e.currentTarget.value
                              setRecordReferenceIndex(raw === "" ? null : Math.max(0, Number(raw)))
                            }}
                            className="mt-1 w-full rounded-sm border border-white/20 bg-zinc-900/80 px-2 py-1 text-xs text-white outline-none"
                          >
                            <option value="">{t.referenceAutoSolo}</option>
                            {trackList.map((track, idx) => (
                              <option key={track.src} value={idx}>
                                {track.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-white/70">
                          <span>{t.recordingModeLabel}</span>
                          <select
                            value={recordingMode}
                            onChange={(e) => {
                              const raw = e.currentTarget.value
                              setRecordingMode(raw === "local_master" ? "local_master" : "compatibility")
                            }}
                            data-testid="recording-mode-select"
                            className="mt-1 w-full rounded-sm border border-white/20 bg-zinc-900/80 px-2 py-1 text-xs text-white outline-none"
                          >
                            <option value="compatibility">{t.recordingModeCompatibility}</option>
                            <option value="local_master" disabled={!recordingEngineV2Enabled || !localMasterCapable}>
                              {t.recordingModeLocalMaster}
                            </option>
                          </select>
                        </label>
                        <div className="text-[11px] text-white/60">
                          <div>
                            {t.syncRuns}: {guestSyncRuns}
                          </div>
                          <div>
                            {t.lowConfidenceRuns}: {guestLowConfidenceRuns}
                          </div>
                          <div>
                            {t.longTaskCount}: {playerLongTaskCount}
                          </div>
                          <div>
                            {t.longTaskMax}: {playerLongTaskMaxMs} ms
                          </div>
                          <div>
                            {t.progressiveLoadFlag}: {progressiveLoadEnabled ? "on" : "off"}
                          </div>
                          <div>
                            {t.startupChunkFlag}: {startupChunkPilotEnabled ? "on" : "off"}
                          </div>
                          <div>
                            {t.startupChunkSpliceFlag}: {startupChunkSplicePilotEnabled ? "on" : "off"}
                          </div>
                          <div>
                            {t.streamingBufferFlag}: {streamingBufferPilotEnabled ? "on" : "off"}
                          </div>
                          <div>
                            {t.appendableQueueFlag}: {effectiveAppendableQueuePilotEnabled ? "on" : "off"}
                          </div>
                          <div>
                            appendable multistem flag: {effectiveAppendableQueueMultistemPilotEnabled ? "on" : "off"}
                          </div>
                          <div>
                            appendable startup head flag: {appendableQueueStartupHeadPilotEnabled ? "on" : "off"}
                          </div>
                          <div>
                            appendable continuation chunks flag: {appendableQueueContinuationChunksPilotEnabled ? "on" : "off"}
                          </div>
                          <div>
                            appendable shadow pitch flag: {appendableQueueShadowPitchEnabled ? "on" : "off"} / active=
                            {appendableRoutePitchShadowActive ? "on" : "off"}
                          </div>
                          <div>
                            appendable continuation qualification: {appendableQueueSourceProgressSnapshot.continuationQualification}
                            {appendableQueueSourceProgressSnapshot.continuationQualificationReason
                              ? ` (${appendableQueueSourceProgressSnapshot.continuationQualificationReason})`
                              : ""}
                          </div>
                          <div>
                            appendable safe rollout candidate:{" "}
                            {appendableQueueSourceProgressSnapshot.safeRolloutCandidateQualified ? "yes" : "no"}
                          </div>
                          <div>
                            appendable recommended safe rollout target:{" "}
                            {appendableQueueSourceProgressSnapshot.safeRolloutCandidateTarget ?? "—"}
                          </div>
                          <div>
                            appendable activation scoped: {appendablePilotActivation.activationConfigured ? "on" : "off"}
                          </div>
                          <div>
                            appendable activation mode: {appendablePilotActivation.activationMode}
                          </div>
                          <div>
                            appendable activation allowed: {appendablePilotActivation.activationAllowed ? "on" : "off"}
                          </div>
                          <div>
                            appendable tempo policy: {appendablePilotActivation.tempoControlUnlocked ? "unlocked" : "locked"}
                          </div>
                          <div>
                            appendable activation match: {appendablePilotActivation.matchedTarget ?? "—"}
                          </div>
                          <div>
                            appendable queue probe: {appendableQueueRuntimeProbeSnapshot.active ? "active" : "idle"}
                          </div>
                          <div>
                            appendable data plane: {appendableQueueRuntimeProbeSnapshot.dataPlaneMode ?? "—"}
                          </div>
                          <div>
                            appendable control plane: {appendableQueueRuntimeProbeSnapshot.controlPlaneMode ?? "—"}
                          </div>
                          <div>
                            appendable runtime tempo/pitch: support=
                            {appendableQueueRuntimeProbeSnapshot.supportsTempo == null
                              ? "—"
                              : appendableQueueRuntimeProbeSnapshot.supportsTempo
                                ? "tempo"
                                : "locked"}{" "}
                            / pitch=
                            {appendableQueueRuntimeProbeSnapshot.supportsIndependentPitch == null
                              ? "—"
                              : appendableQueueRuntimeProbeSnapshot.supportsIndependentPitch
                                ? "enabled"
                                : "locked"}{" "}
                            / tempo={formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.tempo)} / semitones=
                            {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.pitchSemitones)}
                          </div>
                          <div>
                            appendable preferred data plane:{" "}
                            {appendableQueueRuntimeProbeSnapshot.preferredDataPlaneMode ?? "—"}
                          </div>
                          <div>
                            appendable SAB readiness:{" "}
                            {appendableQueueRuntimeProbeSnapshot.sabReady == null
                              ? "—"
                              : appendableQueueRuntimeProbeSnapshot.sabReady
                                ? "ready"
                                : "fallback"}{" "}
                            / capable=
                            {appendableQueueRuntimeProbeSnapshot.sabCapable == null
                              ? "—"
                              : appendableQueueRuntimeProbeSnapshot.sabCapable
                                ? "yes"
                                : "no"}{" "}
                            / coi=
                            {appendableQueueRuntimeProbeSnapshot.crossOriginIsolated == null
                              ? "—"
                              : appendableQueueRuntimeProbeSnapshot.crossOriginIsolated
                                ? "yes"
                                : "no"}
                            {appendableQueueRuntimeProbeSnapshot.sabRequirement
                              ? ` (${appendableQueueRuntimeProbeSnapshot.sabRequirement})`
                              : ""}
                          </div>
                          <div>
                            appendable startup mode: {appendableQueueSourceProgressSnapshot.mode}
                            {appendableQueueSourceProgressSnapshot.mode !== "off" &&
                            appendableQueueSourceProgressSnapshot.manifestSlug
                              ? ` (${appendableQueueSourceProgressSnapshot.manifestSlug})`
                              : ""}
                          </div>
                          <div>
                            appendable source progress: startup=
                            {appendableQueueSourceProgressSnapshot.allStartupAppended ? "yes" : "no"} / fullDecoded=
                            {appendableQueueSourceProgressSnapshot.allFullDecoded ? "yes" : "no"} / fullAppended=
                            {appendableQueueSourceProgressSnapshot.allFullAppended ? "yes" : "no"}
                          </div>
                          <div>
                            appendable continuation chunks: {appendableQueueSourceProgressSnapshot.continuationChunkGroupsDecoded}/
                            {appendableQueueSourceProgressSnapshot.continuationChunkGroupsPlanned} decoded,{" "}
                            {appendableQueueSourceProgressSnapshot.continuationChunkGroupsAppended}/
                            {appendableQueueSourceProgressSnapshot.continuationChunkGroupsPlanned} appended
                          </div>
                          <div>
                            appendable continuation coverage sec: {formatOptionalFixed(appendableQueueSourceProgressSnapshot.continuationCoverageEndSec)} / available groups:{" "}
                            {appendableQueueSourceProgressSnapshot.continuationChunkGroupsAvailable}
                          </div>
                          <div>
                            appendable source buffered sec: {formatOptionalFixed(appendableQueueSourceProgressSnapshot.minSourceBufferedUntilSec)}
                            {" .. "}
                            {formatOptionalFixed(appendableQueueSourceProgressSnapshot.maxSourceBufferedUntilSec)}
                          </div>
                          <div>
                            appendable sample rates:{" "}
                            {appendableQueueRuntimeProbeSnapshot.sampleRates.length
                              ? appendableQueueRuntimeProbeSnapshot.sampleRates.join(", ")
                              : "—"}
                          </div>
                          <div>
                            appendable append messages: {appendableQueueRuntimeProbeSnapshot.appendMessageCount}
                          </div>
                          <div>
                            appendable appended MiB: {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.appendedMiB, 3)}
                          </div>
                          <div>
                            appendable min lead sec: {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.minLeadSec)}
                          </div>
                          <div>
                            appendable max lead sec: {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.maxLeadSec)}
                          </div>
                          <div>
                            appendable observed lead sec: {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.minObservedLeadSec)}
                            {" .. "}
                            {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.maxObservedLeadSec)}
                          </div>
                          <div>
                            appendable watermarks sec: low={formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.minLowWaterSec)} / refill=
                            {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.minRefillTriggerSec)} / high=
                            {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.maxHighWaterSec)}
                          </div>
                          <div>
                            appendable stem drift sec: {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.stemDriftSec, 4)}
                          </div>
                          <div>
                            appendable transport drift sec: {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.transportDriftSec, 4)}
                          </div>
                          <div>
                            appendable probe drop delta sec: {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.dropDeltaSec)}
                          </div>
                          <div>
                            appendable clean soak sec: {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.cleanSoakSec)}
                          </div>
                          <div>
                            appendable ready threshold sec: {formatOptionalFixed(appendableQueueRuntimeProbeSnapshot.readyThresholdSec)}
                          </div>
                          <div>
                            appendable total underrun: {appendableQueueRuntimeProbeSnapshot.totalUnderrunFrames}
                          </div>
                          <div>
                            appendable total discontinuity: {appendableQueueRuntimeProbeSnapshot.totalDiscontinuityCount}
                          </div>
                          <div>
                            appendable water breaches: low={appendableQueueRuntimeProbeSnapshot.totalLowWaterBreachCount} / high=
                            {appendableQueueRuntimeProbeSnapshot.totalHighWaterBreachCount}
                          </div>
                          <div>
                            appendable overflow drops: {appendableQueueRuntimeProbeSnapshot.totalOverflowDropCount} / frames=
                            {appendableQueueRuntimeProbeSnapshot.totalOverflowDroppedFrames}
                          </div>
                          <div>
                            appendable queued segments: {formatOptionalFixed(appendableQueueSourceProgressSnapshot.minQueuedSegments, 0)}
                            {" .. "}
                            {formatOptionalFixed(appendableQueueSourceProgressSnapshot.maxQueuedSegments, 0)}
                          </div>
                          <div>
                            {t.ringBufferFlag}: {ringBufferPilotEnabled ? "on" : "off"}
                          </div>
                          <div>
                            audio mode: {activeEngineMode}
                          </div>
                          <div>
                            track scope id: {trackScopeId}
                          </div>
                          <div>
                            tempo: {activeEngineCapabilities.supportsTempo ? "on" : "off"} / pitch: {activeEngineCapabilities.supportsIndependentPitch ? "on" : "off"}
                          </div>
                          <div>
                            {t.recordingV2Flag}: {recordingEngineV2Enabled ? "on" : "off"}
                          </div>
                          <div>
                            mode: {recordingMode}
                          </div>
                          <div>
                            {t.recordingEngine}: {recordingCapabilitySnapshot?.recordingEngine ?? "—"}
                          </div>
                          <div>
                            {t.recorderDropouts}: {recordDropoutCount}
                          </div>
                          <div>
                            {t.recorderRecoveries}: {recordRecoveryCount}
                          </div>
                          <div>
                            {t.recorderBaseLatency}: {recordingCapabilitySnapshot?.baseLatencyMs ?? "—"}
                          </div>
                          <div>
                            {t.recorderOutputLatency}: {recordingCapabilitySnapshot?.outputLatencyMs ?? "—"}
                          </div>
                          <div>
                            {t.recorderInputLatency}: {recordingCapabilitySnapshot?.inputLatencyMs ?? "—"}
                          </div>
                          <div>
                            {t.recorderInputSettings}:{" "}
                            {recordingCapabilitySnapshot
                              ? `${recordingCapabilitySnapshot.inputSampleRate ?? "?"}Hz/${recordingCapabilitySnapshot.inputChannelCount ?? "?"}ch/${recordingCapabilitySnapshot.inputSampleSize ?? "?"}bit`
                              : "—"}
                          </div>
                          <div>
                            {t.recorderCapabilities}:{" "}
                            {recordingCapabilitySnapshot
                              ? `aw:${recordingCapabilitySnapshot.audioWorkletSupported ? "1" : "0"} opfs:${recordingCapabilitySnapshot.opfsSupported ? "1" : "0"} mr:${recordingCapabilitySnapshot.mediaRecorderSupported ? "1" : "0"}`
                              : "—"}
                          </div>
                          <div>
                            {t.recorderTapActive}: {recordingCapabilitySnapshot?.workletTapActive ? "1" : "0"}
                          </div>
                          <div>
                            {t.recorderTapFrames}: {recordingCapabilitySnapshot?.workletFramesCaptured ?? 0}
                          </div>
                          <div>
                            {t.recorderTapChunks}: {recordingCapabilitySnapshot?.workletChunkReports ?? 0}
                          </div>
                          <div>
                            {t.recorderTapErrors}: {recordingCapabilitySnapshot?.workletTapErrors ?? 0}
                          </div>
                          <div>
                            {t.recorderOpfsActive}: {recordingV2OpfsActive ? "1" : "0"}
                          </div>
                          <div>
                            {t.recorderOpfsBytes}: {recordingV2OpfsBytes}
                          </div>
                          <div>
                            {t.recorderOpfsChunks}: {recordingV2OpfsChunks}
                          </div>
                          <div>
                            {t.recorderOpfsErrors}: {recordingV2OpfsErrors}
                          </div>
                          <div>
                            {t.recorderUploadState}: {recordingV2UploadState}
                          </div>
                          <div>
                            {t.driftSamples}: {guestDriftSampleCount}
                          </div>
                          <div>
                            {t.driftAvg}: {Math.round(guestDriftAvgMs)} ms
                          </div>
                          <div>
                            {t.driftMax}: {guestDriftMaxMs} ms
                          </div>
                          <div>
                            {t.softDriftFixes}: {guestDriftSoftCorrections}
                          </div>
                          <div>
                            {t.hardDriftFixes}: {guestDriftHardCorrections}
                          </div>
                          <div>
                            {t.deviceProfile}: {deviceLatencyProfile ? `${Math.round(deviceLatencyProfile.offsetSec * 1000)} ms | ${deviceLatencyProfile.label}` : "—"}
                          </div>
                          {bluetoothRouteRisk ? <div className="text-amber-300">{t.bluetoothRisk}</div> : null}
                          {referenceLockActive ? <div className="text-amber-300">{t.referenceLockActive}</div> : null}
                          <div>
                            debug entries: {audioDebugEntries.length}
                          </div>
                        </div>
                        <div
                          data-testid="appendable-route-checklist"
                          className="rounded-sm border border-white/10 bg-black/20 p-2 text-[11px] text-white/70 md:col-span-2"
                        >
                          <div className="font-medium text-white/85">
                            {uiLang === "ru" ? "Чеклист appendable pilot" : "Appendable pilot checklist"}
                          </div>
                          <div
                            data-testid="appendable-route-checklist-status"
                            className="mt-1 text-[11px] text-white/60"
                          >
                            {uiLang === "ru" ? "Статус" : "Status"}: {appendablePilotChecklistState.statusLabel}
                          </div>
                          <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] text-white/65">
                            {appendablePilotChecklistState.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        </div>
                        <div
                          data-testid="appendable-route-pilot-report"
                          className="rounded-sm border border-white/10 bg-black/20 p-2 text-[11px] text-white/70 md:col-span-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium text-white/85">
                              {uiLang === "ru" ? "Отчет appendable pilot" : "Appendable pilot report"}
                            </div>
                            <button
                              type="button"
                              onClick={resetAppendableRoutePilotReport}
                              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 hover:text-white"
                            >
                              {uiLang === "ru" ? "Сбросить" : "Reset"}
                            </button>
                          </div>
                          <div
                            data-testid="appendable-route-pilot-report-status"
                            data-status={appendableRoutePilotReport.status}
                            className="mt-1 text-[11px] text-white/60"
                          >
                            {uiLang === "ru" ? "Результат" : "Result"}:{" "}
                            {appendableRoutePilotReport.status === "pass"
                              ? "pass"
                              : appendableRoutePilotReport.status === "fail"
                                ? "fail"
                                : "pending"}
                          </div>
                          <div
                            data-testid="appendable-route-pilot-report-captured-at"
                            className="mt-1 text-[11px] text-white/45"
                          >
                            capturedAt: {appendableRoutePilotReport.snapshot?.capturedAt ?? "—"}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              data-testid="appendable-route-pilot-report-capture"
                              onClick={captureAppendableRoutePilotSnapshot}
                              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 hover:text-white"
                            >
                              {uiLang === "ru" ? "Снять snapshot" : "Capture snapshot"}
                            </button>
                            <button
                              type="button"
                              data-testid="appendable-route-pilot-report-pass"
                              onClick={() => markAppendableRoutePilotReport("pass")}
                              className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/15"
                            >
                              Mark pass
                            </button>
                            <button
                              type="button"
                              data-testid="appendable-route-pilot-report-fail"
                              onClick={() => markAppendableRoutePilotReport("fail")}
                              className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/15"
                            >
                              Mark fail
                            </button>
                            <button
                              type="button"
                              data-testid="appendable-route-pilot-report-download"
                              onClick={() => downloadAppendableRoutePilotReport()}
                              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 hover:text-white"
                            >
                              {uiLang === "ru" ? "Скачать report" : "Download report"}
                            </button>
                          </div>
                          <label className="mt-2 block text-[11px] text-white/60">
                            NOTES
                            <textarea
                              data-testid="appendable-route-pilot-report-notes"
                              value={appendableRoutePilotReport.notes}
                              onChange={(e) => setAppendableRoutePilotNotes(e.currentTarget.value)}
                              rows={3}
                              className="mt-1 w-full rounded-sm border border-white/15 bg-black/25 px-2 py-1 text-[11px] text-white outline-none"
                            />
                          </label>
                          {appendableRoutePilotReport.snapshot ? (
                            <div className="mt-2 space-y-1 text-[11px] text-white/50">
                              <div>audio mode: {appendableRoutePilotReport.snapshot.audioMode}</div>
                              <div>
                                gate: {appendableRoutePilotReport.snapshot.gate.status} /{" "}
                                {appendableRoutePilotReport.snapshot.gate.statusLabel}
                              </div>
                              <div>
                                flags: appendable={appendableRoutePilotReport.snapshot.flags.appendableQueuePilotEnabled ? "on" : "off"} / multistem=
                                {appendableRoutePilotReport.snapshot.flags.appendableQueueMultistemPilotEnabled ? "on" : "off"} / startup=
                                {appendableRoutePilotReport.snapshot.flags.appendableQueueStartupHeadPilotEnabled ? "on" : "off"} / chunks=
                                {appendableRoutePilotReport.snapshot.flags.appendableQueueContinuationChunksPilotEnabled ? "on" : "off"} / shadow_pitch=
                                {appendableRoutePilotReport.snapshot.flags.appendableQueueShadowPitchEnabled ? "on" : "off"}
                              </div>
                              <div>
                                activation: mode={appendableRoutePilotReport.snapshot.activation.mode} / tempo=
                                {appendableRoutePilotReport.snapshot.activation.tempoControlUnlocked ? "unlocked" : "locked"} / shadow=
                                {appendableRoutePilotReport.snapshot.activation.pitchShadowActive ? "active" : "off"} / match=
                                {appendableRoutePilotReport.snapshot.activation.matchedTarget ?? "—"}
                              </div>
                              <div>
                                source candidate:{" "}
                                {appendableRoutePilotReport.snapshot.sourceProgress.safeRolloutCandidateQualified ? "yes" : "no"} /
                                target={appendableRoutePilotReport.snapshot.sourceProgress.safeRolloutCandidateTarget ?? "—"}
                              </div>
                              <div>
                                probe: {appendableRoutePilotReport.snapshot.probe.active ? "active" : "idle"} / underrun=
                                {appendableRoutePilotReport.snapshot.probe.totalUnderrunFrames} / discontinuity=
                                {appendableRoutePilotReport.snapshot.probe.totalDiscontinuityCount}
                              </div>
                              <div>
                                probe soak: {formatOptionalFixed(appendableRoutePilotReport.snapshot.probe.cleanSoakSec)} / threshold=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.probe.readyThresholdSec)}
                              </div>
                              <div>
                                transport watermarks: low={formatOptionalFixed(appendableRoutePilotReport.snapshot.transport.minLowWaterSec)} / refill=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.transport.minRefillTriggerSec)} / high=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.transport.maxHighWaterSec)}
                              </div>
                              <div>
                                transport counters: underrun={appendableRoutePilotReport.snapshot.transport.totalUnderrunFrames} / discontinuity=
                                {appendableRoutePilotReport.snapshot.transport.totalDiscontinuityCount} / low-breach=
                                {appendableRoutePilotReport.snapshot.transport.totalLowWaterBreachCount} / high-breach=
                                {appendableRoutePilotReport.snapshot.transport.totalHighWaterBreachCount}
                              </div>
                              <div>
                                transport overflow: drops={appendableRoutePilotReport.snapshot.transport.totalOverflowDropCount} / frames=
                                {appendableRoutePilotReport.snapshot.transport.totalOverflowDroppedFrames}
                              </div>
                              <div>
                                qualification: {appendableRoutePilotReport.snapshot.qualification.passed == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.qualification.passed
                                    ? "pass"
                                    : "fail"}{" "}
                                / observed=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.qualification.observedCleanSoakSec)} / target=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.qualification.targetSoakSec)}
                                {appendableRoutePilotReport.snapshot.qualification.reason
                                  ? ` (${appendableRoutePilotReport.snapshot.qualification.reason})`
                                  : ""}
                              </div>
                              <div>
                                stress: {appendableRoutePilotReport.snapshot.stress.passed == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.stress.passed
                                    ? "pass"
                                    : "fail"}{" "}
                                / seeks=
                                {appendableRoutePilotReport.snapshot.stress.completedSeeks}/
                                {appendableRoutePilotReport.snapshot.stress.seekSequenceSec.length} / hold=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.stress.holdPerSeekSec)}
                                {appendableRoutePilotReport.snapshot.stress.reason
                                  ? ` (${appendableRoutePilotReport.snapshot.stress.reason})`
                                  : ""}
                              </div>
                              <div data-testid="appendable-route-pilot-report-visibility">
                                visibility: state={appendableRoutePilotReport.snapshot.visibility.currentState ?? "—"} / blur=
                                {appendableRoutePilotReport.snapshot.visibility.blurCount} / focus=
                                {appendableRoutePilotReport.snapshot.visibility.focusCount} / hidden=
                                {appendableRoutePilotReport.snapshot.visibility.visibilityHiddenCount} / visible=
                                {appendableRoutePilotReport.snapshot.visibility.visibilityVisibleCount} / hidden_playing=
                                {appendableRoutePilotReport.snapshot.visibility.hiddenWhilePlayingCount} / pagehide=
                                {appendableRoutePilotReport.snapshot.visibility.pageHideCount} / pageshow=
                                {appendableRoutePilotReport.snapshot.visibility.pageShowCount}
                                {appendableRoutePilotReport.snapshot.visibility.lastEvent
                                  ? ` / last=${appendableRoutePilotReport.snapshot.visibility.lastEvent}`
                                  : ""}
                              </div>
                              <div data-testid="appendable-route-pilot-report-pitch">
                                pitch shadow: {appendableRoutePilotReport.snapshot.pitch.passed == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.pitch.passed
                                    ? "pass"
                                    : "fail"}{" "}
                                / shadow={appendableRoutePilotReport.snapshot.pitch.shadowEnabled ? "on" : "off"} / support=
                                {appendableRoutePilotReport.snapshot.pitch.supportsIndependentPitch == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.pitch.supportsIndependentPitch
                                    ? "on"
                                    : "off"} / tempo=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.pitch.observedTempo)} / pitch=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.pitch.observedPitchSemitones)}
                                {appendableRoutePilotReport.snapshot.pitch.targetTempo != null ||
                                appendableRoutePilotReport.snapshot.pitch.targetPitchSemitones != null
                                  ? ` / target=${formatOptionalFixed(appendableRoutePilotReport.snapshot.pitch.targetTempo)}/${formatOptionalFixed(appendableRoutePilotReport.snapshot.pitch.targetPitchSemitones)}`
                                  : ""}
                                {appendableRoutePilotReport.snapshot.pitch.reason
                                  ? ` (${appendableRoutePilotReport.snapshot.pitch.reason})`
                                  : ""}
                              </div>
                              <div data-testid="appendable-route-pilot-report-rollout">
                                rollout: {appendableRoutePilotReport.snapshot.rollout.status} / gate=
                                {appendableRoutePilotReport.snapshot.rollout.gateReady ? "ready" : "not_ready"} / transport=
                                {appendableRoutePilotReport.snapshot.rollout.transportPassed == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.rollout.transportPassed
                                    ? "pass"
                                    : "fail"} / qualification=
                                {appendableRoutePilotReport.snapshot.rollout.qualificationPassed == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.rollout.qualificationPassed
                                    ? "pass"
                                    : "fail"} / stress=
                                {appendableRoutePilotReport.snapshot.rollout.stressPassed == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.rollout.stressPassed
                                    ? "pass"
                                    : "fail"}
                                {appendableRoutePilotReport.snapshot.rollout.reason
                                  ? ` (${appendableRoutePilotReport.snapshot.rollout.reason})`
                                  : ""}
                              </div>
                              <div>
                                transport: data={appendableRoutePilotReport.snapshot.probe.dataPlaneMode ?? "—"} / control=
                                {appendableRoutePilotReport.snapshot.probe.controlPlaneMode ?? "—"} / rates=
                                {appendableRoutePilotReport.snapshot.probe.sampleRates.length
                                  ? appendableRoutePilotReport.snapshot.probe.sampleRates.join(", ")
                                  : "—"}
                                / tempo={formatOptionalFixed(appendableRoutePilotReport.snapshot.probe.tempo)} / pitch=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.probe.pitchSemitones)}
                                / preferred={appendableRoutePilotReport.snapshot.probe.preferredDataPlaneMode ?? "—"} / sab=
                                {appendableRoutePilotReport.snapshot.probe.sabReady == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.probe.sabReady
                                    ? "ready"
                                    : "fallback"}
                              </div>
                              <div>
                                transport qualification: {appendableRoutePilotReport.snapshot.transport.passed == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.transport.passed
                                    ? "pass"
                                    : "fail"}{" "}
                                / data={appendableRoutePilotReport.snapshot.transport.dataPlaneMode ?? "—"} / control=
                                {appendableRoutePilotReport.snapshot.transport.controlPlaneMode ?? "—"} / rates=
                                {appendableRoutePilotReport.snapshot.transport.sampleRates.length
                                  ? appendableRoutePilotReport.snapshot.transport.sampleRates.join(", ")
                                  : "—"} / append=
                                {appendableRoutePilotReport.snapshot.transport.appendMessageCount}
                                / tempo={formatOptionalFixed(appendableRoutePilotReport.snapshot.transport.tempo)} / pitch=
                                {formatOptionalFixed(appendableRoutePilotReport.snapshot.transport.pitchSemitones)}
                                / preferred={appendableRoutePilotReport.snapshot.transport.preferredDataPlaneMode ?? "—"} / sab=
                                {appendableRoutePilotReport.snapshot.transport.sabReady == null
                                  ? "—"
                                  : appendableRoutePilotReport.snapshot.transport.sabReady
                                    ? "ready"
                                    : "fallback"}
                                {appendableRoutePilotReport.snapshot.transport.sabRequirement
                                  ? ` / ${appendableRoutePilotReport.snapshot.transport.sabRequirement}`
                                  : ""}
                                {appendableRoutePilotReport.snapshot.transport.reason
                                  ? ` (${appendableRoutePilotReport.snapshot.transport.reason})`
                                  : ""}
                              </div>
                              <div>
                                source: mode={appendableRoutePilotReport.snapshot.sourceProgress.mode} / startup=
                                {appendableRoutePilotReport.snapshot.sourceProgress.allStartupAppended ? "yes" : "no"} / fullDecoded=
                                {appendableRoutePilotReport.snapshot.sourceProgress.allFullDecoded ? "yes" : "no"} / fullAppended=
                                {appendableRoutePilotReport.snapshot.sourceProgress.allFullAppended ? "yes" : "no"}
                              </div>
                              <div>
                                source qualification: {appendableRoutePilotReport.snapshot.sourceProgress.continuationQualification}
                                {appendableRoutePilotReport.snapshot.sourceProgress.continuationQualificationReason
                                  ? ` (${appendableRoutePilotReport.snapshot.sourceProgress.continuationQualificationReason})`
                                  : ""}
                              </div>
                              <div>
                                source chunks: {appendableRoutePilotReport.snapshot.sourceProgress.continuationChunkGroupsDecoded}/
                                {appendableRoutePilotReport.snapshot.sourceProgress.continuationChunkGroupsPlanned} decoded /{" "}
                                {appendableRoutePilotReport.snapshot.sourceProgress.continuationChunkGroupsAppended}/
                                {appendableRoutePilotReport.snapshot.sourceProgress.continuationChunkGroupsPlanned} appended
                              </div>
                              <div>
                                source continuation coverage: {formatOptionalFixed(appendableRoutePilotReport.snapshot.sourceProgress.continuationCoverageEndSec)} / available groups:{" "}
                                {appendableRoutePilotReport.snapshot.sourceProgress.continuationChunkGroupsAvailable}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              data-testid="appendable-route-debug-save-current-diagnostics"
                              onClick={saveCurrentAppendableRouteDiagnostics}
                              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 hover:text-white"
                            >
                              {uiLang === "ru" ? "Сохранить текущее diagnostics" : "Save current diagnostics"}
                            </button>
                            <button
                              type="button"
                              data-testid="appendable-route-debug-run-quick-pilot-save"
                              disabled={appendableRouteQuickPilotRunning}
                              onClick={() => {
                                void saveAppendableRouteQuickPilotDiagnostics()
                              }}
                              className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {appendableRouteQuickPilotRunning
                                ? uiLang === "ru"
                                  ? "идет quick pilot..."
                                  : "quick pilot running..."
                                : uiLang === "ru"
                                  ? "Запустить quick pilot + сохранить"
                                  : "Run quick pilot + save diagnostics"}
                            </button>
                            <button
                              type="button"
                              data-testid="appendable-route-debug-run-soak-pilot-save"
                              disabled={appendableRouteSoakPilotRunning}
                              onClick={() => {
                                void saveAppendableRouteSoakPilotDiagnostics()
                              }}
                              className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {appendableRouteSoakPilotRunning
                                ? uiLang === "ru"
                                  ? "идет soak pilot..."
                                  : "soak pilot running..."
                                : uiLang === "ru"
                                  ? "Запустить soak pilot + сохранить"
                                  : "Run soak pilot + save diagnostics"}
                            </button>
                            <button
                              type="button"
                              data-testid="appendable-route-debug-run-qualification-pilot-save"
                              disabled={appendableRouteQualificationPilotRunning}
                              onClick={() => {
                                void saveAppendableRouteQualificationPilotDiagnostics()
                              }}
                              className="rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-[11px] text-fuchsia-100 hover:bg-fuchsia-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {appendableRouteQualificationPilotRunning
                                ? uiLang === "ru"
                                  ? "идет qualification pilot..."
                                  : "qualification pilot running..."
                                : uiLang === "ru"
                                  ? "Запустить qualification pilot + сохранить"
                                  : "Run qualification pilot + save diagnostics"}
                            </button>
                            <button
                              type="button"
                              data-testid="appendable-route-debug-run-stress-pilot-save"
                              disabled={appendableRouteStressPilotRunning}
                              onClick={() => {
                                void saveAppendableRouteStressPilotDiagnostics()
                              }}
                              className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {appendableRouteStressPilotRunning
                                ? uiLang === "ru"
                                  ? "идет stress pilot..."
                                  : "stress pilot running..."
                                : uiLang === "ru"
                                  ? "Запустить stress pilot + сохранить"
                                  : "Run stress pilot + save diagnostics"}
                            </button>
                            {appendableSafeRolloutCandidateTarget ? (
                              <>
                                <button
                                  type="button"
                                  data-testid="appendable-route-safe-rollout-target-toggle"
                                  onClick={toggleCurrentRouteSafeRolloutTarget}
                                  className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/15"
                                >
                                  {appendableSafeRolloutCandidateConfigured
                                    ? uiLang === "ru"
                                      ? "Убрать current route из safe rollout"
                                      : "Remove current route from safe rollout"
                                    : uiLang === "ru"
                                      ? "Добавить current route в safe rollout"
                                      : "Add current route to safe rollout"}
                                </button>
                                <button
                                  type="button"
                                  data-testid="appendable-route-safe-rollout-cohort-apply"
                                  onClick={applyQualifiedSafeRolloutCohort}
                                  className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-500/15"
                                >
                                  {uiLang === "ru"
                                    ? "Применить весь qualified safe rollout cohort"
                                    : "Apply full qualified safe rollout cohort"}
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void copyAudioDebugLog()}
                              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 hover:text-white"
                            >
                              Copy debug log
                            </button>
                            <span className="text-[11px] text-white/45">
                              {audioDebugCopyState === "copied"
                                ? "copied"
                                : audioDebugCopyState === "error"
                                  ? "copy failed"
                                  : `${audioDebugEntries.length} buffered`}
                            </span>
                          </div>
                          <div
                            data-testid="appendable-route-debug-diagnostics-status"
                            className="text-[11px] text-white/45"
                          >
                            {appendableRouteQuickPilotMessage ?? "—"}
                          </div>
                          <div className="max-h-48 overflow-auto rounded border border-white/10 bg-black/20 p-2 text-[10px] leading-4 text-white/55">
                            {recentAudioDebugEntries.length ? (
                              recentAudioDebugEntries.map((entry) => (
                                <div key={entry.id} className="mb-1 break-words last:mb-0">
                                  <span className="text-white/35">{entry.ts}</span>{" "}
                                  <span className="text-sky-200">{entry.channel}</span>{" "}
                                  {entry.channel === "AUDIO_DEBUG" ? (
                                    <span className="text-amber-200">{entry.event}</span>
                                  ) : null}{" "}
                                  <span>{JSON.stringify(entry.payload)}</span>
                                </div>
                              ))
                            ) : (
                              <div>no buffered audio events</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button onClick={resetGuestAndMainToStart} className="btn-round h-8 w-8" aria-label={t.guestGoToStartAria} title={t.guestGoToStartTitle}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 7 3 12l5 5" />
                        <path d="M4 12h12" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        if (guestWithTrackUiActive) {
                          pause()
                          guestTransportLinkedRef.current = false
                          return
                        }
                        playGuestWithTrack().catch(() => {})
                      }}
                      aria-label={guestWithTrackUiActive ? t.guestWithTrackStop : t.guestWithTrackStart}
                      title={guestWithTrackUiActive ? t.guestWithTrackStop : t.guestWithTrackStart}
                      disabled={guestActionBusy || guestCalibrating}
                      className={`h-8 w-8 rounded-md ${guestWithTrackUiActive ? "bg-green-600" : "bg-zinc-700 hover:bg-zinc-600"} text-white ${guestActionBusy || guestCalibrating ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {guestWithTrackUiActive ? (
                        <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4" fill="currentColor"><rect x="6" y="6" width="4" height="12" /><rect x="14" y="6" width="4" height="12" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4" fill="currentColor"><path d="m8 5 11 7-11 7z" /></svg>
                      )}
                    </button>
                    <button
                      onClick={handleMainRecClick}
                      data-testid="guest-record-toggle"
                      data-recording={recording || countInBeat != null ? "1" : "0"}
                      className={`h-8 w-11 rounded-md ${recording || countInBeat != null ? "bg-red-700" : "bg-zinc-800 hover:bg-zinc-700"} text-white`}
                    >
                      {recording || countInBeat != null ? (
                        <span className="mx-auto block h-3 w-3 rounded-[2px] bg-white" />
                      ) : (
                        <span className="mx-auto block h-3.5 w-3.5 rounded-full bg-red-500" />
                      )}
                    </button>
                    <button
                      onClick={() => setGuestLoop((v) => !v)}
                      className={`btn-round h-8 w-8 ${guestLoop ? "btn-round--active" : ""}`}
                      title={t.guestRepeatFragmentTitle}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 7v5h-5" />
                        <path d="M4 17v-5h5" />
                        <path d="M18.5 12A6.5 6.5 0 0 0 7 8" />
                        <path d="M5.5 12A6.5 6.5 0 0 0 17 16" />
                      </svg>
                    </button>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => {
                          if (guestIsPlaying && !guestTransportLinkedRef.current) pauseGuestSolo()
                          else playGuestOnly().catch(() => {})
                        }}
                      disabled={guestActionBusy || guestCalibrating}
                      className={`rounded-sm px-2 py-1 text-xs ${guestIsPlaying && !guestTransportLinkedRef.current ? "bg-[#5f82aa]" : "bg-zinc-700 hover:bg-zinc-600"} ${guestActionBusy || guestCalibrating ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {t.solo}
                    </button>
                      <button
                        onClick={() => setGuestMuted((v) => !v)}
                      className={`rounded-sm px-2 py-1 text-xs ${guestMuted ? "bg-red-600" : "bg-zinc-700 hover:bg-zinc-600"}`}
                    >
                      {t.mute}
                    </button>
                    </div>
                    <div className="w-[96px]">
                      {uiLang === "ru" ? (
                        <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
                          <span>{t.left}</span>
                          <span>{t.right}</span>
                        </div>
                      ) : (
                        <div className="mb-1 text-[11px] text-white/60">{t.pan}</div>
                      )}
                      <CenterMarkedSlider value={guestPan} min={-1} max={1} step={0.01} onChange={(v) => setGuestPan(v)} ariaLabel={t.guestPanAria} />
                    </div>
                    <div className="w-[120px]">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-white/65">
                        <span>{t.volShort}</span>
                        <span>{Math.round(guestVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={GUEST_MAX_GAIN}
                        step={0.01}
                        value={guestVolume}
                        onChange={(e) => setGuestVolume(clamp(Number(e.currentTarget.value), 0, GUEST_MAX_GAIN))}
                        className="w-full range-thin"
                        aria-label={t.guestVolumeAria}
                      />
                    </div>
                    <div className="min-w-[190px] flex-1 max-w-[280px]">
                      <div className="flex items-center justify-between text-[11px] text-white/65">
                        <span>{t.delay}</span>
                        <span>{Math.round(guestSyncOffsetSec * 1000)} ms</span>
                      </div>
                      <input
                        type="range"
                        min={GUEST_SYNC_MIN_SEC}
                        max={GUEST_SYNC_MAX_SEC}
                        step={0.005}
                        value={guestSyncOffsetSec}
                        onChange={(e) => setGuestSyncOffsetSec(Number(e.currentTarget.value))}
                        className="w-full range-thin"
                        aria-label={t.guestDelayAria}
                      />
                    </div>
                    <span className="text-[11px] text-white/75">{formatTime(guestCurrentTime)} / {formatTime(guestDuration)}</span>
                    <div className="relative ml-auto">
                      <button
                        onClick={() => {
                          if (!guestTrackUrl || guestExportingDuet) return
                          setGuestDownloadMenuOpen((v) => !v)
                        }}
                        className={`rounded-sm px-2 py-1 text-xs ${guestTrackUrl && !guestExportingDuet ? "bg-zinc-700 hover:bg-zinc-600" : "bg-zinc-800 text-white/40 cursor-not-allowed"}`}
                      >
                        {guestExportingDuet ? t.export : t.save}
                      </button>
                      {guestDownloadMenuOpen && guestTrackUrl ? (
                        <div className="absolute right-0 top-[calc(100%+6px)] z-20 min-w-[140px] rounded-md border border-white/10 bg-zinc-900/95 p-1 shadow-xl">
                          <button
                            onClick={() => {
                              downloadGuestSolo("m4a").catch(() => {})
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-white hover:bg-zinc-700"
                          >
                            {t.soloFmtM4a}
                          </button>
                          <button
                            onClick={() => {
                              downloadGuestSolo("mp3").catch(() => {})
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-white hover:bg-zinc-700"
                          >
                            {t.soloFmtMp3}
                          </button>
                          <button
                            onClick={() => {
                              downloadGuestSolo("wav").catch(() => {})
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-white hover:bg-zinc-700"
                          >
                            {t.soloFmtWav}
                          </button>
                          <button
                            onClick={() => {
                              setGuestDuetMixOpen((v) => !v)
                            }}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-white hover:bg-zinc-700"
                          >
                            {t.duet}
                          </button>
                          {guestDuetMixOpen ? (
                            <div className="mt-1 space-y-2 rounded border border-white/10 bg-black/35 p-2 text-[11px] text-white/80">
                              <div>
                                <div className="mb-1 flex items-center justify-between">
                                  <span>{t.duetGuest}</span>
                                  <span>{duetGuestLevel}%</span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={150}
                                  step={1}
                                  value={duetGuestLevel}
                                  onChange={(e) => setDuetGuestLevel(Number(e.currentTarget.value))}
                                  className="w-full range-thin"
                                />
                              </div>
                              <div>
                                <div className="mb-1 flex items-center justify-between">
                                  <span>{t.duetSoloTrack}</span>
                                  <span>{duetSoloLevel}%</span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={150}
                                  step={1}
                                  value={duetSoloLevel}
                                  onChange={(e) => setDuetSoloLevel(Number(e.currentTarget.value))}
                                  className="w-full range-thin"
                                />
                              </div>
                              <div>
                                <div className="mb-1 text-[11px] text-white/70">{t.duetFormat}</div>
                                <div className="grid grid-cols-3 gap-1">
                                  {(["m4a", "mp3", "wav"] as ExportFormat[]).map((fmt) => (
                                    <button
                                      key={fmt}
                                      onClick={() => setDuetFormat(fmt)}
                                      className={`rounded px-1 py-1 text-[11px] ${duetFormat === fmt ? "bg-[#5f82aa] text-white" : "bg-zinc-700 text-white/90 hover:bg-zinc-600"}`}
                                    >
                                      {fmt === "mp3" ? "mp3 320" : fmt}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  downloadGuestDuet().catch(() => {})
                                }}
                                className="w-full rounded bg-[#5f82aa] px-2 py-1.5 text-xs font-medium text-white hover:bg-[#7398c2]"
                              >
                                {t.saveDuet}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {guestTakes.length > 0 ? (
                    <div className="rounded-sm border border-white/10 bg-black/20 p-2">
                      <div className="mb-2 text-xs text-white/75">{t.takes}</div>
                      <div className="flex flex-wrap gap-1">
                        {guestTakes.map((take) => (
                          <button
                            key={take.id}
                            onClick={() => {
                              activateGuestTake(take.id).catch(() => {})
                            }}
                            className={`rounded-sm px-2 py-1 text-[11px] ${
                              take.id === activeGuestTakeId ? "bg-[#5f82aa] text-white" : "bg-zinc-800 text-white/80 hover:bg-zinc-700"
                            }`}
                            title={`${take.title} · ${take.syncQuality ?? "unknown"}`}
                          >
                            {t.activateTake}: {take.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-xl overflow-hidden border border-white/10 bg-black/25">
                    <canvas
                      ref={guestCanvasRef}
                      aria-label="Guest waveform"
                      onPointerDown={onGuestWavePointerDown}
                      onPointerMove={onGuestWavePointerMove}
                      onPointerUp={onGuestWavePointerUp}
                      className="w-full h-[74px] cursor-pointer"
                      title={t.guestWaveformTitle}
                    />
                  </div>
                  {recordError ? <div className="text-xs text-red-300">{recordError}</div> : null}
                </div>
              ) : null}

              <audio
                ref={guestAudioRef}
                controls={false}
                src={guestTrackUrl ?? undefined}
                className="hidden"
                onLoadedMetadata={(e) => {
                  setGuestDuration(e.currentTarget.duration || guestDuration)
                }}
                onTimeUpdate={(e) => {
                  setGuestCurrentTime(e.currentTarget.currentTime)
                  if (guestSyncGuardRef.current) return
                  if (!guestTransportLinkedRef.current || !isPlayingRef.current) return
                  const now = Date.now()
                  if (now - guestDriftLastSampleAtRef.current < GUEST_DRIFT_SAMPLE_THROTTLE_MS) return
                  guestDriftLastSampleAtRef.current = now
                  const mainPos = enginesRef.current[0]?.getSourcePositionSeconds?.() ?? positionSecRef.current
                  syncGuestToMain(mainPos, false)
                  if (now - guestDriftTelemetryLastFlushAtRef.current >= GUEST_DRIFT_TELEMETRY_FLUSH_MS) {
                    void flushGuestSyncTelemetry("periodic")
                  }
                }}
                onPause={() => setGuestIsPlaying(false)}
                onPlay={() => setGuestIsPlaying(true)}
                onEnded={() => {
                  setGuestIsPlaying(false)
                  if (guestLoop) {
                    if (guestTransportLinkedRef.current) {
                      guestTransportLinkedRef.current = false
                      resetGuestAndMainToStart()
                      playGuestWithTrack().catch(() => {})
                    } else {
                      playGuestOnly().catch(() => {})
                    }
                    return
                  }
                  setGuestSoloMode(false)
                  if (guestTransportLinkedRef.current) {
                    pause()
                    guestTransportLinkedRef.current = false
                  }
                }}
                onError={() => {
                  setRecordError(t.guestFilePlaybackFailed)
                }}
              />
            </div>

            <div className="order-3 space-y-4">
              {trackList.map((track, i) => {
                const audible = isTrackAudible(i)
                const isLit = isPlaying && audible
                return (
                  <div key={i} className={`space-y-2 transition ${isLit ? "opacity-100" : "opacity-45"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{track.name}</span>
                        <button
                          onClick={() => toggleMute(i)}
                          aria-label={`Mute ${track.name}`}
                          className={`px-2.5 py-1 rounded text-xs transition ${muted[i] ? "bg-red-600" : "bg-zinc-700 hover:bg-zinc-600"}`}
                        >
                          M
                        </button>
                        <button
                          onClick={() => toggleSolo(i)}
                          aria-label={`Solo ${track.name}`}
                          className={`px-2.5 py-1 rounded text-xs transition ${solo[i] ? "bg-yellow-400 text-black" : "bg-zinc-700 hover:bg-zinc-600"}`}
                        >
                          S
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="hidden md:block">
                          <div className="text-[11px] text-white/60 mb-1">{t.volShort}</div>
                          <input
                            type="range"
                            aria-label={`Volume ${track.name}`}
                            min={0}
                            max={1}
                            step="0.01"
                            value={volUI[i] ?? 1}
                            onChange={(e) => setVol(i, Number(e.currentTarget.value))}
                            className="range-thin range-short"
                          />
                        </div>
                        <div className="hidden md:block w-[132px]">
                          {uiLang === "ru" ? (
                            <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
                              <span>{t.left}</span>
                              <span>{t.right}</span>
                            </div>
                          ) : (
                            <div className="text-[11px] text-white/60 mb-1">{t.pan}</div>
                          )}
                          <CenterMarkedSlider
                            value={panUI[i] ?? 0}
                            ariaLabel={`Pan ${track.name}`}
                            min={-1}
                            max={1}
                            step={0.01}
                            onChange={(v) => setPan(i, v)}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl overflow-hidden border border-white/10 bg-black/25">
                      <canvas
                        aria-label={`Waveform ${track.name}`}
                        data-track-index={i}
                        ref={(el) => {
                          waveCanvasesRef.current[i] = el
                        }}
                        onPointerDown={onWavePointerDown}
                        onPointerMove={onWavePointerMove}
                        onPointerUp={onWavePointerUp}
                        className="w-full h-[92px] cursor-pointer"
                        title={t.trackWaveformTitle}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="order-4 rounded-xl border border-white/10 bg-zinc-900/70 p-3 space-y-3">
                <button
                  onClick={() => setShowPiano((v) => !v)}
                  className="rounded-sm bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
                >
                  {showPiano ? t.pianoHide : t.pianoShow}
                </button>
              {showPiano ? (
                <div className="space-y-2">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-white/70">
                        <span>{t.pianoVolumeLabel}</span>
                        <span>{Math.round(pianoVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={1.8}
                        step={0.01}
                        value={pianoVolume}
                        onChange={(e) => setPianoVolume(Number(e.currentTarget.value))}
                        className="w-full range-thin"
                        aria-label={t.pianoVolumeAria}
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-white/70">
                        <span>{t.pianoOctaveRangeLabel}</span>
                        <span>{OCTAVE_NAMES[pianoBaseOctave]} + {OCTAVE_NAMES[pianoBaseOctave + 1]}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={6}
                        step={1}
                        value={pianoBaseOctave}
                        onChange={(e) => setPianoBaseOctave(Number(e.currentTarget.value))}
                        className="w-full range-thin"
                        aria-label={t.pianoOctaveRangeAria}
                      />
                    </div>
                  </div>
                  <div className="text-xs text-white/65">
                    {t.pianoHint} {OCTAVE_NAMES[3]} + {OCTAVE_NAMES[4]}.
                  </div>
                  <div className="relative h-[180px] w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-800/70 p-2">
                    <div className="grid h-full grid-cols-14 gap-[2px]">
                      {pianoKeys.filter((k) => !k.isBlack).map((key) => (
                        <button
                          key={key.note}
                          onMouseDown={() => playPianoTone(key.freq)}
                          className="relative rounded-b-md border border-zinc-300 bg-zinc-100 text-zinc-900 hover:bg-white"
                        >
                          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px]">{key.note}</span>
                          {key.kbd ? <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] text-zinc-500">{key.kbd?.toUpperCase()}/{key.kbdRu?.toUpperCase()}</span> : null}
                        </button>
                      ))}
                    </div>
                    {pianoKeys.filter((k) => k.isBlack).map((key) => (
                      <button
                        key={key.note}
                        onMouseDown={() => playPianoTone(key.freq)}
                        className="absolute top-2 h-[105px] w-[5.5%] -translate-x-1/2 rounded-b-md border border-zinc-900 bg-zinc-950 text-white hover:bg-black"
                        style={{ left: `${key.left}%` }}
                      >
                        {key.kbd ? <span className="mt-1 block text-[10px] text-zinc-400">{key.kbd?.toUpperCase()}/{key.kbdRu?.toUpperCase()}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          ) : null}
      </>
      ) : null}
    </div>
  )
}
