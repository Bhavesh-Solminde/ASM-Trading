# Dashboard improvements: research, implementation, and verification plan

Date: 11 November 2026

Status: implemented and verified locally. The original research and plan are retained below. The final user direction keeps the custom tools and keeps mobile Buy/Sell below the chart, including fullscreen. Selected-market bot P&L was removed at the user's request. The affiliate program remains on hold. Verification and deployment limits are recorded in `artifacts/dashboard-improvements-2026-11-11/verification.md`.

## 1. Findings and remaining investigation

These findings describe the current working tree, which already contains substantial uncommitted changes. Preserve that work; record the starting diff before implementation and never reset unrelated files.

| Area | Evidence in this checkout | Implication |
| --- | --- | --- |
| Chart library | `apps/web/package.json` installs `lightweight-charts` 5.2.1; `PriceChart.tsx` imports it directly. | The complete XM-style toolbar is not a hidden setting in the current integration. Implement working drawing/indicator controls through supported extensions, or evaluate a different library if a prototype fails the acceptance checks. |
| Amount display | The amount input in `TradeTicket.tsx` has a fixed `w-[5ch]` width. The CFD ticket uses a different, length-based width. | Leading digits may be horizontally scrolled out of sight while editing a six-digit amount. This is a suspected display cause, not a browser-confirmed diagnosis of data loss. Verify the field value, saved value, request amount, and server record separately. |
| Amount parsing | `stake.ts` contains shared helpers, but the fixed-expiry ticket's change handler uses its own sanitization. The helper also accepts multiple decimal points as text. | Audit all entry paths and use one consistent, tested amount policy. Avoid fixing only the visible width while leaving conversion differences. |
| Double focus border | `globals.css` applies an unlayered global focus outline. Individual fields also change border color or suppress outlines. `ChartBrackets.module.css` separately adds offset outlines to bordered inputs, including its portalled mobile editor. | A fix to one investment input cannot establish that all fields have a single focus edge. Reproduce the affected fields and inspect border, outline, shadow, and wrapper styles in the browser before choosing the shared correction. |
| Existing focus test | `trade-ticket.spec.ts` checks only that `#stake` has `outline-style: none`. | Extend coverage to the complete visible field and other affected inputs. Keep a visible keyboard focus cue. |
| History interaction | `HistoryList.tsx` redirects CFD trade clicks to `/trade`. `TradesPanel.tsx` selects chart protection for CFD rows. | A details sheet exists, but CFD clicks bypass it. Separate opening trade details from the optional action to view that trade on the chart. |
| History data | The database has `closedAt` and `closeReason`. Shared `TradeView` omits both; the existing detail sheet treats expiry as closing time and contains fixed-payout fields. | Carry the actual close metadata through the explicit safe serializer and render CFD and fixed-expiry details correctly. Do not invent a close reason or show scheduled expiry as actual early closure. |
| TP/SL | `ChartBrackets.tsx`, its drag helpers, and an authenticated `PATCH /api/cfd/trades/[id]` already exist. | Improve and verify this implementation. Preserve draft/confirmation behavior, saved protection during failed requests, ownership checks, and settlement races. |
| Market count | Marketing still says 18; the checked-in catalogue actually lists 19 entries, including Gold. Silver and Oil are absent from that catalogue. The deployed catalogue has not been inspected. | Reconcile the user's reported 30 markets against the deployed asset list before publishing counts or choosing exact Popular symbols. Do not create missing trading instruments just to make a count match. |
| Deposit offers | `deposit.ts` already defines bonus tiers of 100%, 100%, 50%, 50%, then 0%, plus turnover rules. | Read eligibility from existing rules. Do not display an unconditional 100% offer or create a second bonus policy in the popup. |
| Screenshots | Playwright already keeps screenshots, video, traces, and reports. Its configured projects cover desktop Chromium and tablet WebKit. | Reuse this evidence pipeline and add explicit phone coverage and screenshots at each acceptance state. |

Initial baseline command: `pnpm --filter @asm/web test src/components/trade/stake.test.ts src/components/trade/CfdTradeTicket.test.ts src/components/history/history-model.test.ts src/components/chart/ChartBrackets.test.ts src/components/chart/ChartBrackets.zoom.test.ts src/components/chart/bracket-drag.test.ts`.

Result: **6 test files passed, 68 tests passed**. This is automated test evidence only. Browser reproduction, screenshot acceptance, deployed catalogue checks, and real-device performance profiling remain to be done.

Official chart references checked:

