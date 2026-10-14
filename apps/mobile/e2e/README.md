# End-to-end flows (Maestro)

Three flows for the Android app. **They have been written but not yet run**: Maestro was not installed on the
machine that wrote them, and installing it needs the owner's OK. Expect to fix small things (timeouts, the
dev-client hand-off) on the first real run, and record the output in the PR.

| Flow | What it covers | Needs |
| --- | --- | --- |
| `login-trade.yaml` | fresh install, sign in, set a PIN, 30s demo trade, settlement toast | web + engine, a test user |
| `lock.yaml` | cold-start lock, short background keeps the app open, 5-minute background relocks, 5 wrong PINs end the session | the state `login-trade` leaves (PIN `1234`); **~6 minutes** |
| `maintenance.yaml` | maintenance gate screen | web started with `MAINTENANCE_MODE=1` |

`subflows/` holds helpers (`open-dev-client`, `enter-pin`). They are not flows of their own, so run the three
flows above one by one. Do not point `maestro test` at the whole folder: the order is alphabetical (`lock`
before `login-trade`) and `maintenance` needs a different server.

## Setup

1. **Isolated database, engine and web.** Use a throwaway database, never the shared dev one (and a Redis
   the engine and web share, `REDIS_URL`). Next.js does not serve `/ws`: the socket is the engine's (in
   production nginx proxies `/ws` to it), so the engine must run locally too, and the web server must know
   where it is. Put the isolated values in an env file (see `.env.example`) and start both from the repo root:

   ```bash
   # engine: websocket on 4001, loopback control API on 4002; no bots so the book stays quiet
   DATABASE_URL=<isolated> DIRECT_URL=<isolated> REDIS_URL=<redis> \
     ENGINE_WS_PORT=4001 ENGINE_HTTP_PORT=4002 ENGINE_INTERNAL_SECRET=<any> BOTS_ENABLED=false \
     pnpm --filter @asm/engine start     # `start`/`dev` read ../../.env via dotenv; exported vars win over it
   # In a worktree with no ../../.env that wrapper is untested. The reliable alternative (worked on device) is to
   # export the same variables and run the entry point directly:
   #   cd apps/engine && pnpm exec tsx src/main.ts
   # @asm/config validates DATABASE_URL, DIRECT_URL, REDIS_URL and SESSION_SECRET strictly, so export all four.
   # The engine also needs markets seeded: it throws "No open assets found" otherwise.

   # web on 3200 (the `dev` script is fixed to 3000), pointed at that engine
   DATABASE_URL=<isolated> DIRECT_URL=<isolated> REDIS_URL=<redis> \
     ENGINE_HTTP_URL=http://127.0.0.1:4002 ENGINE_INTERNAL_SECRET=<same> \
     NEXT_PUBLIC_ENGINE_WS_URL=ws://localhost:4001 \
     pnpm --filter @asm/web exec next dev --port 3200
   ```

   Charts need history: the pan, zoom and older-candles checks need at least ~150 candles per market in the
   database. On a fresh database the view is clamped to about 7 candles, so backfill candles first.

   Demo trades need a market that is open. A 30s trade settles in the engine and the result arrives over the
   socket. Check `apps/engine/src/main.ts` and `apps/web` for any other variable your `.env` normally supplies.
2. **A test user.** Either use a seeded one (`packages/db/prisma/seed.ts` lists the `test*@asmtrade.local` users and
   their demo password; run the seed against the throwaway DB), or register one against the local web server:

   ```bash
   curl -sS -X POST http://localhost:3200/api/auth/register \
     -H 'content-type: application/json' \
     -d '{"name":"E2E Tester","email":"<email>","password":"<12+ characters>"}'
   ```

   Never commit real credentials. Pass them to Maestro with `-e`, not in the YAML.
3. **A debug build pointed at the local servers.** `apps/mobile/app.config.ts` reads these at build/start time:
   `APP_API_URL` (default `https://indianxtrade.com`), `APP_WS_URL` (default `wss://indianxtrade.com/ws`),
   `APP_GOOGLE_WEB_CLIENT_ID` (leave unset). `APP_VARIANT=direct` switches the package to `com.indianxtrade.app.direct`
   (then change `appId` in the flows). Emulator steps that worked (see the T7 device notes: `CI=1 pnpm prebuild`, an
   arm64-only `./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a` because the 4-ABI APK is too big for the
   emulator, then `adb install -r`):

   ```bash
   adb reverse tcp:3200 tcp:3200   # web API
   adb reverse tcp:4001 tcp:4001   # engine websocket
   adb reverse tcp:8081 tcp:8081   # Metro
   cd apps/mobile
   APP_API_URL=http://localhost:3200 APP_WS_URL=ws://localhost:4001/ws CI=1 pnpm exec expo start --dev-client --port 8081
   ```

   A release build cannot be used: it refuses cleartext `http://localhost`.
