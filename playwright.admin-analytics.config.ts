import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig({
  testDir: "tests/e2e",
  testMatch: [
    /(?:^|[/\\])(admin-analytics-api|admin-analytics-search-quality-api|admin-analytics-map-summary-api|admin-analytics-guest-sync-api)\.spec\.ts$/,
  ],
});
