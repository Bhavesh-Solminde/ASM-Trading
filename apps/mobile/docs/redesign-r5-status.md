# R5 mobile implementation — 2026-10-21

Branch: `codex/mobile-redesign-r5`, created from the existing mobile-p3 checkout with its unfinished work preserved. The PR includes mobile sources and the route scaffolding needed by the new hubs; unrelated web and shared-package work is excluded. A pre-edit copy of the mobile sources and the original tracked diff was saved at `/tmp/mobile-r5-baseline`.

## Implemented

- Approved dark/blue palette, native sans UI typography, simplified header and navigation. Original bull/bear assets and gradient buttons retained.
- Chart-focused trading layout; market/settings above, compact position overlay, timeframe/history/fullscreen toolbar, side-by-side amount and duration selectors.
- Fullscreen hides tab navigation only. Account mode, market, history and entry controls remain; Android Back exits fullscreen. The chart is never keyed by fullscreen or duplicated.
- Account mode sheet preserves existing Live-access restrictions. Existing stake validation, per-currency preferences, socket merge and settlement paths remain.
- Shared live position cards in chart/history, selectable trade detail sheet that preserves the selected trade through settlement.
- Real-data History, Payments and Account hub screens. Payment activity uses the existing validated API response schemas; no mock balances or transactions.
- Loading skeleton uses one native opacity loop, stopped for background and reduced-motion settings. Hidden bottom sheets unmount their content and associated timers.
- English and Hindi labels. Existing Maestro login/trade flow updated for account and duration sheets.

## Validation

- Mobile TypeScript check passed.
- 82 test files / 752 tests passed, including fullscreen tab-navigation coverage.
- Android Expo/Hermes export passed.
- Android API 35 emulator: Maestro visual-proof flow passed with isolated local API/WebSocket fixtures. Captured normal trading, fullscreen, history sheet, History, Payments and Account. Verified controls remain in fullscreen and Android Back dismisses the history sheet before leaving fullscreen.
- `git diff --check` passed.

## Still required before release

- Broaden native coverage to small devices, Hindi, large text, real settlement/reconnection, and release builds. Current screenshots use the matching Expo development client on one Android API 35 emulator with seeded fixtures.
- Complete existing placeholder subroutes: deposit/withdrawal/payment claims and receipts, profile/security/preferences/support and KYC. The new hubs link to these existing routes; they are not complete end-to-end flows.
- Finish detailed R5 parity: inline amount/duration steppers, mixed chronological activity grouping/pagination, richer trade details and remaining secondary screens. History currently offers trade/payment views and the existing open/closed trade filters.
- Validate loading transitions and chart pan/zoom under live data on-device; no performance claim has been measured.
- No production payment, withdrawal or live trade was performed.

Design: https://www.figma.com/design/FKOYMF8qihz9OG9qKrrIzJ/IndianxTrade-Mobile-redesign-review?node-id=27-1364
