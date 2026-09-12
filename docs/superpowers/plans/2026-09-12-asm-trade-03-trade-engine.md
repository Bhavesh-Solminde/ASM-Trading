# ASM Trade — Plan 03: Trade Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working trade ticket — pick a duration and a stake, press Up or Down, and watch the position settle at expiry against the engine's price, with the balance and trade history updating live.

**Architecture:** Pure trade mathematics (outcome determination, settlement arithmetic, expiry bucketing) lives in `packages/trading` so it tests without a database. The engine process gains a settlement pass inside its existing tick loop: positions are grouped into one-second expiry buckets, and every bucket settles against a single captured price inside a single transaction. Balance changes go through an optimistic-concurrency debit that makes the classic double-spend impossible.

**Tech Stack:** TypeScript · Prisma 7 · Postgres 16 · `ws` 8.21.3 · Vitest 5

## Global Constraints

- **Everything from Plans 01 and 02 applies** — Node `>=22.0.0`, exact pinned versions, `z.strictObject()` at every boundary, money as integer minor units, `actorId` on every user-owned query, no Docker, server-authoritative prices.
- **`driftBias` and `magnet` stay zero.** This plan settles trades against an *unbiased* engine. Plan 04 supplies the controller. A trade engine verified against honest prices is the only way to know later that a win-rate deviation came from the controller and not from a settlement bug.
- **Entry price, entry time, and expiry time come from the server.** A trade request carries `assetSymbol`, `direction`, `stake`, `durationSec`, `accountId` and nothing else.
- **Every trade stores the `payoutPct` it was opened at.** Changing an asset's payout must never alter an open position's terms.
- **A tie refunds the stake.** `exitPrice === entryPrice` is `REFUNDED`, not a loss, and is excluded from win-rate statistics in Plan 04.
- **A bucket settles atomically.** All positions expiring in the same second settle against one captured price in one transaction.
- **Balance debits use optimistic concurrency.** Read version, conditional update, retry on conflict. Never read-then-blind-write.

---

## File Structure

```
packages/trading/
├── package.json
├── tsconfig.json
└── src/
    ├── outcome.ts          didWin, settlementAmount — pure
    ├── durations.ts        the 13 allowed durations
    ├── buckets.ts          BucketRegistry — pure, in-memory
    └── index.ts            barrel

packages/contracts/src/
├── trade.ts                OpenTradeSchema + TradeView
├── ws.ts                   modified — adds trade and balance messages
└── index.ts                modified

packages/db/src/repositories/
└── trade.ts                openTrade, listTradesForActor, settleBucket

apps/engine/src/
├── settlement.ts           the settlement pass
└── loop.ts                 modified — calls the settlement pass each tick

apps/web/src/
├── app/api/trades/route.ts           POST open, GET list
├── components/trade/
│   ├── TradeTicket.tsx     duration, stake, Up/Down
│   └── TradesPanel.tsx     history grouped by date
└── app/(platform)/trade/page.tsx      modified — renders both
```

`packages/trading` imports nothing. That is what lets Plan 04 exercise the controller against real bucket geometry with no database standing up.

---

## Task 1: Pure trade outcome and durations

**Files:**
- Create: `packages/trading/package.json`, `packages/trading/tsconfig.json`, `packages/trading/src/outcome.ts`, `packages/trading/src/durations.ts`
- Test: `packages/trading/src/outcome.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Direction = "UP" | "DOWN"`
  - `type Outcome = "WON" | "LOST" | "REFUNDED"`
  - `didWin(direction: Direction, entryPrice: number, exitPrice: number): Outcome`
  - `settlementCredit(stake: number, payoutPct: number, outcome: Outcome): number` — minor units returned to the account
  - `settlementPnl(stake: number, payoutPct: number, outcome: Outcome): number` — signed profit/loss
  - `DURATIONS_SEC: readonly number[]` — the 13 allowed values
  - `isValidDuration(seconds: number): boolean`

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

- [ ] **Step 3: Write the failing test**

Create `packages/trading/src/outcome.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { didWin, settlementCredit, settlementPnl } from "./outcome.js";
import { DURATIONS_SEC, isValidDuration } from "./durations.js";

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

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm --filter @asm/trading test
```

Expected: FAIL — cannot resolve `./outcome.js`.

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

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm install
pnpm --filter @asm/trading test
```

Expected: PASS — 16 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/trading
git commit -m "feat(trading): pure outcome and settlement arithmetic"
```

---

## Task 2: Expiry bucket registry

**Files:**
- Create: `packages/trading/src/buckets.ts`, `packages/trading/src/index.ts`
- Test: `packages/trading/src/buckets.test.ts`

**Interfaces:**
- Consumes: `Direction` from Task 1
- Produces:
  - `Position = { tradeId: string; accountId: string; assetId: string; direction: Direction; stake: number; payoutPct: number; entryPrice: number; expirySec: number }`
  - `ExpiryBucket = { assetId: string; expirySec: number; positions: Position[] }`
  - `class BucketRegistry` with:
    - `add(position: Position): void`
    - `due(nowSec: number): ExpiryBucket[]` — removes and returns every bucket at or before `nowSec`
    - `openFor(assetId: string): Position[]`
    - `size(): number`
    - `remove(tradeId: string): boolean`

Plan 04's imbalance calculation reads `openFor(assetId)`; that is the whole reason this is a standalone pure class rather than inline engine state.

- [ ] **Step 1: Write the failing test**

Create `packages/trading/src/buckets.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { BucketRegistry, type Position } from "./buckets.js";

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
pnpm --filter @asm/trading test
```

Expected: FAIL — cannot resolve `./buckets.js`.

- [ ] **Step 3: Write `packages/trading/src/buckets.ts`**

```ts
import type { Direction } from "./outcome.js";

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
} from "./outcome.js";
export { DURATIONS_SEC, isValidDuration } from "./durations.js";
export {
  BucketRegistry,
  type Position,
  type ExpiryBucket,
} from "./buckets.js";
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @asm/trading test
```

