/**
 * Withdrawal reward certificate — one inline-styled HTML fragment used by the
 * in-app receipt and the "withdrawal paid" email, so the two never drift.
 * Styles are inline and table/div-based to survive email clients; colours
 * follow the app's black + blue + white theme with the gold IndianxTrade wordmark.
 */
import { escapeHtml } from "./layout";

export interface CertificateData {
  name: string;
  amountLabel: string;
  dateLabel: string;
  refId: string;
}

/** "requested" = the in-app receipt at request time; "paid" = the email sent when the admin marks it paid. */
export type CertificateStage = "requested" | "paid";

const CERTIFICATE_NOTE: Record<CertificateStage, string> = {
  requested:
    "This certificate confirms a withdrawal request on IndianxTrade. Requests are processed within 5–10 hours to your chosen payout method.",
  paid: "This certificate confirms a withdrawal paid out by IndianxTrade to your chosen payout method.",
};

export function certificateHtml(
  { name, amountLabel, dateLabel, refId }: CertificateData,
  stage: CertificateStage = "requested",
): string {
  const safeName = escapeHtml(name);
  const safeAmount = escapeHtml(amountLabel);
  const safeDate = escapeHtml(dateLabel);
  const safeRef = escapeHtml(refId);
  return `
<div style="max-width:600px;margin:0 auto;background:#05070b;border:1px solid #232a34;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#f4f7fb;">
  <div style="height:4px;background:linear-gradient(90deg,#2f81f7,#7fb4ff);"></div>
  <div style="padding:34px 34px 8px;">
    <div style="font-size:13px;font-weight:800;letter-spacing:3px;color:#ffb000;">INDIANXTRADE</div>
    <div style="margin-top:22px;font-size:30px;font-weight:800;line-height:1.1;color:#ffffff;">Reward Certificate</div>
    <div style="margin-top:6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#98a2b3;">Withdrawal confirmed</div>
  </div>
  <div style="padding:8px 34px 4px;">
    <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#98a2b3;">Proudly presented to</div>
    <div style="margin-top:4px;font-size:26px;font-weight:700;color:#ffffff;">${safeName}</div>
  </div>
  <div style="padding:18px 34px;">
    <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#98a2b3;">Rewards received</div>
    <div style="margin-top:2px;font-size:40px;font-weight:800;color:#2f81f7;">${safeAmount}</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #232a34;margin-top:8px;">
    <tr>
      <td style="padding:12px 0 30px 34px;vertical-align:top;">
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#5a6472;">Date</div>
        <div style="font-size:13px;color:#f4f7fb;">${safeDate}</div>
      </td>
      <td style="padding:12px 34px 30px 0;vertical-align:top;text-align:right;">
        <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#5a6472;">Reference</div>
        <div style="font-size:13px;color:#f4f7fb;">${safeRef}</div>
      </td>
    </tr>
  </table>
  <div style="padding:14px 34px;background:#0b0e13;font-size:11px;line-height:1.6;color:#5a6472;">
    ${CERTIFICATE_NOTE[stage]}
  </div>
</div>`.trim();
}
