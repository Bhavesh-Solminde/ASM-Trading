# ASM Trade — Plan 02: Price Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live candlestick chart in the web app, driven by a server-authoritative price engine that seeds from real market data and produces statistically realistic synthetic candles — with no manipulation yet.

**Architecture:** Pure price mathematics lives in `packages/pricing` (GBM with GARCH volatility, a four-layer tick composer, a candle aggregator) so it unit-tests in milliseconds with no I/O. A separate long-lived process, `apps/engine`, wires that maths to a real price feed, to Postgres for candle persistence, and to a WebSocket server that fans ticks out to browsers. The web app renders with TradingView Lightweight Charts and never computes a price itself.

**Tech Stack:** TypeScript · `ws` 8.21.3 · lightweight-charts 5.2.1 · Twelve Data REST (free tier) · Postgres 16 · Redis 8 · Vitest 5

> **Revision 2026-09-14 — read before executing Tasks 7–8.** Tasks 1–6 are done and merged into
> this branch as written (see `.superpowers/sdd/progress.md`). Tasks 7 and 8 were re-reviewed
> against the real Task 1–6 code before execution, and rewritten. In summary:
>
> - **Task 7** fixes a WebSocket auth race that would have stopped the chart loading. It
>   replaces handing the `httpOnly` session token to page JavaScript with single-use Redis
>   tickets. It fixes live ticks being drawn into the previous minute's candle. And it makes
>   the chart presentational, with one socket hook later plans extend.
> - **Task 8** replaces a realism gate that tested parameters production never uses. The
>   seeded calibration had the per-tick clamp binding on 87% of ticks, giving 36–99 pips per
>   minute. It adds a derived calibration, a migration for the seeded rows, a gate over the
>   exact production parameters, and a `pnpm test` that works from a bare shell.
>
> The pure-code steps in Task 8 (`calibration.ts`, `realism.test.ts`) were executed and pass
> exactly as printed. Each task's header explains what changed and why.

## Global Constraints

- **Everything from Plan 01 applies** — Node `>=22.0.0`, exact pinned versions, `z.strictObject()` at every boundary, money as integer minor units, `actorId` on every user-owned query, no Docker.
- **New exact versions:** `ws@8.21.3`, `@types/ws@8.18.1`, `lightweight-charts@5.2.1`, `ioredis@5.9.0` (engine, already used by web), `dotenv-cli@10.0.0` (engine dev, already used by `@asm/db`).
- **No session token ever reaches page JavaScript.** Sockets authenticate with a single-use, 30-second ticket (Task 7).
- **Prisma CLI commands target a database through `DATABASE_MIGRATE_URL`**, never `DATABASE_URL` (`prisma.config.ts` prefers it, and dotenv does not override an already-set variable).
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
    ├── calibration.ts      derived calibration + priceParamsFor (Task 8)
    ├── realism.test.ts     statistical gate over production params (Task 8)
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
    ├── auth/ws-ticket.ts   redeems single-use tickets from Redis (Task 7)
    ├── loop.ts             10 Hz tick loop + candle persistence
    └── server.ts           ws server: auth, subscribe, fan-out

apps/web/src/
├── lib/ws-ticket.ts                  mints single-use socket tickets (Task 7)
├── app/api/auth/ws-ticket/route.ts   POST -> { ticket } (Task 7)
├── components/chart/
│   ├── engine-state.ts     pure reducer: history, closes, forming candle
│   ├── useEngineSocket.ts  the page's one socket, with onMessage for later plans
│   ├── PriceChart.tsx      presentational lightweight-charts wrapper
│   └── LiveChart.tsx       hook + chart + header
└── app/(platform)/trade/page.tsx    modified — renders the chart

scripts/test-all.sh          pnpm test from a bare shell (Task 8)
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
import { createRng } from "./rng";

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
import { initGarch, stepGarch, type GarchParams } from "./garch";
import { createRng } from "./rng";

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
import { initPriceState, stepPrice, type PriceParams } from "./step";
import { createRng } from "./rng";

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
import { initGarch, stepGarch, type GarchParams, type GarchState } from "./garch";

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
import { CandleAggregator, bucketStart } from "./candles";

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
export { createRng, type Rng } from "./rng";
export {
  initGarch,
  stepGarch,
  type GarchParams,
  type GarchState,
} from "./garch";
export {
  initPriceState,
  stepPrice,
  type PriceParams,
  type PriceState,
  type StepPriceInput,
  type StepPriceOutput,
} from "./step";
export { CandleAggregator, bucketStart, type Candle } from "./candles";
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
import { ClientMessageSchema } from "./ws";

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
} from "./auth";
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
} from "./ws";
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
import { createReplayFeed } from "./replay";
import type { Quote } from "./types";

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
import type { PriceFeed, Quote } from "./types";

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
import type { PriceFeed, Quote } from "./types";

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
        const { createReplayFeed } = await import("./replay");
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
import { AssetRegistry } from "./registry";
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
cd apps/engine && DATABASE_URL="postgresql://asm_app:asm_dev_password@localhost:5433/asm_trade?schema=public" pnpm exec vitest run src/assets; cd ../..
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
cd apps/engine && DATABASE_URL="postgresql://asm_app:asm_dev_password@localhost:5433/asm_trade?schema=public" pnpm exec vitest run src/assets; cd ../..
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
import type { AssetRegistry } from "./assets/registry";

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
import type { AssetRegistry } from "./assets/registry";
import type { EngineServer } from "./server";

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
import { AssetRegistry } from "./assets/registry";
import { EngineServer } from "./server";
import { startTickLoop } from "./loop";
import { createPriceFeed } from "./feeds/twelve-data";

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

## Task 7: Chart in the web app — with WebSocket tickets and the auth race fixed

> **Revised 2026-09-14** (pre-execution review against the real Task 1–6 code). The original
> Task 7 had four real defects, each fixed below:
>
> 1. **Auth race.** The client sent `subscribe` immediately after `auth`. The server handles
>    each message with an un-awaited async handler, so `subscribe` was processed while the
>    `auth` DB lookup was still pending — `client.userId` was still null and the reply was
>    `Authenticate first.` The chart would never load on a fast connection. Fixed on both
>    sides: the server serialises each socket's messages, sends an explicit `authed`
>    message, and the client subscribes only after receiving it.
> 2. **The httpOnly session token was handed to page JavaScript** (both as a prop rendered
>    into the RSC payload and via a token endpoint), which defeats `httpOnly` entirely.
>    Replaced with a one-time, 30-second WebSocket ticket stored in Redis and redeemed by
>    the engine with `GETDEL`.
> 3. **The live tick painted into the previous minute's candle.** `candles` only ever holds
>    CLOSED candles, and each tick updated `candles[last]`. A forming candle is now built
>    from ticks, bucketed by the tick's own timestamp, in a pure reducer with unit tests.
> 4. **Two sockets per page later.** `PriceChart` opened its own socket, and Plan 03's
>    workspace would open a second. The chart is now presentational; one hook owns the
>    socket and exposes every message through `onMessage` so later plans extend it without
>    a second connection.

