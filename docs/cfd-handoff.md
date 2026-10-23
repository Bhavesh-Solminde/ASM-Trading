# CFD System Implementation Handoff

## What Was Done

1. **Design spec completed**: `docs/real-pnl-cfd-system-plan.md` — comprehensive design for the full CFD system covering trading mechanics, price feed architecture, gap/offset mechanism, three-layer magnet, revenue model, adaptive aggression, risk management, schema changes, engine changes, frontend changes, and API changes.

2. **Growth projection artifact**: Published at `https://claude.ai/artifact/Dcoi99UDydY2EX16zAvkfJ` — month-by-month owner cash flow from -₹3L seed to +₹81L at M12.

3. **Implementation plan written**: `docs/superpowers/plans/2026-10-23-real-pnl-cfd.md` — 16 tasks with exact file paths, interfaces, code, and test steps. Ready for execution.

## What Needs to Be Done Next

**Start implementing the plan task by task.** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` skill.

### Task execution order (critical path):

```
Task 1: Schema Migration → Task 5: CFD Contracts → Task 6: Position Open → 
Task 7: Position Scanning → Task 10: Tick Loop Wiring → Task 11: API Endpoints →
Task 12: Frontend Trade Ticket → Task 13: Live PnL → Task 14: Chart Overlays → 
Task 16: Feature Flag + E2E
```

**Parallelizable (no dependencies):** Tasks 2, 3, 4, 8, 9 can run alongside the critical path.

### Current branch: `claude/vol-aware-magnet`

This branch already has:
- Vol-aware magnet + open-time overrides (merged before this CFD work)
- The design spec and implementation plan

### Key files to read first:
- `docs/real-pnl-cfd-system-plan.md` — the full design spec
- `docs/superpowers/plans/2026-10-23-real-pnl-cfd.md` — the implementation plan (start here)

### Critical design decisions the next AI must know:
1. **Magnet is GLOBAL only** — never per-user. Per-user punishment = spread/fill quality.
2. **Feature flag**: `TRADING_MODEL=CFD` env var. Both code paths coexist.
3. **Hand-write migrations** — never use `prisma format` (existing schema drift).
4. **Direction mapping**: DB uses `UP/DOWN`, contracts use `LONG/SHORT`. See `directionToDb()`.
5. **Stacked PRs**: Each phase should be its own PR on the previous branch.
6. **Demo stakes excluded from magnet** — demo trades don't count toward net exposure.
7. **Gap is fractional** — stored as fraction of price, not absolute value.
8. **Never fight the trend** — magnet can dampen but never reverse real market direction.
9. **Treasury is in minor units (paisa)** — ₹1 = 100 paisa. All Int fields are paisa.
10. **Tick rate changes from 5s to 3s** — TICK_DT_SEC in `packages/pricing/src/step.ts`.

### Existing code to preserve:
- Binary trading system (behind feature flag) — don't delete anything
- Feeds infrastructure (Binance, TwelveData) — add quote buffer ON TOP
- Shadow ledger / TradeShadow — keep for house monitoring
- HouseDay / HouseTreasury — keep, extend for CFD
- WebSocket infrastructure — keep, add new message types
- Candle generation — keep unchanged
- Affiliate/KYC/withdrawal systems — unchanged

### No implementation has started yet. All 16 tasks are pending.

## Memory references
- `prisma-schema-drift` — hand-write migrations
- `pr-stacking` — multi-plan = stacked PRs
- `reviewer-model-differs` — reviewers on opus, not implementer model
- `ask-before-building` — design changes: ask first, then plan, then build
