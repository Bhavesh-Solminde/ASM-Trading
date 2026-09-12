# ASM Trade — Plan 02: Price Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live candlestick chart in the web app, driven by a server-authoritative price engine that seeds from real market data and produces statistically realistic synthetic candles — with no manipulation yet.

**Architecture:** Pure price mathematics lives in `packages/pricing` (GBM with GARCH volatility, a four-layer tick composer, a candle aggregator) so it unit-tests in milliseconds with no I/O. A separate long-lived process, `apps/engine`, wires that maths to a real price feed, to Postgres for candle persistence, and to a WebSocket server that fans ticks out to browsers. The web app renders with TradingView Lightweight Charts and never computes a price itself.

**Tech Stack:** TypeScript · `ws` 8.21.3 · lightweight-charts 5.2.1 · Twelve Data REST (free tier) · Postgres 16 · Redis 8 · Vitest 5

## Global Constraints

- **Everything from Plan 01 applies** — Node `>=22.0.0`, exact pinned versions, `z.strictObject()` at every boundary, money as integer minor units, `actorId` on every user-owned query, no Docker.
- **New exact versions:** `ws@8.21.3`, `@types/ws@8.18.1`, `lightweight-charts@5.2.1`, `nanoid@6.0.1`.
- **The server is the only source of prices.** The client renders what it is told. No price, timestamp, or outcome is ever accepted from a browser.
- **Layers 2 and 3 are stubbed to zero in this plan.** `driftBias` and `magnet` parameters exist in the tick composer signature and are always passed `0`. Plan 04 supplies real values. This keeps the engine honest and independently verifiable first.
- **Pure packages must stay pure.** `packages/pricing` imports nothing from `@asm/db`, `@asm/config`, or `node:fs`. Its only dependency is an injected RNG.
- **Twelve Data free tier is 8 requests/minute, 800/day.** Never poll all assets on every tick. Round-robin one asset at a time.
- **Seeded RNG is for reproducibility, never for security.** `packages/pricing` exports a seeded PRNG; the ESLint ban on `Math.random` from Plan 01 still stands everywhere else.

---

## File Structure

```
packages/pricing/
├── package.json
├── tsconfig.json
└── src/
    ├── rng.ts              seeded PRNG + Box-Muller normal
    ├── garch.ts            GARCH(1,1) volatility state machine
    ├── step.ts             four-layer tick composer
    ├── candles.ts          tick -> OHLC aggregation
    └── index.ts            barrel

packages/contracts/src/
└── ws.ts                   WebSocket message schemas (both directions)

apps/engine/
├── package.json
├── tsconfig.json
└── src/
    ├── main.ts             process entry: wire, start, graceful shutdown
    ├── feeds/
    │   ├── types.ts        PriceFeed + Quote interfaces
    │   ├── twelve-data.ts  round-robin REST poller
    │   └── replay.ts       offline fallback, replays a bundled dataset
    ├── assets/
    │   └── registry.ts     loads Asset rows, holds live per-asset state
    ├── loop.ts             10 Hz tick loop + candle persistence
    └── server.ts           ws server: auth, subscribe, fan-out

apps/web/src/
├── components/chart/
│   ├── PriceChart.tsx      lightweight-charts wrapper
│   └── useEngineSocket.ts  WS client hook with reconnect
└── app/(platform)/trade/page.tsx    modified — renders the chart
```

`packages/pricing` has no knowledge of assets, sockets, or the database — that separation is what lets Plan 04's controller be tested against it without standing anything up.

---

## Task 1: Seeded RNG and GARCH volatility

**Files:**
- Create: `packages/pricing/package.json`, `packages/pricing/tsconfig.json`, `packages/pricing/src/rng.ts`, `packages/pricing/src/garch.ts`
- Test: `packages/pricing/src/rng.test.ts`, `packages/pricing/src/garch.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `createRng(seed: number): Rng` where `Rng = { next(): number; normal(): number }`
  - `GarchParams = { omega: number; alpha: number; beta: number }`
  - `GarchState = { sigma2: number; lastEps: number }`
  - `initGarch(params: GarchParams): GarchState`
  - `stepGarch(state: GarchState, params: GarchParams, z: number): { state: GarchState; sigma: number }`

- [ ] **Step 1: Write `packages/pricing/package.json`**

```json
{
  "name": "@asm/pricing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" }
}
```

No dependencies. That is deliberate — this package is pure maths.

- [ ] **Step 2: Write `packages/pricing/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing RNG test**

Create `packages/pricing/src/rng.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRng } from "./rng.js";

describe("createRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it("returns values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces a standard normal with mean near 0 and sd near 1", () => {
    const rng = createRng(99);
    const n = 50_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const z = rng.normal();
      sum += z;
      sumSq += z * z;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(sd - 1)).toBeLessThan(0.02);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm --filter @asm/pricing test
```

Expected: FAIL — cannot resolve `./rng.js`.

- [ ] **Step 5: Write `packages/pricing/src/rng.ts`**

```ts
/**
 * Seeded PRNG for reproducible price paths. Used ONLY by the price engine so a
 * session can be replayed exactly. Never use this for tokens, session ids, or
 * anything security-bearing — that is node:crypto's job.
 *
 * mulberry32: small, fast, good distribution for simulation purposes.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal, mean 0, sd 1. */
  normal(): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Box-Muller. Cache the second variate rather than discarding it.
  let spare: number | null = null;

  const normal = (): number => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    // Reject exact zero — log(0) is -Infinity.
    while (u === 0) u = next();
    while (v === 0) v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };

  return { next, normal };
}
```

- [ ] **Step 6: Run the RNG test to verify it passes**

```bash
pnpm install
pnpm --filter @asm/pricing test
```

Expected: PASS — 4 tests.

- [ ] **Step 7: Write the failing GARCH test**

GARCH(1,1) is what produces volatility *clustering* — calm stretches punctuated by violent ones. It is the single most important property for making synthetic candles read as real, so it gets tested on that property, not just on arithmetic.

Create `packages/pricing/src/garch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initGarch, stepGarch, type GarchParams } from "./garch.js";
import { createRng } from "./rng.js";

const params: GarchParams = { omega: 0.000001, alpha: 0.08, beta: 0.9 };

describe("garch", () => {
  it("initialises sigma2 at the unconditional variance", () => {
    const state = initGarch(params);
    const expected = params.omega / (1 - params.alpha - params.beta);
    expect(state.sigma2).toBeCloseTo(expected, 12);
  });

  it("returns sigma as the square root of sigma2", () => {
    const state = initGarch(params);
    const { sigma } = stepGarch(state, params, 0);
    expect(sigma).toBeGreaterThan(0);
    expect(sigma).toBeCloseTo(Math.sqrt(state.sigma2), 12);
  });

  it("raises volatility after a large shock", () => {
    const calm = stepGarch(initGarch(params), params, 0.1);
    const shocked = stepGarch(initGarch(params), params, 5);
    expect(shocked.state.sigma2).toBeGreaterThan(calm.state.sigma2);
  });

  it("stays stationary — sigma2 does not diverge over many steps", () => {
    const rng = createRng(3);
    let state = initGarch(params);
    for (let i = 0; i < 100_000; i++) {
      state = stepGarch(state, params, rng.normal()).state;
    }
    const unconditional = params.omega / (1 - params.alpha - params.beta);
    expect(state.sigma2).toBeGreaterThan(unconditional / 50);
    expect(state.sigma2).toBeLessThan(unconditional * 50);
  });

  it("produces volatility clustering — autocorrelated squared returns", () => {
    const rng = createRng(11);
    let state = initGarch(params);
    const sq: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const z = rng.normal();
      const { state: nextState, sigma } = stepGarch(state, params, z);
      state = nextState;
      sq.push((sigma * z) ** 2);
    }
    const mean = sq.reduce((s, v) => s + v, 0) / sq.length;
    let cov = 0;
    let varr = 0;
    for (let i = 1; i < sq.length; i++) {
      cov += (sq[i]! - mean) * (sq[i - 1]! - mean);
      varr += (sq[i]! - mean) ** 2;
    }
    const lag1 = cov / varr;
    // Independent noise would give ~0. Clustering must be clearly positive.
    expect(lag1).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 8: Run the GARCH test to verify it fails**

```bash
pnpm --filter @asm/pricing test
```

Expected: FAIL — cannot resolve `./garch.js`.

- [ ] **Step 9: Write `packages/pricing/src/garch.ts`**

```ts
/**
 * GARCH(1,1) conditional variance:
 *   sigma2(t) = omega + alpha * eps(t-1)^2 + beta * sigma2(t-1)
 *
 * Requires alpha + beta < 1 for stationarity. This is the term that gives the
 * synthetic series realistic volatility clustering; without it, candles look
 * uniformly noisy and read as fake immediately.
 */

