import { expect, test, type Locator, type Page } from "@playwright/test";
import { TIMEFRAME_SEC, type Timeframe } from "@asm/contracts";

async function coordinates(line: Locator) {
 const [x1, y1, x2, y2] = await line.evaluate(el => ["x1", "y1", "x2", "y2"].map(key => Number(el.getAttribute(key))));
 return { x1: x1!, y1: y1!, x2: x2!, y2: y2! };
}

function savedDrawings(page: Page) {
 return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
  .filter(([key]) => key.startsWith("asm_chart_drawings:v1:"))
  .map(([key, value]) => [key, JSON.parse(value)])));
}

async function openChart(page: Page) {
 await page.addInitScript(() => {
  localStorage.setItem("asm_chart_symbol", "XAUUSD");
  localStorage.setItem("indianxtrade:diwali:2026:seen", "1");
  localStorage.setItem("ixt.pwa.sheetShownAt", String(Date.now()));
 });
 await page.routeWebSocket(/ws:\/\//, socket => {
  socket.send(JSON.stringify({ type: "ready", serverTs: Date.now() }));
  socket.onMessage(raw => {
   const message = JSON.parse(String(raw));
   if (message.type === "auth") socket.send(JSON.stringify({ type: "authed" }));
   if (message.type !== "subscribe") return;
   const seconds = TIMEFRAME_SEC[message.timeframe as Timeframe];
   const end = Math.floor(Date.now() / 1000 / seconds) * seconds;
   const candles = Array.from({ length: 120 }, (_, i) => {
    const o = 2700 + Math.sin(i / 6) * 3, c = o + (i % 2 ? .3 : -.3);
    return { openTs: end - (120 - i) * seconds, o, c, h: Math.max(o, c) + .2, l: Math.min(o, c) - .2, volume: 50 + i % 11 * 10 };
   });
   socket.send(JSON.stringify({ type: "candles:history", symbol: message.symbol, timeframe: message.timeframe, candles, forming: { ...candles.at(-1), openTs: end } }));
   socket.send(JSON.stringify({ type: "tick", symbol: message.symbol, price: candles.at(-1)!.c, ts: end }));
  });
 });
 await page.goto("/trade");
 await expect(page.getByRole("complementary", { name: "Trade ticket and trades" })).toBeVisible();
 await expect(page.locator(".analysis-plot .tv-lightweight-charts canvas").first()).toBeVisible();
 await expect(page.locator(".analysis-plot").getByText(/^O [\d,.]+\s+H /)).toBeVisible();
}

