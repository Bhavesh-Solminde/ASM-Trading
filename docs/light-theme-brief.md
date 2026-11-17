# Light theme for the whole website — implementation brief

Branch: `feat/adding-light-theme` (already checked out in this worktree).
App: `apps/web` (Next.js 16, React 19, Tailwind v4, lightweight-charts 5.2.1, GSAP).
Out of scope: `apps/mobile` (native app), emails (`packages/mail`), the share/OG image
(`src/app/opengraph-image.tsx`), the withdrawal certificate image
(`src/lib/withdrawal-certificate.tsx`), the PWA manifest colours.

The goal: every page a trader or visitor can reach gets a polished light theme, the switch
works instantly everywhere, and nothing anywhere looks broken, unreadable or half-converted
in either theme. The dark theme must look exactly like it does today.

---

## 1. Product decisions (already made by the owner — do not change them)

1. **Default is dark.** A first-time visitor sees the site exactly as today. Light is opt-in.
   The choice is remembered on that device. Do NOT follow `prefers-color-scheme` for the
   default (the one exception is `/start`, see §6).
2. **The switch is everywhere a visitor might look for it:**
   - Desktop app shell: the top bar (`components/shell/TopBar.tsx`).
   - Phone/tablet app shell (< 1024px, the `phone` variant): the ⋯ menu / mobile nav
     (`components/shell/MobileNav.tsx`) AND the Account hub settings list
     (`components/account/AccountHub.tsx`, `components/account/SettingsList.tsx`) as an
     "Appearance" row.
   - Public pages: the header of the home page (`components/marketing/BoldLanding.tsx`), the
     content pages (`app/(content)/**`: about, guides, compare, legit, security) and the auth
     pages (`components/auth/AuthShell.tsx`: login, register, forgot/reset password, welcome).
   - It must be the SAME switch component everywhere, and one saved choice covers the whole
     site.
3. **Admin console stays dark-only.** No switch anywhere under `/admin`, and `/admin/**`
   must render fully dark even when the visitor's saved choice is light (see §3.6). Do not edit
   the admin palette in `src/app/admin/admin.css` — it is declared locked.
4. **The trading chart turns light too** in light mode: light chart background, darker grid
   and axis text, candle/line colours tuned to stay readable. See §5.
5. The brand logo keeps its Indian-flag X. Logos must never sit in a dark box or glow on light
   surfaces (the owner explicitly wants transparent, no-glow logos). See §6.

---

## 2. Read before writing any code

- Root `AGENTS.md` (deploy policy + chart-performance rule) and `apps/web/AGENTS.md`: this
  Next.js version has breaking changes. Read the relevant guide in
  `apps/web/node_modules/next/dist/docs/` before using any Next API (root layout, `<head>`
  content, `viewport`/`themeColor`, `next/script`, cookies). Heed deprecation notices.
- `docs/chart-performance-checklist.md` — required by AGENTS.md for any chart work. Apply its
  checks to the chart changes in §5.
- `apps/web/src/app/globals.css` in full (tokens in `@theme`, `color-scheme`, the custom
  variants `phone` / `land` / `wide`, the unlayered component classes such as `.sheet`,
  `.legend`, `.market-sidebar`, `.chart-attribution`).
- `apps/web/src/components/acquisition/StartTheme.tsx` and `app/start/start.module.css` — an
  existing per-page light/dark implementation (cookie-backed, avoids a flash on reload). Reuse
  what is good about it; do not copy its path-scoped cookie.

Existing conventions to keep: `components/shell/PageFrame.tsx` wraps signed-in content pages;
`.sheet` / `.sheet-phone` / `.sheet-handle` are the one bottom-sheet treatment;
`--color-brand-fill` / `-hi` is for solid buttons with white text while `--color-brand` is the
accent/link colour; unlayered classes like `.legend` need Tailwind's `!` suffix to be
overridden by utilities.

---

## 3. Theme foundation (do this first, commit it on its own)

### 3.1 Tokens are the single source of truth
- Keep the current `@theme { … }` values as the dark theme, unchanged. Make sure it stays
  `@theme` (not `@theme inline`/`static`) so utilities keep referencing `var(--color-*)` and can
  be overridden at runtime. Verify this in the built CSS, not by assumption: build once and
  confirm a utility like `bg-panel` compiles to `var(--color-panel)`.
