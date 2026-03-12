import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ mode: "serial" })

const MAX_STEM_DRIFT_SEC = 0.04
const MAX_TRANSPORT_DRIFT_SEC = 0.08
const PITCH_MATRIX_SEMITONES = [-12, -7, -4, 4, 7, 12]
const TEMPO_PITCH_MATRIX = [
  { tempo: 0.9, pitchSemitones: -4 },
  { tempo: 1.1, pitchSemitones: 4 },
  { tempo: 0.85, pitchSemitones: -7 },
  { tempo: 1.15, pitchSemitones: 7 },
  { tempo: 0.95, pitchSemitones: -12 },
  { tempo: 1.05, pitchSemitones: 12 },
]

type AppendableQueueLabStemState = {
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
  stats: {
    sampleRate: number
    dataPlaneMode: string
    controlPlaneMode: string
    preferredDataPlaneMode: string | null
    sabReady: boolean | null
    supportsIndependentPitch: boolean
    appendMessageCount: number
    appendedBytes: number
    underrunFrames: number
    droppedFrames: number
    discontinuityCount: number
    lowWaterBreachCount: number
    highWaterBreachCount: number
    overflowDropCount: number
    overflowDroppedFrames: number
    generation: number
    bufferLeadSec: number
    minObservedLeadSec: number
    maxObservedLeadSec: number
    lowWaterSec: number
    highWaterSec: number
    refillTriggerSec: number
    pitchSemitones: number
  } | null
}

