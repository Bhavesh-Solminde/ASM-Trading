# Dashboard implementation and verification

11 November 2026 · Local implementation verified; not deployed.

The custom drawing toolbar and SMA/EMA/RSI panel are retained, as requested. Mobile Buy/Sell remains below the chart in normal and fullscreen views. Selected-market bot P&L has been removed, including its polling, API and dedicated quote helper. The affiliate program remains deferred.

Open [the screenshot gallery](index.html) to review each requirement. Full-size originals, captions, viewport/browser details, and before images are included. The screenshots use a production build and a separate local demo database. An unrelated seasonal greeting is marked already seen in the test browser so it does not cover the feature being verified.

There are now 10 active requirements and 71 screenshots. The removed bot summary has no display or polling in normal/fullscreen desktop and phone layouts; the browser suite verifies that its API returns 404.

## What changed and how to check it

| Item | Delivered behavior | Repeatable review |
| --- | --- | --- |
| F01 Chart tools | Select, horizontal/trend lines, parallel channels, Fibonacci, freehand, text, measurement, zoom/fit, delete/undo, and SMA/EMA/RSI. The toolbar now uses original outline SVGs with consistent strokes and endpoint handles, following the supplied reference. Drawings and indicator choices are saved per account/market. | Create a drawing, drag its handles, delete/undo it, add indicators, then refresh. Enter phone fullscreen: the tool rail is available and Buy/Sell remains below the chart. |
| F02 Chart logo | The TradingView mark is centered in a 36×36px circular linked badge at the lower-left of the chart. This is a visual attribution badge, separate from chart controls. | Compare normal/fullscreen phone images and open the badge link. |
| F03 Deposit promotion | Existing eligible bonus rules drive the dismissible dialogue. It waits for an idle trading screen, supports ×/Escape/focus containment, and remembers dismissal. | On a fresh eligible session, wait 20 seconds without editing or opening another dialogue. Dismiss, reload, and confirm it remains dismissed. |
| F04 Wide sidebar | Persistent searchable market list on sufficiently wide screens; compact picker elsewhere. It shares the existing quote connection. | Compare 1920px, desktop, tablet and phone captures; select a different market. |
| F05 SEO | Shared 30-market count and commodity coverage in landing copy, metadata and relevant FAQ content. | Compare the previous 18-market landing with the new page; inspect [extracted metadata](seo-metadata.json). This is not a claim that search engines have reindexed it. |
| F06 Popular | BTC, Gold, Silver, WTI and Brent appear in Popular when present in the catalogue. | Compare sidebar/mobile picker, switch to Silver, and use All to access all 30 definitions. |
| F07 Investment | The original five-character field clipped the leading digit of 100000; the underlying numeric amount was not actually zero. Fields now expand, share validated parsing, reject malformed/over-limit input with feedback, and preserve saved values. | Compare original and new images. Type/paste ₹1,00,000; enter/exit fullscreen and refresh. Browser tests used the actual Buy action and verified exactly 10,000,000 minor units in the local engine/database. |
| F09 History | Completed rows open a shared detail panel. It shows entry/exit, recorded close time/reason, TP/SL, market P&L, opening fee, and net after that fee. Fixed-expiry records get appropriate fields; missing older close times are labelled scheduled expiry. | Open a dashboard Closed row and a full History row. Compare the former redirect-to-chart behavior. Use View on chart as a separate action. |
| F10 TP/SL | Open first, then add/drag/edit/confirm exits. TP/SL chart badges show projected market P&L as a percentage of the invested stake; the saved price, leverage, fee convention and payout caps are unchanged. Existing saved protection stays active until acknowledgement; failed requests do not silently replace it. | Review Buy and Sell captures, drafts, saved/reloaded exits, an intentionally interrupted save, and actual local Take Profit/Stop Loss settlements with recorded close metadata. |
| F11 Focus border | Standalone inputs use one inset focus edge; composite investment fields own the focus edge for their inner input. Scoped protection-editor rules cover its mobile portal too. | Tab into investment, login, market search, payment and protection inputs. Compare the original focus screenshot, 320px/tablet captures, and the focused protection editor. |

The investment maximum remains the existing ₹10,00,000 input limit. The engine's separate balance, exposure, treasury and trade-size rules remain authoritative. Verification fixtures seed sufficient local treasury for the ₹1,00,000 trade; production risk limits were not increased.

## Automated checks

- **Production build: passed.** A pre-existing Google font download format broke the admin build. The same JetBrains Mono face is now bundled locally from the official Google Fonts source, with its OFL licence retained.
- **237 targeted tests passed:** 93 web tests were rerun after the removal; 83 contract, 58 engine, and 3 catalogue test results are retained from the previous implementation verification.
- **Prior integrated run, before the latest icon/percentage update: 14 browser scenarios passed:** desktop Chromium plus targeted iPhone WebKit emulation. Eight duplicate desktop-only scenarios are explicitly skipped in the phone project; phone appearance is also captured in the desktop scenarios at phone viewports.
- Web, engine and database type checks passed. The targeted new/updated components pass lint. A broader check of the existing `PriceChart.tsx` reports six baseline lint errors (unused imports/helper and empty catches), also present in the saved original source; these are not treated as a clean whole-repository lint run.
- Tests cover input conversion/persistence, safe close metadata serialization, indicator calculations and forming-bar revisions, saved drawing validation, bonus tiers, bracket dragging/zoom, CFD commands/exits, and delayed quote timestamps.

