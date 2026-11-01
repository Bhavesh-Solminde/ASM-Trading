import { convertMinorBetween } from "@asm/contracts";
import type { Deposit } from "../models";

export type CreditableDeposit = Pick<Deposit, "method" | "amountInr" | "amountUsd" | "amountUsdtMinor">;

/**
 * The amount (minor units of `accountCurrency`) a deposit credits to — and a
 * reversal reclaims from — a LIVE account. Shared by creditDepositToAccount
 * and reverseCompletedDeposit so the two can never disagree.
 *
 * USDT deposits: amountInr holds a NEGATIVE uniqueness sentinel and amountUsd
 * is 0 (see createUsdtDepositIntent), so neither may ever be credited. The
 * USDT-cents amount is converted instead, treating 1 USDT as 1 USD (USDT-cents
 * == USD-cents): an INR account gets ×USD_INR_RATE paise, a USD account the
 * same figure. A legacy "USDT"-denominated account gets USDT-cents as-is.
 * `usdtMinorOverride` is the amount actually received on-chain, for an admin
 * resolution.
 *
 * Any other method: unchanged INR/UPI semantics (INR rail → amountInr,
 * otherwise amountUsd).
 *
 * Throws unless the result is a positive integer — a deposit must never
 * reduce a balance.
 */
export function depositCreditMinor(
  deposit: Pick<Deposit, "method" | "amountInr" | "amountUsd" | "amountUsdtMinor">,
  accountCurrency: string,
  usdtMinorOverride?: number | null,
): number {
  let credit: number;
  if (deposit.method === "USDT") {
    const usdtMinor = usdtMinorOverride ?? deposit.amountUsdtMinor;
    if (usdtMinor === null || usdtMinor <= 0) {
      throw new Error("USDT deposit has no positive USDT amount to credit.");
    }
    if (accountCurrency === "USDT") {
      credit = usdtMinor;
    } else if (accountCurrency === "INR" || accountCurrency === "USD") {
      credit = convertMinorBetween(usdtMinor, "USD", accountCurrency);
    } else {
      throw new Error(`Cannot credit a USDT deposit to a ${accountCurrency} account.`);
    }
  } else if (accountCurrency === "INR") {
    credit = deposit.amountInr;
  } else if (accountCurrency === "USDT") {
    throw new Error(`Cannot credit a ${deposit.method} deposit to a USDT account.`);
  } else {
    credit = deposit.amountUsd;
  }
  if (!Number.isInteger(credit) || credit <= 0) {
    throw new Error(`Refusing a non-positive deposit credit (${credit}).`);
  }
  return credit;
}

/**
 * The currency a ledger DEPOSIT credit was written in, given the account's
 * current one. The ledger is written once and never rewritten by a currency
 * switch (the balance is), and every switch leaves a CURRENCY_CONVERT row, so
 * the number of switches after the credit says where we are: an even count
 * means the account is back in the credit's currency, an odd count that it is
 * in the other one. (Switches only alternate INR and USD.) The credit's
 * `createdAt` is its transaction's start time, which can precede a switch whose
 * lock the credit waited on; the credit then already used the switched
 * currency. So if exactly one currency reproduces the ledger amount at the
 * deposit's CURRENT figures, and the switch count disagrees, trust the match.
 */
/** Recover the ledger currency using conversion history, checking the credit amount when a switch raced the credit. */
export function currencyAtCredit(
  deposit: CreditableDeposit,
  creditAmount: number,
  creditedAt: Date,
  switchTimes: readonly Date[],
  current: string,
): string {
  const after = switchTimes.filter((t) => t.getTime() > creditedAt.getTime()).length;
  const other = current === "INR" ? "USD" : current === "USD" ? "INR" : current;
  const byCount = after % 2 === 0 ? current : other;
  const matches = ["INR", "USD"].filter((c) => {
    try {
      return depositCreditMinor(deposit, c) === creditAmount;
    } catch {
      return false;
    }
  });
  if (matches.length === 1 && matches[0] !== byCount) return matches[0]!;
  return byCount;
}
