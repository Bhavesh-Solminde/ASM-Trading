# FYERS integration — NSE/BSE Indian indices

Replaces the fully-synthetic feed for `NIFTY50`, `BANKNIFTY`, `FINNIFTY`, `NIFTYIT`, `SENSEX` with real NSE/BSE anchors from FYERS v3. Preserves the existing Binance (crypto) and Live-Rates (forex + metals) feeds unchanged.

## Scope landed in this PR

| Capability | Status | Notes |
|---|---|---|
| OAuth 2.0 authorize/callback round-trip | ✅ ship | `/api/integrations/fyers/authorize` → `/api/integrations/fyers/callback`, admin-only (404 to anyone else) |
| Access-token storage | ✅ ship | New `IntegrationToken` DB table + migration |
| Token-expiry awareness | ✅ ship | `expiresAt` computed as the next 06:00 IST; feed treats an expired row as "not connected" and runs synthetic |
| Live quotes (REST, 2 s cadence × 5 indices = 0.5 req/s) | ✅ ship | `createFyersFeed` in `apps/engine/src/feeds/fyers.ts` |
| Historical candle backfill | ✅ ship | `fetchFyersHistory` in `apps/engine/src/feeds/fyers-backfill.ts` |
| Focused unit tests | ✅ ship | 24 cases across OAuth + feed + backfill |
| Binary WebSocket data socket (`wss://socket.fyers.in/hsm/v1-5/prod`) | ⏳ follow-up PR | See "Why REST, not WebSocket" below |

## Why REST polling in v1, not the WebSocket

FYERS v3 ships two paths for live quotes:

- **REST `/data/quotes`** — simple POST, batched, documented, ~1-2 s practical cadence.
- **Binary WS `wss://socket.fyers.in/hsm/v1-5/prod`** — custom HSM-token round-trip, channel-level framing, binary-encoded ticks parsed against a static `map.json`. See the Go SDK at [`FyersDev/fyers-go-sdk/websocket/protocol.go`](https://github.com/FyersDev/fyers-go-sdk/blob/master/websocket/protocol.go).

No official Node SDK exists for the binary protocol. Porting it correctly is bounded but non-trivial, and it is only verifiable against a live token during NSE market hours. 2 s REST polling is already a dramatic upgrade over today's synthetic chart for Indian indices, and lets us ship + validate OAuth + storage + backfill cleanly first. WS lands in a dedicated follow-up PR with its own market-hours validation session.

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
5. Within the next tick (≤ 2 s), the engine starts polling FYERS and the Indian-index charts switch from synthetic to real.

If step 2 is skipped on a given day, the engine's `fyers.ts` sees the stored token as expired, logs one `engine.feed_selected feed=synthetic reason=no_fyers_token`, and the charts stay on the synthetic path until re-authorized. No crashes, no gaps.

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

Live round-trip against FYERS endpoints was **not** executed from this branch — doing so would consume the user's one real OAuth code slot and bind the stored token to a dev DB. The OAuth flow is covered by the unit tests via a mocked `fetch` with payload shapes copied from the FYERS v3 Python SDK fixtures.

## Rollback

- Remove `FYERS_APP_ID` from `.env.production` and restart engine. The feed falls back to synthetic for Indian indices on the next tick; no data loss, no manual DB cleanup needed.
- `IntegrationToken` table can be left in place (will be reused on re-enable).
- The two API routes stay deployed but return 404 to non-admins and 503 to admins without env — zero attack surface either way.

## Not in scope

- **NSE/BSE market-data commercial redistribution rights.** Verified API access to FYERS is distinct from the right to redistribute live NSE/BSE prices to end users. If this feed is user-facing, confirm the commercial agreement with FYERS and NSE/BSE separately before enabling. This PR gives you the pipe; the compliance decision is yours.
- Admin UI for one-click re-authorize (follow-up).
- Daily cron that nudges the admin before token expiry (follow-up).
- Binary WebSocket data socket (follow-up PR, see above).
- Individual Indian stocks (RELIANCE, TCS, etc.) — intentionally not mapped so we start with the four indices + SENSEX only.
