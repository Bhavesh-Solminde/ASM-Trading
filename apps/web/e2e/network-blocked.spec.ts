import { expect, test } from "@playwright/test";

/** Issue 2: the page a hidden-IP visitor lands on tells them how to reveal it. */
test("network-blocked page explains how to show the IP address", async ({ page }, info) => {
  await page.goto("/network-blocked");
  await expect(page.getByRole("heading", { name: "Show your IP address." })).toBeVisible();
  await expect(page.getByText(/iCloud Private Relay/).first()).toBeVisible();
  await expect(page.getByText("Show IP Address")).toBeVisible();
  await info.attach("network-blocked", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
