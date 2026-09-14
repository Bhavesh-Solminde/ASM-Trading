# ASM Trade — Plan 03: Trade Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working trade ticket — pick a duration and a stake, press Up or Down, and watch the position settle at expiry against the engine's price, with the balance and trade history updating live.

**Architecture:** Pure trade arithmetic (outcomes, the settlement credit and its real/bonus split, expiry rounding, bucketing) lives in `packages/trading` and tests without a database. **The engine owns a trade from open to settlement.** The web app authenticates, validates, and checks ownership, then forwards the request to the engine's loopback control surface. The engine captures the entry price, writes the trade, registers it for expiry, and pushes it to the trader's socket in one step. Every balance change is a single database transaction containing the balance update, the trade row change, and its ledger row. Positions expiring in the same second settle against one captured price.

**Tech Stack:** TypeScript · Prisma 7 · Postgres 16 · `ws` 8.21.3 · Next.js 16 · Vitest 5

> **Revision 2026-09-14 — pre-execution review.** This plan was rewritten before any of it ran,
> after checking it against the real code from Plans 01 and 02. Pure-code steps (Tasks 1–3 and the
> Task 7 state reducer and formatter) were executed and pass exactly as printed. The original had
> these defects:
>
> 1. **Money could vanish or be paid twice on a crash.** The stake debit, trade insert, ledger row,
>    settlement claim, and payout were separate statements. A crash between "debit" and "create
>    trade" lost the stake; one between "mark WON" and "credit" lost the payout permanently (the
>    idempotency guard then blocked any retry). Each is now one transaction.
> 2. **Stranded or wrongly settled trades.** Registration with the engine was a second HTTP call
>    after the DB write, so its failure stranded the trade until a restart. After a restart, an
>    overdue trade settled against a price from after the outage. The engine now opens trades
>    itself, and voids (refunds) positions whose expiry passed while it was down.
> 3. **Settlement blocked the 10 Hz tick loop** on database writes, and a failed write dropped the
>    position from memory. Exit prices are now captured synchronously and persisted by a
>    serialised worker, which retries with the *same* captured price.
> 4. **Bonus laundering.** Winnings and refunds from a bonus-funded stake went to the withdrawable
>    real balance. Credits now return in the stake's own real/bonus proportion.
> 5. **Tests could not run:** `new PrismaClient()` without the Prisma 7 driver adapter throws,
>    and the tests never cleaned up after themselves.
> 6. **UI:** balances never updated (the socket's `balance:update` was ignored), reloading lost
>    all history (`initialTrades={[]}`), and the page opened a second socket. `@asm/trading` was
>    missing from `transpilePackages`, so the build would fail.
> 7. The `POST /positions` body was trusted without validation, breaking the "strict schema at
>    every boundary" constraint.

## Global Constraints

- **Everything from Plans 01 and 02 applies** — Node `>=22.0.0`, exact pinned versions, `z.strictObject()` at every boundary (including the engine's loopback surface), money as integer minor units, `actorId` on every user-owned query, no Docker, server-authoritative prices, no `.js` extensions on internal imports, and no session token ever reaching page JavaScript.
- **`driftBias` and `magnet` stay zero.** This plan settles against an *unbiased* engine. That is the only way to later attribute a win-rate deviation to Plan 04's controller rather than to a settlement bug.
- **Entry price, entry time, expiry time and payout come from the engine.** A browser request carries `symbol`, `direction`, `stake`, `durationSec`, `accountId` and nothing else. The web app adds `actorId` from the session.
- **Every trade stores the `payoutPct` and the `stakeFromBonus` it was opened with.** Changing an asset's payout never alters an open position's terms.
- **A tie refunds the stake.** `exitPrice === entryPrice` is `REFUNDED`, excluded from win-rate statistics in Plan 04.
- **One captured price per bucket.** All positions on one asset expiring in the same second settle against a single price captured when the bucket came due, however long the writes take.
- **Every balance change is one transaction** containing the account update, the trade status change or insert, and exactly one ledger (`Transaction`) row.
- **Debits use optimistic concurrency.** A version-guarded conditional update inside the transaction, retried on conflict. Never read-then-blind-write.
- **A trade whose expiry passed while the engine was down is voided (REFUNDED, no exit price)**, never settled against a later price.
- **DB tests** import `prisma` from `../client` (never `new PrismaClient()`), clean up every row they create, and run against the test database via `pnpm test` (`scripts/test-all.sh`, Plan 02 Task 8).
- **Migrations** are generated with `prisma migrate dev --name …` (never hand-dated), and applied to the test DB with `DATABASE_MIGRATE_URL=<test url> prisma migrate deploy`.
- **`exactOptionalPropertyTypes` is on.** Never assign a possibly-`undefined` value to an optional property. Build the object conditionally instead.

---

## File Structure

```
packages/trading/
├── package.json
├── tsconfig.json
└── src/
    ├── outcome.ts          didWin, settlementCredit, settlementPnl
    ├── durations.ts        the 13 allowed durations
    ├── expiry.ts           expirySecFor — rounds up so no trade settles early
    ├── credit-split.ts     splitSettlementCredit — real/bonus in the stake's proportion
    ├── buckets.ts          BucketRegistry — pure, in-memory
    └── index.ts            barrel

packages/contracts/src/
├── trade.ts                OpenTradeSchema, EngineOpenTradeSchema, TradeView, tradeViewFrom
├── ws.ts                   modified — trade:opened, trade:settled, balance:update
└── index.ts                modified

packages/db/
├── prisma/schema.prisma                         modified — Trade.stakeFromBonus
├── prisma/migrations/<generated>_trade_stake_from_bonus/
└── src/repositories/trade.ts                    openTrade, settleTrade, voidTrade, listTradesForActor, loadOpenPositions

apps/engine/src/
├── trading/errors.ts       DeskRejection
├── trading/trade-desk.ts   TradeDesk: open, hydrate, collectDue, serialised settlement
├── internal-api.ts         loopback POST /trades, secret-gated, strict schema
├── server.ts               modified — sendToUser
├── loop.ts                 modified — collects due buckets each tick
└── main.ts                 modified — wiring and shutdown order

apps/web/src/
├── lib/engine-client.ts                 engineOpenTrade
├── lib/format-money.ts                  client-safe formatMinor
├── app/api/trades/route.ts              POST open, GET list
├── components/AccountSwitcher.tsx       modified — controlled, live balances
├── components/trade/trade-state.ts      pure reducer: trades per account, balances
├── components/trade/TradeTicket.tsx
├── components/trade/TradesPanel.tsx
├── components/trade/TradeWorkspace.tsx  one socket, chart + ticket + trades
└── app/(platform)/trade/page.tsx        modified
```

`packages/trading` imports nothing. That lets Plan 04 exercise the controller against real bucket geometry with no database.

---

## Task 1: Pure trade arithmetic

**Files:**
- Create: `packages/trading/package.json`, `packages/trading/tsconfig.json`, `packages/trading/src/outcome.ts`, `packages/trading/src/durations.ts`, `packages/trading/src/expiry.ts`, `packages/trading/src/credit-split.ts`
- Test: `packages/trading/src/outcome.test.ts`, `packages/trading/src/expiry.test.ts`, `packages/trading/src/credit-split.test.ts`

**Interfaces:**
- Produces:
  - `type Direction = "UP" | "DOWN"`, `type Outcome = "WON" | "LOST" | "REFUNDED"`
  - `didWin(direction, entryPrice, exitPrice): Outcome`
  - `settlementCredit(stake, payoutPct, outcome): number` — minor units returned to the account
  - `settlementPnl(stake, payoutPct, outcome): number` — signed profit/loss
  - `DURATIONS_SEC`, `isValidDuration(seconds): boolean`
  - `expirySecFor(expiryMs: number): number`
  - `splitSettlementCredit(credit, stake, stakeFromBonus): { toReal: number; toBonus: number }`

- [ ] **Step 1: Write `packages/trading/package.json`**

```json
{
  "name": "@asm/trading",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" }
}
```

- [ ] **Step 2: Write `packages/trading/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing tests**

Create `packages/trading/src/outcome.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { didWin, settlementCredit, settlementPnl } from "./outcome";
import { DURATIONS_SEC, isValidDuration } from "./durations";

describe("didWin", () => {
  it("wins an UP trade when the price rose", () => {
    expect(didWin("UP", 1.175, 1.176)).toBe("WON");
  });

  it("loses an UP trade when the price fell", () => {
    expect(didWin("UP", 1.175, 1.174)).toBe("LOST");
  });

  it("wins a DOWN trade when the price fell", () => {
    expect(didWin("DOWN", 1.175, 1.174)).toBe("WON");
  });

  it("loses a DOWN trade when the price rose", () => {
    expect(didWin("DOWN", 1.175, 1.176)).toBe("LOST");
  });

  it("refunds an exact tie in either direction", () => {
    expect(didWin("UP", 1.175, 1.175)).toBe("REFUNDED");
    expect(didWin("DOWN", 1.175, 1.175)).toBe("REFUNDED");
  });
});

describe("settlementCredit", () => {
  it("returns stake plus profit at 100% payout", () => {
    expect(settlementCredit(10_000, 100, "WON")).toBe(20_000);
  });

  it("returns stake plus profit at 92% payout", () => {
    expect(settlementCredit(10_000, 92, "WON")).toBe(19_200);
  });

  it("returns nothing on a loss", () => {
    expect(settlementCredit(10_000, 92, "LOST")).toBe(0);
  });

  it("returns the stake on a refund", () => {
    expect(settlementCredit(10_000, 92, "REFUNDED")).toBe(10_000);
  });

  it("returns whole minor units at awkward payouts", () => {
    const credit = settlementCredit(333, 67, "WON");
    expect(Number.isInteger(credit)).toBe(true);
  });

  it("rounds profit toward the house", () => {
    // 333 * 0.67 = 223.11 -> profit floors to 223, total 556
    expect(settlementCredit(333, 67, "WON")).toBe(556);
  });
});

describe("settlementPnl", () => {
  it("is positive profit on a win", () => {
    expect(settlementPnl(10_000, 92, "WON")).toBe(9_200);
  });

  it("is the negative stake on a loss", () => {
    expect(settlementPnl(10_000, 92, "LOST")).toBe(-10_000);
  });

  it("is zero on a refund", () => {
    expect(settlementPnl(10_000, 92, "REFUNDED")).toBe(0);
  });
});

describe("durations", () => {
  it("offers the thirteen platform durations", () => {
    expect(DURATIONS_SEC.length).toBe(13);
    expect(DURATIONS_SEC[0]).toBe(5);
    expect(DURATIONS_SEC[DURATIONS_SEC.length - 1]).toBe(14_400);
  });

  it("accepts a listed duration and rejects anything else", () => {
    expect(isValidDuration(60)).toBe(true);
    expect(isValidDuration(37)).toBe(false);
  });
});
```

Create `packages/trading/src/expiry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { expirySecFor } from "./expiry";

describe("expirySecFor", () => {
  it("keeps an exact whole second", () => {
    expect(expirySecFor(1_757_534_400_000)).toBe(1_757_534_400);
  });

  it("rounds any fraction of a second up, so no trade settles early", () => {
    expect(expirySecFor(1_757_534_400_001)).toBe(1_757_534_401);
    expect(expirySecFor(1_757_534_400_999)).toBe(1_757_534_401);
  });
});
```

Create `packages/trading/src/credit-split.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitSettlementCredit } from "./credit-split";

describe("splitSettlementCredit", () => {
  it("returns everything to real when the stake was all real money", () => {
    expect(splitSettlementCredit(20_000, 10_000, 0)).toEqual({ toReal: 20_000, toBonus: 0 });
  });

  it("returns everything to bonus when the stake was all bonus money", () => {
    expect(splitSettlementCredit(20_000, 10_000, 10_000)).toEqual({ toReal: 0, toBonus: 20_000 });
  });

  it("splits in the stake's proportion", () => {
    // 60% of the stake came from bonus, so 60% of the credit returns there.
    expect(splitSettlementCredit(20_000, 10_000, 6_000)).toEqual({ toReal: 8_000, toBonus: 12_000 });
  });

  it("refunds a mixed stake back to exactly where it came from", () => {
    expect(splitSettlementCredit(10_000, 10_000, 3_500)).toEqual({ toReal: 6_500, toBonus: 3_500 });
  });

  it("always sums to the credit, whatever the rounding", () => {
    for (const [credit, stake, bonus] of [
      [557, 333, 111],
      [1, 3, 1],
      [19_999, 7, 5],
      [0, 10, 4],
    ] as const) {
      const { toReal, toBonus } = splitSettlementCredit(credit, stake, bonus);
      expect(toReal + toBonus).toBe(credit);
      expect(Number.isInteger(toBonus)).toBe(true);
    }
  });

  it("rejects a bonus share larger than the stake", () => {
    expect(() => splitSettlementCredit(100, 10, 11)).toThrow(/stakeFromBonus/);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
pnpm install
pnpm --filter @asm/trading exec vitest run
```

Expected: FAIL — the imported modules do not exist yet.

- [ ] **Step 5: Write `packages/trading/src/durations.ts`**

```ts
/** The thirteen durations the platform offers, in seconds. */
export const DURATIONS_SEC = [
  5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400,
] as const;

const ALLOWED = new Set<number>(DURATIONS_SEC);

export function isValidDuration(seconds: number): boolean {
  return ALLOWED.has(seconds);
}
```

- [ ] **Step 6: Write `packages/trading/src/outcome.ts`**

```ts
export type Direction = "UP" | "DOWN";
export type Outcome = "WON" | "LOST" | "REFUNDED";

/**
 * A binary option settles on a strict comparison against the entry price.
 * An exact tie is a refund, not a loss — counting it as a loss would bias every
 * win-rate estimate downward and is a classic silent error.
 */
export function didWin(
  direction: Direction,
  entryPrice: number,
  exitPrice: number,
): Outcome {
  if (exitPrice === entryPrice) return "REFUNDED";
  const rose = exitPrice > entryPrice;
  const won = direction === "UP" ? rose : !rose;
  return won ? "WON" : "LOST";
}

/**
 * What lands back in the account, in minor units.
 * Profit floors rather than rounds, so sub-unit remainders favour the house —
 * one deterministic rounding boundary, always in the same direction.
 */
export function settlementCredit(
  stake: number,
  payoutPct: number,
  outcome: Outcome,
): number {
  if (!Number.isInteger(stake) || stake <= 0) {
    throw new Error(`stake must be a positive integer, received ${stake}`);
  }
  switch (outcome) {
    case "WON":
      return stake + Math.floor((stake * payoutPct) / 100);
    case "REFUNDED":
      return stake;
    case "LOST":
      return 0;
  }
}

/** Signed profit or loss, in minor units. */
export function settlementPnl(
  stake: number,
  payoutPct: number,
  outcome: Outcome,
): number {
  switch (outcome) {
    case "WON":
      return Math.floor((stake * payoutPct) / 100);
    case "REFUNDED":
      return 0;
    case "LOST":
      return -stake;
  }
}
```

- [ ] **Step 7: Write `packages/trading/src/expiry.ts`**

```ts
/**
 * The whole second at which a position settles.
 *
 * The engine settles on the first tick whose whole second is at or past this
 * value, so rounding UP guarantees a trade never settles before its full
 * duration has elapsed. Rounding down would shave up to a second off every
 * trade — on a 5-second trade, a fifth of it.
 */
export function expirySecFor(expiryMs: number): number {
  return Math.ceil(expiryMs / 1000);
}
```

- [ ] **Step 8: Write `packages/trading/src/credit-split.ts`**

```ts
/**
 * Splits a settlement credit between the real and bonus balances in the same
 * proportion the stake was drawn from them.
 *
 * Without this, staking bonus money and taking a refund — or a win — would
 * hand it back as withdrawable real money, and a deposit bonus becomes a
 * one-trade step around its turnover requirement.
 *
 * The bonus share floors, so rounding favours the real balance by at most one
 * minor unit and the two parts always sum to the credit exactly.
 */
export function splitSettlementCredit(
  credit: number,
  stake: number,
  stakeFromBonus: number,
): { toReal: number; toBonus: number } {
  if (!Number.isInteger(credit) || credit < 0) {
    throw new Error(`credit must be a non-negative integer, received ${credit}`);
  }
  if (!Number.isInteger(stake) || stake <= 0) {
    throw new Error(`stake must be a positive integer, received ${stake}`);
  }
  if (!Number.isInteger(stakeFromBonus) || stakeFromBonus < 0 || stakeFromBonus > stake) {
    throw new Error(`stakeFromBonus must be an integer in [0, stake], received ${stakeFromBonus}`);
  }
  const toBonus = Math.floor((credit * stakeFromBonus) / stake);
  return { toReal: credit - toBonus, toBonus };
}
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
pnpm --filter @asm/trading exec vitest run
```

Expected: PASS — 24 tests (16 outcome/duration, 2 expiry, 6 credit split).

- [ ] **Step 10: Commit**

```bash
git add packages/trading pnpm-lock.yaml
git commit -m "feat(trading): outcome, settlement credit split, and expiry arithmetic"
```

---

## Task 2: Expiry bucket registry

**Files:**
- Create: `packages/trading/src/buckets.ts`, `packages/trading/src/index.ts`
- Test: `packages/trading/src/buckets.test.ts`

**Interfaces:**
- Produces:
  - `Position = { tradeId; accountId; assetId; direction; stake; payoutPct; entryPrice; expirySec }`
  - `ExpiryBucket = { assetId; expirySec; positions: Position[] }`
  - `class BucketRegistry` with `add`, `due(nowSec)` (removes and returns every bucket at or before `nowSec`, oldest first), `openFor(assetId)`, `size()`, `remove(tradeId)`

Plan 04's imbalance calculation reads `openFor(assetId)`. That is why this is a standalone pure class, not inline engine state.

- [ ] **Step 1: Write the failing test**

Create `packages/trading/src/buckets.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { BucketRegistry, type Position } from "./buckets";

let seq = 0;

function pos(overrides: Partial<Position> = {}): Position {
  return {
    tradeId: `t-${++seq}`,
    accountId: "acct-1",
    assetId: "asset-1",
    direction: "UP",
    stake: 10_000,
    payoutPct: 100,
    entryPrice: 1.175,
    expirySec: 1_757_534_400,
    ...overrides,
  };
}

describe("BucketRegistry", () => {
  let registry: BucketRegistry;

  beforeEach(() => {
    registry = new BucketRegistry();
  });

  it("starts empty", () => {
    expect(registry.size()).toBe(0);
    expect(registry.due(1_757_534_400)).toEqual([]);
  });

  it("groups positions sharing an asset and expiry second", () => {
    registry.add(pos({ tradeId: "a" }));
    registry.add(pos({ tradeId: "b" }));
    const buckets = registry.due(1_757_534_400);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.positions).toHaveLength(2);
  });

  it("keeps different assets in separate buckets at the same second", () => {
    registry.add(pos({ tradeId: "a", assetId: "asset-1" }));
    registry.add(pos({ tradeId: "b", assetId: "asset-2" }));
    expect(registry.due(1_757_534_400)).toHaveLength(2);
  });

  it("keeps different expiry seconds in separate buckets", () => {
    registry.add(pos({ tradeId: "a", expirySec: 1_757_534_400 }));
    registry.add(pos({ tradeId: "b", expirySec: 1_757_534_401 }));
    expect(registry.due(1_757_534_401)).toHaveLength(2);
  });

  it("does not return buckets that are not yet due", () => {
    registry.add(pos({ expirySec: 1_757_534_500 }));
    expect(registry.due(1_757_534_400)).toEqual([]);
    expect(registry.size()).toBe(1);
  });

  it("returns overdue buckets so a stalled loop still settles them", () => {
    registry.add(pos({ expirySec: 1_757_534_300 }));
    registry.add(pos({ expirySec: 1_757_534_350, tradeId: "b" }));
    expect(registry.due(1_757_534_400)).toHaveLength(2);
  });

  it("removes buckets once returned as due", () => {
    registry.add(pos());
    expect(registry.due(1_757_534_400)).toHaveLength(1);
    expect(registry.due(1_757_534_400)).toEqual([]);
    expect(registry.size()).toBe(0);
  });

  it("returns due buckets in expiry order", () => {
    registry.add(pos({ tradeId: "later", expirySec: 1_757_534_400 }));
    registry.add(pos({ tradeId: "earlier", expirySec: 1_757_534_200 }));
    const buckets = registry.due(1_757_534_400);
    expect(buckets[0]!.expirySec).toBe(1_757_534_200);
  });

  it("lists open positions for one asset only", () => {
    registry.add(pos({ tradeId: "a", assetId: "asset-1" }));
    registry.add(pos({ tradeId: "b", assetId: "asset-1", expirySec: 1_757_534_500 }));
    registry.add(pos({ tradeId: "c", assetId: "asset-2" }));
    const open = registry.openFor("asset-1");
    expect(open).toHaveLength(2);
    expect(open.every((p) => p.assetId === "asset-1")).toBe(true);
  });

  it("removes a single position by trade id", () => {
    registry.add(pos({ tradeId: "keep" }));
    registry.add(pos({ tradeId: "drop" }));
    expect(registry.remove("drop")).toBe(true);
    expect(registry.remove("missing")).toBe(false);
    expect(registry.size()).toBe(1);
  });

  it("drops the bucket entirely when its last position is removed", () => {
    registry.add(pos({ tradeId: "only" }));
    registry.remove("only");
    expect(registry.due(1_757_534_400)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @asm/trading exec vitest run src/buckets.test.ts
```

Expected: FAIL — `./buckets` does not exist.

- [ ] **Step 3: Write `packages/trading/src/buckets.ts`**

```ts
import type { Direction } from "./outcome";

export interface Position {
  readonly tradeId: string;
  readonly accountId: string;
  readonly assetId: string;
  readonly direction: Direction;
  readonly stake: number;
  readonly payoutPct: number;
  readonly entryPrice: number;
  /** Epoch seconds. */
  readonly expirySec: number;
}

export interface ExpiryBucket {
  readonly assetId: string;
  readonly expirySec: number;
  readonly positions: Position[];
}

function keyOf(assetId: string, expirySec: number): string {
  return `${assetId}|${expirySec}`;
}

/**
 * In-memory index of open positions, grouped by (asset, expiry second).
 *
 * Bucketing matters for correctness, not just convenience: every position
 * expiring in the same second must settle against ONE captured price, or two
 * accounts receive inconsistent outcomes from the same moment.
 */
export class BucketRegistry {
  private buckets = new Map<string, Position[]>();
  private index = new Map<string, string>();

  add(position: Position): void {
    const key = keyOf(position.assetId, position.expirySec);
    const existing = this.buckets.get(key);
    if (existing) {
      existing.push(position);
    } else {
      this.buckets.set(key, [position]);
    }
    this.index.set(position.tradeId, key);
  }

  /**
   * Returns every bucket at or before `nowSec`, removing them.
   * Overdue buckets are included deliberately — if the loop stalled, those
   * trades must still settle rather than being silently stranded.
   */
  due(nowSec: number): ExpiryBucket[] {
    const out: ExpiryBucket[] = [];

    for (const [key, positions] of this.buckets) {
      const expirySec = Number(key.slice(key.indexOf("|") + 1));
      if (expirySec > nowSec) continue;
      out.push({
        assetId: key.slice(0, key.indexOf("|")),
        expirySec,
        positions,
      });
    }

    for (const bucket of out) {
      const key = keyOf(bucket.assetId, bucket.expirySec);
      this.buckets.delete(key);
      for (const position of bucket.positions) this.index.delete(position.tradeId);
    }

    return out.sort((a, b) => a.expirySec - b.expirySec);
  }

  /** Every open position on one asset. Plan 04's imbalance calculation reads this. */
  openFor(assetId: string): Position[] {
    const out: Position[] = [];
    for (const [key, positions] of this.buckets) {
      if (key.slice(0, key.indexOf("|")) === assetId) out.push(...positions);
    }
    return out;
  }

  size(): number {
    return this.index.size;
  }

  remove(tradeId: string): boolean {
    const key = this.index.get(tradeId);
    if (!key) return false;

    const positions = this.buckets.get(key);
    if (!positions) {
      this.index.delete(tradeId);
      return false;
    }

    const next = positions.filter((p) => p.tradeId !== tradeId);
    if (next.length === 0) {
      this.buckets.delete(key);
    } else {
      this.buckets.set(key, next);
    }
    this.index.delete(tradeId);
    return true;
  }
}
```

- [ ] **Step 4: Write `packages/trading/src/index.ts`**

```ts
export {
  didWin,
  settlementCredit,
  settlementPnl,
  type Direction,
  type Outcome,
} from "./outcome";
export { DURATIONS_SEC, isValidDuration } from "./durations";
export { expirySecFor } from "./expiry";
export { splitSettlementCredit } from "./credit-split";
export {
  BucketRegistry,
  type Position,
  type ExpiryBucket,
} from "./buckets";
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @asm/trading test
```

Expected: PASS — 35 tests total.

- [ ] **Step 6: Commit**

```bash
git add packages/trading
git commit -m "feat(trading): expiry bucket registry"
```

---

## Task 3: Trade contracts and WebSocket message additions

**Files:**
- Create: `packages/contracts/src/trade.ts`
- Modify: `packages/contracts/src/ws.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/trade.test.ts`

**Interfaces:**
- Consumes: `SymbolSchema` from Plan 02
- Produces:
  - `OpenTradeSchema` (browser → web), `EngineOpenTradeSchema` (web → engine, adds `actorId`)
  - `TradeView`, `BalancesDto`, `OpenTradeResult`, `TradeRowLike`, `TRADE_DURATIONS_SEC`
  - `tradeViewFrom(row, symbol): TradeView` — the only way a trade row becomes client JSON
  - `ServerMessage` members `TradeOpenedMessage`, `TradeSettledMessage`, `BalanceUpdateMessage`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/trade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EngineOpenTradeSchema, OpenTradeSchema, tradeViewFrom } from "./trade";

const valid = {
  symbol: "AUDNZD_OTC",
  direction: "UP" as const,
  stake: 10_000,
  durationSec: 60,
  accountId: "3f2a9c1e-0000-4000-8000-000000000000",
};

describe("OpenTradeSchema", () => {
  it("accepts a valid request", () => {
    expect(OpenTradeSchema.parse(valid).stake).toBe(10_000);
  });

  it("rejects a client-supplied entry price", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, entryPrice: 1.0 }).success).toBe(false);
  });

  it("rejects a client-supplied expiry timestamp", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, expiryTs: 0 }).success).toBe(false);
  });

  it("rejects a client-supplied payout", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, payoutPct: 500 }).success).toBe(false);
  });

  it("rejects a client-supplied actor", () => {
    expect(
      OpenTradeSchema.safeParse({ ...valid, actorId: "3f2a9c1e-0000-4000-8000-000000000001" }).success,
    ).toBe(false);
  });

  it("rejects a negative, zero, or fractional stake", () => {
    for (const stake of [-100, 0, 100.5]) {
      expect(OpenTradeSchema.safeParse({ ...valid, stake }).success).toBe(false);
    }
  });

  it("rejects an unlisted duration", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, durationSec: 37 }).success).toBe(false);
  });

  it("rejects an invalid direction", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, direction: "SIDEWAYS" }).success).toBe(false);
  });

  it("rejects an account id that is not a uuid", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, accountId: "1; DROP TABLE" }).success).toBe(false);
  });
});

describe("EngineOpenTradeSchema", () => {
  it("requires the actor the web app verified", () => {
    expect(EngineOpenTradeSchema.safeParse(valid).success).toBe(false);
    expect(
      EngineOpenTradeSchema.safeParse({ ...valid, actorId: "3f2a9c1e-0000-4000-8000-000000000001" }).success,
    ).toBe(true);
  });

  it("is still strict about server-owned fields", () => {
    expect(
      EngineOpenTradeSchema.safeParse({
        ...valid,
        actorId: "3f2a9c1e-0000-4000-8000-000000000001",
        entryPrice: 1,
      }).success,
    ).toBe(false);
  });
});

describe("tradeViewFrom", () => {
  const row = {
    id: "t1",
    accountId: "a1",
    assetId: "asset-1",
    direction: "UP" as const,
    stake: 10_000,
    stakeFromBonus: 4_000,
    payoutPct: 92,
    entryPrice: 1.175,
    entryTs: new Date("2026-09-14T10:00:00.900Z"),
    expiryTs: new Date("2026-09-14T10:01:00.900Z"),
    exitPrice: 1.176,
    status: "WON" as const,
    pnl: 9_200,
    createdAt: new Date(),
    shadow: { honestResult: "LOST" },
  };

  it("copies exactly the client-facing fields and nothing else", () => {
    expect(Object.keys(tradeViewFrom(row, "AUDNZD_OTC")).sort()).toEqual(
      [
        "accountId",
        "direction",
        "entryPrice",
        "entryTs",
        "exitPrice",
        "expiryTs",
        "id",
        "payoutPct",
        "pnl",
        "stake",
        "status",
        "symbol",
      ].sort(),
    );
  });

  it("converts timestamps to epoch seconds", () => {
    const view = tradeViewFrom(row, "AUDNZD_OTC");
    expect(view.entryTs).toBe(Math.floor(Date.parse("2026-09-14T10:00:00Z") / 1000));
    expect(view.expiryTs - view.entryTs).toBe(60);
  });
});
```

The first five cases express the threat model's control as assertions. A request that tries to dictate price, expiry, payout, or identity is **rejected**, not stripped.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @asm/contracts exec vitest run src/trade.test.ts
```

Expected: FAIL — `./trade` does not exist.

- [ ] **Step 3: Write `packages/contracts/src/trade.ts`**

```ts
import { z } from "zod";
import { SymbolSchema } from "./ws";

/** Mirrors DURATIONS_SEC in @asm/trading. Kept literal so contracts stays dependency-free. */
export const TRADE_DURATIONS_SEC = [
  5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400,
] as const;

export const DirectionSchema = z.enum(["UP", "DOWN"]);
export type DirectionDto = z.infer<typeof DirectionSchema>;

const tradeRequestShape = {
  symbol: SymbolSchema,
  direction: DirectionSchema,
  /** Minor units. Positive integer. */
  stake: z.number().int().positive().max(100_000_000),
  durationSec: z
    .number()
    .int()
    .refine((v) => (TRADE_DURATIONS_SEC as readonly number[]).includes(v), {
      message: "Duration is not one of the offered values",
    }),
  accountId: z.uuid(),
};

/**
 * Browser -> web app. Strict by design: a request carrying entryPrice,
 * expiryTs or payoutPct is rejected outright — those are server-determined,
 * and an attempt to supply them is worth logging, not silently discarding.
 */
export const OpenTradeSchema = z.strictObject(tradeRequestShape);
export type OpenTradeInput = z.infer<typeof OpenTradeSchema>;

/**
 * Web app -> engine, over loopback. The actor is added by the web app from
 * the verified session; it never comes from the browser.
 */
export const EngineOpenTradeSchema = z.strictObject({
  ...tradeRequestShape,
  actorId: z.uuid(),
});
export type EngineOpenTradeInput = z.infer<typeof EngineOpenTradeSchema>;

export type TradeStatusDto = "OPEN" | "WON" | "LOST" | "REFUNDED";

export interface TradeView {
  id: string;
  accountId: string;
  symbol: string;
  direction: DirectionDto;
  stake: number;
  payoutPct: number;
  entryPrice: number;
  /** Epoch seconds. */
  entryTs: number;
  /** Epoch seconds. */
  expiryTs: number;
  exitPrice: number | null;
  status: TradeStatusDto;
  pnl: number;
}

export interface BalancesDto {
  realBalance: number;
  bonusBalance: number;
}

export interface OpenTradeResult {
  trade: TradeView;
  balances: BalancesDto;
}

/** The columns a trade row needs to be shown. Structural, so contracts never imports Prisma. */
export interface TradeRowLike {
  id: string;
  accountId: string;
  direction: DirectionDto;
  stake: number;
  payoutPct: number;
  entryPrice: number;
  entryTs: Date;
  expiryTs: Date;
  exitPrice: number | null;
  status: TradeStatusDto;
  pnl: number;
}

/**
 * The only way a trade row becomes client-facing JSON. Fields are copied one
 * at a time — never spread — so a column added to Trade later, or a joined
 * shadow record, cannot reach a trading client by accident.
 */
export function tradeViewFrom(row: TradeRowLike, symbol: string): TradeView {
  return {
    id: row.id,
    accountId: row.accountId,
    symbol,
    direction: row.direction,
    stake: row.stake,
    payoutPct: row.payoutPct,
    entryPrice: row.entryPrice,
    entryTs: Math.floor(row.entryTs.getTime() / 1000),
    expiryTs: Math.floor(row.expiryTs.getTime() / 1000),
    exitPrice: row.exitPrice,
    status: row.status,
    pnl: row.pnl,
  };
}
```

- [ ] **Step 4: Add the trade messages to `packages/contracts/src/ws.ts`**

Add below the `zod` import:

```ts
import type { TradeView } from "./trade";
```

A type-only import, so the `trade.ts → ws.ts` value import creates no runtime cycle.

Add after `AuthedMessage`:

```ts
export interface TradeOpenedMessage {
  type: "trade:opened";
  trade: TradeView;
}

export interface TradeSettledMessage {
  type: "trade:settled";
  trade: TradeView;
}

export interface BalanceUpdateMessage {
  type: "balance:update";
  accountId: string;
  realBalance: number;
  bonusBalance: number;
}
```

and add `| TradeOpenedMessage | TradeSettledMessage | BalanceUpdateMessage` to the end of the `ServerMessage` union.

- [ ] **Step 5: Export from `packages/contracts/src/index.ts`**

Add `type TradeOpenedMessage, type TradeSettledMessage, type BalanceUpdateMessage,` to the existing `./ws` export block, and append:

```ts
export {
  TRADE_DURATIONS_SEC,
  DirectionSchema,
  OpenTradeSchema,
  EngineOpenTradeSchema,
  tradeViewFrom,
  type DirectionDto,
  type OpenTradeInput,
  type EngineOpenTradeInput,
  type TradeStatusDto,
  type TradeView,
  type TradeRowLike,
  type BalancesDto,
  type OpenTradeResult,
} from "./trade";
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @asm/contracts test
```

Expected: PASS, including 13 new trade tests.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): trade request schemas, trade view mapper, trade ws messages"
```

---

## Task 4: Stake split column and the atomic trade repository

**Files:**
- Modify: `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`, `packages/db/package.json`
- Create: `packages/db/prisma/migrations/<generated>_trade_stake_from_bonus/migration.sql`, `packages/db/src/repositories/trade.ts`
- Test: `packages/db/src/repositories/trade.test.ts`

**Interfaces:**
- Consumes: `prisma` (Plan 01); `didWin`, `settlementCredit`, `settlementPnl`, `splitSettlementCredit`, `expirySecFor`, `Position` from `@asm/trading`
- Produces:
  - `class InsufficientFunds`, `class ConcurrentModification`, `class AlreadySettled`, `class TradeNotFound`
  - `openTrade(input: OpenTradeInput): Promise<OpenedTrade>` — `OpenedTrade = { trade: Trade; realBalance: number; bonusBalance: number }`
  - `settleTrade(input: { tradeId; exitPrice }): Promise<SettledTrade>` — `SettledTrade = { trade: Trade; userId: string; realBalance: number; bonusBalance: number }`
  - `voidTrade(tradeId: string): Promise<SettledTrade>`
  - `listTradesForActor(actorId, accountId, limit): Promise<Trade[]>`
  - `loadOpenPositions(): Promise<Position[]>`

**Why one transaction.** The balance, the trade row, and the ledger row must move together. If any
of them can change without the others, a crash leaves either missing money or an unpaid win the
idempotency guard then refuses to pay. Plan 04 extends `settleTrade` by adding writes *inside* the
same transaction (the shadow ledger and account statistics), never after it.

- [ ] **Step 1: Add the column**

In `packages/db/prisma/schema.prisma`, `model Trade`, add after `stake`:

```prisma
  /// The part of `stake` drawn from bonusBalance. Settlement credits return in this proportion.
  stakeFromBonus Int         @default(0)
```

```bash
cd packages/db
pnpm exec prisma migrate dev --name trade_stake_from_bonus
DATABASE_MIGRATE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec prisma migrate deploy
cd ../..
```

- [ ] **Step 2: Add the trading dependency**

```bash
pnpm --filter @asm/db add @asm/trading@workspace:*
```

- [ ] **Step 3: Write the failing test**

Create `packages/db/src/repositories/trade.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import {
  AlreadySettled,
  InsufficientFunds,
  listTradesForActor,
  loadOpenPositions,
  openTrade,
  settleTrade,
  voidTrade,
  type OpenTradeInput,
} from "./trade";

const RUN = randomUUID();
let assetId = "";
let seq = 0;

beforeAll(async () => {
  assetId = (await prisma.asset.findFirstOrThrow({ where: { symbol: "AUDNZD_OTC" } })).id;
});

afterAll(async () => {
  // Cascades to accounts, trades and ledger rows.
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function demoAccount(balance = 1_000_000): Promise<{ userId: string; accountId: string }> {
  seq += 1;
  const user = await prisma.user.create({
    data: { email: `trade-${RUN}-${seq}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, balance);
  return { userId: user.id, accountId: accounts.find((a) => a.type === "DEMO")!.id };
}

function order(accountId: string, overrides: Partial<OpenTradeInput> = {}): OpenTradeInput {
  return {
    accountId,
    assetId,
    direction: "UP",
    stake: 10_000,
    payoutPct: 100,
    entryPrice: 1.175,
    entryTs: new Date(),
    expiryTs: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

async function balanceOf(accountId: string): Promise<{ real: number; bonus: number }> {
  const a = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  return { real: a.realBalance, bonus: a.bonusBalance };
}

describe("openTrade", () => {
  it("debits the stake, records the trade, and writes its ledger row together", async () => {
    const { accountId } = await demoAccount();
    const opened = await openTrade(order(accountId));

    expect(opened.trade.status).toBe("OPEN");
    expect(opened.realBalance).toBe(990_000);

    const ledger = await prisma.transaction.findMany({ where: { accountId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      kind: "TRADE_STAKE",
      amount: -10_000,
      balanceAfter: 990_000,
      refType: "Trade",
      refId: opened.trade.id,
    });
  });

  it("refuses an unaffordable stake and leaves no trace", async () => {
    const { accountId } = await demoAccount();
    await expect(openTrade(order(accountId, { stake: 2_000_000 }))).rejects.toBeInstanceOf(
      InsufficientFunds,
    );
    expect(await balanceOf(accountId)).toEqual({ real: 1_000_000, bonus: 0 });
    expect(await prisma.trade.count({ where: { accountId } })).toBe(0);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
  });

  it("draws real balance before bonus and records the bonus part", async () => {
    const { accountId } = await demoAccount();
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 5_000, bonusBalance: 20_000 },
    });
    const opened = await openTrade(order(accountId));
    expect(opened.realBalance).toBe(0);
    expect(opened.bonusBalance).toBe(15_000);
    expect(opened.trade.stakeFromBonus).toBe(5_000);
  });

  it("never over-debits under concurrency, and every success has exactly one trade and ledger row", async () => {
    const { accountId } = await demoAccount();
    // 1,000,000 available; ten parallel 200,000 stakes -> at most five can succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => openTrade(order(accountId, { stake: 200_000 }))),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    const { real } = await balanceOf(accountId);
    expect(succeeded).toBeLessThanOrEqual(5);
    expect(real).toBeGreaterThanOrEqual(0);
    expect(real).toBe(1_000_000 - succeeded * 200_000);
    expect(await prisma.trade.count({ where: { accountId } })).toBe(succeeded);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(succeeded);
  });

  it("increments the account version on every debit", async () => {
    const { accountId } = await demoAccount();
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await openTrade(order(accountId, { stake: 1_000 }));
    const after = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(after.version).toBe(before.version + 1);
  });
});

describe("listTradesForActor", () => {
  it("returns an account's trades only to its owner", async () => {
    const owner = await demoAccount();
    const stranger = await demoAccount();
    await openTrade(order(owner.accountId));

    expect(await listTradesForActor(stranger.userId, owner.accountId, 50)).toEqual([]);
    expect(await listTradesForActor(owner.userId, owner.accountId, 50)).toHaveLength(1);
  });
});

describe("settleTrade", () => {
  it("credits stake plus profit on a win and reports the owner", async () => {
    const { userId, accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });

    expect(settled.trade.status).toBe("WON");
    expect(settled.trade.pnl).toBe(10_000);
    expect(settled.realBalance).toBe(1_010_000);
    expect(settled.userId).toBe(userId);
  });

  it("credits nothing on a loss", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.174 });
    expect(settled.trade.status).toBe("LOST");
    expect(settled.trade.pnl).toBe(-10_000);
    expect(settled.realBalance).toBe(990_000);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1);
  });

  it("refunds the stake on an exact tie", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId, { direction: "DOWN" }));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.175 });
    expect(settled.trade.status).toBe("REFUNDED");
    expect(settled.realBalance).toBe(1_000_000);
  });

  it("is idempotent — a second settlement throws and pays nothing", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    await expect(settleTrade({ tradeId: trade.id, exitPrice: 1.176 })).rejects.toBeInstanceOf(
      AlreadySettled,
    );
    expect((await balanceOf(accountId)).real).toBe(1_010_000);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(2);
  });

  it("returns a bonus-funded stake's winnings to bonus in the stake's proportion", async () => {
    const { accountId } = await demoAccount();
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 4_000, bonusBalance: 6_000 },
    });
    const { trade } = await openTrade(order(accountId));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    expect(settled.realBalance).toBe(8_000);
    expect(settled.bonusBalance).toBe(12_000);
  });

  it("writes a payout ledger row whose balanceAfter matches the account", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    const payout = await prisma.transaction.findFirstOrThrow({
      where: { accountId, kind: "TRADE_PAYOUT" },
    });
    expect(payout.amount).toBe(20_000);
    expect(payout.refId).toBe(trade.id);
    expect(payout.balanceAfter).toBe(settled.realBalance + settled.bonusBalance);
  });
});

