# Light theme delivery report
Branch: `feat/adding-light-theme`. Local commits only; nothing pushed or published.
## Changes
- Shared cookie-backed theme store, blocking bootstrap, accessible shared toggle, cross-tab sync and browser chrome. Dark remains default; admin is isolated.
- Semantic surfaces, text, borders, shadows, festive decoration and media overlays across visitor and trader pages.
- Canvas/chart palette applied in place across all 11 chart types and overlays, without resubscribing the feed.
- Transparent light wordmarks; unified `/start` preference; preserved checkout/Telegram palettes.
- Source colour guard, store/bootstrap tests, token parity/contrast tests and chart lifetime tests.
## Final light token tables
The following values are the source CSS values. Fixed media/identity tokens intentionally have equal values in both themes.

### globals.css
| Token | Light value |
| --- | --- |
| `--color-chart-attribution` | `#ffffff` |
| `--color-ground` | `#f4f6f9` |
| `--color-panel` | `#ffffff` |
| `--color-tile` | `#eef2f6` |
| `--color-tile-hi` | `#e2e8ef` |
| `--color-chart` | `#ffffff` |
| `--color-rule` | `#cfd8e3` |
| `--color-ink` | `#0b1220` |
| `--color-ink-2` | `#3b4757` |
| `--color-ink-3` | `#56616f` |
| `--color-brand` | `#175fcc` |
| `--color-brand-ink` | `#ffffff` |
| `--color-brand-fill` | `#1f6feb` |
| `--color-brand-fill-hi` | `#1859c4` |
| `--color-brand-dim` | `#e1ecff` |
| `--color-up` | `#077436` |
| `--color-up-ink` | `#ffffff` |
| `--color-down` | `#c8261c` |
| `--color-down-ink` | `#ffffff` |
| `--color-caution` | `#8f5400` |
| `--color-warn-bg` | `#fdeceb` |

### theme-surfaces.css
| Token | Light value |
| --- | --- |
| `--color-mini-candle-up` | `#078358` |
| `--color-mini-candle-down` | `#c8261c` |
| `--color-surface-highlight` | `#0b1220` |
| `--color-control-rule` | `#cfd8e3` |
| `--color-control-rule-hi` | `#7d8da1` |
| `--color-shadow-soft` | `rgb(11 18 32 / .08)` |
| `--color-shadow-medium` | `rgb(11 18 32 / .10)` |
| `--color-shadow-elevated` | `rgb(11 18 32 / .14)` |
| `--color-shadow-popover` | `rgb(11 18 32 / .16)` |
| `--color-shadow-menu` | `rgb(11 18 32 / .18)` |
| `--color-shadow-floating` | `rgb(11 18 32 / .18)` |
| `--color-overlay` | `rgb(11 18 32 / .42)` |
| `--color-overlay-strong` | `rgb(11 18 32 / .48)` |
| `--color-result-hover` | `rgb(0 0 0 / .1)` |
| `--color-warning-rule` | `rgb(200 38 28 / .4)` |
| `--color-bonus-surface` | `#e8f5ec` |
| `--color-switch-thumb` | `#ffffff` |
| `--color-clock-ink` | `#0b1220` |
| `--color-asset-ring` | `#cfd8e3` |
| `--color-asset-tag` | `#e1ecff` |
| `--color-asset-tag-ink` | `#175fcc` |
| `--color-button-sheen` | `rgb(255 255 255 / .25)` |
| `--color-device-frame` | `#000000` |
| `--color-mask` | `#000000` |
| `--color-auth-ground` | `#f4f6f9` |
| `--color-auth-photo-ground` | `#000000` |
| `--color-auth-photo-fade` | `#0000004d` |
| `--color-photo-ink` | `#f4f7fb` |
| `--color-photo-accent` | `#8cbcff` |
| `--color-camera-guide` | `rgb(255 255 255 / .75)` |
| `--color-camera-dim` | `rgb(0 0 0 / .45)` |
| `--color-camera-hint` | `rgb(0 0 0 / .6)` |
| `--color-google-border` | `#747775` |
| `--color-google-surface` | `#ffffff` |
| `--color-google-ink` | `#1f1f1f` |
| `--color-google-hover` | `#f2f2f2` |
| `--color-live-halo` | `rgb(7 116 54 / .15)` |
| `--color-live-halo-subtle` | `rgb(7 116 54 / .12)` |
| `--color-festive-edge` | `#9b610e` |
| `--color-festive-light` | `#b37719` |
| `--color-festive-chakra-edge` | `#a36600` |
| `--color-festive-chakra-gold` | `#b16d10` |
| `--color-festive-chakra-red` | `#9d2828` |
| `--color-festive-chakra-glow` | `#b16d1026` |
| `--color-festive-trail` | `#a36600` |
| `--color-festive-flame-core` | `#fff1c2` |
| `--color-festive-flame-mid` | `#efb84b` |
| `--color-festive-flame-tip` | `#c56515` |
| `--color-festive-flame-glow` | `#bb721e33` |
| `--color-festive-bowl-edge` | `#9b641f` |
| `--color-festive-bowl-rim` | `#b77a24` |
| `--color-festive-bowl` | `#9c531d` |
| `--color-festive-bowl-stripe` | `#ce8932` |
| `--color-festive-bowl-glow` | `#ac69171a` |
| `--color-festive-spark` | `#9b610e` |
| `--color-festive-accent` | `#8a570a` |
| `--color-festive-wire` | `#8a570a59` |
| `--color-festive-lamp-glow` | `#8a570a26` |
| `--color-festive-lamp-glow-soft` | `#8a570a1f` |
| `--color-festive-hover` | `#8a570a0d` |
| `--color-festive-wish` | `#8a570a` |
| `--color-festive-spark-blue` | `#175fcc` |
| `--color-festive-text-shadow` | `#f4f6f9` |
| `--color-gift-wrap` | `#c78e17` |
| `--color-gift-shade` | `#a36b10` |
| `--color-gift-ribbon` | `#e3ad38` |
| `--color-shadow-dialog` | `rgb(11 18 32 / .18)` |
| `--color-festive-backdrop` | `rgb(11 18 32 / .48)` |

