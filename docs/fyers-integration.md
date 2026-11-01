# FYERS integration — NSE/BSE Indian indices

Replaces the fully-synthetic feed for `NIFTY50`, `BANKNIFTY`, `FINNIFTY`, `NIFTYIT`, `SENSEX` with real NSE/BSE anchors from FYERS v3. Preserves the existing Binance (crypto) and Live-Rates (forex + metals) feeds unchanged.

## Scope landed in this PR

| Capability | Status | Notes |
|---|---|---|
| OAuth 2.0 authorize/callback round-trip | ✅ ship | `/api/integrations/fyers/authorize` → `/api/integrations/fyers/callback`, admin-only (404 to anyone else) |
| Access-token storage | ✅ ship | New `IntegrationToken` DB table + migration |
| Token-expiry awareness | ✅ ship | `expiresAt` computed as the next 06:00 IST; feed treats an expired row as "not connected" and runs synthetic |
| Live quotes (WebSocket push) | ✅ ship | `createFyersFeed` + isolated official SDK worker |
| Historical candle backfill | ✅ ship | `fetchFyersHistory` in `apps/engine/src/feeds/fyers-backfill.ts` |
| Streaming tests | ✅ ship | Parser, reconnect/token lifecycle, SDK worker boundary |


## WebSocket streaming

The feed uses the official [`fyers-api-v3`](https://www.npmjs.com/package/fyers-api-v3)
Node SDK, pinned to 2.4.0, for binary decoding and symbol resolution. It opens one
full-mode data socket for all five indices and subscribes on every connection.
There is no recurring REST quote request; REST history remains unchanged.

The SDK runs in a dedicated CommonJS worker so its singleton and background timers
can be fully disposed on reconnect, token rotation, and engine shutdown. SDK raw
logging is disabled; the parent emits only structured lifecycle events. Connection
failure uses exponential backoff (1–30 seconds), with a 20-second handshake timeout.
Token storage is checked every two seconds, including when no token existed at boot.
An expired/missing token closes the socket; a new token starts a fresh worker.

`if` messages become quotes immediately. Exchange time is preserved when present;
some index frames omit it, so those use **receipt time**, which cannot prove
source-to-screen latency. This change alone does not guarantee 1–3-second latency
or change the engine's existing synthetic fallback or price-adjustment behavior.

References: [connect/subscribe](https://fyers.in/api-docs/v3/api/websockets/data-socket/overview/data-socket-connect-and-subscribe/),
[index payload](https://fyers.in/api-docs/v3/api/websockets/data-socket/data-socket-indices-update/).

## Credentials

The developer app is already created on the FYERS dashboard (non-trading app, "FQEO03EUPG-100"). Three values go into env, **never** into the repo:

```
FYERS_APP_ID=<app id, e.g. FQEO03EUPG-100>
FYERS_APP_SECRET=<app secret>
FYERS_REDIRECT_URI=https://indianxtrade.com/api/integrations/fyers/callback
```

### Important — redirect URL must be updated in the FYERS dashboard

The manual test used `https://trade.fyers.in/api-login/redirect-uri/index.html` (FYERS's own placeholder). Before the OAuth flow can land back on our server, change it in the FYERS dashboard to exactly:

```
https://indianxtrade.com/api/integrations/fyers/callback
```

If it doesn't match character-for-character (trailing slash, scheme, host, path), FYERS returns `code=-98`. One-time step.

## Daily operator flow (post-deploy)

FYERS access tokens expire at 06:00 IST each day. Each morning the admin runs:

1. Sign in to `/admin/login` with `ADMIN_PANEL_SECRET`.
2. Open `https://indianxtrade.com/api/integrations/fyers/authorize` in the same browser.
3. FYERS login page appears — log in with the trading account, approve the app.
4. Browser redirects to `/api/integrations/fyers/callback` which returns JSON `{"status":"connected","expiresAt":"2026-10-25T00:30:00Z"}`.
5. Within the next token check (normally 2 s), the engine connects to FYERS and subscribes. Quotes begin when FYERS sends index updates; handshake/network time is additional.

If step 2 is skipped on a given day, the engine's `fyers.ts` sees the stored token as expired, closes the stream and waits for reauthorization. The engine's pre-existing fallback remains unchanged; do not interpret that fallback as verified live prices.

Future improvement (follow-up): a tiny cron that pings the admin on Slack / email at 05:30 IST with the one-click re-authorize link.

## Local validation (how I verified in this PR)

Against the isolated local DB `asm_cfd_revenue` on :5433:

```bash
# 1. Migration applies cleanly
pnpm --filter @asm/db exec prisma migrate deploy
# → "20261024020000_integration_token applied"

# 2. All feed + OAuth + backfill tests pass
DATABASE_URL="postgresql://solminde@localhost:5433/asm_cfd_revenue" \
DIRECT_URL="postgresql://solminde@localhost:5433/asm_cfd_revenue" \
  pnpm --filter @asm/engine exec vitest run src/feeds/
pnpm --filter @asm/web exec vitest run src/lib/fyers-oauth.test.ts

# 3. Typecheck
pnpm --filter @asm/engine --filter @asm/web exec tsc --noEmit
```

The initial implementation did not exercise the application OAuth callback live. The WebSocket follow-up used the previously authorized manual-test token directly in memory, without storing it in the application DB or consuming another OAuth code; see results below.

## Rollback

- Remove `FYERS_APP_ID` from `.env.production` and restart engine. The feed falls back to synthetic for Indian indices on the next tick; no data loss, no manual DB cleanup needed.
- `IntegrationToken` table can be left in place (will be reused on re-enable).
- The two API routes stay deployed but return 404 to non-admins and 503 to admins without env — zero attack surface either way.

## Not in scope

- **NSE/BSE market-data commercial redistribution rights.** Verified API access to FYERS is distinct from the right to redistribute live NSE/BSE prices to end users. If this feed is user-facing, confirm the commercial agreement with FYERS and NSE/BSE separately before enabling. This PR gives you the pipe; the compliance decision is yours.
- Admin UI for one-click re-authorize (follow-up).
- Daily cron that nudges the admin before token expiry (follow-up).
- End-to-end market-hours latency guarantee; must be measured with a fresh authorized token.
- Individual Indian stocks (RELIANCE, TCS, etc.) — intentionally not mapped so we start with the four indices + SENSEX only.

## WebSocket follow-up verification (2026-10-24)

Run only isolated feed tests (no DB writes):

```bash
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused \
  pnpm --filter @asm/engine exec vitest run src/feeds/
pnpm --filter @asm/engine exec tsc --noEmit
```

The worker boundary test executes the real worker entry with a fake SDK and checks
subscriptions after connect, delivery, and redacted error handling. Lifecycle tests
cover missing-at-boot tokens, expiration/rotation, handshake timeout, subscription
errors, reconnect backoff, late events and stop during token lookup. These are not
live-market measurements. A 15-second read-only test of the actual SDK worker authenticated successfully, received subscription acknowledgement (`sub`, code 200), and received all five index prices. Quotes were last-session snapshots (market closed), not evidence of live-market freshness. Repeat market-hours validation before claiming 1–3-second latency. OAuth routes and expiry calculation are unchanged by this WebSocket-only follow-up.

Results: **56 feed tests passed across 7 files**, engine TypeScript check passed, and `git diff --check` passed. No database migration, application trade, merge, or deployment was performed for this follow-up.
