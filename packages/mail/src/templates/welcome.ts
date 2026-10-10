import { emailLayout, p, siteUrl, type RenderedEmail } from "./layout";

export function welcomeEmail(input: { name: string; firstDepositBonusPercent: number }): RenderedEmail {
  const pct = input.firstDepositBonusPercent;
  // Bonus copy follows the marketing posture: "Bonus", no wagering wording.
  const bonusLine =
    pct >= 100
      ? p(`When you're ready for LIVE trading, make your first deposit and get a ${pct}% bonus on it. Double your trading power.`)
      : pct > 0
        ? p(`When you're ready for LIVE trading, make your first deposit and get a ${pct}% bonus on it.`)
        : p("When you're ready, make a deposit to start trading LIVE.");
  return {
    subject: "Welcome to IndianxTrade",
    html: emailLayout({
      preheader: "Your account is ready. Start with the DEMO account.",
      heading: "Welcome to IndianxTrade",
      bodyHtml: [
        p(`Hi ${input.name}, your IndianxTrade account is ready.`),
        p("Your DEMO account comes loaded with practice money, so you can learn the platform without risking a rupee."),
        bonusLine,
      ].join(""),
      cta: { label: "Start trading", url: siteUrl("/trade") },
    }),
  };
}
