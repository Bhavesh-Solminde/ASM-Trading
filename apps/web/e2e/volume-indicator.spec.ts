import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.OTC_ORDER_BOOK_ENABLED !== "true", "Volume is available on OTC charts.");

// Run against an OTC dashboard. Candles are deterministic test fixtures;
// no orders, ticks or account balances are changed by these checks.
async function volumePixels(page: Page) {
  return page.locator(".analysis-plot .tv-lightweight-charts canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d")!;
    const { data } = context.getImageData(0, Math.floor(canvas.height * .87), canvas.width, Math.floor(canvas.height * .12));
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      if ((r > 85 && g < 60 && b < 75) || (g > 65 && r < 30 && b > 50 && b < 110)) count++;
    }
    return count;
  });
}

async function visibleCandles(page: Page) {
  return page.locator(".analysis-plot .tv-lightweight-charts canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const height = Math.floor(canvas.height * .85);
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, height);
    let candles = 0, previous = false;
    for (let x = 0; x < canvas.width; x++) {
      let pixels = 0;
      for (let y = 0; y < height; y++) {
        const i = (y * canvas.width + x) * 4;
        if ((data[i] === 8 && data[i + 1] === 153 && data[i + 2] === 129) ||
            (data[i] === 242 && data[i + 1] === 54 && data[i + 2] === 69)) pixels++;
      }
      const present = pixels >= 10;
      if (present && !previous) candles++;
      previous = present;
    }
    return candles;
  });
}

test("Volume can be enabled, restored, and removed without affecting other indicators", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("indianxtrade:diwali:2026:seen", "1");
    localStorage.setItem("ixt.pwa.sheetShownAt", String(Date.now()));
  });
  await page.routeWebSocket(/ws:\/\//, socket => {
    socket.send(JSON.stringify({ type: "ready", serverTs: Date.now() }));
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === "auth") socket.send(JSON.stringify({ type: "authed" }));
      if (message.type !== "subscribe") return;
      const duration = ({ "1m": 60, "5m": 300, "15m": 900, "1h": 3600 } as Record<string, number>)[message.timeframe] ?? 60;
      const end = Math.floor(Date.now() / 1000 / duration) * duration;
      const candles = Array.from({ length: 120 }, (_, i) => {
        const o = 100 + Math.sin(i / 6), c = o + (i % 2 ? .2 : -.2);
        return { openTs: end - (120 - i) * duration, o, c, h: Math.max(o, c) + .1, l: Math.min(o, c) - .1, volume: 50 + i % 11 * 10 };
      });
      socket.send(JSON.stringify({ type: "candles:history", symbol: message.symbol, timeframe: message.timeframe, candles, forming: { ...candles.at(-1)!, openTs: end } }));
      socket.send(JSON.stringify({ type: "tick", symbol: message.symbol, price: candles.at(-1)!.c, ts: end }));
    });
  });
  await page.goto("/trade");
  const offer = page.getByRole("dialog", { name: "Deposit bonus" });
  if (await offer.isVisible()) await offer.getByRole("button", { name: "Close", exact: true }).click();
  const fullscreen = page.getByRole("button", { name: "Fullscreen chart", exact: true });
  await expect.poll(() => visibleCandles(page)).toBe(8);
  await page.screenshot({ path: info.outputPath("initial-eight-candles.png") });
  if (info.project.name.includes("phone")) await fullscreen.click();
  await page.getByRole("button", { name: "Zoom out chart", exact: true }).click();
  await expect.poll(() => visibleCandles(page)).toBeGreaterThan(8);
  await page.reload();
  await expect.poll(() => visibleCandles(page)).toBe(8);
  if (info.project.name.includes("phone")) await fullscreen.click();
  const menu = page.getByRole("button", { name: /ƒx/ });
  await menu.click();
  const volume = page.getByRole("checkbox", { name: "Volume", exact: true });
  await expect(volume).toBeVisible();
  await expect(volume).not.toBeChecked();
  await expect.poll(() => volumePixels(page)).toBe(0);
  await page.screenshot({ path: info.outputPath("volume-off.png") });
  await volume.check();
  await expect.poll(() => volumePixels(page)).toBeGreaterThan(500);
  await expect(menu).toContainText("1");
  await page.getByRole("checkbox", { name: "SMA 14", exact: true }).check();
  await expect(menu).toContainText("2");
  await page.screenshot({ path: info.outputPath("volume-on.png") });
  await page.reload();
  if (info.project.name.includes("phone")) await fullscreen.click();
  await menu.click();
  await expect(volume).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "SMA 14", exact: true })).toBeChecked();
  await expect.poll(() => volumePixels(page)).toBeGreaterThan(500);
  for (let i = 0; i < 3; i++) {
    await volume.uncheck();
    await expect.poll(() => volumePixels(page)).toBe(0);
    await volume.check();
    await expect.poll(() => volumePixels(page)).toBeGreaterThan(500);
  }
  await volume.uncheck();
  await expect(page.getByRole("checkbox", { name: "SMA 14", exact: true })).toBeChecked();
  await page.reload();
  if (info.project.name.includes("phone")) await fullscreen.click();
  await menu.click();
  await expect(volume).not.toBeChecked();
  await expect.poll(() => volumePixels(page)).toBe(0);
  expect(errors).toEqual([]);
});
