# Mobile Client Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every trader-facing route (`/trade`, `/balance`, `/deposit`, `/withdrawal`, `/account`, `/support`, `/login`, `/register`, `/checkout/[token]`) comfortable to use one-handed on a phone from 320px to 430px wide, in portrait and landscape, without changing the desktop layout. `/admin/*` is out of scope.

**Architecture:** One `phone` Tailwind variant (`width < 48rem` **or** `height < 30rem`) replaces today's scattered `max-md:` classes. That way landscape phones get the phone layout too, instead of the squashed desktop grid. The trade screen gets a pinned Up/Down action bar above the bottom nav and a compact two-column ticket. Payments history renders as cards on phones. The remaining fixes are global CSS: no iOS focus-zoom, safe-area insets, touch targets ≥ 40px. Everything stays server-first; the only new client logic is scrolling the active tab into view in `PlatformTabs`.

**Tech Stack:** Next.js 16.3 (App Router), React 19.3, Tailwind CSS 4.3 (CSS-first `@theme`, no config file), lightweight-charts 5.2.

## Global Constraints

- Desktop (≥ 768px wide **and** ≥ 480px tall) must look and behave exactly as before. Every change is scoped with `phone:` (or `pointer-coarse:`), never by editing the base class.
- The Live/Demo plate stays visible at every width. It is the highest-consequence state in the product (PRODUCT.md principle 1).
- Disabled "Soon" rail items stay hidden on phones, as they are today (`nav.ts` registry unchanged).
- No copy changes, and no new claims.
- Touch targets ≥ 40×40px on phones (44px preferred). Form controls ≥ 16px font on coarse pointers, so iOS Safari doesn't zoom on focus.
- Tests do not constrain markup (all Vitest tests are node tests). Verification for UI tasks is the browser check in each task, run in the Claude browser pane via `preview_start` (`web` and `engine` in `.claude/launch.json`) or Chrome DevTools device mode.
- Do not touch `apps/web/src/app/admin/**`.

## Evidence (captured 2026-09-18, 375×812, ~340×827, 812×375, 768×1024)

| # | Where | Problem |
|---|---|---|
| E1 | `/trade` 375×812 | Up/Down buttons start ~1,000px down a 664px scroll area. The primary action is off-screen until you scroll past the chart and the whole ticket. |
| E2 | Top bar ≤ 340px | Balance `$10,000.00` ran into the caret. Fixed as a side effect of Task 0 (narrower font); Task 3 guards 320px. |
| E3 | `/trade` 812×375 landscape | Desktop grid plus `min-h-[640px]`: chart squashed and ticket cut off. Page scrolls as one block. |
| E4 | `/trade` | Stake presets 28px tall, duration chips 30px tall, stepper buttons 36px wide. Asset-tab close buttons appear only on hover, so touch users can't close a tab. |
| E5 | All forms | Inputs are `text-sm` (14px). iOS Safari zooms the page on focus. |
| E6 | `/balance` with rows | A `min-w-[680px]` table forces sideways scrolling on phones. |
| E7 | `/balance`, `/withdrawal` | `PlatformTabs` clips "My account" off the right edge with no hint that it scrolls. |
| E8 | Top-bar account menu | Desktop dropdown at the top of the screen, out of thumb reach. Its links don't close the menu after navigating (the TopBar stays mounted). Withdraw is hidden on phones except via Payments → tabs. |
| E9 | `/checkout/[token]` 320px | 260px QR inside `px-4` + `p-6` leaves a 240px content box, so the QR overflows its card. |
| E10 | `/deposit` | `min-h-screen` inside the shell's scroll area adds a full extra screen of empty scroll. |
| E11 | Shell | No `viewport-fit=cover` or safe-area padding. The bottom nav sits under the iPhone home indicator. |

## File Map

