# Client UI Overhaul — Design / Plan

Date: 2026-09-25
Scope: `apps/web` client (trade screen, shell, account, withdrawal). No changes to marketing or admin.

## Decisions (locked with user)
- **Theme:** Black + blue + white. True-black background; **blue replaces amber** as the
  primary accent (`--color-brand`). Up/green and down/red stay (trading semantics). White/near-white text.
- **Currency convert:** FULL real-balance conversion at a **fixed rate ₹100 = $1**
  (1 USD = 100 INR). Removes the "LIVE rail locked after funding" restriction. Converts
  realBalance + bonusBalance for both DEMO and LIVE.
- **Withdrawal certificate email:** Use **Resend**. Build the certificate (shown + downloadable
  on withdrawal success) now and wire a Resend send module that activates when `RESEND_API_KEY`
  is provided. No credentials required to ship the visible certificate.

## Breakpoints
- `phone` custom variant = `(width < 48rem) or (height < 30rem)` (unchanged) — ultra-compact.
- New rule: the trade **2-column desktop layout applies only at `lg:` (≥1024px)**. Tablet
  portrait (768–1023) and phone both use the **stacked** layout (side panel/ticket at the bottom),
  which is the "put the side panel into bottom like mobile view" ask.

## Work items
1. **Theme** — rewrite palette in `globals.css` (black ground scale + blue brand); update
   hardcoded chart colors in `PriceChart.tsx` (BRAND, CROSSHAIR, WATERMARK, grid, price line).
2. **Header balance overflow** — stop `$10,000.00` truncating in `TopBar`; widen the account
   button, drop `truncate` where space allows, fix the `$10,...` clipping.
3. **Tablet stacking** — stack trade layout below `lg` (ticket to bottom).
4. **Mobile Buy/Sell visible** — fit chart + compact ticket in one viewport so Buy/Sell show
   without scrolling; chart flexes instead of a fixed 72dvh block.
5. **In-chart result popup** — on `trade:settled` for the active account, show a P/L card
   overlaid on the chart (win = green, loss = red), auto-dismiss.
6. **Timer into chart** — move the header live clock into the chart top-left, styled
   blue/black/white (not a Quotex copy). Header keeps feed status dot/label.
7. **Fullscreen icon** — replace the ambiguous `arrow` with a diagonal expand/contract icon.
8. **In-chart market box** — compact market-switch button inside the chart for phone+tablet;
   remove the big top `MarketSelector` there; shrink the large NIFTY name/price readout.
9. **History bottom-sheet** — phone+tablet: `TradesPanel` opens from a toggle box as a bottom
   sheet instead of always sitting at the bottom.
10. **Focus mode** — show balance + DEMO/LIVE badge, plus the market box and history box.
11. **Account page** — show "In account" + "Available for withdrawal"; add a currency-convert
    control (₹100=$1) calling a new backend convert endpoint.
12. **Currency conversion backend** — new `convertAccountCurrency` in `@asm/db` (real balance
    conversion, fixed rate, ledgered), new/updated API route.
13. **Withdrawal certificate** — certificate UI on success + `@asm/*` Resend mail module + call
    from the withdrawals route (guarded by env key).

## New icons needed (Icon.tsx)
- `expand` (diagonal out arrows), `collapse` (diagonal in arrows), `history`/`clock`, `swap`/`convert`.

## Verification
Browser pane on `pnpm --filter @asm/web dev` (port 3000). Screenshot desktop, tablet-portrait
(resize 820×1180), and mobile (375×812) for each visual change. Engine (4001) started when live
chart/trade data is needed for the settle popup.

## Tests
Currency conversion is money logic → unit test `convertAccountCurrency` (rate, both account
types, ledger row). Follow existing vitest patterns in `packages/db`.