**Files:**
- Create: `apps/engine/src/auth/ws-ticket.ts`, `apps/engine/src/auth/ws-ticket.test.ts`, `apps/engine/src/server.test.ts`, `apps/engine/vitest.config.ts`
- Create: `apps/web/src/lib/ws-ticket.ts`, `apps/web/src/lib/ws-ticket.test.ts`, `apps/web/src/app/api/auth/ws-ticket/route.ts`, `apps/web/src/app/api/auth/ws-ticket/route.test.ts`
- Create: `apps/web/src/components/chart/engine-state.ts`, `apps/web/src/components/chart/engine-state.test.ts`, `apps/web/src/components/chart/useEngineSocket.ts`, `apps/web/src/components/chart/PriceChart.tsx`, `apps/web/src/components/chart/LiveChart.tsx`
- Modify: `packages/contracts/src/ws.ts`, `packages/contracts/src/index.ts`, `apps/engine/src/server.ts`, `apps/engine/src/main.ts`, `apps/engine/package.json`, `apps/web/package.json`, `apps/web/src/app/(platform)/trade/page.tsx`

**Interfaces:**
- Consumes: `ServerMessage`, `CandleDto`, `Timeframe` from `@asm/contracts`; `AssetRegistry` and `EngineServer` from Task 6; `redis`, `checkRateLimit`, `readSession`, `requestContext` from Plan 01
- Produces:
  - `AuthedMessage = { type: "authed" }` in the `ServerMessage` union
  - `type Authenticate = (ticket: string) => Promise<string | null>` — injected into `new EngineServer(registry, port, authenticate)`
  - `EngineServer.ready(): Promise<void>` and `EngineServer.port(): number`
  - `createTicketAuthenticator(redis): Authenticate` (engine) and `issueWsTicket(userId): Promise<string>` (web)
  - `POST /api/auth/ws-ticket` → `200 { ticket }`
  - `applyChartMessage(state, message): ChartState`, `initialChartState(symbol, timeframe)`
  - `useEngineSocket({ symbol, timeframe, onMessage? }): { status: SocketStatus; chart: ChartState }`
  - `<PriceChart candles forming precision />` (presentational) and `<LiveChart symbol displayName precision />`

**Why a ticket rather than the session token.** Browsers cannot read an `httpOnly` cookie and
cannot set headers on a WebSocket handshake, so *something* must reach page JavaScript. Handing
over the session token itself turns any XSS into a 7-day account takeover. A ticket is random,
single-use, valid for 30 seconds, and authorises nothing except one socket handshake.

- [ ] **Step 1: Add the `authed` message to `packages/contracts/src/ws.ts`**

Add after `ErrorMessage`:

```ts
/** Sent once, after a ticket is accepted. Clients subscribe only after receiving it. */
export interface AuthedMessage {
  type: "authed";
}
```

Add `| AuthedMessage` to the `ServerMessage` union, and `type AuthedMessage,` to the `./ws`
export block in `packages/contracts/src/index.ts`.

- [ ] **Step 2: Add engine dependencies and `.env` loading**

```bash
pnpm --filter @asm/engine add ioredis@5.9.0
pnpm --filter @asm/engine add -D dotenv-cli@10.0.0
```

In `apps/engine/package.json`, change the two run scripts so a bare `pnpm dev:engine` loads the
repo `.env` (closes the deferred "engine has no .env auto-loading" gap from Task 6):

```json
"dev": "dotenv -e ../../.env -- tsx watch src/main.ts",
"start": "dotenv -e ../../.env -- tsx src/main.ts",
```

Leave `"test"` unchanged — the root test script (Task 8) supplies the environment.

- [ ] **Step 3: Write `apps/engine/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // registry.test.ts and server.test.ts share one real Postgres test DB.
    fileParallelism: false,
  },
});
```

- [ ] **Step 4: Write the failing ticket-key test**

Create `apps/engine/src/auth/ws-ticket.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ticketKey } from "./ws-ticket";

describe("ticketKey", () => {
  it("derives the Redis key from the sha256 of the ticket", () => {
    // The same literal is pinned in apps/web/src/lib/ws-ticket.test.ts.
    // If either side changes its derivation, both tests must change together.
    expect(ticketKey("fixture-ticket")).toBe(
      "ws:ticket:26152d453a0f9a9c4528463c1ce383dea7b43fbfac71b6f5446228ac05e52d38",
    );
  });
});
```

- [ ] **Step 5: Write `apps/engine/src/auth/ws-ticket.ts`**

```ts
import { createHash } from "node:crypto";
import type Redis from "ioredis";

/**
 * Must match apps/web/src/lib/ws-ticket.ts. The ticket itself never touches
 * Redis — only its hash — so a Redis dump yields nothing redeemable.
 */
export function ticketKey(ticket: string): string {
  return `ws:ticket:${createHash("sha256").update(ticket).digest("hex")}`;
}

/**
 * Redeems a one-time ticket minted by the web app. GETDEL is atomic, so two
 * sockets racing to redeem the same ticket cannot both succeed.
 */
export function createTicketAuthenticator(
  redis: Redis,
): (ticket: string) => Promise<string | null> {
  return async (ticket) => redis.getdel(ticketKey(ticket));
}
```

Run `pnpm --filter @asm/engine exec vitest run src/auth/ws-ticket.test.ts` — expected PASS.

- [ ] **Step 6: Write the failing server test**

Create `apps/engine/src/server.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { prisma } from "@asm/db";
import { AssetRegistry } from "./assets/registry";
import { EngineServer } from "./server";

interface Reply {
  type: string;
  message?: string;
  candles?: Record<string, unknown>[];
}

const registry = new AssetRegistry(99);
let server: EngineServer;
let url = "";

beforeAll(async () => {
  await registry.load();
  // Port 0 = any free port. The authenticator is injected, so this test needs
  // no Redis: one known ticket maps to one user id.
  server = new EngineServer(registry, 0, async (ticket) =>
    ticket === "good-ticket" ? "user-under-test" : null,
  );
  await server.ready();
  url = `ws://127.0.0.1:${server.port()}`;
});

afterAll(async () => {
  await server.stop();
  await prisma.$disconnect();
});

/**
 * Opens a socket, sends every message back-to-back the instant it opens, and
 * collects replies until `count` arrive, the socket closes, or 3s pass.
 */
function exchange(
  messages: unknown[],
  count: number,
): Promise<{ replies: Reply[]; closeCode: number | null }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const replies: Reply[] = [];
    let closeCode: number | null = null;
    const finish = () => resolve({ replies, closeCode });
    const timer = setTimeout(() => {
      socket.terminate();
      finish();
    }, 3000);

    socket.on("open", () => {
      for (const message of messages) socket.send(JSON.stringify(message));
    });
    socket.on("message", (raw: WebSocket.RawData) => {
      replies.push(JSON.parse(raw.toString()) as Reply);
      if (replies.length >= count) {
        clearTimeout(timer);
        socket.close();
        finish();
      }
    });
    socket.on("close", (code: number) => {
      closeCode = code;
      clearTimeout(timer);
      finish();
    });
    socket.on("error", reject);
  });
}

