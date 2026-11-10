# IndianxTrade local launch-readiness review — 9 November 2026

Verdict: suitable for continued local testing; **not ready for a public release**.

## Exact scope

- Current combined mobile source: `codex/mobile-complete-p3-p5`, commit `1c66e0e`.
- Previous preview: `claude/mobile-p2-shell-trade`, commit `20befb5`; its October APK was superseded for this test.
- Fresh debug APK: `.claude/worktrees/codex-mobile-complete/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, about 118 MB, arm64 only, version 0.1.0 / versionCode 1.
- Android 15 / API 35 emulator; app targets API 36, minimum API 26. This is a development-client build, not a distributable release candidate.
- Fresh local PostgreSQL on 127.0.0.1:55439 and Redis on 127.0.0.1:6389. Web on 3200, engine WebSocket on 4001, internal API on 4002, Metro on 8082.
- Hosted credentials were not used for these test mutations. The previous preview server was replaced with the isolated environment. All trades and treasury funding in this test are local fixtures.
- No production deployment, external payment, release signing, account-provider setup or source-code changes were performed.

## Passed in this run

| Check | Result |
| --- | --- |
| Previous mobile branch tests | 741 tests in 79 files; type check passed |
| Combined mobile branch tests | 1,540 tests in 145 files; type check passed |
| Targeted server routes, headers and session tests | 56 tests in 14 files passed |
| CFD expiry/risk tests | 39 tests in 2 files passed |
| Database-backed CFD lifecycle | 1 test passed: HTTP auth, currency rejection, exact fee accounting and duplicate-close protection |
| Database setup | All 39 migrations applied to a fresh local database; 19 assets seeded |
| Fresh Android native build | Passed, 936 tasks, using a temporary local NDK override |
| APK installation and startup | Installed; app login screen confirmed in native accessibility hierarchy |
| Production Android JS/assets export | Passed; Hermes bundle approximately 7.3 MB |
| Authentication API | Unauthenticated bootstrap and wrong password rejected; native bearer login and authenticated bootstrap passed |
| Account protection | Foreign account rejected; stale account currency rejected |
| CFD duration settlement | Local 5-second demo LONG opened and closed for DURATION; exact balance accounting verified |
| CFD manual closing | Local demo SHORT closed after 10-second lockout; repeated close did not change balance |
| Wallet, payment history, account APIs | Returned HTTP 200 |
| Chart transport | Authenticated WebSocket, initial history, unsubscribe/subscribe switching, and ticks received |

Duration-settlement example: starting balance 10,000,000 paise; spread fee 500 paise; settled P&L -161 paise; resulting balance 9,999,339 paise. The result exactly equals starting balance minus fee plus P&L.

The fresh database initially had zero treasury funding, so the first stake was correctly rejected. A local-only treasury fixture of 30,000,000 paise enabled the trading checks. Manual close attempts before the documented 10-second lockout were also correctly rejected; closing after the lockout passed.

## Release blockers observed locally

1. **No signed release candidate validated.** The installed APK is debug-signed and depends on Metro. It must not be presented as the public production APK.
2. **Release preflight fails.** `scripts/app-release.sh build 0.1.0` stops with: `Owner setup required: public OTA certificate at apps/mobile/certs/certificate.pem`. The certificate is absent in the tested checkout. Real signing identities, matching OTA private key and provider credentials remain owner setup; this review did not inspect private key contents.
3. **Push is not configured in this test environment.** Engine explicitly logs missing FCM and VAPID configuration; the VAPID endpoint returns `publicKey: null`. Real background notification delivery remains unverified.
4. **Release download is unavailable locally.** `/download/app` returns HTTP 404. App config reports latest/minimum versions 0.0.0 and Play not live under this local configuration. This does not establish the condition of the deployed production site.
5. **Native end-to-end acceptance is incomplete.** The committed Maestro flow did not progress through its development-client handoff. A direct developer deep link loaded the app and its login screen. Subsequent native input automation stalled, including retries with JDK 17. Do not count native PIN, payment, KYC, trade-button, or logout flows as passing based on API/unit tests.
6. **Physical-device and upgrade acceptance remain open.** Real Android biometric/PIN behavior, camera/gallery KYC, UPI-app return, signed upgrade continuity, notification delivery, OTA signature rejection/apply/rollback and Hindi layout need testing with the actual release build. No such validation was completed here.

## Local build issues resolved for this test

The new Expo Updates native dependency selected an incomplete NDK 27.0.12077973 directory (missing source.properties). A temporary Gradle initialization script selected installed NDK 27.1.12297006. The build then succeeded in 1m58s. This local workaround is outside tracked source and does not prove the default CI/release toolchain builds unmodified.

The emulator had insufficient space to install over the older preview. Only the old `com.indianxtrade.app` preview was uninstalled, then the new APK installed successfully. Other installed apps were retained.

## Chart-performance scope

Applied the project chart checklist in proportion to this readiness review: tested authenticated bootstrap/history, incremental tick delivery and selected-market switching. The fresh database had only a few real history bars per market. Observed history messages were 348/377 bytes and arrived about 10/11 ms after the local socket test started. These are local transport observations, not render/switch-frame timing or production performance claims.

No actual browser/native frame-rate measurement, long-session profiling, large-history stress test, 300× playback or one-hour simulation scheduling test was performed. No tick/order/settlement algorithm was changed.

## Test access and evidence

Web preview: http://localhost:3200/login. Local fixture account: `test10@asmtrade.local`, password `asm-demo-test-2026`. It has a DEMO account; every balance in this isolated environment is test data.

Structured API, transport and settlement results and targeted test logs are next to this report. APK SHA-256 is in `debug-apk.sha256`. Temporary build, service and native-runner logs are in `/tmp/indianxtrade-readiness-20261109/`; this folder contains a local test token and is intentionally not copied wholesale into repository artifacts.

Recommended next milestone: complete signing/provider setup, build a signed release candidate, and finish the native and physical-device acceptance flows before public distribution.

## Follow-up: default NIFTY screen waiting for prices

The user reached the signed-in native trade screen manually. Live follow-up checks confirmed that web/engine services and Android port forwarding are running, and account/market-status requests are reaching the local server. NIFTY50 reports `unavailable`; BTCUSDT and BNBUSDT report `open`. The isolated database has zero IntegrationToken entries, and its local launch environment does not configure FYERS_APP_ID. Consequently there is no authenticated FYERS quote feed for NIFTY in this local environment. The default bootstrap selects NIFTY50, so the default screen waits for a valid open market and fresh quote. This is a feed-configuration gap, not evidence of a disconnected account API. Crypto can be selected for the current demo test; FYERS setup is required to test live Indian-index behavior. The prior handoff should have called out this default-market limitation explicitly.