- Add a light override block: `:root[data-theme="light"] { --color-…: …; color-scheme: light; }`.
  Use `:root[data-theme="light"]` (not bare `[data-theme]`) so it out-ranks Tailwind's
  `:root, :host` declarations regardless of source order.
- Override EVERY colour token in `@theme`, not only the ones below. If you add new tokens
  (e.g. `--color-shadow`, `--color-overlay`, `--color-candle-up`, `--color-chart-grid`,
  `--color-focus`), give them a value in BOTH themes.
- `:root` currently hard-codes `color-scheme: dark`. Make it dark by default and `light` under
  the light block, so native form controls, scrollbars, date pickers, autofill and the
  `<select>` popup follow the theme.

Starting light palette (contrast already checked: every text colour is ≥ 4.5:1 on every
light surface listed; white text is ≥ 4.6:1 on every fill). Tune by eye if needed, but
re-check contrast for any value you change, and keep the dark values untouched:

| Token | Light value | Notes |
| --- | --- | --- |
| `--color-ground` | `#f4f6f9` | page background |
| `--color-panel` | `#ffffff` | panels, cards, top bar |
| `--color-tile` | `#eef2f6` | controls, inputs, list rows |
| `--color-tile-hi` | `#e2e8ef` | hover/selected tile |
| `--color-chart` | `#ffffff` | chart surface |
| `--color-rule` | `#cfd8e3` | hairlines and borders |
| `--color-ink` | `#0b1220` | primary text (16–19:1) |
| `--color-ink-2` | `#3b4757` | secondary text (≥ 7.6:1) |
| `--color-ink-3` | `#56616f` | muted text (≥ 5.1:1) |
| `--color-brand` | `#175fcc` | accent/link text (≥ 4.8:1) |
| `--color-brand-ink` | `#ffffff` | text on brand fills |
| `--color-brand-fill` | `#1f6feb` | solid buttons, white text 4.6:1 |
| `--color-brand-fill-hi` | `#1859c4` | hover, white text 6.4:1 |
| `--color-brand-dim` | `#e1ecff` | tinted selected/active backgrounds |
| `--color-up` | `#077436` | profit/up TEXT (≥ 4.8:1); `#3be584` is ~1.6:1 on white |
| `--color-up-ink` | `#ffffff` | text on up fills (5.9:1) |
| `--color-down` | `#c8261c` | loss/down text (≥ 4.5:1) |
| `--color-down-ink` | `#ffffff` | text on down fills (5.6:1) |
| `--color-caution` | `#8f5400` | warning text; `#f5c518` is unreadable on white |
| `--color-warn-bg` | `#fdeceb` | warning/error banner background |

Because `--color-up` / `--color-down` get much darker in light mode, check every place that
uses them as a large FILL (buy/sell buttons, result cards, flashes via `color-mix`), not just
as text: buttons must still look like confident green/red buttons, not muddy ones. If one
value cannot serve both roles, split it (e.g. `--color-up-fill`) in both themes — the same way
`brand` and `brand-fill` are split today.

### 3.2 Applying the theme without a flash
- One stored value: a cookie `ixt_theme=light|dark` (`Path=/`, `Max-Age=31536000`,
  `SameSite=Lax`, `Secure` on https). Optionally mirror to `localStorage` only if you need the
  `storage` event; if you do, the cookie stays the source of truth.
- A tiny blocking inline script as the FIRST thing in `<head>` of `src/app/layout.tsx` reads
  the cookie and, only when it is exactly `light`, sets `document.documentElement.dataset.theme
  = "light"` and `style.colorScheme = "light"` before first paint. Any other value, a missing
  cookie, or an exception → leave dark. Wrap everything in `try/catch`. The CSP in
  `src/proxy.ts` allows `'unsafe-inline'` scripts, so this needs no CSP change — do not loosen
  the CSP, and do not add a nonce system.
- Add `suppressHydrationWarning` on `<html>` (the attribute legitimately differs from the
  server render).
- Do NOT call `cookies()` / `headers()` in the root layout to pick the theme: that turns every
  route dynamic and breaks static rendering of the marketing/SEO pages. The inline script is
  the mechanism.
- No JS / script blocked → the site is dark, exactly as today.

