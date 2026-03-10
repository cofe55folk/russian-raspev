import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig([
  "tests/e2e/donate-checkout.spec.ts",
  "tests/e2e/billing-webhook.spec.ts",
  "tests/e2e/events-page.spec.ts",
  "tests/e2e/map-filters.spec.ts",
  "tests/e2e/search-page.spec.ts",
]);