export interface GarchParams {
  readonly omega: number;
  readonly alpha: number;
  readonly beta: number;
}

export interface GarchState {
  readonly sigma2: number;
  readonly lastEps: number;
}

export function initGarch(params: GarchParams): GarchState {
  const persistence = params.alpha + params.beta;
  if (persistence >= 1) {
    throw new Error(
      `GARCH is non-stationary: alpha + beta = ${persistence}, must be < 1`,
    );
  }
  return { sigma2: params.omega / (1 - persistence), lastEps: 0 };
}

export function stepGarch(
  state: GarchState,
  params: GarchParams,
  z: number,
): { state: GarchState; sigma: number } {
  const sigma2 =
    params.omega +
    params.alpha * state.lastEps * state.lastEps +
    params.beta * state.sigma2;
  const sigma = Math.sqrt(sigma2);
  return { state: { sigma2, lastEps: sigma * z }, sigma };
}
```

- [ ] **Step 10: Run the tests to verify they pass**

```bash
pnpm --filter @asm/pricing test
```

Expected: PASS — 9 tests.

- [ ] **Step 11: Commit**

```bash
git add packages/pricing
git commit -m "feat(pricing): seeded rng and garch volatility"
```

---

## Task 2: The four-layer tick composer

**Files:**
- Create: `packages/pricing/src/step.ts`
- Test: `packages/pricing/src/step.test.ts`

**Interfaces:**
- Consumes: `GarchParams`, `GarchState`, `initGarch`, `stepGarch` from Task 1
- Produces:
  - `PriceParams = { garch: GarchParams; driftPerSec: number; anchorAlpha: number; maxTickMove: number }`
  - `PriceState = { price: number; garch: GarchState }`
  - `initPriceState(basePrice: number, params: PriceParams): PriceState`
  - `stepPrice(input: StepPriceInput): StepPriceOutput` where
    `StepPriceInput = { state, params, dtSec, z, driftBias, magnet, anchorTarget }`
    and `StepPriceOutput = { state: PriceState; price: number; sigma: number }`

`driftBias` (layer 2) and `magnet` (layer 3) are parameters here but always `0` until Plan 04. That ordering is intentional: an unbiased engine is verifiable on its own, and a biased one is not.

- [ ] **Step 1: Write the failing test**

Create `packages/pricing/src/step.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initPriceState, stepPrice, type PriceParams } from "./step.js";
import { createRng } from "./rng.js";

const params: PriceParams = {
  garch: { omega: 0.000001, alpha: 0.08, beta: 0.9 },
  driftPerSec: 0,
  anchorAlpha: 0,
  maxTickMove: 0.01,
};

function run(
  n: number,
  seed: number,
  overrides: Partial<{
    driftBias: number;
    magnet: number;
    anchorTarget: number;
    anchorAlpha: number;
  }> = {},
) {
  const p: PriceParams = {
    ...params,
    anchorAlpha: overrides.anchorAlpha ?? params.anchorAlpha,
  };
  const rng = createRng(seed);
  let state = initPriceState(1.175, p);
  for (let i = 0; i < n; i++) {
    state = stepPrice({
      state,
      params: p,
      dtSec: 0.1,
      z: rng.normal(),
      driftBias: overrides.driftBias ?? 0,
      magnet: overrides.magnet ?? 0,
      anchorTarget: overrides.anchorTarget ?? null,
    }).state;
  }
  return state.price;
}