### 3.3 Theme store + hook
Create one small module (e.g. `src/lib/theme.ts` + a client hook/component) that is the only
code allowed to change the theme:
- `readTheme()`: validates strictly (`"light" | "dark"`, default `"dark"`).
- `setTheme(next)`: sets the `data-theme` attribute and `colorScheme`, writes the cookie in a
  `try/catch` (switching must still work when cookies/storage are blocked), updates
  `<meta name="theme-color">` (see 3.5), and notifies subscribers.
- `subscribe()` + a `useTheme()` hook built on `useSyncExternalStore`, with a server snapshot
  of `"dark"`, so components that need the theme in JS (the chart, canvas plugins) re-render or
  re-apply exactly once per change.
- Other open tabs pick up the change (`BroadcastChannel` when available, guarded) so two tabs
  never disagree after a reload.
- During the switch, suppress CSS transitions for one frame (add a class that sets
  `transition: none !important` on `*`, remove it after a `requestAnimationFrame`), otherwise
  every element with `transition-colors` fades at its own speed and the switch looks
  glitchy. Respect `prefers-reduced-motion` for any switch animation you add.
- Switching must never reload the page, reset scroll, close an open sheet/modal, clear a
  half-filled form, drop a websocket, or remount the chart.

### 3.4 The switch component
- One component (e.g. `components/theme/ThemeToggle.tsx`) with two presentations: an icon
  button (top bar / public headers) and a settings row ("Appearance — Dark / Light") for the
  Account hub and the phone menu.
- Accessible: a real `<button>` with `aria-pressed` or `role="switch"` + `aria-checked`, an
  `aria-label` that says what pressing will do ("Switch to light theme"), visible focus ring,
  keyboard operable, 44×44px minimum touch target on phone.
- No hydration mismatch and no icon flash: drive the sun/moon icon swap from CSS
  (`:root[data-theme="light"] .…`) rather than from state rendered on the server.
- Icons: use the project's existing icon set in `components/shell/Icon.tsx`; add sun/moon there
  in the same style if missing.
- Place it in every location listed in §1.2, matching each location's existing spacing and
  button style. On phone it must not crowd the two-row top bar or the ⋯ tool cluster.

### 3.5 Browser chrome
- `viewport.themeColor` in `layout.tsx` is `#1e2024`. Keep the server value dark, and have
  `setTheme` + the inline script update `<meta name="theme-color">` to the light ground colour
  in light mode, so the Android address bar / iOS status area matches. Make sure there is only
  one such meta tag after hydration.
- Leave `manifest.ts` colours as they are (installed-app splash stays dark).

### 3.6 Admin isolation
- `/admin/**` must be fully dark regardless of the saved choice: html/body background,
  overscroll area, `color-scheme`, scrollbars, and any component inside the admin console that
  still uses the client tokens (the `winrate` and `algorithm` admin pages do). Pick one robust
  mechanism — e.g. `.admin-root` re-declares the dark token values and `color-scheme: dark`,
  plus `html:has(.admin-root)` (or the admin layout) forcing the document background dark — and
  verify it by loading every admin page with `ixt_theme=light` set.
- Never show the switch inside admin. Never write the cookie from admin.

---

## 4. Sweep every hard-coded colour (the main source of "bugs out" spots)

Most pages use tokens (`bg-panel`, `text-ink-2`, …) and will convert automatically. The
breakage hides in hard-coded colours. These files (outside `src/app/admin/`) contain hex,
`rgb()/rgba()`, `-[#…]` arbitrary values, or `bg-/text-/border-white|black`. Audit EVERY ONE
of them, line by line:

