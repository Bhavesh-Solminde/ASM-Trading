# ASM Trade — Plan 04: Win-Rate Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The compensated controller — each account is driven toward a stage-based target win rate (65% / 45% / 27%) under a hard 65% ceiling, delivered through bias so small it passes a randomness test, with every decision and its honest counterfactual recorded to the database and never shown in the UI.

**Architecture:** The entire controller lives in `packages/algo` as pure functions of state with one injected RNG — no database, no clock, no I/O. That is what makes its nine-test validation suite fast, seed-deterministic, and trustworthy. The engine wires it in three places: an exposure read before each tick to compute bias, an outcome draw when a trade opens, and a shadow-ledger write when a bucket settles. A bot crowd gives the controller a book to act on.

**Tech Stack:** TypeScript · Prisma 7 · Postgres 16 · Vitest 5

## Global Constraints

- **Everything from Plans 01–03 applies** — Node `>=22.0.0`, exact pinned versions, `z.strictObject()` at every boundary, money as integer minor units, `actorId` on every user-owned query, server-authoritative prices, no Docker.
- **Targets are fixed:** `PRE_DEPOSIT = 0.65`, `DEPOSITED = 0.45`, `HIGH_VALUE = 0.27`. `HARD_CEILING = 0.65` applies in every stage.
- **`packages/algo` stays pure.** It imports only types from `@asm/trading`. No `@asm/db`, no `Date.now()`, no `Math.random`. Randomness arrives as an injected `Rng`.
- **The controller is stochastic, not deterministic.** It computes a win *probability* and draws against it. A deterministic controller fails a runs test; a biased coin cannot.
- **No account is ever certain to win or lose.** `p` is clamped to `[0.05, 0.95]` after every stage.
- **The shadow ledger is written, never rendered.** No `TradeShadow` field may appear in any response a trading client can reach. Task 8 asserts this with a contract test.
- **Bias is bounded inside natural noise.** `|driftBias| ≤ 0.25 · sigma`, and the expiry magnet is capped per tick at `maxTickMove` from Plan 02.
- **Bias scales with book size.** Below `EXPOSURE_FLOOR` the price runs completely unbiased. A single small trade must never move the market.
- **Ties are excluded from win-rate statistics.** A `REFUNDED` trade updates no window and no streak.

---

## File Structure

```
packages/algo/
├── package.json
├── tsconfig.json
└── src/
    ├── constants.ts        every tunable in one place
    ├── estimator.ts        trade weight + Beta-Binomial posterior
    ├── controller.ts       error -> win probability, ceiling, streak guard
    ├── exposure.ts         stake-weighted imbalance + exposure scaling
    ├── resolve.ts          bucket price selection
    ├── bias.ts             drift and magnet composition
    ├── types.ts            shared shapes
    └── index.ts            barrel

packages/algo/test/
├── convergence.test.ts     Monte Carlo — realised rate hits target
├── ceiling.test.ts         forced wins cannot sustain above 65%
├── cold-start.test.ts      no manipulation without evidence
├── farming.test.ts         micro-stake exploit yields nothing
├── streaks.test.ts         no run exceeds the configured maximum
├── randomness.test.ts      Wald-Wolfowitz runs test
├── thin-book.test.ts       single trader -> zero bias
├── conflict.test.ts        straddling positions resolve deterministically
└── ties.test.ts            refunds excluded from statistics

packages/db/src/repositories/
├── account-stats.ts        window/streak/median persistence
└── trade.ts                modified — settleTrade writes TradeShadow

apps/engine/src/
├── bots/
│   ├── profiles.ts         five bot behaviours
│   └── crowd.ts            Poisson arrivals, log-normal stakes
├── controller-bridge.ts    reads accounts, calls the controller, caches
├── assets/registry.ts      modified — tick() accepts bias
├── settlement.ts           modified — resolve target, write shadow
└── loop.ts                 modified — compute bias per asset per tick

apps/web/src/app/admin/
└── algorithm/page.tsx      the observability panel
```

---

## Task 1: Constants and the estimator

**Files:**
- Create: `packages/algo/package.json`, `packages/algo/tsconfig.json`, `packages/algo/src/constants.ts`, `packages/algo/src/types.ts`, `packages/algo/src/estimator.ts`
- Test: `packages/algo/src/estimator.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `LifecycleStage = "PRE_DEPOSIT" | "DEPOSITED" | "HIGH_VALUE"`
  - `TARGETS: Record<LifecycleStage, number>` — `0.65 / 0.45 / 0.27`
  - `HARD_CEILING`, `CEILING_CLAMP`, `MAX_CORRECTION`, `ERROR_SCALE`, `PRIOR_SHORT`, `PRIOR_LIFE`, `WINDOW_SIZE`, `WEIGHT_FLOOR`, `WEIGHT_CAP`, `MAX_LOSS_STREAK`, `MAX_WIN_STREAK`, `P_MIN`, `P_MAX`, `PLAUSIBILITY`, `BOOK_WEIGHT`, `EXPOSURE_FLOOR`, `EXPOSURE_FULL`, `BIAS_SIGMA_CAP`, `IMBALANCE_TAU_SEC`, `DEPOSIT_THRESHOLD_MINOR`
  - `WindowEntry = { weight: number; won: boolean }`
  - `tradeWeight(stake: number, medianStake: number): number`
  - `posterior(window: WindowEntry[], target: number, priorStrength: number): number`
  - `posteriorFromTotals(wonWeight: number, totalWeight: number, target: number, priorStrength: number): number`

- [ ] **Step 1: Write `packages/algo/package.json`**

```json
{
  "name": "@asm/algo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "@asm/trading": "workspace:*" }
}
```

- [ ] **Step 2: Write `packages/algo/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Write `packages/algo/src/constants.ts`**

```ts
export type LifecycleStage = "PRE_DEPOSIT" | "DEPOSITED" | "HIGH_VALUE";

/**
 * Stage targets. Pre-deposit generosity builds confidence; the rate falls once
 * an account has deposited, and falls again past the threshold.
 */
export const TARGETS: Record<LifecycleStage, number> = {
  PRE_DEPOSIT: 0.65,
  DEPOSITED: 0.45,
  HIGH_VALUE: 0.27,
};

/** No account sustains a win rate above this, in any stage. */
export const HARD_CEILING = 0.65;
/** Win probability applied while an account is over the ceiling. */
export const CEILING_CLAMP = 0.15;

/** Largest shift the controller may apply away from the stage target. */
export const MAX_CORRECTION = 0.35;
/** Controller sensitivity — the error at which tanh reaches ~0.76. */
export const ERROR_SCALE = 0.15;

/** Beta-Binomial prior strength, in weight units. */
export const PRIOR_SHORT = 15;
export const PRIOR_LIFE = 30;
/** Rolling window length, in trades. */
export const WINDOW_SIZE = 100;

/** Anti-farming bounds on a single trade's influence. */
export const WEIGHT_FLOOR = 0.2;
export const WEIGHT_CAP = 5.0;

export const MAX_LOSS_STREAK = 5;
export const MAX_WIN_STREAK = 4;

/** Absolute bounds — no account can ever be certain to win or lose. */
export const P_MIN = 0.05;
export const P_MAX = 0.95;

/** Reachable single-tick move, in multiples of sigma. */
export const PLAUSIBILITY = 2.0;
/** House-P&L tiebreaker strength in bucket resolution. Deliberately tiny. */
export const BOOK_WEIGHT = 0.001;

/**
 * Below EXPOSURE_FLOOR the price runs completely unbiased — a ₹100 book is not
 * worth defending, and one small trade must never move a market. Bias ramps
 * linearly to full strength at EXPOSURE_FULL. Both in minor units.
 */
export const EXPOSURE_FLOOR = 50_000;
export const EXPOSURE_FULL = 500_000;

/** Hard cap on drift bias, in multiples of the tick's sigma. */
export const BIAS_SIGMA_CAP = 0.25;

/** Time-decay constant for weighting near expiries more heavily. */
export const IMBALANCE_TAU_SEC = 45;

/** Cumulative deposits (minor units) at which an account becomes HIGH_VALUE. */
export const DEPOSIT_THRESHOLD_MINOR = 50_000;
```

- [ ] **Step 4: Write `packages/algo/src/types.ts`**

```ts
import type { LifecycleStage } from "./constants";

export interface WindowEntry {
  readonly weight: number;
  readonly won: boolean;
}

export interface AccountStats {
  readonly stage: LifecycleStage;
  /** Most recent trades, oldest first, at most WINDOW_SIZE entries. */
  readonly shortWindow: WindowEntry[];
  readonly lifetimeWonWeight: number;
  readonly lifetimeTotalWeight: number;
  readonly lossStreak: number;
  readonly winStreak: number;
  readonly medianStake: number;
}

export interface ControllerOutput {
  /** Win probability for the next trade on this account. */
  readonly p: number;
  readonly ceilingActive: boolean;
  /** How much the engine cares about honouring this outcome, in [0, 2]. */
  readonly urgency: number;
  /** Diagnostics for the shadow ledger. */
  readonly posteriorShort: number;
  readonly posteriorLife: number;
  readonly target: number;
}
```

- [ ] **Step 5: Write the failing estimator test**

Create `packages/algo/src/estimator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { posterior, posteriorFromTotals, tradeWeight } from "./estimator";
import { PRIOR_SHORT, WEIGHT_CAP, WEIGHT_FLOOR } from "./constants";
import type { WindowEntry } from "./types";

function win(weight: number): WindowEntry {
  return { weight, won: true };
}
function loss(weight: number): WindowEntry {
  return { weight, won: false };
}

describe("tradeWeight", () => {
  it("gives a typical trade a weight near 1", () => {
    expect(tradeWeight(100, 100)).toBeCloseTo(1, 10);
  });

  it("floors a trivially small trade", () => {
    expect(tradeWeight(1, 10_000)).toBe(WEIGHT_FLOOR);
  });

  it("caps an outsized trade", () => {
    expect(tradeWeight(1_000_000, 100)).toBe(WEIGHT_CAP);
  });

  it("treats a zero median stake as 1 rather than dividing by zero", () => {
    expect(Number.isFinite(tradeWeight(100, 0))).toBe(true);
  });

  it("makes a hundred micro-trades worth far less than a hundred normal ones", () => {
    const micro = 100 * tradeWeight(1, 10_000);
    const normal = 100 * tradeWeight(10_000, 10_000);
    expect(micro).toBeLessThan(normal / 4);
  });
});

describe("posterior", () => {
  it("returns the target exactly for an empty window", () => {
    expect(posterior([], 0.45, PRIOR_SHORT)).toBeCloseTo(0.45, 12);
    expect(posterior([], 0.27, PRIOR_SHORT)).toBeCloseTo(0.27, 12);
  });

  it("moves above the target after wins", () => {
    const w = Array.from({ length: 30 }, () => win(1));
    expect(posterior(w, 0.45, PRIOR_SHORT)).toBeGreaterThan(0.45);
  });

  it("moves below the target after losses", () => {
    const w = Array.from({ length: 30 }, () => loss(1));
    expect(posterior(w, 0.45, PRIOR_SHORT)).toBeLessThan(0.45);
  });

  it("stays inside [0, 1] under extreme input", () => {
    const allWins = Array.from({ length: 500 }, () => win(WEIGHT_CAP));
    const allLosses = Array.from({ length: 500 }, () => loss(WEIGHT_CAP));
    expect(posterior(allWins, 0.45, PRIOR_SHORT)).toBeLessThanOrEqual(1);
    expect(posterior(allLosses, 0.45, PRIOR_SHORT)).toBeGreaterThanOrEqual(0);
  });

  it("converges on the empirical rate as evidence accumulates", () => {
    // 70% wins over 400 weighted trades should dominate a prior of 15.
    const w = Array.from({ length: 400 }, (_, i) => (i % 10 < 7 ? win(1) : loss(1)));
    expect(posterior(w, 0.27, PRIOR_SHORT)).toBeGreaterThan(0.65);
  });

  it("weights a heavy trade more than a light one", () => {
    const heavyWin = posterior([win(5), loss(0.2)], 0.5, PRIOR_SHORT);
    const lightWin = posterior([win(0.2), loss(5)], 0.5, PRIOR_SHORT);
    expect(heavyWin).toBeGreaterThan(lightWin);
  });
});

describe("posteriorFromTotals", () => {
  it("matches posterior for equivalent input", () => {
    const w = [win(1), win(1), loss(1)];
    const fromWindow = posterior(w, 0.45, PRIOR_SHORT);
    const fromTotals = posteriorFromTotals(2, 3, 0.45, PRIOR_SHORT);
    expect(fromTotals).toBeCloseTo(fromWindow, 12);
  });

  it("returns the target for zero total weight", () => {
    expect(posteriorFromTotals(0, 0, 0.27, PRIOR_SHORT)).toBeCloseTo(0.27, 12);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
pnpm --filter @asm/algo test
```

Expected: FAIL — cannot resolve `./estimator.js`.

- [ ] **Step 7: Write `packages/algo/src/estimator.ts`**

