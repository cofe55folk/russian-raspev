import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ mode: "serial" })

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
    underrunFrames: number
    droppedFrames: number
    discontinuityCount: number
    generation: number
    bufferLeadSec: number
  } | null
}

type AppendableQueueLabState = {
  ready: boolean
  playing: boolean
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
    totalUnderrunFrames: number
    totalDiscontinuityCount: number
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
            totalUnderrunFrames: 0,
            totalDiscontinuityCount: 0,
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
          totalUnderrunFrames: 0,
          totalDiscontinuityCount: 0,
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

function expectCleanFinalState(finalState: AppendableQueueLabState) {
  expect(finalState.sync.totalUnderrunFrames).toBe(0)
  expect(finalState.sync.totalDiscontinuityCount).toBe(0)
  expect(finalState.sync.stemDriftSec).toBeLessThan(0.04)
  for (const stem of finalState.stems) {
    expect(stem.stats?.underrunFrames ?? -1).toBe(0)
    expect(stem.stats?.droppedFrames ?? -1).toBe(0)
    expect(stem.stats?.discontinuityCount ?? -1).toBe(0)
  }
}

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
  expectCleanFinalState(finalState)
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
  expectCleanFinalState(finalState)
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
  expectCleanFinalState(finalState)
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
  expectCleanFinalState(finalState)
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
