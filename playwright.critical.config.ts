import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig({
  testDir: "tests/e2e",
  testMatch: [
    "**/donate-checkout.spec.ts",
    "**/billing-webhook.spec.ts",
    "**/events-page.spec.ts",
    "**/map-filters.spec.ts",
    "**/search-page.spec.ts",
  ],
});