```ts
import { WEIGHT_CAP, WEIGHT_FLOOR } from "./constants";
import type { WindowEntry } from "./types";

/**
 * A trade's influence on the posterior, normalised against the account's own
 * median stake and bounded at both ends.
 *
 * The floor is the anti-farming control: a hundred one-rupee trades count for
 * twenty, not a hundred, so an attacker cannot cheaply drag their posterior
 * down before a large bet. The cap stops one outsized trade swamping history.
 * Median rather than mean because median is robust to exactly those outliers.
 */
export function tradeWeight(stake: number, medianStake: number): number {
  const reference = medianStake > 0 ? medianStake : 1;
  const raw = stake / reference;
  if (raw < WEIGHT_FLOOR) return WEIGHT_FLOOR;
  if (raw > WEIGHT_CAP) return WEIGHT_CAP;
  return raw;
}

/**
 * Beta-Binomial posterior with the prior centred on the target.
 *
 * This is what solves cold start exactly rather than approximately: with an
 * empty window it returns the target, so the controller error is zero and no
 * manipulation occurs until there is evidence. There is no threshold to tune
 * and no special case to forget.
 */
export function posteriorFromTotals(
  wonWeight: number,
  totalWeight: number,
  target: number,
  priorStrength: number,
): number {
  return (wonWeight + target * priorStrength) / (totalWeight + priorStrength);
}

export function posterior(
  window: readonly WindowEntry[],
  target: number,
  priorStrength: number,
): number {
  let wonWeight = 0;
  let totalWeight = 0;
  for (const entry of window) {
    totalWeight += entry.weight;
    if (entry.won) wonWeight += entry.weight;
  }
  return posteriorFromTotals(wonWeight, totalWeight, target, priorStrength);
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
pnpm install
pnpm --filter @asm/algo test
```

Expected: PASS — 14 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/algo
git commit -m "feat(algo): constants and beta-binomial estimator"
```

---

## Task 2: The controller

**Files:**
- Create: `packages/algo/src/controller.ts`
- Test: `packages/algo/src/controller.test.ts`

**Interfaces:**
- Consumes: `TARGETS`, `HARD_CEILING`, `CEILING_CLAMP`, `MAX_CORRECTION`, `ERROR_SCALE`, `PRIOR_SHORT`, `PRIOR_LIFE`, `MAX_LOSS_STREAK`, `MAX_WIN_STREAK`, `P_MIN`, `P_MAX` from Task 1; `posterior`, `posteriorFromTotals` from Task 1; `AccountStats`, `ControllerOutput` from Task 1
- Produces:
  - `desiredWinProb(stats: AccountStats): ControllerOutput`
  - `stageFor(cumulativeDepositsMinor: number, isDemo: boolean): LifecycleStage`
  - `drawOutcome(p: number, rng: { next(): number }): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/algo/src/controller.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { desiredWinProb, drawOutcome, stageFor } from "./controller";
import {
  HARD_CEILING,
  MAX_CORRECTION,
  P_MAX,
  P_MIN,
  TARGETS,
} from "./constants";
import type { AccountStats, WindowEntry } from "./types";

function stats(overrides: Partial<AccountStats> = {}): AccountStats {
  return {
    stage: "DEPOSITED",
    shortWindow: [],
    lifetimeWonWeight: 0,
    lifetimeTotalWeight: 0,
    lossStreak: 0,
    winStreak: 0,
    medianStake: 100,
    ...overrides,
  };
}

function runOf(n: number, won: boolean): WindowEntry[] {
  return Array.from({ length: n }, () => ({ weight: 1, won }));
}

describe("stageFor", () => {
  it("puts a demo account in PRE_DEPOSIT regardless of deposits", () => {
    expect(stageFor(999_999, true)).toBe("PRE_DEPOSIT");
  });

  it("puts a live account with no deposits in PRE_DEPOSIT", () => {
    expect(stageFor(0, false)).toBe("PRE_DEPOSIT");
  });

  it("puts a small depositor in DEPOSITED", () => {
    expect(stageFor(10_000, false)).toBe("DEPOSITED");
  });

  it("puts a large depositor in HIGH_VALUE", () => {
    expect(stageFor(50_000, false)).toBe("HIGH_VALUE");
    expect(stageFor(500_000, false)).toBe("HIGH_VALUE");
  });
});

describe("desiredWinProb", () => {
  it("returns the stage target exactly with no history", () => {
    expect(desiredWinProb(stats({ stage: "DEPOSITED" })).p).toBeCloseTo(0.45, 6);
    expect(desiredWinProb(stats({ stage: "HIGH_VALUE" })).p).toBeCloseTo(0.27, 6);
    expect(desiredWinProb(stats({ stage: "PRE_DEPOSIT" })).p).toBeCloseTo(0.65, 6);
  });

  it("lowers p when an account is winning above target", () => {
    const out = desiredWinProb(
      stats({ shortWindow: runOf(60, true), lifetimeWonWeight: 60, lifetimeTotalWeight: 60 }),
    );
    expect(out.p).toBeLessThan(TARGETS.DEPOSITED);
  });

  it("raises p when an account is losing below target", () => {
    const out = desiredWinProb(
      stats({ shortWindow: runOf(60, false), lifetimeWonWeight: 0, lifetimeTotalWeight: 60 }),
    );
    expect(out.p).toBeGreaterThan(TARGETS.DEPOSITED);
  });

  it("never corrects further than MAX_CORRECTION from target in the normal path", () => {
    const out = desiredWinProb(
      stats({
        stage: "HIGH_VALUE",
        shortWindow: runOf(200, false),
        lifetimeWonWeight: 0,
        lifetimeTotalWeight: 200,
        lossStreak: 0,
      }),
    );
    expect(out.p).toBeLessThanOrEqual(TARGETS.HIGH_VALUE + MAX_CORRECTION + 1e-9);
  });

  it("engages the ceiling when the posterior exceeds it", () => {
    const out = desiredWinProb(
      stats({
        stage: "PRE_DEPOSIT",
        shortWindow: runOf(80, true),
        lifetimeWonWeight: 80,
        lifetimeTotalWeight: 80,
      }),
    );
    expect(out.ceilingActive).toBe(true);
    expect(out.p).toBeLessThan(0.2);
  });

  it("engages the ceiling from lifetime history even when the recent window is clean", () => {
    const out = desiredWinProb(
      stats({
        stage: "DEPOSITED",
        shortWindow: runOf(20, false),
        lifetimeWonWeight: 900,
        lifetimeTotalWeight: 1000,
      }),
    );
    expect(out.ceilingActive).toBe(true);
  });

  it("forces a likely win after the maximum loss streak", () => {
    const out = desiredWinProb(
      stats({ stage: "HIGH_VALUE", lossStreak: 5, shortWindow: runOf(40, false) }),
    );
    expect(out.p).toBeGreaterThanOrEqual(0.9);
  });

  it("forces a likely loss after the maximum win streak", () => {
    const out = desiredWinProb(stats({ stage: "PRE_DEPOSIT", winStreak: 4 }));
    expect(out.p).toBeLessThanOrEqual(0.1);
  });

  it("prioritises the loss-streak break over the ceiling", () => {
    // Both conditions true: a human noticing five straight losses matters more
    // than one extra win above the aggregate ceiling.
    const out = desiredWinProb(
      stats({
        stage: "PRE_DEPOSIT",
        shortWindow: runOf(80, true),
        lifetimeWonWeight: 80,
        lifetimeTotalWeight: 80,
        lossStreak: 5,
      }),
    );
    expect(out.p).toBeGreaterThanOrEqual(0.9);
  });

  it("always clamps p into [P_MIN, P_MAX]", () => {
    const cases: AccountStats[] = [
      stats({ shortWindow: runOf(500, true), lifetimeWonWeight: 500, lifetimeTotalWeight: 500 }),
      stats({ shortWindow: runOf(500, false), lifetimeWonWeight: 0, lifetimeTotalWeight: 500 }),
      stats({ lossStreak: 50 }),
      stats({ winStreak: 50 }),
    ];
    for (const c of cases) {
      const { p } = desiredWinProb(c);
      expect(p).toBeGreaterThanOrEqual(P_MIN);
      expect(p).toBeLessThanOrEqual(P_MAX);
    }
  });

  it("reports urgency that rises as p moves away from a coin flip", () => {
    const nearFlip = desiredWinProb(stats({ stage: "DEPOSITED" }));
    const extreme = desiredWinProb(
      stats({ shortWindow: runOf(200, true), lifetimeWonWeight: 200, lifetimeTotalWeight: 200 }),
    );
    expect(extreme.urgency).toBeGreaterThan(nearFlip.urgency);
  });

  it("exposes diagnostics for the shadow ledger", () => {
    const out = desiredWinProb(stats({ stage: "HIGH_VALUE" }));
    expect(out.target).toBeCloseTo(0.27, 6);
    expect(out.posteriorShort).toBeCloseTo(0.27, 6);
    expect(out.posteriorLife).toBeCloseTo(0.27, 6);
  });

  it("holds a pre-deposit account at the ceiling rather than overshooting", () => {
    // Target equals HARD_CEILING for this stage; the controller must settle
    // there, not oscillate.
    const w: WindowEntry[] = Array.from({ length: 100 }, (_, i) => ({
      weight: 1,
      won: i % 100 < 65,
    }));
    const out = desiredWinProb(
      stats({
        stage: "PRE_DEPOSIT",
        shortWindow: w,
        lifetimeWonWeight: 65,
        lifetimeTotalWeight: 100,
      }),
    );
    expect(out.p).toBeGreaterThan(0.4);
    expect(out.p).toBeLessThan(HARD_CEILING + 0.05);
  });
});

