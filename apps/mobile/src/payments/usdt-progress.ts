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
