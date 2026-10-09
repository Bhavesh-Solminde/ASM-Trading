# candle-algorithm

A **standalone, detached copy** of the candle-generation algorithm the live
platform uses. Outside the pnpm workspace, outside `apps/` and `packages/`;
installs and runs on its own so you can experiment without touching the
live algorithm.

If you need to change what the live platform does, change the originals in
`packages/pricing/` and `apps/engine/` — the `From:` header at the top of
each source file points at its live twin.

## Install

From this folder:

```bash
npm install
```

## Run

Fast demo — no waiting, produces two hours of synthetic candles instantly
and prints the last 10 of each timeframe:

```bash
npm run example:fast
```

Override seed or duration with env vars:

```bash
SEED=1234 MINUTES=240 npm run example:fast
```

Live-cadence demo — ticks every `TICK_DT_SEC` real seconds (5s by default)
the same way the engine does. Runs for 30 seconds unless you tell it
otherwise:

```bash
npm run example
# or:
DURATION_MS=180000 npm run example   # three minutes
```

Type-check only:

```bash
npm run typecheck
```

## What goes into one candle

Every tick (`TICK_DT_SEC = 5`s by default — see `src/step.ts`) the engine:

1. **Draws a shock.** `createRng(seed).normal()` returns a standard normal
   `z` (`src/rng.ts`).
2. **Updates volatility.** `stepGarch(state, params, z)` advances a
   GARCH(1,1) conditional variance so quiet patches cluster and busy ones
   cluster (`src/garch.ts`).
3. **Composes one tick.** `stepPrice(...)` combines four layers in log
   space, then clamps the realised move (`src/step.ts`):

   | Layer | What it does |
   |-------|--------------|
   | L1 base   | GBM with the GARCH sigma — the honest random walk |
   | L2 drift  | small bounded book-imbalance bias (0 unless the governor is on) |
   | L3 magnet | expiry-convergence pull toward a stamped trade's `targetPrice` |
   | L4 anchor | weak pull toward a real market quote on REAL assets |
   | L5 self-anchor | OTC-only pull toward the asset's own HONEST path |

4. **Records the SHOWN price into every timeframe's candle.**
   `CandleAggregator.addTick(nowSec, shownPrice)` folds the tick into the
   current open bucket; when `floor(ts / timeframeSec)` increments, the
   finished candle is returned and a fresh one starts (`src/candles.ts`).
5. **Broadcasts.** A `tick` goes out every loop iteration; a `candle:close`
   goes out whenever the aggregator closes one. The client folds these into
   its own chart state (`src/client-fold.ts`).

**Candles are built from the SHOWN price, not the pre-governor price.** The
real engine applies a commit-phase snap AFTER `stepPrice` returns to drag
the chart toward a stamped target in the final `COMMIT_WINDOW_SEC` of a
live trade. `registry.record()` is called with the post-snap price so no
closed bar carries a high or low that no viewer ever saw on their live
chart. This standalone copy has no governor, so the snap is a no-op here;
candles are the honest four-layer price.

## File map

| Path | Live twin |
|------|-----------|
| `src/rng.ts`         | `packages/pricing/src/rng.ts` |
| `src/garch.ts`       | `packages/pricing/src/garch.ts` |
| `src/step.ts`        | `packages/pricing/src/step.ts` |
| `src/candles.ts`     | `packages/pricing/src/candles.ts` |
| `src/engine-loop.ts` | `apps/engine/src/loop.ts` + `apps/engine/src/assets/registry.ts` |
| `src/client-fold.ts` | `apps/web/src/components/chart/engine-state.ts` |

## Timeframes

1m is the only timeframe written to the database in the real engine.
5m / 15m / 1h are built on read by `resample(...)` from the stored 1m
candles — see `src/candles.ts`. In the fast example you see all four
closed-candle streams, driven by the four aggregators the registry adds
to each asset.

## Working on this copy

- Tweak `src/step.ts` and watch the shape of candles change in
  `example-fast.ts`.
- Change `TICK_DT_SEC` in `src/step.ts` to tune cadence.
- Add another `registry.add({...})` call in either example to run two
  assets side by side; they will share the RNG stream (one call to
  `rng.normal()` per asset per tick) so their paths are correlated by
  construction.
- The live app does not import from this folder. Nothing you do here
  reaches production.