### theme-chart.css
| Token | Light value |
| --- | --- |
| `--color-chart-classic` | `#ffffff` |
| `--color-chart-market` | `#ffffff` |
| `--color-chart-axis` | `#56616f` |
| `--color-chart-market-axis` | `#56616f` |
| `--color-chart-grid` | `#e2e8ef` |
| `--color-chart-market-grid` | `#e2e8ef` |
| `--color-chart-border` | `#cfd8e3` |
| `--color-chart-crosshair` | `rgba(23, 95, 204, 0.5)` |
| `--color-chart-market-crosshair` | `#56616f` |
| `--color-chart-crosshair-label` | `#3b4757` |
| `--color-chart-accent` | `#175fcc` |
| `--color-chart-label-ink` | `#ffffff` |
| `--color-candle-up` | `#078358` |
| `--color-candle-down` | `#c8261c` |
| `--color-chart-volume-default-up` | `#078358` |
| `--color-chart-volume-default-down` | `#c8261c` |
| `--color-chart-hlc-close` | `#3b4757` |
| `--color-chart-watermark` | `rgba(23, 95, 204, 0.06)` |
| `--color-chart-baseline-up` | `#078358` |
| `--color-chart-baseline-down` | `#c8261c` |
| `--color-chart-drawing` | `#175fcc` |
| `--color-chart-drawing-active` | `#174da1` |
| `--color-chart-drawing-fill` | `#175fcc18` |
| `--color-chart-handle` | `#ffffff` |
| `--color-chart-sma` | `#946000` |
| `--color-chart-ema` | `#7952c6` |
| `--color-chart-rsi` | `#087ca7` |
| `--color-chart-tool` | `#3b4757` |
| `--color-chart-tool-hover` | `#0b1220` |
| `--color-chart-tool-active` | `#175fcc` |
| `--color-chart-bracket-bg` | `#ffffff` |
| `--color-chart-bracket-border` | `#cfd8e3` |
| `--color-chart-bracket-text` | `#3b4757` |
| `--color-chart-bracket-muted` | `#56616f` |
| `--color-chart-buy` | `#175fcc` |
| `--color-chart-focus` | `#175fcc` |
| `--color-chart-bracket-hover-ink` | `#0b1220` |
| `--color-chart-bracket-pending` | `#eef2f6` |
| `--color-chart-bracket-warning` | `#8f5400` |
| `--color-chart-bracket-warning-border` | `#b77a24` |
| `--color-chart-bracket-strong` | `#0b1220` |
| `--color-chart-bracket-input-border` | `#a6b3c3` |
| `--color-chart-hud-bg` | `#fffffff0` |
| `--color-chart-hud-ink` | `#0b1220` |
| `--color-chart-hud-dot` | `#087ca7` |
| `--chart-outline-shadow` | `0 0 0 1px rgba(21,40,66,.08)` |
| `--chart-editor-shadow` | `-8px 0 28px #1528421a` |
| `--chart-popover-shadow` | `0 10px 30px #15284224` |
| `--chart-edge-shadow` | `0 2px 10px #15284224` |
| `--chart-sheet-shadow` | `0 -20px 80px #15284233` |
| `--chart-hud-shadow` | `0 4px 20px rgba(21,40,66,.15)` |
| `--chart-selector-shadow` | `0 24px 48px -12px rgba(21,40,66,.22)` |
| `--chart-selected-shadow` | `0 0 8px rgba(23,95,204,.16)` |
| `--chart-dot-shadow` | `0 0 8px #087ca733` |
| `--chart-backdrop` | `#15284266` |

