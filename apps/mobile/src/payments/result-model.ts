import { money } from "@/money/format";
import { usdtClaimEntry } from "./usdt-claim";
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
 * if it was already sent, so the note says not to pay again; a USDT gateway deposit is credited by itself. No UTR
 * claim link here (that route takes only an open UPI payment); an expired USDT deposit's own link is `endedUsdtLink`.
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

/** The amount in the pay screen's title: "₹1,930" for UPI, "20.00 USDT" for USDT (whose server-side rupee figure is negative). */
export function payTitleAmount(view: { method: string; amountInr: number; amountUsdtMinor: number | null }): string {
  if (view.method === "USDT") {
    const asked = requestedAmount(view);
    return amountText(asked.minor, asked.currency);
  }
  return money(view.amountInr, "INR", { trim: true });
}

/**
 * The extra way out on an expired USDT deposit, from the website's expired page: a manual (shared-address) one can
 * still be claimed with its transaction hash ("claim"); a gateway one lands in review by itself, so the user is sent
 * to support with their hash ("support"). Nothing for a rejected, credited or UPI payment: the server takes no
 * claim on them.
 */
export function endedUsdtLink(view: { method: string; isGateway: boolean; status: string }): "claim" | "support" | null {
  if (view.method !== "USDT" || view.status !== "EXPIRED") return null;
  return usdtClaimEntry(view) ? "claim" : "support";
}
