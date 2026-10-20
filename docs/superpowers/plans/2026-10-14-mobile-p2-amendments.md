# Mobile P2 — plan amendments (pre-flight review, 2026-10-14)

These override `2026-10-14-mobile-p2-shell-trade.md` where they conflict. Controller: pass each task's
section (plus "All tasks") to that task's implementer and reviewer. The decisions were made by the
controller while the owner was away; they are conservative and reversible.

## Owner-only steps (skip or stub; list them in the P2 PR)
- T1 Step 8 (Play upload keystore, its passwords, signed AAB, Play upload): **skip**. The generated `android/app/build.gradle` signs release builds with the debug config and never reads `MYAPP_*`, so release signing is deferred to P5 (config plugin + CI).
- T5 Google sign-in needs `APP_GOOGLE_WEB_CLIENT_ID` + Android OAuth clients (both package names, signing SHA-1) + server `GOOGLE_CLIENT_ID`/`GOOGLE_ANDROID_CLIENT_IDS`. **Stub:** hide the Google button when `appConfig().googleWebClientId` is empty.
- T11 Step 5 fps on physical phones, T3/T15 native-speaker review of `hi.json`: owner tasks (release blockers).
- T15 Maestro is not installed. Installing it means downloading an installer, which needs the owner's OK. **Write the flows but don't run them**, and say so in the report.
- Seed has no usable trader login: for manual checks, register a local user via `/api/auth/register` against an isolated DB (memory `local-browser-verification`). Record it in an example env file, never in chat.

## All tasks
- Every commit ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every UI string goes in `src/i18n/en.json` + `hi.json` (plan-hardcoded strings included: "Deposit", "Log out", "Trade failed.", "Something went wrong.", "Google sign-in failed.", "Check your details.", BonusSheet copy, PinPad "Delete", the OHLC label). Each task adds its own keys and keeps the parity test green.
- Touch targets ≥ 44pt (TopBar Demo/Live segments and the deposit button too). Don't fix the tab bar height in a way that drops the bottom safe-area inset.
- Lint: add an `apps/mobile` block to the root `eslint.config.mjs` (or ignore `apps/mobile/{android,.expo}` and the CJS config files). Don't use `Math.random` (banned; use `expo-crypto`), `require()` for imports, or disable comments naming the uninstalled `react-hooks/exhaustive-deps` rule.
- Native lib versions: write code against the version `expo install` actually installs. Known: `react-native-mmkv` v4 (`createMMKV({ id })`, `.remove` not `.delete`, needs the `react-native-nitro-modules` peer). Reanimated 4 needs `react-native-worklets`; `runOnJS` → `scheduleOnRN`.
- Reuse, don't copy: `shortCountdown`, `minStakeMinor`, `applyKey(current, key, { decimals: currency !== "INR" })`, `BONUS_TIERS`, `bonusPercentForDeposit`, `closedRowDisplay`, contract types (`Bootstrap["assets"][number]` instead of a new `AppAsset` interface).
- `ANDROID_HOME=~/Library/Android/sdk` (not set in agent shells). The AVD `Medium_Phone_API_35` exists.

## T1 (scaffold)
- Copy `apps/relay`'s `babel.config.js` (preset only, **no** reanimated plugin; babel-preset-expo adds worklets) and `metro.config.js` verbatim.
- Add `@expo/metro-runtime` and `@expo/log-box` (expo-router peers; pnpm strict linking breaks without them, see relay commit a7fdfd0), plus `react-native-worklets` and `react-native-nitro-modules`.
- Drop the cleartext "development override": Expo's debug manifest already allows cleartext. Release stays `false`.
- Deploy filter: `--filter '!@asm/mobile'`, **without** the trailing `...`, which would also exclude `@asm/client-core`/`@asm/contracts` from validate. Verify with `pnpm ls -r --depth -1 --filter '!@asm/relay...' --filter '!@asm/mobile'` that contracts and client-core are still listed. Optionally add `apps/mobile` to `.dockerignore` next to `apps/relay`.