## Intentionally retained colours
The exact UI artwork/cinematic inventory is in [theme-sweep-kept.md](theme-sweep-kept.md). The guard exceptions are exported in `apps/web/src/lib/color-guard.ts`.
Additional special-page and image colour literals, grouped by owning file:

- `app/start/start.module.css`: `#101b2d`, `#3c506f`, `#edf3fe`, `#2c3b53`, `#152238`, `#9abfff`, `#a7b6ce`, `#b9d2ff`, `#45628c`, `#29384f`, `#f0f5ff`, `#7cafff`, `#40516b`, `#d5e2f6`, `#8a9bb5`, `#9bacc5`, `#2a3950`, `#95a7c0`, `#d3def0`, `#7fa9eb`, `#253249`, `#a5b4cb`, `#263247`, `#61c7b0`, `#dd8b91`, `#629afa`, `#fff`, `#ffffff`, `#bfcde0`, `#142137`, `#d5deeb`, `#edf2f9`, `#2164dc`, `#56657b`, `#245596`, `#a9c2e6`, `#bdcadd`, `#334c70`, `#087a60`, `#b33849`, `#f5f7fb`, `#e8edf5`, `#dce8ff`, `#b7cdf1`, `#31496b30`, `#0a101b`, `#edf3fd`, `#a1b0c7`, `#25334a`, `#131f32`, `#293c59`, `#102b57`, `#254e82`, `#84b1ff`, `#00000070`, `#709fff`, `#80aaff`, `#3378f0`, `#1b58d0`, `#1f61d32b`, `#ffffff40`, `#123d9a55`, `#1f61d345`, `#ffffff50`, `#ffffff30`, `#ffffff14`, `#315493`, `#e9f2ff`, `#5c452a`, `#f5cd8c`, `#24584e`, `#b2ebd4`, `#194db1`, `#f1f6ff`, `#ffffff20`, `#ffffff06`, `#ffffff04`, `#c7d9fc`, `#f3f6ff`, `#15346b`, `#10368130`, `#1c56be0c`, `#1c56be20`.

- `app/theme-special.css`: `#0a101b`, `#25334a`, `#f5f7fb`, `#d5deeb`, `#f8fbff`, `#d9e5ef`, `#f0f8f5`, `#b9dcce`, `#f3eef9`, `#d8c7ea`, `#f1f6fe`, `#c8dcf9`, `#eef5fb`, `#b9ddf0`, `#fff6ec`, `#f7cfa1`, `#f6f4fb`, `#ddd3ee`.

- `app/telegram/telegram.module.css`: `#0b1c33`, `#4e6279`, `#d9e5ef`, `#2481cc`, `#176cb1`, `#f8fbff`, `#175f9d`, `#fff`, `#2481cc32`, `#255b89`, `#deeffc`, `#09285a`, `#123c7370`, `#b1dfff55`, `#f4faff`, `#0a2546`, `#04112d75`, `#12365c`, `#e1f4ff`, `#2aabee`, `#229ed9`, `#bed6ec`, `#a8d5ff55`, `#edf5fc`, `#caddeb`, `#1668a7`, `#d9eefa`.

- `app/manifest.ts`: `#1e2024`.

- `app/opengraph-image.tsx`: `#000`, `#e8e6e1`, `#9e9b95`.

- `lib/withdrawal-certificate.tsx`: `rgb(3,21,78)`, `rgb(10,74,185)`.

- `components/deposit/checkout-theme.ts`: `#f3eef9`, `#ffffff`, `#5F259F`, `#2a1559`, `#75678f`, `#d8c7ea`, `#f1f6fe`, `#1A73E8`, `#202124`, `#5f6368`, `#eaf2fe`, `#c8dcf9`, `#eef5fb`, `#20336B`, `#5a6880`, `#e4f3fb`, `#b9ddf0`, `#00BAF2`, `#fff6ec`, `#097939`, `#1a1a1a`, `#5a5a5a`, `#fff2e0`, `#f7cfa1`, `#c25a00`, `#f0f8f5`, `#26A17B`, `#163e2f`, `#5a7a6c`, `#e5f1ec`, `#b9dcce`, `#1b7e5e`.

- `app/checkout/[token]/UsdtClaimForm.tsx`: `#efe7fb`, `#4b2d86`, `#6b5a8a`, `#5b2d9e`, `#d8cdf0`, `bg-white`, `#241436`, `#f6f1ff`, `#b8384c`, `text-white`.

- `app/checkout/[token]/BackCancelGuard.tsx`: `bg-black/55`, `bg-white`, `#1a1a1a`, `#5f6368`, `text-white`, `#dadce0`.

