import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { CHART_TYPES } from "../src/components/chart/chart-types";

type Frame = { time: number; theme: string | undefined; background: string };
declare global {
  interface Window { __themeFrames?: Frame[]; __themeCapture?: boolean; __themeCanvases?: Element[] }
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|hydrating|did not match/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

async function themeCookie(context: BrowserContext, baseURL: string, value: string) {
  await context.addCookies([{ name: "ixt_theme", value, domain: new URL(baseURL).hostname, path: "/" }]);
}

async function expectTheme(page: Page, theme: "dark" | "light") {
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? "dark")).toBe(theme);
}

test("public switches preserve partially filled forms and share one saved choice", async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  await expectTheme(page, "dark");
  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');
  await email.fill("theme-check@example.com");
  await password.fill("unfinished-password");
  const form = await email.elementHandle();
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expectTheme(page, "light");
  expect(await email.evaluate((node, before) => node === before, form)).toBe(true);
  await expect(email).toHaveValue("theme-check@example.com");
  await expect(password).toHaveValue("unfinished-password");
  const saved = (await context.cookies()).find((cookie) => cookie.name === "ixt_theme");
  expect(saved).toMatchObject({ value: "light", path: "/", sameSite: "Lax" });
  await page.reload();
  await expectTheme(page, "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f4f6f9");
  expect(errors).toEqual([]);
});

test("two tabs receive a theme switch and retain it on reload", async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto("/login");
  const second = await context.newPage();
  const secondErrors = watchErrors(second);
  await second.goto("/maintenance");
  await expectTheme(second, "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expectTheme(second, "light");
  await second.reload();
  await expectTheme(second, "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectTheme(second, "dark");
  expect([...errors, ...secondErrors]).toEqual([]);
});

test("a throwing cookie setter still allows switching for the session", async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: () => { throw new DOMException("Cookies disabled", "SecurityError"); },
    });
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expectTheme(page, "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectTheme(page, "dark");
  expect(errors).toEqual([]);
});

test("/start honors global, legacy and device choices without writing the old cookie", async ({ browser, baseURL }) => {
  for (const scenario of [
    { device: "light", legacy: undefined, saved: undefined, expected: "light" },
    { device: "dark", legacy: undefined, saved: undefined, expected: "dark" },
    { device: "light", legacy: "dark", saved: undefined, expected: "dark" },
    { device: "light", legacy: "light", saved: "dark", expected: "dark" },
  ] as const) {
    const context = await browser.newContext({ colorScheme: scenario.device });
    if (scenario.legacy) await context.addCookies([{ name: "ixt_start_theme", value: scenario.legacy, domain: new URL(baseURL!).hostname, path: "/start" }]);
    if (scenario.saved) await themeCookie(context, baseURL!, scenario.saved);
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`${baseURL}/start`);
    await expectTheme(page, scenario.expected);
    await expect(page.locator(`[data-theme-choice="${scenario.expected}"]`)).toHaveAttribute("aria-pressed", "true");
    const before = (await context.cookies()).find((cookie) => cookie.name === "ixt_start_theme");
    await page.getByRole("button", { name: "Use light theme" }).click();
    await expectTheme(page, "light");
    const after = (await context.cookies()).find((cookie) => cookie.name === "ixt_start_theme");
    expect(after).toEqual(before);
    expect((await context.cookies()).find((cookie) => cookie.name === "ixt_theme")).toMatchObject({ value: "light", path: "/" });
    expect(errors).toEqual([]);
    await context.close();
  }
});

