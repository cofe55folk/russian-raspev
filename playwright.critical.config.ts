import { createContractsConfig } from "./playwright.contracts.config";

export default createContractsConfig({
  testDir: "tests/contracts",
  testMatch: ["**/critical.contract.spec.ts"],
});