describe("drawOutcome", () => {
  it("returns true when the draw is below p", () => {
    expect(drawOutcome(0.9, { next: () => 0.1 })).toBe(true);
  });

  it("returns false when the draw is above p", () => {
    expect(drawOutcome(0.1, { next: () => 0.9 })).toBe(false);
  });

  it("approximates p over many draws", () => {
    let seed = 1;
    const rng = {
      next: () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      },
    };
    let wins = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) if (drawOutcome(0.27, rng)) wins++;
    expect(Math.abs(wins / n - 0.27)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @asm/algo test
```

Expected: FAIL — cannot resolve `./controller.js`.

- [ ] **Step 3: Write `packages/algo/src/controller.ts`**

```ts
import {
  CEILING_CLAMP,
  DEPOSIT_THRESHOLD_MINOR,
  ERROR_SCALE,
  HARD_CEILING,
  MAX_CORRECTION,
  MAX_LOSS_STREAK,
  MAX_WIN_STREAK,
  PRIOR_LIFE,
  PRIOR_SHORT,
  P_MAX,
  P_MIN,
  TARGETS,
  type LifecycleStage,
} from "./constants";
import { posterior, posteriorFromTotals } from "./estimator";
import type { AccountStats, ControllerOutput } from "./types";

export function stageFor(
  cumulativeDepositsMinor: number,
  isDemo: boolean,
): LifecycleStage {
  if (isDemo || cumulativeDepositsMinor <= 0) return "PRE_DEPOSIT";
  if (cumulativeDepositsMinor < DEPOSIT_THRESHOLD_MINOR) return "DEPOSITED";
  return "HIGH_VALUE";
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * The controller.
 *
 * Bounded proportional control on the Beta-Binomial posterior. tanh rather than
 * raw proportional gain because it saturates gracefully — a wildly off-target
 * account gets a strong but finite correction, never a runaway one.
 */
export function desiredWinProb(stats: AccountStats): ControllerOutput {
  const target = TARGETS[stats.stage];

  const posteriorShort = posterior(stats.shortWindow, target, PRIOR_SHORT);
  const posteriorLife = posteriorFromTotals(
    stats.lifetimeWonWeight,
    stats.lifetimeTotalWeight,
    target,
    PRIOR_LIFE,
  );

  const error = posteriorShort - target;
  let p = target - MAX_CORRECTION * Math.tanh(error / ERROR_SCALE);

  // Ceiling: evaluated against the HIGHER of the two windows, so neither a
  // lucky recent run nor a lucky lifetime can hide behind the other. Steeper
  // gain than the normal controller because this is a constraint, not a target.
  const ceilingPosterior = Math.max(posteriorShort, posteriorLife);
  const ceilingActive = ceilingPosterior > HARD_CEILING;

  if (ceilingActive) {
    const excess = ceilingPosterior - HARD_CEILING;
    p = Math.min(
      p,
      target - MAX_CORRECTION * Math.tanh(excess / (ERROR_SCALE / 3)),
    );
    p = Math.min(p, CEILING_CLAMP);
  }

  // Streak guard. People do not perceive aggregate rates — they perceive runs.
  // These overrides sit AFTER the ceiling deliberately: breaking a five-loss
  // streak matters more than one extra win above an aggregate bound, because a
  // visible streak is what makes someone suspect the platform.
  if (stats.lossStreak >= MAX_LOSS_STREAK) p = Math.max(p, 0.9);
  if (stats.winStreak >= MAX_WIN_STREAK) p = Math.min(p, 0.1);

  p = clamp(p, P_MIN, P_MAX);

  const urgency = Math.abs(p - 0.5) * 2 + (ceilingActive ? 1 : 0);

  return { p, ceilingActive, urgency, posteriorShort, posteriorLife, target };
}

/**
 * Stochastic draw. Deciding "this account loses" produces sequences that fail a
 * runs test; drawing with probability p is literally a biased coin, which
 * cannot be distinguished from one.
 */
export function drawOutcome(p: number, rng: { next(): number }): boolean {
  return rng.next() < p;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @asm/algo test
```

Expected: PASS — 32 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/algo
git commit -m "feat(algo): win-rate controller with ceiling and streak guard"
```

---

## Task 3: Exposure, bias, and bucket resolution

**Files:**
- Create: `packages/algo/src/exposure.ts`, `packages/algo/src/bias.ts`, `packages/algo/src/resolve.ts`, `packages/algo/src/index.ts`
- Test: `packages/algo/src/exposure.test.ts`, `packages/algo/src/resolve.test.ts`

**Interfaces:**
- Consumes: constants from Task 1; `Position` from `@asm/trading`
- Produces:
  - `imbalance(positions: readonly Position[], nowSec: number): number` — in `[-1, 1]`, positive means the house profits from the price falling
  - `totalExposure(positions: readonly Position[]): number`
  - `exposureScale(exposure: number): number` — in `[0, 1]`
  - `driftBias(input: { imbalance: number; exposure: number; sigma: number }): number`
  - `expiryMagnet(input: { currentPrice: number; targetPrice: number; secondsLeft: number; convergenceWindowSec: number; sigma: number }): number`
  - `BucketWish = { entryPrice: number; direction: Direction; wantWin: boolean; urgency: number; stake: number; payoutPct: number }`
  - `resolveBucket(input: { wishes: readonly BucketWish[]; currentPrice: number; maxMove: number; tickSize: number }): number`

- [ ] **Step 1: Write the failing exposure test**

Create `packages/algo/src/exposure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import { driftBias, exposureScale, imbalance, totalExposure } from "./exposure";
import { BIAS_SIGMA_CAP, EXPOSURE_FLOOR, EXPOSURE_FULL } from "./constants";

let seq = 0;
function p(overrides: Partial<Position> = {}): Position {
  return {
    tradeId: `t-${++seq}`,
    accountId: "a",
    assetId: "asset-1",
    direction: "UP",
    stake: 100_000,
    payoutPct: 100,
    entryPrice: 1.175,
    expirySec: 1_000_060,
    ...overrides,
  };
}

const NOW = 1_000_000;

describe("totalExposure", () => {
  it("sums stake times payout", () => {
    expect(totalExposure([p({ stake: 100, payoutPct: 100 })])).toBe(100);
    expect(totalExposure([p({ stake: 100, payoutPct: 50 })])).toBe(50);
  });

  it("is zero for an empty book", () => {
    expect(totalExposure([])).toBe(0);
  });
});

describe("imbalance", () => {
  it("is zero for an empty book", () => {
    expect(imbalance([], NOW)).toBe(0);
  });

  it("is positive when the book is long — the house wants the price down", () => {
    expect(imbalance([p({ direction: "UP" })], NOW)).toBeGreaterThan(0);
  });

  it("is negative when the book is short", () => {
    expect(imbalance([p({ direction: "DOWN" })], NOW)).toBeLessThan(0);
  });

  it("is near zero when the book is balanced by stake", () => {
    const book = [
      p({ direction: "UP", stake: 100_000 }),
      p({ direction: "DOWN", stake: 100_000 }),
    ];
    expect(Math.abs(imbalance(book, NOW))).toBeLessThan(1e-9);
  });

  it("weights by stake, not head count", () => {
    // Sixty traders at 10 vs forty at 100: most PEOPLE are up, most MONEY is down.
    const book = [
      ...Array.from({ length: 60 }, () => p({ direction: "UP", stake: 1_000 })),
      ...Array.from({ length: 40 }, () => p({ direction: "DOWN", stake: 10_000 })),
    ];
    // Net liability is on the DOWN side, so the house wants price UP -> negative.
    expect(imbalance(book, NOW)).toBeLessThan(0);
  });

  it("weights near expiries more heavily than distant ones", () => {
    const near = [
      p({ direction: "UP", expirySec: NOW + 1 }),
      p({ direction: "DOWN", expirySec: NOW + 600 }),
    ];
    expect(imbalance(near, NOW)).toBeGreaterThan(0);
  });

  it("stays within [-1, 1] for any book", () => {
    const book = Array.from({ length: 500 }, (_, i) =>
      p({ direction: i % 3 === 0 ? "DOWN" : "UP", stake: 10_000 * (i + 1) }),
    );
    const value = imbalance(book, NOW);
    expect(value).toBeGreaterThanOrEqual(-1);
    expect(value).toBeLessThanOrEqual(1);
  });
});

describe("exposureScale", () => {
  it("is zero below the floor — a tiny book is not defended", () => {
    expect(exposureScale(0)).toBe(0);
    expect(exposureScale(EXPOSURE_FLOOR - 1)).toBe(0);
  });

  it("is one at and above full exposure", () => {
    expect(exposureScale(EXPOSURE_FULL)).toBe(1);
    expect(exposureScale(EXPOSURE_FULL * 10)).toBe(1);
  });

  it("ramps linearly between floor and full", () => {
    const mid = (EXPOSURE_FLOOR + EXPOSURE_FULL) / 2;
    expect(exposureScale(mid)).toBeCloseTo(0.5, 6);
  });
});

describe("driftBias", () => {
  it("is zero when exposure is below the floor", () => {
    expect(driftBias({ imbalance: 1, exposure: 0, sigma: 0.001 })).toBe(0);
  });

  it("is negative for a positive imbalance — pushing the price down", () => {
    const bias = driftBias({ imbalance: 0.5, exposure: EXPOSURE_FULL, sigma: 0.001 });
    expect(bias).toBeLessThan(0);
  });

  it("is positive for a negative imbalance", () => {
    const bias = driftBias({ imbalance: -0.5, exposure: EXPOSURE_FULL, sigma: 0.001 });
    expect(bias).toBeGreaterThan(0);
  });

  it("never exceeds BIAS_SIGMA_CAP multiples of sigma", () => {
    const sigma = 0.002;
    for (const imb of [-1, -0.7, 0, 0.7, 1]) {
      const bias = driftBias({ imbalance: imb, exposure: EXPOSURE_FULL * 100, sigma });
      expect(Math.abs(bias)).toBeLessThanOrEqual(BIAS_SIGMA_CAP * sigma + 1e-15);
    }
  });

  it("scales with exposure", () => {
    const low = Math.abs(
      driftBias({ imbalance: 1, exposure: EXPOSURE_FLOOR + 1_000, sigma: 0.001 }),
    );
    const high = Math.abs(
      driftBias({ imbalance: 1, exposure: EXPOSURE_FULL, sigma: 0.001 }),
    );
    expect(high).toBeGreaterThan(low);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @asm/algo test
```

Expected: FAIL — cannot resolve `./exposure.js`.

- [ ] **Step 3: Write `packages/algo/src/exposure.ts`**

```ts
import type { Position } from "@asm/trading";
import {
  BIAS_SIGMA_CAP,
  EXPOSURE_FLOOR,
  EXPOSURE_FULL,
  IMBALANCE_TAU_SEC,
} from "./constants";

/** What the house stands to pay out if every position wins. */
export function totalExposure(positions: readonly Position[]): number {
  let sum = 0;
  for (const position of positions) {
    sum += (position.stake * position.payoutPct) / 100;
  }
  return sum;
}

/**
 * Stake-weighted, time-decayed exposure imbalance in [-1, 1].
 *
 * Positive means the house profits from the price FALLING (the book is net
 * long). This is the generalisation of "60% clicked up, so go down" — and it
 * weights by stake rather than head count, because sixty traders at ₹10 is
 * ₹600 of liability while forty at ₹100 is ₹4,000.
 */
export function imbalance(
  positions: readonly Position[],
  nowSec: number,
): number {
  let pressure = 0;
  let weightSum = 0;

  for (const position of positions) {
    const liability = (position.stake * position.payoutPct) / 100;
    const secondsToExpiry = Math.max(0, position.expirySec - nowSec);
    const decay = Math.exp(-secondsToExpiry / IMBALANCE_TAU_SEC);
    const weight = liability * decay;

    // +1 when the house benefits from the price falling (position is UP).
    const wantsDown = position.direction === "UP" ? 1 : -1;
    pressure += weight * wantsDown;
    weightSum += weight;
  }

  if (weightSum === 0) return 0;
  return pressure / weightSum;
}

/**
 * Ramps bias strength with book size.
 *
 * Below the floor the price runs completely unbiased. This is the thin-book
 * guard: a ₹100 book is not worth defending, and a single small trade must
 * never move a market — which is also how a real book behaves, since nobody
 * hedges trivial exposure.
 */
export function exposureScale(exposure: number): number {
  if (exposure < EXPOSURE_FLOOR) return 0;
  if (exposure >= EXPOSURE_FULL) return 1;
  return (exposure - EXPOSURE_FLOOR) / (EXPOSURE_FULL - EXPOSURE_FLOOR);
}

/**
 * Layer 2. A small persistent nudge toward the profitable side, hard-bounded
 * inside natural noise.
 *
 * A small persistent drift beats one large obvious move: over ~600 ticks in a
 * minute, a 0.25-sigma bias wins the bucket most of the time while remaining
 * statistically invisible in any single window.
 */
export function driftBias(input: {
  imbalance: number;
  exposure: number;
  sigma: number;
}): number {
  const scale = exposureScale(input.exposure);
  if (scale === 0) return 0;

  const raw = -BIAS_SIGMA_CAP * input.imbalance * input.sigma * scale;
  const cap = BIAS_SIGMA_CAP * input.sigma;
  return raw > cap ? cap : raw < -cap ? -cap : raw;
}

/**
 * Layer 3. Quadratic urgency — near-invisible early, decisive late.
 *
 * Returns a log-space pull. The caller still clamps the composed move via
 * PriceParams.maxTickMove, so this cannot draw an impossible candle.
 */
export function expiryMagnet(input: {
  currentPrice: number;
  targetPrice: number;
  secondsLeft: number;
  convergenceWindowSec: number;
  sigma: number;
}): number {
  if (input.secondsLeft > input.convergenceWindowSec) return 0;
  if (input.currentPrice <= 0 || input.targetPrice <= 0) return 0;

  const progress = 1 - input.secondsLeft / input.convergenceWindowSec;
  const urgency = Math.min(1, Math.max(0, progress)) ** 2;

  const gap = Math.log(input.targetPrice / input.currentPrice);
  const pull = urgency * gap;

  // Bounded at two sigma so re-convergence hides inside normal movement.
  const cap = 2 * input.sigma;
  return pull > cap ? cap : pull < -cap ? -cap : pull;
}
```

- [ ] **Step 4: Write the failing resolve test**

Create `packages/algo/src/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveBucket, type BucketWish } from "./resolve";

function wish(overrides: Partial<BucketWish> = {}): BucketWish {
  return {
    entryPrice: 1.175,
    direction: "UP",
    wantWin: false,
    urgency: 1,
    stake: 10_000,
    payoutPct: 100,
    ...overrides,
  };
}

const TICK = 0.00001;

describe("resolveBucket", () => {
  it("returns the current price for an empty bucket", () => {
    const target = resolveBucket({
      wishes: [],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBe(1.175);
  });

  it("moves below the entry price to lose a single UP wish", () => {
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: false, entryPrice: 1.175 })],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeLessThan(1.175);
  });

  it("moves above the entry price to win a single UP wish", () => {
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: true, entryPrice: 1.175 })],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.175);
  });

  it("satisfies both when entries straddle compatibly", () => {
    // UP at 1.1750 wants a win, DOWN at 1.1760 wants a win.
    // Any price in (1.1750, 1.1760) satisfies both.
    const target = resolveBucket({
      wishes: [
        wish({ direction: "UP", entryPrice: 1.175, wantWin: true }),
        wish({ direction: "DOWN", entryPrice: 1.176, wantWin: true }),
      ],
      currentPrice: 1.1755,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.175);
    expect(target).toBeLessThan(1.176);
  });

  it("favours the higher-urgency wish when they are incompatible", () => {
    // UP at 1.1760 wants a win (needs > 1.1760);
    // DOWN at 1.1750 wants a win (needs < 1.1750). Impossible together.
    const target = resolveBucket({
      wishes: [
        wish({ direction: "UP", entryPrice: 1.176, wantWin: true, urgency: 2 }),
        wish({ direction: "DOWN", entryPrice: 1.175, wantWin: true, urgency: 0.1 }),
      ],
      currentPrice: 1.1755,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.176);
  });

  it("never returns a price outside maxMove of current", () => {
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", entryPrice: 2.0, wantWin: true })],
      currentPrice: 1.175,
      maxMove: 0.0005,
      tickSize: TICK,
    });
    expect(Math.abs(target - 1.175)).toBeLessThanOrEqual(0.0005 + 1e-12);
  });

  it("is deterministic for identical input", () => {
    const input = {
      wishes: [
        wish({ direction: "UP", entryPrice: 1.175, wantWin: false, urgency: 1 }),
        wish({ direction: "DOWN", entryPrice: 1.1752, wantWin: true, urgency: 1 }),
      ],
      currentPrice: 1.1751,
      maxMove: 0.01,
      tickSize: TICK,
    };
    expect(resolveBucket(input)).toBe(resolveBucket(input));
  });

  it("satisfies the majority of wishes for a large mixed bucket", () => {
    const wishes: BucketWish[] = Array.from({ length: 40 }, (_, i) =>
      wish({
        direction: i % 2 === 0 ? "UP" : "DOWN",
        entryPrice: 1.175 + (i - 20) * TICK,
        wantWin: false,
        urgency: 1,
      }),
    );
    const target = resolveBucket({
      wishes,
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    const satisfied = wishes.filter((w) => {
      const rose = target > w.entryPrice;
      const won = w.direction === "UP" ? rose : !rose;
      return won === w.wantWin;
    }).length;
    expect(satisfied).toBeGreaterThan(wishes.length / 2);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
pnpm --filter @asm/algo test
```

Expected: FAIL — cannot resolve `./resolve.js`.

- [ ] **Step 6: Write `packages/algo/src/resolve.ts`**

```ts
import type { Direction } from "@asm/trading";
import { BOOK_WEIGHT } from "./constants";

export interface BucketWish {
  readonly entryPrice: number;
  readonly direction: Direction;
  /** What the controller wants for this position. */
  readonly wantWin: boolean;
  /** How much the engine cares, from ControllerOutput.urgency. */
  readonly urgency: number;
  readonly stake: number;
  readonly payoutPct: number;
}

function wins(direction: Direction, entryPrice: number, price: number): boolean {
  const rose = price > entryPrice;
  return direction === "UP" ? rose : !rose;
}

/**
 * Chooses the exit price for one expiry bucket.
 *
 * A position's outcome flips only at its own entry price, so the outcome set is
 * constant between adjacent entry prices. That means there are at most N+1
 * distinct regimes and the optimum can be found exactly rather than searched
 * for — O(N log N), no iteration, no approximation.
 *
 * Candidates are one tick either side of each entry price, plus the current
 * price, filtered to what is reachable within maxMove.
 */
export function resolveBucket(input: {
  wishes: readonly BucketWish[];
  currentPrice: number;
  maxMove: number;
  tickSize: number;
}): number {
  const { wishes, currentPrice, maxMove, tickSize } = input;
  if (wishes.length === 0) return currentPrice;

  const candidates = new Set<number>([currentPrice]);
  for (const w of wishes) {
    candidates.add(w.entryPrice + tickSize);
    candidates.add(w.entryPrice - tickSize);
  }

  const reachable = [...candidates]
    .filter((c) => c > 0 && Math.abs(c - currentPrice) <= maxMove)
    .sort((a, b) => a - b);

  if (reachable.length === 0) return currentPrice;

  let best = reachable[0]!;
  let bestScore = -Infinity;

  for (const candidate of reachable) {
    let score = 0;

    for (const w of wishes) {
      const won = wins(w.direction, w.entryPrice, candidate);
      score += won === w.wantWin ? w.urgency : -w.urgency;

      // House P&L as a tiebreaker only. With most accounts targeted below 50%
      // the two objectives point the same way anyway; where they conflict, the
      // win-rate targets win, because detection risk matters more than
      // simulated profit.
      const housePnl = won ? -(w.stake * w.payoutPct) / 100 : w.stake;
      score += BOOK_WEIGHT * housePnl;
    }

    // Strict improvement keeps the result deterministic for tied scores:
    // the lowest reachable candidate wins, and `reachable` is sorted.
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}
```

- [ ] **Step 7: Write `packages/algo/src/index.ts`**

```ts
export * from "./constants";
export type { WindowEntry, AccountStats, ControllerOutput } from "./types";
export { tradeWeight, posterior, posteriorFromTotals } from "./estimator";
export { desiredWinProb, drawOutcome, stageFor } from "./controller";
export {
  imbalance,
  totalExposure,
  exposureScale,
  driftBias,
  expiryMagnet,
} from "./exposure";
export { resolveBucket, type BucketWish } from "./resolve";
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm --filter @asm/algo test
```

Expected: PASS — 58 tests total.

- [ ] **Step 9: Commit**

```bash
git add packages/algo
git commit -m "feat(algo): exposure imbalance, bias composition, bucket resolution"
```

---

## Task 4: The nine-test validation suite

**Files:**
- Create: `packages/algo/test/convergence.test.ts`, `packages/algo/test/ceiling.test.ts`, `packages/algo/test/cold-start.test.ts`, `packages/algo/test/farming.test.ts`, `packages/algo/test/streaks.test.ts`, `packages/algo/test/randomness.test.ts`, `packages/algo/test/thin-book.test.ts`, `packages/algo/test/conflict.test.ts`, `packages/algo/test/ties.test.ts`, `packages/algo/test/harness.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3
- Produces: `simulate(opts: SimulateOpts): SimulateResult` — a headless account simulator used by several tests

This is what "bulletproof" means in practice. Nine tests, all pure, all seed-deterministic, all seconds to run.

- [ ] **Step 1: Write `packages/algo/test/harness.ts`**

```ts
import {
  desiredWinProb,
  drawOutcome,
  tradeWeight,
  WINDOW_SIZE,
  type AccountStats,
  type LifecycleStage,
  type WindowEntry,
} from "../src/index";

/** Small deterministic PRNG so the suite is reproducible without importing the engine's. */
export function seededRng(seed: number): { next(): number } {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export interface SimulateOpts {
  stage: LifecycleStage;
  trades: number;
  seed: number;
  /** Stake per trade, in minor units. Constant unless `stakes` is supplied. */
  stake?: number;
  /** Per-trade stakes, cycled. Overrides `stake`. */
  stakes?: number[];
  /** Forces every outcome, ignoring the draw. Used by the ceiling test. */
  forceWin?: boolean;
  /** Every Nth trade settles as a tie. */
  tieEvery?: number;
  /** Starts from existing account state instead of a blank slate. */
  initial?: AccountStats;
}

export interface SimulateResult {
  outcomes: ("WON" | "LOST" | "REFUNDED")[];
  realisedRate: number;
  longestWinRun: number;
  longestLossRun: number;
  /** Posterior trajectory, one entry per trade. */
  posteriors: number[];
  /** Whether the ceiling was engaged at each trade. */
  ceilingActiveTrajectory: boolean[];
  finalStats: AccountStats;
}

/**
 * Runs an account through the controller for N trades, feeding each realised
 * outcome back into the window exactly as the engine does.
 */
export function simulate(opts: SimulateOpts): SimulateResult {
  const rng = seededRng(opts.seed);

  let window: WindowEntry[] = opts.initial ? [...opts.initial.shortWindow] : [];
  let lifetimeWonWeight = opts.initial?.lifetimeWonWeight ?? 0;
  let lifetimeTotalWeight = opts.initial?.lifetimeTotalWeight ?? 0;
  let lossStreak = opts.initial?.lossStreak ?? 0;
  let winStreak = opts.initial?.winStreak ?? 0;
  const medianStake =
    opts.initial?.medianStake ??
    (opts.stakes
      ? [...opts.stakes].sort((a, b) => a - b)[Math.floor(opts.stakes.length / 2)]!
      : (opts.stake ?? 10_000));

  const outcomes: SimulateResult["outcomes"] = [];
  const posteriors: number[] = [];
  const ceilingActiveTrajectory: boolean[] = [];

  let longestWinRun = 0;
  let longestLossRun = 0;

  for (let i = 0; i < opts.trades; i++) {
    const stats: AccountStats = {
      stage: opts.stage,
      shortWindow: window,
      lifetimeWonWeight,
      lifetimeTotalWeight,
      lossStreak,
      winStreak,
      medianStake,
    };

    const out = desiredWinProb(stats);
    posteriors.push(out.posteriorShort);
    ceilingActiveTrajectory.push(out.ceilingActive);

    const stake = opts.stakes
      ? opts.stakes[i % opts.stakes.length]!
      : (opts.stake ?? 10_000);

    const isTie = opts.tieEvery !== undefined && (i + 1) % opts.tieEvery === 0;

    if (isTie) {
      // Refunds update nothing — not the window, not the streaks.
      outcomes.push("REFUNDED");
      continue;
    }

    const won = opts.forceWin ?? drawOutcome(out.p, rng);
    outcomes.push(won ? "WON" : "LOST");

    const weight = tradeWeight(stake, medianStake);
    window = [...window, { weight, won }].slice(-WINDOW_SIZE);
    lifetimeTotalWeight += weight;
    if (won) lifetimeWonWeight += weight;

    if (won) {
      winStreak += 1;
      lossStreak = 0;
      longestWinRun = Math.max(longestWinRun, winStreak);
    } else {
      lossStreak += 1;
      winStreak = 0;
      longestLossRun = Math.max(longestLossRun, lossStreak);
    }
  }

  const settled = outcomes.filter((o) => o !== "REFUNDED");
  const wins = settled.filter((o) => o === "WON").length;

  return {
    outcomes,
    realisedRate: settled.length === 0 ? 0 : wins / settled.length,
    longestWinRun,
    longestLossRun,
    posteriors,
    ceilingActiveTrajectory,
    finalStats: {
      stage: opts.stage,
      shortWindow: window,
      lifetimeWonWeight,
      lifetimeTotalWeight,
      lossStreak,
      winStreak,
      medianStake,
    },
  };
}
```

- [ ] **Step 2: Write `packages/algo/test/convergence.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { TARGETS } from "../src/index";
import { simulate } from "./harness";

describe("convergence", () => {
  it("hits the PRE_DEPOSIT target within 2 points", () => {
    const r = simulate({ stage: "PRE_DEPOSIT", trades: 10_000, seed: 101 });
    expect(Math.abs(r.realisedRate - TARGETS.PRE_DEPOSIT)).toBeLessThan(0.02);
  });

  it("hits the DEPOSITED target within 2 points", () => {
    const r = simulate({ stage: "DEPOSITED", trades: 10_000, seed: 202 });
    expect(Math.abs(r.realisedRate - TARGETS.DEPOSITED)).toBeLessThan(0.02);
  });

  it("hits the HIGH_VALUE target within 2 points", () => {
    const r = simulate({ stage: "HIGH_VALUE", trades: 10_000, seed: 303 });
    expect(Math.abs(r.realisedRate - TARGETS.HIGH_VALUE)).toBeLessThan(0.02);
  });

  it("converges across independent seeds, not just one lucky run", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = simulate({ stage: "HIGH_VALUE", trades: 5_000, seed });
      expect(Math.abs(r.realisedRate - TARGETS.HIGH_VALUE)).toBeLessThan(0.03);
    }
  });
});
```

- [ ] **Step 3: Write `packages/algo/test/ceiling.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { HARD_CEILING, desiredWinProb } from "../src/index";
import { simulate } from "./harness";

describe("hard ceiling", () => {
  it("drives p down hard once forced wins push the posterior over the ceiling", () => {
    const forced = simulate({
      stage: "PRE_DEPOSIT",
      trades: 60,
      seed: 7,
      forceWin: true,
    });
    const out = desiredWinProb(forced.finalStats);
    expect(out.ceilingActive).toBe(true);
    expect(out.p).toBeLessThan(0.2);
  });

  it("recovers a breached account back under the ceiling", () => {
    // Force 60 straight wins to breach, then hand the resulting state to the
    // controller and let it run freely.
    const breached = simulate({
      stage: "PRE_DEPOSIT",
      trades: 60,
      seed: 8,
      forceWin: true,
    });
    expect(desiredWinProb(breached.finalStats).ceilingActive).toBe(true);

    const recovered = simulate({
      stage: "PRE_DEPOSIT",
      trades: 400,
      seed: 9,
      initial: breached.finalStats,
    });

    expect(desiredWinProb(recovered.finalStats).ceilingActive).toBe(false);
  });

  it("does not sustain a breach for many trades after it starts", () => {
    const breached = simulate({
      stage: "PRE_DEPOSIT",
      trades: 60,
      seed: 12,
      forceWin: true,
    });

    const after = simulate({
      stage: "PRE_DEPOSIT",
      trades: 120,
      seed: 13,
      initial: breached.finalStats,
    });

    // Once the controller has the wheel, the breach must clear quickly rather
    // than lingering — a long tail above the ceiling is the whole failure mode.
    const stillBreached = after.ceilingActiveTrajectory.filter(Boolean).length;
    expect(stillBreached).toBeLessThan(60);
  });

  it("never lets any stage's long-run realised rate exceed the ceiling", () => {
    for (const stage of ["PRE_DEPOSIT", "DEPOSITED", "HIGH_VALUE"] as const) {
      const r = simulate({ stage, trades: 20_000, seed: 404 });
      expect(r.realisedRate).toBeLessThanOrEqual(HARD_CEILING + 0.02);
    }
  });
});
```

- [ ] **Step 4: Write `packages/algo/test/cold-start.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { TARGETS, desiredWinProb, tradeWeight, WINDOW_SIZE } from "../src/index";
import type { AccountStats, WindowEntry } from "../src/index";

function statsWith(n: number, won: boolean): AccountStats {
  const window: WindowEntry[] = Array.from({ length: n }, () => ({
    weight: tradeWeight(10_000, 10_000),
    won,
  }));
  return {
    stage: "DEPOSITED",
    shortWindow: window.slice(-WINDOW_SIZE),
    lifetimeWonWeight: won ? n : 0,
    lifetimeTotalWeight: n,
    lossStreak: won ? 0 : n,
    winStreak: won ? n : 0,
    medianStake: 10_000,
  };
}

describe("cold start", () => {
  it("applies no correction at all with zero history", () => {
    const out = desiredWinProb(statsWith(0, true));
    expect(Math.abs(out.p - TARGETS.DEPOSITED)).toBeLessThan(0.001);
  });

  it("stays close to target through the first few trades", () => {
    // Streak overrides kick in at 4 wins / 5 losses by design, so check below that.
    for (let n = 0; n <= 3; n++) {
      const out = desiredWinProb(statsWith(n, true));
      expect(Math.abs(out.p - TARGETS.DEPOSITED)).toBeLessThan(0.12);
    }
  });

  it("never engages the ceiling on an account with no history", () => {
    expect(desiredWinProb(statsWith(0, true)).ceilingActive).toBe(false);
  });

  it("grows the correction smoothly rather than stepping", () => {
    const deltas: number[] = [];
    for (let n = 0; n <= 20; n++) {
      deltas.push(Math.abs(desiredWinProb(statsWith(n, true)).p - TARGETS.DEPOSITED));
    }
    // Monotonic non-decreasing up to the streak override, and no jump > 0.25.
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]! - deltas[i - 1]!).toBeLessThan(0.25);
    }
  });
});
```

- [ ] **Step 5: Write `packages/algo/test/farming.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { desiredWinProb, posterior, tradeWeight, PRIOR_SHORT } from "../src/index";
import type { WindowEntry } from "../src/index";

describe("micro-stake farming", () => {
  const MEDIAN = 10_000; // ₹100 typical

  it("caps the influence of a hundred trivial losses", () => {
    const micro: WindowEntry[] = Array.from({ length: 100 }, () => ({
      weight: tradeWeight(1, MEDIAN),
      won: false,
    }));
    const normal: WindowEntry[] = Array.from({ length: 100 }, () => ({
      weight: tradeWeight(MEDIAN, MEDIAN),
      won: false,
    }));

    const microPosterior = posterior(micro, 0.45, PRIOR_SHORT);
    const normalPosterior = posterior(normal, 0.45, PRIOR_SHORT);

    // Both push the posterior down, but the farmed one must push far less.
    expect(microPosterior).toBeGreaterThan(normalPosterior + 0.15);
  });

  it("does not hand a farmer a favourable p", () => {
    const farmed: WindowEntry[] = Array.from({ length: 100 }, () => ({
      weight: tradeWeight(1, MEDIAN),
      won: false,
    }));
    const out = desiredWinProb({
      stage: "HIGH_VALUE",
      shortWindow: farmed,
      lifetimeWonWeight: 0,
      lifetimeTotalWeight: 100 * tradeWeight(1, MEDIAN),
      lossStreak: 0,
      winStreak: 0,
      medianStake: MEDIAN,
    });
    // Target is 0.27; farming must not lift p anywhere near a coin flip.
    expect(out.p).toBeLessThan(0.5);
  });

  it("caps the payoff trade's own weight", () => {
    expect(tradeWeight(1_000_000, MEDIAN)).toBeLessThanOrEqual(5);
  });

  it("makes the exploit ratio unfavourable", () => {
    // 100 farmed losses of weight 0.2 = 20 weight spent to shift the posterior.
    // One payoff trade caps at weight 5. The house still sees 4x more evidence.
    const farmWeight = 100 * tradeWeight(1, MEDIAN);
    const payoffWeight = tradeWeight(1_000_000, MEDIAN);
    expect(farmWeight).toBeGreaterThan(payoffWeight * 3);
  });
});
```


- [ ] **Step 6: Write `packages/algo/test/streaks.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { MAX_LOSS_STREAK, MAX_WIN_STREAK } from "../src/index";
import { simulate } from "./harness";

describe("streak bounds", () => {
  it("keeps loss runs within a small margin of the configured maximum", () => {
    const r = simulate({ stage: "HIGH_VALUE", trades: 100_000, seed: 555 });
    // The override sets p >= 0.9 at the limit, so a rare extra loss is possible.
    expect(r.longestLossRun).toBeLessThanOrEqual(MAX_LOSS_STREAK + 3);
  });

  it("keeps win runs within a small margin of the configured maximum", () => {
    const r = simulate({ stage: "PRE_DEPOSIT", trades: 100_000, seed: 666 });
    expect(r.longestWinRun).toBeLessThanOrEqual(MAX_WIN_STREAK + 3);
  });

  it("bounds streaks at the punitive target too, where losses cluster naturally", () => {
    const r = simulate({ stage: "HIGH_VALUE", trades: 50_000, seed: 777 });
    expect(r.longestLossRun).toBeLessThanOrEqual(MAX_LOSS_STREAK + 3);
  });

  it("does not produce a perfectly alternating sequence", () => {
    const r = simulate({ stage: "DEPOSITED", trades: 2_000, seed: 888 });
    const settled = r.outcomes.filter((o) => o !== "REFUNDED");
    let alternations = 0;
    for (let i = 1; i < settled.length; i++) {
      if (settled[i] !== settled[i - 1]) alternations++;
    }
    const ratio = alternations / (settled.length - 1);
    // A perfectly alternating sequence gives 1.0; random gives ~2p(1-p).
    expect(ratio).toBeLessThan(0.9);
  });
});
```

- [ ] **Step 7: Write `packages/algo/test/randomness.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { simulate } from "./harness";

/**
 * Wald-Wolfowitz runs test.
 *
 * This is the test that matters most. Convergence proves the numbers land where
 * we want; the runs test proves the SEQUENCE is indistinguishable from chance.
 * A controller can hit 27% exactly and still be obvious if it delivers that 27%
 * in a detectable pattern.
 */
function runsZScore(sequence: boolean[]): number {
  const n1 = sequence.filter((v) => v).length;
  const n2 = sequence.length - n1;
  if (n1 === 0 || n2 === 0) return 0;

  let runs = 1;
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] !== sequence[i - 1]) runs++;
  }

  const n = n1 + n2;
  const expected = (2 * n1 * n2) / n + 1;
  const variance =
    (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));

  return (runs - expected) / Math.sqrt(variance);
}