test("every drawing tool, indicators, edit, undo and persistence", async ({ page }, info) => {
 test.skip(info.project.name !== "desktop-chromium");
 const errors: string[] = [];
 page.on("pageerror", error => errors.push(error.message));
 await openChart(page);
 const capture = (name: string) => page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });
 const canvas = page.getByLabel("Chart drawings", { exact: true });
 await expect.poll(async () => Number(await canvas.getAttribute("width"))).toBeGreaterThan(300);
 const box = (await canvas.boundingBox())!;
 const point = (x: number, y: number) => ({ x, y });
 const start = point(25, Math.min(128, box.height * .3));
 const end = point(box.width * .88, box.height * .66);
 const middle = point((start.x + end.x) / 2, (start.y + end.y) / 2);
 const button = (name: string) => page.getByRole("button", { name, exact: true });
 const undo = button("Undo drawing change");
 const redo = button("Redo drawing change");
 const remove = button("Delete selected drawing");
 const notes = page.getByRole("textbox", { name: "Annotation text" });
 const rows = canvas.locator("g[data-tool]");
 const row = (tool: string) => rows.and(canvas.locator(`[data-tool="${tool}"]`));
 const lines = (tool: string) => row(tool).locator("line[data-drawing-line]");
 const handle = (i: number) => canvas.locator(`circle[data-anchor="${i}"]`);
 const saved = () => savedDrawings(page);
 async function move(p: { x: number; y: number }) { await page.mouse.move(box.x + p.x, box.y + p.y); }
 async function click(p: { x: number; y: number }) { await page.mouse.click(box.x + p.x, box.y + p.y); }
 async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  await move(from);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
 }
 function near(a: number, b: number) { expect(Math.abs(a - b)).toBeLessThan(1.1); }

 await button("Trend line").click();
 await click(start);
 await move(end);
 await expect(row("trend")).toHaveAttribute("data-preview", "true");
 expect(await saved()).toEqual({});
 await expect(undo).toBeDisabled();
 await capture("trend-preview");
 await page.keyboard.press("Escape");
 await expect(rows).toHaveCount(0);
 await expect(undo).toBeDisabled();

 await button("Trend line").click();
 await click(start);
 await click(start); // Same-position clicks leave placement armed.
 await expect(button("Trend line")).toHaveAttribute("aria-pressed", "true");
 await click(end);
 await expect(row("trend")).not.toHaveAttribute("data-preview", "true");
 const trend = lines("trend");
 const initial = await coordinates(trend);
 near(initial.x1, start.x); near(initial.y1, start.y);
 near(initial.x2, end.x); near(initial.y2, end.y);
 const initialDrawings = await saved();
 expect(Object.values(initialDrawings)[0][0].points.some((p: { time: number }) => p.time % 60 !== 0)).toBe(true);

 await click(point(middle.x, middle.y + 5)); // A slightly off-stroke click selects without adding history.
 expect(await saved()).toEqual(initialDrawings);
 await undo.click();
 await expect(row("trend")).toHaveCount(0);
 await redo.click();
 await expect.poll(() => saved()).toEqual(initialDrawings);
 await expect(row("trend")).toHaveCount(1);
 await drag(point(middle.x, middle.y + 5), point(middle.x + 21, middle.y + 24));
 await expect.poll(async () => (await coordinates(trend)).x1).not.toBe(initial.x1);
 const shifted = await coordinates(trend);
 near(shifted.x1, initial.x1 + 21); near(shifted.x2, initial.x2 + 21);
 near(shifted.y1, initial.y1 + 19); near(shifted.y2, initial.y2 + 19);
 await page.keyboard.press("ControlOrMeta+z");
 await expect.poll(() => saved()).toEqual(initialDrawings);
 await page.keyboard.press("ControlOrMeta+Shift+z");
 await expect.poll(async () => (await coordinates(trend)).x1).toBe(shifted.x1);
 await capture("trend-moved");

 await expect(handle(1)).toBeVisible();
 await move(point(shifted.x2, shifted.y2));
 await page.mouse.down();
 await move(point(shifted.x2 - 22, shifted.y2 - 25));
 await page.keyboard.press("Delete");
 await page.mouse.up();
 await expect(row("trend")).toHaveCount(0);
 await expect(remove).toBeDisabled();
 await undo.click();
 await expect.poll(() => coordinates(trend)).toEqual(shifted);
 await redo.click();
 await expect(row("trend")).toHaveCount(0);

 await button("Horizontal line").click();
 await click(point(box.width * .48, box.height * .76));
 await expect(lines("horizontal")).toHaveCount(1);
 const horizontal = await coordinates(lines("horizontal"));
 near(horizontal.y1, horizontal.y2);
 near(horizontal.x1, 0); near(horizontal.x2, box.width);
 await button("Vertical line").click();
 await click(point(box.width * .35, box.height * .61));
 await expect(lines("vertical")).toHaveCount(1);
 const vertical = await coordinates(lines("vertical"));
 near(vertical.x1, vertical.x2);
 near(vertical.y1, 0); near(vertical.y2, box.height);
 await expect(redo).toBeDisabled();
 await capture("horizontal-and-vertical");
 await click(point(box.width * .14, box.height * .9));
 await expect(remove).toBeDisabled();
 await drag(point(vertical.x1 + 4, box.height * .54), point(vertical.x1 + 25, box.height * .58));
 await expect.poll(async () => (await coordinates(lines("vertical"))).x1).not.toBe(vertical.x1);
 near((await coordinates(lines("vertical"))).x1, vertical.x1 + 21);

 const channelStart = point(box.width * .34, box.height * .32);
 const channelEnd = point(box.width * .68, box.height * .52);
 const width = point(box.width * .48, box.height * .58);
 await button("Parallel channel").click();
 await click(channelStart);
 await click(channelEnd);
 await move(width);
 await expect(lines("channel")).toHaveCount(2);
 await expect(row("channel")).toHaveAttribute("data-preview", "true");
 await click(width);
 await expect(handle(2)).toBeVisible();
 async function assertChannel(through: { x: number; y: number }) {
  const base = await coordinates(lines("channel").nth(0));
  const rail = await coordinates(lines("channel").nth(1));
  near(rail.y2 - rail.y1, base.y2 - base.y1);
  near(rail.x2 - rail.x1, base.x2 - base.x1);
  near(rail.y1 + (rail.y2 - rail.y1) * ((through.x - rail.x1) / (rail.x2 - rail.x1)), through.y);
 }
 await assertChannel(width);
 const widthMoved = point(width.x + 20, box.height * .22);
 await drag(width, widthMoved);
 await expect.poll(async () => Number(await handle(2).getAttribute("cy"))).toBeLessThan(width.y);
 await assertChannel(widthMoved);
 await capture("adjusted-channel");

 await button("Text annotation").click();
 await notes.fill("Gold analysis");
 const textAnchor = point(box.width * .62, box.height * .29);
 await click(textAnchor);
 const annotation = row("text").locator("text");
 await expect(annotation).toHaveText("Gold analysis");
 await notes.fill("Gold analysis · monthly");
 await notes.press("Escape");
 await expect(annotation).toHaveText("Gold analysis");
 await notes.fill("Gold analysis");
 await notes.press("End");
 await notes.pressSequentially(" · revised");
 await notes.press("Enter");
 await expect(annotation).toHaveText("Gold analysis · revised");
 await undo.click();
 await expect(annotation).toHaveText("Gold analysis");
 await redo.click();
 await expect(annotation).toHaveText("Gold analysis · revised");
 await click(point(textAnchor.x + 42, textAnchor.y - 5));
 await expect(remove).toBeEnabled();
 await drag(point(textAnchor.x + 42, textAnchor.y - 5), point(textAnchor.x + 66, textAnchor.y + 9));
 await expect.poll(async () => Number(await annotation.getAttribute("x"))).toBeGreaterThan(textAnchor.x + 20);
 await remove.click();
 await expect(annotation).toHaveCount(0);
 await undo.click();
 await expect(annotation).toHaveText("Gold analysis · revised");
 await capture("edited-text");

 for (const [label, tool] of [["Fibonacci retracement", "fib"], ["Freehand drawing", "brush"], ["Measure", "measure"]] as const) {
  await button(label).click();
  if (tool === "brush") await drag(start, end);
  else { await click(start); await click(end); }
  await expect(row(tool)).toHaveCount(1);
  await capture(tool);
  await remove.click();
  await expect(row(tool)).toHaveCount(0);
 }

 const stored = await saved();
 await page.getByRole("button", { name: /ƒx/ }).click();
 for (const i of ["SMA", "EMA", "RSI"]) {
  await page.getByLabel(`${i} 14`, { exact: true }).check();
  await expect(page.getByTestId("indicator-values")).toContainText(`${i} 14:`);
  await expect(page.getByTestId("indicator-values")).not.toContainText("Waiting for candles");
 }
 await button("Done").click();

 await page.reload();
 await expect(rows).toHaveCount(4);
 await expect(annotation).toHaveText("Gold analysis · revised");
 expect(await saved()).toEqual(stored);
 await expect(undo).toBeDisabled();
 await expect(remove).toBeDisabled();
 await capture("restored-analysis");
 await page.getByRole("button", { name: /ƒx/ }).click();
 await move(start);
 for (let i = 0; i < 5; i++) {
  // Keep the pointer over the plot while replacing indicator series.
  await page.getByLabel("SMA 14", { exact: true }).evaluate(el => (el as HTMLInputElement).click());
  await page.getByLabel("SMA 14", { exact: true }).evaluate(el => (el as HTMLInputElement).click());
 }
 await button("Done").click();
 const wheelTarget = await coordinates(lines("vertical"));
 const beforeWheel = await coordinates(lines("channel").first());
 await move(point(wheelTarget.x1 + 4, box.height * .25));
 await page.mouse.wheel(0, -110);
 await expect.poll(() => coordinates(lines("channel").first())).not.toEqual(beforeWheel);
 const beforeZoom = await coordinates(lines("vertical"));
 await button("Zoom in chart").click();
 await expect.poll(() => coordinates(lines("vertical"))).not.toEqual(beforeZoom);
 const beforePan = await coordinates(lines("vertical"));
 await drag(point(box.width * .22, box.height * .50), point(box.width * .30, box.height * .50));
 await expect.poll(() => coordinates(lines("vertical"))).not.toEqual(beforePan);
 await button("Zoom out chart").click();
 await button("Fit chart").click();
 expect(await saved()).toEqual(stored);
 await capture("zoom-fit");

 const beforeTimeframe = await coordinates(lines("vertical"));
 await button("Trend line").click();
 await click(start);
 await expect(row("trend")).toHaveAttribute("data-preview", "true");
 await page.getByRole("tab", { name: "5m", exact: true }).click();
 await expect(row("trend")).toHaveCount(0);
 await expect(button("Select drawings")).toHaveAttribute("aria-pressed", "true");
 await expect.poll(() => coordinates(lines("vertical"))).not.toEqual(beforeTimeframe);
 await page.getByRole("tab", { name: "1m", exact: true }).click();
 await expect(rows).toHaveCount(4);

 const markets = page.getByRole("complementary", { name: "Markets sidebar" });
 await markets.getByRole("button", { name: /^Silver/ }).click();
 await expect(page.locator(".desktop-chart-readout")).toContainText("Silver");
 await expect(rows).toHaveCount(0);
 await expect(undo).toBeDisabled();
 await markets.getByRole("button", { name: /^Gold/ }).click();
 await expect(rows).toHaveCount(4);
 await expect(remove).toBeDisabled();
 expect(await saved()).toEqual(stored);

 await button("Fullscreen chart").click();
 const workspace = page.getByRole("region", { name: "Trade", exact: true });
 await expect(workspace).toHaveAttribute("data-focus", "true");
 await button("Trend line").click();
 const fullscreen = (await canvas.boundingBox())!;
 await page.mouse.click(fullscreen.x + fullscreen.width * .32, fullscreen.y + fullscreen.height * .3);
 await expect(row("trend")).toHaveAttribute("data-preview", "true");
 // Dispatch to the app so the browser's own fullscreen shortcut does not exit first.
 await page.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
 await expect(row("trend")).toHaveCount(0);
 await expect(workspace).toHaveAttribute("data-focus", "true");
 await button("Exit fullscreen").click();
 expect(await saved()).toEqual(stored);
 expect(errors).toEqual([]);
});

