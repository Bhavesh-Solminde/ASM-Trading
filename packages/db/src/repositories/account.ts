import { prisma, type DbTransaction } from "../client";
import type { Account } from "../models";

/** Supported account currencies and their DEMO starting balance (minor units). */
export const DEMO_START_BY_CURRENCY: Record<string, number> = {
  INR: 100_000_000, // ₹10,00,000.00
  USD: 1_000_000, //   $10,000.00
};

export class CurrencyChangeRefused extends Error {
  /** Machine-readable reason, set only for refusals the client acts on. */
  readonly code?: "pending_withdrawal" | "open_positions";
  constructor(message: string, code?: "pending_withdrawal" | "open_positions") {
    super(message);
    this.name = "CurrencyChangeRefused";
    if (code) this.code = code;
  }
}

/**
 * Withdrawal statuses where the money has already left the account but the
 * payout is not final — a cancel/reject can still refund it. A row in one of
 * these holds `amount` in the currency the account had at request time, so the
 * account may not change currency while one exists. PAID, REJECTED and
 * CANCELLED_BY_USER are final (any refund has already happened).
 */
export const IN_FLIGHT_WITHDRAWAL_STATUSES = ["REQUESTED", "HELD", "APPROVED"] as const;

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
 * Rewrites a trade's money columns from one currency's minor units to
 * another's in a single UPDATE. INR→USD must round exactly like
 * `convertMinorBetween` (JS `Math.round`: half toward +infinity, so −1.5 → −1),
 * which `FLOOR(x + 0.5)` reproduces and Postgres `ROUND` (half away from zero)
 * does not. USD→INR is an exact multiply. `spreadFee` and `peakPnl` are the CFD
 * columns; both are nullable-safe.
 */
async function convertTradeAmounts(
  tx: Pick<DbTransaction, "$executeRaw">,
  accountId: string,
  from: string,
  to: string,
): Promise<void> {
  if (from === "INR" && to === "USD") {
    await tx.$executeRaw`
      UPDATE "Trade" SET
        "stake" = FLOOR("stake"::numeric / ${USD_INR_RATE}::numeric + 0.5)::bigint,
        "stakeFromBonus" = FLOOR("stakeFromBonus"::numeric / ${USD_INR_RATE}::numeric + 0.5)::bigint,
        "pnl" = FLOOR("pnl"::numeric / ${USD_INR_RATE}::numeric + 0.5)::bigint,
        "spreadFee" = FLOOR("spreadFee"::numeric / ${USD_INR_RATE}::numeric + 0.5)::int,
        "peakPnl" = FLOOR("peakPnl"::numeric / ${USD_INR_RATE}::numeric + 0.5)::int
      WHERE "accountId" = ${accountId}`;
  } else if (from === "USD" && to === "INR") {
    await tx.$executeRaw`
      UPDATE "Trade" SET
        "stake" = "stake" * ${USD_INR_RATE}::bigint,
        "stakeFromBonus" = "stakeFromBonus" * ${USD_INR_RATE}::bigint,
        "pnl" = "pnl" * ${USD_INR_RATE}::bigint,
        "spreadFee" = "spreadFee" * ${USD_INR_RATE}::int,
        "peakPnl" = "peakPnl" * ${USD_INR_RATE}::int
      WHERE "accountId" = ${accountId}`;
  }
}

/**
 * Converts an account's balances to another currency at the fixed rate
 * (`convertMinorBetween`). Unlike `changeAccountCurrency` this performs a real
 * cross-currency conversion of `realBalance` and `bonusBalance` — for DEMO and
 * LIVE alike, funded or not — and ledgers it as a CURRENCY_CONVERT. Trades on
 * this account carry stake/stakeFromBonus/pnl in integer minor units with NO
 * currency column — the account's current currency is what the UI renders them
 * in — so they must be converted in the same transaction. Otherwise a ₹1,000
 * trade (stake=100,000 paise) rendered after an INR→USD convert reads as
 * "$1,000" and its 92%-payout gross return as "$1,920". Ownership is enforced
 * by `actorId`.
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

  return prisma.$transaction(async (tx) => {
    // Everything below happens in ONE transaction behind a row lock on the
    // account. The balance used to be read before the transaction and written
    // back blind, so a trade debit, payout or withdrawal that committed in
    // between was lost (or escaped the conversion). FOR NO KEY UPDATE makes every
    // other writer of this account row — versioned or not — wait for us, and
    // the reads after it see their committed result. NO KEY UPDATE is the lock
    // a plain UPDATE takes: it conflicts with every balance writer but not with
    // the KEY SHARE that foreign-key inserts (Trade, Transaction rows) take, so
    // ledger inserts are not blocked for the length of the switch.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Account"
      WHERE "id" = ${input.accountId} AND "userId" = ${input.actorId}
      FOR NO KEY UPDATE`;
    if (locked.length === 0) throw new CurrencyChangeRefused("Account not found.");

    const account = await tx.account.findUniqueOrThrow({ where: { id: input.accountId } });
    if (account.currency === currency) return account;

    // A withdrawal debits the account at request time and refunds it (cancel /
    // reject) later in the row's own currency. Switching in between would turn
    // ₹50,000 of paise into $50,000 of cents on refund. Only LIVE accounts can
    // withdraw, and Withdrawal is keyed by user (one LIVE account per user).
    // Checked inside the locked transaction, so a request that commits first is
    // seen here and one that commits later finds the account already converted.
    if (account.type === "LIVE") {
      const pending = await tx.withdrawal.count({
        where: { userId: account.userId, status: { in: [...IN_FLIGHT_WITHDRAWAL_STATUSES] } },
      });
      if (pending > 0) {
        throw new CurrencyChangeRefused(
          "You have a withdrawal in progress. You can switch currency once it is paid or rejected.",
          "pending_withdrawal",
        );
      }
    }

    // Binary settlement and CFD close read a trade's stake and then credit it,
    // so an OPEN position of either kind (both are Trade rows) would pay out in
    // the old currency's units after the switch — 100x on INR→USD. Refuse until
    // none is open. Opening one is serialised against this check: a binary open
    // debits under the same account row lock (it version-conflicts and retries
    // against the new currency), and a CFD open's balance update is conditional
    // on the currency it read, so it fails if the account switched under it.
    const openPositions = await tx.trade.count({
      where: { accountId: account.id, status: "OPEN" },
    });
    if (openPositions > 0) {
      throw new CurrencyChangeRefused("Close your open trades first.", "open_positions");
    }

    const fromCurrency = account.currency;
    const newReal = convertMinorBetween(account.realBalance, fromCurrency, currency);
    const newBonus = convertMinorBetween(account.bonusBalance, fromCurrency, currency);

    const updated = await tx.account.update({
      where: { id: account.id },
      data: { currency, realBalance: newReal, bonusBalance: newBonus, version: { increment: 1 } },
    });
    // Convert every trade's integer-minor amounts in-place so the UI (which
    // reads trade.stake/pnl in the account's current currency) stays honest
    // across the convert — settled wins and losses alike (none are OPEN here).
    // One set-based statement: a per-row loop times out the 5 s interactive
    // transaction for users with thousands of trades.
    await convertTradeAmounts(tx, account.id, fromCurrency, currency);
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