- `app/checkout/[token]/DepositResult.tsx`: `#5b2d9e`, `text-white`, `#4b2d86`, `bg-white`, `#6b5a8a`, `#e6f6ec`, `#15803d`, `#fdecef`, `#b8384c`, `#fff7ed`, `#c2410c`.

- `app/checkout/[token]/ClaimForm.tsx`: `#efe7fb`, `#4b2d86`, `#6b5a8a`, `#5b2d9e`, `#e4f6ea`, `#1f6b3a`, `#4a7a5b`, `#d8cdf0`, `bg-white`, `#241436`, `#f6f1ff`, `#b8384c`, `text-white`.

- `app/checkout/[token]/page.tsx`: `#ffffff`, `#c2410c`, `#fff7ed`, `#9a3412`.

- `app/checkout/[token]/UpiStatusPoller.tsx`: `bg-white`, `#241436`, `#5b2d9e`, `#6b5a8a`, `#8a7aa8`, `#b8384c`, `#ffffff`.

- `app/checkout/[token]/UsdtStatusPoller.tsx`: `bg-white`, `#fdecef`, `#f6f1ff`, `#b8384c`, `#5b2d9e`, `#241436`, `#8a7aa8`, `#efe7fb`.

- `app/checkout/[token]/claim/page.tsx`: `#f6f4fb`, `#241436`, `#5b2d9e`, `#6b5a8a`, `bg-white`, `#c2410c`, `#fff7ed`, `#9a3412`, `#f6f1ff`, `#4b2d86`, `#8a7aa8`.

These remain fixed because `/telegram` and hosted checkout explicitly keep their approved light/payment palettes; `/start` retains its scoped approved dual palette and branded illustrations; manifest, OG and certificate exports are explicitly outside scope. The admin palette remains untouched and dark-only. `chart-palette.ts` serializes resolved token channels into `rgba()` strings for canvas; it contains no hard-coded palette. Alpha masks retain opaque black because only their alpha is used.

## Validation

- `pnpm --filter @asm/web build`: passed; static public routes remain static. Built `.bg-panel` references `var(--color-panel)`. All JavaScript-read dark chart tokens are retained in production CSS and protected by a compilation test.
- `pnpm --filter @asm/web exec tsc --noEmit`: passed.
- `pnpm --filter @asm/web test`: 652 passed, 1 pre-existing failure: `GET /api/trades > lists only the caller's own trades, as trade views` expects a `BTCUSD` asset absent from the seed. The same failure reproduced in clean `main` and the exact pre-change baseline; no trading code changed to hide it.
- `pnpm lint`: remains failing on pre-existing repository errors. The exact pre-change baseline has 1,771 errors; this branch has 1,770, with zero new errors. Current local `main` is older (`f937b9c`) and also fails lint; the matching starting commit (`2b49299`) was checked separately for an accurate comparison.
- Theme-specific tests cover strict/blocked cookies, exact bootstrap source, `/start` precedence, admin isolation, cross-tab updates, metadata hydration/streaming, all token pairs, light text/button contrast and chart lifetime across all 11 chart types. Automated DOM tests do not constitute browser FPS measurements.
- Baseline worktree: `/Users/solminde/orca/workspaces/asmtrading/light-theme-baseline`. Evidence logs: `/tmp/theme-final-test.log`, `/tmp/theme-final-tsc.log`, `/tmp/theme-final-lint-comparison.json`, `/tmp/theme-build-final.log`, `/tmp/theme-baseline-tests.log`, `/tmp/theme-base-tests.log`.

The initial copied environment inherited a remote Redis URL, which I discovered while diagnosing local admin sessions and corrected. Final verification uses only local Postgres on port 5433 and local Redis database 15. The initial test runs were therefore not fully isolated at the Redis layer; no shared Supabase database was used, and `RESEND_API_KEY` was removed before any run.

### Browser robustness and chart measurement

The production Playwright suite passed **8/8** checks. It covers saved choice and form preservation, two-tab broadcast, throwing cookie setters, `/start` global/legacy/device precedence, JavaScript-disabled dark rendering, a Slow 4G reload, an open mobile menu with a half-filled support draft, and all eleven live chart types in both themes.

- All 22 chart palette captures retain the same canvases and `125` ticket draft. One engine WebSocket connection received 159 frames with zero closes.
- One bounded switch: 2.7 ms synchronous handler time, 3.8 ms to the next animation frame; p95 of 30 sampled frame intervals was 17.5 ms, with zero long tasks over 50 ms. This is headless Chromium browser timing on this machine, **not** an actual-device FPS guarantee or a claim that every frame meets 16 ms.
- Slow 4G: all 83 sampled rendered frames (774–2126 ms) were light with the correct ground colour. The hydrated page has one theme-colour meta tag and one wordmark preload. No page errors or hydration warnings were observed.
- Phone support draft and menu identity survived switching; scroll position stayed 123 → 123.

