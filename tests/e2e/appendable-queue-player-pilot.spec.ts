import { readFile } from "node:fs/promises"
import { expect, test, type Download, type Page } from "@playwright/test"

const SLUG = "terek-ne-vo-daleche"
const SECONDARY_SLUG = "tomsk-bogoslovka-po-moryam"
const QUALIFIED_SAFE_ROLLOUT_COHORT = [
  "balman-vechor-devku",
  SECONDARY_SLUG,
  "terek-mne-mladcu-malym-spalos",
  SLUG,
].sort()

function toPlayerRoute(slug: string) {
  return `/sound/${slug}`
}

test.describe.configure({ mode: "serial" })

async function waitForPlayerRouteReachable(
  page: Page,
  playerRouteOrTimeout: string | number = toPlayerRoute(SLUG),
  timeout = 30000
) {
  const playerRoute =
    typeof playerRouteOrTimeout === "string" && playerRouteOrTimeout.length > 0
      ? playerRouteOrTimeout
      : toPlayerRoute(SLUG)
  const effectiveTimeout = typeof playerRouteOrTimeout === "number" ? playerRouteOrTimeout : timeout
  await expect
    .poll(
      async () => {
        try {
          const currentUrl = page.url()
          const requestUrl =
            currentUrl && currentUrl !== "about:blank"
              ? new URL(playerRoute, currentUrl).toString()
              : playerRoute
          const response = await page.request.get(requestUrl)
          return response.ok() ? "ok" : `status:${response.status()}`
        } catch (error) {
          return error instanceof Error ? error.message : "request_failed"
        }
      },
      { timeout: effectiveTimeout }
    )
    .toBe("ok")
}

async function openPlayerWithAppendableFlags(
  page: Page,
  flags: {
    appendable?: boolean
    multistem?: boolean
    startupHead?: boolean
    continuationChunks?: boolean
    preserveStoredReport?: boolean
    ringbuffer?: boolean
    streaming?: boolean
    activationTargets?: string | string[]
    safeRolloutTargets?: string | string[]
  } = {},
  routeSlug = SLUG
) {
  await page.addInitScript((nextFlags) => {
    localStorage.removeItem("rr_audio_streaming_pilot")
    localStorage.removeItem("rr_audio_ringbuffer_pilot")
    localStorage.removeItem("rr_audio_appendable_queue_pilot")
    localStorage.removeItem("rr_audio_appendable_queue_multistem_pilot")
    localStorage.removeItem("rr_audio_appendable_queue_startup_head_pilot")
    localStorage.removeItem("rr_audio_appendable_queue_continuation_chunks_pilot")
    localStorage.removeItem("rr_audio_appendable_queue_activation_targets")
    localStorage.removeItem("rr_audio_appendable_queue_safe_rollout_targets")
    if (!nextFlags.preserveStoredReport) {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("rr_appendable_route_pilot_report:")) localStorage.removeItem(key)
      }
    }
    if (nextFlags.streaming) localStorage.setItem("rr_audio_streaming_pilot", "1")
    if (nextFlags.ringbuffer) localStorage.setItem("rr_audio_ringbuffer_pilot", "1")
    if (nextFlags.appendable) localStorage.setItem("rr_audio_appendable_queue_pilot", "1")
    if (nextFlags.multistem) localStorage.setItem("rr_audio_appendable_queue_multistem_pilot", "1")
    if (nextFlags.startupHead) localStorage.setItem("rr_audio_appendable_queue_startup_head_pilot", "1")
    if (nextFlags.continuationChunks) localStorage.setItem("rr_audio_appendable_queue_continuation_chunks_pilot", "1")
    if (nextFlags.activationTargets) {
      const values = Array.isArray(nextFlags.activationTargets) ? nextFlags.activationTargets : [nextFlags.activationTargets]
      localStorage.setItem("rr_audio_appendable_queue_activation_targets", values.join(","))
    }
    if (nextFlags.safeRolloutTargets) {
      const values = Array.isArray(nextFlags.safeRolloutTargets) ? nextFlags.safeRolloutTargets : [nextFlags.safeRolloutTargets]
      localStorage.setItem("rr_audio_appendable_queue_safe_rollout_targets", values.join(","))
    }
  }, flags)

  let lastGotoError: unknown = null
  const playerRoute = toPlayerRoute(routeSlug)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await waitForPlayerRouteReachable(page, playerRoute, attempt === 0 ? 30000 : 10000)
      await page.goto(playerRoute, { waitUntil: "domcontentloaded" })
      await expect(page.locator("[data-testid='multitrack-root']")).toBeVisible({ timeout: 30000 })
      await expect
        .poll(async () => await page.locator("canvas[aria-label^='Waveform ']").count(), { timeout: 30000 })
        .toBeGreaterThanOrEqual(2)
      const localStorageFlagsReady = await page.evaluate((nextFlags) => {
        const expectedActivationTargets = nextFlags.activationTargets
          ? (Array.isArray(nextFlags.activationTargets) ? nextFlags.activationTargets : [nextFlags.activationTargets]).join(",")
          : null
        const expectedSafeRolloutTargets = nextFlags.safeRolloutTargets
          ? (Array.isArray(nextFlags.safeRolloutTargets) ? nextFlags.safeRolloutTargets : [nextFlags.safeRolloutTargets]).join(",")
          : null
        if (nextFlags.streaming && localStorage.getItem("rr_audio_streaming_pilot") !== "1") return false
        if (nextFlags.ringbuffer && localStorage.getItem("rr_audio_ringbuffer_pilot") !== "1") return false
        if (nextFlags.appendable && localStorage.getItem("rr_audio_appendable_queue_pilot") !== "1") return false
        if (nextFlags.multistem && localStorage.getItem("rr_audio_appendable_queue_multistem_pilot") !== "1") return false
        if (nextFlags.startupHead && localStorage.getItem("rr_audio_appendable_queue_startup_head_pilot") !== "1") return false
        if (nextFlags.continuationChunks && localStorage.getItem("rr_audio_appendable_queue_continuation_chunks_pilot") !== "1") {
          return false
        }
        if (
          expectedActivationTargets !== null &&
          localStorage.getItem("rr_audio_appendable_queue_activation_targets") !== expectedActivationTargets
        ) {
          return false
        }
        if (
          expectedSafeRolloutTargets !== null &&
          localStorage.getItem("rr_audio_appendable_queue_safe_rollout_targets") !== expectedSafeRolloutTargets
        ) {
          return false
        }
        return true
      }, flags)
      if (!localStorageFlagsReady) {
        throw new Error("appendable_flag_init_mismatch")
      }
      lastGotoError = null
      break
    } catch (error) {
      lastGotoError = error
      if (attempt === 4) throw error
      await waitForPlayerRouteReachable(page, playerRoute, 10000)
      await page.waitForTimeout(1500)
    }
  }
  if (lastGotoError) throw lastGotoError
}

