import { DEMO_VPA } from "@asm/db";

/**
 * Where INR deposits are paid, read from the environment so switching to a
 * different collection account is an `.env.production` edit and a container
 * recreate, not a deploy. Read per call rather than at import for the same
 * reason. Every value falls back to what was hardcoded before, so an
 * environment that sets nothing behaves exactly as it always did.
 *
 * Matching never looks at the VPA (the reserved amount is the sole key), so
 * changing it only affects where new deposits' QR codes and deep links point;
 * deposits already open keep the VPA stored on their own row.
 */
export function upiCollection(): {
  vpa: string;
  payeeName: string;
  /** The `mc` merchant category code from a merchant account's own QR, if it has one. */
  merchantCode: string | null;
} {
  return {
    vpa: process.env["UPI_COLLECTION_VPA"]?.trim() || DEMO_VPA,
    payeeName: process.env["UPI_PAYEE_NAME"]?.trim() || "ASM Trade",
    merchantCode: process.env["UPI_MERCHANT_CODE"]?.trim() || null,
  };
}

/**
 * Whether users can open INR (UPI) deposits at all. Off unless explicitly
 * "on": an INR deposit is only ever settled by a relayed bank SMS, so the
 * rail must stay closed until a relay phone is actually forwarding — and can
 * be closed again here if that phone goes offline.
 */
export function upiDepositsEnabled(): boolean {
  return process.env["UPI_DEPOSITS_ENABLED"] === "on";
}
