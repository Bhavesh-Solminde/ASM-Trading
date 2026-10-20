import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@asm/db";
import { VIEWER_EMAIL } from "./seed";

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

  test("investment can be a % of balance and never drops below ₹100", async ({ page }, info) => {
    // A ₹5,000 demo balance: 10% = ₹500, and 1% = ₹50, which must become ₹100.
    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: VIEWER_EMAIL }, select: { id: true } });
    const demo = await prisma.account.findFirstOrThrow({ where: { userId: viewer.id, type: "DEMO" } });
    await prisma.account.update({ where: { id: demo.id }, data: { realBalance: 5_000_00, bonusBalance: 0 } });
    try {
      const row = page.getByTestId("pct-investment");
      await openTicket(page);
      await expect(row).toHaveCount(0);
      await page.getByRole("button", { name: "Switch investment to a percentage of balance" }).click();
      await stake(page).fill("10");
      await expect(row).toHaveText(/Investment\s*₹500\.00/);
      await info.attach("1-ten-percent-of-5000", { body: await page.screenshot(), contentType: "image/png" });

      await stake(page).fill("1");
      await expect(row).toHaveText(/Investment \(minimum\)\s*₹100\.00/);
      await info.attach("2-one-percent-floored-at-100", { body: await page.screenshot(), contentType: "image/png" });

      // The % choice survives fullscreen and a refresh, like the amount does.
      await page.getByRole("button", { name: "Fullscreen chart" }).click();
      await expect(stake(page)).toHaveValue("1");
      await page.getByRole("button", { name: "Exit fullscreen" }).click();
      await page.reload();
      await expect(stake(page)).toHaveValue("1");
      await expect(row).toHaveText(/₹100\.00/);
      await info.attach("3-after-refresh-still-percent", { body: await page.screenshot(), contentType: "image/png" });

      await page.getByRole("button", { name: "Switch investment to an amount" }).click();
      await expect(stake(page)).toHaveValue("100");
      await expect(row).toHaveCount(0);
    } finally {
      await prisma.account.update({
        where: { id: demo.id },
        data: { realBalance: demo.realBalance, bonusBalance: demo.bonusBalance },
      });
    }
  });

  test("phone keypad can switch to % and still respects the ₹100 floor", async ({ page }, info) => {
    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: VIEWER_EMAIL }, select: { id: true } });
    const demo = await prisma.account.findFirstOrThrow({ where: { userId: viewer.id, type: "DEMO" } });
    await prisma.account.update({ where: { id: demo.id }, data: { realBalance: 5_000_00, bonusBalance: 0 } });
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/trade");
      const tile = page.getByRole("button", { name: /^Investment / });
      await tile.click();
      const sheet = page.getByRole("dialog", { name: "Investment" });
      await sheet.getByRole("radio", { name: "Percentage of balance" }).click();
      await sheet.getByRole("button", { name: "1%", exact: true }).click();
      await expect(sheet).toContainText("= ₹100.00 (minimum) of demo balance ₹5,000.00");
      await info.attach("1-phone-sheet-one-percent", { body: await page.screenshot(), contentType: "image/png" });

      await sheet.getByRole("button", { name: "10%", exact: true }).click();
      await expect(sheet).toContainText("= ₹500.00 of demo balance ₹5,000.00");
      await sheet.getByRole("button", { name: "Set 10%" }).click();
      await expect(tile).toHaveAccessibleName(/₹500\.00 \(10% of balance\)/);
      await info.attach("2-phone-tile-ten-percent", { body: await page.screenshot(), contentType: "image/png" });
    } finally {
      await prisma.account.update({
        where: { id: demo.id },
        data: { realBalance: demo.realBalance, bonusBalance: demo.bonusBalance },
      });
    }
  });
});