| File | Change |
|---|---|
| `apps/web/src/app/globals.css` | `phone` variant, `--phone-nav-h`, coarse-pointer input sizing, `touch-action` |
| `apps/web/src/app/layout.tsx` | `viewport` export (`viewportFit: "cover"`, `themeColor`) |
| `apps/web/next.config.ts` | `allowedDevOrigins` from `DEV_LAN_HOST`, for testing on a real phone |
| `apps/web/src/app/(platform)/layout.tsx` | Shell grid → `phone:`, safe-area bottom row, drop `min-h` on phones |
| `apps/web/src/components/shell/IconRail.tsx` | `max-md:` → `phone:`, safe-area padding |
| `apps/web/src/components/shell/TopBar.tsx` | `max-md:` → `phone:`, balance truncation, bottom-sheet menu, Withdraw link, close-on-navigate |
| `apps/web/src/components/shell/Ticker.tsx` | Hidden on short landscape heights |
| `apps/web/src/components/trade/TradeWorkspace.tsx` | `max-md:` → `phone:`, chart height, room for the action bar |
| `apps/web/src/components/trade/TradeTicket.tsx` | Two-column compact ticket, fixed Up/Down bar, larger targets |
| `apps/web/src/components/trade/AssetTabs.tsx` | `max-md:` → `phone:`, touch-visible close buttons |
| `apps/web/src/components/shell/PlatformTabs.tsx` | Scroll active tab into view, phone sizing |
| `apps/web/src/app/(platform)/balance/page.tsx` | Card list on phones, table on desktop |
| `apps/web/src/app/(platform)/{withdrawal,account,support,deposit}/page.tsx` | Phone padding; deposit drops `min-h-screen` |
| `apps/web/src/app/(platform)/account/ProfileForm.tsx` | Full-width submit on phones |
| `apps/web/src/components/deposit/AmountStep.tsx` | Quick-amount buttons ≥ 40px |
| `apps/web/src/app/checkout/[token]/page.tsx` | Fluid QR |

## Shared verification snippet

Paste this into the browser console (or `javascript_tool`) at each width listed in a task. It must return `"OK"`, or only list items the task explicitly says are acceptable. It checks the inner scroll area as well as the document.

```js
(() => {
  const vw = innerWidth, out = [];
  if (document.documentElement.scrollWidth > vw) out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
  document.querySelectorAll("main *, header *, nav *, section *").forEach((e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || r.right <= vw + 1) return;
    if (e.closest(".ticker, [role=tablist], .overflow-x-auto")) return; // intentional horizontal scrollers
    out.push(`overflows right: <${e.tagName.toLowerCase()} class="${String(e.className).slice(0, 50)}">`);
  });
  document.querySelectorAll("button, a[href], input, select, [role=tab]").forEach((e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || e.closest("p")) return; // inline text links are exempt
    if (r.height < 40 || r.width < 40) out.push(`target ${Math.round(r.width)}x${Math.round(r.height)}: ${(e.getAttribute("aria-label") || e.textContent || e.name || "").trim().slice(0, 24)}`);
  });
  if (matchMedia("(pointer: coarse)").matches)
    document.querySelectorAll("input:not([type=checkbox]), select, textarea").forEach((e) => {
      if (parseFloat(getComputedStyle(e).fontSize) < 16) out.push(`input font < 16px: ${e.name || e.id}`);
    });
  return out.length ? out : "OK";
})();
```

Widths to check unless a task says otherwise: **320×568, 375×812, 430×932, 812×375 (landscape), 768×1024, 1280×800 (desktop regression)**.

---

### Task 0: Replace dot-matrix numerals with the UI face ✅ (done 2026-09-18)

**Files:** `apps/web/src/app/globals.css`, `apps/web/src/app/page.tsx`, `apps/web/src/components/shell/TopBar.tsx`

- [x] `--font-led` now resolves to `var(--font-ui)` (Hanken Grotesk). `.led` is weight 700 with `tabular-nums lining-nums`, so digits have fixed width and prices don't jitter on a tick. The `.led-lit` glow is softened to 22% / 14px.
- [x] Added `--font-brand: var(--font-doto), var(--font-ui)`. The ASM wordmark (`TopBar`, `/`) uses `font-brand`, so Doto remains only on the logo.
- [x] Verified at 375×812: every `.led` element computes to Hanken Grotesk; the wordmark computes to Doto.

