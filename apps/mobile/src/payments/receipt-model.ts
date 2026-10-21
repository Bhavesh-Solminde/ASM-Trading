import { referenceFor } from "@asm/client-core";
import type { CheckoutView } from "@asm/contracts";
import { money } from "@/money/format";
import { brandKey } from "./method-key";
import { amountText, requestedAmount } from "./result-model";

/** The part of the checkout view a receipt reads. */
export type ReceiptSource = Pick<CheckoutView, "id" | "method" | "amountInr" | "amountUsdtMinor" | "creditedAt" | "creditedMinor" | "creditedCurrency" | "bonusMinor" | "balanceAfterMinor" | "utr">;

export interface ReceiptModel {
  /** What reached the account, in `currency`; the INR asked for only when an older server sent no credit. */
  amountMinor: number;
  currency: string;
  /** Null unless the bonus is above zero: gold is for a real bonus only. */
  bonusMinor: number | null;
  /** The account's balance right after the credit, in `currency`; null when the server did not say. */
  balanceAfterMinor: number | null;
  method: string;
  /** "DP-1A2B3C4D", the same reference History and the website quote. */
  reference: string;
  utr: string | null;
  /** "14 Oct 2026, 18:22" in the phone's time zone; null when unknown. */
  dateText: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * "dd Mon yyyy, HH:MM", shifted by `tzOffsetMin` minutes east of UTC (IST is 330). English month names and ASCII
 * digits on purpose: the cell is set in the figure face, which has no Devanagari. Null for a time that cannot be read.
 */
export function receiptDate(iso: string | null, tzOffsetMin: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + tzOffsetMin * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The method as the receipt names it: "PhonePe UPI". Brand names are not translated. */
export function methodLabel(method: string): string {
  switch (brandKey(method)) {
    case "PhonePe":
      return "PhonePe UPI";
    case "Gpay":
      return "Google Pay UPI";
    case "PayTM":
      return "Paytm UPI";
    case "UPI":
      return "UPI";
    case "USDT":
      return "USDT";
    default:
      return method;
  }
}

export function receiptModel(view: ReceiptSource, opts: { tzOffsetMin: number }): ReceiptModel {
  const credited = view.creditedMinor !== null && view.creditedCurrency !== null;
  const utr = view.utr?.trim() ?? "";
  const asked = requestedAmount(view);
  return {
    amountMinor: credited ? view.creditedMinor! : asked.minor,
    currency: credited ? view.creditedCurrency! : asked.currency,
    bonusMinor: view.bonusMinor !== null && view.bonusMinor > 0 ? view.bonusMinor : null,
    balanceAfterMinor: view.balanceAfterMinor,
    method: methodLabel(view.method),
    reference: referenceFor({ kind: "deposit", id: view.id }),
    utr: utr === "" ? null : utr,
    dateText: receiptDate(view.creditedAt, opts.tzOffsetMin),
  };
}

export interface ShareLabels {
  title: string;
  amount: string;
  bonus: string;
  method: string;
  utr: string;
  date: string;
  reference: string;
}

/** The text "Share receipt" hands to the system share sheet: plain lines, only what is known. Amounts go through `money()`. */
export function receiptShareText(model: ReceiptModel, labels: ShareLabels): string {
  const lines = [labels.title, `${labels.amount}: ${amountText(model.amountMinor, model.currency)}`];
  if (model.bonusMinor !== null) lines.push(`${labels.bonus}: +${money(model.bonusMinor, model.currency)}`);
  lines.push(`${labels.method}: ${model.method}`);
  if (model.utr !== null) lines.push(`${labels.utr}: ${model.utr}`);
  if (model.dateText !== null) lines.push(`${labels.date}: ${model.dateText}`);
  lines.push(`${labels.reference}: ${model.reference}`);
  return lines.join("\n");
}