describe("EngineServer", () => {
  it("processes a subscribe sent immediately after auth, without waiting for a reply", async () => {
    const { replies } = await exchange(
      [
        { type: "auth", token: "good-ticket" },
        { type: "subscribe", symbol: "AUDNZD_OTC", timeframe: "1m" },
      ],
      4,
    );
    expect(replies.map((r) => r.type)).toEqual([
      "ready",
      "authed",
      "candles:history",
      "payout:update",
    ]);
  });

  it("refuses to subscribe before authenticating", async () => {
    const { replies } = await exchange(
      [{ type: "subscribe", symbol: "AUDNZD_OTC", timeframe: "1m" }],
      2,
    );
    expect(replies[1]).toEqual({ type: "error", message: "Authenticate first." });
  });

  it("closes the socket with 1008 on an unknown ticket", async () => {
    const { replies, closeCode } = await exchange([{ type: "auth", token: "forged" }], 2);
    expect(replies[1]).toEqual({ type: "error", message: "Session expired." });
    expect(closeCode).toBe(1008);
  });

  it("rejects a message with an unknown type", async () => {
    const { replies } = await exchange([{ type: "hack" }], 2);
    expect(replies[1]).toEqual({ type: "error", message: "Unrecognised message." });
  });

  it("sends only OHLC fields in candle history — never shadow columns", async () => {
    const { replies } = await exchange(
      [
        { type: "auth", token: "good-ticket" },
        { type: "subscribe", symbol: "AUDNZD_OTC", timeframe: "1m" },
      ],
      3,
    );
    const history = replies.find((r) => r.type === "candles:history");
    for (const candle of history?.candles ?? []) {
      expect(Object.keys(candle).sort()).toEqual(["c", "h", "l", "o", "openTs"]);
    }
  });
});
```

Run it with the test DB:

```bash
set -a && source .env && set +a && \
  DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm --filter @asm/engine exec vitest run src/server.test.ts
```

Expected: FAIL — the constructor does not accept an authenticator and `ready`/`port` do not exist.

- [ ] **Step 7: Modify `apps/engine/src/server.ts`**

Make these changes, keeping everything else from Task 6 as it is:

1. Remove the `createHash` import, the `hashToken` function, and the `prisma.session` lookup.
   Keep the `prisma` import — candle history still needs it.
2. Export the authenticator type and add a per-client promise chain:

```ts
/** Resolves a one-time ticket to a user id, or null. Injected so tests need no Redis. */
export type Authenticate = (ticket: string) => Promise<string | null>;

interface Client {
  socket: WebSocket;
  userId: string | null;
  subscriptions: Map<string, Timeframe>;
  cid: string;
  messageBudget: number;
  /** Messages from one socket are handled strictly in arrival order. */
  queue: Promise<void>;
}
```

3. Change the constructor to take the authenticator, and add `ready()` / `port()`:

```ts
  private readonly listening: Promise<void>;

  constructor(
    private readonly registry: AssetRegistry,
    port: number,
    private readonly authenticate: Authenticate,
  ) {
    this.wss = new WebSocketServer({ port });
    this.listening = new Promise((resolve) => this.wss.once("listening", () => resolve()));
    this.wss.on("connection", (socket) => this.onConnection(socket));

    this.budgetTimer = setInterval(() => {
      for (const client of this.clients) {
        client.messageBudget = MESSAGE_BUDGET_PER_WINDOW;
      }
    }, BUDGET_WINDOW_MS);

    void this.listening.then(() =>
      logger.info({ evt: "engine.ws_listening", port: this.port() }, "websocket server listening"),
    );
  }

  ready(): Promise<void> {
    return this.listening;
  }

  port(): number {
    const address = this.wss.address();
    return typeof address === "object" && address !== null ? address.port : 0;
  }
```

4. In `onConnection`, initialise `queue: Promise.resolve()`, and replace the `message` handler.
   The budget is now charged **on arrival**, before queueing — charging it inside the handler
   would let a flood queue unbounded work before the first check ran:

```ts
    socket.on("message", (raw) => {
      if (client.messageBudget-- <= 0) {
        childLogger(client.cid).warn(
          { evt: "security.rate_limited", channel: "ws" },
          "message budget exceeded",
        );
        client.socket.close(1008, "Too many messages");
        return;
      }
      client.queue = client.queue
        .then(() => this.onMessage(client, raw.toString()))
        .catch((err: unknown) => {
          childLogger(client.cid).error(
            { evt: "engine.ws_handler_failed", reason: err instanceof Error ? err.message : "unknown" },
            "ws message handler failed",
          );
        });
    });
```

5. In `onMessage`, delete the budget block at the top (it moved), and replace the `auth` branch:

```ts
    if (message.type === "auth") {
      if (client.userId) {
        this.send(client, { type: "error", message: "Already authenticated." });
        return;
      }

      const userId = await this.authenticate(message.token);
      if (!userId) {
        this.send(client, { type: "error", message: "Session expired." });
        client.socket.close(1008, "Unauthorised");
        return;
      }

      client.userId = userId;
      log.info({ evt: "engine.ws_authed", userId }, "socket authed");
      this.send(client, { type: "authed" });
      return;
    }
```

6. Select only OHLC columns for history, so the Plan 04 shadow columns can never be read
   into memory on this path, let alone serialised:

```ts
    const history = await prisma.candle.findMany({
      where: { assetId: asset.id, timeframe: message.timeframe },
      orderBy: { openTs: "desc" },
      take: HISTORY_CANDLES,
      select: { openTs: true, o: true, h: true, l: true, c: true },
    });
```

The close reason string `"Unauthorised"` is load-bearing: the browser hook stops reconnecting
on it, but does reconnect after `"Too many messages"`.

Re-run the Step 6 command. Expected: PASS — 5 tests.

- [ ] **Step 8: Wire Redis into `apps/engine/src/main.ts`**

```ts
import Redis from "ioredis";
import { config } from "@asm/config";
import { createTicketAuthenticator } from "./auth/ws-ticket";
```

```ts
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  const server = new EngineServer(registry, WS_PORT, createTicketAuthenticator(redis));
  await server.ready();
```

And in `shutdown`, after `await server.stop();`:

```ts
    await redis.quit();
```

- [ ] **Step 9: Write the web ticket issuer and its key-derivation test**

Create `apps/web/src/lib/ws-ticket.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { wsTicketKey } from "./ws-ticket";

describe("wsTicketKey", () => {
  it("matches the engine's derivation exactly", () => {
    // Same literal as apps/engine/src/auth/ws-ticket.test.ts.
    expect(wsTicketKey("fixture-ticket")).toBe(
      "ws:ticket:26152d453a0f9a9c4528463c1ce383dea7b43fbfac71b6f5446228ac05e52d38",
    );
  });
});
```

Create `apps/web/src/lib/ws-ticket.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import { redis } from "./redis";

export const WS_TICKET_TTL_SEC = 30;

/** Must match apps/engine/src/auth/ws-ticket.ts — both sides derive the same key. */
export function wsTicketKey(ticket: string): string {
  return `ws:ticket:${createHash("sha256").update(ticket).digest("hex")}`;
}