---

### Task 1: Foundation: `phone` variant, viewport, touch and input defaults

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/next.config.ts`

**Interfaces:**
- Produces: the Tailwind variant `phone:` (all later tasks use it), the CSS custom property `--phone-nav-h` (Tasks 2 and 4), and the env var `DEV_LAN_HOST` (dev only).

- [ ] **Step 1: Add the variant and globals.** In `globals.css`, directly under `@import "tailwindcss";`, add the following. The `or` form is required: the comma form `(@media (a), (b))` miscompiles in Tailwind 4.3.3 (verified 2026-09-18 with `tailwindcss`'s `compile()`).

```css
/* Phone layout: narrow portrait OR short landscape. One variant keeps both orientations consistent. */
@custom-variant phone (@media (width < 48rem) or (height < 30rem));
```

Append to the `:root` block:

```css
:root {
  color-scheme: dark;
  /* Height of the phone bottom nav; the shell grid and the trade action bar both offset by it. */
  --phone-nav-h: 64px;
}
```

After the `:focus-visible` rule, add:

```css
/* Stops double-tap zoom on rapid taps (e.g. repeated Up presses). */
a,
button,
[role="tab"] {
  touch-action: manipulation;
}

/* iOS Safari zooms any focused control under 16px. Unlayered, so it beats Tailwind's text-* utilities. */
@media (pointer: coarse) {
  input,
  select,
  textarea {
    font-size: max(16px, 1em);
  }
}
```

- [ ] **Step 2: Add the viewport export.** In `apps/web/src/app/layout.tsx`, change the type import and add the export below `metadata`:

```tsx
import type { Metadata, Viewport } from "next";
```

```tsx
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050505",
};
```

- [ ] **Step 3: Allow a real phone to load the dev server.** In `apps/web/next.config.ts`, add to `nextConfig`:

```ts
  // Set DEV_LAN_HOST=<your Mac's LAN IP> to open the dev server from a phone on the same Wi-Fi.
  allowedDevOrigins: process.env.DEV_LAN_HOST ? [process.env.DEV_LAN_HOST] : [],
```

- [ ] **Step 4: Verify.** Run `pnpm --filter @asm/web exec tsc --noEmit`. Expected: no errors. Reload `/login` at 375×812 in mobile emulation and run in the console:
  - `document.querySelector('meta[name=viewport]').content`. Expected: contains `viewport-fit=cover`.
  - `getComputedStyle(document.querySelector('input')).fontSize`. Expected: `"16px"`.

  At 1280×800 the same input is still `14px`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/layout.tsx apps/web/next.config.ts
git commit -m "feat(web): phone variant, viewport-fit, touch and iOS input-zoom defaults"
```

---

### Task 2: Shell: grid, bottom nav, ticker on phones and landscape

**Files:**
- Modify: `apps/web/src/app/(platform)/layout.tsx:47`
- Modify: `apps/web/src/components/shell/IconRail.tsx`
- Modify: `apps/web/src/components/shell/Ticker.tsx`

**Interfaces:**
- Consumes: `phone:` and `--phone-nav-h` from Task 1.

- [ ] **Step 1: Shell grid.** Replace the grid `div` in `(platform)/layout.tsx`:

```tsx
      <div className="grid h-dvh min-h-[640px] grid-cols-[76px_minmax(0,1fr)] grid-rows-[60px_32px_minmax(0,1fr)] phone:min-h-0 phone:grid-cols-[minmax(0,1fr)] phone:grid-rows-[56px_28px_minmax(0,1fr)_calc(var(--phone-nav-h)+env(safe-area-inset-bottom))] [@media(height<30rem)]:grid-rows-[48px_0px_minmax(0,1fr)_calc(var(--phone-nav-h)+env(safe-area-inset-bottom))]">
        <TopBar />
        <Ticker />
        <IconRail />
        <div className="col-start-2 row-start-3 min-h-0 min-w-0 overflow-auto overscroll-contain phone:col-start-1">{children}</div>
      </div>
```

