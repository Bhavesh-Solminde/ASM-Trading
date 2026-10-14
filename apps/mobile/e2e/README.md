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

1. **Isolated database and servers.** Use a throwaway database, never the shared dev one. Start the web server
   and the engine against it (the same `DATABASE_URL`/`DIRECT_URL`, secrets and Redis, if any, for both).
   Demo trades need the engine running and a market that is open. Settlement of a 30s trade is announced
   through the engine's socket.
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
   adb reverse tcp:3200 tcp:3200   # web (and /ws if it is served there)
   adb reverse tcp:8081 tcp:8081   # Metro
   cd apps/mobile
   APP_API_URL=http://localhost:3200 APP_WS_URL=ws://localhost:3200/ws CI=1 pnpm exec expo start --dev-client --port 8081
   ```

   A release build cannot be used: it refuses cleartext `http://localhost`.
4. **Emulator quirks.** The Gboard stylus popup swallows the first typed characters:
   `adb shell settings put secure stylus_handwriting_enabled 0`. A dev client shows a one-time "developer menu"
   intro sheet after a fresh install or `clearState`; close it by hand before the first run, or the first tap
   lands on the sheet.

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

Without `DEV_CLIENT_URL` the helper does nothing, which is right for a build that embeds its JavaScript.

## Notes

- **The 5-minute case.** Maestro cannot move the clock, so `lock.yaml` really presses Home and waits 5 minutes
  10 seconds (`extendedWaitUntil` on an id that never appears, marked `optional`), then brings the same process
  back with `launchApp: stopApp: false` and expects the PIN pad. Android must keep the app alive meanwhile; if
  the emulator kills it, the relock you see is a cold start, which is covered by the first case anyway. To skip
  the wait while iterating, comment out step 3.
- **`lock.yaml` ends signed out** (five wrong PINs clear the session and the lock). Run `login-trade.yaml` again
  before the next `lock.yaml`.
- **The trade flow passes on any toast.** It waits for `toast`, which a settlement shows but so does a failure
  (for example "trade failed"). Maestro saves a screenshot on failure; for a stricter check, look at the
  trades sheet after the run.
- The stake keypad appends digits to the saved stake, so the flow clears it with the backspace key first.
- IDs used: `login-email`, `login-password`, `login-submit`, `lock-set-pin`, `pin-<0-9>`, `lock-message`,
  `account-demo` (also `account-live`), `stake-tile`, `key-<0-9|back>`, `keypad-done`, `expiry-<seconds>`,
  `buy` (also `sell`), `toast`, `gate-maintenance`.
- The Hindi pass (screenshots of login, lock setup, trade, keypad, market and trades sheets) is a manual device
  check, not a flow here.
