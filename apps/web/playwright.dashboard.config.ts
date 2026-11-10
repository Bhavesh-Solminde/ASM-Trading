import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir:"./e2e",testMatch:"dashboard-improvements.spec.ts",globalSetup:"./e2e/dashboard-setup.ts",workers:1,fullyParallel:false,timeout:90000,
  outputDir:"../../artifacts/dashboard-improvements-2026-11-11/test-results",
  reporter:[["list"],["html",{outputFolder:"../../artifacts/dashboard-improvements-2026-11-11/test-report",open:"never"}]],
  use:{baseURL:"http://localhost:3000",storageState:"e2e/.auth/dashboard-verification.json",trace:"retain-on-failure",screenshot:"only-on-failure"},
  projects:[{name:"desktop-chromium",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:900}}},{name:"phone-webkit",use:{...devices["iPhone 13"],viewport:{width:390,height:844}}}],
});