type AppendableQueueLabState = {
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
  allStartupAppended: boolean
  allFullDecoded: boolean
  allFullAppended: boolean
  stems: AppendableQueueLabStemState[]
  sync: {
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
}

type AppendableQueueListeningReport = {
  activeScenarioId: "boundary" | "late_append" | "seek_loop" | null
  updatedAt: string | null
  scenarios: {
    boundary: {
      status: "pending" | "pass" | "fail"
      notes: string
      capturedAt: string | null
      snapshot: AppendableQueueLabState | null
    }
    late_append: {
      status: "pending" | "pass" | "fail"
      notes: string
      capturedAt: string | null
      snapshot: AppendableQueueLabState | null
    }
    seek_loop: {
      status: "pending" | "pass" | "fail"
      notes: string
      capturedAt: string | null
      snapshot: AppendableQueueLabState | null
    }
  }
}

type AudioDebugCaptureArtifact = {
  format: "audio/wav"
  sampleRate: number
  channels: 1
  durationSec: number
  captureWindowSec: number
  totalCapturedSec: number
  artifactStartOffsetSec: number
  artifactEndOffsetSec: number
  wavBase64: string
  clickEvents: Array<{
    ts: string
    deltaAbs: number
    frameCursorFrames: number
    outputSec: number
    trackCurrentSec: number | null
  }>
}

type BoundaryAbPreviewState = {
  mode: "idle" | "appendable_queue" | "source_reference"
  startSec: number
  durationSec: number
  updatedAt: string | null
  lastCompletedMode: "appendable_queue" | "source_reference" | null
}

async function getHarnessState(page: Page): Promise<AppendableQueueLabState> {
  try {
    return await page.evaluate(() => {
      const api =
        (window as Window & { __rrAppendableQueueDebug?: { getState: () => AppendableQueueLabState } })
          .__rrAppendableQueueDebug
      if (!api) {
        return {
          ready: false,
          playing: false,
          tempo: 1,
          pitchSemitones: 0,
          supportsIndependentPitch: false,
          dataPlaneMode: null,
          controlPlaneMode: null,
          sampleRates: [],
          totalAppendMessages: 0,
          totalAppendedBytes: 0,
          trackLabel: "",
          stemCount: 0,
          transportSec: 0,
          startupDurationSec: 0,
          durationSec: 0,
          harnessInstanceId: null,
          allStartupAppended: false,
          allFullDecoded: false,
          allFullAppended: false,
          stems: [],
          sync: {
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
          },
        }
      }
      return api.getState()
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("Execution context was destroyed")) {
      return {
        ready: false,
        playing: false,
        tempo: 1,
        pitchSemitones: 0,
        supportsIndependentPitch: false,
        dataPlaneMode: null,
        controlPlaneMode: null,
        sampleRates: [],
        totalAppendMessages: 0,
        totalAppendedBytes: 0,
        trackLabel: "",
        stemCount: 0,
        transportSec: 0,
        startupDurationSec: 0,
        durationSec: 0,
        harnessInstanceId: null,
        allStartupAppended: false,
        allFullDecoded: false,
        allFullAppended: false,
        stems: [],
        sync: {
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
        },
      }
    }
    throw error
  }
}

async function getListeningReport(page: Page): Promise<AppendableQueueListeningReport | null> {
  return page.evaluate(() => {
    const api =
      (window as Window & {
        __rrAppendableQueueDebug?: { getListeningReport: () => AppendableQueueListeningReport }
      }).__rrAppendableQueueDebug
    return api?.getListeningReport() ?? null
  })
}

async function runBoundaryCaptureScenario(page: Page): Promise<AudioDebugCaptureArtifact | null> {
  return page.evaluate(async () => {
    const api =
      (window as Window & {
        __rrAppendableQueueDebug?: {
          runBoundaryCaptureScenario: () => Promise<AudioDebugCaptureArtifact | null>
        }
      }).__rrAppendableQueueDebug
    return (await api?.runBoundaryCaptureScenario()) ?? null
  })
}

async function runLongSoakScenario(page: Page, targetSec?: number) {
  await page.evaluate(async (nextTargetSec) => {
    const api =
      (window as Window & {
        __rrAppendableQueueDebug?: { runLongSoakScenario: (targetSec?: number) => Promise<void> }
      }).__rrAppendableQueueDebug
    if (!api) throw new Error("appendable queue debug API unavailable")
    await api.runLongSoakScenario(nextTargetSec)
  }, targetSec)
}

async function runInterruptionLoopScenario(page: Page) {
  await page.evaluate(async () => {
    const api =
      (window as Window & {
        __rrAppendableQueueDebug?: { runInterruptionLoopScenario: () => Promise<void> }
      }).__rrAppendableQueueDebug
    if (!api) throw new Error("appendable queue debug API unavailable")
    await api.runInterruptionLoopScenario()
  })
}

async function getBoundaryAbPreviewState(page: Page): Promise<BoundaryAbPreviewState | null> {
  return page.evaluate(() => {
    const api =
      (window as Window & {
        __rrAppendableQueueDebug?: { getBoundaryABPreviewState: () => BoundaryAbPreviewState }
      }).__rrAppendableQueueDebug
    return api?.getBoundaryABPreviewState() ?? null
  })
}

async function playBoundaryQueueABPreview(page: Page) {
  await page.evaluate(async () => {
    const api =
      (window as Window & {
        __rrAppendableQueueDebug?: { playBoundaryQueueABPreview: () => Promise<void> }
      }).__rrAppendableQueueDebug
    if (!api) throw new Error("appendable queue debug API unavailable")
    await api.playBoundaryQueueABPreview()
  })
}

async function playBoundaryReferenceABPreview(page: Page) {
  await page.evaluate(async () => {
    const api =
      (window as Window & {
        __rrAppendableQueueDebug?: { playBoundaryReferenceABPreview: () => Promise<void> }
      }).__rrAppendableQueueDebug
    if (!api) throw new Error("appendable queue debug API unavailable")
    await api.playBoundaryReferenceABPreview()
  })
}

async function waitForHarness(page: Page) {
  await page.goto("/appendable-queue-lab")
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30000) {
    await expect
      .poll(async () => {
        const state = await getHarnessState(page)
        return state.ready && state.stemCount === 2
      }, { timeout: 20000 })
      .toBe(true)

    const firstState = await getHarnessState(page)
    if (!firstState.ready || firstState.stemCount !== 2 || firstState.harnessInstanceId == null) continue

    await page.waitForTimeout(1500)

    const secondState = await getHarnessState(page)
    if (
      secondState.ready &&
      secondState.stemCount === 2 &&
      secondState.harnessInstanceId != null &&
      secondState.harnessInstanceId === firstState.harnessInstanceId
    ) {
      return
    }
  }

  throw new Error("appendable queue lab harness did not stabilize before the test started")
}

async function waitForAllFullDecoded(page: Page) {
  await expect.poll(async () => (await getHarnessState(page)).allFullDecoded, { timeout: 90000 }).toBe(true)
}

async function appendAllFullRemainder(page: Page) {
  const appendedFrames = await page.evaluate(() => {
    const api =
      (window as Window & { __rrAppendableQueueDebug?: { appendFullRemainder: () => number } }).__rrAppendableQueueDebug
    return api?.appendFullRemainder() ?? 0
  })
  expect(appendedFrames).toBeGreaterThan(0)
}

async function appendStemFullRemainder(page: Page, stemIndex: number) {
  const appendedFrames = await page.evaluate((index) => {
    const api =
      (window as Window & { __rrAppendableQueueDebug?: { appendFullRemainderStem: (stemIndex: number) => number } })
        .__rrAppendableQueueDebug
    return api?.appendFullRemainderStem(index) ?? 0
  }, stemIndex)
  expect(appendedFrames).toBeGreaterThan(0)
}

async function runSeekLoopScenario(page: Page) {
  await page.evaluate(async () => {
    const api =
      (window as Window & { __rrAppendableQueueDebug?: { runSeekLoopScenario: () => Promise<void> } })
        .__rrAppendableQueueDebug
    if (!api) throw new Error("appendable queue debug API unavailable")
    await api.runSeekLoopScenario()
  })
}

async function setHarnessTempo(page: Page, tempo: number) {
  const applied = await page.evaluate((nextTempo) => {
    const api =
      (window as Window & { __rrAppendableQueueDebug?: { setTempo: (tempo: number) => number } })
        .__rrAppendableQueueDebug
    if (!api) throw new Error("appendable queue debug API unavailable")
    return api.setTempo(nextTempo)
  }, tempo)
  expect(applied).toBeCloseTo(tempo, 3)
}

async function setHarnessPitchSemitones(page: Page, semitones: number) {
  const applied = await page.evaluate((nextSemitones) => {
    const api =
      (window as Window & { __rrAppendableQueueDebug?: { setPitchSemitones: (semitones: number) => number } })
        .__rrAppendableQueueDebug
    if (!api) throw new Error("appendable queue debug API unavailable")
    return api.setPitchSemitones(nextSemitones)
  }, semitones)
  expect(applied).toBe(semitones)
}

function expectPitchTelemetry(finalState: AppendableQueueLabState, expectedPitchSemitones: number) {
  expect(finalState.supportsIndependentPitch).toBe(true)
  expect(finalState.pitchSemitones).toBe(expectedPitchSemitones)
  expect(finalState.stems.every((stem) => stem.stats?.supportsIndependentPitch === true)).toBe(true)
  expect(finalState.stems.every((stem) => stem.stats?.pitchSemitones === expectedPitchSemitones)).toBe(true)
}

function expectQualityGates(
  finalState: AppendableQueueLabState,
  opts?: { requireSteadyStateWatermarks?: boolean; maxLowWaterBreaches?: number }
) {
  expect(finalState.sync.totalUnderrunFrames).toBe(0)
  expect(finalState.sync.totalDiscontinuityCount).toBe(0)
  expect(finalState.sync.totalOverflowDropCount).toBe(0)
  expect(finalState.sync.totalOverflowDroppedFrames).toBe(0)
  expect(finalState.sync.stemDriftSec).toBeLessThan(MAX_STEM_DRIFT_SEC)
  expect(finalState.sync.transportDriftSec).toBeLessThan(MAX_TRANSPORT_DRIFT_SEC)
  if (opts?.requireSteadyStateWatermarks === true) {
    expect(finalState.sync.totalLowWaterBreachCount).toBeLessThanOrEqual(opts.maxLowWaterBreaches ?? 2)
  }
  for (const stem of finalState.stems) {
    expect(stem.stats?.underrunFrames ?? -1).toBe(0)
    expect(stem.stats?.droppedFrames ?? -1).toBe(0)
    expect(stem.stats?.discontinuityCount ?? -1).toBe(0)
    expect(stem.stats?.overflowDropCount ?? -1).toBe(0)
    expect(stem.stats?.overflowDroppedFrames ?? -1).toBe(0)
    if (opts?.requireSteadyStateWatermarks === true) {
      expect(stem.stats?.lowWaterBreachCount ?? -1).toBeLessThanOrEqual(opts.maxLowWaterBreaches ?? 2)
    }
  }
}

function expectSabRingTelemetry(state: AppendableQueueLabState) {
  expect(state.dataPlaneMode).toBe("sab_ring")
  expect(state.controlPlaneMode).toBe("message_port")
  expect(state.preferredDataPlaneMode).toBe("sab_ring_preferred")
  expect(state.sabReady).toBe(true)
  expect(state.crossOriginIsolated).toBe(true)
  expect(state.sabRequirement).toBeNull()
  expect(state.totalAppendMessages).toBe(0)
  expect(state.totalAppendedBytes).toBeGreaterThan(0)
  expect(state.sync.minLowWaterSec).toBeGreaterThan(0)
  expect(state.sync.maxHighWaterSec).toBeGreaterThan(state.sync.minLowWaterSec)
  expect(state.sync.minRefillTriggerSec).toBeGreaterThan(state.sync.minLowWaterSec)
  expect(state.sync.maxObservedLeadSec).toBeGreaterThan(0)
  expect(state.sync.maxObservedLeadSec).toBeGreaterThanOrEqual(state.sync.minObservedLeadSec)
  expect(state.sync.totalOverflowDropCount).toBe(0)
  expect(state.sync.totalOverflowDroppedFrames).toBe(0)
  expect(state.stems.every((stem) => stem.stats?.dataPlaneMode === "sab_ring")).toBe(true)
  expect(
    state.stems.every(
      (stem) =>
        (stem.stats?.lowWaterSec ?? 0) > 0 &&
        (stem.stats?.highWaterSec ?? 0) > (stem.stats?.lowWaterSec ?? 0) &&
        (stem.stats?.refillTriggerSec ?? 0) > (stem.stats?.lowWaterSec ?? 0)
    )
  ).toBe(true)
  expect(state.stems.every((stem) => (stem.stats?.overflowDropCount ?? 0) === 0)).toBe(true)
  expect(state.stems.every((stem) => (stem.stats?.overflowDroppedFrames ?? 0) === 0)).toBe(true)
}

test("cross-origin isolated harness activates sab_ring transport with explicit telemetry", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)
  await appendAllFullRemainder(page)

  const initialState = await getHarnessState(page)
  expectSabRingTelemetry(initialState)
  expect(initialState.sampleRates.length).toBeGreaterThan(0)
  expect(initialState.sync.totalUnderrunFrames).toBe(0)
  expect(initialState.sync.totalDiscontinuityCount).toBe(0)
})

