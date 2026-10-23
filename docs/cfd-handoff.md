# CFD System Implementation Handoff

## What Was Done

1. **Design spec completed**: `docs/real-pnl-cfd-system-plan.md` — comprehensive design for the full CFD system covering trading mechanics, price feed architecture, gap/offset mechanism, three-layer magnet, revenue model, adaptive aggression, risk management, schema changes, engine changes, frontend changes, and API changes.

2. **Growth projection artifact**: Published at `https://claude.ai/artifact/Dcoi99UDydY2EX16zAvkfJ` — month-by-month owner cash flow from -₹3L seed to +₹81L at M12.

3. **Implementation plan written**: `docs/superpowers/plans/2026-10-23-real-pnl-cfd.md` — 16 tasks with exact file paths, interfaces, code, and test steps.

4. **Implementation started — Tasks 1-9 COMPLETE (83 tests passing):**
   - **Task 1**: Schema migration — CloseReason, FeedSource enums, Trade CFD fields, Asset spreadBps/feedSource
   - **Task 2**: QuoteBuffer — stores latest quote per symbol, ignores stale
   - **Task 3**: GapTracker — exponential decay (2.4h half-life), sigma-based cap, crypto maintenance window
   - **Task 4**: Spread module — bid/ask, per-user punishment (3× at win cap, 50% fill skew), early close penalty, hard block at 2× cap
   - **Task 5**: CFD contracts — CfdOpenTradeSchema, CfdTradeView, direction mapping
   - **Task 6-7**: CfdDesk — full position lifecycle: open (risk checks + fill quality), scanPositions (SL/TP/liq/expiry/trailing per tick), closePosition (PnL + balance), manualClose (lockout + spread penalty), modify (SL/TP)
   - **Task 8**: Three-layer magnet — anti-crowd bias, SL gravity, profit drag, vol-aware gating, adaptive aggression 3.5×→2.5×
   - **Task 9**: Risk management — dynamicMaxStake, exposureCap, dailyWinCap, daily circuit breaker, vol circuit breaker, demo fills
   - **TICK_DT_SEC**: Changed from 5 to 3
   - **Task 10**: Tick loop wiring — TRADING_MODEL=CFD feature flag, QuoteBuffer/GapTracker/CfdDesk instantiated in main.ts, CFD branch in tick loop (honest tick → real price → magnet → gap → shown price → scan triggers → broadcast), crypto maintenance window, binary path preserved in else branch
   - **Contracts index**: All CFD types now exported from @asm/contracts
   - **Trade desk fix**: CLOSED status type narrowing for binary path

5. **Tasks 11-16 COMPLETE:**
   - **Task 11**: CFD API endpoints — `POST/GET /api/cfd/trades`, `POST .../close`, `PATCH .../modify`; engine internal routes; WebSocket message types (`cfd:trade:opened`, `cfd:trade:settled`, `cfd:trade:modified`); engine-client CFD functions
   - **Task 12**: CFD trade ticket — LONG/SHORT direction, duration slider 5s-1h, optional SL/TP toggle, stake keypad, PnL preview
   - **Task 13**: Live PnL panel + position strip — open positions with floating PnL per tick, closed trades history, phone position bar with inline close
   - **Task 14**: Chart overlays — dashed entry line + dotted SL/TP lines per open CFD position
   - **Task 15**: Crypto maintenance window + market close — `GapTracker.converge()` (10× accelerated decay), `assetCategory()` (CRYPTO/FOREX/STOCK from symbol), `isMarketClosed()` (weekends + IST 23:30-05:00 for non-crypto), CONVERGING phase uses gradual convergence instead of hard reset
   - **Task 16**: Tests for converge, assetCategory, isMarketClosed (added to existing gap.test.ts)

## Status

**All 16 tasks complete.** The CFD system is feature-complete behind `TRADING_MODEL=CFD`.

### Current branch: `claude/vol-aware-magnet`

### Key files:
- `docs/real-pnl-cfd-system-plan.md` — the full design spec
- `docs/superpowers/plans/2026-10-23-real-pnl-cfd.md` — the implementation plan

### Critical design decisions:
1. **Magnet is GLOBAL only** — never per-user. Per-user punishment = spread/fill quality.
2. **Feature flag**: `TRADING_MODEL=CFD` (engine), `NEXT_PUBLIC_TRADING_MODEL=CFD` (web). Both code paths coexist.
3. **Hand-write migrations** — never use `prisma format` (existing schema drift).
4. **Direction mapping**: DB uses `UP/DOWN`, contracts use `LONG/SHORT`. See `directionToDb()`.
5. **Stacked PRs**: Each phase should be its own PR on the previous branch.
6. **Demo stakes excluded from magnet** — demo trades don't count toward net exposure.
7. **Gap is fractional** — stored as fraction of price, not absolute value.
8. **Never fight the trend** — magnet can dampen but never reverse real market direction.
9. **Treasury is in minor units (paisa)** — ₹1 = 100 paisa. All Int fields are paisa.
10. **Tick rate changes from 5s to 3s** — TICK_DT_SEC in `packages/pricing/src/step.ts`.
11. **assetCategory()** — classifies symbols as CRYPTO/FOREX/STOCK from patterns (not from DB `kind` which is REAL/OTC).

### Existing code preserved:
- Binary trading system (behind feature flag) — nothing deleted
- Feeds infrastructure (Binance, TwelveData) — quote buffer added on top
- Shadow ledger / TradeShadow — kept for house monitoring
- HouseDay / HouseTreasury — kept, extended for CFD
- WebSocket infrastructure — kept, new CFD message types added
- Candle generation — unchanged
- Affiliate/KYC/withdrawal systems — unchanged

## Memory references
- `prisma-schema-drift` — hand-write migrations
- `pr-stacking` — multi-plan = stacked PRs
- `reviewer-model-differs` — reviewers on opus, not implementer model
- `ask-before-building` — design changes: ask first, then plan, then build
