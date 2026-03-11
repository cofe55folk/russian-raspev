import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig({
  testDir: "tests/e2e",
  testMatch: [
    "**/admin-analytics-api.spec.ts",
    "**/admin-analytics-search-quality-api.spec.ts",
    "**/admin-analytics-map-summary-api.spec.ts",
    "**/admin-analytics-guest-sync-api.spec.ts",
  ],
});
