import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig({
  testDir: "tests",
  testMatch: ["contracts/critical.contract.spec.ts"],
});