describe("stepPrice", () => {
  it("starts at the base price", () => {
    expect(initPriceState(1.175, params).price).toBe(1.175);
  });

  it("keeps the price strictly positive over a long run", () => {
    const rng = createRng(5);
    let state = initPriceState(1.175, params);
    for (let i = 0; i < 50_000; i++) {
      state = stepPrice({
        state,
        params,
        dtSec: 0.1,
        z: rng.normal(),
        driftBias: 0,
        magnet: 0,
        anchorTarget: null,
      }).state;
      expect(state.price).toBeGreaterThan(0);
    }
  });

  it("is deterministic for a fixed seed", () => {
    expect(run(2000, 21)).toBe(run(2000, 21));
  });

  it("drifts upward under a positive bias and downward under a negative one", () => {
    const up = run(3000, 33, { driftBias: 0.0002 });
    const down = run(3000, 33, { driftBias: -0.0002 });
    expect(up).toBeGreaterThan(down);
  });

  it("moves toward the anchor target when anchoring is enabled", () => {
    const anchored = run(2000, 44, { anchorTarget: 1.25, anchorAlpha: 0.05 });
    const unanchored = run(2000, 44, { anchorTarget: 1.25, anchorAlpha: 0 });
    expect(anchored).toBeGreaterThan(unanchored);
  });

  it("clamps a single tick to maxTickMove", () => {
    const tight: PriceParams = { ...params, maxTickMove: 0.0001 };
    const state = initPriceState(1.175, tight);
    const out = stepPrice({
      state,
      params: tight,
      dtSec: 0.1,
      z: 0,
      driftBias: 0,
      magnet: 10, // absurd magnet — must be clamped
      anchorTarget: null,
    });
    expect(Math.abs(out.price - 1.175)).toBeLessThanOrEqual(0.0001 + 1e-12);
  });

  it("reports the sigma used for the tick", () => {
    const out = stepPrice({
      state: initPriceState(1.175, params),
      params,
      dtSec: 0.1,
      z: 0.5,
      driftBias: 0,
      magnet: 0,
      anchorTarget: null,
    });
    expect(out.sigma).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @asm/pricing test
```

Expected: FAIL — cannot resolve `./step.js`.

- [ ] **Step 3: Write `packages/pricing/src/step.ts`**

```ts
import { initGarch, stepGarch, type GarchParams, type GarchState } from "./garch.js";

/**
 * The four-layer tick composer.
 *
 *   L1 base      GBM with GARCH volatility — the honest random walk
 *   L2 drift     a small bounded bias (Plan 04 supplies it; 0 here)
 *   L3 magnet    expiry convergence pull (Plan 04 supplies it; 0 here)
 *   L4 anchor    weak pull toward a real market price
 *
 * All four combine in log space so the price can never go negative, then the
 * total move is clamped so no single tick can draw an implausible candle.
 */

export interface PriceParams {
  readonly garch: GarchParams;
  /** Deterministic drift per second, in log space. Usually 0. */
  readonly driftPerSec: number;
  /** Anchor strength per tick. 0 disables anchoring entirely. */
  readonly anchorAlpha: number;
  /** Hard cap on absolute price movement in one tick. */
  readonly maxTickMove: number;
}

export interface PriceState {
  readonly price: number;
  readonly garch: GarchState;
}

export interface StepPriceInput {
  readonly state: PriceState;
  readonly params: PriceParams;
  readonly dtSec: number;
  /** Standard normal draw for this tick. */
  readonly z: number;
  /** Layer 2. Log-space bias. Plan 04 bounds this to ±0.25·sigma. */
  readonly driftBias: number;
  /** Layer 3. Log-space pull toward an expiry target. */
  readonly magnet: number;
  /** Layer 4 target, or null when no real quote is available. */
  readonly anchorTarget: number | null;
}

export interface StepPriceOutput {
  readonly state: PriceState;
  readonly price: number;
  /** The conditional volatility used for this tick — Plan 04 needs it to scale bias. */
  readonly sigma: number;
}

export function initPriceState(
  basePrice: number,
  params: PriceParams,
): PriceState {
  if (!(basePrice > 0)) {
    throw new Error(`basePrice must be positive, received ${basePrice}`);
  }
  return { price: basePrice, garch: initGarch(params.garch) };
}

export function stepPrice(input: StepPriceInput): StepPriceOutput {
  const { state, params, dtSec, z, driftBias, magnet, anchorTarget } = input;

  const { state: garch, sigma } = stepGarch(state.garch, params.garch, z);

  // L1 + L2 + L3 in log space.
  let logMove =
    params.driftPerSec * dtSec + sigma * Math.sqrt(dtSec) * z + driftBias + magnet;

  // L4: anchoring is a proportional pull expressed in log space so it composes
  // with the others rather than fighting them.
  if (anchorTarget !== null && params.anchorAlpha > 0 && anchorTarget > 0) {
    logMove += params.anchorAlpha * Math.log(anchorTarget / state.price);
  }

  const candidate = state.price * Math.exp(logMove);

  // Clamp the realised move. This is the guard that stops a large magnet or a
  // freak draw from producing a candle nobody would believe.
  const delta = candidate - state.price;
  const clamped =
    Math.abs(delta) > params.maxTickMove
      ? state.price + Math.sign(delta) * params.maxTickMove
      : candidate;

  const price = clamped > 0 ? clamped : state.price;

  return { state: { price, garch }, price, sigma };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @asm/pricing test
```

Expected: PASS — 16 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/pricing
git commit -m "feat(pricing): four-layer tick composer"
```

---

## Task 3: Candle aggregation

**Files:**
- Create: `packages/pricing/src/candles.ts`, `packages/pricing/src/index.ts`
- Test: `packages/pricing/src/candles.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Candle = { openTs: number; o: number; h: number; l: number; c: number }` where `openTs` is epoch **seconds**
  - `class CandleAggregator` with `constructor(timeframeSec: number)`, `addTick(tsSec: number, price: number): Candle | null` returning a *closed* candle when a boundary is crossed, `current(): Candle | null`
  - `bucketStart(tsSec: number, timeframeSec: number): number`

- [ ] **Step 1: Write the failing test**

Create `packages/pricing/src/candles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CandleAggregator, bucketStart } from "./candles.js";

describe("bucketStart", () => {
  it("floors to the wall-clock minute", () => {
    expect(bucketStart(1_757_534_296, 60)).toBe(1_757_534_280);
    expect(bucketStart(1_757_534_280, 60)).toBe(1_757_534_280);
  });
});

describe("CandleAggregator", () => {
  it("returns null while the first candle is still forming", () => {
    const agg = new CandleAggregator(60);
    expect(agg.addTick(1_757_534_281, 1.175)).toBeNull();
    expect(agg.addTick(1_757_534_290, 1.176)).toBeNull();
  });

  it("tracks open, high, low and close of the forming candle", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_281, 1.175);
    agg.addTick(1_757_534_290, 1.178);
    agg.addTick(1_757_534_300, 1.172);
    agg.addTick(1_757_534_310, 1.176);
    const c = agg.current()!;
    expect(c.o).toBe(1.175);
    expect(c.h).toBe(1.178);
    expect(c.l).toBe(1.172);
    expect(c.c).toBe(1.176);
    expect(c.openTs).toBe(1_757_534_280);
  });

  it("emits the closed candle when the boundary is crossed", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_281, 1.175);
    agg.addTick(1_757_534_290, 1.178);
    const closed = agg.addTick(1_757_534_341, 1.177);
    expect(closed).not.toBeNull();
    expect(closed!.openTs).toBe(1_757_534_280);
    expect(closed!.c).toBe(1.178);
  });

  it("opens the next candle at the first tick of the new bucket", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_281, 1.175);
    agg.addTick(1_757_534_341, 1.177);
    const c = agg.current()!;
    expect(c.openTs).toBe(1_757_534_340);
    expect(c.o).toBe(1.177);
  });

  it("skips empty buckets when ticks jump several minutes", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_281, 1.175);
    const closed = agg.addTick(1_757_534_581, 1.19);
    expect(closed!.openTs).toBe(1_757_534_280);
    expect(agg.current()!.openTs).toBe(1_757_534_580);
  });

  it("rejects out-of-order ticks rather than corrupting the candle", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_290, 1.175);
    expect(() => agg.addTick(1_757_534_281, 1.9)).toThrow(/out of order/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @asm/pricing test
```

Expected: FAIL — cannot resolve `./candles.js`.

- [ ] **Step 3: Write `packages/pricing/src/candles.ts`**

```ts
export interface Candle {
  /** Epoch SECONDS at which this candle's bucket opens. */
  readonly openTs: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
}

/** Floors a timestamp to its wall-clock bucket boundary. */
export function bucketStart(tsSec: number, timeframeSec: number): number {
  return Math.floor(tsSec / timeframeSec) * timeframeSec;
}

interface Mutable {
  openTs: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * Aggregates a tick stream into fixed-width OHLC candles on wall-clock
 * boundaries. Returns a candle only when one CLOSES, so the caller can persist
 * it and broadcast it in the same step.
 */
export class CandleAggregator {
  private forming: Mutable | null = null;
  private lastTs = -Infinity;

  constructor(private readonly timeframeSec: number) {
    if (!Number.isInteger(timeframeSec) || timeframeSec <= 0) {
      throw new Error(`timeframeSec must be a positive integer`);
    }
  }

  addTick(tsSec: number, price: number): Candle | null {
    if (tsSec < this.lastTs) {
      throw new Error(
        `Tick out of order: ${tsSec} follows ${this.lastTs}. The engine clock must be monotonic.`,
      );
    }
    this.lastTs = tsSec;

    const bucket = bucketStart(tsSec, this.timeframeSec);

    if (this.forming === null) {
      this.forming = { openTs: bucket, o: price, h: price, l: price, c: price };
      return null;
    }

    if (bucket === this.forming.openTs) {
      this.forming.h = Math.max(this.forming.h, price);
      this.forming.l = Math.min(this.forming.l, price);
      this.forming.c = price;
      return null;
    }

    // Boundary crossed. Emit the finished candle and start a fresh one. Buckets
    // with no ticks are simply absent rather than synthesised — a gap is real
    // information and inventing flat candles would hide feed outages.
    const closed: Candle = { ...this.forming };
    this.forming = { openTs: bucket, o: price, h: price, l: price, c: price };
    return closed;
  }

  current(): Candle | null {
    return this.forming === null ? null : { ...this.forming };
  }
}
```

- [ ] **Step 4: Write `packages/pricing/src/index.ts`**

```ts
export { createRng, type Rng } from "./rng.js";
export {
  initGarch,
  stepGarch,
  type GarchParams,
  type GarchState,
} from "./garch.js";
export {
  initPriceState,
  stepPrice,
  type PriceParams,
  type PriceState,
  type StepPriceInput,
  type StepPriceOutput,
} from "./step.js";
export { CandleAggregator, bucketStart, type Candle } from "./candles.js";
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @asm/pricing test
```

Expected: PASS — 23 tests total.

- [ ] **Step 6: Commit**

```bash
git add packages/pricing
git commit -m "feat(pricing): candle aggregation"
```

---

## Task 4: WebSocket message contracts

**Files:**
- Create: `packages/contracts/src/ws.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/ws.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `ClientMessageSchema` — discriminated union of `auth`, `subscribe`, `unsubscribe`
  - `ServerMessage` type union and per-message builders
  - `CandleSchema`, `TimeframeSchema`
  - Types: `ClientMessage`, `ServerMessage`, `TickMessage`, `CandleHistoryMessage`, `CandleCloseMessage`, `PayoutUpdateMessage`, `ErrorMessage`

Plans 03 and 04 extend this file with `trade:opened`, `trade:settled`, `balance:update`, and `sentiment`. Defining the union now means those are additions, not refactors.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/ws.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "./ws.js";

describe("ClientMessageSchema", () => {
  it("accepts an auth message", () => {
    const parsed = ClientMessageSchema.parse({ type: "auth", token: "abc" });
    expect(parsed.type).toBe("auth");
  });

  it("accepts a subscribe message", () => {
    const parsed = ClientMessageSchema.parse({
      type: "subscribe",
      symbol: "AUDNZD_OTC",
      timeframe: "1m",
    });
    expect(parsed.type).toBe("subscribe");
  });

  it("rejects an unknown message type", () => {
    expect(
      ClientMessageSchema.safeParse({ type: "settle", tradeId: "x" }).success,
    ).toBe(false);
  });

  it("rejects extra keys on a subscribe message", () => {
    const result = ClientMessageSchema.safeParse({
      type: "subscribe",
      symbol: "AUDNZD_OTC",
      timeframe: "1m",
      price: 9.99,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported timeframe", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "subscribe",
        symbol: "AUDNZD_OTC",
        timeframe: "7s",
      }).success,
    ).toBe(false);
  });

  it("rejects a symbol with unexpected characters", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "subscribe",
        symbol: "AUD/NZD; DROP TABLE",
        timeframe: "1m",
      }).success,
    ).toBe(false);
  });
});
```

The last two cases matter: a client-supplied symbol reaches a database lookup, so constraining its shape at the boundary is the control, not a nicety.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @asm/contracts test
```

Expected: FAIL — cannot resolve `./ws.js`.

- [ ] **Step 3: Write `packages/contracts/src/ws.ts`**

```ts
import { z } from "zod";

/** Asset symbols are uppercase alphanumerics and underscores only. */
export const SymbolSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9_]+$/, "Symbol must be uppercase letters, digits, or underscore");

export const TimeframeSchema = z.enum(["1m", "5m", "15m"]);
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const CandleSchema = z.strictObject({
  openTs: z.number().int(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
});
export type CandleDto = z.infer<typeof CandleSchema>;

// ---------- client -> server ----------

export const AuthMessageSchema = z.strictObject({
  type: z.literal("auth"),
  token: z.string().min(1).max(512),
});

export const SubscribeMessageSchema = z.strictObject({
  type: z.literal("subscribe"),
  symbol: SymbolSchema,
  timeframe: TimeframeSchema,
});

export const UnsubscribeMessageSchema = z.strictObject({
  type: z.literal("unsubscribe"),
  symbol: SymbolSchema,
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  AuthMessageSchema,
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- server -> client ----------
// Outbound messages are constructed by the server, never parsed from input, so
// they are plain types rather than schemas.

export interface TickMessage {
  type: "tick";
  symbol: string;
  price: number;
  ts: number;
}

export interface CandleHistoryMessage {
  type: "candles:history";
  symbol: string;
  timeframe: Timeframe;
  candles: CandleDto[];
}

export interface CandleCloseMessage {
  type: "candle:close";
  symbol: string;
  timeframe: Timeframe;
  candle: CandleDto;
}

export interface PayoutUpdateMessage {
  type: "payout:update";
  symbol: string;
  payoutPct: number;
}

export interface ReadyMessage {
  type: "ready";
  serverTs: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage =
  | TickMessage
  | CandleHistoryMessage
  | CandleCloseMessage
  | PayoutUpdateMessage
  | ReadyMessage
  | ErrorMessage;
```

- [ ] **Step 4: Update `packages/contracts/src/index.ts`**

```ts
export {
  RegisterSchema,
  LoginSchema,
  type RegisterInput,
  type LoginInput,
} from "./auth.js";
export {
  SymbolSchema,
  TimeframeSchema,
  CandleSchema,
  AuthMessageSchema,
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  ClientMessageSchema,
  type Timeframe,
  type CandleDto,
  type ClientMessage,
  type ServerMessage,
  type TickMessage,
  type CandleHistoryMessage,
  type CandleCloseMessage,
  type PayoutUpdateMessage,
  type ReadyMessage,
  type ErrorMessage,
} from "./ws.js";
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @asm/contracts test
```

Expected: PASS — 13 tests total.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): websocket message schemas"
```

---

## Task 5: Price feed adapters

**Files:**
- Create: `apps/engine/package.json`, `apps/engine/tsconfig.json`, `apps/engine/src/feeds/types.ts`, `apps/engine/src/feeds/replay.ts`, `apps/engine/src/feeds/twelve-data.ts`, `apps/engine/data/seed-quotes.json`
- Test: `apps/engine/src/feeds/replay.test.ts`

**Interfaces:**
- Consumes: `@asm/logger`, `@asm/config`
- Produces:
  - `Quote = { symbol: string; price: number; ts: number }`
  - `PriceFeed = { start(onQuote: (q: Quote) => void): Promise<void>; stop(): Promise<void> }`
  - `createReplayFeed(opts: { symbols: string[]; intervalMs: number }): PriceFeed`
  - `createTwelveDataFeed(opts: { apiKey: string; mapping: Record<string, string>; requestsPerMinute: number }): PriceFeed`
  - `createPriceFeed(symbols: string[]): PriceFeed` — picks by env, falling back to replay

**The rate-limit design.** Twelve Data's free tier allows 8 requests per minute. With three assets, polling each on every engine tick is impossible. The feed instead polls **one symbol at a time, round-robin**, at a spacing derived from the quota — so each asset gets a fresh real quote roughly every 24 seconds, and the synthetic process fills the 10 Hz gap between them. That is not a compromise; it is exactly the anchor cadence the architecture wants.

- [ ] **Step 1: Write `apps/engine/package.json`**

```json
{
  "name": "@asm/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@asm/config": "workspace:*",
    "@asm/contracts": "workspace:*",
    "@asm/db": "workspace:*",
    "@asm/logger": "workspace:*",
    "@asm/pricing": "workspace:*",
    "ws": "8.21.3"
  },
  "devDependencies": {
    "@types/ws": "8.18.1",
    "tsx": "4.20.6"
  }
}
```

- [ ] **Step 2: Write `apps/engine/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write `apps/engine/src/feeds/types.ts`**

```ts
export interface Quote {
  readonly symbol: string;
  readonly price: number;
  /** Epoch seconds. */
  readonly ts: number;
}

export interface PriceFeed {
  start(onQuote: (quote: Quote) => void): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 4: Write `apps/engine/data/seed-quotes.json`**

A small bundled dataset so the engine runs with no API key and no network. Prices are plausible starting levels for the three seeded assets.

```json
{
  "USDJPY": [157.21, 157.24, 157.19, 157.3, 157.28, 157.35, 157.31, 157.26],
  "AUDNZD_OTC": [1.1735, 1.1738, 1.1731, 1.1742, 1.1739, 1.1745, 1.1741, 1.1736],
  "EURUSD_OTC": [1.0842, 1.0845, 1.0839, 1.085, 1.0847, 1.0853, 1.0849, 1.0844]
}
```

- [ ] **Step 5: Write the failing replay-feed test**

Create `apps/engine/src/feeds/replay.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createReplayFeed } from "./replay.js";
import type { Quote } from "./types.js";

describe("createReplayFeed", () => {
  it("emits quotes for every requested symbol", async () => {
    vi.useFakeTimers();
    const seen: Quote[] = [];
    const feed = createReplayFeed({
      symbols: ["USDJPY", "AUDNZD_OTC"],
      intervalMs: 1000,
    });
    await feed.start((q) => seen.push(q));

    await vi.advanceTimersByTimeAsync(5000);
    await feed.stop();
    vi.useRealTimers();

    const symbols = new Set(seen.map((q) => q.symbol));
    expect(symbols.has("USDJPY")).toBe(true);
    expect(symbols.has("AUDNZD_OTC")).toBe(true);
  });

  it("emits positive prices with epoch-second timestamps", async () => {
    vi.useFakeTimers();
    const seen: Quote[] = [];
    const feed = createReplayFeed({ symbols: ["USDJPY"], intervalMs: 500 });
    await feed.start((q) => seen.push(q));
    await vi.advanceTimersByTimeAsync(2000);
    await feed.stop();
    vi.useRealTimers();

    expect(seen.length).toBeGreaterThan(0);
    for (const q of seen) {
      expect(q.price).toBeGreaterThan(0);
      expect(Number.isInteger(q.ts)).toBe(true);
    }
  });

  it("stops emitting after stop()", async () => {
    vi.useFakeTimers();
    let count = 0;
    const feed = createReplayFeed({ symbols: ["USDJPY"], intervalMs: 500 });
    await feed.start(() => count++);
    await vi.advanceTimersByTimeAsync(1500);
    const atStop = count;
    await feed.stop();
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();

    expect(count).toBe(atStop);
  });

  it("throws for a symbol absent from the dataset", async () => {
    const feed = createReplayFeed({ symbols: ["NOPE"], intervalMs: 500 });
    await expect(feed.start(() => {})).rejects.toThrow(/NOPE/);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
pnpm --filter @asm/engine test
```

Expected: FAIL — cannot resolve `./replay.js`.

- [ ] **Step 7: Write `apps/engine/src/feeds/replay.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(here, "../../data/seed-quotes.json");

type Dataset = Record<string, number[]>;

/**
 * Offline feed. Cycles a bundled dataset so the engine runs with no API key and
 * no network. Also the fallback when the live feed's quota is exhausted — a
 * dead chart is a worse failure than a replayed one.
 */
export function createReplayFeed(opts: {
  symbols: string[];
  intervalMs: number;
}): PriceFeed {
  let timer: NodeJS.Timeout | null = null;
  let cursor = 0;

  return {
    async start(onQuote: (quote: Quote) => void) {
      const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as Dataset;

      for (const symbol of opts.symbols) {
        if (!dataset[symbol]) {
          throw new Error(
            `Replay dataset has no series for symbol "${symbol}". Add it to data/seed-quotes.json.`,
          );
        }
      }

      logger.info(
        { evt: "engine.feed_connected", feed: "replay", symbols: opts.symbols },
        "replay feed started",
      );

      timer = setInterval(() => {
        const ts = Math.floor(Date.now() / 1000);
        for (const symbol of opts.symbols) {
          const series = dataset[symbol]!;
          onQuote({ symbol, price: series[cursor % series.length]!, ts });
        }
        cursor++;
      }, opts.intervalMs);
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      logger.info({ evt: "engine.feed_stopped", feed: "replay" }, "replay feed stopped");
    },
  };
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
pnpm install
pnpm --filter @asm/engine test
```

Expected: PASS — 4 tests.

- [ ] **Step 9: Write `apps/engine/src/feeds/twelve-data.ts`**

```ts
import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types.js";

/**
 * Twelve Data REST poller.
 *
 * The free tier allows 8 requests/minute and 800/day. Polling every asset on a
 * timer would exhaust that in minutes, so this polls ONE symbol at a time,
 * round-robin, spaced from the quota. With three assets at 7 requests/minute,
 * each gets a fresh real quote about every 26 seconds — which is the anchor
 * cadence the price engine wants anyway. The synthetic process covers the gap.
 */
export function createTwelveDataFeed(opts: {
  apiKey: string;
  /** Internal symbol -> Twelve Data symbol, e.g. AUDNZD_OTC -> AUD/NZD */
  mapping: Record<string, string>;
  requestsPerMinute: number;
}): PriceFeed {
  const internalSymbols = Object.keys(opts.mapping);
  const spacingMs = Math.ceil(60_000 / Math.max(1, opts.requestsPerMinute));

  let timer: NodeJS.Timeout | null = null;
  let index = 0;
  let consecutiveFailures = 0;

  return {
    async start(onQuote: (quote: Quote) => void) {
      logger.info(
        {
          evt: "engine.feed_connected",
          feed: "twelve-data",
          symbols: internalSymbols,
          spacingMs,
        },
        "twelve data feed started",
      );

      timer = setInterval(async () => {
        const internal = internalSymbols[index % internalSymbols.length]!;
        index++;
        const remote = opts.mapping[internal]!;

        try {
          const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(remote)}&apikey=${encodeURIComponent(opts.apiKey)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const body = (await res.json()) as { price?: string; code?: number };
          if (body.code === 429) throw new Error("quota exceeded");

          const price = Number(body.price);
          if (!Number.isFinite(price) || price <= 0) {
            throw new Error(`unusable price payload: ${JSON.stringify(body)}`);
          }

          consecutiveFailures = 0;
          onQuote({ symbol: internal, price, ts: Math.floor(Date.now() / 1000) });
        } catch (err) {
          consecutiveFailures++;
          logger.warn(
            {
              evt: "engine.feed_gap",
              feed: "twelve-data",
              symbol: internal,
              consecutiveFailures,
              reason: err instanceof Error ? err.message : "unknown",
            },
            "quote fetch failed",
          );
        }
      }, spacingMs);
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      logger.info(
        { evt: "engine.feed_stopped", feed: "twelve-data" },
        "twelve data feed stopped",
      );
    },
  };
}

/** Chooses a feed from the environment, falling back to replay. */
export function createPriceFeed(symbols: string[]): PriceFeed {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    logger.info(
      { evt: "engine.feed_selected", feed: "replay", reason: "no_api_key" },
      "TWELVE_DATA_API_KEY not set — using the bundled replay dataset",
    );
    // Lazy import avoids a cycle between the two feed modules.
    return {
      async start(onQuote) {
        const { createReplayFeed } = await import("./replay.js");
        const inner = createReplayFeed({ symbols, intervalMs: 5000 });
        (this as { inner?: PriceFeed }).inner = inner;
        await inner.start(onQuote);
      },
      async stop() {
        await (this as { inner?: PriceFeed }).inner?.stop();
      },
    };
  }

  const mapping: Record<string, string> = {
    USDJPY: "USD/JPY",
    AUDNZD_OTC: "AUD/NZD",
    EURUSD_OTC: "EUR/USD",
  };
  const selected = Object.fromEntries(
    symbols.filter((s) => s in mapping).map((s) => [s, mapping[s]!]),
  );

  return createTwelveDataFeed({ apiKey, mapping: selected, requestsPerMinute: 7 });
}
```

- [ ] **Step 10: Add the API key to the environment files**

Append to both `.env.example` and `.env`:

```bash
# Twelve Data — optional. Unset means the bundled replay dataset is used.
# Free tier: 8 requests/minute, 800/day. https://twelvedata.com/pricing
TWELVE_DATA_API_KEY=""
```

- [ ] **Step 11: Commit**

```bash
git add apps/engine .env.example
git commit -m "feat(engine): replay and twelve-data price feeds"
```

---

## Task 6: The engine process — tick loop, persistence, WebSocket server

**Files:**
- Create: `apps/engine/src/assets/registry.ts`, `apps/engine/src/loop.ts`, `apps/engine/src/server.ts`, `apps/engine/src/main.ts`
- Modify: root `package.json` scripts
- Test: `apps/engine/src/assets/registry.test.ts`

**Interfaces:**
- Consumes: `@asm/pricing`, `@asm/db`, `@asm/logger`, `ClientMessageSchema` and `ServerMessage` from `@asm/contracts`, `createPriceFeed` from Task 5
- Produces:
  - `class AssetRegistry` with `load(): Promise<void>`, `symbols(): string[]`, `get(symbol): LiveAsset | undefined`, `all(): LiveAsset[]`, `setAnchor(symbol, price): void`, `tick(symbol, nowSec): TickResult`
  - `LiveAsset = { id, symbol, payoutPct, precision, params: PriceParams, state: PriceState, anchor: number | null, aggregator: CandleAggregator }`
  - `TickResult = { price: number; sigma: number; closed: Candle | null }`
  - `startEngine(): Promise<{ stop(): Promise<void> }>`

- [ ] **Step 1: Write the failing registry test**

Create `apps/engine/src/assets/registry.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssetRegistry } from "./registry.js";
import { prisma } from "@asm/db";

const registry = new AssetRegistry(1234);

beforeAll(async () => {
  await registry.load();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("AssetRegistry", () => {
  it("loads the seeded assets", () => {
    expect(registry.symbols()).toContain("AUDNZD_OTC");
    expect(registry.symbols().length).toBeGreaterThanOrEqual(3);
  });

  it("initialises each asset at its base price", () => {
    const asset = registry.get("AUDNZD_OTC")!;
    expect(asset.state.price).toBeCloseTo(1.1735, 4);
  });

  it("returns undefined for an unknown symbol", () => {
    expect(registry.get("NOT_AN_ASSET")).toBeUndefined();
  });

  it("advances the price on tick and keeps it positive", () => {
    let now = 1_757_534_281;
    for (let i = 0; i < 200; i++) {
      const result = registry.tick("AUDNZD_OTC", now);
      expect(result.price).toBeGreaterThan(0);
      now += 1;
    }
  });

  it("emits a closed candle when a minute boundary is crossed", () => {
    let closed = null;
    let now = 1_757_600_000;
    for (let i = 0; i < 200 && closed === null; i++) {
      closed = registry.tick("EURUSD_OTC", now).closed;
      now += 1;
    }
    expect(closed).not.toBeNull();
  });

  it("pulls the price toward an anchor once one is set", () => {
    const asset = registry.get("USDJPY")!;
    const start = asset.state.price;
    registry.setAnchor("USDJPY", start * 1.02);
    let now = 1_757_700_000;
    for (let i = 0; i < 500; i++) {
      registry.tick("USDJPY", now);
      now += 1;
    }
    expect(registry.get("USDJPY")!.state.price).toBeGreaterThan(start);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/engine && DATABASE_URL="postgresql://asm_app:asm_dev_password@localhost:5432/asm_trade?schema=public" pnpm exec vitest run src/assets; cd ../..
```

Expected: FAIL — cannot resolve `./registry.js`.

- [ ] **Step 3: Write `apps/engine/src/assets/registry.ts`**

```ts
import {
  CandleAggregator,
  createRng,
  initPriceState,
  stepPrice,
  type Candle,
  type PriceParams,
  type PriceState,
  type Rng,
} from "@asm/pricing";
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";

export interface LiveAsset {
  id: string;
  symbol: string;
  payoutPct: number;
  precision: number;
  params: PriceParams;
  state: PriceState;
  /** Latest real quote, or null until the feed delivers one. */
  anchor: number | null;
  aggregator: CandleAggregator;
}

export interface TickResult {
  price: number;
  sigma: number;
  /** Non-null exactly when this tick closed a candle. */
  closed: Candle | null;
}

const TICK_HZ = 10;
const DT_SEC = 1 / TICK_HZ;

/**
 * Holds live per-asset price state in memory. This is why the engine is a
 * separate long-lived process rather than a Next.js route — GARCH state and a
 * forming candle cannot survive a serverless request model.
 */
export class AssetRegistry {
  private assets = new Map<string, LiveAsset>();
  private rng: Rng;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  async load(): Promise<void> {
    const rows = await prisma.asset.findMany({ where: { isOpen: true } });

    for (const row of rows) {
      const params: PriceParams = {
        garch: { omega: row.garchOmega, alpha: row.garchAlpha, beta: row.garchBeta },
        driftPerSec: 0,
        anchorAlpha: row.anchorAlpha,
        // Two ticks of typical movement is generous but never implausible.
        maxTickMove: row.tickSize * 40,
      };

      this.assets.set(row.symbol, {
        id: row.id,
        symbol: row.symbol,
        payoutPct: row.payoutPct,
        precision: row.precision,
        params,
        state: initPriceState(row.basePrice, params),
        anchor: null,
        aggregator: new CandleAggregator(60),
      });
    }

    logger.info(
      { evt: "engine.assets_loaded", count: this.assets.size },
      "asset registry loaded",
    );
  }

  symbols(): string[] {
    return [...this.assets.keys()];
  }

  get(symbol: string): LiveAsset | undefined {
    return this.assets.get(symbol);
  }

  all(): LiveAsset[] {
    return [...this.assets.values()];
  }

  setAnchor(symbol: string, price: number): void {
    const asset = this.assets.get(symbol);
    if (asset) asset.anchor = price;
  }

  /**
   * Advances one asset by a single tick.
   *
   * driftBias and magnet are hard zero in this plan — the engine is
   * deliberately unbiased until Plan 04 supplies a controller. Leaving the
   * parameters in place means Plan 04 is a wiring change, not a rewrite.
   */
  tick(symbol: string, nowSec: number): TickResult {
    const asset = this.assets.get(symbol);
    if (!asset) {
      throw new Error(`tick called for unknown symbol "${symbol}"`);
    }

    const out = stepPrice({
      state: asset.state,
      params: asset.params,
      dtSec: DT_SEC,
      z: this.rng.normal(),
      driftBias: 0,
      magnet: 0,
      anchorTarget: asset.anchor,
    });

    asset.state = out.state;

    const rounded = Number(out.price.toFixed(asset.precision));
    const closed = asset.aggregator.addTick(nowSec, rounded);

    return { price: rounded, sigma: out.sigma, closed };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/engine && DATABASE_URL="postgresql://asm_app:asm_dev_password@localhost:5432/asm_trade?schema=public" pnpm exec vitest run src/assets; cd ../..
```

Expected: PASS — 6 tests. If `AssetRegistry` finds no assets, re-run the Plan 01 seed.

- [ ] **Step 5: Write `apps/engine/src/server.ts`**

```ts
import { WebSocketServer, type WebSocket } from "ws";
import { createHash } from "node:crypto";
import {
  ClientMessageSchema,
  type ServerMessage,
  type Timeframe,
} from "@asm/contracts";
import { prisma } from "@asm/db";
import { childLogger, newCorrelationId, logger } from "@asm/logger";
import type { AssetRegistry } from "./assets/registry.js";

interface Client {
  socket: WebSocket;
  userId: string | null;
  subscriptions: Map<string, Timeframe>;
  cid: string;
  messageBudget: number;
}

const MESSAGE_BUDGET_PER_WINDOW = 60;
const BUDGET_WINDOW_MS = 10_000;
const HISTORY_CANDLES = 120;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class EngineServer {
  private wss: WebSocketServer;
  private clients = new Set<Client>();
  private budgetTimer: NodeJS.Timeout;

  constructor(
    private readonly registry: AssetRegistry,
    port: number,
  ) {
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (socket) => this.onConnection(socket));

    this.budgetTimer = setInterval(() => {
      for (const client of this.clients) {
        client.messageBudget = MESSAGE_BUDGET_PER_WINDOW;
      }
    }, BUDGET_WINDOW_MS);

    logger.info({ evt: "engine.ws_listening", port }, "websocket server listening");
  }

  private onConnection(socket: WebSocket): void {
    const client: Client = {
      socket,
      userId: null,
      subscriptions: new Map(),
      cid: newCorrelationId(),
      messageBudget: MESSAGE_BUDGET_PER_WINDOW,
    };
    this.clients.add(client);

    socket.on("message", (raw) => void this.onMessage(client, raw.toString()));
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => this.clients.delete(client));

    this.send(client, { type: "ready", serverTs: Date.now() });
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    const log = childLogger(client.cid);

    // Per-connection budget — an authenticated socket is still a rate-limited one.
    if (client.messageBudget-- <= 0) {
      log.warn({ evt: "security.rate_limited", channel: "ws" }, "message budget exceeded");
      client.socket.close(1008, "Too many messages");
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.send(client, { type: "error", message: "Malformed message." });
      return;
    }

    const parsed = ClientMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      log.warn(
        { evt: "security.validation_rejected", channel: "ws" },
        "rejected ws message",
      );
      this.send(client, { type: "error", message: "Unrecognised message." });
      return;
    }

    const message = parsed.data;

    if (message.type === "auth") {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(message.token) },
        select: { userId: true, expiresAt: true },
      });

      if (!session || session.expiresAt.getTime() < Date.now()) {
        this.send(client, { type: "error", message: "Session expired." });
        client.socket.close(1008, "Unauthorised");
        return;
      }

      client.userId = session.userId;
      log.info({ evt: "engine.ws_authed", userId: session.userId }, "socket authed");
      return;
    }

    // Everything past auth requires a session. An open socket is not an
    // authorised one.
    if (!client.userId) {
      this.send(client, { type: "error", message: "Authenticate first." });
      return;
    }

    if (message.type === "unsubscribe") {
      client.subscriptions.delete(message.symbol);
      return;
    }

    const asset = this.registry.get(message.symbol);
    if (!asset) {
      this.send(client, { type: "error", message: "Unknown asset." });
      return;
    }

    client.subscriptions.set(message.symbol, message.timeframe);

    const history = await prisma.candle.findMany({
      where: { assetId: asset.id, timeframe: message.timeframe },
      orderBy: { openTs: "desc" },
      take: HISTORY_CANDLES,
    });

    this.send(client, {
      type: "candles:history",
      symbol: asset.symbol,
      timeframe: message.timeframe,
      candles: history.reverse().map((row) => ({
        openTs: Math.floor(row.openTs.getTime() / 1000),
        o: row.o,
        h: row.h,
        l: row.l,
        c: row.c,
      })),
    });

    this.send(client, {
      type: "payout:update",
      symbol: asset.symbol,
      payoutPct: asset.payoutPct,
    });
  }

  private send(client: Client, message: ServerMessage): void {
    if (client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(JSON.stringify(message));
  }

  /** Fans a message out to every client subscribed to that symbol. */
  broadcast(symbol: string, message: ServerMessage): void {
    for (const client of this.clients) {
      if (client.userId && client.subscriptions.has(symbol)) {
        this.send(client, message);
      }
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.budgetTimer);
    for (const client of this.clients) client.socket.close(1001, "Server shutting down");
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
```

- [ ] **Step 6: Write `apps/engine/src/loop.ts`**

```ts
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import type { AssetRegistry } from "./assets/registry.js";
import type { EngineServer } from "./server.js";

const TICK_MS = 100;

/**
 * The 10 Hz tick loop. Uses setTimeout rescheduling rather than setInterval so
 * a slow database write delays the next tick instead of stacking them up.
 */
export function startTickLoop(
  registry: AssetRegistry,
  server: EngineServer,
): { stop(): void } {
  let running = true;
  let timer: NodeJS.Timeout | null = null;
  let lastLagWarn = 0;

  const run = async (): Promise<void> => {
    const startedAt = Date.now();
    const nowSec = Math.floor(startedAt / 1000);

    for (const asset of registry.all()) {
      let result;
      try {
        result = registry.tick(asset.symbol, nowSec);
      } catch (err) {
        logger.error(
          {
            evt: "engine.tick_failed",
            symbol: asset.symbol,
            reason: err instanceof Error ? err.message : "unknown",
          },
          "tick failed",
        );
        continue;
      }

      server.broadcast(asset.symbol, {
        type: "tick",
        symbol: asset.symbol,
        price: result.price,
        ts: nowSec,
      });

      if (result.closed) {
        const candle = result.closed;
        server.broadcast(asset.symbol, {
          type: "candle:close",
          symbol: asset.symbol,
          timeframe: "1m",
          candle,
        });

        // upsert rather than create — a restart mid-minute must not collide.
        await prisma.candle
          .upsert({
            where: {
              assetId_timeframe_openTs: {
                assetId: asset.id,
                timeframe: "1m",
                openTs: new Date(candle.openTs * 1000),
              },
            },
            create: {
              assetId: asset.id,
              timeframe: "1m",
              openTs: new Date(candle.openTs * 1000),
              o: candle.o,
              h: candle.h,
              l: candle.l,
              c: candle.c,
            },
            update: { h: candle.h, l: candle.l, c: candle.c },
          })
          .catch((err: unknown) => {
            logger.error(
              {
                evt: "engine.candle_persist_failed",
                symbol: asset.symbol,
                openTs: candle.openTs,
                reason: err instanceof Error ? err.message : "unknown",
              },
              "candle persist failed",
            );
          });
      }
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed > TICK_MS * 3 && Date.now() - lastLagWarn > 30_000) {
      lastLagWarn = Date.now();
      logger.warn(
        { evt: "engine.tick_lag", elapsedMs: elapsed, budgetMs: TICK_MS },
        "tick loop is falling behind",
      );
    }

    if (running) {
      timer = setTimeout(() => void run(), Math.max(0, TICK_MS - elapsed));
    }
  };

  void run();

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
```

- [ ] **Step 7: Write `apps/engine/src/main.ts`**

```ts
import { logger } from "@asm/logger";
import { prisma } from "@asm/db";
import { AssetRegistry } from "./assets/registry.js";
import { EngineServer } from "./server.js";
import { startTickLoop } from "./loop.js";
import { createPriceFeed } from "./feeds/twelve-data.js";

const WS_PORT = Number(process.env.ENGINE_WS_PORT ?? 4001);

async function main(): Promise<void> {
  const registry = new AssetRegistry(Date.now() & 0x7fffffff);
  await registry.load();

  if (registry.symbols().length === 0) {
    throw new Error(
      "No open assets found. Run the Plan 01 seed: pnpm db:seed",
    );
  }

  const server = new EngineServer(registry, WS_PORT);
  const loop = startTickLoop(registry, server);

  const feed = createPriceFeed(registry.symbols());
  await feed.start((quote) => {
    registry.setAnchor(quote.symbol, quote.price);
  });

  logger.info({ evt: "engine.started", wsPort: WS_PORT }, "engine started");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ evt: "engine.stopping", signal }, "shutting down");
    loop.stop();
    await feed.stop();
    await server.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // A10:2025 — mishandled exceptional conditions. Log and exit cleanly so the
  // supervisor restarts us, rather than limping on in an unknown state.
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

- [ ] **Step 8: Add engine scripts and env to the root**

Add to root `package.json` `scripts`:

```json
    "dev:engine": "pnpm --filter @asm/engine dev",
    "dev:all": "pnpm --filter @asm/web dev & pnpm --filter @asm/engine dev"
```

Append to both `.env.example` and `.env`:

```bash
ENGINE_WS_PORT="4001"
NEXT_PUBLIC_ENGINE_WS_URL="ws://localhost:4001"
```

- [ ] **Step 9: Run the engine and verify ticks and persistence**

```bash
pnpm install
pnpm dev:engine
```

Expected log lines: `engine.assets_loaded` with `count: 3`, `engine.ws_listening` on 4001, `engine.feed_connected` with `feed: "replay"`.

Leave it running for 90 seconds, then in another terminal:

```bash
psql -d asm_trade -c "SELECT a.symbol, count(*) AS candles FROM \"Candle\" c JOIN \"Asset\" a ON a.id=c.\"assetId\" GROUP BY a.symbol;"
```

Expected: one row per asset with at least one candle.

- [ ] **Step 10: Commit**

```bash
git add apps/engine package.json .env.example
git commit -m "feat(engine): tick loop, candle persistence, websocket server"
```

---

## Task 7: Chart in the web app

**Files:**
- Create: `apps/web/src/components/chart/useEngineSocket.ts`, `apps/web/src/components/chart/PriceChart.tsx`, `apps/web/src/app/api/auth/ws-token/route.ts`
- Modify: `apps/web/src/app/(platform)/trade/page.tsx`, `apps/web/package.json`

**Interfaces:**
- Consumes: `ServerMessage` from `@asm/contracts`; the engine WS server from Task 6
- Produces:
  - `useEngineSocket(opts: { symbol: string; timeframe: Timeframe; token: string }): EngineSocketState` where `EngineSocketState = { status: "connecting" | "open" | "closed"; candles: CandleDto[]; lastPrice: number | null; payoutPct: number | null }`
  - `<PriceChart symbol={string} timeframe="1m" token={string} precision={number} />`
  - `GET /api/auth/ws-token` returning `{ token }` — the session token, readable only by the session owner

**Why a token endpoint.** The session cookie is `httpOnly`, so client JavaScript cannot read it to put in a WS `auth` message, and browsers do not send custom headers on a WebSocket handshake. A short server route hands the token to the page that already holds the session. The cookie stays `httpOnly` for every other purpose.

- [ ] **Step 1: Add the chart dependency**

```bash
pnpm --filter @asm/web add lightweight-charts@5.2.1
```

- [ ] **Step 2: Write `apps/web/src/app/api/auth/ws-token/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "@/lib/session";

/**
 * Hands the caller their own session token for the WebSocket handshake.
 * Requires a valid session, so it reveals nothing the caller did not already
 * possess.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSession(token);

  if (!session || !token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json(
    { token },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

- [ ] **Step 3: Write `apps/web/src/components/chart/useEngineSocket.ts`**

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { CandleDto, ServerMessage, Timeframe } from "@asm/contracts";

export interface EngineSocketState {
  status: "connecting" | "open" | "closed";
  candles: CandleDto[];
  lastPrice: number | null;
  payoutPct: number | null;
}

const WS_URL = process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? "ws://localhost:4001";
const MAX_BACKOFF_MS = 15_000;

export function useEngineSocket(opts: {
  symbol: string;
  timeframe: Timeframe;
  token: string | null;
}): EngineSocketState {
  const [state, setState] = useState<EngineSocketState>({
    status: "connecting",
    candles: [],
    lastPrice: null,
    payoutPct: null,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUs = useRef(false);

  useEffect(() => {
    if (!opts.token) return;

    closedByUs.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      setState((s) => ({ ...s, status: "connecting" }));
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        attemptRef.current = 0;
        socket.send(JSON.stringify({ type: "auth", token: opts.token }));
        socket.send(
          JSON.stringify({
            type: "subscribe",
            symbol: opts.symbol,
            timeframe: opts.timeframe,
          }),
        );
        setState((s) => ({ ...s, status: "open" }));
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }

        setState((prev) => {
          switch (message.type) {
            case "candles:history":
              return { ...prev, candles: message.candles };

            case "candle:close": {
              const withoutDuplicate = prev.candles.filter(
                (c) => c.openTs !== message.candle.openTs,
              );
              return {
                ...prev,
                candles: [...withoutDuplicate, message.candle].slice(-500),
              };
            }

            case "tick":
              return { ...prev, lastPrice: message.price };

            case "payout:update":
              return { ...prev, payoutPct: message.payoutPct };

            default:
              return prev;
          }
        });
      };

      socket.onclose = () => {
        setState((s) => ({ ...s, status: "closed" }));
        if (closedByUs.current) return;

        // Exponential backoff with jitter so a restarted engine is not
        // hammered by every open tab at once.
        attemptRef.current += 1;
        const delay = Math.min(
          MAX_BACKOFF_MS,
          500 * 2 ** attemptRef.current + Math.random() * 400,
        );
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedByUs.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [opts.symbol, opts.timeframe, opts.token]);

  return state;
}
```

`Math.random` here is jitter for reconnect timing, not a security value. The Plan 01 ESLint rule fires on it — add a single-line disable with that reason:

```ts
          // eslint-disable-next-line no-restricted-properties -- reconnect jitter, not security
          500 * 2 ** attemptRef.current + Math.random() * 400,
```

- [ ] **Step 4: Write `apps/web/src/components/chart/PriceChart.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Timeframe } from "@asm/contracts";
import { useEngineSocket } from "./useEngineSocket";

export function PriceChart({
  symbol,
  timeframe,
  token,
  precision,
}: {
  symbol: string;
  timeframe: Timeframe;
  token: string | null;
  precision: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const { status, candles, lastPrice, payoutPct } = useEngineSocket({
    symbol,
    timeframe,
    token,
  });

  // Create the chart once. Re-creating it on every render would leak canvases.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0e1621" },
        textColor: "#93a2b4",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1c2836" },
        horzLines: { color: "#1c2836" },
      },
      rightPriceScale: { borderColor: "#253243" },
      timeScale: { borderColor: "#253243", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#2fbd85",
      downColor: "#e0526a",
      wickUpColor: "#2fbd85",
      wickDownColor: "#e0526a",
      borderVisible: false,
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [precision]);

  // Replace the dataset whenever history or a closed candle arrives.
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;
    const data: CandlestickData[] = candles.map((c) => ({
      time: c.openTs as UTCTimestamp,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));
    seriesRef.current.setData(data);
  }, [candles]);

  // Every tick updates only the forming candle.
  useEffect(() => {
    if (!seriesRef.current || lastPrice === null || candles.length === 0) return;
    const last = candles[candles.length - 1]!;
    seriesRef.current.update({
      time: last.openTs as UTCTimestamp,
      open: last.o,
      high: Math.max(last.h, lastPrice),
      low: Math.min(last.l, lastPrice),
      close: lastPrice,
    });
  }, [lastPrice, candles]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold">{symbol}</span>
          {payoutPct !== null ? (
            <span className="text-xs font-semibold text-[var(--color-up)]">
              {payoutPct}%
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {lastPrice !== null ? (
            <span className="text-sm font-semibold tabular-nums">
              {lastPrice.toFixed(precision)}
            </span>
          ) : null}
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: status === "open" ? "#2fbd85" : "#93a2b4" }}
          >
            {status === "open" ? "Live" : status}
          </span>
        </div>
      </div>
      <div ref={containerRef} className="h-[420px] w-full" />
    </div>
  );
}
```

- [ ] **Step 5: Replace `apps/web/src/app/(platform)/trade/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, listAccountsForActor, prisma } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { PriceChart } from "@/components/chart/PriceChart";

export default async function TradePage() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  const session = await readSession(token);
  if (!session) redirect("/login");

  const [accounts, asset] = await Promise.all([
    listAccountsForActor(session.userId),
    prisma.asset.findUnique({ where: { symbol: "AUDNZD_OTC" } }),
  ]);

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

      <div className="grid gap-6 md:grid-cols-[1fr_240px]">
        <section className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
          {asset ? (
            <PriceChart
              symbol={asset.symbol}
              timeframe="1m"
              token={token}
              precision={asset.precision}
            />
          ) : (
            <p className="text-sm text-[var(--color-ink-2)]">
              No assets seeded. Run <code>pnpm db:seed</code>.
            </p>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <AccountSwitcher
            accounts={accounts.map((a) => ({
              id: a.id,
              type: a.type,
              balance: formatMoney(a.realBalance + a.bonusBalance, a.currency),
            }))}
          />
          <p className="text-xs text-[var(--color-ink-2)]">
            Trade ticket arrives in Plan 03.
          </p>
        </aside>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Verify the chart end to end**

Two terminals:

```bash
pnpm dev:engine
```

```bash
pnpm dev
```

Log in and open `http://localhost:3000/trade`. Expected: a dark candlestick chart for **AUD/NZD (OTC)**, a **Live** status pill, a price updating about ten times a second, and a new candle appearing each minute.

- [ ] **Step 7: Verify the socket rejects an unauthenticated subscribe**

```bash
node --input-type=module -e '
import WebSocket from "ws";
const ws = new WebSocket("ws://localhost:4001");
ws.on("open", () => ws.send(JSON.stringify({type:"subscribe",symbol:"AUDNZD_OTC",timeframe:"1m"})));
ws.on("message", (m) => { console.log(m.toString()); process.exit(0); });
' 2>/dev/null || pnpm --filter @asm/engine exec node --input-type=module -e '
import WebSocket from "ws";
const ws = new WebSocket("ws://localhost:4001");
ws.on("open", () => ws.send(JSON.stringify({type:"subscribe",symbol:"AUDNZD_OTC",timeframe:"1m"})));
ws.on("message", (m) => { console.log(m.toString()); process.exit(0); });
'
```

Expected: the first message is `{"type":"ready",...}`, and the subscribe reply is `{"type":"error","message":"Authenticate first."}` — never candle data.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): live candlestick chart driven by the engine"
```

---

## Task 8: Realism gate and full verification

**Files:**
- Create: `packages/pricing/src/realism.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: a statistical gate on the synthetic series

**This is the gate the build spec calls for.** Everything downstream assumes the unbiased engine produces believable candles. Rather than eyeballing the chart, assert the properties that distinguish a real financial series from naive noise: returns are roughly zero-mean, kurtosis is fat-tailed rather than Gaussian, and squared returns are autocorrelated.

- [ ] **Step 1: Write the realism test**

Create `packages/pricing/src/realism.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CandleAggregator,
  createRng,
  initPriceState,
  stepPrice,
  type Candle,
  type PriceParams,
} from "./index.js";

const params: PriceParams = {
  garch: { omega: 0.000001, alpha: 0.08, beta: 0.9 },
  driftPerSec: 0,
  anchorAlpha: 0,
  maxTickMove: 0.01,
};

/** Generates `minutes` of 1m candles at 10 Hz. */
function generate(minutes: number, seed: number): Candle[] {
  const rng = createRng(seed);
  const agg = new CandleAggregator(60);
  let state = initPriceState(1.1735, params);
  let ts = 1_757_534_280;
  const out: Candle[] = [];

  for (let i = 0; i < minutes * 600; i++) {
    const step = stepPrice({
      state,
      params,
      dtSec: 0.1,
      z: rng.normal(),
      driftBias: 0,
      magnet: 0,
      anchorTarget: null,
    });
    state = step.state;
    if (i % 10 === 0) ts += 1;
    const closed = agg.addTick(ts, Number(step.price.toFixed(5)));
    if (closed) out.push(closed);
  }
  return out;
}

describe("synthetic series realism", () => {
  const candles = generate(600, 2026);

  it("produces the expected number of candles", () => {
    expect(candles.length).toBeGreaterThan(500);
  });

  it("respects OHLC invariants on every candle", () => {
    for (const c of candles) {
      expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c));
      expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c));
      expect(c.h).toBeGreaterThanOrEqual(c.l);
    }
  });

  it("has approximately zero-mean log returns", () => {
    const r = candles.slice(1).map((c, i) => Math.log(c.c / candles[i]!.c));
    const mean = r.reduce((s, v) => s + v, 0) / r.length;
    const sd = Math.sqrt(
      r.reduce((s, v) => s + (v - mean) ** 2, 0) / r.length,
    );
    // Mean must be small relative to volatility — no hidden drift.
    expect(Math.abs(mean)).toBeLessThan(sd * 0.5);
  });

  it("is leptokurtic — fatter tails than a Gaussian", () => {
    const r = candles.slice(1).map((c, i) => Math.log(c.c / candles[i]!.c));
    const mean = r.reduce((s, v) => s + v, 0) / r.length;
    const m2 = r.reduce((s, v) => s + (v - mean) ** 2, 0) / r.length;
    const m4 = r.reduce((s, v) => s + (v - mean) ** 4, 0) / r.length;
    const kurtosis = m4 / (m2 * m2);
    // Gaussian is 3. Real financial series exceed it; GARCH reproduces that.
    expect(kurtosis).toBeGreaterThan(3);
  });

  it("shows volatility clustering in candle returns", () => {
    const r = candles.slice(1).map((c, i) => Math.log(c.c / candles[i]!.c));
    const sq = r.map((v) => v * v);
    const mean = sq.reduce((s, v) => s + v, 0) / sq.length;
    let cov = 0;
    let varr = 0;
    for (let i = 1; i < sq.length; i++) {
      cov += (sq[i]! - mean) * (sq[i - 1]! - mean);
      varr += (sq[i]! - mean) ** 2;
    }
    expect(cov / varr).toBeGreaterThan(0.05);
  });

  it("never produces a candle with zero range", () => {
    const flat = candles.filter((c) => c.h === c.l);
    // A handful is possible at low volatility; a wall of them means the engine stalled.
    expect(flat.length / candles.length).toBeLessThan(0.02);
  });
});
```

- [ ] **Step 2: Run the realism test**

```bash
pnpm --filter @asm/pricing test
```

Expected: PASS — 29 tests total across the pricing package.

If kurtosis comes in at or below 3, the GARCH parameters are too tame: raise `garchAlpha` toward 0.12 in the seed and re-run. Do not weaken the assertion — a Gaussian-tailed series is exactly the tell this gate exists to catch.

- [ ] **Step 3: Run the full workspace verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all three clean.

- [ ] **Step 4: Commit**

```bash
git add packages/pricing
git commit -m "test(pricing): statistical realism gate"
```

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass
- [ ] `pnpm dev:engine` logs `engine.assets_loaded` with `count: 3` and `engine.ws_listening` on 4001
- [ ] With no `TWELVE_DATA_API_KEY`, the engine logs `feed: "replay"` and still ticks
- [ ] `/trade` shows a live candlestick chart with a price moving ~10×/second
- [ ] A new candle appears on the chart each minute and lands in the `Candle` table
- [ ] An unauthenticated `subscribe` over WS returns `error`, never candle data
- [ ] A WS message with an unknown `type` is rejected and logged as `security.validation_rejected`
- [ ] Kurtosis of candle log-returns exceeds 3 (fat tails)
- [ ] Lag-1 autocorrelation of squared returns exceeds 0.05 (volatility clustering)
- [ ] Restarting the engine mid-minute does not error on candle upsert

## What Plan 03 depends on from here

Plan 03 (Trade engine) imports and must not need to change:

- `AssetRegistry` — specifically `get(symbol)` for the live price at trade entry
- `EngineServer.broadcast(symbol, message)` for `trade:opened` and `trade:settled`
- `startTickLoop` — extended there with a settlement pass, not rewritten
- `stepPrice`'s `driftBias` and `magnet` parameters, still zero until Plan 04
- The `ServerMessage` union in `packages/contracts/src/ws.ts`, extended with trade messages
