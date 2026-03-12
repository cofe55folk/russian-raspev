import { expect, test } from "@playwright/test";
import { getPublishedEvents } from "../../app/lib/eventsCatalog";

type SearchTimeWindow = "upcoming" | "past";

function getEventTimeWindowScenario(slug: string): {
  city: string;
  emptyWindow: SearchTimeWindow;
  title: string;
} {
  const event = getPublishedEvents().find((item) => item.slug === slug);
  if (!event) throw new Error(`published event not found for slug: ${slug}`);

  const eventTs = new Date(event.dateIso).getTime();
  if (!Number.isFinite(eventTs)) throw new Error(`invalid event date for slug: ${slug}`);

  const matchingWindow: SearchTimeWindow = eventTs >= Date.now() ? "upcoming" : "past";
  return {
    city: event.translations.ru?.city || event.translations.en?.city || event.venue.city,
    emptyWindow: matchingWindow === "upcoming" ? "past" : "upcoming",
    title: event.translations.ru?.title || event.translations.en?.title || event.slug,
  };
}

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
  const scenario = getEventTimeWindowScenario("vesennyaya-raspevka-2026");
  const baseParams = new URLSearchParams({ q: "распев", kind: "event", region: scenario.city });
  await page.goto(`/search?${baseParams.toString()}`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`region=${encodeURIComponent(scenario.city)}`));
  await expect(page.getByTestId("search-page-region")).toHaveValue(scenario.city);
  await expect(page.getByTestId("search-page-results")).toContainText(scenario.title);

  const emptyParams = new URLSearchParams({
    q: "распев",
    kind: "event",
    region: scenario.city,
    timeWindow: scenario.emptyWindow,
  });
  await page.goto(`/search?${emptyParams.toString()}`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`timeWindow=${scenario.emptyWindow}`));
  await expect(page.getByTestId("search-page-time-window")).toHaveValue(scenario.emptyWindow);
  await expect(page.getByTestId("search-page-empty")).toBeVisible();
});

test("search page empty state provides recovery links @critical-contract", async ({ page }) => {
  const scenario = getEventTimeWindowScenario("ansambl-praktika-mai-2026");
  const params = new URLSearchParams({
    q: "интенсив",
    kind: "event",
    region: scenario.city,
    timeWindow: scenario.emptyWindow,
  });
  await page.goto(`/search?${params.toString()}`, { waitUntil: "domcontentloaded" });
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