async function waitForPlayerText(page: Page, needle: string) {
  await expect
    .poll(async () => (await page.locator("[data-testid='multitrack-root']").textContent()) ?? "", { timeout: 30000 })
    .toContain(needle)
}

async function waitForChecklistStatus(page: Page, needle: string) {
  await expect
    .poll(async () => (await page.getByTestId("appendable-route-checklist-status").textContent()) ?? "", { timeout: 30000 })
    .toContain(needle)
}

async function openRuntimeProbe(page: Page) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const guestPanelToggle = page.getByTestId("guest-panel-toggle")
    const checklistToggle = page.getByTestId("recording-checklist-toggle")
    const report = page.getByTestId("appendable-route-pilot-report")
    try {
      if (!(await checklistToggle.isVisible().catch(() => false))) {
        await expect(guestPanelToggle).toBeVisible({ timeout: 15000 })
        await guestPanelToggle.click()
      }
      await expect(checklistToggle).toBeVisible({ timeout: 15000 })
      if (!(await report.isVisible().catch(() => false))) {
        await checklistToggle.click()
      }
      await expect(page.getByTestId("appendable-route-checklist")).toBeVisible({ timeout: 15000 })
      await expect(report).toBeVisible({ timeout: 15000 })
      return
    } catch (error) {
      lastError = error
      if (attempt === 2) throw error
      await waitForPlayerRouteReachable(page, 10000)
      await page.waitForTimeout(1000)
    }
  }
  throw lastError instanceof Error ? lastError : new Error("openRuntimeProbe failed")
}

async function waitForAppendablePilotDebugMethod(page: Page, methodName: string) {
  await waitForPlayerText(page, "audio mode: appendable_queue_worklet")
  await expect
    .poll(
      async () =>
        await page.evaluate((nextMethodName) => {
          const api = (window as Window & { __rrAppendableRoutePilotDebug?: Record<string, unknown> })
            .__rrAppendableRoutePilotDebug
          return typeof api?.[nextMethodName] === "function"
        }, methodName),
      { timeout: 10000 }
    )
    .toBe(true)
}

async function evaluateWithRetry<T>(page: Page, fn: () => Promise<T> | T, attempts = 5): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await page.evaluate(fn)
    } catch (error) {
      lastError = error
      await page.waitForTimeout(250)
    }
  }
  throw lastError instanceof Error ? lastError : new Error("page.evaluate failed after retries")
}

async function readJsonDownload<T>(download: Download): Promise<T> {
  const filePath = await download.path()
  expect(filePath).not.toBeNull()
  return JSON.parse(await readFile(filePath as string, "utf8")) as T
}

test("appendable route pilot stays off when the current track set is not targeted for rollout", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, {
    appendable: true,
    multistem: true,
    activationTargets: "different-scope",
  })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable activation scoped: on")
  await waitForPlayerText(page, "appendable activation allowed: off")
  await waitForPlayerText(page, "appendable activation match: —")
  await waitForPlayerText(page, "audio mode: soundtouch")
  await waitForPlayerText(page, "appendable safe rollout candidate: yes")
  await waitForPlayerText(page, `appendable recommended safe rollout target: ${SLUG}`)
  await waitForChecklistStatus(page, "track-set не включен в appendable rollout")
  await expect(page.getByTestId("appendable-route-checklist")).toContainText(
    "rr_audio_appendable_queue_safe_rollout_targets"
  )
  await expect(page.getByTestId("appendable-route-checklist")).toContainText(SLUG)
  const captured = await evaluateWithRetry(page, () => {
    return (
      (window as Window & {
        __rrAppendableRoutePilotDebug?: {
          captureReport: () => {
            sourceProgress: {
              safeRolloutCandidateQualified: boolean
              safeRolloutCandidateTarget: string | null
            }
          }
        }
      }).__rrAppendableRoutePilotDebug?.captureReport() ?? null
    )
  })
  expect(captured?.sourceProgress.safeRolloutCandidateQualified).toBe(true)
  expect(captured?.sourceProgress.safeRolloutCandidateTarget).toBe(SLUG)
  await page.getByTestId("appendable-route-safe-rollout-target-toggle").click()
  await expect
    .poll(
      async () => await page.evaluate(() => localStorage.getItem("rr_audio_appendable_queue_safe_rollout_targets")),
      { timeout: 10000 }
    )
    .toBe(SLUG)
  await page.addInitScript((safeRolloutTarget) => {
    localStorage.setItem("rr_audio_appendable_queue_safe_rollout_targets", safeRolloutTarget)
  }, SLUG)
  await waitForPlayerRouteReachable(page, 10000)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.locator("[data-testid='multitrack-root']")).toBeVisible({ timeout: 30000 })
  await openRuntimeProbe(page)
  await waitForPlayerText(page, "appendable activation mode: safe_rollout")
  await waitForPlayerText(page, "appendable activation allowed: on")
  await waitForPlayerText(page, `appendable activation match: ${SLUG}`)
  await waitForPlayerText(page, "appendable tempo policy: locked")
  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeDisabled()
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeDisabled()
})

test("appendable route diagnostics can apply the full qualified safe-rollout cohort", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, {
    appendable: true,
    multistem: true,
    activationTargets: "different-scope",
  })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable safe rollout candidate: yes")
  await page.getByTestId("appendable-route-safe-rollout-cohort-apply").click()
  await expect
    .poll(
      async () =>
        await page.evaluate(() =>
          (localStorage.getItem("rr_audio_appendable_queue_safe_rollout_targets") ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
            .sort()
            .join(",")
        ),
      { timeout: 10000 }
    )
    .toBe(QUALIFIED_SAFE_ROLLOUT_COHORT.join(","))

  await page.addInitScript((targets) => {
    localStorage.setItem("rr_audio_appendable_queue_safe_rollout_targets", targets.join(","))
  }, QUALIFIED_SAFE_ROLLOUT_COHORT)
  await waitForPlayerRouteReachable(page, toPlayerRoute(SECONDARY_SLUG), 10000)
  await page.goto(toPlayerRoute(SECONDARY_SLUG), { waitUntil: "domcontentloaded" })
  await expect(page.locator("[data-testid='multitrack-root']")).toBeVisible({ timeout: 30000 })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable activation mode: safe_rollout")
  await waitForPlayerText(page, `appendable activation match: ${SECONDARY_SLUG}`)
  await waitForPlayerText(page, "appendable tempo policy: locked")
  await waitForPlayerText(page, "audio mode: appendable_queue_worklet")
  await waitForPlayerText(page, "appendable startup mode: startup_head_continuation_chunks")
})

