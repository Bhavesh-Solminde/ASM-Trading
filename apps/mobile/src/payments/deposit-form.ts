import { DEPOSIT_QUICK_INR, bonusMinor, bonusPercentForDeposit, inrToUsdt, methodLimits, overallLimits, type AmountOpts } from "@asm/client-core";
import { CreateDepositSchema, DEPOSIT_METHODS, UPI_METHODS, type CreateDepositInput, type DepositConfig, type UsdtNetwork } from "@asm/contracts";

/**
 * The deposit screen's pure logic. It holds no English text: the screen turns states and limits into i18n keys.
 * Amounts here are whole rupees (the screen's keypad takes no decimals); the server re-checks every one.
 */

export type DepositMethod = (typeof DEPOSIT_METHODS)[number];
const UPI = new Set<string>(UPI_METHODS);

/**
 * Whole rupees only, and at most 8 digits: more than the largest limit (₹10,00,000) so "too much" still reads as a
 * limit message, but not so many that the figure outgrows the screen.
 */
export const DEPOSIT_AMOUNT_OPTS: AmountOpts = { decimals: false, maxInt: 8 };

/** The typed amount as whole rupees; 0 for nothing, or for text that is not plain digits. */
export function parseRupees(text: string): number {
  if (!/^\d+$/.test(text)) return 0;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : 0;
}

export type LimitProblem = { kind: "min" | "max"; rupees: number };

/** Which of `method`'s limits the amount breaks (in rupees; USDT's are converted at the fixed rate), or null. Nothing entered breaks none. */
export function limitProblem(method: DepositMethod, rupees: number): LimitProblem | null {
  if (rupees <= 0) return null;
  const { min, max } = methodLimits(method);
  if (rupees < min) return { kind: "min", rupees: min };
  if (rupees > max) return { kind: "max", rupees: max };
  return null;
}

export interface MethodRow {
  method: DepositMethod;
  /** `soon`: UPI rails are closed. `limit`: this amount is outside the method's limits (see `limit`). */
  state: "ok" | "soon" | "limit";
  limit: LimitProblem | null;
}

/** All five methods, in the website's order; USDT only when a network is on offer. */
export function methodRows(config: DepositConfig, rupees: number): MethodRow[] {
  return DEPOSIT_METHODS.filter((m) => m !== "USDT" || config.usdtNetworks.length > 0).map((method) => {
    if (UPI.has(method) && !config.upiEnabled) return { method, state: "soon" as const, limit: null };
    const limit = limitProblem(method, rupees);
    return limit ? { method, state: "limit" as const, limit } : { method, state: "ok" as const, limit: null };
  });
}

/**
 * The method that is selected: the user's pick while it is open (even if the amount has just pushed it past its
 * limit, so its own limit message shows instead of the selection silently moving); else the first method that
 * takes the amount; else the first that would if the amount changed; else none.
 */
export function chooseMethod(rows: readonly MethodRow[], picked: DepositMethod | null): DepositMethod | null {
  const kept = rows.find((r) => r.method === picked && r.state !== "soon");
  if (kept) return kept.method;
  return (rows.find((r) => r.state === "ok") ?? rows.find((r) => r.state === "limit"))?.method ?? null;
}

/** The website recommends BNB Smart Chain (a network fee of cents) and preselects it whenever it is offered. */
export const RECOMMENDED_NETWORK: UsdtNetwork = "bsc";

/** The network a USDT deposit would use: the pick while it is offered, else the recommended one, else the first. Null when USDT is not offered. */
export function networkFor(config: DepositConfig, picked: UsdtNetwork | null): UsdtNetwork | null {
  const offered = config.usdtNetworks;
  if (picked && offered.includes(picked)) return picked;
  if (offered.includes(RECOMMENDED_NETWORK)) return RECOMMENDED_NETWORK;
  return offered[0] ?? null;
}

/** The quick-pick amounts that at least one method on offer can take. */
export function quickAmounts(config: DepositConfig): number[] {
  const offered = DEPOSIT_METHODS.filter((m) => (m === "USDT" ? config.usdtNetworks.length > 0 : config.upiEnabled));
  // While every rail is closed the rows still list UPI as "coming soon": keep the picks so the screen is not bare.
  const methods = offered.length > 0 ? offered : DEPOSIT_METHODS.filter((m) => m !== "USDT" || config.usdtNetworks.length > 0);
  const { min, max } = overallLimits(methods);
  return DEPOSIT_QUICK_INR.filter((v) => v >= min && v <= max);
}

export interface BonusPreview {
  /** 1-based: this would be the user's `nth` credited deposit. */
  nth: number;
  pct: number;
  /** Paise, floored exactly as the server credits it; 0 while nothing is entered. */
  bonusMinor: number;
}

/** The bonus this deposit would earn, or null once every tier is used. */
export function bonusPreview(config: DepositConfig, rupees: number): BonusPreview | null {
  const nth = config.completedDeposits + 1;
  const pct = bonusPercentForDeposit(nth);
  if (pct === 0) return null;
  return { nth, pct, bonusMinor: bonusMinor(Math.max(0, Math.round(rupees * 100)), pct) };
}

/**
 * The `POST /api/deposits` body, parsed through the contract so a body the server would refuse is never sent.
 * UPI amounts are paise; USDT amounts are USDT cents (₹110 = $1), the same figure the website sends.
 */
export function depositBody(method: DepositMethod, rupees: number, network?: UsdtNetwork): CreateDepositInput {
  const body =
    method === "USDT"
      ? { method, network, amountUsdtMinor: Math.round(inrToUsdt(rupees) * 100) }
      : { method, amountInr: Math.round(rupees * 100) };
  return CreateDepositSchema.parse(body);
}

export interface DepositModel {
  rupees: number;
  rows: MethodRow[];
  /** The selected method, or null when none is on offer. */
  method: DepositMethod | null;
  /** The network a USDT deposit would use (null when USDT is not offered); only meaningful when `method` is USDT. */
  network: UsdtNetwork | null;
  /** The selected method's limit the amount breaks, to show under the amount. */
  problem: LimitProblem | null;
  bonus: BonusPreview | null;
  quick: number[];
  canPay: boolean;
}

/** Everything the screen draws, derived from the config, the typed amount and the user's picks. */
export function depositModel(
  config: DepositConfig,
  input: { amountText: string; method: DepositMethod | null; network: UsdtNetwork | null },
): DepositModel {
  const rupees = parseRupees(input.amountText);
  const rows = methodRows(config, rupees);
  const method = chooseMethod(rows, input.method);
  const row = rows.find((r) => r.method === method);
  const network = networkFor(config, input.network);
  return {
    rupees,
    rows,
    method,
    network,
    problem: row?.limit ?? null,
    bonus: bonusPreview(config, rupees),
    quick: quickAmounts(config),
    canPay: rupees > 0 && row?.state === "ok" && (method !== "USDT" || network !== null),
  };
}