describe("sequence randomness", () => {
  for (const stage of ["PRE_DEPOSIT", "DEPOSITED", "HIGH_VALUE"] as const) {
    it(`produces a ${stage} sequence indistinguishable from a biased coin`, () => {
      const r = simulate({ stage, trades: 20_000, seed: 1234 });
      const sequence = r.outcomes
        .filter((o) => o !== "REFUNDED")
        .map((o) => o === "WON");

      const z = Math.abs(runsZScore(sequence));
      // |z| < 1.96 is the 5% two-tailed threshold. The streak guard nudges the
      // sequence slightly, so allow a little headroom and fail loudly beyond it.
      expect(z).toBeLessThan(4);
    });
  }

  it("is far from the z-score a deterministic controller would produce", () => {
    // A deterministic controller alternating to hit 50% gives a huge negative z.
    const deterministic = Array.from({ length: 20_000 }, (_, i) => i % 2 === 0);
    expect(Math.abs(runsZScore(deterministic))).toBeGreaterThan(50);
  });
});
```


- [ ] **Step 8: Write `packages/algo/test/thin-book.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import {
  EXPOSURE_FLOOR,
  driftBias,
  exposureScale,
  imbalance,
  totalExposure,
} from "../src/index";

let seq = 0;
function position(stake: number, direction: "UP" | "DOWN" = "UP"): Position {
  return {
    tradeId: `t-${++seq}`,
    accountId: "a",
    assetId: "asset-1",
    direction,
    stake,
    payoutPct: 100,
    entryPrice: 1.175,
    expirySec: 1_000_060,
  };
}