[Exact browser chart metrics](/tmp/ixt-light-theme/robustness-results/theme-robustness-all-chart-612fa-t-and-retain-a-ticket-draft-chromium/live-chart-theme-evidence.json) · [Slow 4G screenshot](/tmp/ixt-light-theme/robustness-results/theme-robustness-Slow-4G-s-e7539-trap-before-rendered-frames-chromium/slow-4g-light.png) · [Slow 4G recording](/tmp/ixt-light-theme/robustness-results/theme-robustness-Slow-4G-s-e7539-trap-before-rendered-frames-chromium/video.webm)

The durable browser test is `apps/web/e2e/theme-robustness.spec.ts`, configured by `apps/web/playwright.theme.config.ts`. It requires an already-running local app; protected-page checks opt in with a local storage-state path. It performs no database seeding or external payments.


## Screenshots

`/tmp/ixt-light-theme/` (outside Git).

## Route verification screenshots

[Open the complete standalone gallery with all 324 screenshots](/tmp/ixt-light-theme/verification-gallery.html) · [Machine-readable verification manifest](/tmp/ixt-light-theme/verification-manifest.json) · [Visual review notes](/tmp/ixt-light-theme/matrix-review.md)

54 routes × dark/light × phone (390×844), tablet (834×1194), desktop (1440×900). Every final response was HTTP 200; no document overflow or hydration/runtime errors were recorded. Admin stays dark in the saved-light captures. Welcome routes are redirect hops to the signed-in workspace. Reset-password without a token and download without an APK show their real empty/unavailable states. Checkout uses a local throwaway fixture; no transfer was sent.