test("multistem appendable pilot stays off without the dedicated multistem flag", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true })
  await openRuntimeProbe(page)

  await expect(page.getByTestId("appendable-route-checklist")).toBeVisible()
  await expect(page.getByTestId("appendable-route-pilot-report")).toBeVisible()
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "pending")
  await waitForChecklistStatus(page, "включи оба appendable флага")
  await waitForPlayerText(page, "appendable multistem flag: off")
  await waitForPlayerText(page, "appendable queue probe: idle")
  await waitForPlayerText(page, "audio mode: soundtouch")
  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeEnabled()
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeEnabled()
})

test("streaming pilot preempts appendable route pilot when both are enabled", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { streaming: true, appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "audio mode: streaming_media")
  await waitForPlayerText(page, "appendable multistem flag: on")
  await waitForChecklistStatus(page, "appendable pilot перекрыт streaming mode")
  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeEnabled()
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeDisabled()
})

test("multistem appendable pilot runs on the normal player route when both flags are enabled", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)

  await expect(page.getByTestId("appendable-route-checklist")).toBeVisible()
  await waitForChecklistStatus(page, "запусти playback для runtime probe")
  await waitForPlayerText(page, "appendable activation scoped: on")
  await waitForPlayerText(page, "appendable activation allowed: on")
  await waitForPlayerText(page, `appendable activation match: ${SLUG}`)
  await waitForPlayerText(page, "appendable multistem flag: on")
  await waitForPlayerText(page, "audio mode: appendable_queue_worklet")
  await waitForPlayerText(page, "tempo: on / pitch: off")
  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeEnabled()
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeDisabled()

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await page.waitForTimeout(2300)

  await waitForPlayerText(page, "audio mode: appendable_queue_worklet")
  await waitForPlayerText(page, "appendable queue probe: active")
  await waitForPlayerText(page, "appendable data plane: postmessage_pcm")
  await waitForPlayerText(page, "appendable control plane: message_port")
  await waitForPlayerText(page, "appendable total underrun: 0")
  const runtimeProbe = await page.evaluate(() => {
    return (
      (window as Window & {
        __rrAppendableRoutePilotDebug?: {
          getState: () => {
            runtimeProbe: {
              dataPlaneMode: string | null
              controlPlaneMode: string | null
              sampleRates: number[]
              appendMessageCount: number
            }
          }
        }
      }).__rrAppendableRoutePilotDebug?.getState().runtimeProbe ?? null
    )
  })
  expect(runtimeProbe?.dataPlaneMode).toBe("postmessage_pcm")
  expect(runtimeProbe?.controlPlaneMode).toBe("message_port")
  expect(runtimeProbe?.sampleRates.length ?? 0).toBeGreaterThan(0)
  expect(runtimeProbe?.appendMessageCount ?? 0).toBeGreaterThan(0)
  await waitForPlayerText(page, "appendable ready threshold sec: 3.000")
  await expect
    .poll(
      async () => {
        const text = (await page.getByTestId("appendable-route-checklist-status").textContent()) ?? ""
        return ["идет runtime soak", "готов к ручному pilot", "нужна проверка runtime"].some((needle) =>
          text.includes(needle)
        )
      },
      { timeout: 45000 }
    )
    .toBe(true)
  await page.getByTestId("appendable-route-pilot-report-capture").click()
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")
  await page.getByTestId("appendable-route-pilot-report-pass").click()
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "pass")
  await expect(page.getByTestId("appendable-route-debug-save-current-diagnostics")).toBeVisible()
  await expect(page.getByTestId("appendable-route-debug-run-quick-pilot-save")).toBeVisible()
  await page.getByRole("button", { name: "Пауза", exact: true }).click()
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("appendable route captureReport returns the derived rollout verdict, not the raw default snapshot", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")
  await expect
    .poll(
      async () => {
        const text = (await page.getByTestId("appendable-route-checklist-status").textContent()) ?? ""
        return text.includes("готов к ручному pilot") || text.includes("нужна проверка runtime")
      },
      { timeout: 45000 }
    )
    .toBe(true)

  const capturedSnapshot = await evaluateWithRetry(page, async () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        captureReport: () => {
          gate: { status: string }
          rollout: { status: string; reason: string | null }
        }
        pause: () => void
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    return api.captureReport()
  })

  expect(capturedSnapshot).not.toBeNull()
  const expectedRolloutStatus =
    (capturedSnapshot as {
      gate: { status: string }
      rollout: { status: string; reason: string | null }
    }).gate.status === "ready_for_manual_pilot"
      ? "pending"
      : "fail"
  expect((capturedSnapshot as { rollout: { status: string } }).rollout.status).toBe(expectedRolloutStatus)
  if (expectedRolloutStatus === "pending") {
    expect((capturedSnapshot as { rollout: { reason: string | null } }).rollout.reason).toBe("qualification:missing")
  } else {
    expect((capturedSnapshot as { rollout: { reason: string | null } }).rollout.reason).toBe("gate:attention_required")
  }

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("manual appendable report verdict and notes survive reload and report download", async ({ page }) => {
  const manualNotes = "manual-pass-persists"

  await openPlayerWithAppendableFlags(page, {
    appendable: true,
    multistem: true,
    activationTargets: SLUG,
    preserveStoredReport: true,
  })
  await openRuntimeProbe(page)
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const api = (window as Window & {
            __rrAppendableRoutePilotDebug?: { getState: () => { audioMode: string } }
          }).__rrAppendableRoutePilotDebug
          return api?.getState().audioMode ?? null
        }),
      { timeout: 10000 }
    )
    .toBe("appendable_queue_worklet")

  await evaluateWithRetry(page, async () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        play: () => Promise<void>
        getState: () => { playing: boolean }
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    await api.play()
    return api.getState()
  })
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const state = (window as Window & {
            __rrAppendableRoutePilotDebug?: {
              getState: () => {
                checklist: { status: string }
                runtimeProbe: { active: boolean; readyThresholdSec: number | null }
              }
            }
          }).__rrAppendableRoutePilotDebug?.getState()
          if (!state) return null
          return [
            state.runtimeProbe.active ? "active" : "idle",
            typeof state.runtimeProbe.readyThresholdSec === "number"
              ? state.runtimeProbe.readyThresholdSec.toFixed(3)
              : "—",
            state.checklist.status,
          ].join("|")
        }),
      { timeout: 45000 }
    )
    .toMatch(/active\|3\.000\|(soak_in_progress|ready_for_manual_pilot|attention_required)/)

  await openRuntimeProbe(page)
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const api = (window as Window & {
            __rrAppendableRoutePilotDebug?: { getState: () => { audioMode: string } }
          }).__rrAppendableRoutePilotDebug
          return api?.getState().audioMode ?? null
        }),
      { timeout: 10000 }
    )
    .toBe("appendable_queue_worklet")
  await page.getByTestId("appendable-route-pilot-report-notes").fill(manualNotes)
  await evaluateWithRetry(page, () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        captureReport: () => { capturedAt: string }
        markPass: () => void
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    api.captureReport()
    api.markPass()
    return true
  })
  let expectedCapturedAt: string | null = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      expectedCapturedAt = await page.evaluate((nextNotes) => {
        const api = (window as Window & {
          __rrAppendableRoutePilotDebug?: {
            getState: () => {
              report: {
                status: string
                notes: string
                snapshot: { capturedAt: string } | null
              }
            }
          }
        }).__rrAppendableRoutePilotDebug
        const report = api?.getState().report
        if (!report || report.status !== "pass" || report.notes !== nextNotes || !report.snapshot?.capturedAt) return null
        return report.snapshot.capturedAt
      }, manualNotes)
    } catch {
      expectedCapturedAt = null
    }
    if (expectedCapturedAt) break
    await page.waitForTimeout(250)
  }
  expect(expectedCapturedAt).not.toBeNull()

  await waitForPlayerRouteReachable(page, 10000)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.locator("[data-testid='multitrack-root']")).toBeVisible({ timeout: 30000 })
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const api = (window as Window & {
            __rrAppendableRoutePilotDebug?: {
              getState: () => {
                audioMode: string
                report: {
                  status: string
                  notes: string
                  snapshot: { capturedAt: string } | null
                }
              }
            }
          }).__rrAppendableRoutePilotDebug
          if (!api) return null
          const state = api.getState()
          return {
            audioMode: state.audioMode,
            status: state.report.status,
            notes: state.report.notes,
            capturedAt: state.report.snapshot?.capturedAt ?? null,
          }
        }),
      { timeout: 10000 }
    )
    .toMatchObject({
      audioMode: "appendable_queue_worklet",
      status: "pass",
      notes: manualNotes,
      capturedAt: expectedCapturedAt ?? null,
    })

  const downloadPromise = page.waitForEvent("download")
  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { downloadReport: () => void } })
      .__rrAppendableRoutePilotDebug?.downloadReport()
  })
  const download = await downloadPromise
  const report = await readJsonDownload<{
    status: string
    notes: string
    snapshot: { capturedAt: string } | null
  }>(download)

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-")
  expect(report.status).toBe("pass")
  expect(report.notes).toBe(manualNotes)
  expect(report.snapshot?.capturedAt).toBe(expectedCapturedAt)
})