test("multitrack appendable queue crosses the startup boundary in sync", async ({ page }) => {
  await waitForHarness(page)

  const initialState = await getHarnessState(page)
  expect(initialState.trackLabel).toContain("terek")
  expect(initialState.allStartupAppended).toBe(true)
  expect(initialState.allFullAppended).toBe(false)
  expect(initialState.stems).toHaveLength(2)

  await waitForAllFullDecoded(page)
  await appendAllFullRemainder(page)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 5000 }).toBeGreaterThan(1)
  await expect
    .poll(async () => (await getHarnessState(page)).transportSec, { timeout: 25000 })
    .toBeGreaterThan(initialState.startupDurationSec + 1.2)

  const finalState = await getHarnessState(page)
  expect(finalState.allFullAppended).toBe(true)
  expect(finalState.stems.every((stem) => stem.sourceEnded)).toBe(true)
  expect(finalState.sync.transportDriftSec).toBeLessThan(0.08)
  expectSabRingTelemetry(finalState)
  expectQualityGates(finalState)
})

test("seek/rebase and pause/resume keep both engine instances aligned", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)
  await appendAllFullRemainder(page)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 5000 }).toBeGreaterThan(0.8)

  const beforeSeek = await getHarnessState(page)
  const beforeEngineIds = beforeSeek.stems.map((stem) => stem.engineInstanceId)

  const rebasedSec = await page.evaluate(() => {
    const api =
      (window as Window & { __rrAppendableQueueDebug?: { rebase: (sec: number) => number } }).__rrAppendableQueueDebug
    return api?.rebase(6) ?? -1
  })
  expect(rebasedSec).toBeGreaterThan(5.9)

  await expect
    .poll(async () => {
      const state = await getHarnessState(page)
      return state.transportSec >= 5.7 && state.transportSec <= 6.8 && state.sync.stemDriftSec < 0.04
    }, { timeout: 5000 })
    .toBe(true)

  await page.getByRole("button", { name: "Pause", exact: true }).click()
  const pausedState = await getHarnessState(page)
  await page.waitForTimeout(400)
  const pausedAfter = await getHarnessState(page)
  expect(Math.abs(pausedAfter.transportSec - pausedState.transportSec)).toBeLessThan(0.08)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect
    .poll(async () => (await getHarnessState(page)).transportSec, { timeout: 5000 })
    .toBeGreaterThan(pausedAfter.transportSec + 0.25)

  const finalState = await getHarnessState(page)
  expect(finalState.stems.map((stem) => stem.engineInstanceId)).toEqual(beforeEngineIds)
  expect(finalState.sync.transportDriftSec).toBeLessThan(0.08)
  expectSabRingTelemetry(finalState)
  expectQualityGates(finalState)
})

