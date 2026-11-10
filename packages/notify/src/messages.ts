import { formatMinor } from "@asm/client-core";
import type { OutboxKind } from "@asm/db";

export type Channel = "trades" | "payments" | "account";
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  channel: Channel;
}
type Locale = "en" | "hi";

const S = {
  en: {
    depositTitle: "Deposit credited",
    deposit: (a: string, b: string | null) => `${a} added to your balance${b ? ` (+${b} bonus)` : ""}`,
    approvedTitle: "Withdrawal approved",
    approved: (a: string) => `Your withdrawal of ${a} is approved and on its way`,
    paidTitle: "Withdrawal paid",
    paid: (a: string, m: string) => `${a} paid to your ${m}`,
    rejectedTitle: "Withdrawal rejected",
    rejected: (a: string, r: string) => `Your withdrawal of ${a} was rejected: ${r}. The amount is back in your balance.`,
    kycOkTitle: "Identity verified",
    kycOk: "Withdrawals are unlocked.",
    kycNoTitle: "KYC needs another look",
    kycNo: (r: string | null) => (r ? `Reason: ${r}` : "Open the app to see what to fix."),
    tradesTitle: "Trades closed",
    one: (pair: string, won: boolean, a: string) => `${pair} trade ${won ? "won" : "lost"} ${won ? "+" : ""}${a}`,
    many: (n: number, net: string) => `${n} trades closed: ${net}`,
    flat: (pair: string, amount: string) => `${pair} trade closed: ${amount}`,
  },
  hi: {
    depositTitle: "जमा हो गया",
    deposit: (a: string, b: string | null) => `${a} आपके बैलेंस में जोड़ दिए गए${b ? ` (+${b} बोनस)` : ""}`,
    approvedTitle: "निकासी मंज़ूर",
    approved: (a: string) => `${a} की आपकी निकासी मंज़ूर हो गई है`,
    paidTitle: "निकासी भेज दी गई",
    paid: (a: string, m: string) => `${a} आपके ${m} पर भेज दिए गए`,
    rejectedTitle: "निकासी अस्वीकार",
    rejected: (a: string, r: string) => `${a} की निकासी अस्वीकार हुई: ${r}। राशि आपके बैलेंस में वापस है।`,
    kycOkTitle: "पहचान सत्यापित",
    kycOk: "अब आप निकासी कर सकते हैं।",
    kycNoTitle: "KYC दोबारा जाँचें",
    kycNo: (r: string | null) => (r ? `कारण: ${r}` : "क्या ठीक करना है, यह ऐप में देखें।"),
    tradesTitle: "ट्रेड बंद हुए",
    one: (pair: string, won: boolean, a: string) => `${pair} ट्रेड ${won ? "जीता" : "हारा"} ${won ? "+" : ""}${a}`,
    many: (n: number, net: string) => `${n} ट्रेड बंद: ${net}`,
    flat: (pair: string, amount: string) => `${pair} ट्रेड बंद: ${amount}`,
  },
} as const;

const METHOD = { en: { UPI: "UPI", BANK: "bank account", USDT: "USDT wallet" }, hi: { UPI: "UPI", BANK: "बैंक खाते", USDT: "USDT वॉलेट" } } as const;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const pair = (symbol: string) => (symbol.length === 6 ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol);

export function channelFor(kind: OutboxKind): Channel {
  return kind.startsWith("kyc_") ? "account" : "payments";
}

export function outboxMessage(kind: OutboxKind, p: Record<string, unknown>, locale: Locale): PushMessage {
  const s = S[locale];
  const money = (k: string) => formatMinor(num(p[k]), str(p.currency) || "INR");
  switch (kind) {
    case "deposit_credited":
      return {
        title: s.depositTitle,
        body: s.deposit(money("amountMinor"), num(p.bonusMinor) > 0 ? money("bonusMinor") : null),
        url: `/history?tx=d:${str(p.depositId)}`,
        channel: "payments",
      };
    case "withdrawal_approved":
      return { title: s.approvedTitle, body: s.approved(money("amountMinor")), url: `/history?tx=w:${str(p.withdrawalId)}`, channel: "payments" };
    case "withdrawal_paid":
      return {
        title: s.paidTitle,
        body: s.paid(money("amountMinor"), (METHOD[locale] as Record<string, string>)[str(p.method)] ?? str(p.method)),
        url: `/history?tx=w:${str(p.withdrawalId)}`,
        channel: "payments",
      };
    case "withdrawal_rejected":
      return {
        title: s.rejectedTitle,
        body: s.rejected(money("amountMinor"), str(p.reason) || "—"),
        url: `/history?tx=w:${str(p.withdrawalId)}`,
        channel: "payments",
      };
    case "kyc_verified":
      return { title: s.kycOkTitle, body: s.kycOk, url: "/account/verify", channel: "account" };
    case "kyc_rejected":
      return { title: s.kycNoTitle, body: s.kycNo(str(p.note) || null), url: "/account/verify", channel: "account" };
  }
}

export function tradeResultsMessage(
  results: { symbol: string; pnl: number; stake: number; currency: string; displayName?: string }[],
  locale: Locale,
): PushMessage {
  const s = S[locale];
  const currency = results[0]?.currency ?? "INR";
  if (results.length === 1) {
    const r = results[0]!;
    const won = r.pnl > 0;
    return { title: s.tradesTitle, body: r.pnl === 0 ? s.flat(r.displayName ?? pair(r.symbol), formatMinor(0, currency)) : s.one(r.displayName ?? pair(r.symbol), won, formatMinor(Math.abs(r.pnl), currency)), url: "/history", channel: "trades" };
  }
  const totals = new Map<string, number>();
  for (const result of results) totals.set(result.currency, (totals.get(result.currency) ?? 0) + result.pnl);
  const netText = [...totals].map(([unit, net]) => `${net >= 0 ? "+" : "−"}${formatMinor(Math.abs(net), unit)}`).join(" · ");
  return { title: s.tradesTitle, body: s.many(results.length, netText), url: "/history", channel: "trades" };
}