test("safe appendable rollout keeps route on appendable mode while tempo stays locked", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { safeRolloutTargets: SLUG })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable activation scoped: on")
  await waitForPlayerText(page, "appendable activation mode: safe_rollout")
  await waitForPlayerText(page, "appendable activation allowed: on")
  await waitForPlayerText(page, `appendable activation match: ${SLUG}`)
  await waitForPlayerText(page, "appendable tempo policy: locked")
  await waitForPlayerText(page, "audio mode: appendable_queue_worklet")
  await waitForPlayerText(page, "tempo: off / pitch: off")
  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeDisabled()
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeDisabled()

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")
  await waitForPlayerText(page, "appendable total underrun: 0")
  await waitForPlayerText(page, "appendable total discontinuity: 0")
  await waitForPlayerText(page, "appendable ready threshold sec: 3.000")
  await waitForChecklistStatus(page, "идет runtime soak")
})

test("safe appendable rollout auto-enables qualified continuation ingest without manual startup flags", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { safeRolloutTargets: SLUG })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable activation mode: safe_rollout")
  await waitForPlayerText(page, "appendable startup head flag: off")
  await waitForPlayerText(page, "appendable continuation chunks flag: off")
  await waitForPlayerText(page, "appendable continuation qualification: qualified")
  await waitForPlayerText(page, "appendable startup mode: startup_head_continuation_chunks")
  await waitForPlayerText(page, "appendable continuation chunks: 2/2 decoded, 2/2 appended")
  await waitForPlayerText(page, "appendable continuation coverage sec: 26.000 / available groups: 2")
  await waitForPlayerText(page, "tempo: off / pitch: off")
  await expect(page.getByTestId("appendable-route-checklist-status")).toContainText("запусти playback для runtime probe")

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")
  await waitForPlayerText(page, "appendable total underrun: 0")
  await waitForPlayerText(page, "appendable total discontinuity: 0")
  await waitForPlayerText(page, "appendable ready threshold sec: 3.000")
  await waitForChecklistStatus(page, "идет runtime soak")
  await expect
    .poll(
      async () => {
        const text = (await page.getByTestId("appendable-route-checklist-status").textContent()) ?? ""
        return text.includes("готов к ручному pilot") || text.includes("нужна проверка runtime")
      },
      { timeout: 45000 }
    )
    .toBe(true)
})

test("safe appendable rollout also auto-enables qualified continuation ingest on the tomsk route", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { safeRolloutTargets: SECONDARY_SLUG }, SECONDARY_SLUG)
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable activation mode: safe_rollout")
  await waitForPlayerText(page, `appendable activation match: ${SECONDARY_SLUG}`)
  await waitForPlayerText(page, "appendable tempo policy: locked")
  await waitForPlayerText(page, "audio mode: appendable_queue_worklet")
  await waitForPlayerText(page, "appendable continuation qualification: qualified")
  await waitForPlayerText(page, "appendable startup mode: startup_head_continuation_chunks")
  await waitForPlayerText(page, "appendable continuation chunks: 2/2 decoded, 2/2 appended")

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")
  await waitForPlayerText(page, "appendable total underrun: 0")
  await waitForPlayerText(page, "appendable total discontinuity: 0")
})

test("safe appendable rollout keeps qualified ingest off when manifest continuation qualification fails", async ({ page }) => {
  await page.route("**/audio-startup/startup-chunks-manifest.json", async (route) => {
    const response = await route.fetch()
    const json = (await response.json()) as {
      tracks?: Array<{
        slug?: string
        sources?: Array<{
          continuationChunks?: Array<{ src: string; startSec: number; durationSec: number; label?: string }>
        }>
      }>
    }
    const target = json.tracks?.find((track) => track.slug === SLUG)
    const brokenSource = target?.sources?.[1]
    if (brokenSource?.continuationChunks?.length) brokenSource.continuationChunks = brokenSource.continuationChunks.slice(0, 1)
    await route.fulfill({ response, json })
  })

  await openPlayerWithAppendableFlags(page, { safeRolloutTargets: SLUG })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable activation mode: safe_rollout")
  await waitForPlayerText(page, "appendable startup head flag: off")
  await waitForPlayerText(page, "appendable continuation chunks flag: off")
  await waitForPlayerText(page, "appendable continuation qualification: fallback (source_chunk_count_mismatch)")
  await waitForPlayerText(page, "appendable startup mode: full_buffer")
  await waitForPlayerText(page, "appendable continuation chunks: 0/0 decoded, 0/0 appended")
  await waitForPlayerText(page, "appendable continuation coverage sec: — / available groups: 1")
  await expect(page.getByTestId("appendable-route-checklist-status")).toContainText(
    "safe rollout fallback: source_chunk_count_mismatch"
  )

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")
  await waitForPlayerText(page, "appendable total underrun: 0")
  await waitForPlayerText(page, "appendable total discontinuity: 0")
  await expect(page.getByTestId("appendable-route-checklist-status")).toContainText(
    "safe rollout fallback: source_chunk_count_mismatch"
  )
})

