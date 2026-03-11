import { expect, test, type Page } from "@playwright/test"

const SLUG = "terek-ne-vo-daleche"
const PLAYER_ROUTE = `/sound/${SLUG}`

test.describe.configure({ mode: "serial" })

async function openPlayerWithAppendableFlags(
  page: Page,
  flags: {
    appendable?: boolean
    multistem?: boolean
    ringbuffer?: boolean
    streaming?: boolean
    activationTargets?: string | string[]
  } = {}
) {
  await page.addInitScript((nextFlags) => {
    localStorage.removeItem("rr_audio_streaming_pilot")
    localStorage.removeItem("rr_audio_ringbuffer_pilot")
    localStorage.removeItem("rr_audio_appendable_queue_pilot")
    localStorage.removeItem("rr_audio_appendable_queue_multistem_pilot")
    localStorage.removeItem("rr_audio_appendable_queue_activation_targets")
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("rr_appendable_route_pilot_report:")) localStorage.removeItem(key)
    }
    if (nextFlags.streaming) localStorage.setItem("rr_audio_streaming_pilot", "1")
    if (nextFlags.ringbuffer) localStorage.setItem("rr_audio_ringbuffer_pilot", "1")
    if (nextFlags.appendable) localStorage.setItem("rr_audio_appendable_queue_pilot", "1")
    if (nextFlags.multistem) localStorage.setItem("rr_audio_appendable_queue_multistem_pilot", "1")
    if (nextFlags.activationTargets) {
      const values = Array.isArray(nextFlags.activationTargets) ? nextFlags.activationTargets : [nextFlags.activationTargets]
      localStorage.setItem("rr_audio_appendable_queue_activation_targets", values.join(","))
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

async function openRuntimeProbe(page: Page) {
  await page.getByTestId("guest-panel-toggle").click()
  const checklistToggle = page.getByTestId("recording-checklist-toggle")
  await expect(checklistToggle).toBeVisible({ timeout: 15000 })
  await checklistToggle.click()
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
  await waitForPlayerText(page, "appendable total underrun: 0")
  await waitForPlayerText(page, "appendable total discontinuity: 0")
  await expect(page.getByTestId("appendable-route-checklist-status")).toContainText("готов к ручному pilot")
  await page.getByTestId("appendable-route-pilot-report-capture").click()
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")
  await page.getByTestId("appendable-route-pilot-report-pass").click()
  await expect(page.getByTestId("appendable-route-pilot-report-status")).toHaveAttribute("data-status", "pass")
  await expect(page.getByTestId("appendable-route-debug-save-current-diagnostics")).toBeVisible()
  await expect(page.getByTestId("appendable-route-debug-run-quick-pilot-save")).toBeVisible()
  await page.getByRole("button", { name: "Пауза", exact: true }).click()
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})

test("appendable route debug api can run a quick pilot flow with seek", async ({ page }) => {
  await openPlayerWithAppendableFlags(page, { appendable: true, multistem: true, activationTargets: SLUG })
  await openRuntimeProbe(page)

  const state = await page.evaluate(async () => {
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
    checklist: { status: "ready_for_manual_pilot" },
    runtimeProbe: {
      totalUnderrunFrames: 0,
      totalDiscontinuityCount: 0,
    },
    report: {
      snapshot: expect.any(Object),
    },
  })

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

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("appendable-route-debug-save-current-diagnostics").click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain("appendable-route-pilot-packet-")
  await expect(page.getByTestId("appendable-route-debug-diagnostics-status")).toContainText("сохранено текущее diagnostics")
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")

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
  await expect(page.getByTestId("appendable-route-debug-diagnostics-status")).toContainText("готов к ручному pilot")
  await expect(page.getByTestId("appendable-route-pilot-report-captured-at")).not.toContainText("—")

  await page.evaluate(() => {
    ;(window as Window & { __rrAppendableRoutePilotDebug?: { pause: () => void } }).__rrAppendableRoutePilotDebug?.pause()
  })
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 10000 })
})