| Route | Dark phone | Light phone | Dark tablet | Light tablet | Dark desktop | Light desktop |
|---|---|---|---|---|---|---|
| / | [dark phone](/tmp/ixt-light-theme/home-dark-phone.png) | [light phone](/tmp/ixt-light-theme/home-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/home-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/home-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/home-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/home-light-desktop.png) |
| /start | [dark phone](/tmp/ixt-light-theme/start-dark-phone.png) | [light phone](/tmp/ixt-light-theme/start-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/start-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/start-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/start-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/start-light-desktop.png) |
| /telegram | [dark phone](/tmp/ixt-light-theme/telegram-dark-phone.png) | [light phone](/tmp/ixt-light-theme/telegram-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/telegram-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/telegram-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/telegram-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/telegram-light-desktop.png) |
| /maintenance | [dark phone](/tmp/ixt-light-theme/maintenance-dark-phone.png) | [light phone](/tmp/ixt-light-theme/maintenance-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/maintenance-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/maintenance-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/maintenance-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/maintenance-light-desktop.png) |
| /network-blocked | [dark phone](/tmp/ixt-light-theme/network-blocked-dark-phone.png) | [light phone](/tmp/ixt-light-theme/network-blocked-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/network-blocked-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/network-blocked-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/network-blocked-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/network-blocked-light-desktop.png) |
| /download/app/install | [dark phone](/tmp/ixt-light-theme/download-app-install-dark-phone.png) | [light phone](/tmp/ixt-light-theme/download-app-install-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/download-app-install-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/download-app-install-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/download-app-install-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/download-app-install-light-desktop.png) |
| /about | [dark phone](/tmp/ixt-light-theme/about-dark-phone.png) | [light phone](/tmp/ixt-light-theme/about-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/about-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/about-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/about-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/about-light-desktop.png) |
| /guides | [dark phone](/tmp/ixt-light-theme/guides-dark-phone.png) | [light phone](/tmp/ixt-light-theme/guides-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/guides-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/guides-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/guides-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/guides-light-desktop.png) |
| /guides/how-trading-works | [dark phone](/tmp/ixt-light-theme/guides-how-trading-works-dark-phone.png) | [light phone](/tmp/ixt-light-theme/guides-how-trading-works-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/guides-how-trading-works-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/guides-how-trading-works-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/guides-how-trading-works-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/guides-how-trading-works-light-desktop.png) |
| /compare | [dark phone](/tmp/ixt-light-theme/compare-dark-phone.png) | [light phone](/tmp/ixt-light-theme/compare-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/compare-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/compare-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/compare-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/compare-light-desktop.png) |
| /compare/asm-trader-vs-quotex | [dark phone](/tmp/ixt-light-theme/compare-asm-trader-vs-quotex-dark-phone.png) | [light phone](/tmp/ixt-light-theme/compare-asm-trader-vs-quotex-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/compare-asm-trader-vs-quotex-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/compare-asm-trader-vs-quotex-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/compare-asm-trader-vs-quotex-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/compare-asm-trader-vs-quotex-light-desktop.png) |
| /legit | [dark phone](/tmp/ixt-light-theme/legit-dark-phone.png) | [light phone](/tmp/ixt-light-theme/legit-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/legit-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/legit-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/legit-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/legit-light-desktop.png) |
| /security | [dark phone](/tmp/ixt-light-theme/security-dark-phone.png) | [light phone](/tmp/ixt-light-theme/security-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/security-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/security-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/security-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/security-light-desktop.png) |
| /login | [dark phone](/tmp/ixt-light-theme/login-dark-phone.png) | [light phone](/tmp/ixt-light-theme/login-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/login-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/login-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/login-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/login-light-desktop.png) |
| /login/welcome | [dark phone](/tmp/ixt-light-theme/login-welcome-dark-phone.png) | [light phone](/tmp/ixt-light-theme/login-welcome-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/login-welcome-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/login-welcome-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/login-welcome-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/login-welcome-light-desktop.png) |
| /register | [dark phone](/tmp/ixt-light-theme/register-dark-phone.png) | [light phone](/tmp/ixt-light-theme/register-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/register-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/register-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/register-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/register-light-desktop.png) |
| /register/welcome | [dark phone](/tmp/ixt-light-theme/register-welcome-dark-phone.png) | [light phone](/tmp/ixt-light-theme/register-welcome-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/register-welcome-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/register-welcome-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/register-welcome-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/register-welcome-light-desktop.png) |
| /forgot-password | [dark phone](/tmp/ixt-light-theme/forgot-password-dark-phone.png) | [light phone](/tmp/ixt-light-theme/forgot-password-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/forgot-password-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/forgot-password-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/forgot-password-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/forgot-password-light-desktop.png) |
| /reset-password | [dark phone](/tmp/ixt-light-theme/reset-password-dark-phone.png) | [light phone](/tmp/ixt-light-theme/reset-password-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/reset-password-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/reset-password-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/reset-password-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/reset-password-light-desktop.png) |
| /trade | [dark phone](/tmp/ixt-light-theme/trade-dark-phone.png) | [light phone](/tmp/ixt-light-theme/trade-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/trade-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/trade-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/trade-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/trade-light-desktop.png) |
| /balance | [dark phone](/tmp/ixt-light-theme/balance-dark-phone.png) | [light phone](/tmp/ixt-light-theme/balance-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/balance-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/balance-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/balance-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/balance-light-desktop.png) |
| /deposit | [dark phone](/tmp/ixt-light-theme/deposit-dark-phone.png) | [light phone](/tmp/ixt-light-theme/deposit-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/deposit-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/deposit-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/deposit-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/deposit-light-desktop.png) |
| /withdrawal | [dark phone](/tmp/ixt-light-theme/withdrawal-dark-phone.png) | [light phone](/tmp/ixt-light-theme/withdrawal-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/withdrawal-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/withdrawal-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/withdrawal-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/withdrawal-light-desktop.png) |
| /history | [dark phone](/tmp/ixt-light-theme/history-dark-phone.png) | [light phone](/tmp/ixt-light-theme/history-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/history-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/history-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/history-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/history-light-desktop.png) |
| /leaderboard | [dark phone](/tmp/ixt-light-theme/leaderboard-dark-phone.png) | [light phone](/tmp/ixt-light-theme/leaderboard-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/leaderboard-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/leaderboard-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/leaderboard-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/leaderboard-light-desktop.png) |
| /referral | [dark phone](/tmp/ixt-light-theme/referral-dark-phone.png) | [light phone](/tmp/ixt-light-theme/referral-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/referral-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/referral-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/referral-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/referral-light-desktop.png) |
| /support | [dark phone](/tmp/ixt-light-theme/support-dark-phone.png) | [light phone](/tmp/ixt-light-theme/support-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/support-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/support-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/support-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/support-light-desktop.png) |
| /account | [dark phone](/tmp/ixt-light-theme/account-dark-phone.png) | [light phone](/tmp/ixt-light-theme/account-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/account-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/account-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/account-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/account-light-desktop.png) |
| /account/profile | [dark phone](/tmp/ixt-light-theme/account-profile-dark-phone.png) | [light phone](/tmp/ixt-light-theme/account-profile-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/account-profile-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/account-profile-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/account-profile-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/account-profile-light-desktop.png) |
| /account/currency | [dark phone](/tmp/ixt-light-theme/account-currency-dark-phone.png) | [light phone](/tmp/ixt-light-theme/account-currency-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/account-currency-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/account-currency-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/account-currency-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/account-currency-light-desktop.png) |
| /account/demo | [dark phone](/tmp/ixt-light-theme/account-demo-dark-phone.png) | [light phone](/tmp/ixt-light-theme/account-demo-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/account-demo-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/account-demo-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/account-demo-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/account-demo-light-desktop.png) |
| /account/verify | [dark phone](/tmp/ixt-light-theme/account-verify-dark-phone.png) | [light phone](/tmp/ixt-light-theme/account-verify-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/account-verify-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/account-verify-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/account-verify-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/account-verify-light-desktop.png) |
| /checkout/theme-usdt-fixture | [dark phone](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-dark-phone.png) | [light phone](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-light-desktop.png) |
| /checkout/theme-usdt-fixture/claim | [dark phone](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-claim-dark-phone.png) | [light phone](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-claim-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-claim-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-claim-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-claim-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/checkout-theme-usdt-fixture-claim-light-desktop.png) |
| /admin/login | [dark phone](/tmp/ixt-light-theme/admin-login-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-login-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-login-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-login-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-login-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-login-light-desktop.png) |
| /admin | [dark phone](/tmp/ixt-light-theme/admin-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-light-desktop.png) |
| /admin/affiliates | [dark phone](/tmp/ixt-light-theme/admin-affiliates-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-affiliates-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-affiliates-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-affiliates-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-affiliates-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-affiliates-light-desktop.png) |
| /admin/affiliates/new | [dark phone](/tmp/ixt-light-theme/admin-affiliates-new-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-affiliates-new-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-affiliates-new-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-affiliates-new-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-affiliates-new-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-affiliates-new-light-desktop.png) |
| /admin/algorithm | [dark phone](/tmp/ixt-light-theme/admin-algorithm-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-algorithm-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-algorithm-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-algorithm-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-algorithm-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-algorithm-light-desktop.png) |
| /admin/approvals | [dark phone](/tmp/ixt-light-theme/admin-approvals-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-approvals-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-approvals-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-approvals-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-approvals-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-approvals-light-desktop.png) |
| /admin/audit | [dark phone](/tmp/ixt-light-theme/admin-audit-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-audit-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-audit-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-audit-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-audit-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-audit-light-desktop.png) |
| /admin/deposits | [dark phone](/tmp/ixt-light-theme/admin-deposits-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-deposits-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-deposits-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-deposits-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-deposits-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-deposits-light-desktop.png) |
| /admin/fraud | [dark phone](/tmp/ixt-light-theme/admin-fraud-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-fraud-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-fraud-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-fraud-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-fraud-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-fraud-light-desktop.png) |
| /admin/house-pnl | [dark phone](/tmp/ixt-light-theme/admin-house-pnl-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-house-pnl-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-house-pnl-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-house-pnl-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-house-pnl-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-house-pnl-light-desktop.png) |
| /admin/kyc | [dark phone](/tmp/ixt-light-theme/admin-kyc-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-kyc-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-kyc-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-kyc-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-kyc-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-kyc-light-desktop.png) |
| /admin/kyc/b58f1f77-cf98-49a4-809c-55def8803295 | [dark phone](/tmp/ixt-light-theme/admin-kyc-b58f1f77-cf98-49a4-809c-55def8803295-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-kyc-b58f1f77-cf98-49a4-809c-55def8803295-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-kyc-b58f1f77-cf98-49a4-809c-55def8803295-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-kyc-b58f1f77-cf98-49a4-809c-55def8803295-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-kyc-b58f1f77-cf98-49a4-809c-55def8803295-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-kyc-b58f1f77-cf98-49a4-809c-55def8803295-light-desktop.png) |
| /admin/markets | [dark phone](/tmp/ixt-light-theme/admin-markets-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-markets-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-markets-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-markets-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-markets-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-markets-light-desktop.png) |
| /admin/messages | [dark phone](/tmp/ixt-light-theme/admin-messages-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-messages-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-messages-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-messages-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-messages-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-messages-light-desktop.png) |
| /admin/reconciliation | [dark phone](/tmp/ixt-light-theme/admin-reconciliation-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-reconciliation-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-reconciliation-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-reconciliation-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-reconciliation-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-reconciliation-light-desktop.png) |
| /admin/settings | [dark phone](/tmp/ixt-light-theme/admin-settings-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-settings-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-settings-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-settings-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-settings-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-settings-light-desktop.png) |
| /admin/users | [dark phone](/tmp/ixt-light-theme/admin-users-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-users-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-users-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-users-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-users-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-users-light-desktop.png) |
| /admin/users/b58f1f77-cf98-49a4-809c-55def8803295 | [dark phone](/tmp/ixt-light-theme/admin-users-b58f1f77-cf98-49a4-809c-55def8803295-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-users-b58f1f77-cf98-49a4-809c-55def8803295-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-users-b58f1f77-cf98-49a4-809c-55def8803295-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-users-b58f1f77-cf98-49a4-809c-55def8803295-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-users-b58f1f77-cf98-49a4-809c-55def8803295-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-users-b58f1f77-cf98-49a4-809c-55def8803295-light-desktop.png) |
| /admin/withdrawals | [dark phone](/tmp/ixt-light-theme/admin-withdrawals-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-withdrawals-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-withdrawals-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-withdrawals-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-withdrawals-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-withdrawals-light-desktop.png) |
| /admin/winrate | [dark phone](/tmp/ixt-light-theme/admin-winrate-dark-phone.png) | [light phone](/tmp/ixt-light-theme/admin-winrate-light-phone.png) | [dark tablet](/tmp/ixt-light-theme/admin-winrate-dark-tablet.png) | [light tablet](/tmp/ixt-light-theme/admin-winrate-light-tablet.png) | [dark desktop](/tmp/ixt-light-theme/admin-winrate-dark-desktop.png) | [light desktop](/tmp/ixt-light-theme/admin-winrate-light-desktop.png) |

