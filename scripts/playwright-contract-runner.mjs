import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const DEFAULT_ARGS = ["--config=playwright.contracts.config.ts", "--project=chromium", "--workers=1"];

const CONTRACT_PACKS = {
  critical: [
    "tests/e2e/donate-checkout.spec.ts",
    "tests/e2e/billing-webhook.spec.ts",
    "tests/e2e/events-page.spec.ts",
    "tests/e2e/map-filters.spec.ts",
    "tests/e2e/search-page.spec.ts",
  ],
  "admin-analytics": [
    "tests/e2e/admin-analytics-api.spec.ts",
    "tests/e2e/admin-analytics-search-quality-api.spec.ts",
    "tests/e2e/admin-analytics-map-summary-api.spec.ts",
    "tests/e2e/admin-analytics-guest-sync-api.spec.ts",
  ],
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

const packName = process.argv[2];
if (!packName || !(packName in CONTRACT_PACKS)) {
  fail(`Usage: node scripts/playwright-contract-runner.mjs <${Object.keys(CONTRACT_PACKS).join("|")}> [playwright args...]`);
}

const forwardedArgs = process.argv.slice(3);
const absoluteSpecPaths = CONTRACT_PACKS[packName].map((relativePath) => path.join(ROOT, relativePath));
const args = ["playwright", "test", ...absoluteSpecPaths, ...DEFAULT_ARGS, ...forwardedArgs];

const child = spawn("npx", args, {
  cwd: ROOT,
  stdio: "inherit",
  shell: false,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