```
src/app/(platform)/account/CurrencyConvertCard.tsx
src/app/(platform)/account/DemoBalanceForm.tsx
src/app/(platform)/account/ProfileForm.tsx
src/app/(platform)/account/verify/KycFlow.tsx
src/app/(platform)/referral/ReferralClient.tsx
src/app/(platform)/support/TicketForm.tsx
src/app/(platform)/withdrawal/HeldWithdrawalCard.tsx
src/app/(platform)/withdrawal/page.tsx
src/app/(platform)/withdrawal/WithdrawForm.tsx
src/app/checkout/[token]/*            (see §6 — verify only)
src/app/download/app/install/page.tsx
src/app/globals.css                    (e.g. .chart-attribution background #0c1425)
src/app/layout.tsx
src/app/network-blocked/page.tsx
src/app/start/start.module.css         (see §6)
src/app/telegram/telegram.module.css   (see §6 — verify only)
src/components/account/AccountHub.tsx
src/components/account/PhotoCapture.tsx
src/components/account/SettingsList.tsx
src/components/acquisition/MarketPreview.tsx
src/components/auth/AuthShell.tsx
src/components/auth/GoogleButton.tsx
src/components/chart/ChartAnalysis.module.css
src/components/chart/ChartAnalysis.tsx
src/components/chart/ChartBrackets.module.css
src/components/chart/ChartBrackets.tsx
src/components/chart/ChartTypeSelector.tsx
src/components/chart/OtcEntryLines.tsx
src/components/chart/OtcProtection.tsx
src/components/chart/plugins/hlc-area-series.ts
src/components/chart/plugins/volume-candles-series.ts
src/components/chart/PriceChart.tsx
src/components/deposit/AmountStep.tsx
src/components/deposit/BonusPreview.tsx
src/components/deposit/DepositFlow.tsx
src/components/deposit/GatewayIcon.tsx
src/components/deposit/UsdtAmountStep.tsx
src/components/festive/Diwali.module.css
src/components/festive/FirstVisitDiwali.module.css
src/components/festive/SeasonalDiwali.module.css
src/components/history/HistoryList.tsx
src/components/history/StatusTimeline.tsx
src/components/history/TransactionDetailSheet.tsx
src/components/marketing/BoldLanding.tsx
src/components/marketing/HeroDevice.tsx
src/components/marketing/LiveCandleBand.tsx
src/components/payments/KeypadSheet.tsx
src/components/pwa/GetAppBar.tsx
src/components/pwa/IosInstallSheet.tsx
src/components/shell/BottomNavBar.tsx
src/components/shell/MobileNav.tsx
src/components/shell/PlatformShell.tsx
src/components/shell/PromoBanner.tsx
src/components/shell/TopBar.tsx
src/components/trade/AssetIcon.tsx
src/components/trade/AssetTabs.tsx
src/components/trade/CfdPositionStrip.tsx
src/components/trade/CfdTradesPanel.tsx
src/components/trade/CfdTradeTicket.tsx
src/components/trade/MarketSelector.tsx
src/components/trade/MarketSidebar.tsx
src/components/trade/PositionStrip.tsx
src/components/trade/SettlementResultCard.tsx
src/components/trade/StakeSheet.tsx
src/components/trade/TradeTicket.tsx
src/components/trade/TradeWorkspace.tsx
```

Re-run your own search at the start (the list above is a snapshot; also search `.ts` files,
inline `style={{…}}` objects, SVG `fill=`/`stroke=`/`stopColor=` attributes, `data:image/svg`
URLs in CSS, canvas `fillStyle`/`strokeStyle`, GSAP tweens that animate `color`/`background`,
`box-shadow`/`drop-shadow` values, `::selection`, `caret-color`, `accent-color`, and gradients
`from-…/via-…/to-…`).

For each hard-coded colour decide, and be consistent:
- **Theme-semantic** (surface, text, border, divider, overlay tint, shadow, focus ring,
  up/down, warning) → replace with a token (existing or new, defined in both themes).
- **Fixed brand/identity colour** (payment-gateway marks and their tiles, Indian flag colours,
  per-asset/coin brand colours in `AssetIcon`, the Google "G") → keep, but check the element
  around it (border, background, text next to it) still reads on light surfaces.
- **Deliberately theme-independent** (e.g. a dark scrim behind a full-screen video) → keep
  and leave a short comment saying why.

Specific traps to check:
- `text-white` on a token background: fine on `brand-fill`/`up`/`down` fills, wrong anywhere
  the background becomes light.
- `rgba(0,0,0,…)` shadows tuned for black ground look like dirty smudges on white: use a
  softer shadow token in light mode. `rgba(255,255,255,…)` highlights/hairlines vanish on
  white: convert to `--color-rule` or a token.
- Modal/sheet backdrops: keep a dim scrim in both themes, but check the sheet itself is light.
- Gradients and fades that blend an image or section into `--color-ground` (hero, landing
  sections, ticker edges, market sidebar fade masks): in light mode a dark photo fading into
  white must still look intentional — adjust the fade or frame the image.
