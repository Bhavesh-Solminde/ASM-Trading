import { certificateHtml, type CertificateData } from "./certificate";
import { EMAIL_PALETTE, details, emailLayout, escapeHtml, greeting, p, siteUrl, type RenderedEmail } from "./layout";

export function withdrawalRequestedEmail(input: {
  name: string | null;
  amountLabel: string;
  payToLabel: string;
  /** First withdrawal inside the hold window: status HELD. */
  held: boolean;
  refId: string;
}): RenderedEmail {
  return {
    subject: "We've received your withdrawal request",
    html: emailLayout({
      preheader: `${input.amountLabel} to ${input.payToLabel}.`,
      heading: "Withdrawal requested",
      bodyHtml: [
        greeting(input.name),
        p(`We've received your request to withdraw ${input.amountLabel}.`),
        details([
          { label: "Amount", value: input.amountLabel },
          { label: "Pay to", value: input.payToLabel },
          { label: "Status", value: input.held ? "On security hold" : "Under review" },
          { label: "Reference", value: input.refId },
        ]),
        p(
          input.held
            ? "Your first withdrawal sits on a short security hold, then goes to review. You can cancel it from the Withdrawal page while the cancel window is open."
            : "Our team reviews it and sends the money within 5–10 hours.",
        ),
        p("We'll email your reward certificate as soon as it's paid."),
      ].join(""),
      cta: { label: "View withdrawal", url: siteUrl("/withdrawal") },
    }),
  };
}

export function withdrawalPaidEmail(input: {
  /** Greeting name; the certificate carries its own display name. */
  name: string | null;
  certificate: CertificateData;
  payToLabel: string;
  /** Content id of the rendered certificate image. Without one, the HTML certificate is used. */
  certificateImageCid?: string | undefined;
}): RenderedEmail {
  const c = input.certificate;
  if (input.certificateImageCid) {
    return {
      subject: "Your withdrawal is paid. Here's your certificate",
      html: certificateImageEmail(c, input.payToLabel, input.certificateImageCid),
    };
  }
  return {
    subject: "Your withdrawal is paid. Here's your certificate",
    html: emailLayout({
      preheader: `${c.amountLabel} is on its way to ${input.payToLabel}.`,
      heading: "Withdrawal paid",
      bodyHtml: [
        greeting(input.name),
        p(`We've sent ${c.amountLabel} to ${input.payToLabel}. Depending on your bank or network, it can take a little while to show up.`),
        `<div style="margin:4px 0 24px;">${certificateHtml(c, "paid", "adaptive")}</div>`,
      ].join(""),
    }),
  };
}

/**
 * The paid email as the certificate alone: one rendered image (the artwork
 * can't be built in email HTML), no text and no header card, by design. The
 * alt text carries the amount and date for readers with images off.
 */
function certificateImageEmail(c: CertificateData, payToLabel: string, cid: string): string {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const amount = escapeHtml(c.amountLabel);
  const alt = escapeHtml(`IndianxTrade reward certificate for ${c.name}: withdrawal of ${c.amountLabel} on ${c.dateLabel}`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reward certificate</title></head>
<body style="margin:0;padding:0;background:${EMAIL_PALETTE.light.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${amount} is on its way to ${escapeHtml(payToLabel)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_PALETTE.light.page};font-family:${font};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
<tr><td><img src="cid:${cid}" width="600" alt="${alt}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:6px;"></td></tr></table>
</td></tr></table>
</body></html>`;
}

export function withdrawalRejectedEmail(input: {
  name: string | null;
  amountLabel: string;
  reason: string;
  refId: string;
}): RenderedEmail {
  return {
    subject: "Your withdrawal couldn't be paid",
    html: emailLayout({
      preheader: `${input.amountLabel} is back in your balance.`,
      heading: "Withdrawal not completed",
      bodyHtml: [
        greeting(input.name),
        p(`We couldn't pay your withdrawal of ${input.amountLabel}.`),
        details([
          { label: "Reason", value: input.reason },
          { label: "Refunded", value: input.amountLabel },
          { label: "Reference", value: input.refId },
        ]),
        p("The full amount is back in your balance. Check your payout details and request the withdrawal again."),
      ].join(""),
      cta: { label: "Request again", url: siteUrl("/withdrawal") },
    }),
  };
}