test("appendable startup head pilot feeds manifest startup audio before background full append", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, {
    appendable: true,
    multistem: true,
    startupHead: true,
    activationTargets: SLUG,
  })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable startup head flag: on")
  await waitForPlayerText(page, "appendable startup mode: startup_head_manifest")
  await waitForPlayerText(page, "appendable source progress: startup=yes")

  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const state = (window as Window & {
            __rrAppendableRoutePilotDebug?: {
              getState: () => {
                sourceProgress: {
                  mode: string
                  manifestSlug: string | null
                  allStartupAppended: boolean
                  allFullDecoded: boolean
                  allFullAppended: boolean
                }
              }
            }
          }).__rrAppendableRoutePilotDebug?.getState()
          const sourceProgress = state?.sourceProgress
          if (!sourceProgress) return null
          return [
            sourceProgress.mode,
            sourceProgress.manifestSlug ?? "—",
            sourceProgress.allStartupAppended ? "true" : "false",
            sourceProgress.allFullDecoded ? "true" : "false",
            sourceProgress.allFullAppended ? "true" : "false",
          ].join("|")
        }),
      { timeout: 45000 }
    )
    .toBe(`startup_head_manifest|${SLUG}|true|true|true`)

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")
  await waitForPlayerText(page, "appendable total underrun: 0")
  await waitForPlayerText(page, "appendable total discontinuity: 0")

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("appendable continuation chunks pilot appends packaged continuation before full fallback", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, {
    appendable: true,
    multistem: true,
    startupHead: true,
    continuationChunks: true,
    activationTargets: SLUG,
  })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable continuation chunks flag: on")
  await waitForPlayerText(page, "appendable continuation qualification: qualified")
  await waitForPlayerText(page, "appendable startup mode: startup_head_continuation_chunks")

  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const state = (window as Window & {
            __rrAppendableRoutePilotDebug?: {
              getState: () => {
                sourceProgress: {
                  mode: string
                  continuationQualification: string
                  continuationChunkGroupsPlanned: number
                  continuationChunkGroupsDecoded: number
                  continuationChunkGroupsAppended: number
                  allStartupAppended: boolean
                  allFullDecoded: boolean
                  allFullAppended: boolean
                }
              }
            }
          }).__rrAppendableRoutePilotDebug?.getState()
          const sourceProgress = state?.sourceProgress
          if (!sourceProgress) return null
          return [
            sourceProgress.mode,
            sourceProgress.continuationQualification,
            sourceProgress.continuationChunkGroupsPlanned,
            sourceProgress.continuationChunkGroupsDecoded,
            sourceProgress.continuationChunkGroupsAppended,
            sourceProgress.allStartupAppended ? "true" : "false",
            sourceProgress.allFullDecoded ? "true" : "false",
            sourceProgress.allFullAppended ? "true" : "false",
          ].join("|")
        }),
      { timeout: 60000 }
    )
    .toBe("startup_head_continuation_chunks|qualified|2|2|2|true|true|true")

  await waitForPlayerText(page, "appendable continuation chunks: 2/2 decoded, 2/2 appended")
  await waitForPlayerText(page, "appendable continuation coverage sec: 26.000 / available groups: 2")

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")
  await waitForPlayerText(page, "appendable total underrun: 0")
  await waitForPlayerText(page, "appendable total discontinuity: 0")

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("appendable continuation chunks pilot falls back to startup-head-only mode when manifest qualification fails", async ({ page }) => {
  await page.route("**/audio-startup/startup-chunks-manifest.json", async (route) => {
    const response = await route.fetch()
    const json = (await response.json()) as {
      tracks?: Array<{
        slug?: string
        sources?: Array<{
          continuationChunks?: Array<{ src: string; startSec: number; durationSec: number; label?: string }>
        }>
      }>
    }
    const target = json.tracks?.find((track) => track.slug === SLUG)
    const brokenSource = target?.sources?.[1]
    if (brokenSource?.continuationChunks?.length) brokenSource.continuationChunks = brokenSource.continuationChunks.slice(0, 1)
    await route.fulfill({ response, json })
  })

  await openPlayerWithAppendableFlags(page, {
    appendable: true,
    multistem: true,
    startupHead: true,
    continuationChunks: true,
    activationTargets: SLUG,
  })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable continuation chunks flag: on")
  await waitForPlayerText(page, "appendable continuation qualification: fallback (source_chunk_count_mismatch)")
  await waitForPlayerText(page, "appendable startup mode: startup_head_manifest")
  await waitForPlayerText(page, "appendable continuation chunks: 0/0 decoded, 0/0 appended")
  await waitForPlayerText(page, "appendable continuation coverage sec: — / available groups: 1")
})

