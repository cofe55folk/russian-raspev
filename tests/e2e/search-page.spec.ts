import { expect, test } from "@playwright/test";

test("search page renders results and supports kind filter @critical-contract", async ({ page }) => {
  await page.goto("/search?q=всё горе руганье", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("search-page-results")).toBeVisible();
  await expect(page.getByTestId("search-page-results")).toContainText("Сею-вею");

  const soundFilter = page.getByTestId("search-page-filter-sound");
  await expect(soundFilter).toHaveAttribute("href", /kind=sound/);
  const soundHref = await soundFilter.getAttribute("href");
  if (!soundHref) throw new Error("search-page-filter-sound has no href");
  await page.goto(soundHref, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/kind=sound/);
  await expect(
    page.getByTestId("search-page-results").or(page.getByTestId("search-page-empty"))
  ).toBeVisible();
});

test("search page supports event filter and keeps event results @critical-contract", async ({ page }) => {
  await page.goto("/search?q=майский интенсив", { waitUntil: "domcontentloaded" });

  const eventFilter = page.getByTestId("search-page-filter-event");
  await expect(eventFilter).toHaveAttribute("href", /kind=event/);
  const eventHref = await eventFilter.getAttribute("href");
  if (!eventHref) throw new Error("search-page-filter-event has no href");
  await page.goto(eventHref, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/kind=event/);
  await expect(page.getByTestId("search-page-results")).toBeVisible();
  await expect(page.getByTestId("search-page-results")).toContainText("майский интенсив");
});

test("search page supports region and time-window facets for events @critical-contract", async ({ page }) => {
  await page.goto("/search?q=распев&kind=event&region=Москва", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/region=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0/);
  await expect(page.getByTestId("search-page-region")).toHaveValue("Москва");
  await expect(page.getByTestId("search-page-results")).toContainText("Весенняя распевка");

  await page.goto("/search?q=распев&kind=event&region=Москва&timeWindow=past", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/timeWindow=past/);
  await expect(page.getByTestId("search-page-time-window")).toHaveValue("past");
  await expect(page.getByTestId("search-page-empty")).toBeVisible();
});

test("search page empty state provides recovery links @critical-contract", async ({ page }) => {
  await page.goto("/search?q=интенсив&kind=event&region=Казань&timeWindow=past", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("search-page-empty")).toBeVisible();
  const recoveryBlock = page.getByTestId("search-page-recovery");
  await expect(recoveryBlock).toBeVisible();
  await expect(recoveryBlock.getByTestId("search-page-recovery-column-popular")).toBeVisible();
  await expect(recoveryBlock.getByTestId("search-page-recovery-column-event")).toBeVisible();
  await expect(recoveryBlock.getByTestId("search-page-recovery-list-popular")).toBeVisible();
  await expect(recoveryBlock.getByTestId("search-page-recovery-list-event")).toBeVisible();

  const popularRecoveryLinks = recoveryBlock.locator('[data-testid^="search-page-recovery-popular-"]');
  const eventRecoveryLinks = recoveryBlock.locator('[data-testid^="search-page-recovery-event-"]');

  await expect(popularRecoveryLinks.first()).toBeVisible();
  await expect(eventRecoveryLinks.first()).toBeVisible();
  expect(await popularRecoveryLinks.count()).toBeGreaterThan(0);
  expect(await eventRecoveryLinks.count()).toBeGreaterThan(0);

  await expect(popularRecoveryLinks.first()).toHaveAttribute("href", /\/(en\/)?(sound|articles|education|video)(\/|$)/);
  await expect(eventRecoveryLinks.first()).toHaveAttribute("href", /\/(en\/)?events(\/|$)/);
});
