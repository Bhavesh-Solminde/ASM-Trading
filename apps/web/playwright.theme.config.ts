import { defineConfig, devices } from "@playwright/test";

// Uses an already-running local app. No database seeding or external services.
// Signed-in checks opt in via E2E_THEME_STORAGE_STATE=<local storage-state.json>.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "theme-robustness.spec.ts",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: process.env.E2E_THEME_OUTPUT ?? "/tmp/ixt-light-theme/robustness-results",
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://light.localhost:3260",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "on",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
