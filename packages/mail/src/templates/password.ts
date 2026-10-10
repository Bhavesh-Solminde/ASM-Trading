import { SUPPORT_EMAIL, emailLayout, greeting, linkLine, muted, p, type RenderedEmail } from "./layout";

export function passwordResetEmail(input: { name: string | null; resetUrl: string; ttlMinutes: number }): RenderedEmail {
  return {
    subject: "Reset your IndianxTrade password",
    html: emailLayout({
      preheader: `This link works once and expires in ${input.ttlMinutes} minutes.`,
      heading: "Reset your password",
      bodyHtml: [
        greeting(input.name),
        p("We got a request to reset the password on your IndianxTrade account. Tap the button to choose a new one."),
      ].join(""),
      cta: { label: "Set a new password", url: input.resetUrl },
      afterCtaHtml: [
        muted(`The link works once and expires in ${input.ttlMinutes} minutes. Didn't ask for this? Ignore this email. Your password stays the same.`),
        muted("Button not working? Paste this link into your browser:"),
        linkLine(input.resetUrl),
      ].join(""),
    }),
  };
}

export function passwordChangedEmail(input: { name: string | null; changedAtLabel: string; resetUrl: string }): RenderedEmail {
  return {
    subject: "Your IndianxTrade password was changed",
    html: emailLayout({
      preheader: "We signed you out on every device.",
      heading: "Your password was changed",
      bodyHtml: [
        greeting(input.name),
        p(`The password on your IndianxTrade account was changed on ${input.changedAtLabel}. For your security we signed you out on every device.`),
        p(`Wasn't you? Reset your password right away and write to ${SUPPORT_EMAIL}.`),
      ].join(""),
      cta: { label: "Reset password", url: input.resetUrl },
    }),
  };
}