The final chart check also exercises handle editing/undo and five repeated indicator replacements while the pointer remains over the plot. Ten consecutive runs passed after adding hover-position clearing around bulk history/indicator changes. An earlier rerun exposed an intermittent null-row error in the chart renderer. TradingView documents [the same class of hover/index error](https://tradingview.github.io/lightweight-charts/docs/release-notes) for bulk series replacements; the guard is defensive, and the bounded repeat checks do not prove that every possible chart-library race is excluded. Screenshot capture now waits for plotted OHLC data as well as the canvas.

A known pre-existing full-catalogue display-step assertion remains: unchanged DOGEUSDT (2.83 steps) and USDJPY (2.81) are below its 3-step threshold. Their calibration and tick rules were preserved. The separate tests for the expanded catalogue's matching symbols, calibration presence, and visible settlement ticks pass. This is not represented as a fully passing monorepo test suite.

## Latest chart review: icons and TP/SL percentages

- Replaced the text glyphs in all 13 sidebar buttons with original 24px SVG icons: consistent 1.5px strokes, endpoint handles, ruler, magnifiers, fit, undo and trash. Accessible names and button behavior are retained.
- RSI remains in a separate pane because it uses a 0–100 momentum scale; SMA/EMA follow the market price scale. See [TradingView’s RSI explanation](https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/).
- Chart TP/SL outcomes now use `market P&L ÷ invested stake × 100`, rounded to two decimals. ₹5.55 on ₹100 is +5.55%; on ₹200 the same cash result is +2.78%. This is projected market P&L, using the existing opening-fee convention. Exact price editing and protection persistence are unchanged.
- **58 targeted chart tests passed**, including Buy/Sell percentages, leverage, different stakes, zero/tiny results, existing payout caps, offscreen drags and protection races. The production build, web type check and targeted source lint pass.
- **10 focused browser checks passed** on desktop Chromium and iPhone WebKit emulation, with zero browser errors: all drawing tools, indicators, zoom/fit, a real local Buy followed by dragging/confirming/reloading exits, agreement with authoritative P&L/stake, and mobile fullscreen with Buy/Sell below. These are functional checks, not FPS measurements.
- A separate local demo account was created for this review. The user’s active preview account, trades and drawings were not reset. No funds outside the local fixture database were involved. The user subsequently approved pushing all changes to the current branch.
- New screenshots: [SVG toolbar](F01-desktop-chromium-svg-tools.png), [icon close-up](F01-desktop-chromium-svg-tool-rail.png), [phone fullscreen](F01-phone-webkit-svg-fullscreen.png), [desktop percentages](F10-desktop-chromium-percent-exits.png), [phone percentages](F10-phone-webkit-percent-exits.png). Older gallery images retain their original source identification and capture timestamps.

## Thirty-market report

The separate bot prototype defines **30 markets: 10 crypto, 10 forex, 6 Indian indices and 4 commodities**. Its saved simulation verification covers 60 scenarios. A fresh, read-only provider check returned references for **all 30 with no provider request errors**; see [the timestamped audit](market-reference-audit.json).

Provider coverage is not the same as every exchange being open or every quote being real time. The audit preserves provider timestamps: Indian indices have closed-session quotes and oil uses delayed futures references. Crypto, FX and metals are classified according to their actual source. Requests are batched where the provider supports batching, rather than making 30 unnecessary independent calls.

The checked dashboard database had 19 instruments and an older schema at research time. This implementation adds the missing 11 definitions, feed mappings/session recognition, and the shared count, verified against the existing bot catalogue. New-market volatility defaults are derived from that catalogue; the original 19 calibrations are unchanged.

A targeted catalogue sync is available through `pnpm --filter @asm/db seed:markets`. It adds missing instruments and preserves existing instrument settings, prices, pauses, payouts, users and trades. Apply the repository's required schema migrations before using it on the older deployment. Only the disposable local database was synced during this task.

Selected-market bot P&L was removed at the user's request. The dashboard no longer displays or polls for bot summaries, and the removed endpoint returns 404. Existing bot simulation and trade/settlement behavior are unchanged. The separate prototype runtime has not been migrated as part of these UI changes.

## Performance evidence and limits

[Measured results](performance.json) distinguish actual browser frame intervals from automated tests and server measurements. In the recorded-fixture Chromium sample, 180 frames had a 16.8ms p95 interval and no observed >50ms long tasks. These results do not establish live-market or physical-phone frame rates.

The 30-market preview's initial watch/history bootstrap was approximately 629KB. It uses the existing watch subscription design, which sends history at bootstrap; subsequent drawing, sidebar work does not introduce a second quote stream. Redraw CPU time, real-device profiling, 300× simulation playback, one-hour jumps and long live sessions were not measured. The underlying simulation/tick/settlement scheduling was not rewritten for the UI changes.

## Review files and reproduction

- [Screenshot gallery](index.html)
- [Image manifest and source identification](manifest.json)
- [Browser test report](test-report/index.html)
- [Check summary](test-summary.json)
- [Market reference audit](market-reference-audit.json)
- [Browser/server performance sample](performance.json)
- [SEO values](seo-metadata.json)

The browser suite is `apps/web/playwright.dashboard.config.ts` with `apps/web/e2e/dashboard-setup.ts`. It refuses any database except local `asm_dashboard_verify`. Start the web production build, the read-only chart preview, and `apps/engine/scripts/dashboard-verification-api.ts` against that disposable database and local Redis; then run Playwright with this configuration. The verification API uses real CFD validation/persistence with fixed fixture quotes and does not start payment watchers or external trading services.

Existing uncommitted work was preserved. Original UI source and a patch were saved outside the repository before edits. Deployment and production data remain unchanged.