describe("voidTrade", () => {
  it("refunds the stake with no exit price", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    const voided = await voidTrade(trade.id);
    expect(voided.trade.status).toBe("REFUNDED");
    expect(voided.trade.exitPrice).toBeNull();
    expect(voided.realBalance).toBe(1_000_000);
  });
});

describe("loadOpenPositions", () => {
  it("includes open trades with expiry rounded up, and excludes settled ones", async () => {
    const { accountId } = await demoAccount();
    const expiryTs = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_500);
    const open = await openTrade(order(accountId, { expiryTs }));
    const closed = await openTrade(order(accountId, { expiryTs }));
    await settleTrade({ tradeId: closed.trade.id, exitPrice: 1.176 });

    const positions = await loadOpenPositions();
    const mine = positions.find((p) => p.tradeId === open.trade.id);
    expect(mine?.expirySec).toBe(Math.ceil(expiryTs.getTime() / 1000));
    expect(positions.some((p) => p.tradeId === closed.trade.id)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
set -a && source .env && set +a && \
  DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm --filter @asm/db exec vitest run src/repositories/trade.test.ts
```

Expected: FAIL — `./trade` does not exist.

- [ ] **Step 5: Write `packages/db/src/repositories/trade.ts`**

```ts
import {
  didWin,
  expirySecFor,
  settlementCredit,
  settlementPnl,
  splitSettlementCredit,
  type Outcome,
  type Position,
} from "@asm/trading";
import { prisma } from "../client";
import type { Direction, Prisma, Trade } from "../../generated/prisma/client";

export class InsufficientFunds extends Error {
  constructor() {
    super("Not enough balance for that stake.");
    this.name = "InsufficientFunds";
  }
}

export class ConcurrentModification extends Error {
  constructor() {
    super("The account changed while this request was in flight. Try again.");
    this.name = "ConcurrentModification";
  }
}

export class AlreadySettled extends Error {
  constructor(tradeId: string) {
    super(`Trade ${tradeId} is already settled.`);
    this.name = "AlreadySettled";
  }
}

export class TradeNotFound extends Error {
  constructor(tradeId: string) {
    super(`Trade ${tradeId} not found.`);
    this.name = "TradeNotFound";
  }
}

/** Thrown inside a transaction to roll it back for a retry. Never escapes this module. */
class VersionConflict extends Error {}

const MAX_ATTEMPTS = 5;

type Tx = Prisma.TransactionClient;

export interface OpenTradeInput {
  accountId: string;
  assetId: string;
  direction: Direction;
  stake: number;
  payoutPct: number;
  entryPrice: number;
  entryTs: Date;
  expiryTs: Date;
}

export interface OpenedTrade {
  trade: Trade;
  realBalance: number;
  bonusBalance: number;
}

export interface SettledTrade {
  trade: Trade;
  userId: string;
  realBalance: number;
  bonusBalance: number;
}

/**
 * Debits the stake and records the trade in ONE transaction, with its ledger row.
 *
 * Concurrency is optimistic: the debit is conditional on the version read in
 * the same transaction. Under READ COMMITTED a competing debit that commits
 * first makes this update match zero rows, so we roll back and retry against
 * the new balance. Two simultaneous trades therefore cannot both spend the
 * same money.
 *
 * Real balance is consumed before bonus, and the bonus part is recorded on the
 * trade so settlement can return it where it came from.
 */
export async function openTrade(input: OpenTradeInput): Promise<OpenedTrade> {
  if (!Number.isInteger(input.stake) || input.stake <= 0) {
    throw new Error(`stake must be a positive integer, received ${input.stake}`);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const account = await tx.account.findUnique({ where: { id: input.accountId } });
        if (!account) throw new Error(`Account ${input.accountId} not found`);
        if (account.realBalance + account.bonusBalance < input.stake) {
          throw new InsufficientFunds();
        }

        const fromReal = Math.min(account.realBalance, input.stake);
        const fromBonus = input.stake - fromReal;

        const claimed = await tx.account.updateMany({
          where: { id: account.id, version: account.version },
          data: {
            realBalance: { decrement: fromReal },
            bonusBalance: { decrement: fromBonus },
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new VersionConflict();

        const trade = await tx.trade.create({
          data: {
            accountId: input.accountId,
            assetId: input.assetId,
            direction: input.direction,
            stake: input.stake,
            stakeFromBonus: fromBonus,
            // Snapshotted, so a later payout change cannot alter this position's terms.
            payoutPct: input.payoutPct,
            entryPrice: input.entryPrice,
            entryTs: input.entryTs,
            expiryTs: input.expiryTs,
            status: "OPEN",
          },
        });

        const realBalance = account.realBalance - fromReal;
        const bonusBalance = account.bonusBalance - fromBonus;

        await tx.transaction.create({
          data: {
            accountId: input.accountId,
            kind: "TRADE_STAKE",
            amount: -input.stake,
            balanceAfter: realBalance + bonusBalance,
            refType: "Trade",
            refId: trade.id,
          },
        });

        return { trade, realBalance, bonusBalance };
      });
    } catch (err) {
      if (err instanceof VersionConflict) continue;
      throw err;
    }
  }

  throw new ConcurrentModification();
}

type TradeWithOwner = Trade & { account: { userId: string } };

/**
 * Claims, credits and records one settlement inside the caller's transaction.
 * The status guard on the claim is what makes settlement idempotent: a replay
 * matches zero rows and throws before any money moves.
 */
async function applySettlement(
  tx: Tx,
  trade: TradeWithOwner,
  outcome: Outcome,
  exitPrice: number | null,
): Promise<SettledTrade> {
  const credit = settlementCredit(trade.stake, trade.payoutPct, outcome);
  const pnl = settlementPnl(trade.stake, trade.payoutPct, outcome);

  const claimed = await tx.trade.updateMany({
    where: { id: trade.id, status: "OPEN" },
    data: { status: outcome, exitPrice, pnl },
  });
  if (claimed.count !== 1) throw new AlreadySettled(trade.id);

  let realBalance: number;
  let bonusBalance: number;

  if (credit > 0) {
    const { toReal, toBonus } = splitSettlementCredit(credit, trade.stake, trade.stakeFromBonus);
    const account = await tx.account.update({
      where: { id: trade.accountId },
      data: {
        realBalance: { increment: toReal },
        bonusBalance: { increment: toBonus },
        version: { increment: 1 },
      },
    });
    realBalance = account.realBalance;
    bonusBalance = account.bonusBalance;

    await tx.transaction.create({
      data: {
        accountId: trade.accountId,
        kind: outcome === "REFUNDED" ? "TRADE_REFUND" : "TRADE_PAYOUT",
        amount: credit,
        balanceAfter: realBalance + bonusBalance,
        refType: "Trade",
        refId: trade.id,
      },
    });
  } else {
    const account = await tx.account.findUniqueOrThrow({
      where: { id: trade.accountId },
      select: { realBalance: true, bonusBalance: true },
    });
    realBalance = account.realBalance;
    bonusBalance = account.bonusBalance;
  }

  const settled = await tx.trade.findUniqueOrThrow({ where: { id: trade.id } });
  return { trade: settled, userId: trade.account.userId, realBalance, bonusBalance };
}

async function loadOpenTrade(tx: Tx, tradeId: string): Promise<TradeWithOwner> {
  const trade = await tx.trade.findUnique({
    where: { id: tradeId },
    include: { account: { select: { userId: true } } },
  });
  if (!trade) throw new TradeNotFound(tradeId);
  if (trade.status !== "OPEN") throw new AlreadySettled(tradeId);
  return trade;
}

/** Settles one trade against a captured exit price, in one transaction. */
export async function settleTrade(input: {
  tradeId: string;
  exitPrice: number;
}): Promise<SettledTrade> {
  return prisma.$transaction(async (tx) => {
    const trade = await loadOpenTrade(tx, input.tradeId);
    const outcome = didWin(trade.direction, trade.entryPrice, input.exitPrice);
    return applySettlement(tx, trade, outcome, input.exitPrice);
  });
}

/**
 * Refunds a trade whose expiry passed while the engine was down. There is no
 * authoritative price for that moment, so it is recorded as REFUNDED with no
 * exit price rather than settled against a price from after the fact.
 */
export async function voidTrade(tradeId: string): Promise<SettledTrade> {
  return prisma.$transaction(async (tx) => {
    const trade = await loadOpenTrade(tx, tradeId);
    return applySettlement(tx, trade, "REFUNDED", null);
  });
}

/** Ownership is in the predicate — a caller cannot read another account's trades. */
export async function listTradesForActor(
  actorId: string,
  accountId: string,
  limit: number,
): Promise<Trade[]> {
  return prisma.trade.findMany({
    where: { accountId, account: { userId: actorId } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

/** Rehydrates the engine's book after a restart. */
export async function loadOpenPositions(): Promise<Position[]> {
  const rows = await prisma.trade.findMany({ where: { status: "OPEN" } });
  return rows.map((row) => ({
    tradeId: row.id,
    accountId: row.accountId,
    assetId: row.assetId,
    direction: row.direction,
    stake: row.stake,
    payoutPct: row.payoutPct,
    entryPrice: row.entryPrice,
    expirySec: expirySecFor(row.expiryTs.getTime()),
  }));
}
```

`Prisma.TransactionClient` is exported by the generated client (`generated/prisma/client.ts`
re-exports the `Prisma` namespace, which declares `TransactionClient`).

- [ ] **Step 6: Export from `packages/db/src/index.ts`**

```ts
export {
  InsufficientFunds,
  ConcurrentModification,
  AlreadySettled,
  TradeNotFound,
  openTrade,
  settleTrade,
  voidTrade,
  listTradesForActor,
  loadOpenPositions,
  type OpenTradeInput,
  type OpenedTrade,
  type SettledTrade,
} from "./repositories/trade";
```

- [ ] **Step 7: Run the test to verify it passes**

Re-run the Step 4 command. Expected: PASS — 14 tests. The concurrency test is the one that
matters: if more than five stakes ever succeed, the double-spend is live.

- [ ] **Step 8: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): atomic trade repository with stake split and optimistic debits"
```

---

## Task 5: The engine's trade desk, settlement worker, and loopback control surface

**Files:**
- Create: `apps/engine/src/trading/errors.ts`, `apps/engine/src/trading/trade-desk.ts`, `apps/engine/src/internal-api.ts`
- Test: `apps/engine/src/trading/trade-desk.test.ts`, `apps/engine/src/internal-api.test.ts`
- Modify: `apps/engine/src/server.ts`, `apps/engine/src/loop.ts`, `apps/engine/src/main.ts`, `apps/engine/package.json`, `.env.example`

**Interfaces:**
- Consumes: Task 4's repository; `BucketRegistry`, `expirySecFor` from `@asm/trading`; `EngineOpenTradeSchema`, `tradeViewFrom` from `@asm/contracts`; `AssetRegistry`, `EngineServer`, `startTickLoop` from Plan 02
- Produces:
  - `EngineServer.sendToUser(userId, message): void`
  - `class DeskRejection` with `reason: "unknown_asset" | "account_not_found" | "insufficient_funds"`
  - `class TradeDesk` with `open(input)`, `hydrate(nowSec)`, `collectDue(nowSec)`, `openFor(assetId)`, `idle()`, `stop()`
  - `createInternalApi({ desk, secret, port }): { listen(): Promise<number>; close(): Promise<void> }` — `POST /trades`

**Why the engine opens trades.** The entry price, the position's registration for expiry, and the
socket push must happen together in the process that owns the price. The original design had the
web app fetch a price, write the trade, then register it with a second call. That left two gaps: a
failed registration stranded the trade, and the price could move between the fetch and the write.

- [ ] **Step 1: Add the dependency and environment**

```bash
pnpm --filter @asm/engine add @asm/trading@workspace:*
```

Append to `.env.example`:

```bash
# Engine loopback control surface (Plan 03). The web app opens trades through it.
ENGINE_HTTP_PORT="4002"
ENGINE_HTTP_URL="http://127.0.0.1:4002"
# Shared secret between the web app and the engine. Generate: openssl rand -base64 32
ENGINE_INTERNAL_SECRET="change-me-in-.env"
```

Add the same three lines to your local `.env`, with a freshly generated secret.

- [ ] **Step 2: Add `sendToUser` to `apps/engine/src/server.ts`**

Next to `broadcast`:

```ts
  /** Delivers to every socket authenticated as this user, regardless of subscription. */
  sendToUser(userId: string, message: ServerMessage): void {
    for (const client of this.clients) {
      if (client.userId === userId) this.send(client, message);
    }
  }
```

- [ ] **Step 3: Write `apps/engine/src/trading/errors.ts`**

```ts
export type DeskRejectionReason = "unknown_asset" | "account_not_found" | "insufficient_funds";

/** An expected refusal, mapped to a 4xx by the control surface — never a 500. */
export class DeskRejection extends Error {
  constructor(readonly reason: DeskRejectionReason) {
    super(reason);
    this.name = "DeskRejection";
  }
}
```

- [ ] **Step 4: Write the failing desk test**

Create `apps/engine/src/trading/trade-desk.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccountsForUser, openTrade, prisma } from "@asm/db";
import type { ServerMessage } from "@asm/contracts";
import { AssetRegistry } from "../assets/registry";
import { TradeDesk } from "./trade-desk";

const RUN = randomUUID();
const registry = new AssetRegistry(7);
const sent: { userId: string; message: ServerMessage }[] = [];
const notifier = { sendToUser: (userId: string, message: ServerMessage) => sent.push({ userId, message }) };
let desk: TradeDesk;
let seq = 0;

beforeAll(async () => {
  await registry.load();
  desk = new TradeDesk(registry, notifier);
});

afterAll(async () => {
  await desk.idle();
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function trader(balance = 1_000_000): Promise<{ userId: string; accountId: string }> {
  seq += 1;
  const user = await prisma.user.create({
    data: { email: `desk-${RUN}-${seq}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, balance);
  return { userId: user.id, accountId: accounts.find((a) => a.type === "DEMO")!.id };
}

function setPrice(price: number): void {
  const asset = registry.get("AUDNZD_OTC")!;
  asset.state = { ...asset.state, price };
}

const nowSec = () => Math.floor(Date.now() / 1000);

function request(t: { userId: string; accountId: string }, overrides: Record<string, unknown> = {}) {
  return {
    symbol: "AUDNZD_OTC",
    direction: "UP" as const,
    stake: 1_000,
    durationSec: 5,
    accountId: t.accountId,
    actorId: t.userId,
    ...overrides,
  };
}

describe("TradeDesk.open", () => {
  it("opens at the engine's own price, registers the position, and notifies the owner", async () => {
    const t = await trader();
    setPrice(1.175);
    const result = await desk.open(request(t));

    expect(result.trade.entryPrice).toBe(1.175);
    expect(result.trade.status).toBe("OPEN");
    expect(result.balances.realBalance).toBe(999_000);

    const assetId = registry.get("AUDNZD_OTC")!.id;
    expect(desk.openFor(assetId).some((p) => p.tradeId === result.trade.id)).toBe(true);

    const mine = sent.filter((s) => s.userId === t.userId).map((s) => s.message.type);
    expect(mine).toEqual(["trade:opened", "balance:update"]);
  });

  it("rejects an account the actor does not own", async () => {
    const owner = await trader();
    const stranger = await trader();
    await expect(
      desk.open(request(owner, { actorId: stranger.userId })),
    ).rejects.toMatchObject({ reason: "account_not_found" });
    expect(await prisma.trade.count({ where: { accountId: owner.accountId } })).toBe(0);
  });

  it("rejects a stake larger than the balance", async () => {
    const t = await trader(500);
    await expect(desk.open(request(t))).rejects.toMatchObject({ reason: "insufficient_funds" });
  });

  it("rejects an unknown asset", async () => {
    const t = await trader();
    await expect(desk.open(request(t, { symbol: "NOPE_OTC" }))).rejects.toMatchObject({
      reason: "unknown_asset",
    });
  });
});

describe("TradeDesk settlement", () => {
  it("settles at the price captured when the bucket came due, not when the write happens", async () => {
    const t = await trader();
    setPrice(1.175);
    const { trade } = await desk.open(request(t));

    setPrice(1.176);
    desk.collectDue(nowSec() + 10); // captures 1.176 synchronously
    setPrice(1.17); // moves before the database write lands
    await desk.idle();

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.status).toBe("WON");
    expect(row.exitPrice).toBe(1.176);
    expect(
      sent.some((s) => s.userId === t.userId && s.message.type === "trade:settled"),
    ).toBe(true);
  });
});

describe("TradeDesk.hydrate", () => {
  it("voids a position whose expiry passed while the engine was down", async () => {
    const t = await trader();
    const assetId = registry.get("AUDNZD_OTC")!.id;
    const { trade } = await openTrade({
      accountId: t.accountId,
      assetId,
      direction: "UP",
      stake: 1_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(Date.now() - 120_000),
      expiryTs: new Date(Date.now() - 60_000),
    });

    await new TradeDesk(registry, notifier).hydrate(nowSec());

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(row.status).toBe("REFUNDED");
    expect(row.exitPrice).toBeNull();
    const account = await prisma.account.findUniqueOrThrow({ where: { id: t.accountId } });
    expect(account.realBalance).toBe(1_000_000);
  });

  it("keeps a position that is not yet due", async () => {
    const t = await trader();
    const assetId = registry.get("AUDNZD_OTC")!.id;
    const { trade } = await openTrade({
      accountId: t.accountId,
      assetId,
      direction: "UP",
      stake: 1_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(Date.now() + 60_000),
    });

    const fresh = new TradeDesk(registry, notifier);
    await fresh.hydrate(nowSec());
    expect(fresh.openFor(assetId).some((p) => p.tradeId === trade.id)).toBe(true);
  });
});
```

Run it:

```bash
set -a && source .env && set +a && \
  DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm --filter @asm/engine exec vitest run src/trading/trade-desk.test.ts
```

Expected: FAIL — `./trade-desk` does not exist.

- [ ] **Step 5: Write `apps/engine/src/trading/trade-desk.ts`**

```ts
import { BucketRegistry, expirySecFor, type Position } from "@asm/trading";
import {
  AlreadySettled,
  InsufficientFunds,
  getAccountForActor,
  loadOpenPositions,
  openTrade,
  settleTrade,
  voidTrade,
  type SettledTrade,
} from "@asm/db";
import {
  tradeViewFrom,
  type BalancesDto,
  type EngineOpenTradeInput,
  type OpenTradeResult,
  type ServerMessage,
  type TradeView,
} from "@asm/contracts";
import { logger } from "@asm/logger";
import type { AssetRegistry } from "../assets/registry";
import { DeskRejection } from "./errors";

/** A position whose expiry passed more than this long before a restart is voided, not settled. */
export const OUTAGE_GRACE_SEC = 2;
const MAX_SETTLE_ATTEMPTS = 10;
const RETRY_BASE_MS = 500;
const STOP_TIMEOUT_MS = 5_000;

export interface Notifier {
  sendToUser(userId: string, message: ServerMessage): void;
}

interface PendingSettlement {
  position: Position;
  symbol: string;
  exitPrice: number;
  attempts: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Owns every open position from the moment it is opened until it settles.
 *
 * Settlement is split in two on purpose. `collectDue` runs inside the tick loop
 * and only captures prices — synchronous, no I/O, so a slow database never
 * delays a tick. A serialised worker then persists each settlement, retrying on
 * failure with the SAME captured price: retrying against a later price would
 * let an outage change who won.
 */
export class TradeDesk {
  private readonly book = new BucketRegistry();
  private readonly symbolByAssetId = new Map<string, string>();
  private readonly pending: PendingSettlement[] = [];
  private draining: Promise<void> | null = null;

  constructor(
    private readonly assets: AssetRegistry,
    private readonly notifier: Notifier,
  ) {
    for (const asset of assets.all()) this.symbolByAssetId.set(asset.id, asset.symbol);
  }

  async open(input: EngineOpenTradeInput): Promise<OpenTradeResult> {
    const asset = this.assets.get(input.symbol);
    if (!asset) throw new DeskRejection("unknown_asset");

    // Defence in depth: the web app checked ownership, and so does the engine.
    const account = await getAccountForActor(input.actorId, input.accountId);
    if (!account) throw new DeskRejection("account_not_found");

    // Price, entry time and expiry are captured together, here.
    const entryTs = new Date();
    const expiryTs = new Date(entryTs.getTime() + input.durationSec * 1000);
    const entryPrice = Number(asset.state.price.toFixed(asset.precision));

    let opened;
    try {
      opened = await openTrade({
        accountId: input.accountId,
        assetId: asset.id,
        direction: input.direction,
        stake: input.stake,
        payoutPct: asset.payoutPct,
        entryPrice,
        entryTs,
        expiryTs,
      });
    } catch (err) {
      if (err instanceof InsufficientFunds) throw new DeskRejection("insufficient_funds");
      throw err;
    }

    this.book.add({
      tradeId: opened.trade.id,
      accountId: opened.trade.accountId,
      assetId: asset.id,
      direction: opened.trade.direction,
      stake: opened.trade.stake,
      payoutPct: opened.trade.payoutPct,
      entryPrice,
      expirySec: expirySecFor(expiryTs.getTime()),
    });

    const result: OpenTradeResult = {
      trade: tradeViewFrom(opened.trade, asset.symbol),
      balances: { realBalance: opened.realBalance, bonusBalance: opened.bonusBalance },
    };
    this.notify(input.actorId, "trade:opened", result.trade, result.balances);

    logger.info(
      { evt: "trade.opened", tradeId: result.trade.id, symbol: asset.symbol, direction: input.direction, stake: input.stake },
      "trade opened",
    );
    return result;
  }

  /**
   * Reloads open positions after a restart. Positions still due in the future
   * rejoin the book; those whose expiry passed while the engine was down are
   * voided — there is no recorded price for that moment.
   */
  async hydrate(nowSec: number): Promise<void> {
    const positions = await loadOpenPositions();
    let voided = 0;

    for (const position of positions) {
      if (position.expirySec >= nowSec - OUTAGE_GRACE_SEC) {
        this.book.add(position);
        continue;
      }
      try {
        const settled = await voidTrade(position.tradeId);
        voided += 1;
        this.announce(settled, this.symbolByAssetId.get(position.assetId) ?? "UNKNOWN");
      } catch (err) {
        if (!(err instanceof AlreadySettled)) throw err;
      }
    }

    logger.info(
      { evt: "engine.book_hydrated", open: this.book.size(), voided },
      "trade book hydrated",
    );
  }

  /** Called from the tick loop. Captures one price per due bucket; never awaits. */
  collectDue(nowSec: number): void {
    for (const bucket of this.book.due(nowSec)) {
      const symbol = this.symbolByAssetId.get(bucket.assetId);
      const asset = symbol ? this.assets.get(symbol) : undefined;
      if (!asset || !symbol) {
        logger.error(
          { evt: "trade.settle_no_asset", assetId: bucket.assetId, positions: bucket.positions.length },
          "cannot settle — asset not loaded; positions stay OPEN until the next restart voids them",
        );
        continue;
      }

      const exitPrice = Number(asset.state.price.toFixed(asset.precision));
      for (const position of bucket.positions) {
        this.pending.push({ position, symbol, exitPrice, attempts: 0 });
      }
    }

    if (this.pending.length > 0 && !this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
  }

  openFor(assetId: string): Position[] {
    return this.book.openFor(assetId);
  }

  /** Resolves once every captured settlement has been persisted or abandoned. */
  idle(): Promise<void> {
    return this.draining ?? Promise.resolve();
  }

  async stop(): Promise<void> {
    await Promise.race([this.idle(), sleep(STOP_TIMEOUT_MS)]);
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const item = this.pending[0]!;
      try {
        const settled = await settleTrade({
          tradeId: item.position.tradeId,
          exitPrice: item.exitPrice,
        });
        this.pending.shift();
        this.announce(settled, item.symbol);
      } catch (err) {
        if (err instanceof AlreadySettled) {
          this.pending.shift();
          continue;
        }
        item.attempts += 1;
        logger.error(
          {
            evt: "trade.settle_failed",
            tradeId: item.position.tradeId,
            attempt: item.attempts,
            reason: err instanceof Error ? err.message : "unknown",
          },
          "settlement failed — retrying with the same captured price",
        );
        if (item.attempts >= MAX_SETTLE_ATTEMPTS) {
          this.pending.shift();
          logger.error(
            { evt: "trade.settle_abandoned", tradeId: item.position.tradeId },
            "settlement abandoned — trade left OPEN; the next engine start will void it",
          );
          continue;
        }
        await sleep(RETRY_BASE_MS * item.attempts);
      }
    }
  }

  private announce(settled: SettledTrade, symbol: string): void {
    const trade = tradeViewFrom(settled.trade, symbol);
    this.notify(settled.userId, "trade:settled", trade, {
      realBalance: settled.realBalance,
      bonusBalance: settled.bonusBalance,
    });
    logger.info(
      { evt: "trade.settled", tradeId: trade.id, status: trade.status, pnl: trade.pnl },
      "trade settled",
    );
  }

  private notify(
    userId: string,
    type: "trade:opened" | "trade:settled",
    trade: TradeView,
    balances: BalancesDto,
  ): void {
    this.notifier.sendToUser(
      userId,
      type === "trade:opened" ? { type: "trade:opened", trade } : { type: "trade:settled", trade },
    );
    this.notifier.sendToUser(userId, { type: "balance:update", accountId: trade.accountId, ...balances });
  }
}
```

Re-run the Step 4 command. Expected: PASS — 7 tests.

- [ ] **Step 6: Write the failing control-surface test**

Create `apps/engine/src/internal-api.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EngineOpenTradeInput, OpenTradeResult } from "@asm/contracts";
import { createInternalApi, type TradeOpener } from "./internal-api";
import { DeskRejection } from "./trading/errors";

const SECRET = "test-internal-secret";
const received: EngineOpenTradeInput[] = [];
let nextError: Error | null = null;

const result: OpenTradeResult = {
  trade: {
    id: "t1",
    accountId: "3f2a9c1e-0000-4000-8000-000000000000",
    symbol: "AUDNZD_OTC",
    direction: "UP",
    stake: 1_000,
    payoutPct: 100,
    entryPrice: 1.175,
    entryTs: 1,
    expiryTs: 61,
    exitPrice: null,
    status: "OPEN",
    pnl: 0,
  },
  balances: { realBalance: 999_000, bonusBalance: 0 },
};

const desk: TradeOpener = {
  async open(input) {
    received.push(input);
    if (nextError) {
      const err = nextError;
      nextError = null;
      throw err;
    }
    return result;
  },
};

const api = createInternalApi({ desk, secret: SECRET, port: 0 });
let base = "";

beforeAll(async () => {
  base = `http://127.0.0.1:${await api.listen()}`;
});

afterAll(async () => {
  await api.close();
});

const body = {
  symbol: "AUDNZD_OTC",
  direction: "UP",
  stake: 1_000,
  durationSec: 60,
  accountId: "3f2a9c1e-0000-4000-8000-000000000000",
  actorId: "3f2a9c1e-0000-4000-8000-000000000001",
};

function post(payload: unknown, secret: string | null = SECRET, path = "/trades"): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["Authorization"] = `Bearer ${secret}`;
  return fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
}

describe("engine internal api", () => {
  it("refuses to start without a secret", () => {
    expect(() => createInternalApi({ desk, secret: "", port: 0 })).toThrow(/ENGINE_INTERNAL_SECRET/);
  });

  it("rejects a missing or wrong secret without calling the desk", async () => {
    const before = received.length;
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, "wrong-secret")).status).toBe(401);
    expect(received.length).toBe(before);
  });

  it("rejects a payload carrying a server-owned field", async () => {
    const before = received.length;
    expect((await post({ ...body, entryPrice: 0.0001 })).status).toBe(400);
    expect(received.length).toBe(before);
  });

  it("passes a valid request through and returns 201", async () => {
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(result);
    expect(received.at(-1)).toEqual(body);
  });

  it("maps desk rejections to 4xx with the reason", async () => {
    nextError = new DeskRejection("insufficient_funds");
    const res = await post(body);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "insufficient_funds" });

    nextError = new DeskRejection("unknown_asset");
    expect((await post(body)).status).toBe(404);
  });

  it("returns a bare 500 for an unexpected failure, without leaking its message", async () => {
    nextError = new Error("connection string postgres://secret@host");
    const res = await post(body);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("404s any other route", async () => {
    expect((await post(body, SECRET, "/positions")).status).toBe(404);
  });
});
```

Run `pnpm --filter @asm/engine exec vitest run src/internal-api.test.ts` with the Step 4 environment prefix.
Expected: FAIL — `./internal-api` does not exist.

- [ ] **Step 7: Write `apps/engine/src/internal-api.ts`**

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  EngineOpenTradeSchema,
  type EngineOpenTradeInput,
  type OpenTradeResult,
} from "@asm/contracts";
import { logger } from "@asm/logger";
import { DeskRejection, type DeskRejectionReason } from "./trading/errors";

const MAX_BODY_BYTES = 4_096;

export interface TradeOpener {
  open(input: EngineOpenTradeInput): Promise<OpenTradeResult>;
}

const REJECTION_STATUS: Record<DeskRejectionReason, number> = {
  unknown_asset: 404,
  account_not_found: 404,
  insufficient_funds: 409,
};

function authorised(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const supplied = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Resolves to the body, or null if it exceeds MAX_BODY_BYTES. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * The engine's loopback-only control surface.
 *
 *   POST /trades   EngineOpenTradeInput -> 201 OpenTradeResult
 *
 * Bound to 127.0.0.1 and gated by a shared secret. The payload is parsed with
 * the same strict schema discipline as any public boundary: being internal is
 * not a reason to trust it.
 */
export function createInternalApi(deps: {
  desk: TradeOpener;
  secret: string;
  port: number;
}): { listen(): Promise<number>; close(): Promise<void> } {
  if (!deps.secret) {
    throw new Error(
      "ENGINE_INTERNAL_SECRET is not set. The engine refuses to expose an unauthenticated control surface.",
    );
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!authorised(req.headers.authorization, deps.secret)) {
      logger.warn({ evt: "security.authz_denied", route: "engine_internal" }, "internal api auth failed");
      return reply(res, 401, { error: "unauthorised" });
    }

    if (req.method !== "POST" || req.url !== "/trades") {
      return reply(res, 404, { error: "not found" });
    }

    const raw = await readBody(req);
    if (raw === null) return reply(res, 413, { error: "payload too large" });

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return reply(res, 400, { error: "invalid" });
    }

    const parsed = EngineOpenTradeSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        { evt: "security.validation_rejected", route: "engine_internal" },
        "rejected internal trade payload",
      );
      return reply(res, 400, { error: "invalid" });
    }

    try {
      return reply(res, 201, await deps.desk.open(parsed.data));
    } catch (err) {
      if (err instanceof DeskRejection) {
        return reply(res, REJECTION_STATUS[err.reason], { error: err.reason });
      }
      logger.error(
        { evt: "trade.open_failed", reason: err instanceof Error ? err.message : "unknown" },
        "trade open failed",
      );
      return reply(res, 500, { error: "internal" });
    }
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  return {
    async listen() {
      await new Promise<void>((resolve) => server.listen(deps.port, "127.0.0.1", resolve));
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : deps.port;
      logger.info({ evt: "engine.internal_api_listening", port }, "internal api listening");
      return port;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
```

Re-run the Step 6 command. Expected: PASS — 7 tests.

- [ ] **Step 8: Collect due buckets in `apps/engine/src/loop.ts`**

Change the signature and add the call at the top of `run`, immediately after `nowSec` is computed:

```ts
import type { TradeDesk } from "./trading/trade-desk";

export function startTickLoop(
  registry: AssetRegistry,
  server: EngineServer,
  desk: Pick<TradeDesk, "collectDue">,
): { stop(): void } {
```

```ts
    // Capture exit prices before this tick moves them: a trade expiring this
    // second settles against the price its owner last saw. No awaiting here.
    desk.collectDue(nowSec);
```

- [ ] **Step 9: Replace `apps/engine/src/main.ts`**

```ts
import Redis from "ioredis";
import { config } from "@asm/config";
import { logger } from "@asm/logger";
import { prisma } from "@asm/db";
import { AssetRegistry } from "./assets/registry";
import { createTicketAuthenticator } from "./auth/ws-ticket";
import { createPriceFeed } from "./feeds/twelve-data";
import { createInternalApi } from "./internal-api";
import { startTickLoop } from "./loop";
import { EngineServer } from "./server";
import { TradeDesk } from "./trading/trade-desk";

const WS_PORT = Number(process.env.ENGINE_WS_PORT ?? 4001);
const HTTP_PORT = Number(process.env.ENGINE_HTTP_PORT ?? 4002);

async function main(): Promise<void> {
  const registry = new AssetRegistry(Date.now() & 0x7fffffff);
  await registry.load();

  if (registry.symbols().length === 0) {
    throw new Error("No open assets found. Run the Plan 01 seed: pnpm db:seed");
  }

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  const server = new EngineServer(registry, WS_PORT, createTicketAuthenticator(redis));
  await server.ready();

  const desk = new TradeDesk(registry, server);
  await desk.hydrate(Math.floor(Date.now() / 1000));

  const loop = startTickLoop(registry, server, desk);

  const feed = createPriceFeed(registry.symbols());
  await feed.start((quote) => {
    registry.setAnchor(quote.symbol, quote.price);
  });

  // Throws before listening if ENGINE_INTERNAL_SECRET is unset.
  const internal = createInternalApi({
    desk,
    secret: process.env.ENGINE_INTERNAL_SECRET ?? "",
    port: HTTP_PORT,
  });
  await internal.listen();

  logger.info({ evt: "engine.started", wsPort: WS_PORT, httpPort: HTTP_PORT }, "engine started");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ evt: "engine.stopping", signal }, "shutting down");
    await internal.close(); // accept no new trades
    loop.stop(); // collect no new settlements
    await desk.stop(); // let captured settlements persist (bounded)
    await feed.stop();
    await server.stop();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // A10:2025 — mishandled exceptional conditions. Exit so the supervisor
  // restarts us, rather than limping on in an unknown state.
  process.on("unhandledRejection", (reason) => {
    logger.error(
      { evt: "engine.unhandled_rejection", reason: String(reason) },
      "unhandled rejection — exiting",
    );
    process.exit(1);
  });
}

void main().catch((err: unknown) => {
  logger.error(
    { evt: "engine.start_failed", reason: err instanceof Error ? err.message : "unknown" },
    "engine failed to start",
  );
  process.exit(1);
});
```

- [ ] **Step 10: Verify the engine starts with the desk wired**

```bash
pnpm dev:engine
```

Expected: `engine.book_hydrated` with `open: 0`, then `engine.internal_api_listening` on 4002.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:4002/trades
```

Expected: `401`. Stop the engine with Ctrl-C and confirm it exits cleanly.

- [ ] **Step 11: Commit**

```bash
git add apps/engine .env.example pnpm-lock.yaml
git commit -m "feat(engine): trade desk with captured-price settlement and loopback control surface"
```

---

## Task 6: Trade API route

**Files:**
- Create: `apps/web/src/lib/engine-client.ts`, `apps/web/src/app/api/trades/route.ts`
- Test: `apps/web/src/app/api/trades/route.test.ts`
- Modify: `apps/web/package.json`, `apps/web/next.config.ts`

**Interfaces:**
- Consumes: `OpenTradeSchema`, `tradeViewFrom`, `OpenTradeResult`, `EngineOpenTradeInput` from `@asm/contracts`; `getAccountForActor`, `listTradesForActor`, `prisma` from `@asm/db`; the engine's `POST /trades`
- Produces:
  - `engineOpenTrade(input): Promise<OpenTradeResult>`, `class EngineRejected { status; reason }`, `class EngineUnavailable`
  - `POST /api/trades` → `201 OpenTradeResult`
  - `GET /api/trades?accountId=…` → `200 { trades: TradeView[] }`

- [ ] **Step 1: Dependencies and bundling**

```bash
pnpm --filter @asm/web add @asm/trading@workspace:*
```

In `apps/web/next.config.ts`, add `"@asm/trading"` to `transpilePackages`. Every workspace package
the web app imports ships TypeScript source, and Next compiles only those listed.

- [ ] **Step 2: Write `apps/web/src/lib/engine-client.ts`**

```ts
import type { EngineOpenTradeInput, OpenTradeResult } from "@asm/contracts";

/** The engine refused the trade for a reason the trader can act on. */
export class EngineRejected extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "EngineRejected";
  }
}

