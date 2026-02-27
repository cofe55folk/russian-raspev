import { expect, test, type Page } from "@playwright/test";

async function waitForMultitrackReady(page: Page) {
  await expect(page.getByRole("heading", { name: /Попробовать многоголосие|Try multitrack harmony/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("slider", { name: "Позиция трека" })).toBeVisible({ timeout: 20_000 });
}

test("home page renders hero content", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Русский распев|Russian Raspev/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Смотреть курсы|Watch courses/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /О проекте|About project/i })).toBeVisible();
});

test("multitrack section is visible with base controls", async ({ page }) => {
  await page.goto("/");

  await waitForMultitrackReady(page);
  await expect(page.getByText("Селезень 01")).toBeVisible();
  await expect(page.getByText("Селезень 02")).toBeVisible();
  await expect(page.getByText("Селезень 03")).toBeVisible();
});

test("player controls react to clicks", async ({ page }) => {
  await page.goto("/");
  await waitForMultitrackReady(page);

  const loopButton = page.getByRole("button", { name: "Повтор трека" });
  await expect(loopButton).toBeVisible();
  await loopButton.click();
  await expect(loopButton).toHaveClass(/btn-round--active/);

  const muteFirstTrack = page.getByRole("button", { name: "Mute Селезень 01" });
  await muteFirstTrack.click();
  await expect(muteFirstTrack).toHaveClass(/bg-red-600/);

  const soloSecondTrack = page.getByRole("button", { name: "Solo Селезень 02" });
  await soloSecondTrack.click();
  await expect(soloSecondTrack).toHaveClass(/bg-yellow-400/);
});

test("play button toggles play/pause state", async ({ page }) => {
  await page.goto("/");
  await waitForMultitrackReady(page);

  const playButton = page.getByRole("button", { name: "Воспроизвести", exact: true });
  await expect(playButton).toBeVisible();
  await playButton.click();
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible();
});

test("waveform click scrubs timeline position", async ({ page }) => {
  await page.goto("/");
  await waitForMultitrackReady(page);

  const timeline = page.getByRole("slider", { name: "Позиция трека" });
  await expect(timeline).toBeVisible();
  await expect
    .poll(async () => {
      const max = await timeline.getAttribute("max");
      return Number(max ?? 0);
    })
    .toBeGreaterThan(0);

  const before = Number(await timeline.inputValue());

  const waveform = page.getByLabel("Waveform Селезень 01");
  await waveform.click({ position: { x: 220, y: 46 } });

  await expect
    .poll(async () => Number(await timeline.inputValue()))
    .toBeGreaterThan(before);
});

test("track volume and pan sliders are interactive on current viewport", async ({ page }) => {
  await page.goto("/");
  await waitForMultitrackReady(page);

  const isMobileProject = test.info().project.name === "mobile-chromium";

  const volumeLabel = isMobileProject ? "Volume mobile Селезень 01" : "Volume Селезень 01";
  const panLabel = isMobileProject ? "Pan mobile Селезень 01" : "Pan Селезень 01";

  const volume = page.getByRole("slider", { name: volumeLabel });
  const pan = page.getByRole("slider", { name: panLabel });

  await expect(volume).toBeVisible();
  await expect(pan).toBeVisible();

  await volume.evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "0.35";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(volume).toHaveValue("0.35");

  await pan.evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "0.4";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(pan).toHaveValue("0.4");
});

test("play scrub pause updates transport time", async ({ page }) => {
  await page.goto("/");
  await waitForMultitrackReady(page);

  const playButton = page.getByRole("button", { name: "Воспроизвести", exact: true });
  await expect(playButton).toBeVisible();
  await playButton.click();
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible();

  const timeLabel = page.locator("div.text-sm.text-white\\/70:visible").first();
  await expect(timeLabel).toBeVisible();

  const timeline = page.getByRole("slider", { name: "Позиция трека" });
  await expect
    .poll(async () => {
      const max = await timeline.getAttribute("max");
      return Number(max ?? 0);
    })
    .toBeGreaterThan(0);

  const beforeText = (await timeLabel.textContent()) ?? "";
  const beforeMatch = beforeText.match(/^(\d+):(\d{2})\s*\/\s*\d+:\d{2}$/);
  const beforeSec = beforeMatch ? Number(beforeMatch[1]) * 60 + Number(beforeMatch[2]) : 0;

  const max = Number((await timeline.getAttribute("max")) ?? "0");
  const target = Math.max(0.5, Math.min(max * 0.7, max - 0.2));
  await timeline.evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, target);

  await expect
    .poll(async () => {
      const text = (await timeLabel.textContent()) ?? "";
      const match = text.match(/^(\d+):(\d{2})\s*\/\s*\d+:\d{2}$/);
      if (!match) return beforeSec;
      return Number(match[1]) * 60 + Number(match[2]);
    })
    .toBeGreaterThan(beforeSec + 2);

  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await expect(page.getByRole("button", { name: "Воспроизвести", exact: true })).toBeVisible();
});