- [Lightweight Charts v5 plugins](https://tradingview.github.io/lightweight-charts/docs/5.0/plugins/intro): primitives and custom series can provide drawing tools, indicators, and annotations.
- [TradingView Advanced Charts](https://www.tradingview.com/advanced-charts/): a separate library with built-in drawing and indicator suites. Do not assume it is installed or accessible under the current integration.
- [Lightweight Charts attribution options](https://tradingview.github.io/lightweight-charts/docs/5.0/api/interfaces/LayoutOptions#attributionlogo): native attribution logo support. Verify the installed 5.2.1 API before implementation.

## 2. Research and delivery order

1. **Reproduce and record.** Record the starting working tree and local versions. Start a local test environment with a dedicated test database. Capture before screenshots of the amount, double border, history click, and responsive chart issues. Record exact steps, viewport, browser, account type, and trading model. Inspect the runtime market catalogue using read-only access where available.
2. **Fix amount and focus causes first.** Add regression cases that expose confirmed failures before fixing them. Resolve the underlying shared behavior and verify every affected caller. Capture after screenshots at the same viewports as the before images.
3. **Validate chart integration.** Prototype one editable trend line, one indicator, and coexistence with existing TP/SL using the installed library. Verify phone gestures, panning/zoom, persistence, and frame cost. Use Lightweight Charts if the prototype passes. If it does not, document the tested alternative, integration effort, and access requirements before choosing a migration; do not silently reduce the approved tool scope.
4. **Implement dashboard features in small groups.** Deliver responsive chart controls and logo; market sidebar/Popular/catalogue-backed SEO; history details and TP/SL hardening; eligibility-aware deposit dialogue. Run the relevant checks after each group rather than waiting until the end.
5. **Complete integrated verification.** Check market/account changes, fullscreen transitions, reconnects, refresh, settlement, and layout interactions together. Produce the screenshot gallery, test results, and clearly labelled performance evidence. Review every image before handing it to the user.

Before writing application code, read the installed Next.js guides required by `apps/web/AGENTS.md`, and the applicable React guidance. Reuse existing components, APIs, chart objects, and test tooling wherever practical.

## 3. Implementation scope and acceptance checks

### F01 — Chart tools and responsive layouts

- Target working tools: selection/crosshair, horizontal line, trend line, parallel channel, Fibonacci retracement, freehand drawing, text annotation, measurement, and chart zoom/reset. Start indicators with SMA, EMA, and RSI; prove add/remove and calculation behavior rather than adding decorative buttons.
- Make drawings selectable, editable, and removable. Store chart anchors as time/price values rather than screen pixels. Namespace saved drawings by account and market, and restore them consistently across timeframe changes and refresh.
- Normal phone: compact chart, full drawing toolbar hidden, Buy/Sell at the bottom, expand control visible.
- Fullscreen phone: drawing tools on the left; timeframe, chart type, and indicators at the top; Buy/Sell below the chart (updated user instruction). Allow the tool rail to scroll on short screens.
- Desktop: show the toolbar and chart controls directly. Keep controls clear of price/time scales and TP/SL labels.
- Share one ticket state and order-submission path between layouts. Do not introduce duplicate active trade buttons or reset amount, expiry, account, market, drawings, or visible range when switching layouts.
- Use a layout fullscreen fallback on mobile browsers that do not expose native fullscreen. Handle native exit, Escape, rotation, and safe areas consistently.
- Keep tool placement, chart pan, pinch, text editing, and TP/SL dragging distinct so one gesture cannot accidentally submit a trade or move another object.

Primary existing code: `TradeWorkspace.tsx`, `PriceChart.tsx`, chart plugins, `ChartTypeSelector.tsx`, and ticket state.

### F02 — Mobile circular chart logo

- Use the existing circular mobile chart control as the placement reference and the supplied TradingView mark reference for appearance; verify the exact control during browser reproduction before changing it.
- Keep its action and accessible name intact if it is interactive. Use the supported attribution mechanism or an appropriate linked mark, retain notice requirements, and prevent duplicate logos.
- Verify compact and fullscreen layouts, touch target, and clearance from the time axis and other controls.

### F03 — Deposit promotion dialogue

- Reuse existing modal behavior: close button, Escape, contained keyboard focus, background scroll lock, and focus restoration.
- Load the current user's eligible offer from the existing bonus rules. Show the applicable terms and route the action to the existing deposit flow. Hide an expired or ineligible offer.
- Proposed frequency: once per eligible offer per browser session, with dismissal remembered for 24 hours for that user/offer. Storage failures must not prevent closing the dialogue.
- Show at an idle dashboard moment. Defer while placing a trade, dragging a chart object, editing protection, or using another modal. Do not interrupt those operations.
- Recheck eligibility after a completed deposit and on the server when applying a bonus.

### F04 — Markets sidebar on wider screens

- Reuse the market selector's live asset data, search, class filtering, favourites, and selection behavior in a persistent wide-screen list.
- Pick the breakpoint by measuring the remaining chart width with the trade ticket present. Use compact selection below that width and in phone fullscreen.
- Subscribe rows to the values they need; do not build a second quote connection or rerender the whole dashboard on every quote.

### F05 — Market count and SEO

- Reconcile checked-in, runtime, and deployed asset lists. The target is the user's 30-market offering; confirm all 30 entries and their enabled status first.
- Use one lightweight source for the published market count and categories so landing copy, metadata, OpenGraph/Twitter descriptions, and relevant structured data agree.
- Audit `site.ts`, `seo.ts`, landing statistics, feature copy, FAQ answers, market previews, and generated public content. Include commodities where applicable.
- Keep published catalogue size distinct from markets temporarily closed for trading. A session closure must not change the advertised supported-market count.
- If the deployed 30-market list is unavailable, record that specific unresolved input; do not claim 30 has been verified from this checkout.

### F06 — Popular markets

- Add a Popular filter/group shared by the sidebar and mobile market picker.
- Configure BTC, Gold, Silver, and Oil using verified runtime symbols. Keep the ordering consistent, filter unavailable assets, and preserve favourites/search.
- Market session status must remain visible. Popular placement cannot make a closed market tradeable.

### F07 — Investment input bug

- Reproduce typing and pasting `100000`, `1,00,000`, and `₹1,00,000`; inspect the DOM value, caret/scroll position, saved text, submitted minor units, and recorded trade separately.
- Fix field sizing and currency layout if clipping is confirmed. Ensure all digits remain readable at supported widths, including with the mobile keyboard open and after blur.
- Apply one amount parsing/validation policy across the fixed-expiry ticket, CFD ticket, mobile sheet, quick picks, steppers, restored values, and submission. Preserve valid intermediate editing states; reject malformed numbers with clear feedback rather than silently changing their meaning.
- Verify ₹1,00,000 converts to **10,000,000 minor units**. Verify the existing maximum of ₹10,00,000, above-limit values, decimals, empty/zero values, percent mode, INR/USD switching, balance/fee limits, and refresh/fullscreen restoration.
- Keep the server authoritative on monetary limits and order creation. Use demo fixtures to verify recorded amounts without depositing or spending real funds.

### F08 — Removed from scope

The user requested removal of selected-market bot P&L. Remove its dashboard display, polling, aggregate route, and dedicated quote endpoint/helper. Preserve all bot simulation, user trading, and settlement behavior. Verify its absence on desktop/mobile and in fullscreen; the removed API must return 404.

### F09 — Clickable trade history details

- Open a shared trade details panel from both dashboard Closed/history rows and the full History page. Offer a separate View on chart action where useful.
- Show ID, market, Buy/Sell, investment, entry price, close price, net profit/loss, opened time, actual closed time, close reason, and TP/SL when applicable. Include spread fee for CFD positions when recorded.
- Preserve explicit safe serialization and ownership filtering while carrying `closedAt` and `closeReason` through API/stream paths. Check older records where these fields are absent.
- Use CFD-specific and fixed-expiry-specific rows. Label gross return separately from net P&L. Do not show a fixed payout calculation for a CFD trade.
- Test profitable/loss-making/flat/refunded results, expired and early-closed trades, local time formatting, missing older data, keyboard access, and close/focus restoration.

### F10 — Draggable TP/SL after a trade opens

- Extend the existing CFD brackets and modify endpoint. Show editable TP/SL only after a successful open response identifies an active position; remove pre-trade TP/SL controls from the dashboard flow.
- Support mouse, touch, and a precise numeric editor. Clearly distinguish a draft from saved protection. Keep a deliberate confirmation step for persisting changes.
- Retain saved protection until the server acknowledges a change. Handle validation failures, timeouts, reconnects, concurrent settlement, account/market switches, and cancelled drags without showing an unconfirmed value as saved.
- Match engine validation, instrument price precision, and allowed TP/SL side. Preserve existing tick size and settlement rules; do not change engine price granularity as a UI fix.
- Prevent edits to settled positions. Preserve fixed-expiry behavior rather than treating those positions as leveraged CFD positions.
- Verify opening, adding, changing, removing, saving, reloading, and triggering both exits; test Buy and Sell and expiry during a pending save. Check offscreen levels and labels while panning/zooming.

### F11 — Single focus border for inputs

- Audit investment amount/percentage, time, market search, TP/SL price/risk/reward, deposit/withdrawal, login/register, and other instances of the same affected field patterns.
- Reproduce with keyboard Tab as well as mouse/touch. Inspect the actual input and its wrapper for borders, outlines, inset shadows, and native browser styling.
- Give each field one visible focus treatment: the composite wrapper owns the focus edge or the standalone input does. Apply scoped inner-input overrides only where the wrapper provides the cue. Keep keyboard focus visible for buttons, checkboxes, and other controls.
- Resolve stylesheet precedence and portalled-editor styling directly; avoid stacking more one-off fixes onto each input or disabling focus styling globally.
- Verify blur, focus, error, disabled, autofill where supported, and browser zoom states. Keep the focus cue distinguishable from an error border.

### Deferred — Affiliate program

Keep it on hold. No affiliate implementation in this batch.

## 4. Regression prevention

- For each confirmed bug, record reproduction steps, add a failing behavioral check where practical, implement the cause-level fix, and show that check passing afterward. Mark static suspicions separately from reproduced failures.
- Amount tests cover both the visible text and the submitted/stored integer. Browser checks cover clipping/caret behavior that parser unit tests cannot detect.
- Focus checks cover computed input and wrapper styles plus focused screenshots. Checking only `outline-style` on one input is insufficient.
- Share ticket state across layouts and run transition checks through fullscreen, resize, refresh, market change, account change, and settlement. Verify one user action produces exactly one order.
- Exercise existing validation and ownership tests for history and protection modifications. Use isolated demo/test accounts, never live money or the shared production database.
- Run changed-area unit/component tests, related API/engine tests for any data changes, focused browser tests, typecheck/lint, and a production build. Broaden testing when a failure or a shared change justifies it.
- Retain the reproduction and regression cases in the normal test suite so the fixes do not rely on screenshots being reviewed manually each release.

## 5. Screenshot verification deliverable

Screenshots are a required completion item for **every implemented feature and bug fix**. Capture the actual running application; do not substitute design mockups or edited evidence. A feature is not marked verified until its screenshots have been reviewed and its behavioral checks have passed.

Use `artifacts/dashboard-improvements-2026-11-11/` for the evidence pack. Record the actual capture date in the manifest if implementation happens later.

Deliver:

- `index.html`: a local, browsable gallery grouped by requirement ID, with before/after pairs for reproduced bugs, captions, and full-resolution links.
- `verification.md`: setup, steps, expected behavior, observed result, test results, and any remaining limitations, linked to each image.
- `manifest.json`: screenshot filename, requirement ID, scenario, viewport, browser, data source/fixture status, account/trading model, capture time, code revision plus working-tree identification, and passed/failed/not-run status.
- Test report, traces/videos for interactive checks, and separate raw benchmark/profile results. Never include session cookies, secrets, or private production account information in evidence.

Browser matrix: phone Chromium at 360×800, phone WebKit at 390×844, short/landscape phone, tablet around 1024×768, desktop 1440×900, and wide desktop 1920×1080. Add a 320px-width stress check and 125%/200% browser zoom checks for fields and layout. Browser zoom and chart fullscreen/price zoom are different checks. Emulated WebKit is not a physical iPhone test; label it accurately.

| ID | Required screenshots | Behavioral verification alongside the images |
| --- | --- | --- |
| F01 | Normal phone; fullscreen phone with bottom Buy/Sell and left tools; desktop toolbar; one result image for each implemented drawing tool and indicator; edited/restored drawing. | Create/edit/delete tools, validate indicator results, pan/pinch, enter/exit fullscreen, rotate, restore state, and ensure no accidental/duplicate order. |
| F02 | Circular logo in normal and fullscreen phone view. | Check action/link, accessible label, single logo, touch target, and no obstruction. |
| F03 | Eligible offer on phone and desktop; dismissed state; changed/lower-tier offer where eligible. | Close by ×/Escape, follow deposit action, restore focus, verify cooldown and eligibility, and ensure no interruption of an active interaction. |
| F04 | Sidebar at wide width and compact selector below the chosen breakpoint. | Search/select, favourites, live quotes, no clipping, and a single quote data source. |
| F05 | Public landing count and market coverage; rendered metadata/structured-data inspection. | Confirm advertised 30 against runtime catalogue, check metadata/OG/Twitter/FAQ consistency. Browser source-inspector images plus extracted values are evidence; they do not prove Google has reindexed the site. |
| F06 | Popular on desktop sidebar and phone picker with verified BTC/Gold/Silver/Oil symbols. | Select each available market; test search, missing/closed assets, ordering, and favourites. |
| F07 | Matched before/after ₹1,00,000 focus and blur; phone and desktop; value after fullscreen/refresh; max and invalid input states. | Verify exact field/storage/request/database amount, currency/percentage transitions, decimals, and limits. |
| F08 (removed) | Dashboard without the bot summary on desktop and phone. | No summary in normal/fullscreen layouts, no polling request, removed route returns 404. |
| F09 | Detail panel opened from dashboard history and full History; profitable and losing CFD examples; fixed-expiry example; early-close details on phone. | Confirm record identity, ownership, net result, actual close time/reason, TP/SL, keyboard closing, and separate View on chart action. |
| F10 | Open trade before adding exits; dragged draft; confirmed TP/SL; reloaded saved state; Buy/Sell examples; failed save and settled/read-only states. | Confirm persistence and engine exit execution, cancel/remove behavior, touch/keyboard editing, rejected edits, and settlement during save. A screenshot alone cannot prove an exit executed. |
| F11 | Matched before/after focused investment and each affected input family; keyboard-focused phone/desktop views; TP/SL portal; error state. | Tab through fields, inspect border/outline/shadow on input and wrapper, check single visible edge and accessible focus, refresh/fullscreen, and browser zoom. |

Include a practical review checklist in the gallery so the user can open an image, see exactly which requirement it proves, and repeat the steps in the dashboard.

## 6. Chart performance and trading correctness

Apply all six checks in `docs/chart-performance-checklist.md` in proportion to the change:

1. Keep full history loading for initial load/symbol/timeframe changes and use incremental candle updates afterward. Preserve pan/zoom and reuse chart lines/objects.
2. Patch stable market rows and labels, coalesce display work with animation frames, and stop hidden-tab display work while the simulation continues.
3. Use compact quote deltas, bounded snapshots, and reconnect reconciliation; do not add full history/book payloads for the sidebar.
4. Cancel superseded requests and ignore stale callbacks using the existing generation/cursor model. Preserve bounded caches and avoid stale symbols overwriting the new selection.
5. Keep expensive simulation work away from the UI. This batch should not alter simulation scheduling unless measurement proves it necessary; any scheduling change must retain every tick/order/settlement and pass deterministic equivalence checks.
6. Record payload size, latency, switching cost, long tasks, render time, and actual frame intervals where measured. Use accelerated playback/jump cases where the applicable harness supports them. State when those scenarios or real-device profiling were not run.

Report automated DOM/server benchmarks separately from actual browser frame-rate measurements. Use the checklist's redraw/switch/long-task targets as targets, never as claimed measurements. Screenshots show appearance; they do not prove smoothness, backend correctness, or future bug immunity.

## 7. Reversal and completion

- Keep changes grouped into reviewable patches: input fixes, chart/layout, market presentation/SEO, details/contracts, protection and promotions. Capture the initial uncommitted work so reversal never erases someone else's changes.
- Prefer additive optional response fields for close metadata. The database already has the close columns; confirm whether any migration is actually needed before adding one.
- If an issue appears, stop the affected new UI/summary path and revert its patch to the recorded baseline while keeping established order/settlement behavior intact. UI reversal must never undo executed trades, deposits, or protection changes already accepted by the engine.
- Completion requires all approved active requirements implemented, relevant checks passed, every required screenshot captured and reviewed, the evidence gallery delivered, and remaining environment/device limitations plainly stated. The affiliate program remains deferred.

## Updated chart direction during implementation

The user approved continuing without TradingView Advanced Charts, then explicitly confirmed keeping the custom toolbar shown in their screenshot. Keep the existing Lightweight Charts drawing tools and SMA/EMA/RSI indicators. No private-library access is required for this batch. Buy/Sell stays below the chart on mobile in both normal and fullscreen layouts.

## Latest chart review

Replace the text-symbol tool icons with crisp original SVG outlines matching the supplied reference’s stroke and endpoint style. Preserve tool behavior and accessible labels. RSI keeps its separate 0–100 momentum scale; SMA/EMA overlay the price scale. TP/SL chart badges show projected market P&L as a percentage of the invested stake, retaining the original saved prices and monetary rules. Verification: 58 chart tests and 10 focused browser checks on a separate local demo account; screenshot evidence is in the gallery. Following the preview review, the user approved pushing all changes to the current branch.
