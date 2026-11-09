# Native implementation evidence

Captured 2026-10-21 from the running R5 React Native app on **Medium Phone / Android API 35**, 1080×2400. These are emulator screenshots, not Figma exports. The floating gear is Expo's development-client control.

Balances, market candles, profile and transactions are synthetic local fixtures from `../../e2e/screenshot-fixtures.cjs`. No production account, real trade or payment was used. Screenshot values are not evidence of backend financial correctness.

| Screenshot | State |
| --- | --- |
| [Trading](r5-trade.png) | Normal chart, open-position card, original bull/bear controls |
| [Fullscreen](r5-fullscreen.png) | Same chart; Demo, market, History, amount, duration and Up/Down remain visible |
| [History sheet](r5-history-sheet.png) | Open trades over fullscreen chart |
| [History tab](r5-history.png) | Open-position card and account day result |
| [Payments](r5-payments.png) | Wallet and activity from fixture API |
| [Account](r5-account.png) | Profile and settings hub |

## Reproduce

From `apps/mobile`, run `node e2e/screenshot-fixtures.cjs`. Start Metro with `APP_API_URL=http://127.0.0.1:3217 APP_WS_URL=ws://127.0.0.1:3217 pnpm exec expo start --dev-client --port 8081`. Reverse emulator ports 3217 and 8081 with ADB. Use the existing matching development-client APK, and open `indianxtrade://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`.

Sign in with `screenshots@example.test` and a synthetic password (12+ characters); the local fixture server returns a test-only session. Skip optional PIN setup, then run `maestro test e2e/visual-proof.yaml`. The flow performs navigation and assertions only; the fixture server rejects trading/payment actions.

The passing flow checks that fullscreen hides tab navigation while preserving account, amount, duration and both direction buttons. It opens History, dismisses it with Android Back, asserts fullscreen remains, then uses Back again and asserts navigation returns. All six screenshots are captured by the flow.

These views still differ from the final Figma specification in places. Outstanding work is listed in `../redesign-r5-status.md` and the draft PR.
