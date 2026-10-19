import { expect, test } from "@playwright/test";

/**
 * Issues 1 + 4: only South Asia / Gulf traders are ranked, every amount is in
 * one currency, and a $1,108 profit ranks above a ₹2,039.52 one.
 */

const REGION = ["IN", "PK", "BD", "NP", "LK", "AE", "SA", "QA", "KW", "OM", "BH"];
const flagOf = (cc: string) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

test("leaderboard is region-only, single-currency and FX-correct", async ({ page }, info) => {
  await page.goto("/leaderboard");
  const rows = page.locator('section[aria-label="Daily standings"] ol > li');
  await expect(rows.first()).toBeVisible();
  await info.attach("leaderboard", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  const data = await rows.evaluateAll((lis) =>
    lis.map((li) => {
      const spans = li.querySelectorAll(":scope > span");
      return { flag: spans[1]?.textContent ?? "", name: spans[2]?.textContent ?? "", amount: spans[3]?.textContent ?? "" };
    }),
  );
  await info.attach("rows.json", { body: JSON.stringify(data, null, 2), contentType: "application/json" });

  const allowed = new Set(REGION.map(flagOf));
  for (const r of data) expect(allowed.has(r.flag), `${r.name} has flag ${r.flag}`).toBe(true);

  // Viewer's live account is INR, so every row is in rupees.
  for (const r of data) expect(r.amount, `${r.name} amount`).toMatch(/^[+−]₹[\d,]+\.\d{2}$/);

  const names = data.map((r) => r.name);
  expect(names).not.toContain("E2E Abroad");
  expect(names).not.toContain("E2E Nowhere");
  const dollar = names.indexOf("E2E Dollar");
  const rupee = names.indexOf("E2E Rupee");
  expect(dollar).toBeGreaterThanOrEqual(0);
  expect(rupee).toBeGreaterThan(dollar);
  expect(data[dollar]!.amount).toBe("+₹110,800.00"); // $1,108 at ₹100 = $1
  expect(data[dollar]!.flag).toBe(flagOf("IN")); // stored as "India", shown as 🇮🇳
});