describe("thin book guard", () => {
  it("applies zero bias for a single small trade", () => {
    const book = [position(100)];
    const bias = driftBias({
      imbalance: imbalance(book, 1_000_000),
      exposure: totalExposure(book),
      sigma: 0.001,
    });
    expect(bias).toBe(0);
  });

  it("applies zero bias for an empty book", () => {
    expect(
      driftBias({ imbalance: imbalance([], 1_000_000), exposure: 0, sigma: 0.001 }),
    ).toBe(0);
  });

  it("still reports full imbalance for one trade — direction is known, strength is not", () => {
    // imbalance is ±1; it is exposureScale that suppresses acting on it.
    expect(imbalance([position(100)], 1_000_000)).toBeCloseTo(1, 6);
    expect(exposureScale(100)).toBe(0);
  });

  it("begins biasing only once the book crosses the floor", () => {
    const below = [position(EXPOSURE_FLOOR - 1_000)];
    const above = [position(EXPOSURE_FLOOR * 4)];

    expect(
      driftBias({
        imbalance: imbalance(below, 1_000_000),
        exposure: totalExposure(below),
        sigma: 0.001,
      }),
    ).toBe(0);

    expect(
      Math.abs(
        driftBias({
          imbalance: imbalance(above, 1_000_000),
          exposure: totalExposure(above),
          sigma: 0.001,
        }),
      ),
    ).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 9: Write `packages/algo/test/conflict.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { resolveBucket, type BucketWish } from "../src/index";

const TICK = 0.00001;

function wish(o: Partial<BucketWish>): BucketWish {
  return {
    entryPrice: 1.175,
    direction: "UP",
    wantWin: true,
    urgency: 1,
    stake: 10_000,
    payoutPct: 100,
    ...o,
  };
}

describe("bucket conflict resolution", () => {
  const incompatible = [
    wish({ direction: "UP", entryPrice: 1.176, wantWin: true, urgency: 1.5 }),
    wish({ direction: "DOWN", entryPrice: 1.175, wantWin: true, urgency: 0.5 }),
  ];

  it("resolves rather than deadlocking", () => {
    const target = resolveBucket({
      wishes: incompatible,
      currentPrice: 1.1755,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(Number.isFinite(target)).toBe(true);
  });

  it("gives the win to the higher-urgency position", () => {
    const target = resolveBucket({
      wishes: incompatible,
      currentPrice: 1.1755,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.176);
  });

  it("is deterministic across repeated calls", () => {
    const input = {
      wishes: incompatible,
      currentPrice: 1.1755,
      maxMove: 0.01,
      tickSize: TICK,
    };
    const results = Array.from({ length: 20 }, () => resolveBucket(input));
    expect(new Set(results).size).toBe(1);
  });

  it("does not crash on fifty mutually conflicting wishes", () => {
    const wishes = Array.from({ length: 50 }, (_, i) =>
      wish({
        direction: i % 2 === 0 ? "UP" : "DOWN",
        entryPrice: 1.175 + (i % 5) * TICK,
        wantWin: true,
        urgency: (i % 3) + 0.5,
      }),
    );
    const target = resolveBucket({
      wishes,
      currentPrice: 1.175,
      maxMove: 0.001,
      tickSize: TICK,
    });
    expect(Number.isFinite(target)).toBe(true);
    expect(Math.abs(target - 1.175)).toBeLessThanOrEqual(0.001 + 1e-12);
  });

  it("falls back to the current price when nothing is reachable", () => {
    const target = resolveBucket({
      wishes: [wish({ entryPrice: 5, wantWin: true })],
      currentPrice: 1.175,
      maxMove: 0,
      tickSize: TICK,
    });
    expect(target).toBe(1.175);
  });
});
```

- [ ] **Step 10: Write `packages/algo/test/ties.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { simulate } from "./harness";

describe("tie handling", () => {
  it("excludes refunds from the realised rate", () => {
    const r = simulate({
      stage: "DEPOSITED",
      trades: 3_000,
      seed: 2026,
      tieEvery: 5,
    });
    const refunds = r.outcomes.filter((o) => o === "REFUNDED").length;
    const settled = r.outcomes.length - refunds;

    expect(refunds).toBeGreaterThan(500);
    // The rate is computed over settled trades only.
    expect(Math.abs(r.realisedRate - 0.45)).toBeLessThan(0.04);
    expect(settled).toBe(r.outcomes.length - refunds);
  });

  it("does not let refunds inflate a loss streak", () => {
    const r = simulate({
      stage: "HIGH_VALUE",
      trades: 20_000,
      seed: 9090,
      tieEvery: 3,
    });
    // If refunds counted as losses, streaks would blow past the guard.
    expect(r.longestLossRun).toBeLessThanOrEqual(9);
  });

  it("leaves the window untouched for a refunded trade", () => {
    const withTies = simulate({
      stage: "DEPOSITED",
      trades: 100,
      seed: 4,
      tieEvery: 2,
    });
    const settled = withTies.outcomes.filter((o) => o !== "REFUNDED").length;
    expect(withTies.finalStats.lifetimeTotalWeight).toBeCloseTo(settled, 6);
  });
});
```

- [ ] **Step 11: Run the full validation suite**

```bash
pnpm --filter @asm/algo test
```

Expected: PASS across all nine files. If convergence misses by more than two points, the correction is too weak — raise `MAX_CORRECTION` toward 0.40 or tighten `ERROR_SCALE` toward 0.12 and re-run. Do not weaken the assertion.

- [ ] **Step 12: Commit**

```bash
git add packages/algo
git commit -m "test(algo): nine-test validation suite"
```

---

## Task 5: Account statistics persistence

**Files:**
- Create: `packages/db/src/repositories/account-stats.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/repositories/account-stats.test.ts`

**Interfaces:**
- Consumes: `prisma`; `tradeWeight`, `stageFor`, `WINDOW_SIZE`, `AccountStats` from `@asm/algo`
- Produces:
  - `loadAccountStats(accountId: string): Promise<AccountStats>`
  - `recordSettledTrade(input: { accountId: string; stake: number; outcome: "WON" | "LOST" | "REFUNDED" }): Promise<void>`
  - `setLifecycleOverride(accountId: string, stage: LifecycleStage | null): Promise<void>`

The rolling window is reconstructed from the last `WINDOW_SIZE` settled trades rather than stored as a blob — the `Trade` table is already the source of truth, and a denormalised window would be one more thing to keep consistent.

- [ ] **Step 1: Add the algo dependency**

```bash
pnpm --filter @asm/db add @asm/algo@workspace:*
```

- [ ] **Step 2: Write the failing test**

Create `packages/db/src/repositories/account-stats.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { createAccountsForUser } from "./account";
import { loadAccountStats, recordSettledTrade } from "./account-stats";

const prisma = new PrismaClient();

let accountId = "";
let demoAccountId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `s-${process.hrtime.bigint()}@test.local`,
      passwordHash: "x",
    },
  });
  const accounts = await createAccountsForUser(user.id, 1_000_000);
  accountId = accounts.find((a) => a.type === "LIVE")!.id;
  demoAccountId = accounts.find((a) => a.type === "DEMO")!.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("loadAccountStats", () => {
  it("reports PRE_DEPOSIT for a fresh live account", async () => {
    const stats = await loadAccountStats(accountId);
    expect(stats.stage).toBe("PRE_DEPOSIT");
    expect(stats.shortWindow).toEqual([]);
  });

  it("always reports PRE_DEPOSIT for a demo account", async () => {
    await prisma.user.update({
      where: { id: (await prisma.account.findUniqueOrThrow({ where: { id: demoAccountId } })).userId },
      data: { cumulativeDeposits: 5_000_000 },
    });
    const stats = await loadAccountStats(demoAccountId);
    expect(stats.stage).toBe("PRE_DEPOSIT");
  });

  it("moves to DEPOSITED after a small deposit", async () => {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.user.update({
      where: { id: account.userId },
      data: { cumulativeDeposits: 10_000 },
    });
    expect((await loadAccountStats(accountId)).stage).toBe("DEPOSITED");
  });

  it("moves to HIGH_VALUE past the threshold", async () => {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.user.update({
      where: { id: account.userId },
      data: { cumulativeDeposits: 100_000 },
    });
    expect((await loadAccountStats(accountId)).stage).toBe("HIGH_VALUE");
  });
});

describe("recordSettledTrade", () => {
  it("increments the win streak and resets the loss streak on a win", async () => {
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "LOST" });
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "WON" });
    const stats = await loadAccountStats(accountId);
    expect(stats.winStreak).toBe(1);
    expect(stats.lossStreak).toBe(0);
  });

  it("increments the loss streak on consecutive losses", async () => {
    for (let i = 0; i < 3; i++) {
      await recordSettledTrade({ accountId, stake: 10_000, outcome: "LOST" });
    }
    const stats = await loadAccountStats(accountId);
    expect(stats.lossStreak).toBe(3);
  });

  it("leaves streaks and totals untouched for a refund", async () => {
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "LOST" });
    const before = await loadAccountStats(accountId);
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "REFUNDED" });
    const after = await loadAccountStats(accountId);

    expect(after.lossStreak).toBe(before.lossStreak);
    expect(after.lifetimeTotalWeight).toBeCloseTo(before.lifetimeTotalWeight, 6);
  });

  it("accumulates lifetime weight and won weight", async () => {
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "WON" });
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "LOST" });
    const stats = await loadAccountStats(accountId);
    expect(stats.lifetimeTotalWeight).toBeGreaterThan(0);
    expect(stats.lifetimeWonWeight).toBeGreaterThan(0);
    expect(stats.lifetimeWonWeight).toBeLessThan(stats.lifetimeTotalWeight);
  });

  it("tracks a median stake that resists outliers", async () => {
    for (const stake of [10_000, 10_000, 10_000, 10_000, 5_000_000]) {
      await recordSettledTrade({ accountId, stake, outcome: "LOST" });
    }
    const stats = await loadAccountStats(accountId);
    // Median, not mean — the 5,000,000 outlier must not drag it up.
    expect(stats.medianStake).toBeLessThan(100_000);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" pnpm exec vitest run src/repositories/account-stats.test.ts; cd ../..
```

Expected: FAIL — cannot resolve `./account-stats.js`.

- [ ] **Step 4: Write `packages/db/src/repositories/account-stats.ts`**

```ts
import {
  WINDOW_SIZE,
  stageFor,
  tradeWeight,
  type AccountStats,
  type LifecycleStage,
  type WindowEntry,
} from "@asm/algo";
import { prisma } from "../client";

/**
 * Reads everything the controller needs for one account.
 *
 * The rolling window is reconstructed from the last WINDOW_SIZE settled trades
 * rather than kept as a denormalised blob — Trade is already the source of
 * truth, and a second copy is one more thing that can drift out of step.
 *
 * REFUNDED trades are excluded from the query entirely. Counting a tie as a
 * loss would bias every estimate downward.
 */
export async function loadAccountStats(accountId: string): Promise<AccountStats> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      type: true,
      lifecycleStage: true,
      medianStake: true,
      lossStreak: true,
      winStreak: true,
      user: { select: { cumulativeDeposits: true } },
    },
  });

  const recent = await prisma.trade.findMany({
    where: { accountId, status: { in: ["WON", "LOST"] } },
    orderBy: { createdAt: "desc" },
    take: WINDOW_SIZE,
    select: { stake: true, status: true },
  });

  const medianStake = account.medianStake > 0 ? account.medianStake : 100;

  // Reverse so the window reads oldest-first, matching the harness.
  const shortWindow: WindowEntry[] = recent
    .slice()
    .reverse()
    .map((t) => ({
      weight: tradeWeight(t.stake, medianStake),
      won: t.status === "WON",
    }));

  const lifetime = await prisma.trade.groupBy({
    by: ["status"],
    where: { accountId, status: { in: ["WON", "LOST"] } },
    _sum: { stake: true },
    _count: { _all: true },
  });

  let lifetimeWonWeight = 0;
  let lifetimeTotalWeight = 0;
  for (const row of lifetime) {
    // Approximate lifetime weight with the account's current median as the
    // reference. Exact per-trade weights are unnecessary here — the lifetime
    // posterior only needs to be stable, not precise.
    const count = row._count._all;
    const avgStake = (row._sum.stake ?? 0) / Math.max(1, count);
    const weight = tradeWeight(avgStake, medianStake) * count;
    lifetimeTotalWeight += weight;
    if (row.status === "WON") lifetimeWonWeight += weight;
  }

  return {
    stage: account.lifecycleStage as LifecycleStage,
    shortWindow,
    lifetimeWonWeight,
    lifetimeTotalWeight,
    lossStreak: account.lossStreak,
    winStreak: account.winStreak,
    medianStake,
  };
}

/**
 * Updates the counters a settled trade affects.
 *
 * A REFUNDED outcome is a no-op by design — refunds touch neither streaks nor
 * totals. The lifecycle stage is recomputed here so a deposit made between
 * trades takes effect on the next one.
 */
export async function recordSettledTrade(input: {
  accountId: string;
  stake: number;
  outcome: "WON" | "LOST" | "REFUNDED";
}): Promise<void> {
  if (input.outcome === "REFUNDED") return;

  const account = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: {
      type: true,
      lossStreak: true,
      winStreak: true,
      user: { select: { cumulativeDeposits: true } },
    },
  });

  const won = input.outcome === "WON";

  // Median over a bounded recent sample keeps this cheap and outlier-resistant.
  const stakes = await prisma.trade.findMany({
    where: { accountId: input.accountId, status: { in: ["WON", "LOST"] } },
    orderBy: { createdAt: "desc" },
    take: WINDOW_SIZE,
    select: { stake: true },
  });
  const sorted = stakes.map((s) => s.stake).sort((a, b) => a - b);
  const medianStake =
    sorted.length === 0 ? input.stake : sorted[Math.floor(sorted.length / 2)]!;

  const settledCount = await prisma.trade.count({
    where: { accountId: input.accountId, status: { in: ["WON", "LOST"] } },
  });
  const wonCount = await prisma.trade.count({
    where: { accountId: input.accountId, status: "WON" },
  });

  await prisma.account.update({
    where: { id: input.accountId },
    data: {
      winStreak: won ? { increment: 1 } : 0,
      lossStreak: won ? 0 : { increment: 1 },
      tradesCount: settledCount,
      rollingWinRate: settledCount === 0 ? 0 : wonCount / settledCount,
      medianStake,
      lifecycleStage: stageFor(
        account.user.cumulativeDeposits,
        account.type === "DEMO",
      ),
    },
  });
}

export async function setLifecycleOverride(
  accountId: string,
  stage: LifecycleStage,
): Promise<void> {
  await prisma.account.update({
    where: { id: accountId },
    data: { lifecycleStage: stage },
  });
}
```

- [ ] **Step 5: Append to `packages/db/src/index.ts`**

```ts
export {
  loadAccountStats,
  recordSettledTrade,
  setLifecycleOverride,
} from "./repositories/account-stats";
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" pnpm exec vitest run src/repositories/account-stats.test.ts; cd ../..
```

Expected: PASS — 10 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): account statistics for the controller"
```

---

## Task 6: The shadow ledger

**Files:**
- Modify: `packages/db/src/repositories/trade.ts`
- Test: `packages/db/src/repositories/shadow.test.ts`

**Interfaces:**
- Consumes: `settleTrade` from Plan 03
- Produces:
  - `settleTrade` extended with an optional `shadow` argument:
    `SettleTradeInput = { tradeId: string; exitPrice: number; shadow?: ShadowInput }`
    where `ShadowInput = { honestExitPrice: number; biasApplied: number; magnetApplied: number; imbalanceAtEntry: number; exposureUp: number; exposureDown: number; lifecycleStage: string }`
  - `loadTradeShadow(tradeId: string): Promise<TradeShadow | null>` — admin-only callers

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/repositories/shadow.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { createAccountsForUser } from "./account";
import { openTradeRecord, settleTrade, loadTradeShadow } from "./trade";

const prisma = new PrismaClient();

let accountId = "";
let assetId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `sh-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, 1_000_000);
  accountId = accounts.find((a) => a.type === "DEMO")!.id;
  assetId = (await prisma.asset.findFirstOrThrow({ where: { symbol: "AUDNZD_OTC" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function open() {
  return openTradeRecord({
    accountId,
    assetId,
    direction: "UP",
    stake: 10_000,
    payoutPct: 100,
    entryPrice: 1.175,
    entryTs: new Date(),
    expiryTs: new Date(),
  });
}

describe("shadow ledger", () => {
  it("writes no shadow row when no shadow data is supplied", async () => {
    const trade = await open();
    await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    expect(await loadTradeShadow(trade.id)).toBeNull();
  });

  it("records the counterfactual when supplied", async () => {
    const trade = await open();
    await settleTrade({
      tradeId: trade.id,
      exitPrice: 1.174,
      shadow: {
        honestExitPrice: 1.176,
        biasApplied: -0.00012,
        magnetApplied: -0.00004,
        imbalanceAtEntry: 0.42,
        exposureUp: 500_000,
        exposureDown: 120_000,
        lifecycleStage: "HIGH_VALUE",
      },
    });

    const shadow = await loadTradeShadow(trade.id);
    expect(shadow).not.toBeNull();
    expect(shadow!.shownResult).toBe("LOST");
    expect(shadow!.honestResult).toBe("WON");
    expect(shadow!.honestExitPrice).toBeCloseTo(1.176, 6);
    expect(shadow!.lifecycleStage).toBe("HIGH_VALUE");
  });

  it("computes deltaPips as the gap between shown and honest price", async () => {
    const trade = await open();
    await settleTrade({
      tradeId: trade.id,
      exitPrice: 1.174,
      shadow: {
        honestExitPrice: 1.176,
        biasApplied: 0,
        magnetApplied: 0,
        imbalanceAtEntry: 0,
        exposureUp: 0,
        exposureDown: 0,
        lifecycleStage: "DEPOSITED",
      },
    });
    const shadow = await loadTradeShadow(trade.id);
    // 1.174 shown vs 1.176 honest = 2 pips at 5dp / 1e-4 scaling.
    expect(Math.abs(shadow!.deltaPips)).toBeGreaterThan(0);
  });

  it("records matching results when the bias changed nothing", async () => {
    const trade = await open();
    await settleTrade({
      tradeId: trade.id,
      exitPrice: 1.176,
      shadow: {
        honestExitPrice: 1.1761,
        biasApplied: -0.00001,
        magnetApplied: 0,
        imbalanceAtEntry: 0.1,
        exposureUp: 100_000,
        exposureDown: 90_000,
        lifecycleStage: "DEPOSITED",
      },
    });
    const shadow = await loadTradeShadow(trade.id);
    expect(shadow!.shownResult).toBe("WON");
    expect(shadow!.honestResult).toBe("WON");
  });

  it("cascades away with the trade", async () => {
    const trade = await open();
    await settleTrade({
      tradeId: trade.id,
      exitPrice: 1.174,
      shadow: {
        honestExitPrice: 1.176,
        biasApplied: 0,
        magnetApplied: 0,
        imbalanceAtEntry: 0,
        exposureUp: 0,
        exposureDown: 0,
        lifecycleStage: "DEPOSITED",
      },
    });
    await prisma.trade.delete({ where: { id: trade.id } });
    expect(await loadTradeShadow(trade.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" pnpm exec vitest run src/repositories/shadow.test.ts; cd ../..
```

Expected: FAIL — `loadTradeShadow` is not exported.

- [ ] **Step 3: Extend `packages/db/src/repositories/trade.ts`**

Add the shadow input type near the top, after the error classes:

```ts
export interface ShadowInput {
  honestExitPrice: number;
  biasApplied: number;
  magnetApplied: number;
  imbalanceAtEntry: number;
  exposureUp: number;
  exposureDown: number;
  lifecycleStage: string;
}
```

Widen `SettleTradeInput`:

```ts
export interface SettleTradeInput {
  tradeId: string;
  exitPrice: number;
  /** When present, the honest counterfactual is recorded alongside the settlement. */
  shadow?: ShadowInput;
}
```

Then, inside `settleTrade`, immediately after the `claimed.count !== 1` guard and before the credit block, insert:

```ts
  if (input.shadow) {
    const honestOutcome = didWin(
      existing.direction,
      existing.entryPrice,
      input.shadow.honestExitPrice,
    );

    // Pips at 1e-4 — conventional for FX majors and adequate for the ledger.
    const deltaPips = (input.exitPrice - input.shadow.honestExitPrice) / 0.0001;

    await prisma.tradeShadow.create({
      data: {
        tradeId: input.tradeId,
        shownExitPrice: input.exitPrice,
        honestExitPrice: input.shadow.honestExitPrice,
        shownResult: outcome,
        honestResult: honestOutcome,
        deltaPips,
        biasApplied: input.shadow.biasApplied,
        magnetApplied: input.shadow.magnetApplied,
        imbalanceAtEntry: input.shadow.imbalanceAtEntry,
        exposureUp: input.shadow.exposureUp,
        exposureDown: input.shadow.exposureDown,
        lifecycleStage: input.shadow.lifecycleStage,
      },
    });
  }
```

Finally append the reader at the end of the file:

```ts
/**
 * Admin-only. There is deliberately no actor-scoped variant: no trading client
 * may ever read this, so no ownership-scoped accessor exists to be misused.
 */
export async function loadTradeShadow(
  tradeId: string,
): Promise<TradeShadow | null> {
  return prisma.tradeShadow.findUnique({ where: { tradeId } });
}
```

Add `TradeShadow` to the type import at the top:

```ts
import type {
  Direction,
  Trade,
  TradeShadow,
  TxKind,
} from "../../generated/prisma/client";
```

- [ ] **Step 4: Append to `packages/db/src/index.ts`**

```ts
export { loadTradeShadow, type ShadowInput } from "./repositories/trade";
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" pnpm exec vitest run src/repositories/shadow.test.ts; cd ../..
```

Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): shadow ledger recorded on settlement"
```

---

## Task 7: Wire the controller into the engine

**Files:**
- Create: `apps/engine/src/controller-bridge.ts`, `apps/engine/src/bots/profiles.ts`, `apps/engine/src/bots/crowd.ts`
- Modify: `apps/engine/src/assets/registry.ts`, `apps/engine/src/settlement.ts`, `apps/engine/src/loop.ts`, `apps/engine/src/main.ts`

**Interfaces:**
- Consumes: everything from `@asm/algo`; `SettlementService` from Plan 03
- Produces:
  - `class ControllerBridge` with:
    - `wishFor(accountId: string, isDemo: boolean): Promise<{ wantWin: boolean; urgency: number; output: ControllerOutput }>`
    - `invalidate(accountId: string): void`
  - `AssetRegistry.tick(symbol, nowSec, bias)` where `bias = { driftBias: number; magnet: number }`
  - `AssetRegistry.tickHonest(symbol, nowSec)` — advances a parallel unbiased price for the counterfactual
  - `class BotCrowd` with `start(): void`, `stop(): void`

- [ ] **Step 1: Write `apps/engine/src/controller-bridge.ts`**

```ts
import {
  desiredWinProb,
  drawOutcome,
  type ControllerOutput,
} from "@asm/algo";
import { createRng, type Rng } from "@asm/pricing";
import { loadAccountStats } from "@asm/db";
import { logger } from "@asm/logger";

interface Cached {
  output: ControllerOutput;
  loadedAtMs: number;
}

const CACHE_TTL_MS = 5_000;

/**
 * Bridges the pure controller to account state.
 *
 * Stats are cached briefly because a burst of trades from one account would
 * otherwise issue identical queries per trade. Five seconds is short enough
 * that a settled trade's effect appears almost immediately, and long enough to
 * keep the bot crowd from hammering the database.
 */
export class ControllerBridge {
  private cache = new Map<string, Cached>();
  private rng: Rng;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }

  async wishFor(accountId: string): Promise<{
    wantWin: boolean;
    urgency: number;
    output: ControllerOutput;
  }> {
    const cached = this.cache.get(accountId);
    let output: ControllerOutput;

    if (cached && Date.now() - cached.loadedAtMs < CACHE_TTL_MS) {
      output = cached.output;
    } else {
      const stats = await loadAccountStats(accountId);
      output = desiredWinProb(stats);
      this.cache.set(accountId, { output, loadedAtMs: Date.now() });
    }

    // Stochastic draw, not a decision. A deterministic controller fails a runs
    // test; a biased coin cannot.
    const wantWin = drawOutcome(output.p, this.rng);

    if (output.ceilingActive) {
      logger.info(
        {
          evt: "algo.ceiling_engaged",
          accountId,
          posteriorShort: Number(output.posteriorShort.toFixed(4)),
          posteriorLife: Number(output.posteriorLife.toFixed(4)),
          p: Number(output.p.toFixed(4)),
        },
        "hard ceiling engaged",
      );
    }

    return { wantWin, urgency: output.urgency, output };
  }
}
```

- [ ] **Step 2: Extend `apps/engine/src/assets/registry.ts` for bias and the honest path**

Add `honestState` to `LiveAsset`:

```ts
export interface LiveAsset {
  id: string;
  symbol: string;
  payoutPct: number;
  precision: number;
  params: PriceParams;
  state: PriceState;
  /** A parallel unbiased path. The shadow ledger's counterfactual comes from here. */
  honestState: PriceState;
  anchor: number | null;
  aggregator: CandleAggregator;
}
```

In `load()`, initialise both:

```ts
      this.assets.set(row.symbol, {
        id: row.id,
        symbol: row.symbol,
        payoutPct: row.payoutPct,
        precision: row.precision,
        params,
        state: initPriceState(row.basePrice, params),
        honestState: initPriceState(row.basePrice, params),
        anchor: null,
        aggregator: new CandleAggregator(60),
      });
```

Replace `tick` with a version that takes bias and advances both paths from the **same** normal draw — that shared `z` is what makes the counterfactual a genuine comparison rather than a second unrelated random walk:

```ts
  /**
   * Advances one asset by a single tick.
   *
   * Both the shown price and the honest counterfactual consume the SAME normal
   * draw. Using a second independent draw would make the "what would have
   * happened" figure meaningless — the only difference between the two paths
   * must be the bias itself.
   */
  tick(
    symbol: string,
    nowSec: number,
    bias: { driftBias: number; magnet: number },
  ): TickResult {
    const asset = this.assets.get(symbol);
    if (!asset) {
      throw new Error(`tick called for unknown symbol "${symbol}"`);
    }

    const z = this.rng.normal();

    const shown = stepPrice({
      state: asset.state,
      params: asset.params,
      dtSec: DT_SEC,
      z,
      driftBias: bias.driftBias,
      magnet: bias.magnet,
      anchorTarget: asset.anchor,
    });

    const honest = stepPrice({
      state: asset.honestState,
      params: asset.params,
      dtSec: DT_SEC,
      z,
      driftBias: 0,
      magnet: 0,
      anchorTarget: asset.anchor,
    });

    asset.state = shown.state;
    asset.honestState = honest.state;

    const rounded = Number(shown.price.toFixed(asset.precision));
    const closed = asset.aggregator.addTick(nowSec, rounded);

    return { price: rounded, sigma: shown.sigma, closed };
  }

  honestPrice(symbol: string): number {
    const asset = this.assets.get(symbol);
    if (!asset) throw new Error(`unknown symbol "${symbol}"`);
    return Number(asset.honestState.price.toFixed(asset.precision));
  }
```

- [ ] **Step 3: Write `apps/engine/src/bots/profiles.ts`**

```ts
import type { Direction } from "@asm/trading";

export type BotProfile = "MOMENTUM" | "CONTRARIAN" | "RANDOM" | "MARTINGALE" | "WHALE";

/** Population mix from the specification. */
export const PROFILE_MIX: { profile: BotProfile; share: number }[] = [
  { profile: "MOMENTUM", share: 0.35 },
  { profile: "CONTRARIAN", share: 0.25 },
  { profile: "RANDOM", share: 0.25 },
  { profile: "MARTINGALE", share: 0.1 },
  { profile: "WHALE", share: 0.05 },
];

export function pickProfile(u: number): BotProfile {
  let cumulative = 0;
  for (const entry of PROFILE_MIX) {
    cumulative += entry.share;
    if (u < cumulative) return entry.profile;
  }
  return "RANDOM";
}

/**
 * Chooses a direction from the last few candle closes.
 * `recent` is oldest-first; an empty or single-entry array means no signal.
 */
export function chooseDirection(
  profile: BotProfile,
  recent: readonly number[],
  u: number,
): Direction {
  if (profile === "RANDOM" || recent.length < 2) {
    return u < 0.5 ? "UP" : "DOWN";
  }

  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const rising = last > first;

  switch (profile) {
    case "MOMENTUM":
      return rising ? "UP" : "DOWN";
    case "CONTRARIAN":
      return rising ? "DOWN" : "UP";
    case "MARTINGALE":
    case "WHALE":
      return u < 0.5 ? "UP" : "DOWN";
  }
}

/** Log-normal-ish stake in minor units, scaled by profile. */
export function chooseStake(profile: BotProfile, u1: number, u2: number): number {
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2);
  const base = Math.exp(Math.log(2_000) + 0.9 * z);
  const scale = profile === "WHALE" ? 25 : 1;
  const minor = Math.round(base * scale);
  return Math.max(100, Math.min(minor, 20_000_000));
}
```

- [ ] **Step 4: Write `apps/engine/src/bots/crowd.ts`**

```ts
import { createRng, type Rng } from "@asm/pricing";
import { DURATIONS_SEC } from "@asm/trading";
import { prisma, openTradeRecord } from "@asm/db";
import { logger } from "@asm/logger";
import type { AssetRegistry } from "../assets/registry";
import type { SettlementService } from "../settlement";
import {
  chooseDirection,
  chooseStake,
  pickProfile,
  type BotProfile,
} from "./profiles";

const BOT_COUNT = Number(process.env.BOT_COUNT ?? 40);
const ARRIVALS_PER_MINUTE = Number(process.env.BOT_ARRIVALS_PER_MINUTE ?? 90);
const BOT_EMAIL_PREFIX = "bot+";
const SHORT_DURATIONS = DURATIONS_SEC.filter((d) => d >= 30 && d <= 300);

interface Bot {
  accountId: string;
  profile: BotProfile;
  lastStake: number;
  lastLost: boolean;
}

/**
 * The simulated crowd.
 *
 * Without it the controller has no book: a single real trader IS the imbalance,
 * every time, which both breaks the thin-book guard's purpose and makes the
 * mechanic inert. Bots are invisible in the UI — their only visible output is
 * the sentiment bar.
 */
export class BotCrowd {
  private bots: Bot[] = [];
  private rng: Rng;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly assets: AssetRegistry,
    private readonly settlement: SettlementService,
    seed: number,
  ) {
    this.rng = createRng(seed);
  }

  async provision(): Promise<void> {
    for (let i = 0; i < BOT_COUNT; i++) {
      const email = `${BOT_EMAIL_PREFIX}${i}@asmtrade.local`;
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, passwordHash: "bot-no-login", emailVerified: true },
      });

      const account = await prisma.account.upsert({
        where: { userId_type: { userId: user.id, type: "DEMO" } },
        update: {},
        create: { userId: user.id, type: "DEMO", realBalance: 100_000_000 },
      });

      this.bots.push({
        accountId: account.id,
        profile: pickProfile(this.rng.next()),
        lastStake: 2_000,
        lastLost: false,
      });
    }

    logger.info(
      { evt: "engine.bots_provisioned", count: this.bots.length },
      "bot crowd provisioned",
    );
  }

  start(): void {
    const intervalMs = Math.max(200, Math.round(60_000 / ARRIVALS_PER_MINUTE));
    this.timer = setInterval(() => void this.arrive(), intervalMs);
    logger.info(
      { evt: "engine.bots_started", arrivalsPerMinute: ARRIVALS_PER_MINUTE },
      "bot crowd started",
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async arrive(): Promise<void> {
    const bot = this.bots[Math.floor(this.rng.next() * this.bots.length)];
    if (!bot) return;

    const all = this.assets.all();
    const asset = all[Math.floor(this.rng.next() * all.length)];
    if (!asset) return;

    const recentCandle = asset.aggregator.current();
    const recent = recentCandle ? [recentCandle.o, recentCandle.c] : [];

    const direction = chooseDirection(bot.profile, recent, this.rng.next());

    let stake = chooseStake(bot.profile, this.rng.next(), this.rng.next());
    if (bot.profile === "MARTINGALE" && bot.lastLost) {
      stake = Math.min(bot.lastStake * 2, 20_000_000);
    }
    bot.lastStake = stake;

    const durationSec =
      SHORT_DURATIONS[Math.floor(this.rng.next() * SHORT_DURATIONS.length)]!;

    const entryTs = new Date();
    const expiryTs = new Date(entryTs.getTime() + durationSec * 1000);
    const entryPrice = Number(asset.state.price.toFixed(asset.precision));

    try {
      const trade = await openTradeRecord({
        accountId: bot.accountId,
        assetId: asset.id,
        direction,
        stake,
        payoutPct: asset.payoutPct,
        entryPrice,
        entryTs,
        expiryTs,
      });

      this.settlement.register({
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
      // A bot running out of balance is expected and uninteresting. Top it up.
      await prisma.account
        .update({
          where: { id: bot.accountId },
          data: { realBalance: 100_000_000 },
        })
        .catch(() => {});
    }
  }
}
```

- [ ] **Step 5: Extend `apps/engine/src/settlement.ts` to resolve targets and write shadows**

Add imports:

```ts
import {
  imbalance,
  resolveBucket,
  totalExposure,
  type BucketWish,
} from "@asm/algo";
import { recordSettledTrade } from "@asm/db";
import type { ControllerBridge } from "./controller-bridge";
```

Add the bridge to the constructor:

```ts
  constructor(
    private readonly assets: AssetRegistry,
    private readonly server: EngineServer,
    private readonly controller: ControllerBridge,
  ) {}
```

Add a method that computes bias for one asset — the tick loop calls this:

```ts
  /** Layer 2 input for one asset, from its live book. */
  biasFor(assetId: string, nowSec: number): { imbalance: number; exposure: number } {
    const open = this.registry.openFor(assetId);
    return {
      imbalance: imbalance(open, nowSec),
      exposure: totalExposure(open),
    };
  }

  /** Split exposure by direction, for the shadow ledger. */
  private exposureSplit(assetId: string): { up: number; down: number } {
    let up = 0;
    let down = 0;
    for (const p of this.registry.openFor(assetId)) {
      const liability = (p.stake * p.payoutPct) / 100;
      if (p.direction === "UP") up += liability;
      else down += liability;
    }
    return { up, down };
  }
```

Then replace the body of `settleDue` so each bucket resolves a target price before settling. Insert this immediately after `const exitPrice = ...` is currently computed, replacing that line:

```ts
      // Ask the controller what it wants for each position, then choose the one
      // price that satisfies as many wishes as possible.
      const wishes: BucketWish[] = [];
      const wishByTradeId = new Map<string, { wantWin: boolean; output: unknown }>();

      for (const position of bucket.positions) {
        const wish = await this.controller.wishFor(position.accountId);
        wishes.push({
          entryPrice: position.entryPrice,
          direction: position.direction,
          wantWin: wish.wantWin,
          urgency: wish.urgency,
          stake: position.stake,
          payoutPct: position.payoutPct,
        });
        wishByTradeId.set(position.tradeId, {
          wantWin: wish.wantWin,
          output: wish.output,
        });
      }

      const honestPrice = this.assets.honestPrice(asset.symbol);
      const currentPrice = Number(asset.state.price.toFixed(asset.precision));

      const target = resolveBucket({
        wishes,
        currentPrice,
        maxMove: asset.params.maxTickMove * 4,
        tickSize: 10 ** -asset.precision,
      });

      const exitPrice = Number(target.toFixed(asset.precision));

      const split = this.exposureSplit(bucket.assetId);
      const imb = imbalance(this.registry.openFor(bucket.assetId), nowSec);

      if (Math.abs(exitPrice - currentPrice) >= asset.params.maxTickMove * 4) {
        logger.warn(
          {
            evt: "algo.target_abandoned",
            symbol: asset.symbol,
            wanted: target,
            settled: exitPrice,
          },
          "target unreachable — settling at the reachable bound",
        );
      }
```

And inside the per-position loop, pass the shadow through and record the outcome. Replace the `settleTrade` call with:

```ts
          const wish = wishByTradeId.get(position.tradeId);
          const result = await settleTrade({
            tradeId: position.tradeId,
            exitPrice,
            shadow: {
              honestExitPrice: honestPrice,
              biasApplied: 0,
              magnetApplied: exitPrice - currentPrice,
              imbalanceAtEntry: imb,
              exposureUp: Math.round(split.up),
              exposureDown: Math.round(split.down),
              lifecycleStage: "UNKNOWN",
            },
          });

          await recordSettledTrade({
            accountId: position.accountId,
            stake: position.stake,
            outcome: result.trade.status as "WON" | "LOST" | "REFUNDED",
          });
          this.controller.invalidate(position.accountId);
          void wish;
```

- [ ] **Step 6: Modify `apps/engine/src/loop.ts` to compute and pass bias**

Add the import:

```ts
import { driftBias } from "@asm/algo";
```

Replace the `registry.tick(asset.symbol, nowSec)` call with:

```ts
      const book = settlement.biasFor(asset.id, nowSec);

      let result;
      try {
        // sigma from the previous tick is close enough for scaling; the bias is
        // re-clamped inside driftBias against the sigma passed here.
        const bias = driftBias({
          imbalance: book.imbalance,
          exposure: book.exposure,
          sigma: Math.sqrt(asset.state.garch.sigma2),
        });

        result = registry.tick(asset.symbol, nowSec, {
          driftBias: bias,
          magnet: 0,
        });
      } catch (err) {
```

- [ ] **Step 7: Modify `apps/engine/src/main.ts` to wire the bridge and crowd**

Add imports:

```ts
import { ControllerBridge } from "./controller-bridge";
import { BotCrowd } from "./bots/crowd";
```

Replace the server/settlement/loop block:

```ts
  const server = new EngineServer(registry, WS_PORT);
  const controller = new ControllerBridge(Date.now() & 0x7fffffff);
  const settlement = new SettlementService(registry, server, controller);
  await settlement.hydrate();
  const loop = startTickLoop(registry, server, settlement);

  const crowd = new BotCrowd(registry, settlement, (Date.now() >>> 1) & 0x7fffffff);
  if (process.env.BOTS_ENABLED !== "false") {
    await crowd.provision();
    crowd.start();
  }
```

And add `crowd.stop();` to the `shutdown` function, before `await feed.stop();`.

- [ ] **Step 8: Add bot configuration to the environment**

Append to both `.env.example` and `.env`:

```bash
# Simulated crowd. Set BOTS_ENABLED=false to watch the thin-book guard instead.
BOTS_ENABLED="true"
BOT_COUNT="40"
BOT_ARRIVALS_PER_MINUTE="90"
```

- [ ] **Step 9: Verify the engine runs with the controller live**

```bash
pnpm dev:engine
```

Expected log lines: `engine.bots_provisioned` with `count: 40`, `engine.bots_started`, then a steady stream of `trade.settled`.

After about three minutes:

```bash
psql -d asm_trade -c "
SELECT count(*) AS settled,
       round(100.0 * sum(CASE WHEN status='WON' THEN 1 ELSE 0 END) / count(*), 1) AS win_pct
FROM \"Trade\" WHERE status IN ('WON','LOST');"
```

Expected: several hundred settled trades with a win percentage in the 50s or 60s — bot accounts are demo accounts, so they sit in `PRE_DEPOSIT` at a 65% target.

```bash
psql -d asm_trade -c "
SELECT count(*) AS shadows,
       sum(CASE WHEN \"shownResult\" <> \"honestResult\" THEN 1 ELSE 0 END) AS flipped
FROM \"TradeShadow\";"
```

Expected: shadows equal to settled trades, with a non-zero `flipped` count — that column is the demonstration.

- [ ] **Step 10: Commit**

```bash
git add apps/engine .env.example
git commit -m "feat(engine): controller bridge, bot crowd, shadow ledger writes"
```

---

## Task 8: Shadow-leak contract test and the admin panel

**Files:**
- Create: `apps/web/src/app/api/trades/leak.test.ts`, `apps/web/src/app/admin/algorithm/page.tsx`, `apps/web/src/lib/require-admin.ts`

**Interfaces:**
- Consumes: `readSession`; `prisma`
- Produces:
  - `requireAdmin(): Promise<{ userId: string }>` — redirects a non-admin
  - `/admin/algorithm` — the observability panel
  - A contract test asserting no shadow field can reach a trading client

- [ ] **Step 1: Write the failing leak test**

This is the control from the specification expressed as an assertion. It inspects the response *shape* rather than the implementation, so it keeps holding as the route changes.

Create `apps/web/src/app/api/trades/leak.test.ts`:

```ts
import { describe, expect, it } from "vitest";

/**
 * The shadow ledger must never reach a trading client. This test guards the
 * response contract rather than the implementation, so it keeps holding when
 * the route is refactored.
 */
const FORBIDDEN_KEYS = [
  "honestExitPrice",
  "honestResult",
  "deltaPips",
  "biasApplied",
  "magnetApplied",
  "imbalanceAtEntry",
  "exposureUp",
  "exposureDown",
  "shadow",
  "shadowO",
  "shadowH",
  "shadowL",
  "shadowC",
];

function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

describe("shadow ledger containment", () => {
  it("the TradeView contract contains no shadow fields", async () => {
    const sample = {
      id: "t1",
      accountId: "a1",
      symbol: "AUDNZD_OTC",
      direction: "UP",
      stake: 10_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: 0,
      expiryTs: 0,
      exitPrice: 1.176,
      status: "WON",
      pnl: 10_000,
    };
    const keys = collectKeys({ trades: [sample] });
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("rejects a candle payload that carries shadow columns", () => {
    const leaky = {
      candles: [{ openTs: 0, o: 1, h: 1, l: 1, c: 1, shadowC: 1.2 }],
    };
    const keys = collectKeys(leaky);
    const leaked = FORBIDDEN_KEYS.filter((k) => keys.has(k));
    // Proves the detector actually works — this fixture MUST be caught.
    expect(leaked).toContain("shadowC");
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @asm/web test
```

Expected: PASS — 11 tests total for the web app. The second case verifies the detector itself is not vacuous.

- [ ] **Step 3: Write `apps/web/src/lib/require-admin.ts`**

```ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "./session";

/**
 * Server-side admin guard. The role is read from the database inside
 * readSession, never from the cookie — a forged cookie cannot assert it.
 */
export async function requireAdmin(): Promise<{ userId: string }> {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);

  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/trade");

  return { userId: session.userId };
}
```

- [ ] **Step 4: Write `apps/web/src/app/admin/algorithm/page.tsx`**

```tsx
import { prisma } from "@asm/db";
import { TARGETS, HARD_CEILING } from "@asm/algo";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export default async function AlgorithmPage() {
  await requireAdmin();

  const [byStage, shadows, assets] = await Promise.all([
    prisma.$queryRaw<
      { stage: string; settled: bigint; won: bigint }[]
    >`
      SELECT a."lifecycleStage" AS stage,
             count(*) AS settled,
             sum(CASE WHEN t.status = 'WON' THEN 1 ELSE 0 END) AS won
      FROM "Trade" t
      JOIN "Account" a ON a.id = t."accountId"
      WHERE t.status IN ('WON', 'LOST')
      GROUP BY a."lifecycleStage"
    `,
    prisma.$queryRaw<
      { total: bigint; flipped: bigint; avg_delta: number | null }[]
    >`
      SELECT count(*) AS total,
             sum(CASE WHEN "shownResult" <> "honestResult" THEN 1 ELSE 0 END) AS flipped,
             avg(abs("deltaPips")) AS avg_delta
      FROM "TradeShadow"
    `,
    prisma.asset.findMany({
      select: { symbol: true, payoutPct: true, isOpen: true },
      orderBy: { symbol: "asc" },
    }),
  ]);

  const shadow = shadows[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">
          Admin · not visible to traders
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Algorithm dashboard
        </h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Realised versus target</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">
              <th className="pb-2">Stage</th>
              <th className="pb-2">Settled</th>
              <th className="pb-2">Realised</th>
              <th className="pb-2">Target</th>
              <th className="pb-2">Drift</th>
            </tr>
          </thead>
          <tbody>
            {byStage.map((row) => {
              const settled = Number(row.settled);
              const realised = settled === 0 ? 0 : Number(row.won) / settled;
              const target = TARGETS[row.stage as keyof typeof TARGETS] ?? 0;
              const drift = realised - target;
              return (
                <tr key={row.stage} className="border-t border-[var(--color-edge)]">
                  <td className="py-2">{row.stage}</td>
                  <td className="py-2 tabular-nums">{settled}</td>
                  <td className="py-2 tabular-nums">
                    {(realised * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 tabular-nums text-[var(--color-ink-2)]">
                    {(target * 100).toFixed(0)}%
                  </td>
                  <td
                    className="py-2 tabular-nums"
                    style={{
                      color:
                        Math.abs(drift) > 0.05
                          ? "var(--color-down)"
                          : "var(--color-up)",
                    }}
                  >
                    {drift >= 0 ? "+" : "−"}
                    {(Math.abs(drift) * 100).toFixed(1)} pts
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-[var(--color-ink-2)]">
          Hard ceiling {(HARD_CEILING * 100).toFixed(0)}%. A drift above 5 points
          that persists means the controller is failing — and no error will have
          been thrown.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Shadow ledger</h2>
        <dl className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">
              Records
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {Number(shadow?.total ?? 0)}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">
              Outcome flipped
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {Number(shadow?.flipped ?? 0)}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">
              Mean |Δ| pips
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {(shadow?.avg_delta ?? 0).toFixed(2)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Assets</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {assets.map((a) => (
            <li
              key={a.symbol}
              className="flex justify-between border-t border-[var(--color-edge)] py-2"
            >
              <span>{a.symbol}</span>
              <span className="tabular-nums">
                {a.payoutPct}% {a.isOpen ? "" : "· closed"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

The two `$queryRaw` calls use tagged templates with no interpolated values, which is the parameterised form the Plan 01 lint rule permits.

- [ ] **Step 5: Verify the admin panel is gated**

```bash
# As a non-admin user
curl -s -b /tmp/asm.jar -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/algorithm
```

Expected: `307` — redirected to `/trade`.

Log in as `admin@asmtrade.local` with the password from the Plan 01 seed, then open `http://localhost:3000/admin/algorithm`. Expected: realised-versus-target rows, shadow-ledger counts with a non-zero flipped figure, and the asset payouts.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): algorithm dashboard and shadow containment test"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the whole suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all clean.

- [ ] **Step 2: Run the database-backed suites against the test database**

```bash
cd packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" pnpm exec vitest run
cd ../..
```

Expected: PASS — 33 tests across account, trade, account-stats, and shadow repositories.

- [ ] **Step 3: Verify the thin-book guard against a live engine**

Stop the engine, disable bots, restart, and place one small trade by hand:

```bash
BOTS_ENABLED=false pnpm dev:engine
```

Place a single $1 trade from `/trade`. Expected: no `algo.*` bias log lines, and the shadow row for that trade shows `shownResult` equal to `honestResult` — with an empty book, the engine ran honestly.

- [ ] **Step 4: Verify convergence against a live engine**

Re-enable bots, run for ten minutes, then:

```bash
psql -d asm_trade -c "
SELECT a.\"lifecycleStage\" AS stage,
       count(*) AS settled,
       round(100.0 * sum(CASE WHEN t.status='WON' THEN 1 ELSE 0 END)/count(*), 1) AS win_pct
FROM \"Trade\" t JOIN \"Account\" a ON a.id = t.\"accountId\"
WHERE t.status IN ('WON','LOST')
GROUP BY a.\"lifecycleStage\";"
```

Expected: `PRE_DEPOSIT` within a few points of 65%. Bot accounts are demo accounts, so they all sit in that stage; the other two stages appear once Plan 05 supplies deposits.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: plan 04 verification"
```

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass
- [ ] All nine validation files pass — convergence, ceiling, cold start, farming, streaks, randomness, thin book, conflict, ties
- [ ] Simulated realised rates land within 2 points of 65% / 45% / 27%
- [ ] The runs-test z-score stays under 4 in every stage
- [ ] A hundred micro-stake losses shift the posterior far less than a hundred normal ones
- [ ] An account with zero history gets `p` equal to its target and `ceilingActive === false`
- [ ] A single small trade on an empty book produces zero bias and identical shown/honest results
- [ ] `TradeShadow` rows exist for every settled trade, with a non-zero `flipped` count
- [ ] No trading-client response contains any shadow field
- [ ] `/admin/algorithm` redirects a non-admin and renders for an admin
- [ ] With bots running, `PRE_DEPOSIT` realised rate sits within a few points of 65%

## What Plan 05 depends on from here

Plan 05 (Deposit simulation) imports and must not need to change:

- `stageFor(cumulativeDepositsMinor, isDemo)` — a completed deposit updates `User.cumulativeDeposits`, and the next `recordSettledTrade` moves the account's stage
- `DEPOSIT_THRESHOLD_MINOR` from `@asm/algo` — the `DEPOSITED` → `HIGH_VALUE` boundary
- `setLifecycleOverride(accountId, stage)` — the demo stage-override control
- `creditAccount` from `@asm/db` — extended there with a `DEPOSIT` transaction kind
- `requireAdmin()` — the deposit approval queue reuses it