Expected: PASS — 28 tests total.

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
  - `OpenTradeSchema` — strict, accepts only `{ symbol, direction, stake, durationSec, accountId }`
  - `TradeView` — the shape sent to clients
  - New `ServerMessage` members: `TradeOpenedMessage`, `TradeSettledMessage`, `BalanceUpdateMessage`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/trade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { OpenTradeSchema } from "./trade.js";

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
    const result = OpenTradeSchema.safeParse({ ...valid, entryPrice: 1.0 });
    expect(result.success).toBe(false);
  });

  it("rejects a client-supplied expiry timestamp", () => {
    const result = OpenTradeSchema.safeParse({ ...valid, expiryTs: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a client-supplied payout", () => {
    const result = OpenTradeSchema.safeParse({ ...valid, payoutPct: 500 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative stake", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, stake: -100 }).success).toBe(false);
  });

  it("rejects a zero stake", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, stake: 0 }).success).toBe(false);
  });

  it("rejects a fractional stake", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, stake: 100.5 }).success).toBe(false);
  });

  it("rejects an unlisted duration", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, durationSec: 37 }).success).toBe(
      false,
    );
  });

  it("rejects an invalid direction", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, direction: "SIDEWAYS" }).success).toBe(
      false,
    );
  });
});
```

The first three cases are the security control from the threat model expressed as assertions: a request that tries to dictate price, expiry, or payout must be **rejected**, not stripped.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @asm/contracts test
```

Expected: FAIL — cannot resolve `./trade.js`.

- [ ] **Step 3: Write `packages/contracts/src/trade.ts`**

```ts
import { z } from "zod";
import { SymbolSchema } from "./ws.js";

/** Mirrors DURATIONS_SEC in @asm/trading. Kept literal here so contracts stays dependency-free. */
const DURATIONS = [
  5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400,
] as const;

export const DirectionSchema = z.enum(["UP", "DOWN"]);
export type DirectionDto = z.infer<typeof DirectionSchema>;

/**
 * Strict by design. A request carrying entryPrice, expiryTs, or payoutPct is
 * rejected outright — those are server-determined, and an attempt to supply
 * them is worth logging, not silently discarding.
 */
export const OpenTradeSchema = z.strictObject({
  symbol: SymbolSchema,
  direction: DirectionSchema,
  /** Minor units. Positive integer. */
  stake: z.number().int().positive().max(100_000_000),
  durationSec: z
    .number()
    .int()
    .refine((v) => (DURATIONS as readonly number[]).includes(v), {
      message: "Duration is not one of the offered values",
    }),
  accountId: z.string().uuid(),
});
export type OpenTradeInput = z.infer<typeof OpenTradeSchema>;

export interface TradeView {
  id: string;
  accountId: string;
  symbol: string;
  direction: DirectionDto;
  stake: number;
  payoutPct: number;
  entryPrice: number;
  entryTs: number;
  expiryTs: number;
  exitPrice: number | null;
  status: "OPEN" | "WON" | "LOST" | "REFUNDED";
  pnl: number;
}
```

- [ ] **Step 4: Append the new server messages to `packages/contracts/src/ws.ts`**

Add these interfaces after `ErrorMessage`, and extend the union:

```ts
export interface TradeOpenedMessage {
  type: "trade:opened";
  trade: import("./trade.js").TradeView;
}

export interface TradeSettledMessage {
  type: "trade:settled";
  trade: import("./trade.js").TradeView;
}

export interface BalanceUpdateMessage {
  type: "balance:update";
  accountId: string;
  realBalance: number;
  bonusBalance: number;
}
```

Then replace the `ServerMessage` union with:

```ts
export type ServerMessage =
  | TickMessage
  | CandleHistoryMessage
  | CandleCloseMessage
  | PayoutUpdateMessage
  | ReadyMessage
  | ErrorMessage
  | TradeOpenedMessage
  | TradeSettledMessage
  | BalanceUpdateMessage;
```

- [ ] **Step 5: Append to `packages/contracts/src/index.ts`**

```ts
export {
  DirectionSchema,
  OpenTradeSchema,
  type DirectionDto,
  type OpenTradeInput,
  type TradeView,
} from "./trade.js";
export type {
  TradeOpenedMessage,
  TradeSettledMessage,
  BalanceUpdateMessage,
} from "./ws.js";
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm --filter @asm/contracts test
```

Expected: PASS — 22 tests total.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): trade request schema and trade ws messages"
```

---

## Task 4: Trade repository with race-safe balance debits

**Files:**
- Create: `packages/db/src/repositories/trade.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/repositories/trade.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getAccountForActor` from Plan 01; `settlementCredit`, `settlementPnl`, `didWin` from `@asm/trading`
- Produces:
  - `class InsufficientFunds extends Error`
  - `class ConcurrentModification extends Error`
  - `debitAccount(accountId: string, amount: number): Promise<{ realBalance: number; bonusBalance: number }>`
  - `creditAccount(accountId: string, amount: number, kind: TxKind, refId: string): Promise<{ realBalance: number; bonusBalance: number }>`
  - `openTradeRecord(input: OpenTradeRecordInput): Promise<Trade>`
  - `listTradesForActor(actorId: string, accountId: string, limit: number): Promise<Trade[]>`
  - `loadOpenPositions(): Promise<Position[]>`
  - `settleTrade(input: SettleTradeInput): Promise<{ trade: Trade; realBalance: number; bonusBalance: number }>`

**The concurrency design.** `debitAccount` reads the account's `version`, then issues a conditional `updateMany` matching that version. If another request won the race, `count` is `0` and it retries. This is optimistic concurrency, and it is what makes the double-spend the threat model calls out impossible — two simultaneous trades cannot both pass the balance check and both debit.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/repositories/trade.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client.js";
import { createAccountsForUser } from "./account.js";
import {
  InsufficientFunds,
  debitAccount,
  creditAccount,
  openTradeRecord,
  listTradesForActor,
  settleTrade,
} from "./trade.js";

const prisma = new PrismaClient();

let userId = "";
let accountId = "";
let assetId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `t-${Date.now()}-${Math.trunc(process.hrtime.bigint() % 100000n)}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  const accounts = await createAccountsForUser(userId, 1_000_000);
  accountId = accounts.find((a) => a.type === "DEMO")!.id;
  const asset = await prisma.asset.findFirstOrThrow({ where: { symbol: "AUDNZD_OTC" } });
  assetId = asset.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("debitAccount", () => {
  it("reduces the real balance and writes a ledger row", async () => {
    const after = await debitAccount(accountId, 10_000);
    expect(after.realBalance).toBe(990_000);
    const txs = await prisma.transaction.findMany({ where: { accountId } });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.amount).toBe(-10_000);
  });

  it("throws InsufficientFunds rather than going negative", async () => {
    await expect(debitAccount(accountId, 2_000_000)).rejects.toBeInstanceOf(
      InsufficientFunds,
    );
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBe(1_000_000);
  });

  it("debits real balance before bonus balance", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 5_000, bonusBalance: 20_000 },
    });
    const after = await debitAccount(accountId, 10_000);
    expect(after.realBalance).toBe(0);
    expect(after.bonusBalance).toBe(15_000);
  });

  it("never over-debits under concurrency", async () => {
    // 1,000,000 available; ten parallel debits of 200,000 -> at most five succeed.
    const attempts = Array.from({ length: 10 }, () =>
      debitAccount(accountId, 200_000).then(
        () => "ok" as const,
        () => "rejected" as const,
      ),
    );
    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r === "ok").length;

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBeGreaterThanOrEqual(0);
    expect(account.realBalance).toBe(1_000_000 - succeeded * 200_000);
    expect(succeeded).toBeLessThanOrEqual(5);
  });

  it("increments the version on every successful debit", async () => {
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await debitAccount(accountId, 1_000);
    const after = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(after.version).toBe(before.version + 1);
  });
});

