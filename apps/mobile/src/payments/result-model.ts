import { money } from "@/money/format";
/** Which frame the pay screen draws for a checkout status. */
export type PayScreen = "pay" | "pending" | "receipt" | "ended";

/**
 * AWAITING_PAYMENT is the way to pay; PENDING_CONFIRMATION is "checking your payment" (the UTR is in); COMPLETED is the
 * receipt, and only COMPLETED ever is; REJECTED and EXPIRED are the ended frame. A status this app has never seen
 * stays on the pay screen rather than guess a success.
 */
export function payScreenFor(status: string): PayScreen {
  switch (status) {
    case "PENDING_CONFIRMATION":
      return "pending";
    case "COMPLETED":
      return "receipt";
    case "REJECTED":
    case "EXPIRED":
      return "ended";
    default:
      return "pay";
  }
}

/**
 * The i18n key of the ended frame's note, from the web deposit page's copy. An expired payment may still be credited
 * if it was already sent, so the note says not to pay again; a USDT gateway deposit is credited by itself. No claim
 * link here: the claim route takes only an open UPI payment, and the USDT transaction claim is T4's.
 */
export function endedNoteKey(input: { status: string; isGateway: boolean }): "pay.ended.rejected" | "pay.ended.expired" | "pay.ended.expiredGateway" {
  if (input.status === "REJECTED") return "pay.ended.rejected";
  return input.isGateway ? "pay.ended.expiredGateway" : "pay.ended.expired";
}

/** A rejection can be taken to support; an expired payment has nothing to appeal. */
export function showsSupportLink(status: string): boolean {
  return status === "REJECTED";
}

/**
 * The amount a deposit asked for, in its own unit. A USDT deposit stores `amountInr` as minus its USDT cents (the
 * server's convention), so it is shown in USDT, never as a negative rupee figure.
 */
export function requestedAmount(view: { method: string; amountInr: number; amountUsdtMinor: number | null }): { minor: number; currency: string } {
  if (view.method === "USDT") return { minor: view.amountUsdtMinor ?? Math.abs(view.amountInr), currency: "USDT" };
  return { minor: view.amountInr, currency: "INR" };
}

/** `money()` with the unit spelled out for USDT, which has no symbol. */
export function amountText(minor: number, currency: string): string {
  return currency === "USDT" ? `${money(minor, "USDT")} USDT` : money(minor, currency);
}
