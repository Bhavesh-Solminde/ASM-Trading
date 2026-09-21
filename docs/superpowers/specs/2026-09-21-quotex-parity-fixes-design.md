# Quotex-Parity Trade UX Fixes — Design Spec

**Date:** 2026-09-21
**Status:** Approved (design), pending spec review
**Author:** paired with user

## Purpose

Ten user-reported gaps between the ASM trade screen and the Quotex reference
the user is benchmarking against. Grouped into a **frontend-first** phase that
is independently verifiable in the browser, and a **backend** phase (leaderboard
+ currency conversion + multi-timeframe candles) taken after a checkpoint.

## Global constraints (apply to every task)

- Monorepo: pnpm workspaces. Web app is `@asm/web` (Next.js 16, React 19,
  Tailwind v4, lightweight-charts 5.2). Do **not** run dev servers via bash —
  use the preview tooling.
- This Next.js has breaking changes; consult `node_modules/next/dist/docs/`
  before new Next patterns. The `next dev` agent block in `apps/web/AGENTS.md`
  is auto-regenerated — leave it.
- Money is integer **minor units** in the account's own currency. Never use
  floats for money. `formatMinor`/`currencySymbol` already handle `$ ₹ €`.
- All motion respects `prefers-reduced-motion: reduce`.
- Tests: `pnpm --filter @asm/web test` (vitest). Keep tests serial where they
  share a backend (per testing-principles).
- Phone breakpoint is the `phone:` variant (`width < 48rem or height < 30rem`).

## Decisions (locked with user)