- Skeleton loaders, empty states, toasts, tooltips, disabled buttons, placeholder text, input
  autofill, focus rings, selected tabs, badges/pills, progress bars (bonus wagering bar),
  status timeline dots, QR code containers, keypad sheet keys, the countdown/settlement result
  card, the up/down price flash animations (`color-mix` on `--color-up/down`).
- `GoogleButton`: follow Google's sign-in branding — use their light variant (white
  background, `#1f1f1f` text, `#747775` border) in light mode and keep today's dark variant in
  dark mode.
- Festive Diwali: the first-visit full-screen video overlay (`FirstVisitDiwali`) may stay dark
  as an intentional cinematic moment; any seasonal banner/strip that sits in the page layout
  (`SeasonalDiwali`, `Diwali.module.css`) must look right on light surfaces.
- `PhotoCapture`/`KycFlow` live camera UI: camera viewfinder overlays can stay dark; the
  surrounding page, instructions and buttons must follow the theme.

---

## 5. Trading chart (lightweight-charts) — light without remounting

- Colours currently live in JS constants in `components/chart/PriceChart.tsx` (and the plugins
  and primitives listed in §4). Build one function that returns the chart palette for a theme,
  reading the resolved CSS custom properties once (`getComputedStyle(document.documentElement)`)
  per theme change — never per frame, never per tick.
- On theme change call `chart.applyOptions(...)` and each `series.applyOptions(...)` /
  primitive `requestUpdate()` with the new palette. Do NOT dispose and recreate the chart, do
  NOT resubscribe the price feed, and keep: visible range/zoom, scroll position, crosshair,
  drawings/analysis overlays, entry lines, brackets, OTC protection overlay, open-trade markers,
  the live last-price line and countdown.
- Cover every chart type in `ChartTypeSelector` (candles, line/area, HLC area, volume candles,
  whatever else exists) and every overlay: grid, axes text/borders, crosshair + its labels,
  price line, watermark, `#tv-attr-logo` / `.chart-attribution` badge, tooltips, the
  `ChartBrackets` and `ChartAnalysis` CSS modules.
- Candle colours on white: dark-mode `#3be584`/`#e5413b` are too pale/too loud on white. Use
  green/red that read clearly as candles on white (≥ 3:1 against `--color-chart`) — add
  `--color-candle-up`/`--color-candle-down` (both themes) if the text colours `--color-up/down`
  look too dark as candle bodies.
- Mini charts too: `components/acquisition/MarketPreview.tsx`,
  `components/marketing/LiveCandleBand.tsx`, `components/marketing/HeroDevice.tsx`, any
  sparkline in the market sidebar/selector.
- Follow `docs/chart-performance-checklist.md`; a theme switch must not cause a burst of
  re-renders, dropped ticks, or a stall. Measure one switch on the trade page with the engine
  running and note the result.

---

## 6. Logos, images and special pages

- **Wordmark:** `LogoWordmark` in `components/brand/Logo.tsx` uses
  `/brand/indianxtrade-wordmark.png` and `-compact.png`, which are WHITE/silver lettering on
  transparency — invisible on a light background. There is a black-lettered version,
  `/brand/indianxtrade-wordmark-light.png`, but it is 1254×410 with a solid white background
  and no tight crop. Produce `indianxtrade-wordmark-onlight.png` and
  `indianxtrade-wordmark-onlight-compact.png` (names up to you): transparent background
  (properly keyed, no white fringe/halo — check it on `#f4f6f9` AND `#ffffff` at 2×/3× zoom),
  cropped tight to the art with the same aspect ratio as the existing pair (~3.96:1 full,
  ~5.1:1 compact without the tagline row), flag X colours intact, no glow or drop shadow. Use
  `sharp` (already a dependency) or a script you keep in `scripts/`. Show the right one per
  theme with CSS (both `<Image>`s rendered, one hidden by `:root[data-theme="light"]`), not JS,
  so there is no flash and no layout shift; keep `priority` sensible (don't double-preload a
  huge image — size them sensibly).
- **Emblem:** `LogoEmblem` uses `indianxtrade-logo-dark.png` inside a rounded tile as an
  app-icon. A dark app tile on a light page is acceptable; if it looks wrong anywhere, use
  `indianxtrade-logo-light.png` (also exists) for light mode the same CSS way.
