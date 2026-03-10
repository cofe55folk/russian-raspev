import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig([
  "tests/e2e/admin-analytics-api.spec.ts",
  "tests/e2e/admin-analytics-search-quality-api.spec.ts",
  "tests/e2e/admin-analytics-map-summary-api.spec.ts",
  "tests/e2e/admin-analytics-guest-sync-api.spec.ts",
]);
