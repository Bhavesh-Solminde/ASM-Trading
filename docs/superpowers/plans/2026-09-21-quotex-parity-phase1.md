# Quotex-Parity Phase 1 (Frontend) Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans / TDD. Steps use `- [ ]` checkboxes.

**Goal:** Ship the eight frontend Quotex-parity fixes (#1,#2,#3,#4,#5a,#8,#9,#10) with tests + browser screenshot proof.

**Architecture:** All changes live in `@asm/web` except the `BONUS_PERCENT` constant (`@asm/db`) and one contracts FAQ string. New client state (`focusMode`) in `PlatformProvider`; new pure helpers in `src/lib` get unit tests; motion/sound respect reduced-motion & autoplay policy.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, lightweight-charts 5.2, Web Audio, vitest.

## Global Constraints
- Money = integer minor units; use `formatMinor`/`currencySymbol`.
- Respect `prefers-reduced-motion: reduce`.
- Phone = `phone:` variant. Don't run dev servers via bash — use preview tools.
- Tests: `pnpm --filter @asm/web test`. Typecheck: `pnpm --filter @asm/web exec tsc --noEmit`.

---

### Task 1: Charcoal background (#10)
**Files:** Modify `apps/web/src/app/globals.css` (`@theme` tokens + `.chartbox-bg`).
- [ ] Set `--color-ground:#1e2024; --color-panel:#24272b; --color-tile:#2a2e33; --color-tile-hi:#333840; --color-rule:#363b42;`
- [ ] `.chartbox-bg` solid base `#070707 → #17191c`.
- [ ] Verify in preview (desktop + phone) that amber/green/red still pop and text is legible. Screenshot.

### Task 2: Bonus 100% (#8)
**Files:** Modify `packages/db/src/repositories/deposit.ts`, `apps/web/src/components/shell/PromoBanner.tsx`, `packages/contracts/src/support.ts` (+ its test).
- [ ] `BONUS_PERCENT = 100`.
- [ ] PromoBanner `+50%` → `+100%`.
- [ ] Support FAQ copy `50%` → `100%`; update `support` test assertion.
- [ ] Run `pnpm --filter @asm/contracts test` (or repo test) — green.

### Task 3: Win row shows gross return (#9)
**Files:** Modify `apps/web/src/components/trade/TradesPanel.tsx`; add helper + test (`src/components/trade/pnl-display.ts` + `.test.ts`).
- [ ] **Test first:** `closedRowAmount({status:'WON', stake:10000, pnl:10000})` → `+$200.00` gross; `LOST` → `−$100.00`; `REFUNDED` → `$0.00`.
- [ ] Implement helper returning `{ text, className }`; wire into `ClosedTradeRow`.
- [ ] Test passes; typecheck.

### Task 4: Shrink controls / grow chart (#3)
**Files:** Modify `TradeWorkspace.tsx`, `TradeTicket.tsx`.
- [ ] Chart phone row → `clamp(360px,72dvh,720px)`.
- [ ] `STEP`/`DISPLAY` `phone:h-10 → phone:h-9`; slab `phone:h-12 → phone:h-11`; tighten phone gaps.
- [ ] Phone screenshot: bigger chart, compact controls, Buy/Sell still ≥44px tall.

### Task 5: Smooth live candle price (#1)
**Files:** Modify `apps/web/src/components/chart/PriceChart.tsx`; add `src/components/chart/ease.ts` + test.
- [ ] **Test first:** `stepEase(current, target, k)` moves a fraction toward target, snaps when within epsilon.
- [ ] In the streaming effect, keep a `displayedPrice` ref; on store change set `target`; a rAF loop eases displayed → target, updating the amber `priceLine` and the *forming* candle close (O/H/L untouched). Cancel rAF on cleanup.
- [ ] Reduced-motion → snap (no rAF).
- [ ] Verify: price line glides smoothly; countdown still anchored; no console errors.

### Task 6: Win/lose sound (#4)
**Files:** Create `apps/web/src/lib/sound.ts` (+ `sound.test.ts` for pure parts); modify `PlatformProvider.tsx` (settlement hook) and `TopBar.tsx` (mute toggle).
- [ ] **Test first:** `soundForSettled('WON')==='win'`, `'LOST'==='lose'`, others `null`; `isMuted()` reads localStorage safely (try/catch → default false).
- [ ] Implement WebAudio synth (`playWin`/`playLose`), lazy `AudioContext`, resume-on-gesture, mute gate.
- [ ] In `onMessage`, on `trade:settled` for active account → play by status.
- [ ] TopBar mute icon toggles + persists.
- [ ] Verify audibly in preview; console clean; muted state persists on reload.

### Task 7: Fullscreen mobile mode (#2)
**Files:** Modify `PlatformProvider.tsx` (add `focusMode`,`setFocusMode`), `(platform)/layout.tsx` (hide chrome), `TradeWorkspace.tsx` (hide non-essentials + toggle button).
- [ ] Add `focusMode` state to context.
- [ ] Layout: when `focusMode`, collapse the grid to content-only (hide TopBar/Ticker/IconRail/MobileNav).
- [ ] Workspace: phone-only fullscreen button on the chart; in focus mode hide MarketSelector + TradesPanel; keep chart + time + investment + Buy/Sell; show an exit button.
- [ ] Attempt native Fullscreen API (best-effort), layout is source of truth.
- [ ] Phone screenshot of focus mode; exit returns to normal.

### Task 8: Expiry TIME picker (#5a)
**Files:** Create `apps/web/src/lib/expiry-times.ts` (+ test); modify `TradeTicket.tsx`.
- [ ] **Test first:** `upcomingExpiryTimes(now)` returns ascending future epochs (minute boundaries then coarser); `durationToTarget(now,target)` = seconds, always ≥ min duration, recomputed if past.
- [ ] Add `TIMER | TIME` segmented control; TIME shows the times grid + "Set manually"; selection stored as target epoch; at submit compute `durationSec` from target.
- [ ] Clamp/guard invalid/past selections.
- [ ] Test passes; verify picker in preview.

### Task 9: Phase 1 verification
- [ ] `pnpm --filter @asm/web test` green; `tsc --noEmit` clean; `pnpm lint` (changed files) clean.
- [ ] Preview desktop + phone; capture screenshots proving each fix; confirm no console errors.
- [ ] Commit on a feature branch.

## Self-review
- Spec coverage: #1(T5) #2(T7) #3(T4) #4(T6) #5a(T8) #8(T2) #9(T3) #10(T1). #5b/#6/#7 = Phase 2. ✅
- No placeholders. Helpers have concrete test intents. Names consistent (`focusMode`, `soundForSettled`, `upcomingExpiryTimes`).