4. **Emulator quirks.**
   - The Gboard stylus popup swallows the first typed characters:
     `adb shell settings put secure stylus_handwriting_enabled 0`.
   - The dev client shows its "developer menu" intro sheet after **every** relaunch through the dev-client deep
     link (every `am force-stop` plus launch, and after a hardware-Back exit plus relaunch), not only after a
     fresh install or `clearState`. The `open-dev-client` subflow must dismiss it every time (its close button
     is near (970, 1081) or (970, 1740) on a 1080x2400 screen, depending on layout).
   - With the app locale set to Hindi (`hi-IN`), `adb shell input text` cannot type Latin letters (digits and
     symbols work: an email came out as `1791957199@.com`). Set the locale back to English before typing
     credentials: `adb shell cmd locale set-app-locales com.indianxtrade.app --locales ""`.
   - Bottom-sheet content (market list, keypad, expiry, trades) shows up in a uiautomator dump only ~2.5 s after
     the sheet opens; a dump at 1-1.5 s returns just the page behind it. Use `extendedWaitUntil` for `key-1`,
     `keypad-done` and `expiry-*` after opening a sheet.
   - `adb svc wifi/data disable` and `adb reverse --remove` do **not** drop an already-open adb-tunnelled
     WebSocket (the offline banner shows through NetInfo, but the socket stays alive and keeps delivering). For
     offline or reconnect flows put a small TCP proxy in front of the engine port, point `adb reverse` at the
     proxy, and have it destroy its connections and refuse new ones on a signal.
   - The AVD's `screen_off_timeout` is 2147483647 (never) by default, so keep-awake can only be checked after
     setting a short one (`adb shell settings put system screen_off_timeout 15000`); restore it afterwards.

## Running

The app id is `com.indianxtrade.app` (default variant). The debug build is an Expo dev client, which shows a
launcher after every restart; the flows hand it the Metro URL when you pass `DEV_CLIENT_URL`:

```bash
DEV='exp+indianxtrade://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'

maestro test -e EMAIL=<test user> -e PASSWORD=<its password> -e DEV_CLIENT_URL="$DEV" apps/mobile/e2e/login-trade.yaml
maestro test -e DEV_CLIENT_URL="$DEV" apps/mobile/e2e/lock.yaml   # ~6 minutes, see below
```

For `maintenance.yaml`, restart the web server with `MAINTENANCE_MODE=1` (it needs the Node-runtime `proxy.ts`
setup, so use `next dev` or `next start`), then:

```bash
maestro test -e DEV_CLIENT_URL="$DEV" apps/mobile/e2e/maintenance.yaml
```

Without `DEV_CLIENT_URL` the helper does nothing (it has no default in the YAML; it checks the variable is defined), which is right for a build that embeds its JavaScript.

## Notes

- **The 5-minute case.** Maestro cannot move the clock, so `lock.yaml` really presses Home and waits 5 minutes
  10 seconds (`extendedWaitUntil` on an id that never appears, marked `optional`), then brings the same process
  back with `launchApp: stopApp: false` and expects the PIN pad. Android must keep the app alive meanwhile; if
  it kills the process during the wait, the relock you see is a cold start, so the step can pass without
  exercising the background timer. Check `adb shell pidof com.indianxtrade.app` is the same before and after if
  that matters. To skip the wait while iterating, comment out step 3.
- **`hideKeyboard` on Android is a back press** (Maestro presses back when the keyboard is up). If the first
  run fails at `login-submit`, that is the first thing to look at; replacing the two lines with
  `pressKey: Enter` on the password field submits the form instead.
- **`lock.yaml` ends signed out** (five wrong PINs clear the session and the lock). Run `login-trade.yaml` again
  before the next `lock.yaml`.
- **The trade flow waits for a settlement toast.** It matches a `toast` containing " · " (the settlement text is
  "<market> · <result>", for example "BTC/USDT · Won ₹193.00"; no error message has that separator), so a "trade
  failed" toast does not pass. The settlement arrives about 4-5 s after the 30 s expiry (the engine settles a few
  seconds late), so the flow's 60 s toast timeout is right: do not shorten it.
- The stake keypad appends digits to the saved stake, so the flow clears it with the backspace key first.
- IDs used: `login-email`, `login-password`, `login-submit`, `lock-set-pin`, `pin-<0-9>`, `lock-message`,
  `account-demo` (also `account-live`), `stake-tile`, `key-<0-9|back>`, `keypad-done`, `expiry-<seconds>`,
  `buy` (also `sell`), `toast`, `gate-maintenance`.
- The Hindi pass (screenshots of login, lock setup, trade, keypad, market and trades sheets) is a manual device
  check, not a flow here.