test("appendable route debug api can run a quick pilot flow with seek", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runQuickPilot")

  const state = await evaluateWithRetry(page, async () => {
    const api = (window as Window & { __rrAppendableRoutePilotDebug?: {
      runQuickPilot: (seekSec?: number | null) => Promise<unknown>
      pause: () => void
    } }).__rrAppendableRoutePilotDebug
    if (!api) return null
    return await api.runQuickPilot(12)
  })

  expect(state).not.toBeNull()
  expect(state).toMatchObject({
    audioMode: "appendable_queue_worklet",
    report: {
      snapshot: expect.any(Object),
    },
  })
  if (
    (state as {
      checklist: { status: string }
      report: { status: string; snapshot: { gate: { status: string } } }
    }).checklist.status === "ready_for_manual_pilot"
  ) {
    expect(state).toMatchObject({
      checklist: { status: "ready_for_manual_pilot" },
      report: {
        status: "pending",
        snapshot: {
          gate: {
            status: "ready_for_manual_pilot",
          },
        },
      },
    })
  } else {
    expect(state).toMatchObject({
      checklist: { status: "attention_required" },
      report: {
        status: "fail",
        snapshot: {
          gate: {
            status: "attention_required",
          },
        },
      },
    })
  }

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("appendable route debug api can run a soak pilot flow", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runSoakPilot")

  const state = await evaluateWithRetry(page, async () => {
    const api = (window as Window & { __rrAppendableRoutePilotDebug?: {
      runSoakPilot: (durationSec?: number | null) => Promise<unknown>
      pause: () => void
    } }).__rrAppendableRoutePilotDebug
    if (!api) return null
    return await api.runSoakPilot(6)
  })

  expect(state).not.toBeNull()
  expect((state as { audioMode?: string } | null)?.audioMode).toBe("appendable_queue_worklet")
  const soakChecklistStatus = (state as { checklist: { status: string } }).checklist.status
  expect(["ready_for_manual_pilot", "attention_required"]).toContain(soakChecklistStatus)
  expect((state as { report: { snapshot: { gate: { status: string } } } }).report.snapshot.gate.status).toBe(
    soakChecklistStatus
  )
  expect((state as { report: { status: string } }).report.status).toBe(
    soakChecklistStatus === "ready_for_manual_pilot" ? "pending" : "fail"
  )

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("appendable route debug api can run a qualification pilot flow", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runQualificationPilot")

  const state = await evaluateWithRetry(page, async () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        runQualificationPilot: (durationSec?: number | null) => Promise<unknown>
        pause: () => void
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    return await api.runQualificationPilot(6)
  })

  expect(state).not.toBeNull()
  expect((state as { audioMode?: string } | null)?.audioMode).toBe("appendable_queue_worklet")
  const qualificationReport = (state as {
    report: {
      status: string
      snapshot: {
        qualification: {
          targetSoakSec: number | null
          passed: boolean | null
          reason: string | null
        }
        rollout: {
          status: string
          reason: string | null
        }
      }
    }
  }).report
  expect(qualificationReport.snapshot.qualification.targetSoakSec).toBe(6)
  if (qualificationReport.snapshot.qualification.passed) {
    expect(qualificationReport.snapshot.qualification.reason).toBeNull()
    expect(qualificationReport.status).toBe("pending")
    expect(qualificationReport.snapshot.rollout.status).toBe("pending")
    expect(qualificationReport.snapshot.rollout.reason).toBe("stress:missing")
  } else {
    expect(qualificationReport.snapshot.qualification.reason).not.toBeNull()
    expect(qualificationReport.status).toBe("fail")
    expect(qualificationReport.snapshot.rollout.status).toBe("fail")
  }

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("appendable route debug api can run a stress pilot flow", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runStressPilot")

  const state = await evaluateWithRetry(page, async () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        runStressPilot: (holdSec?: number | null) => Promise<unknown>
        pause: () => void
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    return await api.runStressPilot(1)
  })

  expect(state).not.toBeNull()
  expect((state as { audioMode?: string } | null)?.audioMode).toBe("appendable_queue_worklet")
  const stressReport = (state as {
    report: {
      status: string
      snapshot: {
        stress: {
          holdPerSeekSec: number | null
          seekSequenceSec: number[]
          completedSeeks: number
          passed: boolean | null
          reason: string | null
        }
        rollout: {
          status: string
          reason: string | null
        }
      }
    }
  }).report
  expect(stressReport.snapshot.stress.holdPerSeekSec).toBe(1)
  expect(stressReport.snapshot.stress.seekSequenceSec.length).toBeGreaterThan(0)
  expect(stressReport.snapshot.stress.completedSeeks).toBe(stressReport.snapshot.stress.seekSequenceSec.length)
  if (stressReport.snapshot.stress.passed) {
    expect(stressReport.snapshot.stress.reason).toBeNull()
    expect(stressReport.status).toBe("pending")
    expect(stressReport.snapshot.rollout.status).toBe("pending")
    expect(stressReport.snapshot.rollout.reason).toBe("qualification:missing")
  } else {
    expect(stressReport.snapshot.stress.reason).not.toBeNull()
    expect(stressReport.status).toBe("fail")
    expect(stressReport.snapshot.rollout.status).toBe("fail")
  }

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("route pilot report preserves qualification evidence after a later stress pilot run", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runQualificationPilot")

  const state = await evaluateWithRetry(page, async () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        runQualificationPilot: (durationSec?: number | null) => Promise<unknown>
        runStressPilot: (holdSec?: number | null) => Promise<unknown>
        pause: () => void
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    await api.runQualificationPilot(6)
    return await api.runStressPilot(1)
  })

  expect(state).not.toBeNull()
  const preservedReport = (state as {
    report: {
      snapshot: {
        qualification: {
          targetSoakSec: number | null
          passed: boolean | null
        }
        stress: {
          seekSequenceSec: number[]
          completedSeeks: number
          passed: boolean | null
        }
        gate: {
          status: string
        }
        rollout: {
          status: string
          reason: string | null
        }
      }
    }
  }).report
  expect(preservedReport.snapshot.qualification.targetSoakSec).toBe(6)
  expect(preservedReport.snapshot.qualification.passed).not.toBeNull()
  expect(preservedReport.snapshot.stress.seekSequenceSec.length).toBeGreaterThan(0)
  expect(preservedReport.snapshot.stress.completedSeeks).toBe(preservedReport.snapshot.stress.seekSequenceSec.length)
  const expectedRolloutStatus =
    preservedReport.snapshot.gate.status === "ready_for_manual_pilot" &&
    preservedReport.snapshot.qualification.passed === true &&
    preservedReport.snapshot.stress.passed === true
      ? "pass"
      : "fail"
  expect(preservedReport.snapshot.rollout.status).toBe(expectedRolloutStatus)
  if (expectedRolloutStatus === "pass") {
    expect(preservedReport.snapshot.rollout.reason).toBeNull()
    await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "pass")
    await expect(page.getByTestId("appendable-route-pilot-report-rollout")).toContainText("rollout: pass")
  } else {
    expect(preservedReport.snapshot.rollout.reason).not.toBeNull()
    await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "fail")
    await expect(page.getByTestId("appendable-route-pilot-report-rollout")).toContainText("rollout: fail")
  }

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("saved appendable packet preserves cumulative rollout evidence after qualification then stress", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runQualificationPilot")

  await evaluateWithRetry(page, async () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        runQualificationPilot: (durationSec?: number | null) => Promise<unknown>
        runStressPilot: (holdSec?: number | null) => Promise<unknown>
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    await api.runQualificationPilot(6)
    return await api.runStressPilot(1)
  })

  const downloadPromise = page.waitForEvent("download")
  await waitForAppendablePilotDebugMethod(page, "saveCurrentDiagnostics")
  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { saveCurrentDiagnostics: () => void } })
      .__rrAppendableRoutePilotDebug?.saveCurrentDiagnostics()
  })
  const download = await downloadPromise
  const packet = await readJsonDownload<{
    checklist: { status: string }
    report: {
      status: string
      snapshot: {
        gate: { status: string }
        qualification: { targetSoakSec: number | null; passed: boolean | null }
        stress: { seekSequenceSec: number[]; completedSeeks: number; passed: boolean | null }
        rollout: { status: string; reason: string | null }
      } | null
    }
  }>(download)

  expect(packet.report.snapshot).not.toBeNull()
  expect(packet.checklist.status).toBe(packet.report.snapshot?.gate.status)
  expect(packet.report.snapshot?.qualification.targetSoakSec).toBe(6)
  expect(packet.report.snapshot?.qualification.passed).not.toBeNull()
  expect(packet.report.snapshot?.stress.seekSequenceSec.length ?? 0).toBeGreaterThan(0)
  expect(packet.report.snapshot?.stress.completedSeeks).toBe(packet.report.snapshot?.stress.seekSequenceSec.length)
  const expectedRolloutStatus =
    packet.report.snapshot?.gate.status === "ready_for_manual_pilot" &&
    packet.report.snapshot.qualification.passed === true &&
    packet.report.snapshot.stress.passed === true
      ? "pass"
      : "fail"
  expect(packet.report.snapshot?.rollout.status).toBe(expectedRolloutStatus)
  if (expectedRolloutStatus === "pass") {
    expect(packet.report.snapshot?.rollout.reason).toBeNull()
    expect(packet.report.status).toBe("pass")
  } else {
    expect(packet.report.snapshot?.rollout.reason).not.toBeNull()
    expect(packet.report.status).toBe("fail")
  }

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("downloaded appendable report preserves cumulative rollout evidence after qualification then stress", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runQualificationPilot")

  await evaluateWithRetry(page, async () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        runQualificationPilot: (durationSec?: number | null) => Promise<unknown>
        runStressPilot: (holdSec?: number | null) => Promise<unknown>
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    await api.runQualificationPilot(6)
    return await api.runStressPilot(1)
  })

  const downloadPromise = page.waitForEvent("download")
  await waitForAppendablePilotDebugMethod(page, "downloadReport")
  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { downloadReport: () => void } })
      .__rrAppendableRoutePilotDebug?.downloadReport()
  })
  const download = await downloadPromise
  const report = await readJsonDownload<{
    status: string
    trackScopeId: string
    checklistStatus: string
    snapshot: {
      trackScopeId: string
      gate: { status: string }
      qualification: { targetSoakSec: number | null; passed: boolean | null }
      stress: { seekSequenceSec: number[]; completedSeeks: number; passed: boolean | null }
      rollout: { status: string; reason: string | null }
    } | null
  }>(download)

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-")
  expect(report.snapshot).not.toBeNull()
  expect(report.trackScopeId.length).toBeGreaterThan(0)
  expect(report.trackScopeId).toBe(report.snapshot?.trackScopeId)
  expect(report.checklistStatus).toBe(report.snapshot?.gate.status)
  expect(report.snapshot?.qualification.targetSoakSec).toBe(6)
  expect(report.snapshot?.qualification.passed).not.toBeNull()
  expect(report.snapshot?.stress.seekSequenceSec.length ?? 0).toBeGreaterThan(0)
  expect(report.snapshot?.stress.completedSeeks).toBe(report.snapshot?.stress.seekSequenceSec.length)
  const expectedRolloutStatus =
    report.snapshot?.gate.status === "ready_for_manual_pilot" &&
    report.snapshot.qualification.passed === true &&
    report.snapshot.stress.passed === true
      ? "pass"
      : "fail"
  expect(report.snapshot?.rollout.status).toBe(expectedRolloutStatus)
  expect(report.status).toBe(expectedRolloutStatus)
  if (expectedRolloutStatus === "pass") {
    expect(report.snapshot?.rollout.reason).toBeNull()
  } else {
    expect(report.snapshot?.rollout.reason).not.toBeNull()
  }

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("saved appendable route report rehydrates after reload with the same cumulative rollout evidence", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, {
    appendable: true,
    multistem: true,
    activationTargets: SLUG,
    preserveStoredReport: true,
  })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runQualificationPilot")

  const persistedBeforeReload = await evaluateWithRetry(page, async () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        runQualificationPilot: (durationSec?: number | null) => Promise<unknown>
        runStressPilot: (holdSec?: number | null) => Promise<{
          trackScopeId: string
          report: {
            status: string
            snapshot: { capturedAt: string; rollout: { status: string; reason: string | null } } | null
          }
        }>
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    await api.runQualificationPilot(6)
    const finalState = await api.runStressPilot(1)
    const storageKey = `rr_appendable_route_pilot_report:${finalState.trackScopeId}:v1`
    return {
      trackScopeId: finalState.trackScopeId,
      report: finalState.report,
      storageKey,
    }
  })

  expect(persistedBeforeReload).not.toBeNull()
  expect(persistedBeforeReload?.report.snapshot).not.toBeNull()

  const expectedTrackScopeId = persistedBeforeReload?.trackScopeId ?? ""
  const expectedCapturedAt = persistedBeforeReload?.report.snapshot?.capturedAt ?? ""
  const expectedStatus = persistedBeforeReload?.report.status ?? "pending"
  const expectedRolloutStatus = persistedBeforeReload?.report.snapshot?.rollout.status ?? "pending"
  const expectedRolloutReason = persistedBeforeReload?.report.snapshot?.rollout.reason ?? null
  let expectedStored: string | null = null
  let expectedStoredReport:
    | {
        status: string
        snapshot: { capturedAt: string; rollout: { status: string; reason: string | null } }
      }
    | null = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    expectedStored = await page.evaluate((storageKey) => localStorage.getItem(storageKey), persistedBeforeReload?.storageKey ?? "")
    if (expectedStored) {
      try {
        const parsed = JSON.parse(expectedStored) as {
          status?: string
          snapshot?: {
            capturedAt?: string
            rollout?: { status?: string; reason?: string | null }
          }
        }
        if (
          typeof parsed.status === "string" &&
          parsed.snapshot?.capturedAt === expectedCapturedAt &&
          parsed.snapshot?.rollout?.status === expectedRolloutStatus &&
          (parsed.snapshot?.rollout?.reason ?? null) === expectedRolloutReason &&
          parsed.status === expectedStatus
        ) {
          expectedStoredReport = {
            status: parsed.status,
            snapshot: {
              capturedAt: parsed.snapshot.capturedAt,
              rollout: {
                status: parsed.snapshot.rollout.status,
                reason: parsed.snapshot.rollout.reason ?? null,
              },
            },
          }
          break
        }
      } catch {}
    }
    await page.waitForTimeout(250)
  }
  expect(expectedStored).not.toBeNull()
  expect(expectedStoredReport).not.toBeNull()

  await waitForPlayerRouteReachable(page, 10000)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.locator("[data-testid='multitrack-root']")).toBeVisible({ timeout: 30000 })
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const api = (window as Window & {
            __rrAppendableRoutePilotDebug?: {
              getState: () => {
                audioMode: string
                trackScopeId: string
                report: {
                  status: string
                  snapshot: {
                    capturedAt: string
                    rollout: { status: string; reason: string | null }
                  } | null
                }
              }
            }
          }).__rrAppendableRoutePilotDebug
          if (!api) return null
          const state = api.getState()
          return {
            audioMode: state.audioMode,
            trackScopeId: state.trackScopeId,
            status: state.report.status,
            capturedAt: state.report.snapshot?.capturedAt ?? null,
            rolloutStatus: state.report.snapshot?.rollout.status ?? null,
            rolloutReason: state.report.snapshot?.rollout.reason ?? null,
          }
        }),
      { timeout: 10000 }
    )
    .toMatchObject({
      audioMode: "appendable_queue_worklet",
      trackScopeId: expectedTrackScopeId,
      status: expectedStoredReport?.status ?? expectedStatus,
      capturedAt: expectedStoredReport?.snapshot.capturedAt ?? expectedCapturedAt,
      rolloutStatus: expectedStoredReport?.snapshot.rollout.status ?? expectedRolloutStatus,
      rolloutReason: expectedStoredReport?.snapshot.rollout.reason ?? expectedRolloutReason,
    })

  const persistedAfterReload = await evaluateWithRetry(page, () => {
    const api = (window as Window & {
      __rrAppendableRoutePilotDebug?: {
        getState: () => {
          trackScopeId: string
          report: {
            status: string
            snapshot: {
              capturedAt: string
              trackScopeId: string
              rollout: { status: string; reason: string | null }
            } | null
          }
        }
      }
    }).__rrAppendableRoutePilotDebug
    if (!api) return null
    const state = api.getState()
    const storageKey = `rr_appendable_route_pilot_report:${state.trackScopeId}:v1`
    return {
      trackScopeId: state.trackScopeId,
      report: state.report,
      stored: localStorage.getItem(storageKey),
    }
  })

  expect(persistedAfterReload).not.toBeNull()
  expect(persistedAfterReload?.trackScopeId).toBe(expectedTrackScopeId)
  expect(persistedAfterReload?.report.status).toBe(expectedStoredReport?.status ?? expectedStatus)
  expect(persistedAfterReload?.report.snapshot?.capturedAt).toBe(
    expectedStoredReport?.snapshot.capturedAt ?? expectedCapturedAt
  )
  expect(persistedAfterReload?.report.snapshot?.trackScopeId).toBe(expectedTrackScopeId)
  expect(persistedAfterReload?.report.snapshot?.rollout.status).toBe(
    expectedStoredReport?.snapshot.rollout.status ?? expectedRolloutStatus
  )
  expect(persistedAfterReload?.report.snapshot?.rollout.reason ?? null).toBe(
    expectedStoredReport?.snapshot.rollout.reason ?? expectedRolloutReason
  )
  expect(persistedAfterReload?.stored).toBe(expectedStored)
})

