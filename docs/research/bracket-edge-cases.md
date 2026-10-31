# Chart protection: interaction regression audit

The ticket-level SL/TP switch has been removed. New Buy/Sell orders have no protection unless the user chooses levels and confirms them on the chart. Account → Preferences → **Chart SL/TP controls** defaults to on and saves visibility on the current browser. Hiding controls does not cancel saved server-side protection.

## Ten edge cases

These are mounted React interaction tests in `apps/web/src/components/chart/ChartBrackets.test.ts`, not just helper-function tests. The chart API and HTTP boundary are mocked to control expiry, pointer events and network races. Native chart layout is additionally checked in the browser.

| # | Reproduction | Required result and fix |
|---|---|---|
| 1 | Open protection immediately after Buy, touch nothing, dismiss with Cancel, X or Escape. | No defaults and no HTTP update. Both exits remain unset. |
| 2 | Add a new exit or modify a saved exit, then Cancel/X/Escape and reopen. | Discard the preview and input buffers; retain saved protection. X now cancels the entire editing session instead of hiding a live draft. |
| 3 | Let the last trade expire while its editor is open without changes. | Editor disappears and full chart width returns. Editor ownership now uses a trade ID, independently of draft existence. This was the reported empty-column bug. |
| 4 | Drag an exit as its trade expires, with another trade still open. | Release pointer interaction and restore pan/zoom. Drop the expired draft without transferring it to the remaining trade. |
| 5 | Open Buy and Sell together, start editing Buy, then choose Sell. | Explicit position selectors stay usable while drafting. Switching discards unconfirmed edits, loads the selected trade's saved levels, and sends any later update only to that trade's URL. The editor explains this behavior before switching. |
| 6 | Switch account, market, timeframe or chart style while editing or saving. | A new editing scope restores layout, releases gestures, aborts the old request and ignores its late response. Saved protection remains in shared trade state. |
| 7 | Resize desktop → phone → desktop with the editor open; close it or hide controls in Settings. | No stale gutter or invalid native plot width. Container-query CSS resolves the reservation before the chart's resize observer. Settings changes remount the editing scope and discard unsaved previews. |
| 8 | Confirm twice rapidly; let the trade expire before the response arrives. | One in-flight request per editor, with a synchronous lock. Expiry aborts it; a late OPEN response cannot revive the expired editor. |
| 9 | Receive a market-moved rejection or a request that never finishes. | Retain saved levels and editable preview, show the failure, and allow retry/cancel. Requests time out after 15 seconds; the message asks users to check saved levels because an aborted HTTP request may already have reached the server. |
| 10 | Cancel a pointer gesture, clear a price or reward field, click Edit again, then cancel. | Restore the previous preview and chart interaction. Invalid buffers disable Confirm; reopening the same editor cannot bypass them. Editing a price clears an outdated money buffer and recomputes the fee-inclusive result. Cancel discards everything unconfirmed. |

## Validation

- 55 focused tests across seven files, including the ten mounted editor cases, both Buy/Sell request payloads, preference persistence/cross-tab updates, bracket calculations, trade state, trade-panel behavior and P&L.
- Web TypeScript check and whitespace check.
- Local dev mode against a dedicated Supabase demo schema, with real market feed. No production trades used.
- Visually verified the untouched-editor expiry and full-width recovery; two simultaneous Buy/Sell trades and draft switching; Settings off/on without creating exits; phone draft cancellation; explicitly saving TP at 90000, reopening the saved value, and explicitly removing it.
- Visual resizing initially exposed Lightweight Charts' `right should be >= left` assertion. Replaced JavaScript resize-based spacing with a container query and repeated phone/desktop resizing without new chart errors. Measured desktop parent/canvas widths of 988/670 px (318 px reservation) and phone widths of 390/390 px (zero reservation). Finally let the last remaining trade expire with an untouched editor open: OPEN became zero, the editor disappeared and the chart recovered its full width.
- An existing dev-only CSP/eval warning remains; production security headers were not weakened.

## Offscreen protection and chart navigation follow-up

The user reported that a high TP disappeared and the chart stopped moving. There were two causes: exits outside the visible coordinate range were unmounted, and bracket dragging restored navigation from the chart's mutable options object after it had already been disabled. An offscreen captured label could also disappear before releasing its drag.

- The selected position's offscreen TP/SL now stays available as an edge badge with an up/down arrow, exact price, pencil and removal control. The native price line keeps its actual price; the edge badge does not represent a fake price level. The captured label stays mounted as it moves outside the plot.
- Pointer capture isolates bracket gestures without changing chart scroll/zoom options. Autoscale is frozen only for the gesture, then restored. Blur, cancelled gestures, window release, lost capture, capture failure, expiry and unmount release the gesture safely.
- When the position entry is outside the plot, Manage position still opens the price editor. Temporary Fit exits scaling is released by the next canvas pan or wheel gesture.
- Added 12 mounted regressions: offscreen TP and SL above/below the view for Buy/Sell, dragging a captured label beyond the top, three window interruptions, rejected pointer capture, pan/wheel after fitting and an offscreen entry.
- Visually tested using the isolated local Supabase demo: saved TP 90000, edited it from its edge badge to 88000, dragged it back to an unconfirmed 81736, panned the chart while the preview remained open, cancelled back to the saved TP and added SL 50000. Both edge badges remained accessible on desktop and a 390px phone. On phone, dragged TP above the chart and released over the header, cancelled, then panned the chart successfully. Price-axis scaling worked on desktop as well.
