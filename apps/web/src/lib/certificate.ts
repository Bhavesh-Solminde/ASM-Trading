/**
 * Withdrawal reward certificate — a single inline-styled HTML string used both
 * for the Resend email body and the in-app success screen (rendered via
 * dangerouslySetInnerHTML), so email and web never drift. Styles are inline and
 * table/div-based to survive email clients; colours follow the app's
 * black + blue + white theme with the gold ASM wordmark.
 */

export interface CertificateData {
  name: string;
  amountLabel: string;
  dateLabel: string;
  refId: string;
}

/** A display name for the certificate: full name, else nickname, else the email local part. */
export function certificateName(profile: {
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  email: string;
}): string {
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (profile.nickname && profile.nickname.trim()) return profile.nickname.trim();
  return profile.email.split("@")[0] ?? "Trader";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function certificateHtml({ name, amountLabel, dateLabel, refId }: CertificateData): string {
  const safeName = escapeHtml(name);
  const safeAmount = escapeHtml(amountLabel);
  const safeDate = escapeHtml(dateLabel);
  const safeRef = escapeHtml(refId);
  return `
<div style="max-width:600px;margin:0 auto;background:#05070b;border:1px solid #232a34;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#f4f7fb;">
  <div style="height:4px;background:linear-gradient(90deg,#2f81f7,#7fb4ff);"></div>
  <div style="padding:34px 34px 8px;">
    <div style="font-size:13px;font-weight:800;letter-spacing:3px;color:#ffb000;">ASM&nbsp;TRADE</div>
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
  <div style="padding:6px 34px 30px;border-top:1px solid #232a34;margin-top:8px;display:flex;justify-content:space-between;">
    <div>
      <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#5a6472;">Date</div>
      <div style="font-size:13px;color:#f4f7fb;">${safeDate}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#5a6472;">Reference</div>
      <div style="font-size:13px;color:#f4f7fb;">${safeRef}</div>
    </div>
  </div>
  <div style="padding:14px 34px;background:#0b0e13;font-size:11px;line-height:1.6;color:#5a6472;">
    This certificate confirms a withdrawal request on ASM Trade. Requests are processed within
    3 business days to your original deposit method.
  </div>
</div>`.trim();
}
