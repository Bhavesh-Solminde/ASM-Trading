import type { DEPOSIT_METHODS } from "@asm/contracts";
import { USD_INR_RATE } from "../money/currency";
import { currencySymbol, formatMinor } from "../money/format-money";

type Method = (typeof DEPOSIT_METHODS)[number];

/**
 * Deposit limits in whole rupees, as the amount screen sees them. A client
 * component can't import @asm/db (its barrel builds the Prisma client), so
 * these mirror MIN/MAX_DEPOSIT_INR_MINOR and MIN/MAX_DEPOSIT_USDT_MINOR;
 * limits.test.ts fails if they drift. The server re-checks every amount.
 */
export const INR_MIN = 500;
export const INR_MAX = 10_00_000;
export const USDT_MIN_USD = 10;
export const USDT_MAX_USD = 10_000;

export interface Limits {
  /** Whole rupees. */
  min: number;
  max: number;
}

/** What one method accepts, in rupees (USDT converts at the platform's fixed ₹100 = $1). */
export function methodLimits(method: Method): Limits {
  return method === "USDT"
    ? { min: USDT_MIN_USD * USD_INR_RATE, max: USDT_MAX_USD * USD_INR_RATE }
    : { min: INR_MIN, max: INR_MAX };
}

/** USDT (whole-cent major units) for a rupee amount at the fixed rate. */
export function inrToUsdt(inr: number): number {
  return inr / USD_INR_RATE;
}

export const formatInr = (n: number) => `₹${n.toLocaleString("en-US")}`;

/** Bonus in minor units, computed exactly like the server (floor of credit * pct / 100). */
export function bonusMinor(amountMinor: number, percent: number): number {
  return Math.floor((amountMinor * percent) / 100);
}

/** Money in minor units: whole when it has no fraction, otherwise two decimals. */
export function formatMinorCompact(minor: number, currency: string): string {
  const whole = minor % 100 === 0;
  const symbol = currencySymbol(currency);
  if (whole) return `${symbol}${(minor / 100).toLocaleString("en-US")}`;
  return formatMinor(minor, currency);
}

/** Why a method can't take `amountInr`, or null when it can. */
export function methodAmountProblem(method: Method, amountInr: number): string | null {
  const { min, max } = methodLimits(method);
  const usdt = method === "USDT";
  const show = (inr: number) => (usdt ? `${formatInr(inr)} ($${inrToUsdt(inr).toLocaleString("en-US")})` : formatInr(inr));
  if (amountInr < min) return `Minimum ${show(min)}`;
  if (amountInr > max) return `Maximum ${show(max)}`;
  return null;
}

/**
 * Bounds the amount step enforces: the loosest limits across the methods that
 * are actually on offer, so the user is never told "too low" for an amount
 * some method would take. Method-specific limits are applied on the next step.
 */
export function overallLimits(methods: readonly Method[]): Limits {
  if (methods.length === 0) return { min: INR_MIN, max: INR_MAX };
  const all = methods.map(methodLimits);
  return { min: Math.min(...all.map((l) => l.min)), max: Math.max(...all.map((l) => l.max)) };
}