describe("creditAccount", () => {
  it("adds to the real balance and writes a ledger row", async () => {
    const after = await creditAccount(accountId, 5_000, "TRADE_PAYOUT", "ref-1");
    expect(after.realBalance).toBe(1_005_000);
    const txs = await prisma.transaction.findMany({ where: { accountId } });
    expect(txs[0]!.amount).toBe(5_000);
  });
});

describe("openTradeRecord and listTradesForActor", () => {
  it("debits the stake and stores the trade as OPEN", async () => {
    const trade = await openTradeRecord({
      accountId,
      assetId,
      direction: "UP",
      stake: 10_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(Date.now() + 60_000),
    });
    expect(trade.status).toBe("OPEN");
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBe(990_000);
  });

  it("lists only the actor's own trades", async () => {
    await openTradeRecord({
      accountId,
      assetId,
      direction: "UP",
      stake: 10_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(Date.now() + 60_000),
    });

    const other = await prisma.user.create({
      data: { email: `o-${Date.now()}@test.local`, passwordHash: "x" },
    });
    const trades = await listTradesForActor(other.id, accountId, 50);
    expect(trades).toEqual([]);

    const mine = await listTradesForActor(userId, accountId, 50);
    expect(mine).toHaveLength(1);
  });
});

describe("settleTrade", () => {
  it("credits stake plus profit on a win", async () => {
    const trade = await openTradeRecord({
      accountId,
      assetId,
      direction: "UP",
      stake: 10_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(),
    });
    const result = await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    expect(result.trade.status).toBe("WON");
    expect(result.realBalance).toBe(1_010_000);
  });

  it("credits nothing on a loss", async () => {
    const trade = await openTradeRecord({
      accountId,
      assetId,
      direction: "UP",
      stake: 10_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(),
    });
    const result = await settleTrade({ tradeId: trade.id, exitPrice: 1.174 });
    expect(result.trade.status).toBe("LOST");
    expect(result.realBalance).toBe(990_000);
  });

  it("refunds the stake on an exact tie", async () => {
    const trade = await openTradeRecord({
      accountId,
      assetId,
      direction: "DOWN",
      stake: 10_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(),
    });
    const result = await settleTrade({ tradeId: trade.id, exitPrice: 1.175 });
    expect(result.trade.status).toBe("REFUNDED");
    expect(result.realBalance).toBe(1_000_000);
  });

  it("is idempotent — settling twice does not pay twice", async () => {
    const trade = await openTradeRecord({
      accountId,
      assetId,
      direction: "UP",
      stake: 10_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(),
    });
    await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    await expect(
      settleTrade({ tradeId: trade.id, exitPrice: 1.176 }),
    ).rejects.toThrow(/already settled/i);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBe(1_010_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade_test?schema=public" pnpm exec vitest run src/repositories/trade.test.ts; cd ../..
```

Expected: FAIL — cannot resolve `./trade.js`.

Seed the test database with assets first if `AUDNZD_OTC` is missing:

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade_test?schema=public" pnpm exec tsx prisma/seed.ts; cd ../..
```

- [ ] **Step 3: Add the trading dependency to the db package**

```bash
pnpm --filter @asm/db add @asm/trading@workspace:*
```

- [ ] **Step 4: Write `packages/db/src/repositories/trade.ts`**

```ts
import { didWin, settlementCredit, settlementPnl, type Position } from "@asm/trading";
import { prisma } from "../client.js";
import type { Direction, Trade, TxKind } from "../../generated/prisma/client.js";

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

const MAX_RETRIES = 5;

interface Balances {
  realBalance: number;
  bonusBalance: number;
}

/**
 * Optimistic-concurrency debit.
 *
 * Read the version, then update conditionally on it. If a competing request
 * won the race, `count` is 0 and we re-read and retry. This is what makes the
 * double-spend impossible: two simultaneous trades cannot both observe a
 * sufficient balance and both succeed in debiting it.
 *
 * Real balance is consumed before bonus balance, so bonus funds remain subject
 * to their turnover requirement for as long as possible.
 */
export async function debitAccount(
  accountId: string,
  amount: number,
): Promise<Balances> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`debit amount must be a positive integer, received ${amount}`);
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`Account ${accountId} not found`);

    const available = account.realBalance + account.bonusBalance;
    if (available < amount) throw new InsufficientFunds();

    const fromReal = Math.min(account.realBalance, amount);
    const fromBonus = amount - fromReal;

    const updated = await prisma.account.updateMany({
      where: { id: accountId, version: account.version },
      data: {
        realBalance: { decrement: fromReal },
        bonusBalance: { decrement: fromBonus },
        version: { increment: 1 },
      },
    });

    if (updated.count === 1) {
      const realBalance = account.realBalance - fromReal;
      const bonusBalance = account.bonusBalance - fromBonus;
      await prisma.transaction.create({
        data: {
          accountId,
          kind: "TRADE_STAKE",
          amount: -amount,
          balanceAfter: realBalance + bonusBalance,
        },
      });
      return { realBalance, bonusBalance };
    }
  }

  throw new ConcurrentModification();
}

export async function creditAccount(
  accountId: string,
  amount: number,
  kind: TxKind,
  refId: string,
): Promise<Balances> {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`credit amount must be a non-negative integer, received ${amount}`);
  }

  const account = await prisma.account.update({
    where: { id: accountId },
    data: { realBalance: { increment: amount }, version: { increment: 1 } },
  });

  await prisma.transaction.create({
    data: {
      accountId,
      kind,
      amount,
      balanceAfter: account.realBalance + account.bonusBalance,
      refType: "Trade",
      refId,
    },
  });

  return { realBalance: account.realBalance, bonusBalance: account.bonusBalance };
}

export interface OpenTradeRecordInput {
  accountId: string;
  assetId: string;
  direction: Direction;
  stake: number;
  payoutPct: number;
  entryPrice: number;
  entryTs: Date;
  expiryTs: Date;
}

/** Debits the stake, then records the position. Stake is gone before the trade exists. */
export async function openTradeRecord(
  input: OpenTradeRecordInput,
): Promise<Trade> {
  await debitAccount(input.accountId, input.stake);

  return prisma.trade.create({
    data: {
      accountId: input.accountId,
      assetId: input.assetId,
      direction: input.direction,
      stake: input.stake,
      // Snapshotted, so a later payout change cannot alter this position's terms.
      payoutPct: input.payoutPct,
      entryPrice: input.entryPrice,
      entryTs: input.entryTs,
      expiryTs: input.expiryTs,
      status: "OPEN",
    },
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

/** Rehydrates the bucket registry after an engine restart. */
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
    expirySec: Math.floor(row.expiryTs.getTime() / 1000),
  }));
}

export interface SettleTradeInput {
  tradeId: string;
  exitPrice: number;
}

/**
 * Settles one trade inside a transaction. The status guard on the conditional
 * update is what makes this idempotent — a replayed settlement matches zero rows
 * and throws rather than paying twice.
 */
export async function settleTrade(
  input: SettleTradeInput,
): Promise<{ trade: Trade; realBalance: number; bonusBalance: number }> {
  const existing = await prisma.trade.findUnique({ where: { id: input.tradeId } });
  if (!existing) throw new Error(`Trade ${input.tradeId} not found`);
  if (existing.status !== "OPEN") throw new AlreadySettled(input.tradeId);

  const outcome = didWin(existing.direction, existing.entryPrice, input.exitPrice);
  const credit = settlementCredit(existing.stake, existing.payoutPct, outcome);
  const pnl = settlementPnl(existing.stake, existing.payoutPct, outcome);

  const claimed = await prisma.trade.updateMany({
    where: { id: input.tradeId, status: "OPEN" },
    data: { status: outcome, exitPrice: input.exitPrice, pnl },
  });
  if (claimed.count !== 1) throw new AlreadySettled(input.tradeId);

  let balances: Balances;
  if (credit > 0) {
    const kind: TxKind = outcome === "REFUNDED" ? "TRADE_REFUND" : "TRADE_PAYOUT";
    balances = await creditAccount(existing.accountId, credit, kind, input.tradeId);
  } else {
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: existing.accountId },
    });
    balances = {
      realBalance: account.realBalance,
      bonusBalance: account.bonusBalance,
    };
  }

  const trade = await prisma.trade.findUniqueOrThrow({ where: { id: input.tradeId } });
  return { trade, ...balances };
}
```

- [ ] **Step 5: Append to `packages/db/src/index.ts`**

```ts
export {
  InsufficientFunds,
  ConcurrentModification,
  AlreadySettled,
  debitAccount,
  creditAccount,
  openTradeRecord,
  listTradesForActor,
  loadOpenPositions,
  settleTrade,
  type OpenTradeRecordInput,
  type SettleTradeInput,
} from "./repositories/trade.js";
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade_test?schema=public" pnpm exec vitest run src/repositories/trade.test.ts; cd ../..
```

Expected: PASS — 13 tests. The concurrency test is the one that matters: if `succeeded` ever exceeds 5, the optimistic guard is broken and the double-spend is live.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): trade repository with race-safe balance debits"
```

---

## Task 5: Settlement in the engine loop

**Files:**
- Create: `apps/engine/src/settlement.ts`
- Modify: `apps/engine/src/loop.ts`, `apps/engine/src/main.ts`, `apps/engine/src/server.ts`
- Test: none — this task is verified by the end-to-end check in Task 7

**Interfaces:**
- Consumes: `BucketRegistry`, `Position` from `@asm/trading`; `settleTrade`, `loadOpenPositions` from `@asm/db`; `AssetRegistry`, `EngineServer` from Plan 02
- Produces:
  - `class SettlementService` with:
    - `hydrate(): Promise<void>` — reloads open positions after a restart
    - `register(position: Position): void`
    - `settleDue(nowSec: number): Promise<void>`
    - `openFor(assetId: string): Position[]` — Plan 04 reads this
  - `EngineServer.sendToUser(userId: string, message: ServerMessage): void`

- [ ] **Step 1: Add `sendToUser` to `apps/engine/src/server.ts`**

Trade and balance messages are per-account, not per-symbol, so `broadcast` is the wrong channel. Insert this method next to `broadcast`:

```ts
  /** Delivers to every socket authenticated as this user, regardless of subscription. */
  sendToUser(userId: string, message: ServerMessage): void {
    for (const client of this.clients) {
      if (client.userId === userId) this.send(client, message);
    }
  }
```

- [ ] **Step 2: Write `apps/engine/src/settlement.ts`**

```ts
import { BucketRegistry, type Position } from "@asm/trading";
import { loadOpenPositions, prisma, settleTrade } from "@asm/db";
import { logger } from "@asm/logger";
import type { TradeView } from "@asm/contracts";
import type { AssetRegistry } from "./assets/registry.js";
import type { EngineServer } from "./server.js";

export class SettlementService {
  private registry = new BucketRegistry();
  private symbolByAssetId = new Map<string, string>();
  private userByAccountId = new Map<string, string>();

  constructor(
    private readonly assets: AssetRegistry,
    private readonly server: EngineServer,
  ) {}

  /**
   * Reloads open positions from the database.
   *
   * Without this, an engine restart strands every open trade forever — the row
   * stays OPEN and nothing ever settles it. Overdue positions settle on the
   * next pass, which is why BucketRegistry.due() returns the past as well.
   */
  async hydrate(): Promise<void> {
    for (const asset of this.assets.all()) {
      this.symbolByAssetId.set(asset.id, asset.symbol);
    }

    const positions = await loadOpenPositions();
    for (const position of positions) this.registry.add(position);

    logger.info(
      { evt: "engine.settlement_hydrated", openPositions: positions.length },
      "settlement service hydrated",
    );
  }

  register(position: Position): void {
    this.registry.add(position);
  }

  openFor(assetId: string): Position[] {
    return this.registry.openFor(assetId);
  }

  private async userIdFor(accountId: string): Promise<string | null> {
    const cached = this.userByAccountId.get(accountId);
    if (cached) return cached;

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { userId: true },
    });
    if (!account) return null;

    this.userByAccountId.set(accountId, account.userId);
    return account.userId;
  }

  /**
   * Settles every due bucket. All positions in a bucket settle against ONE
   * captured price — capturing it once is what stops two accounts receiving
   * inconsistent outcomes from the same moment.
   */
  async settleDue(nowSec: number): Promise<void> {
    const buckets = this.registry.due(nowSec);
    if (buckets.length === 0) return;

    for (const bucket of buckets) {
      const symbol = this.symbolByAssetId.get(bucket.assetId);
      const asset = symbol ? this.assets.get(symbol) : undefined;

      if (!asset) {
        logger.error(
          { evt: "engine.settle_no_asset", assetId: bucket.assetId },
          "cannot settle — asset not loaded",
        );
        continue;
      }

      const exitPrice = Number(asset.state.price.toFixed(asset.precision));

      for (const position of bucket.positions) {
        try {
          const result = await settleTrade({
            tradeId: position.tradeId,
            exitPrice,
          });

          const userId = await this.userIdFor(position.accountId);
          if (!userId) continue;

          const view: TradeView = {
            id: result.trade.id,
            accountId: result.trade.accountId,
            symbol: asset.symbol,
            direction: result.trade.direction,
            stake: result.trade.stake,
            payoutPct: result.trade.payoutPct,
            entryPrice: result.trade.entryPrice,
            entryTs: Math.floor(result.trade.entryTs.getTime() / 1000),
            expiryTs: Math.floor(result.trade.expiryTs.getTime() / 1000),
            exitPrice: result.trade.exitPrice,
            status: result.trade.status,
            pnl: result.trade.pnl,
          };

          this.server.sendToUser(userId, { type: "trade:settled", trade: view });
          this.server.sendToUser(userId, {
            type: "balance:update",
            accountId: result.trade.accountId,
            realBalance: result.realBalance,
            bonusBalance: result.bonusBalance,
          });

          logger.info(
            {
              evt: "trade.settled",
              tradeId: position.tradeId,
              status: result.trade.status,
              pnl: result.trade.pnl,
            },
            "trade settled",
          );
        } catch (err) {
          logger.error(
            {
              evt: "trade.settle_failed",
              tradeId: position.tradeId,
              reason: err instanceof Error ? err.message : "unknown",
            },
            "settlement failed",
          );
        }
      }
    }
  }
}
```

- [ ] **Step 3: Modify `apps/engine/src/loop.ts` to run the settlement pass**

Change the signature and add the settlement call. Replace the function signature and the top of `run`:

```ts
export function startTickLoop(
  registry: AssetRegistry,
  server: EngineServer,
  settlement: SettlementService,
): { stop(): void } {
```

Add the import:

```ts
import type { SettlementService } from "./settlement.js";
```

Then, immediately after `const nowSec = Math.floor(startedAt / 1000);` and before the asset loop, insert:

```ts
    // Settle first, so a trade expiring this second settles against this
    // second's price rather than next tick's.
    await settlement.settleDue(nowSec);
```

- [ ] **Step 4: Modify `apps/engine/src/main.ts` to wire it up**

Add the import:

```ts
import { SettlementService } from "./settlement.js";
```

Then replace the three lines that create the server and loop with:

```ts
  const server = new EngineServer(registry, WS_PORT);
  const settlement = new SettlementService(registry, server);
  await settlement.hydrate();
  const loop = startTickLoop(registry, server, settlement);
```

And expose the settlement service so the HTTP layer can register new trades. Add after `logger.info({ evt: "engine.started" ... })`:

```ts
  // The web app opens trades over HTTP; the engine owns expiry. A tiny internal
  // HTTP endpoint is how the two processes meet. Bound to loopback only.
  const { createInternalApi } = await import("./internal-api.js");
  const internal = createInternalApi(registry, settlement, server);
  await internal.listen();
```

- [ ] **Step 5: Write `apps/engine/src/internal-api.ts`**

```ts
import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { logger } from "@asm/logger";
import type { Position } from "@asm/trading";
import type { AssetRegistry } from "./assets/registry.js";
import type { SettlementService } from "./settlement.js";
import type { EngineServer } from "./server.js";

const PORT = Number(process.env.ENGINE_HTTP_PORT ?? 4002);
const SECRET = process.env.ENGINE_INTERNAL_SECRET ?? "";

function authorised(header: string | undefined): boolean {
  if (!SECRET || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${SECRET}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Loopback-only control surface for the web app.
 *
 * GET  /price?symbol=X    -> { price, payoutPct, precision, assetId }
 * POST /positions         -> registers a freshly opened trade for expiry
 *
 * Bound to 127.0.0.1 and gated by a shared secret. It is not a public API and
 * must never be exposed.
 */
export function createInternalApi(
  assets: AssetRegistry,
  settlement: SettlementService,
  server: EngineServer,
): { listen(): Promise<void>; close(): Promise<void> } {
  const http: Server = createServer((req, res) => {
    if (!authorised(req.headers.authorization)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorised" }));
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

    if (req.method === "GET" && url.pathname === "/price") {
      const symbol = url.searchParams.get("symbol") ?? "";
      const asset = assets.get(symbol);
      if (!asset) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unknown symbol" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          assetId: asset.id,
          price: Number(asset.state.price.toFixed(asset.precision)),
          payoutPct: asset.payoutPct,
          precision: asset.precision,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/positions") {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > 4096) req.destroy();
      });
      req.on("end", () => {
        try {
          const position = JSON.parse(body) as Position;
          settlement.register(position);
          res.writeHead(204);
          res.end();
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "bad payload" }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return {
    async listen() {
      if (!SECRET) {
        throw new Error(
          "ENGINE_INTERNAL_SECRET is not set. The engine refuses to expose an unauthenticated control surface.",
        );
      }
      await new Promise<void>((resolve) => http.listen(PORT, "127.0.0.1", resolve));
      logger.info({ evt: "engine.internal_api_listening", port: PORT }, "internal api listening");
    },
    async close() {
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
```

The unused `server` parameter is there because Plan 04 broadcasts sentiment from this surface. Keep it and add `void server;` at the top of the factory body so lint stays quiet.

- [ ] **Step 6: Add engine HTTP config to the environment**

Append to both `.env.example` and `.env`:

```bash
ENGINE_HTTP_PORT="4002"
ENGINE_HTTP_URL="http://127.0.0.1:4002"
# Shared secret between the web app and the engine's loopback control surface.
ENGINE_INTERNAL_SECRET="local-dev-engine-secret-change-me"
```

- [ ] **Step 7: Verify the engine starts with settlement wired**

```bash
pnpm dev:engine
```

Expected log lines: `engine.settlement_hydrated` with `openPositions: 0`, then `engine.internal_api_listening` on 4002.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4002/price?symbol=AUDNZD_OTC
curl -s -H "Authorization: Bearer local-dev-engine-secret-change-me" \
  "http://127.0.0.1:4002/price?symbol=AUDNZD_OTC"
```

Expected: `401` without the header, then a JSON body with `assetId`, `price`, `payoutPct`, `precision`.

- [ ] **Step 8: Commit**

```bash
git add apps/engine .env.example
git commit -m "feat(engine): bucket settlement pass and loopback control surface"
```

---

## Task 6: Trade API route

**Files:**
- Create: `apps/web/src/lib/engine-client.ts`, `apps/web/src/app/api/trades/route.ts`

**Interfaces:**
- Consumes: `OpenTradeSchema`, `TradeView` from `@asm/contracts`; `openTradeRecord`, `listTradesForActor`, `getAccountForActor`, `InsufficientFunds` from `@asm/db`; `readSession` from Plan 01
- Produces:
  - `enginePrice(symbol: string): Promise<EnginePrice>` where `EnginePrice = { assetId: string; price: number; payoutPct: number; precision: number }`
  - `engineRegisterPosition(position: Position): Promise<void>`
  - `POST /api/trades` → `201 { trade: TradeView }`
  - `GET /api/trades?accountId=…` → `200 { trades: TradeView[] }`

- [ ] **Step 1: Write `apps/web/src/lib/engine-client.ts`**

```ts
import type { Position } from "@asm/trading";

const BASE = process.env.ENGINE_HTTP_URL ?? "http://127.0.0.1:4002";
const SECRET = process.env.ENGINE_INTERNAL_SECRET ?? "";

export interface EnginePrice {
  assetId: string;
  price: number;
  payoutPct: number;
  precision: number;
}

export class EngineUnavailable extends Error {
  constructor(detail: string) {
    super(`Trading is temporarily unavailable. (${detail})`);
    this.name = "EngineUnavailable";
  }
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json",
  };
}

/** The authoritative live price. Never trust a client for this. */
export async function enginePrice(symbol: string): Promise<EnginePrice> {
  const res = await fetch(
    `${BASE}/price?symbol=${encodeURIComponent(symbol)}`,
    { headers: headers(), signal: AbortSignal.timeout(2000), cache: "no-store" },
  ).catch(() => null);

  if (!res) throw new EngineUnavailable("engine unreachable");
  if (res.status === 404) throw new EngineUnavailable("unknown asset");
  if (!res.ok) throw new EngineUnavailable(`engine responded ${res.status}`);

  return (await res.json()) as EnginePrice;
}

export async function engineRegisterPosition(position: Position): Promise<void> {
  const res = await fetch(`${BASE}/positions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(position),
    signal: AbortSignal.timeout(2000),
  }).catch(() => null);

  if (!res || !res.ok) throw new EngineUnavailable("could not register position");
}
```

- [ ] **Step 2: Write `apps/web/src/app/api/trades/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { OpenTradeSchema, type TradeView } from "@asm/contracts";
import {
  InsufficientFunds,
  getAccountForActor,
  listTradesForActor,
  openTradeRecord,
  prisma,
} from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  EngineUnavailable,
  enginePrice,
  engineRegisterPosition,
} from "@/lib/engine-client";

function toView(
  trade: {
    id: string;
    accountId: string;
    direction: "UP" | "DOWN";
    stake: number;
    payoutPct: number;
    entryPrice: number;
    entryTs: Date;
    expiryTs: Date;
    exitPrice: number | null;
    status: "OPEN" | "WON" | "LOST" | "REFUNDED";
    pnl: number;
  },
  symbol: string,
): TradeView {
  return {
    id: trade.id,
    accountId: trade.accountId,
    symbol,
    direction: trade.direction,
    stake: trade.stake,
    payoutPct: trade.payoutPct,
    entryPrice: trade.entryPrice,
    entryTs: Math.floor(trade.entryTs.getTime() / 1000),
    expiryTs: Math.floor(trade.expiryTs.getTime() / 1000),
    exitPrice: trade.exitPrice,
    status: trade.status,
    pnl: trade.pnl,
  };
}

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:trade:${session.userId}`, 60, 60))) {
    log.warn({ evt: "security.rate_limited", route: "trades" }, "trade throttled");
    return NextResponse.json(
      { error: "Slow down a moment and try again." },
      { status: 429 },
    );
  }

  const parsed = OpenTradeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn(
      { evt: "security.validation_rejected", route: "trades" },
      "rejected trade payload",
    );
    return NextResponse.json({ error: "Check the trade details." }, { status: 400 });
  }

  const { symbol, direction, stake, durationSec, accountId } = parsed.data;

  // Ownership check before anything else touches the balance.
  const account = await getAccountForActor(session.userId, accountId);
  if (!account) {
    log.warn(
      { evt: "security.authz_denied", route: "trades", accountId },
      "account does not belong to actor",
    );
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  let price;
  try {
    price = await enginePrice(symbol);
  } catch (err) {
    if (err instanceof EngineUnavailable) {
      log.error({ evt: "trade.rejected", reason: "engine_unavailable" }, err.message);
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  // Entry price, entry time and expiry are all server-determined.
  const entryTs = new Date();
  const expiryTs = new Date(entryTs.getTime() + durationSec * 1000);

  let trade;
  try {
    trade = await openTradeRecord({
      accountId,
      assetId: price.assetId,
      direction,
      stake,
      payoutPct: price.payoutPct,
      entryPrice: price.price,
      entryTs,
      expiryTs,
    });
  } catch (err) {
    if (err instanceof InsufficientFunds) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    await engineRegisterPosition({
      tradeId: trade.id,
      accountId: trade.accountId,
      assetId: trade.assetId,
      direction: trade.direction,
      stake: trade.stake,
      payoutPct: trade.payoutPct,
      entryPrice: trade.entryPrice,
      expirySec: Math.floor(expiryTs.getTime() / 1000),
    });
  } catch {
    // The row is OPEN and persisted, so the engine will pick it up on its next
    // hydrate. Log loudly but do not fail the request or double-charge.
    log.error(
      { evt: "trade.register_failed", tradeId: trade.id },
      "engine did not accept the position — it will settle after the next engine restart",
    );
  }

  log.info(
    { evt: "trade.opened", tradeId: trade.id, symbol, direction, stake },
    "trade opened",
  );

  return NextResponse.json({ trade: toView(trade, symbol) }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }

  const trades = await listTradesForActor(session.userId, accountId, 50);
  const assetIds = [...new Set(trades.map((t) => t.assetId))];
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, symbol: true },
  });
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]));

  return NextResponse.json({
    trades: trades.map((t) => toView(t, symbolById.get(t.assetId) ?? "UNKNOWN")),
  });
}
```

- [ ] **Step 3: Add the trading dependency to the web app**

```bash
pnpm --filter @asm/web add @asm/trading@workspace:*
```

- [ ] **Step 4: Verify the route rejects a foreign account**

With both `pnpm dev:engine` and `pnpm dev` running, and logged in as `trader@test.local` from Plan 01:

```bash
# Capture a session cookie
curl -s -c /tmp/asm.jar -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"trader@test.local","password":"correct-horse-battery"}' > /dev/null

# A random account id that is not theirs
curl -s -b /tmp/asm.jar -X POST http://localhost:3000/api/trades \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"AUDNZD_OTC","direction":"UP","stake":1000,"durationSec":60,"accountId":"00000000-0000-4000-8000-000000000000"}' \
  -w "\n%{http_code}\n"
```

Expected: `404` with `Account not found.` — never a trade.

- [ ] **Step 5: Verify a client-supplied entry price is rejected**

```bash
curl -s -b /tmp/asm.jar -X POST http://localhost:3000/api/trades \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"AUDNZD_OTC","direction":"UP","stake":1000,"durationSec":60,"accountId":"00000000-0000-4000-8000-000000000000","entryPrice":0.0001}' \
  -o /dev/null -w "%{http_code}\n"
```

Expected: `400` — the strict schema rejects it before the ownership check runs.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): trade open and list api"
```

---

## Task 7: Trade ticket and trades panel

**Files:**
- Create: `apps/web/src/components/trade/TradeTicket.tsx`, `apps/web/src/components/trade/TradesPanel.tsx`
- Modify: `apps/web/src/components/chart/useEngineSocket.ts`, `apps/web/src/app/(platform)/trade/page.tsx`

**Interfaces:**
- Consumes: `useEngineSocket` from Plan 02; `TradeView`, `DURATIONS_SEC`
- Produces:
  - `<TradeTicket symbol accountId payoutPct onOpened />`
  - `<TradesPanel accountId initialTrades />`
  - `useEngineSocket` extended with `trades: TradeView[]` and `balance: { realBalance: number; bonusBalance: number } | null`

- [ ] **Step 1: Extend `useEngineSocket` state**

In `apps/web/src/components/chart/useEngineSocket.ts`, widen the interface:

```ts
export interface EngineSocketState {
  status: "connecting" | "open" | "closed";
  candles: CandleDto[];
  lastPrice: number | null;
  payoutPct: number | null;
  settled: TradeView[];
  balance: { realBalance: number; bonusBalance: number } | null;
}
```

Add the import:

```ts
import type { CandleDto, ServerMessage, Timeframe, TradeView } from "@asm/contracts";
```

Extend the initial state:

```ts
  const [state, setState] = useState<EngineSocketState>({
    status: "connecting",
    candles: [],
    lastPrice: null,
    payoutPct: null,
    settled: [],
    balance: null,
  });
```

And add two cases to the message switch, before `default`:

```ts
            case "trade:settled":
              return {
                ...prev,
                settled: [message.trade, ...prev.settled].slice(0, 50),
              };

            case "balance:update":
              return {
                ...prev,
                balance: {
                  realBalance: message.realBalance,
                  bonusBalance: message.bonusBalance,
                },
              };
```

- [ ] **Step 2: Write `apps/web/src/components/trade/TradeTicket.tsx`**

```tsx
"use client";

import { useState } from "react";
import { DURATIONS_SEC } from "@asm/trading";
import type { TradeView } from "@asm/contracts";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

export function TradeTicket({
  symbol,
  accountId,
  payoutPct,
  onOpened,
}: {
  symbol: string;
  accountId: string;
  payoutPct: number | null;
  onOpened: (trade: TradeView) => void;
}) {
  const [durationSec, setDurationSec] = useState(60);
  const [stakeMajor, setStakeMajor] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stakeMinor = Math.round(stakeMajor * 100);
  const profit =
    payoutPct === null ? null : Math.floor((stakeMinor * payoutPct) / 100) / 100;

  async function place(direction: "UP" | "DOWN") {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, direction, stake: stakeMinor, durationSec, accountId }),
    });

    if (res.ok) {
      const data = (await res.json()) as { trade: TradeView };
      onOpened(data.trade);
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not place that trade.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
      <div>
        <label
          htmlFor="duration"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Time
        </label>
        <select
          id="duration"
          value={durationSec}
          onChange={(e) => setDurationSec(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm tabular-nums outline-none focus:border-[var(--color-brand)]"
        >
          {DURATIONS_SEC.map((d) => (
            <option key={d} value={d}>
              {formatDuration(d)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="stake"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Investment
        </label>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStakeMajor((v) => Math.max(1, v - 1))}
            className="h-9 w-9 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] text-sm"
          >
            −
          </button>
          <input
            id="stake"
            type="number"
            min={1}
            step={1}
            value={stakeMajor}
            onChange={(e) => setStakeMajor(Math.max(1, Number(e.target.value)))}
            className="flex-1 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm tabular-nums outline-none focus:border-[var(--color-brand)]"
          />
          <button
            type="button"
            onClick={() => setStakeMajor((v) => v + 1)}
            className="h-9 w-9 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] text-sm"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex items-baseline justify-between border-t border-dashed border-[var(--color-edge)] pt-3 text-sm">
        <span className="text-[var(--color-ink-2)]">Payout</span>
        <span className="font-semibold tabular-nums text-[var(--color-up)]">
          {profit === null ? "—" : `$${profit.toFixed(2)}`}
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

- [ ] **Step 3: Write `apps/web/src/components/trade/TradesPanel.tsx`**

```tsx
"use client";

import type { TradeView } from "@asm/contracts";

function statusColor(status: TradeView["status"]): string {
  if (status === "WON") return "var(--color-up)";
  if (status === "LOST") return "var(--color-down)";
  return "var(--color-ink-2)";
}

export function TradesPanel({ trades }: { trades: TradeView[] }) {
  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
        <p className="text-xs text-[var(--color-ink-2)]">
          No trades yet. Place one using the ticket above.
        </p>
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
                {t.direction === "UP" ? "↑" : "↓"} ${(t.stake / 100).toFixed(2)}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span
                className="font-semibold tabular-nums"
                style={{ color: statusColor(t.status) }}
              >
                {t.status === "OPEN"
                  ? "Open"
                  : `${t.pnl >= 0 ? "+" : "−"}$${Math.abs(t.pnl / 100).toFixed(2)}`}
              </span>
              <span className="tabular-nums text-[var(--color-ink-2)]">
                {t.entryPrice.toFixed(5)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite the trade page as a client shell**

The ticket, the chart and the panel all need the same live socket state, so the page becomes a thin server component that fetches initial data and hands it to one client component.

Create `apps/web/src/components/trade/TradeWorkspace.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { TradeView } from "@asm/contracts";
import { PriceChart } from "@/components/chart/PriceChart";
import { useEngineSocket } from "@/components/chart/useEngineSocket";
import { AccountSwitcher, type AccountView } from "@/components/AccountSwitcher";
import { TradeTicket } from "./TradeTicket";
import { TradesPanel } from "./TradesPanel";

export function TradeWorkspace({
  symbol,
  precision,
  token,
  accounts,
  initialTrades,
}: {
  symbol: string;
  precision: number;
  token: string | null;
  accounts: AccountView[];
  initialTrades: TradeView[];
}) {
  const [activeAccountId, setActiveAccountId] = useState(
    accounts.find((a) => a.type === "DEMO")?.id ?? accounts[0]?.id ?? "",
  );
  const [opened, setOpened] = useState<TradeView[]>(initialTrades);

  const socket = useEngineSocket({ symbol, timeframe: "1m", token });

  // Settled results from the socket supersede the optimistic open rows.
  const settledById = new Map(socket.settled.map((t) => [t.id, t]));
  const trades = opened.map((t) => settledById.get(t.id) ?? t);

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <section className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
        <PriceChart
          symbol={symbol}
          timeframe="1m"
          token={token}
          precision={precision}
        />
      </section>

      <aside className="flex flex-col gap-4">
        <AccountSwitcher
          accounts={accounts}
          activeId={activeAccountId}
          onChange={setActiveAccountId}
        />
        <TradeTicket
          symbol={symbol}
          accountId={activeAccountId}
          payoutPct={socket.payoutPct}
          onOpened={(trade) => setOpened((prev) => [trade, ...prev])}
        />
        <TradesPanel trades={trades} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Make `AccountSwitcher` controlled**

Replace `apps/web/src/components/AccountSwitcher.tsx` — the active account now lives in the workspace, because the ticket needs it too.

```tsx
"use client";

export interface AccountView {
  id: string;
  type: "LIVE" | "DEMO";
  balance: string;
}

export function AccountSwitcher({
  accounts,
  activeId,
  onChange,
}: {
  accounts: AccountView[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  const active = accounts.find((a) => a.id === activeId);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          {active?.type === "DEMO" ? "Demo account" : "Live account"}
        </p>
        <p className="text-lg font-semibold tabular-nums">{active?.balance}</p>
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

- [ ] **Step 6: Replace `apps/web/src/app/(platform)/trade/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, listAccountsForActor, prisma } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { TradeWorkspace } from "@/components/trade/TradeWorkspace";

export default async function TradePage() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  const session = await readSession(token);
  if (!session) redirect("/login");

  const [accounts, asset] = await Promise.all([
    listAccountsForActor(session.userId),
    prisma.asset.findUnique({ where: { symbol: "AUDNZD_OTC" } }),
  ]);

  if (!asset) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <p className="text-sm text-[var(--color-ink-2)]">
          No assets seeded. Run <code>pnpm db:seed</code>.
        </p>
      </main>
    );
  }

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
          <button
            type="submit"
            className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
          >
            Log out
          </button>
        </form>
      </header>

      <TradeWorkspace
        symbol={asset.symbol}
        precision={asset.precision}
        token={token}
        accounts={accounts.map((a) => ({
          id: a.id,
          type: a.type,
          balance: formatMoney(a.realBalance + a.bonusBalance, a.currency),
        }))}
        initialTrades={[]}
      />
    </main>
  );
}
```

- [ ] **Step 7: Verify the full round trip in the browser**

Two terminals: `pnpm dev:engine` and `pnpm dev`. Log in, open `/trade`, select **5s**, stake **1**, and press **Up**.

Expected, in order:
1. The trade appears in the panel as **Open**
2. Within about five seconds it flips to **+$1.00** (green) or **−$1.00** (red)
3. The engine log shows `trade.opened` then `trade.settled`
4. Placing a trade for more than the balance shows `Not enough balance for that stake.`

- [ ] **Step 8: Verify settlement survives an engine restart**

Place a **5m** trade, then stop the engine with Ctrl-C and restart it:

```bash
pnpm dev:engine
```

Expected: `engine.settlement_hydrated` reports `openPositions: 1`, and the trade settles at its original expiry rather than being stranded.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): trade ticket and trades panel"
```

---

## Task 8: Full verification

**Files:**
- Modify: none

- [ ] **Step 1: Run the whole suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all clean.

- [ ] **Step 2: Run the database-backed suites explicitly**

Workspace `pnpm test` uses the default `DATABASE_URL`. Run the repository suites against the test database so they do not pollute development data:

```bash
cd packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade_test?schema=public" pnpm exec vitest run
cd ../..
```

Expected: PASS — 18 tests across account and trade repositories.

- [ ] **Step 3: Confirm the ledger balances**

```bash
psql -d asm_trade -c "
SELECT a.id,
       a.\"realBalance\" + a.\"bonusBalance\" AS balance,
       COALESCE(SUM(t.amount), 0) AS ledger_sum
FROM \"Account\" a
LEFT JOIN \"Transaction\" t ON t.\"accountId\" = a.id
GROUP BY a.id, a.\"realBalance\", a.\"bonusBalance\"
HAVING a.\"realBalance\" + a.\"bonusBalance\" <> 1000000 + COALESCE(SUM(t.amount), 0)
   AND a.\"realBalance\" + a.\"bonusBalance\" <> COALESCE(SUM(t.amount), 0);"
```

Expected: zero rows. A row here means a balance change happened without a ledger entry, which is the one class of bug that compounds silently through every later plan.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: plan 03 verification"
```

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass
- [ ] A 5s trade settles within ~5 seconds and the balance updates without a page refresh
- [ ] A win at 100% payout returns exactly 2× the stake
- [ ] An exact tie is `REFUNDED` and returns the stake
- [ ] Ten parallel debits of 200,000 against a 1,000,000 balance leave the balance at or above zero, with at most five succeeding
- [ ] `POST /api/trades` with another user's `accountId` returns 404 and opens no trade
- [ ] `POST /api/trades` carrying `entryPrice` returns 400
- [ ] Settling the same trade twice throws and does not pay twice
- [ ] Restarting the engine reports `openPositions: N` and still settles those trades
- [ ] The ledger reconciliation query returns zero rows

## What Plan 04 depends on from here

Plan 04 (Win-rate controller) imports and must not need to change:

- `SettlementService.openFor(assetId): Position[]` — the input to the imbalance calculation
- `Position` from `@asm/trading` — carries `entryPrice`, `direction`, `stake`, `payoutPct`, `expirySec`
- `stepPrice`'s `driftBias` and `magnet` parameters, wired to real values there
- `AssetRegistry.tick(symbol, nowSec)` — extended to accept a bias, not rewritten
- `settleTrade` — extended to write the `TradeShadow` row alongside the settlement
- `Account.lifecycleStage`, `medianStake`, `lossStreak`, `winStreak`, `rollingWinRate` columns, already in the Plan 01 schema