test("steep channel keeps its finite rail at the width anchor through zoom and edits", async ({ page }, info) => {
 test.skip(info.project.name !== "desktop-chromium");
 await openChart(page);
 const canvas = page.getByLabel("Chart drawings", { exact: true });
 await expect.poll(async () => Number(await canvas.getAttribute("width"))).toBeGreaterThan(300);
 const box = (await canvas.boundingBox())!;
 const rails = canvas.locator('[data-tool="channel"] line[data-drawing-line]');
 const widthHandle = canvas.locator('circle[data-anchor="2"]');
 const x = Math.round(box.width * .45), y = Math.round(box.height * .3);
 await page.getByRole("button", { name: "Parallel channel", exact: true }).click();
 await page.mouse.click(box.x + x, box.y + y);
 await page.mouse.click(box.x + x + 1, box.y + y + 200);
 await page.mouse.click(box.x + x + 40, box.y + y + 90);
 await expect(widthHandle).toBeVisible();

 async function assertFiniteRail() {
  const base = await coordinates(rails.nth(0));
  const rail = await coordinates(rails.nth(1));
  const dx = base.x2 - base.x1, dy = base.y2 - base.y1;
  const wx = Number(await widthHandle.getAttribute("cx")) - rail.x1;
  const wy = Number(await widthHandle.getAttribute("cy")) - rail.y1;
  expect(rail.x2 - rail.x1).toBeCloseTo(dx, 5);
  expect(rail.y2 - rail.y1).toBeCloseTo(dy, 5);
  expect((wx * dy - wy * dx) / Math.hypot(dx, dy)).toBeCloseTo(0, 5);
  const along = (wx * dx + wy * dy) / (dx * dx + dy * dy);
  expect(along).toBeGreaterThan(0);
  expect(along).toBeLessThan(1);
  for (const x of [rail.x1, rail.x2]) expect(x).toBeGreaterThan(0);
  for (const y of [rail.y1, rail.y2]) expect(y).toBeGreaterThan(0);
  expect(Math.max(rail.x1, rail.x2)).toBeLessThan(box.width);
  expect(Math.max(rail.y1, rail.y2)).toBeLessThan(box.height);
  return base;
 }

 const before = await assertFiniteRail();
 expect(before.x2 - before.x1).toBeCloseTo(1, 1);
 await page.screenshot({ path: info.outputPath("steep-channel.png"), animations: "disabled" });
 const stored = await savedDrawings(page);
 await page.getByRole("button", { name: "Zoom in chart", exact: true }).click();
 await expect.poll(async () => {
  const base = await coordinates(rails.nth(0));
  return base.x2 - base.x1;
 }).toBeGreaterThan(1.1);
 const zoomed = await assertFiniteRail();
 expect(await savedDrawings(page)).toEqual(stored);
 await page.screenshot({ path: info.outputPath("steep-channel-zoomed.png"), animations: "disabled" });

 await page.mouse.move(box.x + zoomed.x2, box.y + zoomed.y2);
 await page.mouse.down();
 await page.mouse.move(box.x + zoomed.x1, box.y + zoomed.y1, { steps: 8 });
 await page.mouse.up();
 await expect.poll(() => coordinates(rails.nth(0))).toEqual(zoomed);
 expect(await savedDrawings(page)).toEqual(stored);
 await page.getByRole("button", { name: "Undo drawing change", exact: true }).click();
 await expect(rails).toHaveCount(0);
});
