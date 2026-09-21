# Trading model rework — plan

Status: **plan only, no code changed.** Covers the three requests:

1. Real-anchored data, BTC + Gold only, scrollable back-history.
2. Zoom in/out stays enabled; only the **default** candle size is tuned to
   look right per screen size.
3. Replace binary "double-or-nothing" with a **leveraged CFD / spot model**:
   live floating P&L, manual close any time, auto-liquidation when the
   position's money hits zero, and an optional user-set take-profit.

> **Scope note:** user-set **stop-loss is out of scope for now** (removed at
> the user's request). Risk is bounded only by auto-liquidation at zero. The
> screenshot's SL line / R:R are therefore not part of this plan yet.

---

## Part A — How leveraged trading actually works (research)

The screenshot is a **CFD / margin-trade** ticket (MetaTrader / cTrader
style), not a binary option. The mechanics:

**Position & size.** A trade has a *size* (lots). 1 standard forex lot =
100,000 units of the base currency; crypto/metals use their own contract
sizes. Notional exposure = `size × contractSize × price`.

**Leverage & margin.** You don't post the full notional — you post *margin*
= `notional / leverage`. At 1:100, a $100k position needs $1,000 margin.
Margin is what's "at risk" and what liquidation is measured against.

**Floating (unrealised) P&L — the number that ticks up and down.**
```
pnl = (currentPrice − entryPrice) × dirSign × size × contractSize
      dirSign = +1 for BUY (long), −1 for SELL (short)
```
Recomputed every tick → this is the live +$9.46 / −$4.16 in the shot.

**Account equity & the stop-out.**
```
equity     = balance + Σ floating pnl of open positions
usedMargin = Σ margin of open positions
marginLevel = equity / usedMargin × 100%
```
Real brokers force-close ("stop-out") when `marginLevel` falls below a
threshold (e.g. 50%). Your simpler rule — **"exit when his money is 0"** —
is the single-position case: liquidate when the floating loss has eaten the
whole margin/stake, i.e. `floatingPnl ≤ −margin`. The **liquidation price**
where that happens is fixed at open:
```
liqPrice = entryPrice − dirSign × (margin / (size × contractSize))
```
For a long, price falling to `liqPrice` ⇒ loss = margin ⇒ auto-close. This
guarantees the trader can never lose more than they staked (no negative
balance), which is what you want.

**Take-profit (optional).** A user-chosen price level in profit: price
touches TP ⇒ close at TP (realise the profit). *Stop-loss is out of scope
for now* — the only downside auto-exit is liquidation at zero.

**Where the house makes money (this replaces the binary payout edge).**
- **Spread**: buy at ask, sell at bid. Every position opens slightly in the
  red by the spread — the broker's baseline revenue.
- **Overnight swap/financing** (optional): a small daily charge on held
  positions.
- **Your price engine's bias**: the existing shown-vs-honest dual path
  (`driftBias`, `magnet`) can still nudge the *shown* price toward the
  liquidation/SL side of a lopsided book. This is the discretionary edge and
  it survives the rework intact.

**Pending orders (BUY LIMIT in the shot).** An order that becomes a market
entry when price reaches a level (LIMIT = better price than now, STOP =
breakout). Nice-to-have; deferred to Phase 3.

## How these sites are built

Authoritative server, dumb client. A real-time feed → an in-memory position
engine that marks every open position to market on each tick and fires
SL/TP/liquidation → a serialised settlement writer → a ledger DB. The client
charts the feed, computes *display-only* floating P&L locally from the tick
stream, and sends intent (open / close / modify SL-TP) — it never decides
money. **Your engine already has this exact shape** (`loop.ts` tick loop,
`TradeDesk` owning positions open→settle, `collectDue` capturing prices with
no I/O, a drain worker persisting settlement). We change *what triggers a
settlement*, not the architecture.

---

## Part B — Mapping onto the current codebase

Today (binary): `TradeDesk` opens a position with a fixed `expirySec`, the
tick loop calls `book.due(nowSec)` to find *time-expired* buckets, and
`outcome.ts` pays `+payoutPct%` or `−stake`. Everything (buckets,
`resolveBucket`, the win-probability controller `TARGETS`, the shadow
ledger) assumes a discrete win/lose at a fixed time.

CFD changes the trigger from **time** to **price**, and the payoff from
**discrete** to **proportional**. Concretely:

### 1. Schema (`packages/db/prisma/schema.prisma`)

`Trade` — add:
- `size Float` (lots) and/or keep `stake Int` as the posted margin.
- `leverage Int`
- `contractSize Float` (snapshot from asset at open)
- `takeProfit Float?` (no `stopLoss` — out of scope for now)
- `liqPrice Float` (computed at open)
- `closedTs DateTime?`, and reuse `exitPrice`, `pnl`.
- Make `expiryTs` nullable (CFD trades have no expiry).

`TradeStatus` — add `CLOSED_MANUAL`, `CLOSED_TP`, `LIQUIDATED`
(keep `OPEN`). Binary `WON/LOST/REFUNDED` stay if Phase 1 ships first.

`Asset` — add `contractSize Float`, `spread Float` (in ticks),
`maxLeverage Int`. New enum value or field for kind = `CRYPTO` / `METAL`.

### 2. Payoff (`packages/trading/src/outcome.ts`)

Add proportional functions beside the binary ones (no stop-loss helper):
```
floatingPnl(dir, entry, current, size, contractSize)  // live, unrounded
liqPrice(dir, entry, margin, size, contractSize)
realisedPnl(dir, entry, exit, size, contractSize)     // floored to minor units, house-favour rounding
```
Keep binary `settlementPnl` for Phase 1 / rollback.

### 3. Position book & risk engine (`packages/trading` + `TradeDesk`)

- `BucketRegistry` (time buckets) is replaced/augmented by a **price-trigger
  book**: for each open position store `{dir, entry, size, liqPrice, tp?}`.
- New per-tick check (runs where `collectDue` runs, still no I/O): for the
  ticked symbol, scan its open positions and collect any where the shown
  price crossed `liqPrice` or `tp`. Capture the exact trigger price
  (use the level itself for TP/liq, not the overshot tick, so fills are
  deterministic). Hand them to the existing drain worker to persist.
- Manual close: new engine entrypoint closes at the current shown price.
- The binary controller (`TARGETS`, `resolveBucket`, `wishFor`) no longer
  gates outcomes — retire it from the CFD path. Bias still flows through
  `driftBias`/`magnet` in `registry.tick`, and the **shadow ledger** keeps
  recording honest-vs-shown realised P&L (compute honest realisedPnl from
  the honest path at close).

### 4. Contracts (`packages/contracts/src`)

- `OpenTradeInput`: add `size`/`leverage`, optional `takeProfit`; drop
  `durationSec` for CFD. (No `stopLoss`.)
- New client actions (these go over **HTTP**, matching the current
  open-trade path — the WS is read-only): `POST /trades/:id/close`,
  `PATCH /trades/:id` (modify TP). Add web routes under
  `apps/web/src/app/api/trades/` and engine routes in `internal-api.ts`
  (currently only `POST /trades`).
- `TradeView`: add `size`, `leverage`, `liqPrice`, `takeProfit`,
  `unrealizedPnl?`.
- New `ServerMessage`s: reuse `trade:settled` for closes; optionally a
  lightweight `positions:mark` is **not needed** — the client computes
  floating P&L locally from the tick stream it already receives.

### 5. Frontend

- **Chart** (`PriceChart.tsx`): the open-trade entry line already exists.
  Add an optional **draggable TP price line** (lightweight-charts price line
  + pointer handler → `PATCH /trades/:id`), a shaded zone (green from entry
  to TP, red from entry down to the liq price), and a live P&L label that
  updates on each tick from `floatingPnl`. *(No SL line.)*
- **Order ticket** (`TradeWorkspace.tsx`): replace stake+duration with
  size/lots, leverage, optional TP, and show computed margin and liq price
  live. Keep Buy/Sell. *(No SL field, no R:R.)*
- **Positions panel**: list open positions with live P&L and a Close button;
  show equity / free margin.
- **Liquidation UX**: when the engine auto-closes, the existing
  `trade:settled` push already updates balance + removes the line.

---

## Part C — Items 1 & 2 (contained, ship first)

**Markets → BTC + Gold, real-anchored** (`seed.ts`, `twelve-data.ts`):
- Reseed assets to `BTCUSD` (kind CRYPTO, precision 1–2, sensible tickSize,
  contractSize) and `XAUUSD` (kind METAL). Remove the three forex rows or
  set `isOpen=false`.
- Twelve Data mapping → `{ BTCUSD: "BTC/USD", XAUUSD: "XAU/USD" }`; with 2
  symbols at 7 req/min each gets a real anchor ~every 17s. **Caveat:** gold
  has market hours (weekends closed) so its anchor freezes then — the
  synthetic path keeps it moving; BTC is 24/7. This stays *anchored
  synthetic* (your choice), so the house edge is intact.

**Real back-history for scroll-left** (two pieces):
- **Backfill at startup**: pull real 1m OHLC from Twelve Data `time_series`
  for BTC/XAU (a few days) and insert into the `candle` table, so genuine
  history exists on day one. Guard the quota (one batched call per symbol at
  boot).
- **Load-older-on-pan**: engine currently sends only the last
  `HISTORY_CANDLES = 120` on subscribe and there is no "fetch older". Add a
  `candles:history` request with a `before` cursor + a matching client
  request fired from `subscribeVisibleLogicalRangeChange` when the user
  nears the left edge; prepend and re-`setData`. Raise the initial window
  too (e.g. 300).

**Good default size per screen, zoom kept** (`PriceChart.tsx`, small):
- **Keep** zoom and pan on (leave `handleScale`/`handleScroll` at their
  defaults) so the user can still pinch/scroll to zoom in and out.
- Only set a **sensible default candle width** per screen size so the chart
  opens looking right: pick a `timeScale.barSpacing` by breakpoint (wider
  candles on phones, tighter on desktop), applied once on load and on
  resize. The user can zoom away from that default freely.
- Container stays responsive via CSS (`autoSize` remains, or explicit
  heights per breakpoint).

---

## Part D — Phasing

- **Phase 1 (interim, ~days):** soft-binary — lower `payoutPct` (e.g. 85)
  and add partial-loss cashback in `outcome.ts` (`LOST` returns a fraction
  of stake). No engine surgery. *This is a bridge, not the destination* —
  the destination is real up/down trades with real P&L, per your note.
- **Phase 2 (the real model, ~weeks):** CFD as in Part B — schema, payoff,
  price-trigger risk engine, close/modify endpoints, chart SL/TP + live P&L,
  positions panel. Retire the binary controller on this path.
- **Phase 3 (later):** pending orders (BUY LIMIT/STOP), partial close, swap
  fees, and — if wanted then — user-set stop-loss / trailing stops.
- Items 1 & 2 (Part C) can ship independently, before or alongside Phase 1.

## Open decisions before Phase 2 coding

1. **Size input**: lots + leverage (broker-style) vs a simple "amount +
   multiplier" (Deriv-style). The latter is friendlier for retail; the shot
   shows lots.
2. **Stop-out rule**: strict single-position "loss = margin" (simplest,
   matches "money is 0") vs account-wide margin-level %.
3. **Spread size** per asset (the main house revenue) — needs a number.
4. Keep Phase-1 binary tables/UI or fully replace at Phase 2 cutover.

### Recommended defaults (2026-09-21 — pending owner sign-off)

1. **Size input → `amount + multiplier` (Deriv-style), not lots.** Money is
   already `Int stake` (minor units); "amount" maps onto it directly, so
   `size = amount × multiplier ÷ entryPrice`. `stake` stays = cash committed
   (= max loss); add `multiplier: Int`. Lots would force per-asset
   contract-size tables (BTC vs Gold) and confuse retail users.
2. **Stop-out → strict single-position "loss = your stake."** Compute
   `liqPrice` at open so the user can never lose more than `stake` — no
   negative balance, no margin calls. SL/TP are optional user levels inside
   that boundary. Account-wide margin level is broker-grade complexity we
   don't need for a 2-asset product and it would tangle shadow reconciliation.
3. **Spread → per-asset config in basis points; start BTC 3 bps, Gold 3 bps.**
   Half-spread each side of mid. This is the *baseline* edge; the existing
   `driftBias`/`magnet` shadow bias is the *variable* edge — treat spread as
   the floor, don't double-charge.
4. **Cutover → keep binary tables, add CFD alongside, flag the UI.** CFD
   fields go on the same `Trade` model (nullable / discriminated) so
   `TradeShadow` history survives; the UI flips behind a feature flag for
   instant rollback. Retire the binary win-probability controller
   (`TARGETS`/`resolveBucket`) on the CFD path only.
