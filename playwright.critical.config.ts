import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig({
  testDir: "tests/e2e",
  testMatch: [/(?:^|[/\\])(donate-checkout|billing-webhook|events-page|map-filters|search-page)\.spec\.ts$/],
});