/** Mints a single-use ticket that lets exactly one socket authenticate as this user. */
export async function issueWsTicket(userId: string): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  await redis.set(wsTicketKey(ticket), userId, "EX", WS_TICKET_TTL_SEC);
  return ticket;
}
```

- [ ] **Step 10: Write the ticket route test**

Create `apps/web/src/app/api/auth/ws-ticket/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { wsTicketKey } from "@/lib/ws-ticket";
import { POST } from "./route";

let userId = "";
let sessionToken = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `ws-ticket-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  sessionToken = await createSession(userId, {});
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.quit();
});

function request(cookie: string | null): NextRequest {
  const headers: Record<string, string> = { "x-forwarded-for": randomUUID() };
  if (cookie) headers["cookie"] = `${SESSION_COOKIE}=${cookie}`;
  return new NextRequest("http://localhost/api/auth/ws-ticket", { method: "POST", headers });
}

describe("POST /api/auth/ws-ticket", () => {
  it("refuses a request with no session", async () => {
    expect((await POST(request(null))).status).toBe(401);
  });

  it("issues a single-use ticket bound to the caller, without exposing the session token", async () => {
    const res = await POST(request(sessionToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const { ticket } = (await res.json()) as { ticket: string };
    expect(ticket).not.toBe(sessionToken);
    expect(await redis.get(wsTicketKey(ticket))).toBe(userId);
    expect(await redis.ttl(wsTicketKey(ticket))).toBeLessThanOrEqual(30);
  });
});
```

Deleting the user cascades its sessions, so no separate session cleanup is needed.

- [ ] **Step 11: Write `apps/web/src/app/api/auth/ws-ticket/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { issueWsTicket } from "@/lib/ws-ticket";

/**
 * Mints a one-time WebSocket ticket for the signed-in caller. POST, not GET:
 * it creates server-side state, and must never be cached or prefetched.
 */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Each reconnect mints one ticket; 30 a minute is generous for backoff and
  // still bounds a script hammering the endpoint.
  if (!(await checkRateLimit(`rl:ws_ticket:${session.userId}`, 30, 60))) {
    log.warn({ evt: "security.rate_limited", route: "ws_ticket" }, "ws ticket throttled");
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const ticket = await issueWsTicket(session.userId);
  return NextResponse.json({ ticket }, { headers: { "Cache-Control": "no-store" } });
}
```

Run:

```bash
set -a && source .env && set +a && \
  DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm --filter @asm/web exec vitest run src/lib/ws-ticket.test.ts src/app/api/auth/ws-ticket
```

Expected: PASS — 3 tests.

- [ ] **Step 12: Write the failing chart-state test**

Create `apps/web/src/components/chart/engine-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CandleDto, ServerMessage } from "@asm/contracts";
import { applyChartMessage, initialChartState } from "./engine-state";

const MIN = 1_757_534_280; // a minute boundary

function candle(openTs: number, c = 1.1): CandleDto {
  return { openTs, o: 1.1, h: 1.2, l: 1.0, c };
}

function fold(messages: ServerMessage[]) {
  return messages.reduce(applyChartMessage, initialChartState("AUDNZD_OTC", "1m"));
}

describe("applyChartMessage", () => {
  it("replaces candles with history and caps them at 500", () => {
    const candles = Array.from({ length: 600 }, (_, i) => candle(MIN + i * 60));
    const state = fold([{ type: "candles:history", symbol: "AUDNZD_OTC", timeframe: "1m", candles }]);
    expect(state.candles).toHaveLength(500);
    expect(state.candles.at(-1)?.openTs).toBe(MIN + 599 * 60);
  });

  it("ignores every message for a different symbol", () => {
    const state = fold([
      { type: "tick", symbol: "EURUSD_OTC", price: 9, ts: MIN },
      { type: "payout:update", symbol: "EURUSD_OTC", payoutPct: 10 },
      { type: "candle:close", symbol: "EURUSD_OTC", timeframe: "1m", candle: candle(MIN) },
    ]);
    expect(state.forming).toBeNull();
    expect(state.payoutPct).toBeNull();
    expect(state.candles).toEqual([]);
  });

  it("opens a forming candle in the tick's own minute bucket", () => {
    const state = fold([{ type: "tick", symbol: "AUDNZD_OTC", price: 1.17, ts: MIN + 17 }]);
    expect(state.forming).toEqual({ openTs: MIN, o: 1.17, h: 1.17, l: 1.17, c: 1.17 });
    expect(state.lastPrice).toBe(1.17);
  });

  it("extends high, low and close for ticks in the same bucket", () => {
    const state = fold([
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.17, ts: MIN + 1 },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.19, ts: MIN + 2 },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.16, ts: MIN + 3 },
    ]);
    expect(state.forming).toEqual({ openTs: MIN, o: 1.17, h: 1.19, l: 1.16, c: 1.16 });
  });

  it("starts a fresh forming candle when a tick crosses into the next bucket", () => {
    const state = fold([
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.17, ts: MIN + 59 },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.18, ts: MIN + 60 },
    ]);
    expect(state.forming?.openTs).toBe(MIN + 60);
    expect(state.forming?.o).toBe(1.18);
  });

  it("appends a closed candle, de-duplicates by openTs, and clears the forming candle it closed", () => {
    const state = fold([
      { type: "candles:history", symbol: "AUDNZD_OTC", timeframe: "1m", candles: [candle(MIN - 60)] },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.17, ts: MIN + 5 },
      { type: "candle:close", symbol: "AUDNZD_OTC", timeframe: "1m", candle: candle(MIN, 1.1) },
      { type: "candle:close", symbol: "AUDNZD_OTC", timeframe: "1m", candle: candle(MIN, 1.15) },
    ]);
    expect(state.candles.map((c) => c.openTs)).toEqual([MIN - 60, MIN]);
    expect(state.candles.at(-1)?.c).toBe(1.15);
    expect(state.forming).toBeNull();
  });

  it("updates only lastPrice for a late tick in an already-closed bucket", () => {
    const state = fold([
      { type: "candle:close", symbol: "AUDNZD_OTC", timeframe: "1m", candle: candle(MIN) },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.3, ts: MIN + 30 },
    ]);
    expect(state.forming).toBeNull();
    expect(state.lastPrice).toBe(1.3);
  });

  it("records the payout for its own symbol", () => {
    expect(fold([{ type: "payout:update", symbol: "AUDNZD_OTC", payoutPct: 92 }]).payoutPct).toBe(92);
  });
});
```

Run `pnpm --filter @asm/web exec vitest run src/components/chart/engine-state.test.ts` — expected
FAIL, `./engine-state` does not exist. (This file touches neither Postgres nor Redis.)

- [ ] **Step 13: Write `apps/web/src/components/chart/engine-state.ts`**

