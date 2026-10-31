import { z } from "zod";
import { isFinalStatus } from "./checkout-poll";

/**
 * `GET /api/deposits/<checkout token>/status` (the website's USDT poller; it takes the app's Bearer, checks ownership
 * and allows 60 requests a minute): the deposit's status plus the on-chain transfer linked to it, if one was seen.
 * There is no contract schema for it, so this one is the app's and is deliberately permissive: every field may be
 * missing, null or of an unexpected type and falls back to "nothing known" instead of failing the poll, and unknown
 * fields are ignored. The route returns no confirmation count, so there is no "n of m"; the states below are all it
 * can tell.
 */
export const UsdtChainStatusSchema = z.object({
  status: z.string().nullish().catch(null),
  chainCredit: z
    .object({
      finalityState: z.string().nullish().catch(null),
      processingStatus: z.string().nullish().catch(null),
    })
    .nullish()
    .catch(null),
});
export type UsdtChainStatus = z.infer<typeof UsdtChainStatusSchema>;

export type UsdtProgressKind = "waiting" | "detected" | "final" | "review" | "dismissed" | "failed";

/** `done` of the three steps (Detected, Confirmed, Credited) that are behind the payment; `detected` is true once a transfer was seen. */
export interface UsdtProgress {
  kind: UsdtProgressKind;
  done: 0 | 1 | 2;
  detected: boolean;
}

/**
 * Where a USDT payment is on-chain, by the website's own precedence (UsdtStatusPoller): no transfer seen is "waiting";
 * a failed or reorged transfer is "failed" whatever else is said; then the team's decisions ("dismissed", "review");
 * then a final transfer ("final", crediting); otherwise it is seen and still confirming ("detected").
 */
export function usdtProgress(data: UsdtChainStatus | null | undefined): UsdtProgress {
  const credit = data?.chainCredit;
  if (!credit) return { kind: "waiting", done: 0, detected: false };
  if (credit.finalityState === "FAILED_ON_CHAIN" || credit.finalityState === "REORGED") return { kind: "failed", done: 1, detected: true };
  if (credit.processingStatus === "DISMISSED") return { kind: "dismissed", done: 2, detected: true };
  if (credit.processingStatus === "MANUAL_REVIEW" || credit.processingStatus === "UNMATCHED") return { kind: "review", done: 2, detected: true };
  if (credit.finalityState === "FINAL") return { kind: "final", done: 2, detected: true };
  return { kind: "detected", done: 1, detected: true };
}

/** The status line's i18n key for a state; null for "waiting" (the screen's own waiting line stays). */
export function usdtProgressKey(kind: UsdtProgressKind): "usdt.progress.detected" | "usdt.progress.final" | "usdt.progress.review" | "usdt.progress.dismissed" | "usdt.progress.failed" | null {
  return kind === "waiting" ? null : (`usdt.progress.${kind}` as const);
}

/** Whether to ask the status route at all: only for a USDT payment whose checkout is still open (a UPI one has no chain, a final one needs no progress). */
export function usdtProgressWanted(input: { method: string | undefined; checkoutStatus: string | undefined }): boolean {
  return input.method === "USDT" && input.checkoutStatus !== undefined && !isFinalStatus(input.checkoutStatus);
}

/** A transfer the deadline does not concern: seen, and not failed. A failed or reorged one is not coming (the window is open only for a resend). */
function seenAndAlive(progress: UsdtProgress): boolean {
  return progress.detected && progress.kind !== "failed";
}

/**
 * Whether an open USDT payment's window is over with nothing on its way, so the screen must stop inviting a payment.
 * The server keeps a manual or slot deposit AWAITING_PAYMENT for up to 48 h after `expiresAt` (a gateway one 2 h), and a
 * slot address goes to another user 2 minutes after it, so a late transfer can be credited to someone else. The
 * website walks away from the page at the deadline for the same reason. A transfer that was seen (and has not failed)
 * is never ended by the clock; a failed one counts as nothing detected. An unreadable deadline or clock is "not lapsed".
 */
export function usdtLapsed(input: { expiresAt: string; nowMs: number; progress: UsdtProgress }): boolean {
  const deadline = Date.parse(input.expiresAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(input.nowMs)) return false;
  return input.nowMs >= deadline && !seenAndAlive(input.progress);
}

/** `setTimeout` takes a signed 32-bit delay; a larger one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

export type UsdtDeadlineStep = { kind: "none" } | { kind: "check" } | { kind: "arm"; delayMs: number };

/**
 * What the deadline watcher does now: nothing (switched off, or no readable deadline); the deadline is already past, so
 * make the last status check at once (the app was in the background, or was just opened late); or arm a single timer
 * for the time left. The watcher runs again when the deadline changes or it is switched on again.
 */
export function usdtDeadlineStep(input: { expiresAt: string; nowMs: number; enabled: boolean }): UsdtDeadlineStep {
  const deadline = Date.parse(input.expiresAt);
  if (!input.enabled || !Number.isFinite(deadline) || !Number.isFinite(input.nowMs)) return { kind: "none" };
  if (input.nowMs >= deadline) return { kind: "check" };
  return { kind: "arm", delayMs: Math.min(deadline - input.nowMs, MAX_TIMER_MS) };
}

/** The header clock stays until a transfer is seen and alive; a failed transfer keeps it, because the window is still open for a resend. */
export function usdtClockShown(progress: UsdtProgress): boolean {
  return !seenAndAlive(progress);
}

/** Where the status line itself points at the team ("contact support", "with our team", "will not be credited"), the screen offers the way there. */
export function usdtShowsSupport(kind: UsdtProgressKind): boolean {
  return kind === "dismissed" || kind === "review" || kind === "failed";
}