| # | Decision |
|---|----------|
| Charcoal (#10) | `--color-ground` → `#1e2024` (neutral charcoal); lift `panel/tile/tile-hi/rule` one notch; chart box base to match. |
| Win row (#9) | WON closed row shows **gross return** = `stake + profit` (e.g. `+$200`). Loss stays `−stake`. Stored `pnl` unchanged. |
| Execution | **Frontend first** (Phase 1), verify with screenshots, then Phase 2 backend. |
| #1 target | Smooth the **live candle price** (forming candle close + last-price line drift between ticks). |
| #5 | Both an **expiry TIME picker** (Phase 1, front-end only) and a **candle-timeframe selector** (Phase 2 — needs engine multi-timeframe). |
| #6 leaderboard | **Real** backend aggregation (Phase 2). |
| #7 currency | **Full conversion** — accounts denominated in INR by default, deposits credit in account currency, convert-on-switch (Phase 2, has DB migration). |

## Phase 1 — Frontend (issues #1, #2, #3, #4, #5a, #8, #9, #10)

### #10 Charcoal background
`apps/web/src/app/globals.css` `@theme`: `--color-ground: #1e2024`,
`--color-panel: #24272b`, `--color-tile: #2a2e33`, `--color-tile-hi: #333840`,
`--color-rule: #363b42`. `.chartbox-bg` base `#070707 → #17191c`. Header/TopBar
use `bg-ground`, already token-driven, so they follow. Verify contrast of
`ink/ink-2/ink-3` remains legible (spot-check with screenshot).

### #8 Bonus 100%
- `packages/db/src/repositories/deposit.ts`: `BONUS_PERCENT = 50 → 100`.
- `apps/web/src/components/shell/PromoBanner.tsx`: `+50%` → `+100%`.
- `packages/contracts/src/support.ts`: FAQ "50% deposit bonus" → "100% deposit
  bonus". Update the matching test assertion.
- `TURNOVER_MULTIPLE` stays 3.

### #9 Win shows gross return
`apps/web/src/components/trade/TradesPanel.tsx` `ClosedTradeRow`: for `WON`,
render `+${formatMinor(trade.stake + trade.pnl, currency)}`. REFUNDED and LOST
unchanged. (`trade.pnl` for a win is the net profit; stake+pnl = gross return.)
Add/extend a component or pure-helper test.

### #3 Shrink controls, grow chart
- `TradeWorkspace.tsx`: phone chart row `clamp(320px,62dvh,600px)` →
  `clamp(360px,72dvh,720px)`.
- `TradeTicket.tsx`: phone control heights `STEP`/`DISPLAY` `phone:h-10 → phone:h-9`;
  slab `phone:h-12 → phone:h-11`; tighten the phone gaps. Keep tap targets ≥ 40px
  where feasible (buttons stay ≥ 44px tall via padding on the slab row).

### #1 Smooth live candle price
`apps/web/src/components/chart/PriceChart.tsx`: introduce a small rAF tween that
eases the displayed last price toward the store's `lastPrice`, updating the amber
price line and the forming candle's `close` on each frame instead of snapping.
- New helper `useEasedPrice`-style logic inside the streaming effect: keep a
  `displayed` ref; each store change sets a target; a rAF loop moves `displayed`
  a fraction toward target (`displayed += (target-displayed)*k`) and calls
  `series.update` on the forming candle with the eased close + `priceLine`.
- Gate behind `matchMedia('(prefers-reduced-motion: reduce)')` — reduced motion
  keeps the current snap behavior.
- Must not fight history `setData` or candle-close (only the *forming* candle's
  close is eased; O/H/L still come from the store).

### #4 Win/lose sound
New `apps/web/src/lib/sound.ts`: a tiny Web Audio synth (no asset files).
- `playWin()` — ascending major triad blips; `playLose()` — soft descending
  two-note. Lazily create one `AudioContext`, resume on first user gesture
  (autoplay policy).
- Mute preference in `localStorage` (`asm.sound`), wrapped in try/catch.
- Hook in `PlatformProvider.onMessage`: on `trade:settled` for a trade on the
  active account, call `playWin`/`playLose` by settled status.
- A small mute toggle in the TopBar (icon button). Pure helpers
  (mute state, pick-sound-for-status) unit-tested; the oscillator itself is not.

### #2 Fullscreen mobile mode
Phone-only "focus" mode showing chart + time input + investment input + Buy/Sell.
- State lives in `PlatformProvider` (`focusMode`, `setFocusMode`) so the layout
  can hide chrome. In focus mode the platform layout hides `TopBar`, `Ticker`,
  `IconRail`, `MobileNav`, and `TradeWorkspace` hides `MarketSelector`, the
  trades panel, and desktop-only ticket sections.
- A fullscreen toggle button (phone-only) on the chart; an exit affordance in
  focus mode. Try the native Fullscreen API where available, but the layout
  change is the source of truth (works even if the API is blocked).

### #5a Expiry TIME picker (frontend only)
`TradeTicket.tsx`: a `TIMER | TIME` segmented toggle above the time stepper.
- TIMER = existing `DURATIONS_SEC` behavior.
- TIME = a grid of upcoming clock times (next few minute boundaries + coarser
  steps, like the reference), plus "Set manually". Selecting a time computes
  `durationSec = chosenEpoch - now` at **submit** time and sends that to
  `/api/trades` — no contract/engine change. Clamp so the duration is valid /
  positive; if the chosen time passed, recompute against the next slot.
- Pure helper `upcomingExpiryTimes(now)` + `durationToTargetTime(now,target)`
  unit-tested.

## Phase 2 — Backend (issues #5b, #6, #7) — after checkpoint

Detailed separately after Phase 1 review. Summary of intended scope:

- **#5b Candle timeframe:** extend `Timeframe` (contracts) beyond `1m`
  (e.g. `1m,5m,15m`), teach the engine to aggregate/persist and serve those
  buckets, add a chart selector. Migration-free (Candle already keyed by
  `timeframe` string) but engine work.
- **#6 Leaderboard:** aggregate realized daily P/L per account into a ranked
  list + "your position"; new contract, API route, and a Leaderboard page/panel
  matching the reference. Needs a query over `Transaction`/`Trade`.
- **#7 Currency (clarified 2026-09-21):** the intent is currency **consistency
  per rail**, NOT live conversion between currencies. An account that deposits
  in INR withdraws in INR; an account that deposits in USDT withdraws in USDT.
  So: the account carries its chosen currency (default INR, selectable USDT/USD);
  deposits credit and are denominated in that currency; withdrawals pay out in
  the same currency. No cross-currency conversion of an existing balance is
  required — a currency switch applies to a fresh/empty rail, or is a distinct
  deposit rail per currency. Display uses `formatMinor`/`currencySymbol`
  (₹ / $ already supported). DB: `Account.currency` default → INR; deposit and
  withdrawal flows become currency-aware; seed demo balance in INR.

## Testing & verification strategy

- Unit tests (vitest) for every pure helper introduced (win-row amount,
  sound selection/mute, expiry-time helpers, price easing math).
- After Phase 1: run `pnpm --filter @asm/web test`, `pnpm --filter @asm/web
  typecheck` (via `tsc --noEmit`), start the preview, and capture screenshots
  (desktop + phone viewport) proving: charcoal bg, +100% banner, +$200 win row,
  smaller controls/bigger chart, fullscreen mode, TIME picker. Confirm no
  console errors.

## Risks

- Charcoal shift can reduce contrast on subtle borders/tiles — verify visually.
- Price easing must never desync the forming candle's O/H/L or the countdown
  anchor; only the close is eased.
- Sound autoplay is browser-gated; must unlock on gesture and degrade silently.
- Fullscreen must be phone-only and fully reversible.
