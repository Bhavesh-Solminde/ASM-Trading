import { isFinalStatus } from "./checkout-poll";
import type { PendingCheckout } from "./pending-checkout";
import { requestedAmount } from "./result-model";

/** How many recent payments the Payments tab previews before "See all". */
export const RECENT_LIMIT = 5;

interface LiveAccount {
  id: string;
  currency: string;
  realBalance: number;
  bonusBalance: number;
}

export interface HubBalances {
  currency: string;
  /** Real plus bonus: the figure at the top of the tab. */
  totalMinor: number;
  /** `null` until the wallet's own figure has arrived. */
  withdrawableMinor: number | null;
  bonusMinor: number;
}

/**
 * The Payments tab's figures. The total follows the socket's balance for the live account (it moves with every
 * trade), falling back to the wallet's. Withdrawable is the wallet's server-computed figure, capped at the real
 * balance the socket reports so a loss never leaves it showing money that is gone.
 */
export function hubBalances(input: {
  live: LiveAccount | undefined;
  socket: { realBalance: number; bonusBalance: number } | undefined;
  withdrawable: number | undefined;
  lockedBonus: number | undefined;
}): HubBalances | null {
  const { live, socket } = input;
  if (!live) return null;
  const real = socket?.realBalance ?? live.realBalance;
  const bonus = socket?.bonusBalance ?? input.lockedBonus ?? live.bonusBalance;
  const total = socket ? socket.realBalance + socket.bonusBalance : live.realBalance + live.bonusBalance;
  const withdrawable = input.withdrawable === undefined ? null : socket ? Math.min(input.withdrawable, real) : input.withdrawable;
  return { currency: live.currency, totalMinor: total, withdrawableMinor: withdrawable, bonusMinor: bonus };
}

/** The "next step" card is for people who have not started verification or were rejected; in review and verified hide it. */
export function showKycNextStep(status: string | undefined): boolean {
  return status === "NOT_STARTED" || status === "REJECTED";
}

/** A saved checkout whose known expiry has passed: nothing to continue, so Payments clears it. An unknown expiry is not stale. */
export function pendingIsStale(pending: PendingCheckout | null, nowMs: number): boolean {
  return !!pending && pending.expiresAt !== null && nowMs >= pending.expiresAt;
}

/**
 * The "Payment in progress / Continue" row on Payments: the saved checkout while it can still be paid. The amount is
 * null until the pay screen has loaded the checkout once (the row then shows without one rather than guessing).
 */
export function pendingPaymentRow(pending: Pick<PendingCheckout, "token" | "expiresAt" | "amountInr"> | null, nowMs: number): { token: string; amountInr: number | null } | null {
  if (!pending || pendingIsStale(pending, nowMs)) return null;
  return { token: pending.token, amountInr: pending.amountInr };
}

/** The part of the checkout answer the Payments row needs. */
interface CheckoutAnswer {
  status: string;
  method: string;
  amountInr: number;
  /** USDT cents; null or absent from an older server. */
  amountUsdtMinor?: number | null;
  expiresAt: string;
}

/** What the "Payment in progress" row shows: the token to open, the amount in its own unit (rupees, or USDT cents for USDT), and when it ends. */
export interface PendingRow {
  token: string;
  /** Paise, for a UPI payment; null for USDT and while unknown. */
  amountInr: number | null;
  /** USDT cents, for a USDT payment; null otherwise. */
  usdtMinor: number | null;
  expiresAt: number | null;
}

/**
 * Whether the "Payment in progress" row shows, and whether the saved checkout should be forgotten, from the saved
 * entry and what the server says about it (one non-polling read per Payments focus).
 *
 * The row shows only for a checkout the server confirms is still open and payable in the app, so it never leads to a
 * payment that has already ended. The server's amount and expiry win over the saved ones (an entry saved before the
 * pay screen loaded has neither). Forget it (`clear`) on a final status, a 404, or an expiry that has passed (the
 * saved one, or the server's for an entry saved without one). Not knowing yet (loading, offline, 5xx) hides the row
 * and keeps the entry: that is not an ending. A USDT checkout shows like a UPI one, in USDT: the server stores its
 * `amountInr` as minus its USDT cents, which is never offered as rupees.
 */
export function pendingRowDecision(input: {
  pending: PendingCheckout | null;
  nowMs: number;
  view: CheckoutAnswer | null;
  errorStatus: number | null;
}): { row: PendingRow | null; clear: boolean } {
  const { pending, nowMs, view } = input;
  const none = { row: null, clear: false };
  if (!pending) return none;
  if (pendingIsStale(pending, nowMs) || input.errorStatus === 404) return { row: null, clear: true };
  if (!view) return none;
  if (isFinalStatus(view.status)) return { row: null, clear: true };
  const expiresAt = Date.parse(view.expiresAt);
  if (!Number.isFinite(expiresAt)) return none;
  if (nowMs >= expiresAt) return { row: null, clear: true };
  if (view.method === "USDT") {
    const asked = requestedAmount({ method: view.method, amountInr: view.amountInr, amountUsdtMinor: view.amountUsdtMinor ?? null });
    return { row: { token: pending.token, amountInr: null, usdtMinor: asked.minor, expiresAt }, clear: false };
  }
  return { row: { token: pending.token, amountInr: view.amountInr, usdtMinor: null, expiresAt }, clear: false };
}
