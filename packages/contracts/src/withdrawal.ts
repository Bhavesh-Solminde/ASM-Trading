import { z } from "zod";
import { USDT_NETWORKS } from "./deposit";

/** How a user can be paid out. Independent of how they deposited. */
export const PAYOUT_METHODS = ["BANK", "UPI", "USDT"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export const PAYOUT_METHOD_LABEL: Record<PayoutMethod, string> = {
  BANK: "Bank account",
  UPI: "UPI",
  USDT: "USDT",
};

/** Per-request withdrawal limits, in INR paise: ₹700 – ₹50,000. */
export const WITHDRAWAL_MIN_INR_MINOR = 700_00;
export const WITHDRAWAL_MAX_INR_MINOR = 50_000_00;

/**
 * The same limits in an account's own minor units. A USD account converts at
 * the platform's fixed ₹100 = $1 rate (USD_INR_RATE), so $7 – $500. The db
 * repository mirrors this; a drift test keeps the two in step.
 */
export function withdrawalLimitsMinor(currency: string): { min: number; max: number } {
  if (currency === "INR") {
    return { min: WITHDRAWAL_MIN_INR_MINOR, max: WITHDRAWAL_MAX_INR_MINOR };
  }
  return { min: WITHDRAWAL_MIN_INR_MINOR / 100, max: WITHDRAWAL_MAX_INR_MINOR / 100 };
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const BANK_ACCOUNT_RE = /^\d{9,18}$/;
const UPI_RE = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/;
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BSC_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isValidUsdtAddress(network: string, address: string): boolean {
  if (network === "tron") return TRON_ADDRESS_RE.test(address);
  if (network === "bsc") return BSC_ADDRESS_RE.test(address);
  return false;
}

const BankPayoutSchema = z.strictObject({
  method: z.literal("BANK"),
  accountHolder: z.string().trim().min(2, "Enter the account holder name").max(80),
  accountNumber: z
    .string()
    .trim()
    .regex(BANK_ACCOUNT_RE, "Enter a valid account number (9–18 digits)"),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(IFSC_RE, "Enter a valid IFSC code, e.g. HDFC0001234"),
});

const UpiPayoutSchema = z.strictObject({
  method: z.literal("UPI"),
  upiId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(UPI_RE, "Enter a valid UPI ID, e.g. name@okicici"),
});

const UsdtPayoutSchema = z
  .strictObject({
    method: z.literal("USDT"),
    usdtNetwork: z.enum(USDT_NETWORKS),
    usdtAddress: z.string().trim(),
  })
  .refine((v) => isValidUsdtAddress(v.usdtNetwork, v.usdtAddress), {
    message: "Enter a valid wallet address for the selected network",
    path: ["usdtAddress"],
  });

export const PayoutDetailsSchema = z.discriminatedUnion("method", [
  BankPayoutSchema,
  UpiPayoutSchema,
  UsdtPayoutSchema,
]);
export type PayoutDetails = z.infer<typeof PayoutDetailsSchema>;

export const CreateWithdrawalSchema = z.strictObject({
  accountId: z.string().uuid(),
  amount: z.number().int().positive().max(100_000_000),
  payout: PayoutDetailsSchema,
});
export type CreateWithdrawalInput = z.infer<typeof CreateWithdrawalSchema>;

/**
 * Normalised payout destination, used to spot two users withdrawing to the
 * same bank account, UPI ID or wallet. BSC addresses are case-insensitive hex;
 * TRON addresses are case-sensitive base58 and are kept as-is.
 */
export function payoutDestinationKey(p: PayoutDetails): string {
  switch (p.method) {
    case "BANK":
      return `bank:${p.ifsc.toUpperCase()}:${p.accountNumber}`;
    case "UPI":
      return `upi:${p.upiId.toLowerCase()}`;
    case "USDT":
      return `usdt:${p.usdtNetwork}:${
        p.usdtNetwork === "bsc" ? p.usdtAddress.toLowerCase() : p.usdtAddress
      }`;
  }
}

/** Short, partly masked destination for receipts and history ("HDFC0001234 ••6789"). */
export function payoutDestinationLabel(p: {
  method: string;
  accountNumber?: string | null;
  ifsc?: string | null;
  upiId?: string | null;
  usdtNetwork?: string | null;
  usdtAddress?: string | null;
}): string | null {
  if (p.method === "BANK" && p.accountNumber) {
    return `${p.ifsc ?? ""} ••${p.accountNumber.slice(-4)}`.trim();
  }
  if (p.method === "UPI" && p.upiId) return p.upiId;
  if (p.method === "USDT" && p.usdtAddress) {
    const net = p.usdtNetwork === "bsc" ? "BEP-20" : p.usdtNetwork === "tron" ? "TRC-20" : "";
    return `${net} ${p.usdtAddress.slice(0, 6)}…${p.usdtAddress.slice(-4)}`.trim();
  }
  return null;
}