test("tempo-only mode keeps appendable multistem playback aligned", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)
  await appendAllFullRemainder(page)
  await setHarnessTempo(page, 1.2)

  const initialState = await getHarnessState(page)
  expect(initialState.tempo).toBeCloseTo(1.2, 3)
  expect(initialState.dataPlaneMode).toBe("sab_ring")
  expect(initialState.controlPlaneMode).toBe("message_port")
  expect(initialState.preferredDataPlaneMode).toBe("sab_ring_preferred")
  expect(initialState.sabReady).toBe(true)
  expect(initialState.crossOriginIsolated).toBe(true)
  expect(initialState.sabRequirement).toBeNull()
  expect(initialState.sampleRates.length).toBeGreaterThan(0)
  expect(initialState.totalAppendMessages).toBe(0)
  expect(initialState.totalAppendedBytes).toBeGreaterThan(0)
  expect(initialState.stems.every((stem) => stem.stats?.dataPlaneMode === "sab_ring")).toBe(true)
  expect(initialState.stems.every((stem) => stem.stats?.preferredDataPlaneMode === "sab_ring_preferred")).toBe(true)
  expect(initialState.stems.every((stem) => stem.stats?.sabReady === true)).toBe(true)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 5000 }).toBeGreaterThan(1)
  await expect
    .poll(async () => (await getHarnessState(page)).transportSec, { timeout: 8000 })
    .toBeGreaterThan(2.6)

  const finalState = await getHarnessState(page)
  expect(finalState.tempo).toBeCloseTo(1.2, 3)
  expect(finalState.sync.transportDriftSec).toBeLessThan(0.08)
  expect(finalState.sync.stemDriftSec).toBeLessThan(0.04)
  expect(finalState.sync.totalDiscontinuityCount).toBe(0)
  expectSabRingTelemetry(finalState)
})

