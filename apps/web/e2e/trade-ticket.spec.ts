import { expect, test, type Page } from "@playwright/test";

/**
 * Issue 3: the amount and time the trader set must survive (a) entering and
 * leaving fullscreen, (b) resizing the window (iPad full screen <-> split
 * view), and (c) a page refresh.
 */

const stake = (page: Page) => page.locator("#stake");
// The desktop timer LED (the button also holds a hidden phone-only label).
const timerDisplay = (page: Page) => page.locator('button[aria-labelledby="ticket-time"] .led').first();

async function openTicket(page: Page): Promise<void> {
  await page.goto("/trade");
  await expect(stake(page)).toBeVisible();
}

test.describe("trade ticket keeps amount and time", () => {
  test.beforeEach(async ({ page }) => {
    // Start each test from a clean ticket.
    await page.goto("/trade");
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("asm_ticket_")) localStorage.removeItem(k);
    });
  });

  test("survives fullscreen on/off and a page refresh", async ({ page }, info) => {
    await openTicket(page);
    await stake(page).fill("750");
    await page.getByRole("button", { name: "Longer" }).click();
    await page.getByRole("button", { name: "Longer" }).click();
    const time = (await timerDisplay(page).innerText()).trim();
    expect(time).not.toBe("00:00:30");
    await info.attach("1-set-750-and-time", { body: await page.screenshot(), contentType: "image/png" });

    await page.getByRole("button", { name: "Fullscreen chart" }).click();
    await expect(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
    await expect(stake(page)).toHaveValue("750");
    await expect(timerDisplay(page)).toHaveText(time);
    await info.attach("2-fullscreen-kept", { body: await page.screenshot(), contentType: "image/png" });

    await page.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(page.getByRole("button", { name: "Fullscreen chart" })).toBeVisible();
    await expect(stake(page)).toHaveValue("750");
    await expect(timerDisplay(page)).toHaveText(time);
    await info.attach("3-exit-fullscreen-kept", { body: await page.screenshot(), contentType: "image/png" });

    await page.reload();
    await expect(stake(page)).toHaveValue("750");
    await expect(timerDisplay(page)).toHaveText(time);
    await info.attach("4-after-refresh-kept", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("survives a resize to split-view width and back", async ({ page }, info) => {
    const full = page.viewportSize()!;
    await openTicket(page);
    await stake(page).fill("1250");
    await page.getByRole("button", { name: "Longer" }).click();
    const time = (await timerDisplay(page).innerText()).trim();

    // iPad split view: phone layout, where the stake shows on the dock tile.
    await page.setViewportSize({ width: 700, height: full.height });
    const tile = page.getByRole("button", { name: /^Investment / });
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAccessibleName(/1,250/);
    await info.attach("split-view-kept", { body: await page.screenshot(), contentType: "image/png" });

    await page.setViewportSize(full);
    await expect(stake(page)).toHaveValue("1250");
    await expect(timerDisplay(page)).toHaveText(time);
    await info.attach("back-to-full-kept", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("a fresh ticket still opens on the default stake", async ({ page }) => {
    await openTicket(page);
    await expect(stake(page)).toHaveValue("100");
  });
});