## Live demo order and final layout checks

A real local DEMO BTC/USDT order opened successfully (HTTP 201, ₹100 stake, 30-second duration) and the engine settled it with `CLOSED`/`DURATION`. Switching while open and again while its settlement card was visible retained the same canvases in all four checks. The connection stayed open (one WebSocket, zero closes, 170 received frames), with no page errors. This was local demo money only. The local seed needed a temporary house-treasury balance to permit execution; its original zero value was restored afterwards. No trading or engine code was changed.

[Lifecycle evidence](/tmp/ixt-light-theme/open-position-evidence.json)

| State | Dark screenshot | Light screenshot |
| --- | --- | --- |
| Open position | [Dark](/tmp/ixt-light-theme/open-position-dark-desktop.png) | [Light](/tmp/ixt-light-theme/open-position-light-desktop.png) |
| Engine settlement card | [Dark](/tmp/ixt-light-theme/settled-position-dark-desktop.png) | [Light](/tmp/ixt-light-theme/settled-position-light-desktop.png) |

Final production `/start` check at 834×1194: both segmented buttons are 44px tall; one wordmark preload; the skip link remains off-screen at page top and bottom, appearing only on keyboard focus. The apparent skip-link placement in some full-page captures is a fixed-position screenshot artifact, not the live layout. [Measurements](/tmp/ixt-light-theme/states/start-final-checks.json)