test("lab-gated worklet-local pitch changes preserve sab_ring sync", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)
  await appendAllFullRemainder(page)

  const initialState = await getHarnessState(page)
  expect(initialState.supportsIndependentPitch).toBe(true)
  expect(initialState.pitchSemitones).toBe(0)
  expect(initialState.stems.every((stem) => stem.stats?.supportsIndependentPitch === true)).toBe(true)

  await setHarnessPitchSemitones(page, 4)
  await expect
    .poll(async () => {
      const state = await getHarnessState(page)
      return state.pitchSemitones === 4 && state.stems.every((stem) => stem.stats?.pitchSemitones === 4)
    })
    .toBe(true)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 5000 }).toBeGreaterThan(1.6)

  await setHarnessPitchSemitones(page, -3)
  await expect
    .poll(async () => {
      const state = await getHarnessState(page)
      return state.pitchSemitones === -3 && state.stems.every((stem) => stem.stats?.pitchSemitones === -3)
    })
    .toBe(true)

  await expect
    .poll(async () => (await getHarnessState(page)).transportSec, { timeout: 8000 })
    .toBeGreaterThan(3.2)

  const finalState = await getHarnessState(page)
  expect(finalState.supportsIndependentPitch).toBe(true)
  expect(finalState.pitchSemitones).toBe(-3)
  expect(finalState.stems.every((stem) => stem.stats?.supportsIndependentPitch === true)).toBe(true)
  expect(finalState.stems.every((stem) => stem.stats?.pitchSemitones === -3)).toBe(true)
  expectSabRingTelemetry(finalState)
  expectQualityGates(finalState)
})