```ts
import type { CandleDto, ServerMessage, Timeframe } from "@asm/contracts";

export const TIMEFRAME_SEC: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900 };
const MAX_CANDLES = 500;

export interface ChartState {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Closed candles, oldest first. */
  readonly candles: CandleDto[];
  /** The candle for the current bucket, built from ticks. Never part of `candles`. */
  readonly forming: CandleDto | null;
  readonly lastPrice: number | null;
  readonly payoutPct: number | null;
}

export function initialChartState(symbol: string, timeframe: Timeframe): ChartState {
  return { symbol, timeframe, candles: [], forming: null, lastPrice: null, payoutPct: null };
}

/**
 * Folds one server message into chart state. Pure, so the candle logic is
 * unit-tested rather than eyeballed on a live chart.
 *
 * Messages for another symbol are ignored — after an asset switch, a tick
 * already in flight for the old asset must not paint onto the new chart.
 */
export function applyChartMessage(state: ChartState, message: ServerMessage): ChartState {
  switch (message.type) {
    case "candles:history": {
      if (message.symbol !== state.symbol || message.timeframe !== state.timeframe) return state;
      const candles = message.candles.slice(-MAX_CANDLES);
      const last = candles.at(-1);
      const forming = state.forming && last && state.forming.openTs <= last.openTs ? null : state.forming;
      return { ...state, candles, forming };
    }

    case "candle:close": {
      if (message.symbol !== state.symbol || message.timeframe !== state.timeframe) return state;
      const candles = [
        ...state.candles.filter((c) => c.openTs !== message.candle.openTs),
        message.candle,
      ]
        .sort((a, b) => a.openTs - b.openTs)
        .slice(-MAX_CANDLES);
      const forming =
        state.forming && state.forming.openTs <= message.candle.openTs ? null : state.forming;
      return { ...state, candles, forming };
    }

    case "tick": {
      if (message.symbol !== state.symbol) return state;
      const width = TIMEFRAME_SEC[state.timeframe];
      const openTs = Math.floor(message.ts / width) * width;
      const last = state.candles.at(-1);

      // The bucket has already closed; drawing it again would reopen history.
      if (last && openTs <= last.openTs) return { ...state, lastPrice: message.price };

      const forming =
        state.forming && state.forming.openTs === openTs
          ? {
              ...state.forming,
              h: Math.max(state.forming.h, message.price),
              l: Math.min(state.forming.l, message.price),
              c: message.price,
            }
          : { openTs, o: message.price, h: message.price, l: message.price, c: message.price };

      return { ...state, forming, lastPrice: message.price };
    }

    case "payout:update":
      return message.symbol === state.symbol ? { ...state, payoutPct: message.payoutPct } : state;

    default:
      return state;
  }
}
```

Re-run the Step 12 command. Expected: PASS — 8 tests.

- [ ] **Step 14: Add the chart dependency**

```bash
pnpm --filter @asm/web add lightweight-charts@5.2.1
```

- [ ] **Step 15: Write `apps/web/src/components/chart/useEngineSocket.ts`**

```ts
"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { ServerMessage, Timeframe } from "@asm/contracts";
import { applyChartMessage, initialChartState, type ChartState } from "./engine-state";

export type SocketStatus = "connecting" | "open" | "closed" | "unauthorised";

const WS_URL = process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? "ws://localhost:4001";
const MAX_BACKOFF_MS = 15_000;

type Action =
  | { kind: "message"; message: ServerMessage }
  | { kind: "reset"; symbol: string; timeframe: Timeframe };

function reducer(state: ChartState, action: Action): ChartState {
  if (action.kind === "message") return applyChartMessage(state, action.message);
  if (state.symbol === action.symbol && state.timeframe === action.timeframe) return state;
  return initialChartState(action.symbol, action.timeframe);
}

async function fetchTicket(): Promise<string | null> {
  const res = await fetch("/api/auth/ws-ticket", { method: "POST", cache: "no-store" }).catch(
    () => null,
  );
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { ticket?: string };
  return body.ticket ?? null;
}

/**
 * The page's single connection to the engine.
 *
 * The socket's lifetime is independent of the symbol: switching assets sends
 * unsubscribe/subscribe on the open socket instead of reconnecting. Every
 * server message is folded into chart state AND handed to `onMessage`, which
 * is how later plans (trades, balances, sentiment) extend this hook without
 * opening a second socket.
 */
export function useEngineSocket(opts: {
  symbol: string;
  timeframe: Timeframe;
  onMessage?: (message: ServerMessage) => void;
}): { status: SocketStatus; chart: ChartState } {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [chart, dispatch] = useReducer(reducer, initialChartState(opts.symbol, opts.timeframe));

  const socketRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(opts.onMessage);

  // Always call the latest callback without reconnecting when it changes.
  useEffect(() => {
    onMessageRef.current = opts.onMessage;
  });

  useEffect(() => {
    let closedByUs = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      attempt += 1;
      // Jitter from crypto rather than Math.random, which the lint gate bans.
      const jitter = crypto.getRandomValues(new Uint32Array(1))[0]! % 400;
      reconnectTimer = setTimeout(() => void connect(), Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt + jitter));
    };

    const connect = async (): Promise<void> => {
      setStatus("connecting");
      const ticket = await fetchTicket();
      if (closedByUs) return;
      if (!ticket) {
        setStatus("unauthorised");
        return;
      }

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token: ticket }));

      socket.onmessage = (event: MessageEvent<string>) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === "authed") {
          attempt = 0;
          setStatus("open");
        }
        dispatch({ kind: "message", message });
        onMessageRef.current?.(message);
      };

      socket.onclose = (event: CloseEvent) => {
        socketRef.current = null;
        if (closedByUs) return;
        if (event.reason === "Unauthorised") {
          setStatus("unauthorised");
          return;
        }
        setStatus("closed");
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  // Subscription follows the symbol. Re-runs on every (re)authentication, so a
  // reconnect resubscribes and receives fresh history.
  useEffect(() => {
    dispatch({ kind: "reset", symbol: opts.symbol, timeframe: opts.timeframe });
    const socket = socketRef.current;
    if (status !== "open" || !socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({ type: "subscribe", symbol: opts.symbol, timeframe: opts.timeframe }));
    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "unsubscribe", symbol: opts.symbol }));
      }
    };
  }, [opts.symbol, opts.timeframe, status]);

  return { status, chart };
}
```

- [ ] **Step 16: Write `apps/web/src/components/chart/PriceChart.tsx`**

Presentational only — it receives data and draws it, and never opens a socket.

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CandleDto } from "@asm/contracts";

function toBar(c: CandleDto): CandlestickData {
  return { time: c.openTs as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c };
}

export function PriceChart({
  candles,
  forming,
  precision,
}: {
  candles: CandleDto[];
  forming: CandleDto | null;
  precision: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Bumped whenever the chart is (re)created so the data effects re-apply.
  const [chartVersion, setChartVersion] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0e1621" },
        textColor: "#93a2b4",
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#1c2836" }, horzLines: { color: "#1c2836" } },
      rightPriceScale: { borderColor: "#253243" },
      timeScale: { borderColor: "#253243", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#2fbd85",
      downColor: "#e0526a",
      wickUpColor: "#2fbd85",
      wickDownColor: "#e0526a",
      borderVisible: false,
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });
    setChartVersion((v) => v + 1);

    return () => {
      chart.remove();
      seriesRef.current = null;
    };
  }, [precision]);

  useEffect(() => {
    seriesRef.current?.setData(candles.map(toBar));
  }, [candles, chartVersion]);

  // lightweight-charts throws if update() is given a time older than the last
  // bar, so the forming candle is drawn only once it is strictly newer.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !forming) return;
    const last = candles.at(-1);
    if (last && forming.openTs <= last.openTs) return;
    series.update(toBar(forming));
  }, [forming, candles, chartVersion]);

  return <div ref={containerRef} className="h-[420px] w-full" />;
}
```

- [ ] **Step 17: Write `apps/web/src/components/chart/LiveChart.tsx`**

```tsx
"use client";

