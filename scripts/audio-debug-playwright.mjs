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

const mode = getArg("--mode", "check")
const url = getArg("--url", "http://localhost:3000/sound/selezen")
const waitMs = toNumber(getArg("--waitMs", ""), 3500)

function printJson(obj) {
  console.log(JSON.stringify(obj))
}

async function runScan(page) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
  await page.waitForTimeout(waitMs)
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).slice(0, 200).map((btn, idx) => ({
      idx,
      ariaLabel: btn.getAttribute("aria-label") || "",
      title: btn.getAttribute("title") || "",
      text: (btn.textContent || "").trim().slice(0, 80),
      className: btn.className,
    }))
  })
  console.log(`buttons_count=${buttons.length}`)
  buttons.forEach((item) => printJson(item))
}

async function runNetcheck(page) {
  page.on("console", (msg) => {
    console.log(`[console] ${msg.type()} ${msg.text()}`)
  })
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText || "unknown"
    console.log(`[requestfailed] ${req.method()} ${req.url()} ${failure}`)
  })
  page.on("response", (res) => {
    const responseUrl = res.url()
    if (responseUrl.includes("/api/sound/") || responseUrl.includes("/audio/")) {
      console.log(`[response] ${res.status()} ${res.request().method()} ${responseUrl}`)
    }
  })

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
  await page.waitForTimeout(Math.max(waitMs, 8_000))
  const loadingCount = await page.locator("text=Загрузка аудио").count()
  console.log(`loading_audio_nodes=${loadingCount}`)
}

async function runLoading(page) {
  const t0 = Date.now()
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
  const loading = page.locator("text=Загрузка аудио")
  let disappeared = false
  try {
    await loading.waitFor({ state: "hidden", timeout: 60_000 })
    disappeared = true
  } catch {}
  console.log(`loading_disappeared=${disappeared}`)
  console.log(`elapsed_ms=${Date.now() - t0}`)
  console.log(`loading_nodes=${await loading.count()}`)
}

async function clickByAriaContains(page, values) {
  for (const value of values) {
    const locator = page.locator(`button[aria-label*="${value}"]`).first()
    try {
      if (await locator.isVisible({ timeout: 900 })) {
        await locator.click({ timeout: 3_000 })
        return value
      }
    } catch {}
  }
  return null
}

async function runCheck(page, context) {
  const logs = []
  const t0 = Date.now()
  const rel = () => Date.now() - t0

  await context.addInitScript(() => {
    try {
      localStorage.setItem("rr_audio_debug", "1")
    } catch {}
  })

  page.on("console", (msg) => {
    const text = msg.text()
    if (text.includes("AUDIO_DEBUG")) {
      logs.push({ relMs: rel(), text })
    }
  })

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
  await page.waitForTimeout(waitMs)

  const playClicked = await clickByAriaContains(page, ["Воспроиз", "Play", "play"])
  console.log(`play_click=${playClicked ? `ok:${playClicked}` : "not_found"}`)
  await page.waitForTimeout(2_500)

  const repeatOn = await clickByAriaContains(page, ["Повтор", "Repeat"])
  console.log(`repeat_on_click=${repeatOn ? `ok:${repeatOn}` : "not_found"}`)
  await page.waitForTimeout(800)

  const repeatOff = await clickByAriaContains(page, ["Повтор", "Repeat"])
  console.log(`repeat_off_click=${repeatOff ? `ok:${repeatOff}` : "not_found"}`)
  await page.waitForTimeout(1_200)

  const bg = await context.newPage()
  await bg.goto("about:blank")
  await bg.bringToFront()
  const hiddenFrom = rel()
  await page.waitForTimeout(12_000)
  await page.bringToFront()
  const hiddenTo = rel()
  await page.waitForTimeout(2_000)

  const count = (needle, from = -Infinity, to = Infinity) =>
    logs.filter((x) => x.relMs >= from && x.relMs <= to && x.text.includes(needle)).length
  const first = (needle) => logs.find((x) => x.text.includes(needle))
  const playReq = first("play:requested")
  const playStarted = first("play:started")

  console.log("=== AUDIO_DEBUG SUMMARY ===")
  console.log(`logs_total=${logs.length}`)
  console.log(`play_requested_first=${playReq ? playReq.relMs : "none"}`)
  console.log(`play_started_first=${playStarted ? playStarted.relMs : "none"}`)
  if (playReq && playStarted) console.log(`play_start_delay_ms=${playStarted.relMs - playReq.relMs}`)
  console.log(`engine_dispose_total=${count("engine:dispose")}`)
  console.log(`hidden_window_ms=${hiddenTo - hiddenFrom}`)
  console.log(`hidden_play_requested=${count("play:requested", hiddenFrom, hiddenTo)}`)
  console.log(`hidden_seek_events=${count("seek", hiddenFrom, hiddenTo)}`)

  console.log("=== AUDIO_DEBUG TIMELINE ===")
  logs
    .filter((x) =>
      x.text.includes("engine:create")
      || x.text.includes("engine:dispose")
      || x.text.includes("play:requested")
      || x.text.includes("play:started")
      || x.text.includes("repeat:on")
      || x.text.includes("repeat:off")
      || x.text.includes("seek")
    )
    .slice(0, 120)
    .forEach((x) => console.log(`${x.relMs}ms | ${x.text.replace(/\s+/g, " ").trim()}`))
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1728, height: 1117 } })
  const page = await context.newPage()

  try {
    if (mode === "scan") await runScan(page)
    else if (mode === "netcheck") await runNetcheck(page)
    else if (mode === "loading") await runLoading(page)
    else await runCheck(page, context)
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