test("bounded tempo-plus-pitch proof preserves sab_ring sync across browsers", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)
  await appendAllFullRemainder(page)

  await setHarnessTempo(page, 1.05)
  await setHarnessPitchSemitones(page, 4)
  await expect
    .poll(async () => {
      const state = await getHarnessState(page)
      return (
        Math.abs(state.tempo - 1.05) < 0.001 &&
        state.pitchSemitones === 4 &&
        state.stems.every((stem) => stem.stats?.pitchSemitones === 4)
      )
    })
    .toBe(true)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 5000 }).toBeGreaterThan(1.2)

  await setHarnessPitchSemitones(page, -4)
  await expect
    .poll(async () => {
      const state = await getHarnessState(page)
      return state.pitchSemitones === -4 && state.stems.every((stem) => stem.stats?.pitchSemitones === -4)
    })
    .toBe(true)

  await expect
    .poll(async () => (await getHarnessState(page)).transportSec, { timeout: 8000 })
    .toBeGreaterThan(2.6)

  const finalState = await getHarnessState(page)
  expect(finalState.tempo).toBeCloseTo(1.05, 3)
  expectSabRingTelemetry(finalState)
  expectPitchTelemetry(finalState, -4)
  expectQualityGates(finalState)
})

test("pitch matrix across +/-4 +/-7 +/-12 stays inside explicit qualification gates", async ({ page, browserName }) => {
  test.setTimeout(90_000)
  test.skip(browserName !== "chromium", "Full pitch matrix qualification currently runs in Chromium only")

  await waitForHarness(page)
  await waitForAllFullDecoded(page)
  await appendAllFullRemainder(page)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 5000 }).toBeGreaterThan(1)

  let lastTransportSec = 0
  for (const semitones of PITCH_MATRIX_SEMITONES) {
    await setHarnessPitchSemitones(page, semitones)
    await expect
      .poll(async () => {
        const state = await getHarnessState(page)
        return state.pitchSemitones === semitones && state.stems.every((stem) => stem.stats?.pitchSemitones === semitones)
      })
      .toBe(true)

    await expect
      .poll(async () => (await getHarnessState(page)).transportSec, { timeout: 8000 })
      .toBeGreaterThan(lastTransportSec + 0.65)

    const currentState = await getHarnessState(page)
    lastTransportSec = currentState.transportSec
    expectSabRingTelemetry(currentState)
    expectPitchTelemetry(currentState, semitones)
    expectQualityGates(currentState, { requireSteadyStateWatermarks: true })
  }

  await setHarnessPitchSemitones(page, 0)
  const finalState = await getHarnessState(page)
  expectSabRingTelemetry(finalState)
  expectPitchTelemetry(finalState, 0)
  expectQualityGates(finalState, { requireSteadyStateWatermarks: true })
})