## T4 (API client)
- `classifyResponse`: log out **only** when `code === "unauthenticated"` and never for `auth:false` calls. The login 401 ("Email or password is incorrect.", no code) and google/native 401 (`google_failed`) are form errors. Add a test for the login 401.
- `api()` clears the maintenance/blocked gate only on `/api/v1/*` 2xx, or from those screens' own polls. `/api/auth/*` (e.g. ws-ticket, logout) stays reachable during maintenance and must not clear it.

## T5 (auth)
- Call `configureGoogle(appConfig().googleWebClientId)` in the root layout; hide the Google button when it's empty.

## T6 (lock)
- Persist the wrong-PIN count in SecureStore; force-stopping the app must not reset it. 5 → logout.

## T7 (gate + shell)
- Keep `app/index.tsx` as `<Redirect href="/trade" />`. Gatekeeper waits for the root navigation state before `router.replace`.
- `OfflineBanner` needs `useSocket` (T8): render a stub in T7 and wire it in T8.
- T7 also edits `lock-store` / `lock-setup` (missing from its Files list).
- Maintenance screen: remove the bare `useGate();`. Blocked screen: set the gate to "ok" only after its retry succeeds.

## T8 (socket)
- In tests, `flush` must be `await vi.advanceTimersByTimeAsync(0)`. A `setTimeout` promise never resolves under fake timers. The "counts consecutive failures" test and probably test 2 need it.
- NetInfo offline short-circuits reconnect retries (spec).

## T9 (resume cache)
- Store the last userId in MMKV so the cache renders on cold start before bootstrap. Mark the shown cache stale (spec). Don't call `loadResume()` on every render.

## T10–T11 (chart)
- Gestures: `.runOnJS(true)` on each gesture (or shared values), with the start viewport in a ref. No stale React-state closures; don't rebuild gestures on every viewport change mid-gesture.
- When older candles are prepended, shift `rightIndex` by the number prepended, so a scrolled-back view doesn't jump.
- History path excludes the forming candle and `lastPrice` and is rebuilt at most once per 250ms. Only the live layer redraws per tick. Memoise `MakeFromSVGString`.
- Countdown label uses `shortCountdown`. The chart type is saved per user (spec).

## T12 (trade screen)
- Write `markets.ts` directly; it's missing from the Files list and Dock imports it.
- Bonus: `bonusPercentForDeposit(boot.completedDeposits + 1)` and `BONUS_TIERS`; `nextBonusPercent` isn't in client-core. Wallet/DepositConfig schemas already carry `nextBonusPercent`/`bonusTiers`.
- Live is disabled when `!liveAccess`. Add the sentiment bar (spec). Avoid whole-screen re-renders every second from `useNow`; isolate the ticking components.
- Theme: background token is `ground #000000` (no `--color-bg`). Add `upInk #03170b` (and a matching `downInk`) for text on green/red buttons; white on `#3be584` fails contrast.

## T13 (dock)
- Min stake from `minStakeMinor` from the start; keypad decimals via `applyKey`.
- Every Sheet closes on the Android hardware back button (`BackHandler`); @gorhom/bottom-sheet modals don't do this themselves.

## T14 (positions + results)
- Trade statuses are `OPEN | WON | LOST | REFUNDED` (no `DRAW`; no `as never` casts). Base `settledFeedback` on `closedRowDisplay(trade)` so the toast and the trades sheet show the same number.
- `openSide(direction, entryPrice, price)` is the real signature.

## T15 (E2E)
- Add the "background ≥ 5 min → lock" case (spec), not only cold start. Don't run the flows (see Owner-only).

## compareVersions
Not in client-core (`apps/web/src/lib/app-client.ts:24`). Decision: **move it** to `packages/client-core/src/time/version.ts` with its tests, re-export it from `app-client.ts` (the proxy keeps importing from there), and use it from the app. Do this in T7 (its first user).
