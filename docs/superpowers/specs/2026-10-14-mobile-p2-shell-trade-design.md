# Mobile sub-project 2 — app shell + Trade

**Date:** 2026-10-14 · **Overview:** [mobile app overview](2026-10-14-mobile-app-overview-design.md) · **Needs:** [sub-project 1](2026-10-14-mobile-p1-server-design.md)

## Goal

A working Android app in `apps/mobile` with login, app lock, English/Hindi, the
four-tab shell and a full Trade screen on a native Skia chart, matching the
current mobile web layout.

## Package and stack

`apps/mobile` (`@asm/mobile`), Expo SDK 57, expo-router (typed routes), new
architecture, TypeScript strict. Metro config copied from `apps/relay`
(workspace watch folders, symlinks). Excluded from the web deploy workflow the
same way as relay (`--filter '!@asm/mobile...'`).

| Concern | Library |
|---|---|
| Server state | `@tanstack/react-query` |
| Client state | `zustand` (socket store, session store, ui prefs) |
| Chart / drawing | `@shopify/react-native-skia` |
| Gestures / motion | `react-native-gesture-handler`, `react-native-reanimated` |
| Sheets | `@gorhom/bottom-sheet` |
| Secure storage | `expo-secure-store` |
| Biometric | `expo-local-authentication` |
| Cached data | `react-native-mmkv` |
| i18n | `i18next` + `react-i18next` |
| Haptics / awake | `expo-haptics`, `expo-keep-awake` |
| Native Google | `@react-native-google-signin/google-signin` |
| In-app browser | `expo-web-browser` |
| Device name | `expo-device` |

`app.config.ts` (dynamic, reads `APP_VARIANT`): name "IndianxTrade", package
`com.indianxtrade.app` for `play` and `com.indianxtrade.app.direct` for
`direct` (distinct IDs so the two builds, signed by different keys, never
collide on one phone); `minSdkVersion
26`, `targetSdkVersion 36`, portrait, dark UI, no cleartext in release.

## Folder layout

```
apps/mobile/
  app/                      expo-router routes
    _layout.tsx             providers, splash, gate screens
    (auth)/login.tsx register.tsx forgot.tsx
    (tabs)/_layout.tsx      bottom tab bar
    (tabs)/trade.tsx payments.tsx history.tsx account.tsx
    lock.tsx  update-required.tsx  maintenance.tsx  blocked.tsx
  src/
    api/        client.ts (fetch + auth + error codes), queries.ts
    auth/       session-store.ts, google.ts
    lock/       lock-store.ts, pin.ts
    socket/     engine-socket.ts, socket-store.ts
    chart/      Chart.tsx, layers/, scale.ts, gestures.ts, series/{candles,line,area,bars}.ts
    trade/      TradeScreen parts (StatusRow, MarketPill, Dock, KeypadSheet, PositionStrip, TradesSheet, BonusSheet, MarketSheet)
    theme/      tokens.ts (from globals.css), primitives
    i18n/       en.json, hi.json, index.ts
    cache/      resume-cache.ts
```

## API client

- Base URL from `app.config` extra (`apiUrl`); HTTPS only in release.
- Every request sends `Authorization: Bearer`, `X-Client: app/<version>`,
  `X-Device-Name`.
- Response handling by `code`: `unauthenticated` → clear token, go to login;
  `maintenance` → maintenance screen (poll `app/config` every 30s);
  `vpn_blocked` → blocked screen; `upgrade_required` → update-required screen;
  `rate_limited` → toast. Bodies are parsed with the `@asm/contracts` schema;
  a schema mismatch is reported as an error, never rendered.

## Auth

- Login / register forms mirror the web validation (`LoginSchema`,
  `RegisterSchema`).
- Google: native sign-in → `idToken` → `POST /api/v1/auth/google/native`.
- Forgot password: request screen calls the existing route; the reset link
  opens the website (in-app browser), then the user logs in.
- Token stored in `expo-secure-store`; never in MMKV or logs.

## App lock

- After first successful login: "Protect your account" screen — enable
  biometric if `hasHardwareAsync && isEnrolledAsync`, else set a 4-digit PIN.
  Users can skip once; it is still on by default (skip = PIN setup reminder on
  next launch).
- PIN stored as `sha256(salt + pin)` in secure store, salt per install.
- Lock triggers: app cold start, or return from background after ≥ 5 min
  (timestamp saved on `AppState` → `background`). A reboot is a cold start.
- 5 wrong PINs → logout (token deleted, session revoked via logout route).
- Account → Security: turn lock off (requires current PIN/biometric), change
  PIN.

## i18n

All UI strings in `en.json` / `hi.json` keyed by screen (`trade.buy`, …).
Language chosen on first launch from the phone locale (`hi*` → Hindi), changed
in Account → Language, saved via `PATCH /api/v1/account/preferences`. Numbers
and money keep Latin digits and the `₹` format from `client-core` in both
languages. A CI check fails if a key exists in one file but not the other.

