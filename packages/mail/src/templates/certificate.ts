/**
 * Withdrawal reward certificate — one inline-styled HTML fragment used by the
 * in-app receipt and the "withdrawal paid" email, so the two never drift.
 * Table-based so it survives email clients. The in-app receipt renders it dark
 * (the app is dark); the email renders it light with x-* classes that the
 * email layout's dark-mode CSS flips, so it follows the reader's theme.
 */
import { EMAIL_PALETTE, escapeHtml } from "./layout";

export interface CertificateData {
  name: string;
  amountLabel: string;
  dateLabel: string;
  refId: string;
}

/** "requested" = the in-app receipt at request time; "paid" = the email sent when the admin marks it paid. */
export type CertificateStage = "requested" | "paid";

/** "dark" = fixed dark card (in-app). "adaptive" = light inline + dark via the email's media query. */
export type CertificateTheme = "dark" | "adaptive";

const CERTIFICATE_NOTE: Record<CertificateStage, string> = {
  requested:
    "This certificate confirms a withdrawal request on IndianxTrade. Requests are processed within 5–10 hours to your chosen payout method.",
  paid: "This certificate confirms a withdrawal paid out by IndianxTrade to your chosen payout method.",
};

const THEMES = {
  dark: { card: "#05070b", rule: "#232a34", foot: "#0b0e13", ink: "#ffffff", ink2: "#98a2b3", ink3: "#5a6472", amount: "#2f81f7", brand: "#ffb000" },
  adaptive: {
    card: EMAIL_PALETTE.light.panel,
    rule: EMAIL_PALETTE.light.rule,
    foot: EMAIL_PALETTE.light.page,
    ink: EMAIL_PALETTE.light.ink,
    ink2: EMAIL_PALETTE.light.ink2,
    ink3: EMAIL_PALETTE.light.ink3,
    amount: EMAIL_PALETTE.light.link,
    brand: "#c2410c",
  },
} as const;

export function certificateHtml(
  { name, amountLabel, dateLabel, refId }: CertificateData,
  stage: CertificateStage = "requested",
  theme: CertificateTheme = "dark",
): string {
  const t = THEMES[theme];
  const safeName = escapeHtml(name);
  const safeAmount = escapeHtml(amountLabel);
  const safeDate = escapeHtml(dateLabel);
  const safeRef = escapeHtml(refId);
  const label = `font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${t.ink2};`;
  return `
<table role="presentation" class="x-panel x-rule" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:${t.card};border:1px solid ${t.rule};border-radius:14px;border-collapse:separate;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="height:4px;background:#2f81f7;border-radius:14px 14px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="padding:28px 28px 6px;">
    <div style="font-size:12px;font-weight:800;letter-spacing:3px;color:${t.brand};">INDIANXTRADE</div>
    <div class="x-ink" style="margin-top:18px;font-size:26px;font-weight:800;line-height:1.15;color:${t.ink};">Reward Certificate</div>
    <div class="x-ink2" style="margin-top:6px;${label}">Withdrawal confirmed</div>
  </td></tr>
  <tr><td style="padding:14px 28px 4px;">
    <div class="x-ink2" style="${label}">Proudly presented to</div>
    <div class="x-ink" style="margin-top:4px;font-size:22px;font-weight:700;color:${t.ink};">${safeName}</div>
  </td></tr>
  <tr><td style="padding:16px 28px 18px;">
    <div class="x-ink2" style="${label}">Rewards received</div>
    <div class="x-amount" style="margin-top:2px;font-size:34px;font-weight:800;color:${t.amount};">${safeAmount}</div>
  </td></tr>
  <tr><td style="padding:0 28px;">
    <table role="presentation" class="x-rule" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${t.rule};">
      <tr>
        <td style="padding:12px 0 22px;vertical-align:top;">
          <div class="x-ink3" style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${t.ink3};">Date</div>
          <div class="x-ink" style="font-size:13px;color:${t.ink};">${safeDate}</div>
        </td>
        <td style="padding:12px 0 22px;vertical-align:top;text-align:right;">
          <div class="x-ink3" style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${t.ink3};">Reference</div>
          <div class="x-ink" style="font-size:13px;color:${t.ink};">${safeRef}</div>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td class="x-page x-ink3" style="padding:14px 28px;background:${t.foot};border-radius:0 0 14px 14px;font-size:11px;line-height:1.6;color:${t.ink3};">
    ${CERTIFICATE_NOTE[stage]}
  </td></tr>
</table>`.trim();
}
