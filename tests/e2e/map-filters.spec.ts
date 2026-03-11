import { expect, test } from "@playwright/test";

test("map filters affect visible points and persist in URL @critical-contract", async ({ page }) => {
  await page.goto(`/map?layer=region&filters=${encodeURIComponent("Томская область")}`, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/layer=region/);
  await expect(page.getByTestId("map-filter-options")).toContainText("Томская область");
  await expect(page.getByTestId("map-filter-options")).not.toContainText("былинная песня");
  await expect(page.getByTestId("map-point-item-bogoslovka")).toBeVisible();
  await expect(page.getByTestId("map-point-item-balman")).toHaveCount(0);
});
