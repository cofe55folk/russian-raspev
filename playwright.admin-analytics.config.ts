import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig({
  testDir: "tests/contracts",
  testMatch: ["**/admin-analytics.contract.spec.ts"],
});