/** The engine could not be reached or failed unexpectedly. */
export class EngineUnavailable extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "EngineUnavailable";
  }
}

/**
 * Opens a trade through the engine's loopback control surface.
 *
 * If the engine accepts the trade but the response is lost (a timeout after it
 * committed), the caller sees EngineUnavailable while the trade exists — the
 * trader's socket still receives trade:opened, which is the source of truth.
 */
export async function engineOpenTrade(input: EngineOpenTradeInput): Promise<OpenTradeResult> {
  const base = process.env["ENGINE_HTTP_URL"] ?? "http://127.0.0.1:4002";
  const secret = process.env["ENGINE_INTERNAL_SECRET"] ?? "";
  if (!secret) throw new EngineUnavailable("ENGINE_INTERNAL_SECRET is not set");

  const res = await fetch(`${base}/trades`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(3_000),
    cache: "no-store",
  }).catch(() => null);

  if (!res) throw new EngineUnavailable("engine unreachable");
  if (res.status === 201) return (await res.json()) as OpenTradeResult;

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status >= 400 && res.status < 500) {
    throw new EngineRejected(res.status, body.error ?? "rejected");
  }
  throw new EngineUnavailable(`engine responded ${res.status}`);
}
```

- [ ] **Step 3: Write the failing route test**

Create `apps/web/src/app/api/trades/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/engine-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine-client")>();
  return { ...actual, engineOpenTrade: vi.fn() };
});

