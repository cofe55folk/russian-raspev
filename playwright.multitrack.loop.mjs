import { spawn } from "node:child_process";

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

const intervalSec = parsePositiveInt(process.env.PW_LOOP_INTERVAL_SEC, 3);
const maxRuns = parsePositiveInt(process.env.PW_LOOP_MAX_RUNS, 0);

const baseArgs = [
  "playwright",
  "test",
  "-c",
  "playwright.multitrack.config.ts",
  "--project=webkit",
  "--reporter=line",
];

const runOnce = (index) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    process.stdout.write(`\n[loop] run #${index} started\n`);
    const child = spawn("npx", baseArgs, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("close", (code) => {
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      const normalized = typeof code === "number" ? code : 1;
      process.stdout.write(`[loop] run #${index} finished with code ${normalized} (${elapsedSec}s)\n`);
      resolve(normalized);
    });
  });

let stopRequested = false;
process.on("SIGINT", () => {
  stopRequested = true;
  process.stdout.write("\n[loop] stop requested (SIGINT)\n");
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let runIndex = 0;
let failedRuns = 0;

while (!stopRequested) {
  runIndex += 1;
  const code = await runOnce(runIndex);
  if (code !== 0) failedRuns += 1;

  if (maxRuns > 0 && runIndex >= maxRuns) break;
  if (stopRequested) break;
  await sleep(intervalSec * 1000);
}

process.stdout.write(`\n[loop] completed: total=${runIndex}, failed=${failedRuns}\n`);
process.exit(failedRuns > 0 ? 1 : 0);
