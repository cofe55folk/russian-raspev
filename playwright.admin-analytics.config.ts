import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig({
  testDir: "tests",
  testMatch: ["contracts/admin-analytics.contract.spec.ts"],
});
