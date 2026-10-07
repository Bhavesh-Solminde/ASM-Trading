import { randomInt } from "node:crypto";
import { DEMO_VPA } from "@asm/db";

/**
 * Where INR deposits are paid, read from the environment so switching or
 * adding collection accounts is an `.env.production` edit and a container
 * recreate, not a deploy. Read per call rather than at import for the same
 * reason. Every value falls back to what was hardcoded before, so an
 * environment that sets nothing behaves exactly as it always did.
 *
 * Matching never looks at the VPA (the reserved amount is the sole key, and
 * it is unique across every live deposit whichever account it's paid into),
 * so the VPA only decides where new deposits' QR codes and deep links point;
 * deposits already open keep the VPA stored on their own row.
 */
export function upiCollection(): {
  /** Every account deposits may be paid to (UPI_COLLECTION_VPAS, comma-separated). Never empty. */
  vpas: string[];
  payeeName: string;
  /** The `mc` merchant category code from a merchant account's own QR, if it has one. */
  merchantCode: string | null;
} {
  const vpas = (process.env["UPI_COLLECTION_VPAS"] ?? "")
    .split(",")
    .map((vpa) => vpa.trim())
    .filter((vpa) => vpa.length > 0);
  return {
    vpas: vpas.length > 0 ? vpas : [DEMO_VPA],
    payeeName: process.env["UPI_PAYEE_NAME"]?.trim() || "IndianxTrade",
    merchantCode: process.env["UPI_MERCHANT_CODE"]?.trim() || null,
  };
}

/**
 * The account a new deposit is paid to: one of the configured VPAs at random,
 * so incoming volume spreads across them instead of piling onto one.
 */
export function pickCollectionVpa(): string {
  const { vpas } = upiCollection();
  return vpas[randomInt(vpas.length)] ?? DEMO_VPA;
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

/**
 * How long after a UPI deposit is initiated to keep the manual "I paid, enter
 * UTR" form hidden. The SMS pipeline matches most payments in 2-10s; this
 * delay gives it a chance to win so users see the clean "Deposit credited"
 * screen instead of a form they didn't need. Configurable via env so an
 * operator can tune it without a redeploy — raise it if the relay is slow,
 * lower it if PhonePe SMS quotas are being hit regularly.
 */
export function upiManualClaimDelaySec(): number {
  const raw = process.env["UPI_MANUAL_CLAIM_DELAY_SEC"];
  if (!raw) return 90;
  const parsed = Number.parseInt(raw, 10);
  // Guard against misconfiguration (negative, NaN, or absurdly large) — fall
  // back to the default rather than letting a bad env value hide the manual
  // escape hatch forever.
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3600) return 90;
  return parsed;
}