import type { OpenTradeResult } from "@asm/contracts";
import { createAccountsForUser, openTrade, prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { EngineRejected, EngineUnavailable, engineOpenTrade } from "@/lib/engine-client";
import { GET, POST } from "./route";

const RUN = randomUUID();
const engine = vi.mocked(engineOpenTrade);

let alice = { userId: "", demoId: "", cookie: "" };
let bob = { userId: "", demoId: "", cookie: "" };

async function makeUser(name: string) {
  const user = await prisma.user.create({
    data: { email: `${name}-${RUN}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, 1_000_000);
  return {
    userId: user.id,
    demoId: accounts.find((a) => a.type === "DEMO")!.id,
    cookie: await createSession(user.id, {}),
  };
}

beforeAll(async () => {
  alice = await makeUser("alice");
  bob = await makeUser("bob");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

function headers(cookie: string | null): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": randomUUID() };
  if (cookie) h["cookie"] = `${SESSION_COOKIE}=${cookie}`;
  return h;
}

function post(body: unknown, cookie: string | null): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/trades", {
      method: "POST",
      headers: headers(cookie),
      body: JSON.stringify(body),
    }),
  );
}

function get(accountId: string, cookie: string | null): Promise<Response> {
  return GET(
    new NextRequest(`http://localhost/api/trades?accountId=${encodeURIComponent(accountId)}`, {
      headers: headers(cookie),
    }),
  );
}

const order = () => ({
  symbol: "AUDNZD_OTC",
  direction: "UP",
  stake: 1_000,
  durationSec: 60,
  accountId: alice.demoId,
});

describe("POST /api/trades", () => {
  it("requires a session", async () => {
    expect((await post(order(), null)).status).toBe(401);
  });

  it("rejects a client-supplied entry price before reaching the engine", async () => {
    engine.mockClear();
    expect((await post({ ...order(), entryPrice: 0.0001 }, alice.cookie)).status).toBe(400);
    expect(engine).not.toHaveBeenCalled();
  });

  it("refuses another user's account without reaching the engine", async () => {
    engine.mockClear();
    const res = await post({ ...order(), accountId: alice.demoId }, bob.cookie);
    expect(res.status).toBe(404);
    expect(engine).not.toHaveBeenCalled();
  });

  it("forwards the session's user as the actor — never a value from the body", async () => {
    const result = { trade: { id: "t1" }, balances: { realBalance: 1, bonusBalance: 0 } } as unknown as OpenTradeResult;
    engine.mockResolvedValueOnce(result);
    const res = await post(order(), alice.cookie);
    expect(res.status).toBe(201);
    expect(engine).toHaveBeenLastCalledWith({ ...order(), actorId: alice.userId });
  });

  it("maps an engine insufficient-funds rejection to a 409 the trader can read", async () => {
    engine.mockRejectedValueOnce(new EngineRejected(409, "insufficient_funds"));
    const res = await post(order(), alice.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Not enough balance for that stake." });
  });

  it("returns 503 when the engine is unavailable", async () => {
    engine.mockRejectedValueOnce(new EngineUnavailable("engine unreachable"));
    expect((await post(order(), alice.cookie)).status).toBe(503);
  });
});

describe("GET /api/trades", () => {
  it("lists only the caller's own trades, as trade views", async () => {
    const assetId = (await prisma.asset.findFirstOrThrow({ where: { symbol: "AUDNZD_OTC" } })).id;
    await openTrade({
      accountId: alice.demoId,
      assetId,
      direction: "UP",
      stake: 1_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(Date.now() + 60_000),
    });

    const mine = (await (await get(alice.demoId, alice.cookie)).json()) as { trades: Record<string, unknown>[] };
    expect(mine.trades).toHaveLength(1);
    expect(mine.trades[0]!["symbol"]).toBe("AUDNZD_OTC");
    expect(mine.trades[0]).not.toHaveProperty("stakeFromBonus");
    expect(mine.trades[0]).not.toHaveProperty("assetId");

    const theirs = (await (await get(alice.demoId, bob.cookie)).json()) as { trades: unknown[] };
    expect(theirs.trades).toEqual([]);
  });

  it("rejects an account id that is not a uuid", async () => {
    expect((await get("not-a-uuid", alice.cookie)).status).toBe(400);
  });
});
```

Run it with the test database:

```bash
set -a && source .env && set +a && \
  DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm --filter @asm/web exec vitest run src/app/api/trades
```

Expected: FAIL — `./route` does not exist.

- [ ] **Step 4: Write `apps/web/src/app/api/trades/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { OpenTradeSchema, tradeViewFrom } from "@asm/contracts";
import { getAccountForActor, listTradesForActor, prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { EngineRejected, EngineUnavailable, engineOpenTrade } from "@/lib/engine-client";

const REJECTION_MESSAGE: Record<string, string> = {
  insufficient_funds: "Not enough balance for that stake.",
  unknown_asset: "That asset is not available right now.",
  account_not_found: "Account not found.",
};

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:trade:${session.userId}`, 60, 60))) {
    log.warn({ evt: "security.rate_limited", route: "trades" }, "trade throttled");
    return NextResponse.json({ error: "Slow down a moment and try again." }, { status: 429 });
  }

  const parsed = OpenTradeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn({ evt: "security.validation_rejected", route: "trades" }, "rejected trade payload");
    return NextResponse.json({ error: "Check the trade details." }, { status: 400 });
  }

  // Ownership first — a foreign account never reaches the engine.
  const account = await getAccountForActor(session.userId, parsed.data.accountId);
  if (!account) {
    log.warn(
      { evt: "security.authz_denied", route: "trades", accountId: parsed.data.accountId },
      "account does not belong to actor",
    );
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  try {
    const result = await engineOpenTrade({ ...parsed.data, actorId: session.userId });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof EngineRejected) {
      return NextResponse.json(
        { error: REJECTION_MESSAGE[err.reason] ?? "Could not place that trade." },
        { status: err.status },
      );
    }
    if (err instanceof EngineUnavailable) {
      log.error({ evt: "trade.rejected", reason: "engine_unavailable" }, err.message);
      return NextResponse.json({ error: "Trading is temporarily unavailable." }, { status: 503 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const accountId = OpenTradeSchema.shape.accountId.safeParse(
    req.nextUrl.searchParams.get("accountId"),
  );
  if (!accountId.success) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }

  const trades = await listTradesForActor(session.userId, accountId.data, 50);
  const assets = await prisma.asset.findMany({
    where: { id: { in: [...new Set(trades.map((t) => t.assetId))] } },
    select: { id: true, symbol: true },
  });
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]));

  return NextResponse.json(
    { trades: trades.map((t) => tradeViewFrom(t, symbolById.get(t.assetId) ?? "UNKNOWN")) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

Re-run the Step 3 command. Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): trade open and list api via the engine control surface"
```

---

## Task 7: Trade workspace

**Files:**
- Create: `apps/web/src/lib/format-money.ts`, `apps/web/src/components/trade/trade-state.ts`, `apps/web/src/components/trade/TradeTicket.tsx`, `apps/web/src/components/trade/TradesPanel.tsx`, `apps/web/src/components/trade/TradeWorkspace.tsx`
- Test: `apps/web/src/lib/format-money.test.ts`, `apps/web/src/components/trade/trade-state.test.ts`
- Modify: `apps/web/src/components/AccountSwitcher.tsx`, `apps/web/src/app/(platform)/trade/page.tsx`
- Delete: `apps/web/src/components/chart/LiveChart.tsx` (the workspace replaces it)

**Interfaces:**
- Consumes: `useEngineSocket({ symbol, timeframe, onMessage })` and `PriceChart` from Plan 02; `TradeView`, `OpenTradeResult`, `BalancesDto` from `@asm/contracts`; `DURATIONS_SEC` from `@asm/trading`
- Produces:
  - `formatMinor(minor, currency)` — client-safe
  - `TradeState` with `applyTradeMessage`, `withTrade`, `withBalances`, `withFetchedTrades`, `upsertTrade`, `initialTradeState`
  - `<TradeWorkspace symbol displayName precision accounts initialBalances initialTrades />`

One socket serves the chart, the trade list, and the balances. Trade and balance messages arrive
through the hook's `onMessage`.

- [ ] **Step 1: Write the failing pure tests**

Create `apps/web/src/lib/format-money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatMinor } from "./format-money";

describe("formatMinor", () => {
  it("formats minor units with the currency symbol and two decimals", () => {
    expect(formatMinor(1_000_000, "USD")).toBe("$10,000.00");
    expect(formatMinor(1_050, "USD")).toBe("$10.50");
    expect(formatMinor(0, "USD")).toBe("$0.00");
  });

  it("falls back to no symbol for an unknown currency", () => {
    expect(formatMinor(100, "XYZ")).toBe("1.00");
  });

  it("refuses a fractional minor amount rather than displaying a float", () => {
    expect(() => formatMinor(10.5, "USD")).toThrow(/integer/);
  });
});
```

Create `apps/web/src/components/trade/trade-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import {
  applyTradeMessage,
  initialTradeState,
  upsertTrade,
  withFetchedTrades,
} from "./trade-state";

let seq = 0;
function trade(overrides: Partial<TradeView> = {}): TradeView {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: "acct-demo",
    symbol: "AUDNZD_OTC",
    direction: "UP",
    stake: 100,
    payoutPct: 100,
    entryPrice: 1.175,
    entryTs: 1_000 + seq,
    expiryTs: 1_060 + seq,
    exitPrice: null,
    status: "OPEN",
    pnl: 0,
    ...overrides,
  };
}

describe("upsertTrade", () => {
  it("replaces an open trade with its settled version", () => {
    const open = trade();
    const settled = { ...open, status: "WON" as const, exitPrice: 1.176, pnl: 100 };
    const list = upsertTrade(upsertTrade([], open), settled);
    expect(list).toEqual([settled]);
  });

  it("never lets a late OPEN overwrite a settled trade", () => {
    const open = trade();
    const settled = { ...open, status: "LOST" as const, exitPrice: 1.174, pnl: -100 };
    expect(upsertTrade([settled], open)).toEqual([settled]);
  });

  it("keeps newest first and caps each account at fifty", () => {
    let list: TradeView[] = [];
    for (let i = 0; i < 60; i++) list = upsertTrade(list, trade());
    expect(list).toHaveLength(50);
    expect(list[0]!.entryTs).toBeGreaterThan(list[49]!.entryTs);
  });
});

describe("applyTradeMessage", () => {
  it("routes trades to their own account", () => {
    const state = [
      trade({ accountId: "acct-live" }),
      trade({ accountId: "acct-demo" }),
    ].reduce(
      (s, t) => applyTradeMessage(s, { type: "trade:opened", trade: t }),
      initialTradeState([], {}),
    );
    expect(state.tradesByAccount["acct-live"]).toHaveLength(1);
    expect(state.tradesByAccount["acct-demo"]).toHaveLength(1);
  });

  it("records balances per account", () => {
    const state = applyTradeMessage(initialTradeState([], {}), {
      type: "balance:update",
      accountId: "acct-demo",
      realBalance: 990_000,
      bonusBalance: 0,
    });
    expect(state.balances["acct-demo"]).toEqual({ realBalance: 990_000, bonusBalance: 0 });
  });

  it("ignores unrelated messages", () => {
    const before = initialTradeState([], {});
    expect(applyTradeMessage(before, { type: "ready", serverTs: 0 })).toBe(before);
  });
});

describe("withFetchedTrades", () => {
  it("keeps a settlement that arrived over the socket while the fetch was in flight", () => {
    const open = trade();
    const settled = { ...open, status: "WON" as const, exitPrice: 1.176, pnl: 100 };
    const state = applyTradeMessage(initialTradeState([], {}), { type: "trade:settled", trade: settled });
    const next = withFetchedTrades(state, "acct-demo", [open]);
    expect(next.tradesByAccount["acct-demo"]).toEqual([settled]);
  });

  it("adds fetched history the socket never delivered", () => {
    const old = trade({ status: "LOST", exitPrice: 1.1, pnl: -100 });
    const next = withFetchedTrades(initialTradeState([], {}), "acct-demo", [old]);
    expect(next.tradesByAccount["acct-demo"]).toEqual([old]);
  });
});
```

```bash
pnpm --filter @asm/web exec vitest run src/lib/format-money.test.ts src/components/trade/trade-state.test.ts
```

Expected: FAIL — neither module exists. (Neither test touches Postgres or Redis.)

- [ ] **Step 2: Write `apps/web/src/lib/format-money.ts`**

```ts
const SYMBOLS: Record<string, string> = { USD: "$", INR: "₹", EUR: "€" };

/**
 * Client-safe twin of `formatMoney` in @asm/db. A client component cannot
 * import @asm/db — its barrel constructs the Prisma client — so these few
 * lines are duplicated rather than dragging a database driver toward the
 * browser bundle. Keep the two in step.
 */
export function formatMinor(minor: number, currency: string): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`formatMinor: expected an integer, received ${minor}`);
  }
  const symbol = SYMBOLS[currency] ?? "";
  const value = (minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${value}`;
}
```

- [ ] **Step 3: Write `apps/web/src/components/trade/trade-state.ts`**

```ts
import type { BalancesDto, ServerMessage, TradeView } from "@asm/contracts";

const MAX_TRADES_PER_ACCOUNT = 50;

export interface TradeState {
  /** Newest first, per account. */
  readonly tradesByAccount: Readonly<Record<string, TradeView[]>>;
  readonly balances: Readonly<Record<string, BalancesDto>>;
}

export function initialTradeState(
  trades: TradeView[],
  balances: Record<string, BalancesDto>,
): TradeState {
  let state: TradeState = { tradesByAccount: {}, balances };
  for (const trade of trades) state = withTrade(state, trade);
  return state;
}

/**
 * Inserts or replaces a trade by id, newest first.
 *
 * A settled version always replaces an open one and never the reverse: the
 * HTTP response to "open" and the socket's trade:opened / trade:settled can
 * arrive in any order, and a late "OPEN" must not resurrect a finished trade.
 */
export function upsertTrade(trades: readonly TradeView[], trade: TradeView): TradeView[] {
  const existing = trades.find((t) => t.id === trade.id);
  if (existing && existing.status !== "OPEN" && trade.status === "OPEN") return [...trades];
  return [trade, ...trades.filter((t) => t.id !== trade.id)]
    .sort((a, b) => b.entryTs - a.entryTs)
    .slice(0, MAX_TRADES_PER_ACCOUNT);
}

export function withTrade(state: TradeState, trade: TradeView): TradeState {
  const current = state.tradesByAccount[trade.accountId] ?? [];
  return {
    ...state,
    tradesByAccount: { ...state.tradesByAccount, [trade.accountId]: upsertTrade(current, trade) },
  };
}

export function withBalances(state: TradeState, accountId: string, balances: BalancesDto): TradeState {
  return { ...state, balances: { ...state.balances, [accountId]: balances } };
}

/**
 * Replaces one account's list with a freshly fetched one, without losing a
 * more final version already received over the socket while the fetch was
 * in flight.
 */
export function withFetchedTrades(
  state: TradeState,
  accountId: string,
  fetched: readonly TradeView[],
): TradeState {
  let merged: TradeView[] = [];
  for (const trade of fetched) merged = upsertTrade(merged, trade);
  for (const trade of state.tradesByAccount[accountId] ?? []) merged = upsertTrade(merged, trade);
  return { ...state, tradesByAccount: { ...state.tradesByAccount, [accountId]: merged } };
}

export function applyTradeMessage(state: TradeState, message: ServerMessage): TradeState {
  switch (message.type) {
    case "trade:opened":
    case "trade:settled":
      return withTrade(state, message.trade);
    case "balance:update":
      return withBalances(state, message.accountId, {
        realBalance: message.realBalance,
        bonusBalance: message.bonusBalance,
      });
    default:
      return state;
  }
}
```

Re-run the Step 1 command. Expected: PASS — 14 tests.

- [ ] **Step 4: Replace `apps/web/src/components/AccountSwitcher.tsx`**

The active account now lives in the workspace, since the ticket needs it too. Balances arrive live.

```tsx
"use client";

import type { BalancesDto } from "@asm/contracts";
import { formatMinor } from "@/lib/format-money";

export interface AccountView {
  id: string;
  type: "LIVE" | "DEMO";
  currency: string;
}

export function AccountSwitcher({
  accounts,
  balances,
  activeId,
  onChange,
}: {
  accounts: AccountView[];
  balances: Readonly<Record<string, BalancesDto>>;
  activeId: string;
  onChange: (id: string) => void;
}) {
  const active = accounts.find((a) => a.id === activeId);
  const balance = active ? balances[active.id] : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          {active?.type === "DEMO" ? "Demo account" : "Live account"}
        </p>
        <p className="text-lg font-semibold tabular-nums">
          {active && balance ? formatMinor(balance.realBalance + balance.bonusBalance, active.currency) : "—"}
        </p>
      </div>
      <div className="flex gap-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onChange(a.id)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold ${
              a.id === activeId
                ? "border-[var(--color-brand)] bg-[var(--color-panel-2)]"
                : "border-[var(--color-edge)] bg-[var(--color-panel)] text-[var(--color-ink-2)]"
            }`}
          >
            {a.type === "DEMO" ? "Demo" : "Live"}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `apps/web/src/components/trade/TradeTicket.tsx`**

```tsx
"use client";

import { useState } from "react";
import { DURATIONS_SEC } from "@asm/trading";
import type { OpenTradeResult } from "@asm/contracts";
import { formatMinor } from "@/lib/format-money";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

export function TradeTicket({
  symbol,
  accountId,
  currency,
  payoutPct,
  onOpened,
}: {
  symbol: string;
  accountId: string;
  currency: string;
  payoutPct: number | null;
  onOpened: (result: OpenTradeResult) => void;
}) {
  const [durationSec, setDurationSec] = useState<number>(60);
  const [stakeInput, setStakeInput] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stakeMajor = Number(stakeInput);
  const stakeMinor = Number.isFinite(stakeMajor) && stakeMajor > 0 ? Math.round(stakeMajor * 100) : 0;
  const profitMinor =
    payoutPct === null || stakeMinor === 0 ? null : Math.floor((stakeMinor * payoutPct) / 100);

  function nudge(delta: number): void {
    const current = Number.isFinite(stakeMajor) ? Math.floor(stakeMajor) : 1;
    setStakeInput(String(Math.max(1, current + delta)));
  }

  async function place(direction: "UP" | "DOWN"): Promise<void> {
    if (stakeMinor === 0) {
      setError("Enter an investment amount.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, direction, stake: stakeMinor, durationSec, accountId }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<OpenTradeResult> & { error?: string };
      if (res.ok && data.trade && data.balances) {
        onOpened({ trade: data.trade, balances: data.balances });
      } else {
        setError(data.error ?? "Could not place that trade.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const label = "text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]";
  const field =
    "rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm tabular-nums outline-none focus:border-[var(--color-brand)]";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
      <div>
        <label htmlFor="duration" className={label}>
          Time
        </label>
        <select
          id="duration"
          value={durationSec}
          onChange={(e) => setDurationSec(Number(e.target.value))}
          className={`mt-1 w-full ${field}`}
        >
          {DURATIONS_SEC.map((d) => (
            <option key={d} value={d}>
              {formatDuration(d)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="stake" className={label}>
          Investment
        </label>
        <div className="mt-1 flex items-center gap-2">
          <button type="button" onClick={() => nudge(-1)} className="h-9 w-9 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] text-sm">
            −
          </button>
          <input
            id="stake"
            type="number"
            min={1}
            step={1}
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            className={`min-w-0 flex-1 ${field}`}
          />
          <button type="button" onClick={() => nudge(1)} className="h-9 w-9 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] text-sm">
            +
          </button>
        </div>
      </div>

      <div className="flex items-baseline justify-between border-t border-dashed border-[var(--color-edge)] pt-3 text-sm">
        <span className="text-[var(--color-ink-2)]">Payout</span>
        <span className="font-semibold tabular-nums text-[var(--color-up)]">
          {profitMinor === null ? "—" : formatMinor(profitMinor, currency)}
        </span>
      </div>

      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void place("UP")}
          className="rounded-lg bg-[var(--color-up)] px-4 py-3 text-sm font-bold text-[#06231a] disabled:opacity-50"
        >
          Up ↑
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void place("DOWN")}
          className="rounded-lg bg-[var(--color-down)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          Down ↓
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write `apps/web/src/components/trade/TradesPanel.tsx`**

```tsx
"use client";

import type { TradeView } from "@asm/contracts";
import { formatMinor } from "@/lib/format-money";

function statusColor(status: TradeView["status"]): string {
  if (status === "WON") return "var(--color-up)";
  if (status === "LOST") return "var(--color-down)";
  return "var(--color-ink-2)";
}

function outcomeLabel(trade: TradeView, currency: string): string {
  if (trade.status === "OPEN") return "Open";
  if (trade.status === "REFUNDED") return "Refunded";
  const sign = trade.pnl >= 0 ? "+" : "−";
  return `${sign}${formatMinor(Math.abs(trade.pnl), currency)}`;
}

export function TradesPanel({
  trades,
  currency,
  precision,
}: {
  trades: TradeView[];
  currency: string;
  precision: number;
}) {
  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
        <p className="text-xs text-[var(--color-ink-2)]">No trades yet. Place one using the ticket above.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-3">
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
        Trades
      </p>
      <ul className="flex flex-col divide-y divide-[var(--color-edge)]">
        {trades.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-xs">
            <div className="flex flex-col">
              <span className="font-semibold">{t.symbol}</span>
              <span className="text-[var(--color-ink-2)]">
                {t.direction === "UP" ? "↑" : "↓"} {formatMinor(t.stake, currency)}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-semibold tabular-nums" style={{ color: statusColor(t.status) }}>
                {outcomeLabel(t, currency)}
              </span>
              <span className="tabular-nums text-[var(--color-ink-2)]">{t.entryPrice.toFixed(precision)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Write `apps/web/src/components/trade/TradeWorkspace.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { BalancesDto, OpenTradeResult, ServerMessage, TradeView } from "@asm/contracts";
import { PriceChart } from "@/components/chart/PriceChart";
import { useEngineSocket } from "@/components/chart/useEngineSocket";
import { AccountSwitcher, type AccountView } from "@/components/AccountSwitcher";
import { TradeTicket } from "./TradeTicket";
import { TradesPanel } from "./TradesPanel";
import {
  applyTradeMessage,
  initialTradeState,
  withBalances,
  withFetchedTrades,
  withTrade,
  type TradeState,
} from "./trade-state";

type Action =
  | { kind: "message"; message: ServerMessage }
  | { kind: "opened"; result: OpenTradeResult }
  | { kind: "fetched"; accountId: string; trades: TradeView[] };

function reducer(state: TradeState, action: Action): TradeState {
  switch (action.kind) {
    case "message":
      return applyTradeMessage(state, action.message);
    case "opened":
      return withBalances(
        withTrade(state, action.result.trade),
        action.result.trade.accountId,
        action.result.balances,
      );
    case "fetched":
      return withFetchedTrades(state, action.accountId, action.trades);
  }
}

export function TradeWorkspace({
  symbol,
  displayName,
  precision,
  accounts,
  initialBalances,
  initialTrades,
}: {
  symbol: string;
  displayName: string;
  precision: number;
  accounts: AccountView[];
  initialBalances: Record<string, BalancesDto>;
  initialTrades: TradeView[];
}) {
  const [activeAccountId, setActiveAccountId] = useState(
    accounts.find((a) => a.type === "DEMO")?.id ?? accounts[0]?.id ?? "",
  );
  const [state, dispatch] = useReducer(
    reducer,
    { initialTrades, initialBalances },
    (init) => initialTradeState(init.initialTrades, init.initialBalances),
  );

  const onMessage = useCallback((message: ServerMessage) => dispatch({ kind: "message", message }), []);
  const { status, chart } = useEngineSocket({ symbol, timeframe: "1m", onMessage });

  // The page rendered history for the default account only; fetch on switch.
  useEffect(() => {
    if (!activeAccountId) return;
    const controller = new AbortController();
    void fetch(`/api/trades?accountId=${encodeURIComponent(activeAccountId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ trades: TradeView[] }>) : null))
      .then((body) => {
        if (body) dispatch({ kind: "fetched", accountId: activeAccountId, trades: body.trades });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeAccountId]);

  const active = accounts.find((a) => a.id === activeAccountId);
  const currency = active?.currency ?? "USD";

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <section className="flex flex-col gap-2 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold">{displayName}</span>
            {chart.payoutPct !== null ? (
              <span className="text-xs font-semibold text-[var(--color-up)]">{chart.payoutPct}%</span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {chart.lastPrice !== null ? (
              <span className="text-sm font-semibold tabular-nums">{chart.lastPrice.toFixed(precision)}</span>
            ) : null}
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: status === "open" ? "var(--color-up)" : "var(--color-ink-2)" }}
            >
              {status === "open" ? "Live" : status}
            </span>
          </div>
        </div>
        {status === "unauthorised" ? (
          <p className="text-xs text-[var(--color-down)]">Your session has ended. Log in again.</p>
        ) : null}
        <PriceChart candles={chart.candles} forming={chart.forming} precision={precision} />
      </section>

      <aside className="flex flex-col gap-4">
        <AccountSwitcher
          accounts={accounts}
          balances={state.balances}
          activeId={activeAccountId}
          onChange={setActiveAccountId}
        />
        <TradeTicket
          symbol={symbol}
          accountId={activeAccountId}
          currency={currency}
          payoutPct={chart.payoutPct}
          onOpened={(result) => dispatch({ kind: "opened", result })}
        />
        <TradesPanel
          trades={state.tradesByAccount[activeAccountId] ?? []}
          currency={currency}
          precision={precision}
        />
      </aside>
    </div>
  );
}
```

- [ ] **Step 8: Replace `apps/web/src/app/(platform)/trade/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { tradeViewFrom } from "@asm/contracts";
import { listAccountsForActor, listTradesForActor, prisma } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { TradeWorkspace } from "@/components/trade/TradeWorkspace";

export default async function TradePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const [accounts, assets] = await Promise.all([
    listAccountsForActor(session.userId),
    prisma.asset.findMany({ select: { id: true, symbol: true, displayName: true, precision: true } }),
  ]);

  const asset = assets.find((a) => a.symbol === "AUDNZD_OTC");
  if (!asset) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <p className="text-sm text-[var(--color-ink-2)]">
          No assets seeded. Run <code>pnpm db:seed</code>.
        </p>
      </main>
    );
  }

  // History is server-rendered for the default (demo) account; the workspace
  // fetches it for any other account on switch.
  const defaultAccount = accounts.find((a) => a.type === "DEMO") ?? accounts[0];
  const recent = defaultAccount ? await listTradesForActor(session.userId, defaultAccount.id, 50) : [];
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]));

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">ASM Trade</h1>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
            Simulated
          </span>
        </div>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4">
            Log out
          </button>
        </form>
      </header>

      <TradeWorkspace
        symbol={asset.symbol}
        displayName={asset.displayName}
        precision={asset.precision}
        accounts={accounts.map((a) => ({ id: a.id, type: a.type, currency: a.currency }))}
        initialBalances={Object.fromEntries(
          accounts.map((a) => [a.id, { realBalance: a.realBalance, bonusBalance: a.bonusBalance }]),
        )}
        initialTrades={recent.map((t) => tradeViewFrom(t, symbolById.get(t.assetId) ?? "UNKNOWN"))}
      />
    </main>
  );
}
```

- [ ] **Step 9: Remove the superseded chart wrapper**

```bash
git rm apps/web/src/components/chart/LiveChart.tsx
```

Then `pnpm lint && pnpm typecheck` — both clean.

- [ ] **Step 10: Verify the full round trip in the browser**

Both processes running (`pnpm dev:engine`, `pnpm dev`). Log in, open `/trade`, select **5s**, stake **1**, press **Up**.

Expected, in order:
1. The trade appears as **Open** and the Demo balance drops by $1.00, without a reload
2. About five seconds later it flips to **+$1.00** (green), **−$1.00** (red), or **Refunded**, and the balance updates again
3. The engine log shows `trade.opened` then `trade.settled`
4. A stake larger than the balance shows `Not enough balance for that stake.`
5. Reloading the page keeps the trade history
6. Switching to **Live** shows its own (empty) history and `$0.00`

- [ ] **Step 11: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): trade workspace with live balances and history on one socket"
```

---

## Task 8: Full verification

**Files:** none

- [ ] **Step 1: Run the whole suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all clean, from a bare shell.

- [ ] **Step 2: Verify settlement survives an engine restart**

Place a **5m** trade, stop the engine with Ctrl-C, and restart it within a minute. Expected:
`engine.book_hydrated` with `open: 1, voided: 0`, and the trade settles at its original expiry.

- [ ] **Step 3: Verify an outage voids rather than invents an outcome**

Place a **30s** trade, stop the engine, wait a full minute, and restart. Expected:
`engine.book_hydrated` with `voided: 1`. The trade shows **Refunded** with no exit price, and the stake is back in the balance.

- [ ] **Step 4: Confirm the ledger reconciles**

```bash
psql "postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade" -c "
SELECT a.id, a.type,
       a.\"realBalance\" + a.\"bonusBalance\" AS balance,
       (CASE WHEN a.type = 'DEMO' THEN 1000000 ELSE 0 END) + COALESCE(SUM(t.amount), 0) AS expected
FROM \"Account\" a
LEFT JOIN \"Transaction\" t ON t.\"accountId\" = a.id
GROUP BY a.id, a.type, a.\"realBalance\", a.\"bonusBalance\"
HAVING a.\"realBalance\" + a.\"bonusBalance\"
    <> (CASE WHEN a.type = 'DEMO' THEN 1000000 ELSE 0 END) + COALESCE(SUM(t.amount), 0);"
```

Expected: zero rows. Every account opens with no ledger row, DEMO at 1,000,000. A row here means a balance changed without a ledger entry. That class of bug compounds silently through every later plan.

- [ ] **Step 5: Commit any verification fixes**

If Steps 1–4 required changes, commit them with a message describing the fix. If not, there is nothing to commit.

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass from a bare shell
- [ ] A 5s trade settles within ~5 seconds, and the balance updates live on open and on settle
- [ ] A win at 100% payout returns exactly 2× the stake. An exact tie is `REFUNDED`
- [ ] Ten parallel 200,000 stakes against 1,000,000 leave at most five trades, five ledger rows, and a non-negative balance
- [ ] Every settlement is one transaction: settling twice throws and pays once
- [ ] A bonus-funded stake's credit returns to bonus in the stake's proportion
- [ ] Positions expiring together settle at the price captured when they came due, even if the price moves before the write
- [ ] A restart keeps not-yet-due positions, and voids overdue ones as REFUNDED with no exit price
- [ ] `POST /api/trades` with another user's `accountId` returns 404 and never reaches the engine. With `entryPrice` it returns 400
- [ ] The engine control surface rejects a missing secret (401), extra fields (400), and refuses to start without a secret
- [ ] Trade history survives a reload. One socket per page
- [ ] The ledger reconciliation query returns zero rows

## What Plan 04 depends on from here

Plan 04 (Win-rate controller) imports and must not need to change:

- `TradeDesk.openFor(assetId): Position[]` — the input to the imbalance calculation
- `TradeDesk.open` — the one path by which humans and bots open trades; Plan 04 adds the wish draw there
- `TradeDesk.collectDue` — Plan 04 replaces the captured price with the magnet-delivered shown price, but keeps the capture-then-persist split
- `settleTrade`'s transaction — Plan 04 adds the shadow ledger and account-statistics writes *inside* `applySettlement`
- `Position`, `BucketRegistry`, `expirySecFor` from `@asm/trading`
- `tradeViewFrom` — the leak test asserts against it
- `stepPrice`'s `driftBias` and `magnet` parameters, still zero here
- `Account.lifecycleStage`, `medianStake`, `lossStreak`, `winStreak`, `rollingWinRate` columns from the Plan 01 schema