test("tempo-plus-pitch matrix survives soak and interruption qualification gates", async ({ page, browserName }) => {
  test.setTimeout(120_000)
  test.skip(browserName !== "chromium", "Tempo+pitch qualification matrix currently runs in Chromium only")

  await waitForHarness(page)
  await waitForAllFullDecoded(page)
  await appendAllFullRemainder(page)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 5000 }).toBeGreaterThan(1)

  let lastTransportSec = 0
  for (const entry of TEMPO_PITCH_MATRIX) {
    await setHarnessTempo(page, entry.tempo)
    await setHarnessPitchSemitones(page, entry.pitchSemitones)
    await expect
      .poll(async () => {
        const state = await getHarnessState(page)
        return (
          Math.abs(state.tempo - entry.tempo) < 0.001 &&
          state.pitchSemitones === entry.pitchSemitones &&
          state.stems.every((stem) => stem.stats?.pitchSemitones === entry.pitchSemitones)
        )
      })
      .toBe(true)

    await expect
      .poll(async () => (await getHarnessState(page)).transportSec, { timeout: 8000 })
      .toBeGreaterThan(lastTransportSec + 0.6)

    const currentState = await getHarnessState(page)
    lastTransportSec = currentState.transportSec
    expectSabRingTelemetry(currentState)
    expectPitchTelemetry(currentState, entry.pitchSemitones)
    expectQualityGates(currentState, { requireSteadyStateWatermarks: true })
  }

  await runLongSoakScenario(page, 14)
  await runInterruptionLoopScenario(page)

  const finalState = await getHarnessState(page)
  expect(finalState.contextState).toBe("running")
  expectSabRingTelemetry(finalState)
  expectPitchTelemetry(finalState, TEMPO_PITCH_MATRIX.at(-1)?.pitchSemitones ?? 0)
  expectQualityGates(finalState, { requireSteadyStateWatermarks: true })
})

test("late per-stem append still clears the boundary without seam telemetry", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 5000 }).toBeGreaterThan(1)

  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 14000 }).toBeGreaterThan(7.4)
  await appendStemFullRemainder(page, 0)

  await expect.poll(async () => (await getHarnessState(page)).transportSec, { timeout: 12000 }).toBeGreaterThan(8.7)
  await appendStemFullRemainder(page, 1)

  const boundarySec = (await getHarnessState(page)).startupDurationSec + 1.2
  await expect
    .poll(async () => (await getHarnessState(page)).transportSec, { timeout: 25000 })
    .toBeGreaterThan(boundarySec)

  const finalState = await getHarnessState(page)
  expect(finalState.allFullAppended).toBe(true)
  expect(finalState.sync.transportDriftSec).toBeLessThan(0.08)
  expectSabRingTelemetry(finalState)
  expectQualityGates(finalState)
})

test("repeated seek/rebase loop keeps sync telemetry clean", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)
  await runSeekLoopScenario(page)

  await expect
    .poll(async () => {
      const state = await getHarnessState(page)
      return state.playing && state.transportSec >= 4 && state.sync.stemDriftSec < 0.04
    }, { timeout: 12000 })
    .toBe(true)

  const finalState = await getHarnessState(page)
  expect(finalState.sync.transportDriftSec).toBeLessThan(0.08)
  expectSabRingTelemetry(finalState)
  expectQualityGates(finalState)
})

test("longer sab_ring soak stays inside clean steady-state watermarks", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)

  await runLongSoakScenario(page, 12)

  const finalState = await getHarnessState(page)
  expect(finalState.transportSec).toBeGreaterThan(10)
  expectSabRingTelemetry(finalState)
  expectQualityGates(finalState, { requireSteadyStateWatermarks: true })
})

test("interruption-like suspend/resume loop preserves sab_ring sync and telemetry", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)

  await runInterruptionLoopScenario(page)

  const finalState = await getHarnessState(page)
  expect(finalState.contextState).toBe("running")
  expect(finalState.transportSec).toBeGreaterThan(1)
  expectSabRingTelemetry(finalState)
  expectQualityGates(finalState, { requireSteadyStateWatermarks: true })
})

