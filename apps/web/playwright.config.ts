import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite. Runs against an already-running app (`pnpm dev` +
 * `pnpm dev:engine`, local Postgres/Redis) at E2E_BASE_URL. Every run keeps a
 * video, a trace and a screenshot per test, and writes both an HTML report
 * and Allure results, so each run is reviewable evidence.
 *
 *   pnpm --filter @asm/web e2e
 *   npx playwright show-report e2e-report      # HTML report with videos/traces
 *   npx allure generate allure-results -o allure-report
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // One shared local DB and one seeded viewer: run serially.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "e2e-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e-report", open: "never" }],
    ["allure-playwright", { resultsDir: "allure-results" }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    storageState: "e2e/.auth/viewer.json",
    video: "on",
    trace: "on",
    screenshot: "on",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "ipad-webkit", use: { ...devices["iPad Pro 11 landscape"] } },
  ],
});