## Engine socket

`engine-socket.ts` ports `useEngineSocket` to a framework-free class:

1. `POST /api/auth/ws-ticket` (bearer) → `{ ticket }`.
2. Connect `wss://…/ws`, send `{ type: "auth", token: ticket }`, wait `authed`.
3. Re-send active `subscribe { symbol, timeframe }`.
4. Dispatch server messages into `socket-store` (ticks, candles, payout,
   trades, balances, sentiment) using `client-core` `engine-state` reducers.

Lifecycle: on `AppState` background → close socket (so the server sees the
user as offline, which drives push). On foreground → reconnect. Reconnect
backoff 0.5s, 1s, 2s, 4s, 8s, max 15s with jitter; offline banner after the
second failure; `NetInfo` offline short-circuits retries.

## Native chart

**Data:** `CandleDto[]` per `(symbol, timeframe)` from `candles:history`,
updated by `tick` / `candle:close`, older pages via `candles:loadOlder`
(200 at a time, when the left edge is within 20 candles).

**Rendering:** one Skia `Canvas` with two layers —

- *History layer*: all closed candles as a single `Path` per colour (up/down),
  rebuilt only when the visible range or data changes.
- *Live layer*: the forming candle, price line + label, open-trade entry lines
  with countdown, expiry vertical line, crosshair — redrawn per tick.

**Scale:** `scale.ts` holds visible index range ↔ x, price range ↔ y (auto-fit
visible high/low with 8% padding). Pure functions, unit-tested.

**Series v1:** candles, line (close), area (close with gradient), bars (OHLC).
Type stored in MMKV per user.

**Gestures (reanimated worklets):** pan = scroll time; pinch = zoom (min 15,
max 300 visible candles); long-press = crosshair with OHLC tooltip; double-tap
= reset to live edge. A "back to live" button appears when scrolled away.

**Performance budget:** ≤ 1 history rebuild per 250ms; live layer only on
tick; target ≥ 45fps on the low-end test phone, measured with the perf
monitor and recorded in the PR.

## Trade screen (same layout as mobile web)

- **Status row:** live dot, clock (`useNow`), "+N% bonus" chip → bonus sheet.
- **Top bar:** logo, Demo/Live switch (account switch persists in MMKV),
  balance of the active account, deposit shortcut.
- **Chart area:** market pill (always visible) → market sheet with search and
  favourites (MMKV); chart-type and timeframe controls in the `⋯` cluster;
  sentiment bar.
- **Dock:** stake tile → keypad sheet (quick amounts, `client-core` `stake`
  limits incl. ₹100 / $1 minimum); expiry chips 30s / 1m / 5m / 15m / More
  (More = sheet with all `TRADE_DURATIONS_SEC`); Buy (UP) / Sell (DOWN) with
  payout % inside. Submit = `POST /api/trades` (`OpenTradeSchema`), disabled
  while in flight.
- **Position strip:** live P&L of open trades (`client-core` `pnl-display`,
  `position`), tap → trades sheet.
- **Trades sheet:** Open / Closed tabs; closed list from bootstrap + socket.
- **Result feedback:** on `trade:settled` for an open trade — toast with
  result and `Haptics.notificationAsync(Success|Warning)`.
- **Haptics:** keypad keys light, Buy/Sell medium.
- **Keep awake** while ≥ 1 trade is open (`activateKeepAwakeAsync` /
  deactivate when none).
- **Resume cache:** on background, save active symbol, timeframe, last 200
  candles, balances and open trades to MMKV; on cold start render them
  immediately (marked stale) and replace when bootstrap + socket arrive.

## Shell

- Bottom tabs: Trade · Payments · History · Account (icons ported from
  `components/shell/Icon.tsx` to `react-native-svg`). Payments/History/Account
  are placeholders until sub-project 3.
- Android back: closes the top sheet first, then navigates back, then
  exits from Trade.
- Gate screens (maintenance, blocked, update required, offline) render above
  the tabs.
- Safe-area insets everywhere; 44pt minimum touch targets.

## Testing

- Unit (vitest, pure TS): `scale.ts`, series path builders, socket reconnect /
  resubscribe state machine (fake WebSocket), lock timer rules, PIN hashing,
  i18n key parity, API client error-code mapping.
- E2E (Maestro, Android emulator): login → lock setup → demo trade → result
  toast; background > 5 min (clock-advanced) → lock screen; maintenance
  response → maintenance screen.
- Manual: chart fps on both test phones; Hindi layout check on every screen.

## Out of scope

Payments, History, Account content (sub-project 3), push (4), 7 extra chart
types, landscape chart, tablets.
