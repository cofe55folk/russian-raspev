import { expect, test, type Page } from "@playwright/test";

async function openPlayerWithFlags(page: Page, flags: { ringbuffer?: boolean; streaming?: boolean } = {}) {
  await page.addInitScript((nextFlags) => {
    localStorage.removeItem("rr_audio_ringbuffer_pilot");
    localStorage.removeItem("rr_audio_streaming_pilot");
    if (nextFlags.ringbuffer) localStorage.setItem("rr_audio_ringbuffer_pilot", "1");
    if (nextFlags.streaming) localStorage.setItem("rr_audio_streaming_pilot", "1");
  }, flags);

  await page.goto("/");
  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeVisible({
    timeout: 15000,
  });
}

test("baseline mode keeps tempo and pitch controls enabled", async ({ page }) => {
  await openPlayerWithFlags(page);

  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeEnabled();
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeEnabled();
});

test("streaming pilot locks only pitch control", async ({ page }) => {
  await openPlayerWithFlags(page, { streaming: true });

  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeEnabled();
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeDisabled();
});

test("ringbuffer pilot locks tempo and pitch controls", async ({ page }) => {
  await openPlayerWithFlags(page, { ringbuffer: true });

  await expect(page.getByRole("slider", { name: "Скорость воспроизведения" })).toBeDisabled();
  await expect(page.getByRole("slider", { name: "Pitch" })).toBeDisabled();
});