import { useEngineSocket } from "./useEngineSocket";
import { PriceChart } from "./PriceChart";

export function LiveChart({
  symbol,
  displayName,
  precision,
}: {
  symbol: string;
  displayName: string;
  precision: number;
}) {
  const { status, chart } = useEngineSocket({ symbol, timeframe: "1m" });

  return (
    <div className="flex flex-col gap-2">
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
    </div>
  );
}
```

- [ ] **Step 18: Replace `apps/web/src/app/(platform)/trade/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, listAccountsForActor, prisma } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { LiveChart } from "@/components/chart/LiveChart";

export default async function TradePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  // Scoped by actor — this page cannot render another user's accounts.
  const [accounts, asset] = await Promise.all([
    listAccountsForActor(session.userId),
    prisma.asset.findUnique({
      where: { symbol: "AUDNZD_OTC" },
      select: { symbol: true, displayName: true, precision: true },
    }),
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
            <LiveChart symbol={asset.symbol} displayName={asset.displayName} precision={asset.precision} />
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
          <p className="text-xs text-[var(--color-ink-2)]">Trade ticket arrives in Plan 03.</p>
        </aside>
      </div>
    </main>
  );
}
```

No token is read or passed anywhere on this page.

- [ ] **Step 19: Verify the chart end to end**

Two terminals:

```bash
pnpm dev:engine
```

```bash
pnpm dev
```

Log in and open `http://localhost:3000/trade`. Expected: a candlestick chart for **AUD/NZD (OTC)**, a
**Live** pill, the price moving about ten times a second, the right-most candle growing with each
tick, and a new candle each minute that does not redraw the previous one.

In the browser devtools Network tab, confirm the page HTML and RSC payload contain no value of
the `asm_session` cookie, and that `/api/auth/ws-ticket` returns a different ticket on every reload.

- [ ] **Step 20: Verify the socket rejects an unauthenticated subscribe**

```bash
pnpm --filter @asm/engine exec node --input-type=module -e '
import WebSocket from "ws";
const ws = new WebSocket("ws://localhost:4001");
const seen = [];
ws.on("open", () => ws.send(JSON.stringify({type:"subscribe",symbol:"AUDNZD_OTC",timeframe:"1m"})));
ws.on("message", (m) => { seen.push(m.toString()); if (seen.length === 2) { console.log(seen.join("\n")); process.exit(0); } });
'
```

Expected: `{"type":"ready",...}` then `{"type":"error","message":"Authenticate first."}` — never candle data.

- [ ] **Step 21: Commit**

```bash
git add packages/contracts apps/engine apps/web pnpm-lock.yaml
git commit -m "feat: live chart over single-use websocket tickets, auth race fixed"
```

---

## Task 8: Calibration, realism gate, and full verification

> **Revised 2026-09-14.** The original gate tested hand-picked parameters that production never
> uses, and it would have passed while the real engine drew nonsense. Measured on the actual
> Task 6 code with the seeded asset rows: **the per-tick clamp bound on 87% of ticks** and
> 1-minute moves were **36–99 pips** (real FX: 2–3). The clamp, not GARCH, was generating the
> price. The anchor (`0.08` per tick, a sub-second half-life) glued the synthetic price to the
> replay feed's 8-quote loop. Its own tuning advice ("raise `garchAlpha` in the seed") could
> not affect the test, which never read the seed.
>
> This task now calibrates the process from a derivation, migrates the seeded rows, and gates
> the exact parameters the engine runs. Both the calibration and the gate below were executed
> before this plan was revised and pass as written.
>
> Measured with exactly the gate's configuration (replay-stepped anchor, 600 minutes):
>
> | | seed 2026 (the gate) | range over 30 seeds |
> |---|---|---|
> | 1-minute sd | 2.69 pips | 2.47 – 3.26 |
> | kurtosis | 4.02 | 3.72 – 25.1 (none ≤ 3.3) |
> | squared-return lag-1 autocorrelation | 0.174 | −0.009 – 0.471 (4 of 30 ≤ 0.05) |
> | return lag-1 autocorrelation | −0.030 | −0.172 – 0.090 (1 of 30 beyond ±0.15) |
> | ticks hitting the clamp | 0 | 0 on every seed |
> | mean distance from the real quote | 6.6 pips | 5.7 – 8.5 |
>
> The gate is **seed-pinned to 2026 on purpose**: clustering is a finite-sample statistic, so a
> few seeds fall under the threshold. Do not change the seed to make a failing run pass. A
> failure at seed 2026 means the calibration or the tick composer changed.

**Files:**
- Create: `packages/pricing/src/calibration.ts`, `packages/pricing/src/realism.test.ts`, `packages/db/prisma/migrations/<generated>_recalibrate_asset_price_params/migration.sql`, `scripts/test-all.sh`
- Modify: `packages/pricing/src/index.ts`, `apps/engine/src/assets/registry.ts`, `apps/engine/src/assets/registry.test.ts`, `packages/db/prisma/schema.prisma`, `package.json`

**Interfaces:**
- Produces:
  - `DEFAULT_CALIBRATION`, `TICK_DT_SEC`, `MAX_TICK_MOVE_IN_TICKS`
  - `priceParamsFor(asset: AssetCalibration): PriceParams` — the only place an `Asset` row becomes `PriceParams`
  - `perTickSigma(state: PriceState, dtSec?): number` — Plan 04 scales bias and magnet in this unit
  - `pnpm test` that actually works from a bare shell

- [ ] **Step 1: Write `packages/pricing/src/calibration.ts`**