test("listening report captures scenario status, notes, and persists across reload", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)

  await page.getByTestId("listening-stage-boundary").click()
  await expect.poll(async () => (await getHarnessState(page)).allFullAppended, { timeout: 10000 }).toBe(true)

  await page.getByTestId("listening-note-boundary").fill("manual gate ready")
  await page.getByTestId("listening-capture-boundary").click()
  await page.getByTestId("listening-pass-boundary").click()

  await expect(page.getByTestId("listening-status-boundary")).toContainText("pass")

  const capturedReport = await getListeningReport(page)
  expect(capturedReport?.activeScenarioId).toBe("boundary")
  expect(capturedReport?.scenarios.boundary.status).toBe("pass")
  expect(capturedReport?.scenarios.boundary.notes).toBe("manual gate ready")
  expect(capturedReport?.scenarios.boundary.capturedAt).not.toBeNull()
  expect(capturedReport?.scenarios.boundary.snapshot?.stemCount).toBe(2)
  expect(capturedReport?.scenarios.boundary.snapshot?.allFullAppended).toBe(true)

  await page.reload({ waitUntil: "domcontentloaded" })
  await waitForHarness(page)
  await expect(page.getByTestId("listening-status-boundary")).toContainText("pass")
  await expect(page.getByTestId("listening-note-boundary")).toHaveValue("manual gate ready")

  const reloadedReport = await getListeningReport(page)
  expect(reloadedReport?.scenarios.boundary.status).toBe("pass")
  expect(reloadedReport?.scenarios.boundary.notes).toBe("manual gate ready")
  expect(reloadedReport?.scenarios.boundary.capturedAt).not.toBeNull()
})

test("boundary output capture produces a downloadable artifact after seam playback", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)

  const startupDurationSec = (await getHarnessState(page)).startupDurationSec
  const artifact = await runBoundaryCaptureScenario(page)
  expect(artifact).not.toBeNull()
  expect(artifact?.format).toBe("audio/wav")
  expect(artifact?.durationSec ?? 0).toBeGreaterThan(startupDurationSec)
  expect(artifact?.artifactEndOffsetSec ?? 0).toBeGreaterThan(startupDurationSec + 0.8)
  expect(artifact?.artifactEndOffsetSec ?? Number.POSITIVE_INFINITY).toBeLessThan(startupDurationSec + 2.5)
  expect((artifact?.wavBase64?.length ?? 0)).toBeGreaterThan(1000)
  await expect(page.getByTestId("output-capture-summary")).toContainText("captured")
})

test("boundary A/B preview can audition appendable queue against source reference", async ({ page }) => {
  await waitForHarness(page)
  await waitForAllFullDecoded(page)

  const startupDurationSec = (await getHarnessState(page)).startupDurationSec

  await playBoundaryQueueABPreview(page)
  await expect
    .poll(async () => (await getBoundaryAbPreviewState(page))?.mode, { timeout: 5000 })
    .toBe("appendable_queue")

  const activeQueuePreview = await getBoundaryAbPreviewState(page)
  expect(activeQueuePreview?.startSec ?? 0).toBeGreaterThan(startupDurationSec)
  expect(activeQueuePreview?.durationSec ?? 0).toBeGreaterThan(0.8)

  await expect
    .poll(async () => (await getBoundaryAbPreviewState(page))?.mode, { timeout: 5000 })
    .toBe("idle")
  expect((await getBoundaryAbPreviewState(page))?.lastCompletedMode).toBe("appendable_queue")

  await playBoundaryReferenceABPreview(page)
  await expect
    .poll(async () => (await getBoundaryAbPreviewState(page))?.mode, { timeout: 5000 })
    .toBe("source_reference")
  await expect
    .poll(async () => (await getBoundaryAbPreviewState(page))?.mode, { timeout: 5000 })
    .toBe("idle")

  const finalPreview = await getBoundaryAbPreviewState(page)
  expect(finalPreview?.lastCompletedMode).toBe("source_reference")
  await expect(page.getByTestId("boundary-ab-summary")).toContainText("source_reference")
})
