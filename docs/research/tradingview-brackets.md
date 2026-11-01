# Chart position brackets: reference study and interaction specification

Reviewed 23 October 2026. The scope is managing protection on an existing CFD position, plus displaying protection supplied at order entry. This is position management, not TradingView's long/short drawing tool (a drawing does not submit or protect a trade).

## Primary references inspected

- [Add brackets to an existing position](https://www.tradingview.com/support/solutions/43000754962-add-brackets-to-the-existing-position/). Inspected the official full-resolution animation: position pill contains quantity/P&L and attached TP/SL handles; pulling a handle creates a bracket, a connecting stem and a lightly shaded price region. Pending changes expose Cancel/Confirm beside the position. The detailed ticket is a separate editing surface.
- [Position bracket modification](https://www.tradingview.com/support/solutions/43000754961-positions-brackets-modification/). Inspected the animation: prices and risk/reward money fields synchronize; brackets can be changed without closing a position; confirmation acknowledges the new settings.
- [Use brackets on the chart](https://www.tradingview.com/support/solutions/43000659802-i-want-to-use-brackets-on-the-chart/). Direct manipulation from chart handles without opening an order ticket. Shift-moving a parent order is relevant to pending orders, not moving the immutable filled entry of this app.
- [Trading primitives](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/Trading-Primitives/). Position and order lines are separate objects; contextual controls live on those objects. The app uses Lightweight Charts and implements this interaction rather than representing its free chart as the licensed Trading Platform library.
- [Bracket orders and broker updates](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/trading-concepts/brackets/). Brackets belong to their parent; their display and active state must follow server acknowledgement. Closing the parent removes both brackets. No new opposing position should be created by a protection control.
- [Confirmation versus one-click trading](https://www.tradingview.com/support/solutions/43000480920-i-d-like-to-place-orders-without-having-to-confirm-them-every-time/). The redesign uses explicit inline confirmation, without introducing an account-wide instant-modification preference.
- [Mobile interaction](https://www.tradingview.com/support/solutions/43000776264-one-tap-trading-mode-in-ios-and-android-mobile-apps/). Touch selection cannot depend on hover. Keep handles discoverable and enlarge their hit areas, while retaining the same chart geometry.

## What changes from the rejected implementation

Remove the detached SL/TP button, chart-picking mode, floating 'Protect trade' form and separate save mode. Replace them with a position-bound control group. Do not move labels away from the price line while editing; do not draw a false horizontal line at a clamped screen edge. Do not change chart scale automatically during dragging.

## Visual specification

- Base #131722, border #2a2e39, text #d1d4dc; inherit the application's sans-serif and use tabular money/price digits.
- Filled buy position #2962ff; sell position #f23645. TP #089981; SL #f23645. Semantic colors label order type; signed money independently expresses its result.
- 1px lines and borders; small 3px corners; compact segmented position/order labels, not cards. Desktop labels 24px tall; touch hit areas at least 36px.
- Labels stay aligned with their exact series price coordinate. Right-axis badges show the price. Draft risk/reward zones use very low-opacity fills and a thin connecting stem.
- Existing saved brackets retain a thin muted line while a different draft price is being considered. A draft is dashed and explicitly unconfirmed. Invalid levels remain visible as a preview, with Confirm disabled and a concrete explanation.
- Selection, focus and pointer hover reveal controls. Touch selection keeps controls visible. Other positions remain identifiable; a compact position chooser handles coincident entries.

## State transitions

1. Idle: saved entry and bracket lines are rendered for all open positions.
2. Select/hover position: TP and SL handles appear next to its position pill.
3. Pull a missing handle or drag an existing bracket: create a local draft for that position. Freeze chart scrolling/scaling for the gesture only; price remains snapped to the asset tick. Show money, distance and fill preview during the gesture.
4. Release: retain the preview and show inline Cancel / Confirm. Do not send a request during the drag.
5. Confirm: validate against the current chart price; PATCH only changed fields; show a pending state. The old server protection remains active during the request.
6. Acknowledge: replace the position view with the returned server row. Render confirmed lines. Failure: retain the local draft, restore active saved lines and display a specific error; allow adjustment/retry or Cancel.
7. Cancel/Escape: discard the draft without a write. Pointer cancellation restores the previous draft.
8. Remove x: mark only that bracket for removal, then use the same confirmation flow.
9. Position closes, account/symbol changes: clear transient interaction; never redirect a draft onto another position. Late responses may update their own trade, but cannot resurrect an OPEN row after settlement.

## Verification

Exercise direct add, drag, exact price/money edits, removal, cancellation, rejected levels, tick snapping, saved-vs-preview separation, multiple positions, touch layout and reload persistence. Verify server guard behavior and both Buy/Sell price-side rules. Use only isolated Supabase demo fixtures for visual testing.

## Completed checks

The replacement was exercised locally against the isolated Supabase demo fixture at desktop (1280px) and phone (390px) widths. Verified pulling both handles, cancelling without applying them, confirming and reloading saved levels, moving only SL while retaining TP, exact price and reward/risk synchronization, empty/invalid field handling, independent Buy/Sell selection, fixed editor footer buttons, and the removal of controls when a position closes. Observed a saved SL crossing and closing its demo parent. The 8 bracket-model cases and 19 existing trade-state/display cases pass, along with the web TypeScript check. Pointer input was exercised in browser automation at both widths; no physical-device touch test is claimed.

The previous CFD phone strip is replaced by the position label's countdown to avoid covering brackets. Position selection lives in the position label rather than a floating footer control. Native series lines and HTML labels share price coordinates, measured after the chart render, and the overlay no longer polls on a timer.
