import { certificateHtml, type CertificateData } from "./certificate";
import { details, emailLayout, greeting, p, siteUrl, type RenderedEmail } from "./layout";

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
}): RenderedEmail {
  const c = input.certificate;
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