- **`/start`** already has its own light/dark system (`StartTheme`, cookie `ixt_start_theme`
  scoped to `Path=/start`, defaults to the device setting). Unify it with the global system:
  its toggle becomes the global switch and writes `ixt_theme`; if `ixt_theme` is set it wins;
  only when there is no saved choice does `/start` keep its current device-setting default
  (it is an ad landing page tuned that way). Read the old `ixt_start_theme` cookie once as a
  fallback so existing visitors keep their choice, then stop writing it. Its look in both
  themes must not change.
- **`/telegram`** is a light-only landing page with its own palette, and
  **`/checkout/[token]`** pages are already light, tinted per payment app via
  `components/deposit/checkout-theme.ts`. Leave their designs as they are; just make sure the
  global changes (body background, `color-scheme`, overscroll colour, the meta theme-color, the
  switch) don't leak into them or make anything there unreadable. No switch on checkout pages.
- **`/maintenance`** and **`/network-blocked`**: follow the saved theme; no switch needed.
- Marketing photos (`public/marketing/*.jpg|webp`) are dark images: frame them intentionally on
  light pages (rounded frame, rule border or a dark band behind them) — no harsh rectangles
  bleeding into white.

---

## 7. Robustness guard (prevents future regressions)

Add a Vitest test in `apps/web` that scans `src/**/*.{ts,tsx,css}` (excluding tests) for
hard-coded colours (hex, `rgb()/rgba()/hsl()`, Tailwind arbitrary `-[#…]`, `-white`/`-black`
colour utilities) and fails on any match that is not in an explicit allowlist. The allowlist
is a small exported map of `file → reason` (e.g. `globals.css: token definitions`,
`app/admin/**: locked dark admin theme`, `components/trade/AssetIcon.tsx: asset brand colours`,
`components/deposit/checkout-theme.ts: payment-app palettes`, `opengraph-image.tsx`,
`withdrawal-certificate.tsx`, `GoogleButton.tsx: Google branding`). Keep the allowlist as
narrow as possible — prefer per-file entries with a reason over broad globs. The test must
pass at the end and its failure message must name file:line and tell the developer to use a
token.

Also add unit tests for the theme store: invalid/missing cookie → dark; `setTheme` sets the
attribute, `color-scheme`, the meta theme-color, and the cookie; blocked `document.cookie`
(throwing setter) doesn't throw out of `setTheme`; subscribers fire once per change. Test what
the inline script does by running its exact source string against a fake `document` (export
the string from one module so the layout and the test use the same source).

---

## 8. Verify — every page, both themes, three sizes

Run and make green. Fix anything your change breaks. If something was already failing
before your change, prove it by running the same command on a clean checkout of `main` in a
temporary worktree (never use `git stash` — the stash is shared with other sessions) and
report it instead of "fixing" unrelated code:
- `pnpm lint` (repo root)
- `pnpm --filter @asm/web exec tsc --noEmit` (run `pnpm db:generate` first if Prisma types are
  stale)
- `pnpm --filter @asm/web test`
- `pnpm --filter @asm/web build`

Then a real browser pass (Playwright or the Orca browser) over EVERY route below, in BOTH
themes, at 390×844 (phone), 834×1194 (portrait tablet, uses the phone layout), and 1440×900
(desktop). Look at each screenshot yourself. Also exercise the states that only appear on
interaction: open every sheet/modal/menu/dropdown, the ⋯ menu, the market selector, the stake
keypad, a deposit flow step, the history detail sheet, toasts, form validation errors, empty
states, loading skeletons, hover and focus states (Tab through the top bar and ticket).

Routes:
```
/  /start  /telegram  /maintenance  /network-blocked  /download/app/install
/about  /guides  /guides/<one slug>  /compare  /compare/<one slug>  /legit  /security
/login  /login/welcome  /register  /register/welcome  /forgot-password  /reset-password
/trade (engine running, live chart, each chart type, with an open trade + its settlement card)
/balance  /deposit (every step, INR and USDT)  /withdrawal (form + held withdrawal card)
/history (+ detail sheet)  /leaderboard  /referral  /support
/account  /account/profile  /account/currency  /account/demo  /account/verify (KYC flow)
/checkout/<token> and /checkout/<token>/claim (verify they are unchanged)
/admin/login and every /admin/(console) page with ixt_theme=light set (must stay fully dark)
```

