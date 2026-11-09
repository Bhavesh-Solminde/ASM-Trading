import { isFinalStatus } from "./checkout-poll";
import type { PendingCheckout } from "./pending-checkout";

/** "mm:ss" left until `expiresAtMs`: a part second counts as the second still to run, so 00:00 means it has run out. Dashes when the time cannot be read. */
export function countdownText(expiresAtMs: number, nowMs: number): string {
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) return "--:--";
  const left = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  return `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
}

/**
 * Whether the "I've paid, add my UTR" link is out yet. The server asks the app to wait `delaySec` seconds so the
 * automatic match gets its chance first. The clock starts at `anchorMs` (see `claimAnchorMs`: the deposit's creation).
 * A delay that is not a usable number reveals the link at once: the way out must never be hidden by bad config.
 */
export function claimReveal(input: { anchorMs: number; nowMs: number; delaySec: number }): { revealed: boolean; remainingSec: number } {
  const { delaySec } = input;
  if (!Number.isFinite(delaySec) || delaySec <= 0) return { revealed: true, remainingSec: 0 };
  const elapsedSec = Math.max(0, Math.floor((input.nowMs - input.anchorMs) / 1000));
  const remainingSec = Math.max(0, delaySec - elapsedSec);
  return { revealed: remainingSec === 0, remainingSec };
}

/**
 * Where the claim delay counts from: the deposit's own creation time, as the website does, so reopening the screen or
 * a late cold start never restarts it. With no usable `createdAt` (an older server) it is the first time this screen
 * opened for the payment. Never later than that first open, so a phone clock that runs behind the server's cannot
 * hold the link back for longer than the first-open rule would.
 */
export function claimAnchorMs(input: { createdAt: string | null; firstOpenMs: number }): number {
  const created = input.createdAt ? Date.parse(input.createdAt) : Number.NaN;
  return Number.isFinite(created) ? Math.min(created, input.firstOpenMs) : input.firstOpenMs;
}

/** The claim route takes a UTR only for a payment still `AWAITING_PAYMENT` with none yet; the link is shown only then. */
export function claimLinkVisible(input: { status: string; claimedUtr: string | null; revealed: boolean }): boolean {
  return input.revealed && input.status === "AWAITING_PAYMENT" && input.claimedUtr === null;
}

/**
 * Whether the pay screen still offers ways to pay: the QR, the UPI ID and the "Open <App>" buttons. Only for an open
 * payment with no UTR sent. Once a UTR is claimed the money has been sent and one credit matches one deposit, so a
 * second payment could never be matched (support would have to refund it by hand): the screen stops inviting one.
 */
export function payInstrumentsVisible(input: { status: string; claimedUtr: string | null }): boolean {
  return input.status === "AWAITING_PAYMENT" && input.claimedUtr === null;
}

/** The i18n key of the status card's line for an open payment; null for a final status (the result screen takes over). */
export function statusLineKey(status: string): "pay.waiting" | "pay.gotUtr" | null {
  if (status === "AWAITING_PAYMENT") return "pay.waiting";
  if (status === "PENDING_CONFIRMATION") return "pay.gotUtr";
  return null;
}

/** When each payment's screen was first opened in this app run, so reopening it does not restart the claim delay. Bounded: oldest out. */
export function createAnchorStore(limit = 20): { anchorFor: (token: string, nowMs: number) => number } {
  const anchors = new Map<string, number>();
  return {
    anchorFor(token, nowMs) {
      const known = anchors.get(token);
      if (known !== undefined) return known;
      anchors.set(token, nowMs);
      if (anchors.size > limit) {
        const oldest = anchors.keys().next().value;
        if (oldest !== undefined) anchors.delete(oldest);
      }
      return nowMs;
    },
  };
}

/**
 * What to save as the pending checkout once the pay screen has loaded the payment: its real expiry and amount, so
 * Payments can show "Payment in progress · ₹x". Null means leave what is saved alone: a final payment (the caller
 * clears it), an unreadable expiry, or a different (newer) deposit's checkout that this screen must not overwrite.
 */
export function pendingFromView(input: {
  existing: PendingCheckout | null;
  token: string;
  view: { status: string; amountInr: number; expiresAt: string };
}): PendingCheckout | null {
  if (isFinalStatus(input.view.status)) return null;
  if (input.existing && input.existing.token !== input.token) return null;
  const expiresAt = Date.parse(input.view.expiresAt);
  if (!Number.isFinite(expiresAt)) return null;
  // A USDT deposit stores `amountInr` as minus its USDT cents: that is not rupees, so no amount is saved for it
  // (Payments takes the figure from the server's answer anyway).
  return { token: input.token, expiresAt, amountInr: input.view.amountInr > 0 ? input.view.amountInr : null };
}
