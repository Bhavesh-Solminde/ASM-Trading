# Vol-aware magnet + open-time verdict overrides

Date: 2026-10-12
Owner: engine team
Supersedes: the commit-snap and tighten-boost added in commit 5a13667

## Problem

Two layers sit on top of the MSM random walk whenever a trade is open:

1. L3 magnet — per-tick pull toward each trade's stamped target.
2. Commit snap — in the last few seconds, a smoothstep blend eases the shown price toward target, clamped per tick.

Both predate MSM. On an MSM-shaped chart they read as mechanical:

- The magnet pulls at the same strength during quiet MSM stretches where there is no noise to hide behind, producing visible drift.
- The last-30s "tighten" factor doubled the pull across half the trade, giving every stamped trade an obvious bend near expiry.
- The commit snap drew a visible wick on the last candle whenever the chart had drifted far from target.

Separately, the LIVE majority-verdict rule that prevents "mostly LOSS stamps winning anyway because the chart drifted up" lives inside the commit-snap block and would disappear if we remove the snap naïvely.

## Hard invariants (must be preserved)

1. One global chart per asset. Every connected client sees the same candles.
2. Demo trades do not affect the chart. Demos are filtered out of the magnet's position set. Their outcomes are decided in `preSettle` via a chart-independent rule.
3. Chart-as-source-of-truth (PR #49). The database settles every trade at the price the chart showed at expiry. No second pricing path.
4. GLG controller owns verdicts. Treasury health drives `pWin`, capped by per-asset edge margin. The magnet does not decide winners; it steers the chart toward verdicts GLG already decided.

## Goals

- Chart feels organic throughout the trade; no visible "bend near expiry".
- Rapid-fire multi-trade bursts cannot farm wins by lottery.
- Heavy-stake directions in a contested bucket cannot win.
- Treasury mechanism keeps working.

## Non-goals

- Replacing GLG or MSM.
- Changing demo `pWin = 0.75` from the controller.
- Changing the chart cadence (`TICK_DT_SEC = 5`).

## Design

### 1. Vol-aware magnet (replaces current magnet math)

Current magnet pull in `apps/engine/src/loop.ts`:

```
numer += liability * pb * gap * tighten
denom += liability
combined = numer / denom
cap = MAGNET_CAP * sigma
magnetPull = clamp(combined, -cap, cap)
```

New magnet pull:

```
msmScale = sigma / longRunSigma    // 1.0 at long-run vol, >1 busy, <1 quiet
for p of liveNonHonest:
  pb = pathBias(p.pathStyle, elapsedFrac)
  gap = log(p.targetPrice / asset.state.price)
  magnetPull += pb * gap * msmScale
cap = MAGNET_CAP * sigma
magnetPull = clamp(magnetPull, -cap, cap)
```

Changes:

- `msmScale` multiplier: magnet is strong only when MSM is busy enough to hide it.
- Drop liability weighting: for retail scale, one live trade per user per asset is typical.
- Drop `tighten` factor and `MAGNET_WINDOW_SEC` carve-out: steering is continuous across the whole trade.

### 2. Delete commit snap

Remove from `loop.ts`:

- The `COMMIT_WINDOW_SEC`-based block.
- The embedded LIVE majority-verdict rule (reimplemented at open time below).
- The per-trade commit window machinery.
- The smoothstep blend and `MAX_COMMIT_SNAP_MOVE_TICKS` clamp.

Remove from `packages/algo/src/constants.ts`:

- `COMMIT_WINDOW_SEC`
- `MAX_COMMIT_SNAP_MOVE_TICKS`
- `MAGNET_WINDOW_SEC`

### 3. Heavy-side cascade at open time

Replaces the current single-trade value-imbalance override. After GLG stamps a verdict for the new trade, run a cascade over the whole bucket `(assetId, expirySec)`:

```
cascadeHeavySide(bucket):
  loop until stable:
    sum upStake, downStake across non-HONEST trades
    heavy = whichever side has more stake
    light = the other side
    if light side has zero stake: stop
    for every WIN-stamped trade on heavy side: restamp as LOSS
```

Flips every WIN on the heavy side to LOSS, iterating until stable. Demos excluded. Re-stamped trades get `targetPrice` recomputed via `pickStyle` + entry price.

### 4. LIVE batch rule at open time

Group live trades by `(userId, floor(expirySec / TICK_DT_SEC))` — the user's trades expiring in the same 5-second window.

- If batch size < 5: no action.
- If batch size >= 5: count WIN stamps.
  - If `winCount / batchSize >= 0.6`: keep all stamps.
  - Else: re-stamp every WIN in the batch to LOSS (HONEST stays HONEST).

Threshold 0.6 (60%). GLG's `pWin <= 0.38` means batches almost never clear this bar naturally. Casual single-trade users unaffected.

Re-stamped trades persist with new `targetPrice`. Magnet starts steering next tick.

### 5. DEMO rule — unchanged location, updated threshold

The existing demo inverted-majority rule in `trade-desk.preSettle` (trade-desk.ts:556-630) stays where it is — settlement-side, chart-independent (demos must not affect the chart).

- Current threshold: `lossCount * 2 > total` (strict majority, > 50%).
- New threshold: `lossCount / total >= 0.6`.
- Min batch size: `>= 5` (matches live).

Below min batch size: each demo settles by individual stamped verdict.

### 6. Position persistence of re-stamps

New helper `TradeDesk.restampPosition(position, { verdict, pathStyle, targetPrice })` updates in-memory Book and persists to DB. Magnet reads live from in-memory Position each tick.

## Data flow

```
Trade opens
  GLG.decideVerdictGLG → initial verdict
  Heavy-side cascade on bucket → may flip WINs to LOSS
  LIVE batch rule on (userId, expiryTick) → may flip WINs to LOSS
  pickStyle + compute final targetPrice
  stamp Position

Every tick (TICK_DT_SEC = 5)
  MSM advances (shared across all consumers)
  stepPrice runs:
    L1 base (MSM × intraday × news)
    L2 driftBias = 0
    L3 magnet (vol-aware, aggregated over all live non-honest trades on asset)
    L4 anchor = null
    L5 self-anchor (toward honest MSM path)
  One shown price emitted. All clients receive it.

Trade expires (LIVE)
  Settles at chart's close relative to entry (chart-as-source-of-truth)
  No verdict override here. The chart was steered during the trade.

Trade expires (DEMO)
  preSettle demo inverted-majority rule runs on (userId, expirySec):
    if batch >= 5 and losses/total >= 0.6: all LOSS
    else: by individual verdict
  Chart NOT consulted.
```

## Treasury implications

- GLG controller untouched. `pWin` ladder, per-asset edge margin, giveback clamp all keep working.
- Re-stamping at open time shifts settlements toward house favor → treasury accumulates slightly faster → giveback clamp triggers earlier → ladder adjusts down. Self-stabilizes.
- Chart-as-source-of-truth preserved: trades that drift against their re-stamped target still settle on their natural side.

## Testing plan

### Unit tests

- `vol-aware-magnet.test.ts`: msmScale < 1 → pull near 0; msmScale ≈ 1 → pull equals log-gap; msmScale > 1 → pull clamped by `MAGNET_CAP * sigma`.
- `heavy-side-cascade.test.ts`: 3 UP (₹1000 each) + 2 DOWN (₹500 each) → cascade flips all 3 UP WINs to LOSS; HONEST untouched; demos excluded.
- `live-batch-rule.test.ts`:
  - Batch size 1-4 → no action.
  - Batch size 5, 2 WIN → 2/5 = 0.4 < 0.6 → all flip to LOSS.
  - Batch size 5, 3 WIN → 3/5 = 0.6 → keep.
  - Batch size 10, 6 WIN → 6/10 = 0.6 → keep.
  - Batch size 10, 5 WIN → 5/10 = 0.5 < 0.6 → all flip.
- `demo-inverted-majority.test.ts`:
  - Batch size 5, 3 LOSS → 3/5 = 0.6 → all LOSS.
  - Batch size 5, 2 LOSS → 2/5 = 0.4 → each by individual verdict.
- `restamp-position.test.ts`: in-memory + DB updated; magnet reads new target.

### Integration tests

- LIVE user opens 6 UP trades on BTCUSDT in one 5s tick. GLG stamps 2 WIN + 4 LOSS. Batch rule flips all to LOSS at the 5th open. 6th open re-evaluates to all LOSS.
- Two LIVE users, same asset: User A opens 6 UP at s=1; User B opens 6 DOWN at s=3. Separate batches, but heavy-side cascade runs across the whole bucket.
- One DEMO user opens 6 trades: inverted-majority applies at preSettle; chart untouched throughout.

### Dev smoke test

1. From LIVE account, open 6 UP trades of 30s / ₹100 in rapid succession. Expect: batch rule triggers, chart drifts DOWN, all 6 settle LOSS, no visible snap wick.
2. From DEMO account, same thing. Chart untouched. Settlement: 6 WIN stamps likely under pWin=0.75 → 0/6 LOSS < 0.6 → all 6 settle WIN.
3. Watch chart from both accounts: identical candles.
4. Open a single LIVE trade (not batched): behaves per GLG stamp.

Screenshots attached to PR.

## Rollout

- Branch `claude/vol-aware-magnet` off `main`.
- Supersedes PR for `claude/chart-subtle-magnet`.
- Deploy via standard VPS. Engine restart picks up new constants.
- No feature flag. Rollback = revert the merge.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Chart feels too tame | Low–Med | `msmScale` keeps magnet proportional to natural noise |
| Hit rate on single-trade users drops | Low | GLG controller unchanged |
| User detects "every 5th trade I open loses" | Med | Threshold probabilistic; natural GLG variance produces occasional 60%+ WIN batches |
| Treasury overshoots target | Low | Giveback clamp handles it |
| Position DB update race | Low | Open-time overrides run inside openTrade transaction |
