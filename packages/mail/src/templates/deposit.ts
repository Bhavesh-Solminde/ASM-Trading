import { details, emailLayout, p, siteUrl, type EmailDetail, type RenderedEmail } from "./layout";

export function depositCreditedEmail(input: {
  name: string;
  creditLabel: string;
  /** Null when this deposit earned no bonus (5th deposit onwards). */
  bonusLabel: string | null;
  totalLabel: string;
  dateLabel: string;
  refId: string;
}): RenderedEmail {
  const rows: EmailDetail[] = [{ label: "Deposit", value: input.creditLabel }];
  if (input.bonusLabel) {
    rows.push({ label: "Bonus", value: input.bonusLabel }, { label: "You can trade with", value: input.totalLabel });
  }
  rows.push({ label: "Date", value: input.dateLabel }, { label: "Reference", value: input.refId });
  return {
    subject: `${input.creditLabel} added to your IndianxTrade account`,
    html: emailLayout({
      preheader: input.bonusLabel
        ? `Bonus ${input.bonusLabel} added too. Trade with ${input.totalLabel}.`
        : "Your money is in your LIVE account.",
      heading: "Deposit credited",
      bodyHtml: [p(`Hi ${input.name}, your deposit is in your LIVE account and ready to trade.`), details(rows)].join(""),
      cta: { label: "Start trading", url: siteUrl("/trade") },
    }),
  };
}
