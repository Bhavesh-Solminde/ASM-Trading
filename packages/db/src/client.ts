import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Money columns are Postgres BIGINT (minor units) so balances can't overflow
 * the 32-bit INTEGER ceiling — that overflow crash-looped the engine on
 * 2026-10-14. Prisma surfaces BIGINT as JS `bigint`, which breaks arithmetic
 * with `number` and JSON.stringify everywhere money flows. Instead the client
 * hands every money column back as a plain `number`: exact up to 2^53 minor units
 * (~₹90 lakh crore), far past any balance this app will hold.
 *
 * Writes need nothing: Prisma accepts `number` for BIGINT inputs.
 *
 * Two pieces, both limited to the money columns listed in `money`:
 *   - `result` overrides type each money field as `number` on model reads —
 *     create/update results and nested includes too — and convert the value.
 *   - `aggregate` / `groupBy` are converted at runtime: the result overrides
 *     already make `_sum.<money>` *typed* `number`, but Prisma still returns
 *     a `bigint` there, which would slip past the type checker.
 *
 * The older BIGINT columns (block numbers, scan-cursor timestamps,
 * ShadowTick.id) are not listed and stay `bigint` on purpose.
 *
 * Adding a money column? Make it BigInt and add it to `money` below and to
 * the matching type in models.ts.
 */

type Row<F extends string> = { [K in F]: bigint };
type NullableRow<F extends string> = { [K in F]: bigint | null };

function asNumber<F extends string>(field: F) {
  return {
    needs: { [field]: true } as { [K in F]: true },
    compute: (row: Row<F>): number => Number(row[field]),
  };
}

function asNullableNumber<F extends string>(field: F) {
  return {
    needs: { [field]: true } as { [K in F]: true },
    compute: (row: NullableRow<F>): number | null =>
      row[field] === null ? null : Number(row[field]),
  };
}

const money = {
  user: {
    cumulativeDeposits: asNumber("cumulativeDeposits"),
  },
  account: {
    realBalance: asNumber("realBalance"),
    bonusBalance: asNumber("bonusBalance"),
    turnoverProgress: asNumber("turnoverProgress"),
    medianStake: asNumber("medianStake"),
    dailyLimit: asNullableNumber("dailyLimit"),
  },
  trade: {
    stake: asNumber("stake"),
    stakeFromBonus: asNumber("stakeFromBonus"),
    pnl: asNumber("pnl"),
  },
  houseDay: {
    targetProfitMinor: asNumber("targetProfitMinor"),
    realizedProfitMinor: asNumber("realizedProfitMinor"),
    totalStakesMinor: asNumber("totalStakesMinor"),
    totalPayoutsMinor: asNumber("totalPayoutsMinor"),
  },
  houseTreasury: {
    treasuryMinor: asNumber("treasuryMinor"),
    treasuryTargetMinor: asNumber("treasuryTargetMinor"),
  },
  tradeShadow: {
    exposureUp: asNumber("exposureUp"),
    exposureDown: asNumber("exposureDown"),
  },
  deposit: {
    amountUsd: asNumber("amountUsd"),
    amountInr: asNumber("amountInr"),
    amountUsdtMinor: asNullableNumber("amountUsdtMinor"),
  },
  bankCredit: {
    amountInr: asNumber("amountInr"),
  },
  relayMessage: {
    parsedAmountInr: asNullableNumber("parsedAmountInr"),
  },
  chainCredit: {
    normalizedAmountMinor: asNullableNumber("normalizedAmountMinor"),
  },
  withdrawal: {
    amount: asNumber("amount"),
  },
  transaction: {
    amount: asNumber("amount"),
    balanceAfter: asNumber("balanceAfter"),
  },
  bonusGrant: {
    amount: asNumber("amount"),
    turnoverRequired: asNumber("turnoverRequired"),
    turnoverDone: asNumber("turnoverDone"),
  },
} as const;

/** Money field names by Prisma model name ("Account"), for aggregate results. */
const MONEY_FIELDS: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(money).map(([model, fields]) => [
    model.charAt(0).toUpperCase() + model.slice(1),
    new Set(Object.keys(fields)),
  ]),
);

/**
 * Converts money `bigint`s in one aggregate/groupBy row — top-level `by`
 * fields and every `_sum` / `_avg` / `_min` / `_max` block. Exported for tests.
 */
export function moneyAggregateToNumbers(model: string, row: unknown): unknown {
  const fields = MONEY_FIELDS[model];
  if (!fields || row === null || typeof row !== "object") return row;
  const toNum = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...obj };
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "bigint" && fields.has(k)) out[k] = Number(v);
    }
    return out;
  };
  const out = toNum(row as Record<string, unknown>);
  for (const [k, v] of Object.entries(out)) {
    if (k.startsWith("_") && v !== null && typeof v === "object") {
      out[k] = toNum(v as Record<string, unknown>);
    }
  }
  return out;
}

function buildClient() {
  const adapter = new PrismaPg({
    connectionString: process.env["DATABASE_URL"]!,
  });
  return new PrismaClient({ adapter }).$extends({
    result: money,
    query: {
      $allModels: {
        async aggregate({ model, args, query }) {
          return moneyAggregateToNumbers(model, await query(args)) as Awaited<ReturnType<typeof query>>;
        },
        async groupBy({ model, args, query }) {
          const rows = (await query(args)) as unknown[];
          return rows.map((r) => moneyAggregateToNumbers(model, r)) as Awaited<ReturnType<typeof query>>;
        },
      },
    },
  });
}

export type DbClient = ReturnType<typeof buildClient>;
/** The `tx` handed to `prisma.$transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<DbClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as {
  prisma: DbClient | undefined;
};

export const prisma: DbClient = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