test("JavaScript-disabled pages remain dark with a saved light preference", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await themeCookie(context, baseURL!, "light");
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`);
  expect(await page.locator("html").getAttribute("data-theme")).toBeNull();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator(".brand-wordmark-dark")).toBeVisible();
  await expect(page.locator(".brand-wordmark-light")).toBeHidden();
  await context.close();
});

test("Slow 4G saved-light reload applies the bootstrap before rendered frames", async ({ page, context, baseURL }, testInfo) => {
  const errors = watchErrors(page);
  await themeCookie(context, baseURL!, "light");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750, connectionType: "cellular4g" });
  await page.addInitScript(() => {
    window.__themeFrames = [];
    window.__themeCapture = true;
    function capture() {
      if (!window.__themeCapture) return;
      if (document.body?.children.length) window.__themeFrames!.push({
        time: performance.now(), theme: document.documentElement.dataset.theme,
        background: getComputedStyle(document.body).backgroundColor,
      });
      requestAnimationFrame(capture);
    }
    requestAnimationFrame(capture);
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expectTheme(page, "light");
  await expect(page.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
  await page.screenshot({ path: `${testInfo.outputDir}/slow-4g-light.png` });
  const frames = await page.evaluate(() => { window.__themeCapture = false; return window.__themeFrames ?? []; });
  await writeFile(testInfo.outputPath("rendered-frame-theme-samples.json"), JSON.stringify(frames));
  await testInfo.attach("rendered-frame-theme-samples", { body: JSON.stringify(frames), contentType: "application/json" });
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.filter((frame) => frame.theme !== "light")).toEqual([]);
  expect(frames.filter((frame) => frame.background !== "rgb(244, 246, 249)")).toEqual([]);
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f4f6f9");
  expect(errors).toEqual([]);
});

test("phone menu stays open and preserves a support draft while switching", async ({ browser, baseURL }) => {
  test.skip(!process.env.E2E_THEME_STORAGE_STATE, "Provide local authenticated storage state to verify protected pages.");
  const context = await browser.newContext({ storageState: process.env.E2E_THEME_STORAGE_STATE!, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto(`${baseURL}/support`);
  await page.getByLabel("Subject", { exact: true }).fill("Unfinished appearance check");
  await page.getByLabel("Message", { exact: true }).fill("This draft must remain through the theme switch.");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Platform sections" });
  await expect(nav).toBeVisible();
  const before = await nav.elementHandle();
  await nav.getByRole("button", { name: "Switch to light theme" }).click();
  await expectTheme(page, "light");
  await expect(nav).toBeVisible();
  expect(await nav.evaluate((node, original) => node === original, before)).toBe(true);
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Unfinished appearance check");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("This draft must remain through the theme switch.");
  expect(errors).toEqual([]);
  await context.close();
});

test("all chart types switch palettes on the same live chart and retain a ticket draft", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(!process.env.E2E_THEME_STORAGE_STATE, "Provide local authenticated storage state to verify the live chart.");
  const context = await browser.newContext({ storageState: process.env.E2E_THEME_STORAGE_STATE!, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.addLocatorHandler(page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Deposit bonus", exact: true }) }), async (dialog) => {
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  });
  let connections = 0;
  let closes = 0;
  let engineFrames = 0;
  page.on("websocket", (socket) => {
    if (socket.url().includes("/_next/")) return;
    connections++;
    socket.on("close", () => { closes++; });
    socket.on("framereceived", () => { engineFrames++; });
  });
  await page.goto(`${baseURL}/trade`);
  await expect.poll(() => engineFrames).toBeGreaterThan(1);
  await page.locator(".market-sidebar").getByRole("button", { name: /BTC\/USDT/ }).click();
  await page.locator("#stake, #cfd-stake").fill("125");
  await expect(page.locator(".chartbox-bg canvas").first()).toBeVisible();
  await page.evaluate(() => { window.__themeCanvases = [...document.querySelectorAll(".chartbox-bg canvas")]; });
  const originalConnections = connections;
  const initialFrames = engineFrames;
  const paletteSwitches = [];
  for (const type of CHART_TYPES) {
    await page.getByRole("button", { name: /^Chart style:/ }).filter({ visible: true }).first().click();
    await page.getByRole("option", { name: `${type.label} ${type.description}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Chart style: ${type.label}`, exact: true }).filter({ visible: true }).first()).toBeVisible();
    // Existing chart-type sweep takes two seconds; palette changes are immediate.
    await page.waitForTimeout(2_100);
    for (const theme of ["dark", "light"] as const) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
        await page.getByRole("button", { name: `Switch to ${theme} theme` }).click();
      }
      await expectTheme(page, theme);
      expect(await page.evaluate(() => {
        const now = [...document.querySelectorAll(".chartbox-bg canvas")];
        return now.length === window.__themeCanvases!.length && now.every((canvas, i) => canvas === window.__themeCanvases![i]);
      })).toBe(true);
      await expect(page.locator("#stake, #cfd-stake")).toHaveValue("125");
      await page.locator(".chartbox-bg").screenshot({ path: `${testInfo.outputDir}/chart-${type.id}-${theme}.png` });
      paletteSwitches.push({ type: type.id, theme, connections, engineFrames });
    }
  }
  const timing = await page.evaluate(async () => {
    const intervals: number[] = [];
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => { list.getEntries().forEach((entry) => longTasks.push(entry.duration)); });
    observer.observe({ type: "longtask" });
    const start = performance.now();
    document.querySelector<HTMLButtonElement>('button[aria-label="Switch to dark theme"]')!.click();
    const synchronousMs = performance.now() - start;
    const firstFrameMs = await new Promise<number>((resolve) => requestAnimationFrame(() => resolve(performance.now() - start)));
    let previous = performance.now();
    for (let i = 0; i < 30; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => {
        const now = performance.now(); intervals.push(now - previous); previous = now; resolve();
      }));
    }
    observer.disconnect();
    const sorted = [...intervals].sort((a, b) => a - b);
    return { synchronousMs, firstFrameMs, frameIntervalsMs: intervals, p95FrameIntervalMs: sorted[Math.ceil(sorted.length * .95) - 1], longTasksMs: longTasks };
  });
  expect(connections).toBe(originalConnections);
  expect(closes).toBe(0);
  expect(engineFrames).toBeGreaterThan(initialFrames);
  const evidence = JSON.stringify({ timing, paletteSwitches, connections, closes, engineFrames });
  await writeFile(testInfo.outputPath("live-chart-theme-evidence.json"), evidence);
  await testInfo.attach("live-chart-theme-evidence", { body: evidence, contentType: "application/json" });
  expect(errors).toEqual([]);
  await context.close();
});
