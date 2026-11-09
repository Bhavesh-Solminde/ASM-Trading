# Android OTC integration — 9 November 2026

This branch integrates the previously unmerged native app with the website's existing OTC engine. The extra positions/history/roles/bot-leaderboard plan item was removed. Existing screens only receive the parsing and currency fixes needed to display OTC contracts correctly.

## Trading behavior

- Both clients use the same 30-market server catalog, bot process, candle history and quote tokens. `OTC_ORDER_BOOK_ENABLED=true` takes precedence over legacy `TRADING_MODEL`.
- Native CFD ticket, actions and store were removed. Fixed contracts use expiry, 92% profit on a win, optional SL/TP selected by dragging chart handles, and multiple open trades. There is no manual close.
- Native Buy/Sell reads the quote committed by the visible price label. It sends the server-issued token, never an arbitrary client price. The server verifies the token and retains that price and its candle time even when matching happens later.
- An uncertain POST retains its original request key and quote. A named retry action replaces normal trade buttons until that request is resolved. Changing language or remounting the ticket cannot turn the retry into a duplicate trade.
- Currency checks happen inside the account lock before debiting. OTC trades retain their original units after account conversion, including result notifications. Existing account conversion (100 INR/USD) and UPI collection (107.64 INR/USD) remain separate policies.

## Six smoothness checks

| Check | Native implementation and evidence |
| --- | --- |
| Incremental data | Shared OTC reducer applies revised/appended bars and volume. No full history reload on every tick. Forming-only markets render. |
| Stable/hidden UI | Socket packets coalesce to one animation-frame publication. Chart unmounts and unsubscribes when its tab is hidden; balance/settlement processing continues. |
| Small resume updates | Selected-market cursor includes generation. Old generation, out-of-order and mismatched selection messages cannot replace the current chart. Server bounds queue/backpressure. |
| Safe switching | Six-selection cache provides initial candles; cached quote tokens are cleared until fresh data arrives. Tests cover switching and reconnect resets. |
| Background simulation | Existing server worker continues all ticks, matched orders and settlement with no viewers. UI scheduling does not alter market behavior. |
| Honest measurements | Unit tests and server transport tests are not FPS measurements. Maestro checks native controls on an Android API 35 emulator; this does not certify frame rate on budget phones. |

## Verified locally

All balances used below are dummy funds in a disposable local database. No production LIVE stake was placed.

- Native suite: 1,533 tests passed (including quote selection, request identity, SL/TP and currency behavior); later targeted 47 tests passed after cleanup.
- Website: 101 files, 577 tests passed. Production Next build passed with local build environment.
- Shared contracts: 126; client core: 121; database: 406; notification package: 19 tests passed.
- Engine regression suite: 430 passed, 16 database-specific OTC tests skipped in that command. Separate OTC run: 6 files, 23 passed with the isolated PostgreSQL database enabled.
- OTC ledger: 8 tests passed separately, including currency race and no duplicate debit. Notification currency regression: 9 tests passed.
- TypeScript passed for native, website, engine, contracts, client core, database and notify.
- Android native build compiled and installed on a fresh disposable API 35 emulator. Normal login/PIN setup reached the trade screen. A 30-second trade opened and settled; three concurrent contracts and a fourth protected contract were persisted. SL/TP swipes changed the submitted levels; submitted handles cleared. Timeframe switching and fullscreen exit/entry passed.
- The device test exposed a fullscreen regression and an overly fast automation tap; the display condition was fixed and the test now waits for accepted requests before tapping again.
- Independent Ponytail review: final verdict “Ship” after retry identity, hidden chart, currency and push startup fixes. No remaining concrete source blocker found. Production and hardware performance are separate gates.

Screenshots: [settlement](testing/mobile-otc/settled.png), [simultaneous contracts](testing/mobile-otc/simultaneous.png), [chart SL/TP](testing/mobile-otc/protection.png).

## Native frame sample

Android `dumpsys gfxinfo` around six automated pan gestures in the debug API 35 emulator recorded 310 frames: median 19 ms, p95 65 ms, p99 101 ms; 22 slow UI-thread frames. This misses the checklist's 16 ms p95 target. The sample ran on a software-rendered emulator while a native release build used the host CPU, so it is not a production-phone FPS measurement. A standalone build must be remeasured under less host load; no smoothness guarantee is made from unit results.

## Restart and repeat

Use a disposable local PostgreSQL database and Redis, apply Prisma migrations, seed the catalog, then run web and engine with `OTC_ORDER_BOOK_ENABLED=true`. Native Metro must receive the same API/WS URLs as that server. Reverse those ports into an Android emulator when using loopback URLs.

The local fixture script refuses every database except `127.0.0.1:55449/mobile_otc_demo`; its email/password and funds are deliberately test-only. Never run fixtures against production.

Run `apps/mobile/e2e/login-trade.yaml` with local credentials, `DEV_CLIENT_URL`, and `DEV_SERVER_PORT`; then `otc-trading.yaml` on that freshly signed-in test account. Long expiry keeps the concurrent contracts open during the control checks.

## Deployment and artifact gates

Deploy server changes only through the PR/main/GitHub Actions path. Compose applies the mobile-session and notification migrations before web/engine startup. No direct source copy or manual production restart is part of this work.

The repository has no owner OTA certificate, and GitHub currently has no Android signing/Firebase secrets. A locally assembled APK signed by the Android development key is a verification artifact, not an owner-signed public release. Existing release automation intentionally refuses to publish without owner credentials. Actual push delivery and low-end physical-device FPS are not certified by this report.

## Production verification

- Integration [PR #138](https://github.com/Bhavesh-Solminde/ASM-Trading/pull/138) merged as `f820a58e0e7ae2c7ff40534dd67c133824161e4e`.
- [PR validation](https://github.com/Bhavesh-Solminde/ASM-Trading/actions/runs/42585117773) and [production deployment](https://github.com/Bhavesh-Solminde/ASM-Trading/actions/runs/42585943880) passed through GitHub Actions. Compose applied the required migrations.
- Production API/WebSocket checks registered a normal QA USER, confirmed `OTC_FIXED` and 92% across all 30 markets, and received history and positive quote tokens for each market. A DEMO contract retained the issued displayed quote; retrying the same request returned the same contract without another debit.
- Standalone Android verified normal production login, PIN setup, DEMO account selection, stake/duration selection and 30-second settlement. No LIVE funds were traded or credited.
- The QA user's initial LIVE refusal was its account permission, not a chart/feed failure. At the owner's request, only that QA USER's `liveAccess` was enabled with an audit record. Role remained USER and LIVE balance stayed zero. Native LIVE switching then passed.
- Native verification APK uses embedded production API/WS URLs and the Android development signing certificate; owner signing/OTA/Firebase setup and physical-device performance remain separate release gates.
