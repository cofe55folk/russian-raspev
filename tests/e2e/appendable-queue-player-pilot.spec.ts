import { expect, test, type Page } from "@playwright/test"

const SLUG = "terek-ne-vo-daleche"
const PLAYER_ROUTE = `/sound/${SLUG}`

test.describe.configure({ mode: "serial" })

async function openPlayerWithAppendableFlags(
  page: Page,
  flags: {
    appendable?: boolean
    multistem?: boolean
    startupHead?: boolean
    continuationChunks?: boolean
    ringbuffer?: boolean
    streaming?: boolean
    activationTargets?: string | string[]
    safeRolloutTargets?: string | string[]
  } = {}
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
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("rr_appendable_route_pilot_report:")) localStorage.removeItem(key)
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

  await page.goto(PLAYER_ROUTE, { waitUntil: "domcontentloaded" })
  await expect(page.locator("[data-testid='multitrack-root']")).toBeVisible({ timeout: 30000 })
  await expect
    .poll(async () => await page.locator("canvas[aria-label^='Waveform ']").count(), { timeout: 30000 })
    .toBeGreaterThanOrEqual(2)
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
  await page.getByTestId("guest-panel-toggle").click()
  const checklistToggle = page.getByTestId("recording-checklist-toggle")
  await expect(checklistToggle).toBeVisible({ timeout: 15000 })
  await checklistToggle.click()
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
  await expect(page.getByTestId("appendable-route-checklist-status")).toContainText("track-set не включен в appendable rollout")
  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeEnabled()
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeEnabled()
})

test("multistem appendable pilot stays off without the dedicated multistem flag", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true })
  await openRuntimeProbe(page)

  await expect(page.getByTestId("appendable-route-checklist")).toBeVisible()
  await expect(page.getByTestId("appendable-route-pilot-report")).toBeVisible()
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "pending")
  await expect(page.getByTestId("appendable-route-checklist-status")).toContainText("включи оба appendable флага")
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
  await expect(page.getByTestId("appendable-route-checklist-status")).toContainText("appendable pilot перекрыт streaming mode")
  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeEnabled()
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeDisabled()
})

test("multistem appendable pilot runs on the normal player route when both flags are enabled", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)

  await expect(page.getByTestId("appendable-route-checklist")).toBeVisible()
  await expect(page.getByTestId("appendable-route-checklist-status")).toContainText("запусти playback для runtime probe")
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
  await waitForPlayerText(page, "appendable total discontinuity: 0")
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
  await waitForChecklistStatus(page, "идет runtime soak")
  await waitForChecklistStatus(page, "готов к ручному pilot")
  await page.getByTestId("appendable-route-pilot-report-capture").click()
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")
  await page.getByTestId("appendable-route-pilot-report-pass").click()
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "pass")
  await expect(page.getByTestId("appendable-route-debug-save-current-diagnostics")).toBeVisible()
  await expect(page.getByTestId("appendable-route-debug-run-quick-pilot-save")).toBeVisible()
  await page.getByRole("button", { name: "Пауза", exact: true }).click()
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("safe appendable rollout keeps route on appendable mode while tempo stays locked", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, safeRolloutTargets: SLUG })
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
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, safeRolloutTargets: SLUG })
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
  await waitForChecklistStatus(page, "готов к ручному pilot")
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

  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, safeRolloutTargets: SLUG })
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
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => typeof (window as Window & { __rrAppendableRoutePilotDebug?: { runQuickPilot?: unknown } }).__rrAppendableRoutePilotDebug?.runQuickPilot === "function"
        ),
      { timeout: 10000 }
    )
    .toBe(true)

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
        status: "pass",
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

test("current appendable diagnostics can be saved from the debug area without quick pilot", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click()
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible({ timeout: 15000 })
  await waitForPlayerText(page, "appendable queue probe: active")
  await waitForChecklistStatus(page, "готов к ручному pilot")

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("appendable-route-debug-save-current-diagnostics").click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-packet-")
  await expect(page.getByTestId("appendable-route-debug-diagnostics-status")).toContainText("сохранено текущее diagnostics")
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "pass")

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("quick pilot diagnostics can be saved from the debug area", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)

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

  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, safeRolloutTargets: SLUG })
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
