import { SUPPORT_EMAIL, emailLayout, linkLine, muted, p, type RenderedEmail } from "./layout";

export function passwordResetEmail(input: { name: string; resetUrl: string; ttlMinutes: number }): RenderedEmail {
  return {
    subject: "Reset your IndianxTrade password",
    html: emailLayout({
      preheader: `This link works once and expires in ${input.ttlMinutes} minutes.`,
      heading: "Reset your password",
      bodyHtml: [
        p(`Hi ${input.name}, we got a request to reset the password on your IndianxTrade account.`),
        p(`Tap the button to choose a new one. The link works once and expires in ${input.ttlMinutes} minutes.`),
      ].join(""),
      cta: { label: "Set a new password", url: input.resetUrl },
      afterCtaHtml: [
        muted("Button not working? Paste this link into your browser:"),
        linkLine(input.resetUrl),
        muted("Didn't ask for this? Ignore this email. Your password stays the same."),
      ].join(""),
    }),
  };
}

export function passwordChangedEmail(input: { name: string; changedAtLabel: string; resetUrl: string }): RenderedEmail {
  return {
    subject: "Your IndianxTrade password was changed",
    html: emailLayout({
      preheader: "We signed you out on every device.",
      heading: "Password changed",
      bodyHtml: [
        p(`Hi ${input.name}, the password on your IndianxTrade account was changed on ${input.changedAtLabel}.`),
        p("For your security we signed you out on every device. Log in again with your new password."),
        p(`Wasn't you? Reset your password right away and write to ${SUPPORT_EMAIL}.`),
      ].join(""),
      cta: { label: "Reset password", url: input.resetUrl },
    }),
  };
}
