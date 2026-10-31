# CFD Revenue Model — Integration Test Handoff

> **For the next session:** Read this file, then build the tests described below.
> PR #104 (`codex/redesign-chart-brackets`) is open. Work on `main` which has all CFD code merged.

## What the user wants

1. **End-to-end integration tests** that simulate the CFD revenue model against a **local isolated DB** (not prod).
2. Set **revenue target to ₹3 lakhs** (3,00,000 = `30_000_000` minor units / paisa) in the test env.
3. Use **all 3 feed sources**: Binance (crypto, free WS), TwelveData (forex/gold, API key), and synthetic (Indian indices — NIFTY etc.).
4. Tests should verify the house makes money — the B-book warehouse model works as designed.
5. **Step-by-step delivery** so the user can review each step.
6. The user also asked about using the **iOS Simulator** to visually test the website.

## The CFD Revenue Model (B-Book Warehouse)

The platform takes the opposite side of every CFD trade. Revenue comes from:

### Revenue streams
1. **Spread fee** — charged upfront at `stake × spreadBps / 10000`. Spread by asset class: crypto 5bps, forex 2bps, commodity/index 10bps.
2. **Position PnL** — `housePnl = -grossPnl` (opposite of user's PnL). When user loses, house wins.
3. **Three-layer magnet** (anti-crowd bias, SL gravity, profit drag) — global gap on shown prices nudges the market against net open positions. This is in `packages/algo/src/cfd-magnet.ts`.
4. **Gap/offset mechanism** — `shownPrice = realPrice × (1 + gap)`, gap decays with half-life ~2.4h. See `apps/engine/src/trading/gap.ts`.

### Key formulas
- **CFD PnL**: `pnl = direction × (exitPrice − entryPrice) / entryPrice × stake`
- **House PnL per trade**: `housePnl = -grossPnl` (from `cfd-desk.ts:384`)
- **Spread fee always goes to house** (from `cfd-desk.ts:183`)
- **Liquidation**: LONG liq at 0, SHORT liq at 2× entry (unleveraged)

### Key files
| File | What it does |
|------|-------------|
| `apps/engine/src/trading/cfd-desk.ts` | CfdDesk class — open, close, scan positions, modify SL/TP |
| `apps/engine/src/trading/gap.ts` | GapTracker, assetCategory, isMarketClosed, cryptoMaintenancePhase |
| `apps/engine/src/trading/spread.ts` | Spread calc, fill skew, lockout, early close multiplier |
| `apps/engine/src/loop.ts` | Tick loop — wires feeds + gap + magnet + CFD desk |
| `packages/algo/src/cfd-magnet.ts` | Three-layer magnet (anti-crowd, SL gravity, profit drag) |
| `packages/algo/src/risk.ts` | Risk limits, circuit breaker |
| `packages/algo/src/constants.ts` | All env-flag toggles, HOUSE_ALWAYS_WINS_MODE, USE_HOUSE_GOVERNOR, etc. |
| `packages/db/src/repositories/house-treasury.ts` | HouseTreasury reads/writes |
| `apps/engine/src/feeds/index.ts` | Feed assembly — Binance/TwelveData symbol mappings |
| `apps/engine/src/feeds/binance.ts` | Binance WebSocket feed |
| `apps/engine/src/feeds/twelve-data.ts` | TwelveData REST poller |
| `scripts/backfill-real-prices.ts` | Historical candle backfill from real APIs |

### Env vars (CFD-specific)
```
TRADING_MODEL=CFD              # engine: enables CFD desk path in loop.ts
NEXT_PUBLIC_TRADING_MODEL=CFD  # web: shows CFD trade ticket
TWELVE_DATA_API_KEY=...        # for forex/gold feeds (already on VPS)
```

### Existing tests to reference
- `apps/engine/src/trading/__tests__/cfd-desk.test.ts` — 27 tests covering CfdDesk
- `apps/engine/src/trading/__tests__/gap.test.ts` — GapTracker, converge, assetCategory, isMarketClosed
- `apps/engine/src/trading/__tests__/spread.test.ts` — spread module
- `packages/algo/src/__tests__/cfd-magnet.test.ts` — three-layer magnet
- `packages/algo/src/__tests__/risk.test.ts` — risk limits

## Test plan — what to build

### Step 1: Revenue simulation test (`apps/engine/src/trading/__tests__/cfd-revenue-sim.test.ts`)

A simulation test that:
1. Seeds a local DB with assets (BTCUSD, ETHUSDT, XAUUSD, EURUSD, NIFTY50)
2. Creates a HouseTreasury row with `treasuryTargetMinor = 30_000_000` (₹3 lakhs)
3. Creates test user accounts (LIVE + DEMO)
4. Simulates ~100 trades across all asset types:
   - Crypto (Binance-sourced): BTCUSD, ETHUSDT
   - Forex/Gold (TwelveData-sourced): XAUUSD, EURUSD
   - Indian indices (synthetic): NIFTY50
5. Mixes LONG/SHORT, various durations (30s to 1h), with and without SL/TP
6. Asserts:
   - House treasury grew (spread fees always positive)
   - Spread fees = sum of all `spreadBps × stake / 10000`
   - DEMO trades don't affect house treasury
   - LIVE trades do affect house treasury
   - PnL formula is correct: `pnl = dir × (exit - entry) / entry × stake`
   - Close reasons fire correctly (DURATION, STOP_LOSS, TAKE_PROFIT, MANUAL, LIQUIDATION, TRAILING_STOP)

### Step 2: Gap/magnet integration test

Test that when net positions are biased (e.g., 80% LONG), the gap tracker nudges shown prices down (against the crowd). Verify:
- Gap accumulates per tick
- Gap decays with half-life ~2.4h
- `converge()` does 10× decay
- Market close stops gap accumulation
- Crypto maintenance window: 4-5 AM IST frozen, 5-6 AM converging

### Step 3: Risk limits test

Test the full risk pipeline:
- Circuit breaker blocks trades when treasury is negative
- Daily win cap triggers spread widening (3×) then hard block (2× cap)
- Exposure cap prevents oversized positions
- Dynamic max stake limits

### Step 4: Feed integration test

Test all 3 feed sources deliver quotes:
- Mock Binance WS → parseBinanceQuote extracts price
- Mock TwelveData REST → extracts price
- Synthetic path (no feed) → asset still gets priced

### Step 5: Full tick-loop simulation

Wire everything together — simulate N ticks with realistic price movement, verify:
- Candles are written correctly
- Positions trigger SL/TP at correct prices
- Duration expiry works
- House treasury balance after the simulation

## How to run the backfill script on VPS

The script is already deployed at `/opt/asmtrader/scripts/backfill-real-prices.ts`:

```bash
cd /opt/asmtrader/deploy && docker compose --env-file ../.env.production run --rm \
  -v /opt/asmtrader/scripts:/app/scripts:ro -e HOURS=24 \
  web pnpm --filter @asm/db exec tsx /app/scripts/backfill-real-prices.ts
```

Last run: 2026-10-23, all 13 real-price assets got 1440 bars (24h). Indian indices skipped (no real API).

## iOS Simulator for visual testing

The Claude desktop app has an **iOS Simulator** tool (`mcp__Claude_Code_iOS_Simulator__control`). However, this project is a **Next.js web app**, not a native iOS app. For visual testing:

1. **Browser pane** (built-in): The best approach. Start the dev server with `preview_start`, then use `computer` (screenshot, click, type) and `read_page` to verify the UI.
2. **iOS Simulator with Safari**: If you want to test the mobile PWA experience, you can boot an iPhone simulator, open Safari, and navigate to `localhost:3000`. The simulator tool can take screenshots and interact.
3. **Resize for mobile**: Use `resize_window` with `preset: "mobile"` (375×812) to test the phone layout in the browser pane.

### Quick browser test workflow
```
1. preview_start {name: "dev"}      # start Next.js dev server
2. navigate to /trade               # open the trade page
3. screenshot                       # verify CFD trade ticket shows
4. resize_window {preset: "mobile"} # check phone layout
5. screenshot                       # verify mobile CFD UI
```

## DB schema for CFD (already migrated)

```sql
-- Enums: CloseReason (DURATION, STOP_LOSS, TAKE_PROFIT, MANUAL, LIQUIDATION, TRAILING_STOP)
--        FeedSource (BINANCE, TWELVE_DATA, SYNTHETIC)
-- Trade table: durationSec, stopLoss, takeProfit, trailingPct, liqPrice, closeReason, closedAt, peakPnl, spreadFee
-- Asset table: spreadBps, feedSource, marketHours
```

## Memory notes
- `prisma-schema-drift.md` — hand-write migrations, never `prisma format`
- `local-browser-verification.md` — isolated DB + free port + `<name>.localhost` for browser checks
- `vps-access.md` — SSH/deploy commands, bind-mount gotcha for scripts
- `testing-principles` skill — invoke before writing tests (teardown, serial config, naming)
