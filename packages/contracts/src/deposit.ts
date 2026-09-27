import { z } from "zod";

/**
 * The UPI-rail methods. All route to the same simulated UPI collection
 * identity — the label is cosmetic fidelity, not a separate rail.
 */
export const UPI_METHODS = ["PhonePe", "UPI", "PayTM", "UPI Intent"] as const;

/** Every method the deposit screen offers — UPI rails plus the on-chain USDT rail. */
export const DEPOSIT_METHODS = [...UPI_METHODS, "USDT"] as const;

/**
 * Strict. A request carrying vpa, checkoutToken or status is rejected — those
 * are server-determined. A discriminated union on `method` since the two
 * rails take a different amount field/currency: UPI deposits are INR minor
 * units (paise), USDT deposits are USDT-cents (2dp — see packages/db's
 * usdt-money.ts for why the app ledger uses cents rather than the token's
 * native 6dp). Bounds for both are enforced again server-side.
 */
export const CreateDepositSchema = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.enum(UPI_METHODS),
    /** Minor units (paise). Bounds are enforced again server-side. */
    amountInr: z.number().int().positive().max(1_000_000_000),
  }),
  z.strictObject({
    method: z.literal("USDT"),
    /** USDT-cents (2dp). Bounds are enforced again server-side. */
    amountUsdtMinor: z.number().int().positive().max(1_000_000_000),
  }),
]);
export type CreateDepositInput = z.infer<typeof CreateDepositSchema>;

/**
 * The self-declared payment reference. A UTR proves nothing on its own — it is
 * a claim and a tiebreaker, never the match key — so this only shapes it, and
 * rejects an injected depositId (ownership comes from the session and the path).
 */
// The screenshot lives on Cloudinary; we store only its secure_url. Restrict
// to Cloudinary hosts so a rogue client cannot substitute an arbitrary URL
// that the admin panel would then render inline.
export const ScreenshotUrlSchema = z
  .string()
  .url()
  .max(500, "Screenshot URL is too long.")
  .regex(
    /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\//,
    "Screenshot URL must come from Cloudinary.",
  );

export const ClaimUtrSchema = z.strictObject({
  utr: z
    .string()
    .trim()
    .regex(/^[0-9]{9,22}$/, "Enter the numeric reference from your payment app"),
  screenshotUrl: ScreenshotUrlSchema.optional(),
});
export type ClaimUtrInput = z.infer<typeof ClaimUtrSchema>;

/**
 * USDT "I already paid": the TRON transaction hash the user says paid their
 * deposit. A tx hash is public on-chain, so this is evidence for an admin
 * only — it never credits and never feeds the matcher. Accepts an optional 0x
 * prefix and either case; normalized to 64 lowercase hex chars.
 */
export const ClaimUsdtPaymentSchema = z.strictObject({
  txHash: z
    .string()
    .trim()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, "Paste the 64-character transaction hash from your wallet")
    .transform((h) => h.replace(/^0x/, "").toLowerCase()),
  screenshotUrl: ScreenshotUrlSchema.optional(),
});
export type ClaimUsdtPaymentInput = z.infer<typeof ClaimUsdtPaymentSchema>;

export interface DepositView {
  id: string;
  method: string;
  amountUsd: number;
  amountInr: number;
  /** USDT-cents. Null for a non-USDT deposit. */
  amountUsdtMinor: number | null;
  /** e.g. "tron". Null for a non-USDT deposit. */
  network: string | null;
  status: string;
  claimedUtr: string | null;
  /** USDT only: the tx hash the user claimed paid this deposit (evidence, not a match). */
  claimedTxHash: string | null;
  createdAt: number;
}
