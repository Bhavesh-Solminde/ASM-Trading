/**
 * Sends one sample of every email to a single inbox, to check Resend config
 * and rendering with real credentials. Reads RESEND_* from the root .env.
 * The logo is embedded (cid:) rather than loaded from LOGO_URL, so samples
 * render even before a new logo has been deployed to the site.
 *
 *   pnpm --filter @asm/mail samples -- you@example.com
 */
import { readFileSync } from "node:fs";
import { sendEmail } from "../src/send";
import {
  LOGO_URL,
  LOGO_URL_LIGHT,
  depositCreditedEmail,
  formatDateLabel,
  formatDateTimeLabel,
  passwordChangedEmail,
  passwordResetEmail,
  siteUrl,
  welcomeEmail,
  withdrawalPaidEmail,
  withdrawalRejectedEmail,
  withdrawalRequestedEmail,
  type RenderedEmail,
} from "../src/templates";

const to = process.argv.slice(2).find((a) => a.includes("@"));
if (!to) {
  console.error("Usage: pnpm --filter @asm/mail samples -- you@example.com");
  process.exit(1);
}

const today = formatDateLabel(new Date());
const samples: Array<[string, RenderedEmail]> = [
  ["welcome", welcomeEmail({ name: "Asha", firstDepositBonusPercent: 100 })],
  ["password_reset", passwordResetEmail({ name: null, resetUrl: siteUrl("/reset-password?token=sample-not-a-real-token"), ttlMinutes: 30 })],
  ["password_changed", passwordChangedEmail({ name: "Asha", changedAtLabel: formatDateTimeLabel(new Date()), resetUrl: siteUrl("/forgot-password") })],
  ["deposit_credited", depositCreditedEmail({ name: "Asha", creditLabel: "₹5,000.00", bonusLabel: "₹5,000.00", totalLabel: "₹10,000.00", dateLabel: today, refId: "D41C09AA" })],
  ["withdrawal_requested", withdrawalRequestedEmail({ name: "Asha", amountLabel: "₹2,500.00", payToLabel: "UPI · asha@okhdfc", held: false, refId: "8F3A21C9" })],
  ["withdrawal_paid", withdrawalPaidEmail({ name: "Asha", certificate: { name: "Asha Rao", amountLabel: "₹2,500.00", dateLabel: today, refId: "8F3A21C9" }, payToLabel: "UPI · asha@okhdfc" })],
  ["withdrawal_rejected", withdrawalRejectedEmail({ name: "Asha", amountLabel: "₹2,500.00", reason: "The UPI ID couldn't receive the payment", refId: "8F3A21C9" })],
];

const brand = (file: string) =>
  readFileSync(new URL(`../../../apps/web/public/brand/${file}`, import.meta.url)).toString("base64");
const logos = [
  { filename: "indianxtrade-mark-light.png", content: brand("indianxtrade-mark-light.png"), contentId: "ixt-logo-light" },
  { filename: "indianxtrade-mark.png", content: brand("indianxtrade-mark.png"), contentId: "ixt-logo" },
];

for (const [tag, email] of samples) {
  const html = email.html.replace(LOGO_URL_LIGHT, "cid:ixt-logo-light").replace(LOGO_URL, "cid:ixt-logo");
  const result = await sendEmail({ to, subject: `[sample] ${email.subject}`, html, tag, attachments: logos });
  console.log(tag.padEnd(22), JSON.stringify(result));
  // Stay under Resend's per-second rate limit.
  await new Promise((resolve) => setTimeout(resolve, 600));
}