Theme-switch checks: switch on `/trade` with a live chart and an open position (no remount,
no lost state, no flash); switch with a sheet open and a half-filled form; reload in light
mode (no dark flash — record a throttled "Slow 4G" reload to be sure); open a second tab and
switch in the first; block cookies and switch (no exception, theme still changes for the
session); JavaScript disabled (site is dark and fully usable); console has no hydration
warnings or errors in either theme.

Local setup for signed-in pages (do NOT use the shared Supabase database in `.env` and never
touch production):
- This worktree has no `.env` files. Copy `/Users/solminde/Developer/Personal/AMScoins/asmtrading/.env`
  to this worktree's root `.env` and to `apps/web/.env` (both are gitignored — confirm with
  `git check-ignore` before writing), then in the copies: point every database URL at the local
  DB below, delete `RESEND_API_KEY`, and replace `ADMIN_PANEL_SECRET` with a local throwaway.
  Never edit the main checkout's files.
- Local Postgres listens on `localhost:5433` (Homebrew `postgresql@16`; another session runs a
  separate server on 55433 — leave it alone). Redis is on `localhost:6379`. Create a throwaway DB
  (`createdb -h localhost -p 5433 -U solminde asm_light_theme`), run
  `npx prisma migrate deploy` from `packages/db` with BOTH `DATABASE_URL` and `DIRECT_URL`
  pointing at it (`DIRECT_URL` wins in `prisma.config.ts`), then seed with
  `npx tsx prisma/seed.ts` (same env).
- Put `DATABASE_URL`, `DIRECT_URL` (and a throwaway `ADMIN_PANEL_SECRET`) in a gitignored
  `apps/web/.env.local`; never commit it. Remove any `RESEND_API_KEY` from local env so no real
  emails are sent.
- Run the web app on a free port (3000 and 3100 are often used by other sessions; use e.g.
  3260) and browse via `http://light.localhost:3260`, NOT `localhost`/`127.0.0.1` (cookie
  clashes with other local servers; Next dev blocks `/_next` on 127.0.0.1).
- Sign in by inserting a `Session` row (the DB stores sha256 of the token, see
  `src/lib/session.ts`) and setting `asm_session=<token>` as a cookie, or by registering a user
  through the UI.
- For live prices on `/trade` start the engine too: `pnpm --filter @asm/engine dev` with the
  same DB env plus `ENGINE_WS_PORT=4051 ENGINE_HTTP_PORT=4052 BOTS_ENABLED=false`, and point the
  web app at it via `NEXT_PUBLIC_ENGINE_WS_URL` / `ENGINE_HTTP_URL` in `apps/web/.env.local`.
- The platform shell scrolls an inner element, not `window`; use `el.scrollIntoView()` for
  screenshots further down a page.
- Save screenshots outside git (e.g. `/tmp/ixt-light-theme/<route>-<theme>-<size>.png`).

---

## 9. Delivery

- Commit on `feat/adding-light-theme` in logical commits as you finish each phase (foundation,
  switch, sweep, chart, logos/special pages, guard + tests) so progress survives if you are
  interrupted, and tick the progress list below in this file as you go. Do not push, do not
  open a PR, do not merge — a review comes first.
- Do not modify `src/app/admin/admin.css` palette values, `apps/mobile`, `packages/mail`,
  pricing/trading/engine logic, copy/marketing claims, or anything unrelated to theming. No
  new dependencies unless unavoidable (and say why).
- When done, reply with: what changed (by area), the final light token table, every
  hard-coded colour you deliberately kept and why, anything you could not verify or are unsure
  about, the test/build results, and the screenshot folder path.

## Progress

- [x] 0. Read the docs listed in §2
- [x] 1. Foundation: tokens, inline script, store/hook, meta theme-color, admin isolation (§3)
- [x] 2. Switch component placed in every location (§3.4)
- [x] 3. Hard-coded colour sweep, every file (§4)
- [x] 4. Chart + mini charts (§5)
- [x] 5. Logos, images, /start, special pages (§6)
- [x] 6. Guard test + theme store tests (§7)
- [x] 7. Command gates run with proven baseline exceptions + full browser pass in both themes (§8)
- [x] 8. Final report (§9)


Verification note: §8's baseline-exception path applies to repository lint and the existing missing-`BTCUSD` test fixture. Build/typecheck, theme guards and browser checks pass. See [light-theme-report.md](light-theme-report.md) for exact results, retained colours, all route screenshots and fixture limitations.
