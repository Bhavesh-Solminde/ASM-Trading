import { emailLayout, greeting, linkLine, muted, p, type RenderedEmail } from "./layout";

/** Sent on affiliate signup and on resend. Doubles as the affiliate welcome, so no deposit-bonus copy. */
export function verifyEmailEmail(input: { name: string | null; verifyUrl: string; ttlHours: number }): RenderedEmail {
  return {
    subject: "Verify your IndianxTrade affiliate email",
    html: emailLayout({
      preheader: `Confirm your email to open your Affiliate dashboard. The link expires in ${input.ttlHours} hours.`,
      heading: "Verify your email",
      bodyHtml: [
        greeting(input.name),
        p("Your IndianxTrade affiliate account is ready. Confirm this email address to open your Affiliate dashboard."),
      ].join(""),
      cta: { label: "Verify email", url: input.verifyUrl },
      afterCtaHtml: [
        muted(`The link works once and expires in ${input.ttlHours} hours. Didn't sign up? Ignore this email.`),
        muted("Button not working? Paste this link into your browser:"),
        linkLine(input.verifyUrl),
      ].join(""),
    }),
  };
}