The second `grid-rows` override collapses the ticker row and shortens the top bar on landscape phones. Tailwind emits arbitrary media variants after custom variants (verified 2026-09-18), so it wins when both match.

- [ ] **Step 2: Ticker hides on short screens.** In `Ticker.tsx`, add `[@media(height<30rem)]:hidden` to both root elements: the empty-state `div` and the `aria-label="Live prices"` `div`.

- [ ] **Step 3: Bottom nav.** In `IconRail.tsx`, replace every `max-md:` with `phone:` (there are 4 occurrences), then add safe-area padding to the `nav` class list:

```tsx
      className="col-start-1 row-start-3 flex flex-col items-center gap-1 border-r border-rule py-3 phone:row-start-4 phone:flex-row phone:justify-around phone:border-r-0 phone:border-t phone:bg-ground phone:px-2 phone:pb-[max(4px,env(safe-area-inset-bottom))] phone:pt-1"
```

- [ ] **Step 4: Verify.** At 375×812: the bottom nav is 64px tall and the active item's brand bar is visible. At 812×375: phone layout, no ticker, top bar 48px, bottom nav visible, `/trade` scrolls inside the content area only (`document.documentElement.scrollHeight === innerHeight`). At 1280×800: rail on the left and ticker visible, the same as before.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(platform)/layout.tsx" apps/web/src/components/shell/IconRail.tsx apps/web/src/components/shell/Ticker.tsx
git commit -m "feat(web): phone shell grid with safe-area nav and landscape support"
```

---

### Task 3: Top bar: 320px-safe balance, bottom-sheet account menu

**Files:**
- Modify: `apps/web/src/components/shell/TopBar.tsx`

**Interfaces:**
- Consumes: `phone:` from Task 1. The existing `useDismiss(menuRef, menuOpen, closeMenu)` stays as is.

- [ ] **Step 1: Swap the variant.** Replace every `max-md:` in `TopBar.tsx` with `phone:` (8 occurrences).

- [ ] **Step 2: Balance can shrink but never hides the plate.** Change the account button and the balance span:

```tsx
          className={`grid h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_18px] items-center gap-2.5 rounded border bg-panel pl-1.5 pr-2.5 text-left phone:gap-1.5 phone:pr-1.5 ${
            live ? "border-brand" : "border-rule hover:border-tile-hi"
          }`}
```

```tsx
            <span className="led led-lit truncate text-[20px] leading-none phone:text-[17px]">{totalBalance(activeAccount, balances)}</span>
