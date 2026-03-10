import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? "npm run dev -- --webpack";
const projects = isCI
  ? [
      {
        name: "chromium",
        use: { ...devices["Desktop Chrome"] },
      },
    ]
  : [
      {
        name: "chromium",
        use: { ...devices["Desktop Chrome"] },
      },
      {
        name: "webkit",
        use: { ...devices["Desktop Safari"] },
      },
      {
        name: "mobile-chromium",
        use: { ...devices["Pixel 5"] },
      },
    ];

export function createContractsConfig(options: { testDir: string; testMatch: string[] }) {
  return defineConfig({
    testDir: options.testDir,
    testMatch: options.testMatch,
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    workers: isCI ? 1 : undefined,
    reporter: "html",
    use: {
      baseURL: "http://localhost:3000",
      trace: "on-first-retry",
    },
    webServer: {
      command: webServerCommand,
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    projects,
  });
}

export default createContractsConfig({
  testDir: "tests/e2e",
  testMatch: ["**/*.spec.ts"],
});