## Interaction screenshots and practical limits

[Open the supplemental gallery with 264 embedded screenshots](/tmp/ixt-light-theme/supplemental-gallery.html) · [Supplemental manifest](/tmp/ixt-light-theme/supplemental-manifest.json) · [Detailed coverage notes](/tmp/ixt-light-theme/supplemental-review.md)

This adds 178 interaction/state screenshots, 60 scrolled full-page screenshots, 22 chart-type screenshots and the four actual demo lifecycle screenshots to the 324-route gallery: **588 screenshots across the two galleries**. All were visually reviewed. Coverage includes market selection, account menus, keyboard focus/hover, keypads, history details, validation, empty/loading states, KYC steps, camera capture/review, held withdrawal steps and a saved-profile toast. The final six keyboard checks asserted `:focus-visible` and 44×44px switch targets.

Limits are explicit:

- The existing local receiving configuration disables INR rails and hides USDT. Real amount/keypad/method/disabled states were checked. Twelve payment-review screenshots use browser-only receiving-configuration fixtures to inspect the pay-step UI. No payment, gateway address or transfer was created; live payment-provider integration was not verified.
- KYC uses isolated local users, synthetic document blobs and Chromium's fake camera. Camera capture/review was exercised; no real camera hardware, upload or KYC submission was verified.
- HELD withdrawal is a local database fixture. Amount, destination and review were exercised; no withdrawal or cancellation was submitted.
- The current CFD runtime does not mount the legacy binary `StakeSheet`. The active CFD investment field and payment keypad were verified; the unmounted binary sheet is covered by the semantic-colour sweep, not a live-route interaction.
- Browser coverage is Chromium at the three requested viewports. Physical iOS/Android device rendering and frame rate were not measured.
- Main checkout retains the pre-existing missing `.svg` logo probe before the raster fallback loads. It produced a resource 404, with no runtime/hydration error or missing final logo.
- Repository lint and the one fixture-dependent unit test remain failing only for proven baseline reasons. The full-suite count above predates one additional metadata-attribute regression test; that later targeted theme suite passed all 30 tests. The final production build includes every source commit and passed TypeScript.

The admin palette, mobile app, mail package, pricing/trading/engine logic, manifest, OG image and certificate artwork were not changed. No dependencies were added. All implementation phases and this report are committed on `feat/adding-light-theme`; nothing was pushed, opened as a PR or deployed.
