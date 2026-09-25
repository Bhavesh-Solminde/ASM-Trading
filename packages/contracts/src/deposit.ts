import { z } from "zod";

/**
 * The methods a user can pick on the deposit screen. All route to the same
 * simulated UPI collection identity — the label is cosmetic fidelity, not a
 * separate rail.
 */
export const DEPOSIT_METHODS = ["PhonePe", "UPI", "PayTM", "UPI Intent"] as const;

/**
 * Strict. A request carrying vpa, checkoutToken or status is rejected — those
 * are server-determined. Deposits are collected in rupees over UPI, so the
 * amount is INR minor units (paise); bounds are enforced again server-side.
 */
export const CreateDepositSchema = z.strictObject({
  method: z.enum(DEPOSIT_METHODS),
  /** Minor units (paise). Bounds are enforced again server-side. */
  amountInr: z.number().int().positive().max(1_000_000_000),
});
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

export interface DepositView {
  id: string;
  method: string;
  amountUsd: number;
  amountInr: number;
  status: string;
  claimedUtr: string | null;
  createdAt: number;
}
