import { expect, test } from "@playwright/test";

test("events list is data-backed and opens detail route @critical-contract", async ({ page }) => {
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const firstCardLink = page.locator('[data-testid^="events-card-link-"]').first();
  await expect(firstCardLink).toBeVisible({ timeout: 20_000 });
  await Promise.all([page.waitForURL(/\/events\/[a-z0-9-]+$/), firstCardLink.click()]);

  await expect(page).toHaveURL(/\/events\/[a-z0-9-]+$/);
  await expect(page.getByTestId("event-detail-date")).toBeVisible();
  await expect(page.getByTestId("event-ticket-link")).toHaveAttribute("href", /\/api\/events\/[a-z0-9-]+\/ticket$/);
  await expect(page.getByTestId("event-calendar-link")).toHaveAttribute("href", /\/api\/events\/[a-z0-9-]+\/ics\?locale=ru$/);
  await expect(page.getByTestId("event-reminder-form")).toBeVisible();
  await expect(page.getByTestId("event-back-link")).toHaveAttribute("href", /^\/events$/);
  const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(schemas.some((item) => item.includes('"@type":"Event"'))).toBeTruthy();
});

test("english events route keeps locale-prefixed detail links @critical-contract", async ({ page }) => {
  await page.goto("/en/events/vesennyaya-raspevka-2026", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/en\/events\/[a-z0-9-]+$/);
  await expect(page.getByTestId("event-detail-date")).toBeVisible();
  await expect(page.getByTestId("event-calendar-link")).toHaveAttribute("href", /\/api\/events\/[a-z0-9-]+\/ics\?locale=en$/);
  await expect(page.getByTestId("event-reminder-form")).toBeVisible();
  await expect(page.getByTestId("event-back-link")).toHaveAttribute("href", /^\/en\/events$/);
});

test("events filters are reflected in URL and narrow card set @critical-contract", async ({ page }) => {
  await page.goto("/events?tag=ensemble", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/tag=ensemble/);
  await expect(page.getByTestId("events-filter-tag")).toHaveValue("ensemble");
  await expect(page.getByRole("heading", { level: 3, name: /майский интенсив/i })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: /Весенняя распевка/i })).toHaveCount(0);
});

test("events detail shows reminder status message from query @critical-contract", async ({ page }) => {
  await page.goto("/events/vesennyaya-raspevka-2026?reminder=subscribed", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("event-reminder-status")).toHaveAttribute("data-reminder-state", "subscribed");
});
