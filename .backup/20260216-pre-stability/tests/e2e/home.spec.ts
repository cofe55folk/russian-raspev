import { expect, test } from "@playwright/test";

test("home page renders hero content", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Русский распев" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Смотреть курсы" })).toBeVisible();
  await expect(page.getByRole("button", { name: "О проекте" })).toBeVisible();
});

test("multitrack section is visible with base controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Попробовать многоголосие/i })).toBeVisible();
  await expect(page.getByText("Селезень 01")).toBeVisible();
  await expect(page.getByText("Селезень 02")).toBeVisible();
  await expect(page.getByText("Селезень 03")).toBeVisible();
  await expect(page.getByRole("button", { name: "▶ Воспроизвести" })).toBeVisible();
});

test("player controls react to clicks", async ({ page }) => {
  await page.goto("/");

  const loopButton = page.getByRole("button", { name: "⟲" });
  await expect(loopButton).toBeVisible();
  await loopButton.click();

  const muteButtons = page.getByRole("button", { name: "M" });
  await expect(muteButtons).toHaveCount(3);
  await muteButtons.first().click();

  const soloButtons = page.getByRole("button", { name: "S" });
  await expect(soloButtons).toHaveCount(3);
  await soloButtons.nth(1).click();
});
