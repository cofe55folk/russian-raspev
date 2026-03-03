import { chromium } from "playwright"

function getArg(flag, fallback = "") {
  const hit = process.argv.find((arg) => arg.startsWith(`${flag}=`))
  if (!hit) return fallback
  const [, value = ""] = hit.split("=")
  return value
}

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

async function clickPlay(page) {
  const labels = ["Плей мастер-канала", "Play master channel", "Воспроиз", "Play", "play"]
  for (const value of labels) {
    const locator = page.locator(`button[aria-label*="${value}"]`).first()
    try {
      if (await locator.isVisible({ timeout: 900 })) {
        await locator.click({ timeout: 3000 })
        return value
      }
    } catch {}
  }
  return null
}

async function main() {
  const url = getArg("--url", "http://localhost:3000/sound")
  const waitMs = toNumber(getArg("--waitMs", ""), 3500)
  const timeoutMs = 15_000
  const markerSelector = '[data-testid="miniplayer"]'

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1728, height: 1117 } })
  const page = await context.newPage()

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
    await page.waitForTimeout(waitMs)

    await page.waitForSelector(markerSelector, { timeout: timeoutMs })
    const before = await page.getAttribute(markerSelector, "data-playing")
    console.log(`ui_data_playing_before=${before ?? "missing"}`)

    const clicked = await clickPlay(page)
    if (!clicked) {
      console.log("ui_play_click=not_found")
      return
    }
    console.log(`ui_play_click=ok:${clicked}`)

    const clickTs = Date.now()
    try {
      await page.waitForSelector(`${markerSelector}[data-playing=\"true\"]`, { timeout: timeoutMs })
    } catch {
      const observed = await page.getAttribute(markerSelector, "data-playing")
      console.log("ui_pause_detected=no")
      console.log(`ui_pause_timeout_ms=${timeoutMs}`)
      console.log(`ui_data_playing_observed=${observed ?? "missing"}`)
      return
    }

    console.log("ui_pause_detected=yes")
    console.log(`ui_start_delay_ms=${Date.now() - clickTs}`)
    const after = await page.getAttribute(markerSelector, "data-playing")
    console.log(`ui_data_playing_after=${after ?? "missing"}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
