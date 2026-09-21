# Phase 2 · Candle Timeframe Selector (#5b) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans, TDD, checkbox steps.

**Goal:** Offer 1m / 5m / 15m / 1h candles on the chart, produced and persisted by the engine and selectable in the UI.

**Architecture:** The DB already keys `Candle` by `timeframe` and the WS server already serves history/backfill per requested timeframe. Only three things are hardwired to `"1m"`: the engine's live candle *production* (one `CandleAggregator(60)` per asset), the `Timeframe` type, and the client bucket-size map. We give each asset one aggregator per timeframe, broadcast + persist each timeframe's closes, seed the forming candle on subscribe, extend the type, and add a chart selector.

**Tech Stack:** engine (`@asm/engine`), `@asm/pricing` (`CandleAggregator`), `@asm/contracts` (`Timeframe`), `@asm/web` chart.

## Global Constraints
- Timeframes: **1m=60, 5m=300, 15m=900, 1h=3600** seconds. Single source of truth for the list.
- Candles are `{openTs, o, h, l, c}`; `openTs` is the bucket start (epoch seconds); persisted `openTs` is a `DateTime` (`new Date(openTs*1000)`).
- Persist with `upsert` on `(assetId,timeframe,openTs)` (restart-safe), as the 1m path already does.
- No money/trade logic changes. Respect existing WS message contracts.
- Tests: `pnpm --filter @asm/engine test`, `pnpm --filter @asm/contracts test`, `pnpm --filter @asm/web test`.

---

### Task 1: Extend the `Timeframe` type and shared list
**Files:** `packages/contracts/src/ws.ts` (Timeframe type + Zod schema), `apps/web/src/components/chart/engine-state.ts` (`TIMEFRAME_SEC`), add `packages/contracts` export of an ordered `TIMEFRAMES` list + `TIMEFRAME_SEC` map.
- [ ] **Test first (contracts):** the `Timeframe` schema accepts `"1m"|"5m"|"15m"|"1h"` and rejects `"2m"`; `TIMEFRAME_SEC` maps each to 60/300/900/3600; `TIMEFRAMES` is ordered ascending.
- [ ] Extend `Timeframe = "1m" | "5m" | "15m" | "1h"` and its Zod enum; export `TIMEFRAMES` and `TIMEFRAME_SEC`.
- [ ] Update `engine-state.ts` `TIMEFRAME_SEC` to the full map (or import from contracts).
- [ ] Run contracts + web tests.

### Task 2: Multi-timeframe aggregation in the asset registry
**Files:** `apps/engine/src/assets/registry.ts`, `packages/pricing/src/candles.ts` (add a `current()` getter to `CandleAggregator`).
**Interfaces produced:** `registry.tick(...)` returns `closed: { timeframe: Timeframe; candle: Candle }[]` (was `closed: Candle | null`); `registry.formingCandle(symbol, timeframe): Candle | null`.
- [ ] **Test first (pricing):** `CandleAggregator.current()` returns the in-progress `Candle | null` without closing it.
- [ ] Add `current()` to `CandleAggregator` returning `this.forming`.
- [ ] **Test first (engine):** ticking an asset across a 5m boundary yields a closed 5m candle whose OHLC spans the minute closes; a tick mid-bucket closes nothing for 5m/15m/1h.
- [ ] In `ingest`, build `aggregators: Map<Timeframe, CandleAggregator>` (one per `TIMEFRAMES`), each seeded from that timeframe's last persisted close (`findFirst orderBy openTs desc` per timeframe; fall back to 1m's last close, else basePrice).
- [ ] In `tick`, feed the rounded price to every aggregator; collect an array of `{timeframe, candle}` for those that closed.
- [ ] Add `formingCandle(symbol, timeframe)` reading the aggregator's `current()`.
- [ ] Run pricing + engine tests.

### Task 3: Broadcast + persist every timeframe's closes
**Files:** `apps/engine/src/loop.ts`.
- [ ] Replace the single `result.closed` block with a loop over the returned `{timeframe, candle}[]`: broadcast `candle:close` with that `timeframe`, and `upsert` the row with that `timeframe`. Keep the existing error handling per persist.
- [ ] `tick` broadcast (price ticks) is unchanged — ticks are timeframe-agnostic and the client folds them into whichever timeframe it is viewing.
- [ ] Run engine tests; confirm no regression on the 1m path.

### Task 4: Seed the forming candle on subscribe
**Files:** `apps/engine/src/server.ts` (subscribe/history handler), `packages/contracts/src/ws.ts` if a field is added.
Rationale: the client folds live ticks into the current bar, but a client joining mid-bucket on 5m/15m/1h would otherwise show a partial current candle. Seed it from the engine's in-memory aggregator.
- [ ] After sending `candles:history` for `message.timeframe`, if `registry.formingCandle(symbol, timeframe)` is non-null, send it so the client initialises its forming bar. Reuse the existing `candle:close`-shaped payload or append it to the history `candles` array as the last (open) bar — pick whichever the client's `applyChartMessage` already tolerates; add a test in engine-state if the client path changes.
- [ ] **Test (engine-state):** applying a history batch whose last bar equals the forming bar leaves exactly one forming bar (no duplicate) — extend existing `applyChartMessage` tests.
- [ ] Run engine + web tests.

### Task 5: Chart timeframe selector (UI)
**Files:** `apps/web/src/components/chart/` (new `TimeframeTabs.tsx`), `apps/web/src/components/shell/PlatformProvider.tsx` (hold `timeframe` state + `selectTimeframe`), `apps/web/src/components/shell/market-store.ts` (support switching timeframe like symbol switch), `apps/web/src/components/chart/useEngineSocket.ts` (subscribe with selected timeframe), `TradeWorkspace.tsx` (render selector near the "1m candles" legend).
**Interfaces consumed:** `TIMEFRAMES` from contracts.
- [ ] Add `timeframe` + `selectTimeframe` to platform context (default `"1m"`); pass to `useEngineSocket` and `new MarketStore(defaultSymbol, timeframe, assets)`.
- [ ] Add `market.selectTimeframe(tf)` mirroring `selectSymbol` (reset chart state, request history for the new tf). **Test (market-store):** selecting a timeframe resets forming/candles and sets `chart.timeframe`.
- [ ] `TimeframeTabs`: a small segmented control over `TIMEFRAMES`, active styled with brand tokens, calls `selectTimeframe`. Replace the static "1m candles" legend.
- [ ] Verify in preview: switching timeframe reloads history and the live bar forms at the new cadence; no console errors; screenshot each timeframe.

### Task 6: Verification
- [ ] `pnpm --filter @asm/contracts test`, `@asm/pricing test`, `@asm/engine test`, `@asm/web test` all green; `tsc --noEmit` clean in each; lint clean on changed files.
- [ ] Browser: cycle 1m→5m→15m→1h, confirm candle spacing/aggregation and countdown; screenshot.
- [ ] Commit.

## Self-review
- Coverage: type (T1), aggregation (T2), broadcast/persist (T3), forming seed (T4), UI (T5). ✅
- Risk: higher-TF seeding on restart must not double-close; upsert guards it. The forming-seed must not duplicate the last closed bar — covered by T4 test.
