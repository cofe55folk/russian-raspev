import { expect, test } from "@playwright/test";

test("donate page provides working checkout flow in mock mode @critical-contract", async ({ page }) => {
  await page.goto("/donate", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("donate-page")).toBeVisible();
  await expect(page.getByTestId("donate-checkout-panel")).toBeVisible();
  await expect(page.getByTestId("donate-checkout-panel")).toHaveAttribute("data-hydrated", "1");
  await expect(page.locator('input[name="checkoutMode"]')).toHaveValue("mock");

  await page.getByTestId("donate-amount-input").fill("900");
  await page.locator('input[name="interval"][value="monthly"]').check({ force: true });
  await expect(page.locator('input[name="interval"][value="monthly"]')).toBeChecked();
  await page.getByTestId("donate-submit").click();

  await expect(page).toHaveURL(/\/donate\?status=success/);
  await expect(page).toHaveURL(/interval=monthly/);
  await expect(page.getByTestId("donate-status-success")).toBeVisible();
});