test("current appendable diagnostics can be saved from the debug area without quick pilot", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "saveCurrentDiagnostics")

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")
  await expect
    .poll(
      async () => {
        const text = (await page.getByTestId("appendable-route-checklist-status").textContent()) ?? ""
        return text.includes("готов к ручному pilot") || text.includes("нужна проверка runtime")
      },
      { timeout: 30000 }
    )
    .toBe(true)
  const checklistStatusText = (await page.getByTestId("appendable-route-checklist-status").textContent()) ?? ""

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("appendable-route-debug-save-current-diagnostics").click()
  const download = await downloadPromise
  const packet = await readJsonDownload<{
    checklist: { status: string }
    report: {
      status: string
      snapshot: {
        gate: { status: string }
        rollout: { status: string; reason: string | null }
      } | null
    }
  }>(download)

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-packet-")
  await expect(page.getByTestId("appendable-route-debug-diagnostics-status")).toContainText("сохранено текущее diagnostics")
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")
  expect(packet.report.snapshot).not.toBeNull()
  expect(packet.checklist.status).toBe(packet.report.snapshot?.gate.status)
  if (checklistStatusText.includes("готов к ручному pilot")) {
    await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "pending")
    await expect(page.getByTestId("appendable-route-pilot-report-rollout")).toContainText("qualification:missing")
    expect(packet.report.status).toBe("pending")
    expect(packet.report.snapshot?.rollout.status).toBe("pending")
    expect(packet.report.snapshot?.rollout.reason).toBe("qualification:missing")
  } else {
    await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "fail")
    await expect(page.getByTestId("appendable-route-pilot-report-rollout")).toContainText("gate:attention_required")
    expect(packet.report.status).toBe("fail")
    expect(packet.report.snapshot?.rollout.status).toBe("fail")
    expect(packet.report.snapshot?.rollout.reason).toBe("gate:attention_required")
  }

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("soak pilot diagnostics can be saved from the debug area", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runSoakPilot")

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("appendable-route-debug-run-soak-pilot-save").click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-packet-")
  await expect(page.getByTestId("appendable-route-debug-diagnostics-status")).toContainText("soak pilot:")
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", /pending|fail/)

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("qualification pilot diagnostics can be saved from the debug area", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runQualificationPilot")

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("appendable-route-debug-run-qualification-pilot-save").click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-packet-")
  await expect(page.getByTestId("appendable-route-debug-diagnostics-status")).toContainText("qualification pilot:")
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", /pending|fail/)

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("stress pilot diagnostics can be saved from the debug area", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runStressPilot")

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("appendable-route-debug-run-stress-pilot-save").click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-packet-")
  await expect(page.getByTestId("appendable-route-debug-diagnostics-status")).toContainText("stress pilot:")
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", /pending|fail/)

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("quick pilot diagnostics can be saved from the debug area", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)
  await waitForAppendablePilotDebugMethod(page, "runQuickPilot")

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("appendable-route-debug-run-quick-pilot-save").click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-packet-")
  await expect(page.getByTestId("appendable-route-debug-diagnostics-status")).toContainText("quick pilot:")
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("saving current diagnostics auto-fails the report when safe rollout remains in fallback attention state", async ({ page }) => {
  await page.route("**/audio-startup/startup-chunks-manifest.json", async (route) => {
    const response = await route.fetch()
    const json = (await response.json()) as {
      tracks?: Array<{
        slug?: string
        sources?: Array<{
          continuationChunks?: Array<{ src: string; startSec: number; durationSec: number; label?: string }>
        }>
      }>
    }
    const target = json.tracks?.find((track) => track.slug === SLUG)
    const brokenSource = target?.sources?.[1]
    if (brokenSource?.continuationChunks?.length) brokenSource.continuationChunks = brokenSource.continuationChunks.slice(0, 1)
    await route.fulfill({ response, json })
  })

  await openPlayerWithAppendableFlags(page, { safeRolloutTargets: SLUG })
  await openRuntimeProbe(page)

  await waitForPlayerText(page, "appendable continuation qualification: fallback (source_chunk_count_mismatch)")
  await expect(page.getByTestId("appendable-route-checklist-status")).toContainText(
    "safe rollout fallback: source_chunk_count_mismatch"
  )

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("appendable-route-debug-save-current-diagnostics").click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-packet-")
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "fail")

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})
