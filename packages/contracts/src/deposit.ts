import { z } from "zod";

/**
 * The methods a user can pick on the deposit screen. All route to the same
 * simulated UPI collection identity — the label is cosmetic fidelity, not a
 * separate rail.
 */
export const DEPOSIT_METHODS = ["PhonePe", "UPI", "PayTM", "UPI Intent"] as const;

/**
 * Strict. A request carrying amountInr, vpa, checkoutToken or status is
 * rejected — all of those are server-determined, and an attempt to supply
 * them is worth a validation log rather than a silent drop.
 */
export const CreateDepositSchema = z.strictObject({
  method: z.enum(DEPOSIT_METHODS),
  /** Minor units (US cents). Bounds are enforced again server-side. */
  amountUsd: z.number().int().positive().max(100_000_000),
});
export type CreateDepositInput = z.infer<typeof CreateDepositSchema>;

/**
 * The self-declared payment reference. A UTR proves nothing on its own — it is
 * a claim and a tiebreaker, never the match key — so this only shapes it, and
 * rejects an injected depositId (ownership comes from the session and the path).
 */
export const ClaimUtrSchema = z.strictObject({
  utr: z
    .string()
    .trim()
    .regex(/^[0-9]{9,22}$/, "Enter the numeric reference from your payment app"),
});
export type ClaimUtrInput = z.infer<typeof ClaimUtrSchema>;

export interface DepositView {
  id: string;
  method: string;
  amountUsd: number;
  amountInr: number;
  status: string;
  claimedUtr: string | null;
  createdAt: number;
}
