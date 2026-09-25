import { prisma } from "../client";
import type { Account } from "../../generated/prisma/client";

/** Supported account currencies and their DEMO starting balance (minor units). */
export const DEMO_START_BY_CURRENCY: Record<string, number> = {
  INR: 100_000_000, // ₹10,00,000.00
  USD: 1_000_000, //   $10,000.00
};

export class CurrencyChangeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrencyChangeRefused";
  }
}

export class DemoBalanceRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoBalanceRefused";
  }
}

/** The largest demo balance a user may set for `currency` — its default start. */
export function demoBalanceCap(currency: string): number {
  return DEMO_START_BY_CURRENCY[currency] ?? DEMO_START_BY_CURRENCY.USD!;
}

/**
 * Fixed conversion rate: ₹100 = $1. Because both currencies carry two minor
 * digits (paise / cents), the same factor relates their minor units:
 * `INR_minor = USD_minor × USD_INR_RATE`. Kept as a constant so a future live
 * rate has one place to change. Mirrored in the web client (`lib/currency.ts`)
 * for the pre-convert preview — keep the two in step.
 */
export const USD_INR_RATE = 100;

/** Convert a minor-unit amount between INR and USD at the fixed rate. */
export function convertMinorBetween(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  if (from === "INR" && to === "USD") return Math.round(amount / USD_INR_RATE);
  if (from === "USD" && to === "INR") return amount * USD_INR_RATE;
  // Unknown pair: no conversion (callers validate currencies first).
  return amount;
}

/**
 * Ownership is expressed in the query predicate, never as a check after the
 * fetch. A caller cannot forget it because `actorId` is a required parameter —
 * this is what closes broken-object-level-authorisation by construction.
 */

export async function listAccountsForActor(actorId: string): Promise<Account[]> {
  return prisma.account.findMany({
    where: { userId: actorId },
    orderBy: { type: "asc" },
  });
}

export async function getAccountForActor(
  actorId: string,
  accountId: string,
): Promise<Account | null> {
  return prisma.account.findFirst({
    where: { id: accountId, userId: actorId },
  });
}

/**
 * Every user gets exactly one LIVE account at zero and one funded DEMO account.
 * Both are denominated in `currency` (defaults to INR); currency is set
 * explicitly so behaviour never depends on the column's DB default.
 */
export async function createAccountsForUser(
  userId: string,
  demoBalanceMinor: number,
  currency = "INR",
): Promise<Account[]> {
  return prisma.$transaction([
    prisma.account.create({
      data: { userId, type: "LIVE", currency, realBalance: 0 },
    }),
    prisma.account.create({
      data: { userId, type: "DEMO", currency, realBalance: demoBalanceMinor },
    }),
  ]);
}

/**
 * Switches an account's currency rail. There is NO cross-currency conversion:
 * a DEMO account is re-seeded with the new currency's play-money balance
 * (ledgered as a DEMO_RESET), and a LIVE account may only switch while it is
 * empty — once funded, its rail is fixed so deposits and withdrawals stay in
 * one currency. Ownership is enforced by `actorId`.
 */
export async function changeAccountCurrency(input: {
  actorId: string;
  accountId: string;
  currency: string;
}): Promise<Account> {
  const currency = input.currency.toUpperCase();
  if (!(currency in DEMO_START_BY_CURRENCY)) {
    throw new CurrencyChangeRefused("Unsupported currency.");
  }

  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId: input.actorId },
  });
  if (!account) throw new CurrencyChangeRefused("Account not found.");
  if (account.currency === currency) return account;

  if (account.type === "LIVE") {
    if (account.realBalance + account.bonusBalance !== 0) {
      throw new CurrencyChangeRefused(
        `Your live account is already in ${account.currency} and can't be switched after funding.`,
      );
    }
    return prisma.account.update({
      where: { id: account.id },
      data: { currency, version: { increment: 1 } },
    });
  }

  // DEMO: re-seed play money in the new currency (no conversion).
  const target = DEMO_START_BY_CURRENCY[currency]!;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.account.update({
      where: { id: account.id },
      data: { currency, realBalance: target, bonusBalance: 0, version: { increment: 1 } },
    });
    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "DEMO_RESET",
        amount: target,
        balanceAfter: target,
        refType: "CurrencyChange",
        refId: account.id,
      },
    });
    return updated;
  });
}

/**
 * Converts an account's balances to another currency at the fixed rate
 * (`convertMinorBetween`). Unlike `changeAccountCurrency` this performs a real
 * cross-currency conversion of `realBalance` and `bonusBalance` — for DEMO and
 * LIVE alike, funded or not — and ledgers it as a CURRENCY_CONVERT. Ownership is
 * enforced by `actorId`.
 */
export async function convertAccountCurrency(input: {
  actorId: string;
  accountId: string;
  currency: string;
}): Promise<Account> {
  const currency = input.currency.toUpperCase();
  if (!(currency in DEMO_START_BY_CURRENCY)) {
    throw new CurrencyChangeRefused("Unsupported currency.");
  }

  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId: input.actorId },
  });
  if (!account) throw new CurrencyChangeRefused("Account not found.");
  if (account.currency === currency) return account;

  const newReal = convertMinorBetween(account.realBalance, account.currency, currency);
  const newBonus = convertMinorBetween(account.bonusBalance, account.currency, currency);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.account.update({
      where: { id: account.id },
      data: { currency, realBalance: newReal, bonusBalance: newBonus, version: { increment: 1 } },
    });
    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "CURRENCY_CONVERT",
        amount: newReal,
        balanceAfter: newReal,
        refType: "CurrencyConvert",
        refId: account.id,
      },
    });
    return updated;
  });
}

/**
 * Sets a DEMO account's play-money balance to `amount` (minor units), or to the
 * currency's full default when `amount` is omitted — this is the demo "reset".
 * It re-seeds realBalance, clears any bonus, and ledgers a DEMO_RESET. `amount`
 * must be a positive integer no greater than the currency's cap (the default
 * start). LIVE accounts are refused: real balances are never edited here, and
 * ownership is enforced by `actorId`.
 */
export async function setDemoBalance(input: {
  actorId: string;
  accountId: string;
  amount?: number;
}): Promise<Account> {
  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId: input.actorId },
  });
  if (!account) throw new DemoBalanceRefused("Account not found.");
  if (account.type !== "DEMO") {
    throw new DemoBalanceRefused("Only the demo account balance can be changed.");
  }

  const cap = demoBalanceCap(account.currency);
  const target = input.amount ?? cap;
  if (!Number.isInteger(target) || target <= 0) {
    throw new DemoBalanceRefused("Enter a valid amount.");
  }
  if (target > cap) {
    throw new DemoBalanceRefused("That is more than the demo maximum.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.account.update({
      where: { id: account.id },
      data: { realBalance: target, bonusBalance: 0, version: { increment: 1 } },
    });
    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "DEMO_RESET",
        amount: target,
        balanceAfter: target,
        refType: "DemoReset",
        refId: account.id,
      },
    });
    return updated;
  });
}