```ts
import type { PriceParams, PriceState } from "./step";

/** The engine ticks at 10 Hz. */
export const TICK_DT_SEC = 0.1;

/** Hard cap on one tick's absolute move, in multiples of the asset's tick size. */
export const MAX_TICK_MOVE_IN_TICKS = 40;

const TARGET_ONE_MINUTE_LOG_SD = 2.5e-4;
const ALPHA = 0.02;
const BETA = 0.9795;
const ANCHOR_HALF_LIFE_SEC = 600;

/**
 * Calibration shared by every seeded asset. All four numbers are log-space,
 * so the same values fit a 1.17 cross and a 157 yen pair.
 *
 * - omega is chosen so the unconditional per-second variance gives a
 *   1-minute log-return sd of 2.5e-4 (~2.5–3 pips on EUR/USD-like prices).
 * - alpha + beta = 0.9995 per tick: volatility regimes persist for about a
 *   minute, which is what makes clustering visible in 1-minute candles. At
 *   0.98 they die within seconds and 1-minute returns look Gaussian.
 * - the anchor pulls toward the real quote with a 10-minute half-life. A 2-minute
 *   half-life leaves a visible mean-reversion signature in 1-minute returns
 *   (lag-1 autocorrelation around −0.16); the original per-tick 0.08 glued the
 *   synthetic price to whichever quote arrived last.
 *
 * The seed's original values (omega 1e-6, alpha 0.08, beta 0.90, anchor 0.08)
 * produced 36–99 pips per minute with the per-tick clamp binding on 87% of
 * ticks — a clamped coin flip, not a GARCH process.
 */
export const DEFAULT_CALIBRATION = {
  garchOmega: ((TARGET_ONE_MINUTE_LOG_SD ** 2) / 60) * (1 - ALPHA - BETA),
  garchAlpha: ALPHA,
  garchBeta: BETA,
  anchorAlpha: Math.LN2 / (ANCHOR_HALF_LIFE_SEC / TICK_DT_SEC),
} as const;

export interface AssetCalibration {
  readonly garchOmega: number;
  readonly garchAlpha: number;
  readonly garchBeta: number;
  readonly anchorAlpha: number;
  readonly tickSize: number;
}

/** The one place an Asset row becomes PriceParams — the engine and the realism gate both call this. */
export function priceParamsFor(asset: AssetCalibration): PriceParams {
  return {
    garch: { omega: asset.garchOmega, alpha: asset.garchAlpha, beta: asset.garchBeta },
    driftPerSec: 0,
    anchorAlpha: asset.anchorAlpha,
    maxTickMove: asset.tickSize * MAX_TICK_MOVE_IN_TICKS,
  };
}

/**
 * Standard deviation of one tick's log shock: sigma·sqrt(dt). This, not the
 * per-second GARCH sigma, is the unit Plan 04's bias and magnet caps are in.
 */
export function perTickSigma(state: PriceState, dtSec: number = TICK_DT_SEC): number {
  return Math.sqrt(state.garch.sigma2) * Math.sqrt(dtSec);
}
```

Append to `packages/pricing/src/index.ts`:

```ts
export {
  DEFAULT_CALIBRATION,
  MAX_TICK_MOVE_IN_TICKS,
  TICK_DT_SEC,
  perTickSigma,
  priceParamsFor,
  type AssetCalibration,
} from "./calibration";
```

- [ ] **Step 2: Write the realism gate**

Create `packages/pricing/src/realism.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CandleAggregator,
  DEFAULT_CALIBRATION,
  TICK_DT_SEC,
  createRng,
  initPriceState,
  priceParamsFor,
  stepPrice,
  type Candle,
} from "./index";

/**
 * The gate runs the calibration the engine ACTUALLY uses — priceParamsFor over
 * DEFAULT_CALIBRATION, anchored to a stepped quote the way the replay feed
 * delivers one every five seconds. A gate over hand-picked parameters proves
 * nothing about production.
 */
const TICK_SIZE = 0.00001;
const PIP = 0.0001;
const params = priceParamsFor({ ...DEFAULT_CALIBRATION, tickSize: TICK_SIZE });
const QUOTES = [1.1735, 1.1738, 1.1731, 1.1742, 1.1739, 1.1745, 1.1741, 1.1736];

interface Run {
  candles: Candle[];
  clampedTicks: number;
  ticks: number;
  meanAnchorDistance: number;
}

function generate(minutes: number, seed: number): Run {
  const rng = createRng(seed);
  const agg = new CandleAggregator(60);
  let state = initPriceState(QUOTES[0]!, params);
  let ts = 1_757_534_280;
  let anchor = QUOTES[0]!;
  const candles: Candle[] = [];
  let clampedTicks = 0;
  let distance = 0;
  const ticks = minutes * 600;

  for (let i = 0; i < ticks; i++) {
    if (i % 50 === 0) anchor = QUOTES[(i / 50) % QUOTES.length]!;
    const before = state.price;
    const step = stepPrice({
      state,
      params,
      dtSec: TICK_DT_SEC,
      z: rng.normal(),
      driftBias: 0,
      magnet: 0,
      anchorTarget: anchor,
    });
    if (Math.abs(Math.abs(step.price - before) - params.maxTickMove) < 1e-12) clampedTicks++;
    state = step.state;
    distance += Math.abs(step.price - anchor);
    if (i % 10 === 0) ts += 1;
    const closed = agg.addTick(ts, Number(step.price.toFixed(5)));
    if (closed) candles.push(closed);
  }
  return { candles, clampedTicks, ticks, meanAnchorDistance: distance / ticks };
}

function logReturns(candles: Candle[]): number[] {
  return candles.slice(1).map((c, i) => Math.log(c.c / candles[i]!.c));
}

describe("synthetic series realism (production calibration)", () => {
  const run = generate(600, 2026);
  const r = logReturns(run.candles);
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  const m2 = r.reduce((s, v) => s + (v - mean) ** 2, 0) / r.length;

  it("produces the expected number of candles", () => {
    expect(run.candles.length).toBeGreaterThan(500);
  });

  it("respects OHLC invariants on every candle", () => {
    for (const c of run.candles) {
      expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c));
      expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c));
    }
  });

  it("moves at a believable FX scale — a few pips per minute", () => {
    const sdPips = (Math.sqrt(m2) * QUOTES[0]!) / PIP;
    expect(sdPips).toBeGreaterThan(1.5);
    expect(sdPips).toBeLessThan(4);
  });

  it("almost never hits the per-tick clamp — the clamp is a guard, not the process", () => {
    expect(run.clampedTicks / run.ticks).toBeLessThan(0.001);
  });

  it("has approximately zero-mean log returns", () => {
    expect(Math.abs(mean)).toBeLessThan(Math.sqrt(m2) * 0.5);
  });

  it("is leptokurtic — fatter tails than a Gaussian", () => {
    const m4 = r.reduce((s, v) => s + (v - mean) ** 4, 0) / r.length;
    expect(m4 / (m2 * m2)).toBeGreaterThan(3.3);
  });

  it("shows volatility clustering in candle returns", () => {
    const sq = r.map((v) => v * v);
    const sm = sq.reduce((s, v) => s + v, 0) / sq.length;
    let cov = 0;
    let varr = 0;
    for (let i = 1; i < sq.length; i++) {
      cov += (sq[i]! - sm) * (sq[i - 1]! - sm);
      varr += (sq[i]! - sm) ** 2;
    }
    expect(cov / varr).toBeGreaterThan(0.05);
  });

  it("leaves no visible mean-reversion signature from the anchor", () => {
    let ac = 0;
    for (let i = 1; i < r.length; i++) ac += (r[i]! - mean) * (r[i - 1]! - mean);
    expect(Math.abs(ac / ((r.length - 1) * m2))).toBeLessThan(0.15);
  });

  it("still tracks the real quote — within a few pips on average", () => {
    expect(run.meanAnchorDistance / PIP).toBeLessThan(15);
  });

  it("never produces a wall of zero-range candles", () => {
    const flat = run.candles.filter((c) => c.h === c.l);
    expect(flat.length / run.candles.length).toBeLessThan(0.02);
  });
});
```

- [ ] **Step 3: Run the pricing suite**

```bash
pnpm --filter @asm/pricing test
```

Expected: PASS, including all 10 realism tests. The suite takes a few seconds; it simulates 360,000 ticks.

If a realism assertion fails, **do not loosen it** — every threshold has measured headroom. Check
that `calibration.ts` matches this plan exactly first.