```

- [ ] **Step 3: Account menu becomes a bottom sheet on phones.** Replace the `{menuOpen ? ( <div role="menu" ...` opening block with a fragment that includes a backdrop. Add `onClick={closeMenu}` to both links and add a phone-only Withdraw link:

```tsx
        {menuOpen ? (
          <>
            <div aria-hidden onClick={closeMenu} className="fixed inset-0 z-30 hidden bg-black/60 phone:block" />
            <div
              role="menu"
              className="absolute right-0 top-[54px] z-40 w-[340px] max-w-[calc(100vw-20px)] rounded border border-rule bg-[#0f0f10] p-2 shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)] phone:fixed phone:inset-x-0 phone:bottom-0 phone:top-auto phone:w-auto phone:max-w-none phone:rounded-b-none phone:border-x-0 phone:border-b-0 phone:pb-[max(12px,env(safe-area-inset-bottom))]"
            >
              {/* account rows unchanged */}
              <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-rule px-2.5 pb-1 pt-2.5">
                <Link href="/account" onClick={closeMenu} className="py-2 text-[13px] font-semibold text-brand hover:underline">
                  My account
                </Link>
                <Link href="/withdrawal" onClick={closeMenu} className="hidden py-2 text-[13px] font-semibold text-ink-2 hover:text-ink phone:inline">
                  Withdraw
                </Link>
                <form action="/api/auth/logout" method="post">
                  <button type="submit" className="py-2 text-[13px] font-semibold text-ink-3 hover:text-ink">
                    Log out
                  </button>
                </form>
              </div>
            </div>
          </>
        ) : null}
```

Keep the existing `accounts.sort(...).map(...)` rows exactly as they are, between the `role="menu"` div's opening tag and the footer `div`.

- [ ] **Step 4: Verify.** At 320×568: the `DEMO` plate, the full balance (or an ellipsis, never overlapping the caret), the caret and the Deposit button are all visible. `document.querySelector('header').scrollWidth <= 320`. Tap the balance: the sheet rises from the bottom over a dimmed backdrop. Tapping the backdrop closes it. Tapping "Withdraw" navigates to `/withdrawal` **and** closes the sheet. At 1280×800: the dropdown is anchored under the button as before, with no Withdraw link in it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell/TopBar.tsx
git commit -m "feat(web): 320px-safe top bar and bottom-sheet account menu on phones"
```

---

### Task 4: Trade screen: chart height, compact ticket, pinned Up/Down

**Files:**
- Modify: `apps/web/src/components/trade/TradeWorkspace.tsx`
- Modify: `apps/web/src/components/trade/TradeTicket.tsx`
- Modify: `apps/web/src/components/trade/AssetTabs.tsx`

**Interfaces:**
- Consumes: `phone:` and `--phone-nav-h` from Task 1. `TradeTicket` props are unchanged.
- Produces: the phone action bar sits at `bottom: calc(var(--phone-nav-h) + env(safe-area-inset-bottom))` and is `76px` tall. `TradeWorkspace` reserves that space with `phone:pb-[76px]`.

- [ ] **Step 1: Workspace layout.** In `TradeWorkspace.tsx`, replace every `max-md:` with `phone:` (5 occurrences), then change these three class strings:

```tsx
      className="grid h-full grid-cols-[minmax(0,1fr)_312px] phone:h-auto phone:grid-cols-[minmax(0,1fr)] phone:pb-[76px]"
```

```tsx
      <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5 py-3 pl-4 pr-3 phone:grid-rows-[auto_clamp(240px,46dvh,460px)] phone:gap-2 phone:p-2.5">
```

```tsx
        <div className="chartbox-bg relative grid min-h-0 grid-cols-[30px_minmax(0,1fr)] gap-2.5 rounded border border-rule pl-2.5 pt-2.5 phone:grid-cols-[18px_minmax(0,1fr)] phone:gap-1.5 phone:pl-1.5">
```

- [ ] **Step 2: Ticket becomes two columns on phones.** In `TradeTicket.tsx`, restructure the JSX as follows. Desktop visual order is unchanged: Time, Investment, presets, payout, buttons.

  Root `div`:

```tsx
    <div className="relative grid gap-3 border-b border-rule px-4 pb-4 pt-3.5 phone:gap-2.5 phone:border-b-0 phone:px-3 phone:pb-2 phone:pt-3">
```

  Pair/payout header: add `phone:hidden`. The chart readout and asset tab already show both on phones.

```tsx
      <div className="flex items-baseline justify-between phone:hidden">
```

  Wrap the **Time** block and the **Investment** label + stepper in one grid. Move the stake-preset row **out** of the Investment block to directly after this wrapper:

```tsx
      <div className="grid gap-3 phone:grid-cols-2 phone:gap-2">
        {/* Time block: unchanged except the items below */}
        {/* Investment block: label + stepper only */}
      </div>
      <div className="grid grid-cols-5 gap-1">{/* STAKE_PRESETS buttons */}</div>
```

  Inside both steppers, change the column template and heights so they fit a half-width column at 320px:

```tsx
        <div className="grid grid-cols-[36px_1fr_36px] items-center gap-1.5 phone:grid-cols-[40px_minmax(0,1fr)_40px] phone:gap-1">
```

  Add `phone:h-11` to the `STEP` and `DISPLAY` constants:

```tsx
const STEP =
  "grid h-12 place-items-center rounded border border-rule text-ink-2 hover:border-tile-hi hover:bg-panel hover:text-ink phone:h-11";
const DISPLAY = "grid h-12 place-items-center rounded border border-rule bg-panel phone:h-11";
```

  The duration display shows the short form on phones (`30s`, `5m`, `1h`) using the existing `formatDuration`:

```tsx
            <span className="led led-lit text-[22px] phone:hidden">{hms(durationSec)}</span>
            <span className="led led-lit hidden text-[18px] phone:inline">{formatDuration(durationSec)}</span>
```

  The stake amount on phones:

```tsx
            <span className="flex items-center justify-center gap-0.5 text-[22px] font-bold phone:text-[18px]">
```

  The duration chooser floats as a full-width panel on phones, so its chips are 40px tall. The ticket root is `relative`, and the Time block must **not** be:

```tsx
          <div
            id="ticket-durations"
            className="grid grid-cols-4 gap-1 phone:absolute phone:inset-x-3 phone:z-20 phone:mt-1 phone:gap-1.5 phone:rounded phone:border phone:border-rule phone:bg-[#0f0f10] phone:p-2 phone:shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)]"
          >
```

  and each chip: `h-[30px] ... phone:h-10 phone:text-sm`.

  Stake presets: `h-7 ... phone:h-10 phone:text-sm`.

  The **Up/Down** wrapper becomes a fixed bar above the bottom nav on phones, with the buttons side by side:

```tsx
      <div className="grid gap-2 phone:fixed phone:inset-x-0 phone:bottom-[calc(var(--phone-nav-h)+env(safe-area-inset-bottom))] phone:z-20 phone:h-[76px] phone:grid-cols-2 phone:border-t phone:border-rule phone:bg-ground/95 phone:px-3 phone:py-2.5 phone:backdrop-blur">
```

  Slab sizing on phones. In the `slab` string, append `phone:h-14 phone:pl-3.5 phone:pr-3 phone:text-[16px]`. In `slabNote`, append `max-[359px]:hidden` so the hint drops only below 360px, where half-width slabs can't hold it.

- [ ] **Step 3: Asset tabs work by touch.** In `AssetTabs.tsx`, replace the single `max-md:` with `phone:`. Make the close button visible on touch devices with a 28px hit area:

```tsx
                  className="absolute right-1 top-1 hidden size-4 place-items-center rounded-[2px] bg-tile-hi text-ink-2 hover:text-ink group-focus-within:grid group-hover:grid pointer-coarse:grid pointer-coarse:size-7 pointer-coarse:-right-1 pointer-coarse:-top-1 pointer-coarse:rounded-full"
```

  Add `pointer-coarse:pr-8` to the tab button, so the label never sits under the close button.

- [ ] **Step 4: Verify.** At 375×812, on `/trade`, without scrolling:
  - `document.querySelector('[class*="bg-up"]').getBoundingClientRect().bottom <= innerHeight - 64`. The Up button is fully visible above the nav.
  - Chart, Time/Investment side by side, and the preset row are all visible, or reachable with one short scroll.
  - Place a demo trade with Up and check it appears under "Open" (scroll down). Then run the shared snippet. Expected: `"OK"`, except `target 40x…` rows ≥ 40 are fine.

  At 320×568: Time shows `30s`, Investment shows `$10`, and Up/Down each span half the width without text clipping (the note is hidden). Tap the Time display: the 4-column chooser floats over the ticket and its chips are 40px tall. At 812×375: the bar is pinned above the nav and the chart is ≥ 240px tall. At 768×1024 and 1280×800: the ticket is in the right column with `00:00:30`, the note visible and the buttons stacked, the same as before.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/trade/TradeWorkspace.tsx apps/web/src/components/trade/TradeTicket.tsx apps/web/src/components/trade/AssetTabs.tsx
git commit -m "feat(web): phone trade screen with pinned Up/Down bar and compact ticket"
```

---

### Task 5: Payments history as cards; tabs that reveal themselves

**Files:**
- Modify: `apps/web/src/app/(platform)/balance/page.tsx`
- Modify: `apps/web/src/components/shell/PlatformTabs.tsx`

**Interfaces:**
- Consumes: `phone:` from Task 1. The `rows` array shape in `balance/page.tsx` (`id, at, status, kind, method, amount, note`) is unchanged.

- [ ] **Step 1: Card list.** In `balance/page.tsx`, add `phone:hidden` to the table wrapper (`<div className="overflow-x-auto phone:hidden">`). Directly before it, inside the same `rows.length === 0 ? … : (…)` branch, render a fragment containing this list and the table:

```tsx
        <>
          <ul className="hidden flex-col phone:flex">
            {rows.map((row) => (
              <li key={row.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-[var(--color-rule)] py-3 text-sm">
                <span className="font-semibold">
                  {row.kind} · {row.method}
                </span>
                <span
                  className="text-right font-semibold tabular-nums"
                  style={{ color: row.amount >= 0 ? "var(--color-up)" : "var(--color-down)" }}
                >
                  {row.amount >= 0 ? "+" : "−"}
                  {formatMoney(Math.abs(row.amount), "USD")}
                </span>
                <span className="text-xs tabular-nums text-[var(--color-ink-2)]">
                  {row.at.toISOString().slice(0, 16).replace("T", " ")}
                </span>
                <span className="text-right text-xs">{STATUS_LABEL[row.status] ?? row.status}</span>
                <span className="col-span-2 font-mono text-[11px] text-[var(--color-ink-3)]">{row.id.slice(0, 8).toUpperCase()}</span>
                {row.note ? (
                  <p className="col-span-2 mt-1 rounded bg-[var(--color-tile)] p-2 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                    {row.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {/* existing table wrapper, now with phone:hidden */}
        </>
```

  Change the `main` padding: `px-6 py-8` → `px-6 py-8 phone:px-4 phone:py-5`.

- [ ] **Step 2: Tabs scroll the active one into view.** Replace `PlatformTabs.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/withdrawal", label: "Withdrawal" },
  { href: "/balance", label: "Payments" },
  { href: "/trade", label: "Trades" },
  { href: "/account", label: "My account" },
] as const;

export function PlatformTabs() {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  // On narrow screens the strip scrolls; make sure the current tab is never the clipped one.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <div className="flex gap-1 overflow-x-auto rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-1 [scrollbar-width:none]">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            ref={active ? activeRef : undefined}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded px-4 py-2 text-sm font-semibold phone:px-3 phone:py-2.5 phone:text-[13px] ${
              active
                ? "bg-[var(--color-tile)] text-[var(--color-ink)]"
                : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Verify.** To get rows, create one deposit via `/deposit` (it stays "Awaiting payment"). At 375×812, `/balance` shows cards with no sideways scroll, and the snippet returns `"OK"`. At 1280×800 the table is unchanged. At 320×568 on `/withdrawal`, the Withdrawal tab is fully visible. On `/balance` the Payments tab is visible.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(platform)/balance/page.tsx" apps/web/src/components/shell/PlatformTabs.tsx
git commit -m "feat(web): payments cards and self-revealing tabs on phones"
```

---

### Task 6: Page gutters, forms and checkout

**Files:**
- Modify: `apps/web/src/app/(platform)/withdrawal/page.tsx`, `account/page.tsx`, `support/page.tsx`, `deposit/page.tsx`
- Modify: `apps/web/src/app/(platform)/account/ProfileForm.tsx`
- Modify: `apps/web/src/components/deposit/AmountStep.tsx`
- Modify: `apps/web/src/app/checkout/[token]/page.tsx`

**Interfaces:**
- Consumes: `phone:` from Task 1.

- [ ] **Step 1: Gutters.** On each page's root `main`, append `phone:px-4 phone:py-5`. On `deposit/page.tsx`, also remove `min-h-screen`:

```tsx
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-10 phone:px-4 phone:py-5">
```

- [ ] **Step 2: Thumb-sized controls.**
  - `ProfileForm.tsx`: on the "Save" button (the `self-start rounded bg-[var(--color-brand)] px-5 py-2.5` class), add `phone:self-stretch phone:py-3`. On the 2FA checkboxes' `label`, add `phone:min-h-11`.
  - `AmountStep.tsx`: on the quick-amount buttons (`flex-1 rounded border ... px-2 py-1.5 text-xs`), add `phone:py-2.5 phone:text-sm`.

- [ ] **Step 3: Fluid QR.** In `checkout/[token]/page.tsx`, change the QR `img` class:

```tsx
                className="mx-auto mt-4 aspect-square h-auto w-full max-w-[260px]"
```

and add `phone:p-5` to its `section` (`rounded-xl bg-white p-6 text-center shadow-sm phone:p-5`).

- [ ] **Step 4: Verify.** Run the snippet on `/withdrawal`, `/account`, `/support`, `/deposit` (method list, then the amount step) and `/login` at 320×568 and 375×812. Expected: `"OK"`; the account 2FA checkboxes are allowed to report `target 16x16` because their `label` is the 44px target. Open a checkout: start a deposit, and the amount step's submit navigates to `/checkout/<token>`. At 320×568 the QR fits inside its white card (`img.getBoundingClientRect().right < section.getBoundingClientRect().right`). The deposit page has no empty scroll below the method list.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(platform)" apps/web/src/components/deposit/AmountStep.tsx "apps/web/src/app/checkout/[token]/page.tsx"
git commit -m "feat(web): phone gutters, thumb-sized form controls, fluid checkout QR"
```

---

### Task 7: Full sweep and repo checks

- [ ] **Step 1:** Run `pnpm typecheck && pnpm lint && pnpm --filter @asm/web test`. Expected: all pass. Tests are node-only and should be unaffected.
- [ ] **Step 2:** Run the snippet on every route at each of the six widths. Record results in a table in the PR description.
- [ ] **Step 3:** Run the design detector: `node ~/.claude/skills/impeccable/scripts/detect.mjs --json apps/web/src/components apps/web/src/app/\(platform\) apps/web/src/app/checkout`. Fix findings introduced by this plan only.
- [ ] **Step 4: Real device pass** (DevTools emulation misses the iOS keyboard, safe areas and real touch). Start the servers with the LAN recipe in "Running locally" below. On an iPhone (Safari) and an Android phone (Chrome):
  - Focus the stake input and the login email field. The page must not zoom.
  - Check the bottom nav clears the home indicator.
  - Place a demo trade from the pinned bar.
  - Open and close the account sheet.
  - Rotate to landscape and place another trade.
- [ ] **Step 5:** Commit any fixes. Then use superpowers:finishing-a-development-branch.

---

## Running locally

Both apps read the root `.env`, which `apps/web/.env` symlinks to. `DATABASE_URL` is Supabase and `REDIS_URL` is Upstash, so no local Postgres or Redis is needed.

```bash
pnpm install
pnpm db:generate
pnpm dev:engine   # engine: WebSocket :4001, internal HTTP :4002
pnpm dev          # web: http://localhost:3000
```

To test on a real phone on the same Wi-Fi, replace `192.168.0.101` with your Mac's current IP from `ipconfig getifaddr en0`:

```bash
NEXT_PUBLIC_ENGINE_WS_URL=ws://192.168.0.101:4001 DEV_LAN_HOST=192.168.0.101 pnpm dev
```

Then open `http://192.168.0.101:3000` on the phone. The engine's WebSocket server already listens on all interfaces, and the CSP allows `ws:`.