- [ ] **Step 4: Use `priceParamsFor` in `apps/engine/src/assets/registry.ts`**

Add `priceParamsFor` to the `@asm/pricing` import and replace the inline `params` object in
`load()`:

```ts
      const params: PriceParams = priceParamsFor(row);
```

(`row` is the Prisma `Asset`, which structurally satisfies `AssetCalibration`.)

Add to `apps/engine/src/assets/registry.test.ts`:

```ts
  it("derives each asset's price parameters from its row through priceParamsFor", () => {
    const asset = registry.get("AUDNZD_OTC")!;
    expect(asset.params.maxTickMove).toBeCloseTo(0.00001 * MAX_TICK_MOVE_IN_TICKS, 12);
    expect(asset.params.anchorAlpha).toBeCloseTo(DEFAULT_CALIBRATION.anchorAlpha, 12);
  });
```

with `import { DEFAULT_CALIBRATION, MAX_TICK_MOVE_IN_TICKS } from "@asm/pricing";`. The second
assertion fails until Step 6 migrates the rows. That is expected.

- [ ] **Step 5: Update the schema defaults**

In `packages/db/prisma/schema.prisma`, `model Asset`:

```prisma
  garchOmega  Float     @default(0.000000000000520833333333)
  garchAlpha  Float     @default(0.02)
  garchBeta   Float     @default(0.9795)
  anchorAlpha Float     @default(0.000115524530093)
```

These are `DEFAULT_CALIBRATION`'s values. `seed.ts` never sets these four fields, so new assets pick them up.

- [ ] **Step 6: Create and apply the migration**

```bash
cd packages/db
pnpm exec prisma migrate dev --create-only --name recalibrate_asset_price_params
```

Open the generated `migration.sql`. It contains the `ALTER COLUMN ... SET DEFAULT` statements.
Append:

```sql
-- Existing rows keep their old values unless migrated explicitly. Only rows still carrying the
-- original seed calibration are updated, so an asset an operator has already tuned is left alone.
-- See packages/pricing/src/calibration.ts for the derivation.
UPDATE "Asset"
SET "garchOmega" = 0.000000000000520833333333,
    "garchAlpha" = 0.02,
    "garchBeta" = 0.9795,
    "anchorAlpha" = 0.000115524530093
WHERE "garchOmega" = 0.000001
  AND "garchAlpha" = 0.08
  AND "garchBeta" = 0.9
  AND "anchorAlpha" = 0.08;
```

Apply it to the dev database, then the test database. **Prisma's CLI reads `DATABASE_MIGRATE_URL`**
(see `prisma.config.ts`) — overriding `DATABASE_URL` would silently migrate the dev database twice:

```bash
pnpm exec prisma migrate dev
DATABASE_MIGRATE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec prisma migrate deploy
cd ../..
```

Confirm:

```bash
psql "postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade" \
  -c 'SELECT symbol, "garchAlpha", "garchBeta", "anchorAlpha" FROM "Asset" ORDER BY symbol;'
```

Expected: all three assets at `0.02 / 0.9795 / 0.000115524530093`.

- [ ] **Step 7: Make `pnpm test` work from a bare shell**

This closes a gap two separate final reviews flagged: bare `pnpm test` loads no `.env`, and the
DB suites need the owner role on the test database.

Create `scripts/test-all.sh`:

```bash
#!/usr/bin/env bash
# Runs every workspace test suite against the TEST database.
#
# - Loads the repo .env (REDIS_URL, SESSION_SECRET, relay/admin secrets).
# - Points DATABASE_URL at asm_trade_test as asm_owner: several suites create and
#   drop fixtures, and deposit-matcher.test.ts briefly drops a live index, which
#   the restricted runtime role asm_app cannot do.
# - --workspace-concurrency=1: packages share that one database.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
source .env
set +a

export DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public"
exec pnpm -r --workspace-concurrency=1 test "$@"
```

```bash
chmod +x scripts/test-all.sh
```

In the root `package.json`, change the test script:

```json
"test": "bash scripts/test-all.sh",
```

- [ ] **Step 8: Run the full workspace verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all three clean from a fresh shell with nothing exported. The engine suite now includes
`server.test.ts` (5) and the new registry assertion. The web suite includes the ticket and
chart-state tests.

- [ ] **Step 9: Verify the calibrated engine live**

```bash
pnpm dev:engine
```

Let it run at least three minutes, then:

```bash
psql "postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade" -c "
SELECT a.symbol,
       count(*) AS candles,
       round((avg(c.h - c.l) / power(10, -(a.precision - 1)))::numeric, 2) AS avg_range_pips
FROM \"Candle\" c JOIN \"Asset\" a ON a.id = c.\"assetId\"
WHERE c.\"openTs\" > now() - interval '10 minutes'
GROUP BY a.symbol, a.precision;"
```

Expected: `avg_range_pips` in single digits for every asset (the original calibration produced ~100).

- [ ] **Step 10: Commit**

```bash
git add packages/pricing packages/db apps/engine scripts package.json
git commit -m "feat(pricing): calibrated price process, production realism gate, working pnpm test"
```

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass from a bare shell
- [ ] `pnpm dev:engine` from a bare shell logs `engine.assets_loaded` with `count: 3` and `engine.ws_listening` on 4001
- [ ] With no `TWELVE_DATA_API_KEY`, the engine logs `feed: "replay"` and still ticks
- [ ] `/trade` shows a live candlestick chart. The forming candle grows with each tick, and a new candle each minute leaves the previous one unchanged
- [ ] No session token appears in page HTML, RSC payloads, or any JSON response. The socket authenticates with a single-use ticket
- [ ] `auth` followed immediately by `subscribe` yields `authed` then `candles:history` (automated in `server.test.ts`)
- [ ] An unauthenticated `subscribe` returns `error`, never candle data. An unknown ticket closes the socket with 1008
- [ ] Candle history carries only `openTs/o/h/l/c`
- [ ] The realism gate runs `priceParamsFor(DEFAULT_CALIBRATION)`: clamp binds on <0.1% of ticks, 1-minute sd 1.5–4 pips, kurtosis > 3.3, squared-return autocorrelation > 0.05
- [ ] The seeded assets carry the calibrated values in both the dev and test databases
- [ ] Restarting the engine mid-minute does not error on candle upsert

## What Plan 03 depends on from here

Plan 03 (Trade engine) imports and must not need to change:

- `AssetRegistry` — `get(symbol)` for the live price at trade entry
- `EngineServer.broadcast(symbol, message)`, and the injected `Authenticate` constructor argument
- `startTickLoop` — extended there with a settlement pass, not rewritten
- `stepPrice`'s `driftBias` and `magnet` parameters, still zero until Plan 04
- The `ServerMessage` union in `packages/contracts/src/ws.ts`, extended with trade messages
- `useEngineSocket({ symbol, timeframe, onMessage })` — trade and balance messages arrive through `onMessage`. Never open a second socket
- `PriceChart` as a presentational component taking `candles`, `forming`, `precision`
- `scripts/test-all.sh` via `pnpm test`
- `perTickSigma` — Plan 04's bias and magnet caps are in per-tick sigma units
