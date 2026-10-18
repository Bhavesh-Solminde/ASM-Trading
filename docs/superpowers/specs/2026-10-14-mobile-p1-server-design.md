# Mobile sub-project 1 — server for the app

**Date:** 2026-10-14 · **Overview:** [mobile app overview](2026-10-14-mobile-app-overview-design.md)

## Goal

Let a native client use the existing backend safely: token login, the few
missing JSON reads, app-friendly error codes, a language preference, and a
shared logic package. No change to any money rule, and no visible change to the
website.

## 1. Bearer sessions

**Today:** `lib/session.ts` creates DB-backed sessions (sha256-hashed token,
7-day TTL, sliding refresh when < 6 days remain). Routes read the token only
from the `asm_session` cookie (18 routes under `app/api`, plus RSC pages).

**Change:**

- Migration (hand-written): `Session` gains
  - `client  SessionClient @default(WEB)` with `enum SessionClient { WEB APP }`
  - `deviceName String?` (e.g. "Redmi Note 13")
- `createSession(userId, meta)` takes `client` and `deviceName`. TTL by client:
  WEB 7 days (unchanged), APP 30 days. Refresh threshold: WEB unchanged (6
  days), APP when < 29 days remain (i.e. roll forward at most daily).
- New `lib/request-session.ts`:
  - `sessionTokenFrom(req)` returns the `Authorization: Bearer <token>` value
    when present, else the `asm_session` cookie value.
  - `getSession(req)` = `readSession(sessionTokenFrom(req))`.
  - A request carrying a bearer header never falls back to the cookie (avoids
    mixed-credential confusion).
- All 18 routes listed by `grep -rln 'readSession(' apps/web/src/app/api`
  switch from `readSession(req.cookies.get(SESSION_COOKIE)?.value)` to
  `getSession(req)`. RSC pages keep using cookies (web only).
- `logout` deletes the session named by the bearer token or cookie, and
  always clears the cookie (harmless for the app).
- Role is still read from the DB on every request (unchanged).

**Client identification:** the app sends `X-Client: app/<semver>` and
`X-Device-Name: <model>` on every request. Helpers `isAppRequest(req)` and
`appVersion(req)` live in `lib/request-context.ts`.

**Login / register responses:** when `isAppRequest(req)`:

- `POST /api/auth/login` and `POST /api/auth/register` create an `APP` session
  and respond `200 { token, userId }` without setting a cookie.
- Web responses are unchanged (`{ userId }` + cookie).

Login 2FA: `twoFaForLogin` exists in the schema but is not enforced by the login
route today; the app mirrors the web and does not add a login 2FA step.

## 2. Native Google sign-in

`POST /api/v1/auth/google/native` body `{ idToken }`:

1. Verify the ID token signature against Google's JWKS
   (`https://www.googleapis.com/oauth2/v3/certs`) with `jose`; check `iss`
   (`accounts.google.com` or `https://accounts.google.com`), `aud` ∈
   `GOOGLE_ANDROID_CLIENT_IDS` (comma-separated env; the web client ID is also
   accepted because Android Credential Manager issues tokens for the web
   client), `exp`, `email_verified`.
2. Run the **same** find-or-create logic as `api/auth/google/callback` — that
   logic moves into `lib/google-account.ts` (`findOrCreateGoogleUser(profile,
   ctx)`) and both routes call it, so welcome email, bonus copy and
   `updateUserLastSeen` stay identical.
3. Network guard and rate limit (`rl:google_native:ip`, 20 / 5 min) as on login.
4. Respond `{ token, userId, created }` with an `APP` session.

## 3. Missing JSON reads (`/api/v1/*`)

All use `getSession`, return 401 `{ error, code: "unauthenticated" }` when
signed out, set `Cache-Control: no-store`, and have a response schema in a new
`packages/contracts/src/app.ts`.

| Route | Returns | Source today |
|---|---|---|
| `GET /api/v1/bootstrap` | open assets (`symbol, displayName, precision, payoutPct, assetClass`), accounts + balances, last 50 trades of the default account (`TradeView`), `defaultSymbol`, `liveAccess`, `completedDeposits`, `profile` summary (`nickname, kycStatus, locale, currency`). Runs the network guard like the platform layout (403 `vpn_blocked`) | `app/(platform)/layout.tsx` → extracted to `lib/platform-bootstrap.ts` and used by both |
| `GET /api/v1/wallet` | live + demo accounts (`id, type, currency, realBalance, bonusBalance`), `withdrawable`, `lockedBonus`, `completedDeposits`, `bonus` progress | `listAccountsForActor`, `withdrawableBalance`, `countCompletedDeposits`, `lib/bonus.ts` |
| `GET /api/v1/payments?cursor=&limit=` | deposit + withdrawal history rows, newest first, cursor-paginated (limit ≤ 50) | `loadPaymentRows` (gains `cursor/limit`) |
| `GET /api/v1/deposit-config` | `upiEnabled`, `usdtNetworks`, `gatewayNetworks`, per-method limits, bonus tiers, `completedDeposits` | deposit page server code |
| `GET /api/v1/checkout/:token` | the deposit behind a checkout token, **only if it belongs to the caller** (else 404): `id, method, status, amountInr, amountUsdtMinor, network, expiresAt, upiUri, vpa, receivingAddress, isGateway, isSlot, claimedUtr, claimedTxHash` | `app/checkout/[token]/page.tsx` → extracted to `lib/checkout-view.ts` and used by both |
| `GET /api/v1/withdrawal-prefill` | `lastPayouts` (BANK / UPI / USDT), `initialMethod`, `kycName`, `kycStatus`, held withdrawals | withdrawal page loop → extracted to `lastPayoutsFrom(recent)` |
| `GET /api/v1/app/config` | `minVersion`, `latestVersion`, `apkUrl`, `playUrl` (nullable), `playLive`, `support: { whatsapp?, telegram? }` | env (`APP_MIN_VERSION`, `APP_LATEST_VERSION`, `APP_PLAY_URL`, `APP_PLAY_LIVE`, `SUPPORT_WHATSAPP`, `SUPPORT_TELEGRAM`) — public, no session |
| `PATCH /api/v1/account/preferences` | body `{ locale?: "en" \| "hi" }` → `{ locale }` | new; deliberately separate from `PATCH /api/account`, which is KYC-locked |

The deposit and withdrawal pages are refactored to call the same loader
functions the routes use, so web and app can't drift.

## 4. Language preference

Migration: `User.locale String @default("en")` (values `en`, `hi`, checked by
zod, not a DB enum — adding a language later needs no migration).
`loadProfile` returns it. Used by push in sub-project 4.

## 5. Error codes the app relies on

Every JSON error carries a stable `code`:

| Situation | Status | Code | Change |
|---|---|---|---|
| Maintenance (proxy) | 503 | `maintenance` | add `code` to the existing JSON body |
| VPN block | 403 | `vpn_blocked` | already present |
| Rate limited | 429 | `rate_limited` | add to the routes the app calls |
| No / expired session | 401 | `unauthenticated` | add via `getSession` callers' shared `unauthenticated()` helper |
| App too old | 426 | `upgrade_required` | new: proxy returns it for `/api/*` when `X-Client: app/<v>` and `v < APP_MIN_VERSION` (except `/api/v1/app/config`) |

## 6. `packages/client-core`

New workspace package (`main: ./src/index.ts`, vitest, no React, no Node-only
APIs) holding pure logic both clients use. Moved **with their tests**, behaviour
unchanged; web imports are updated to `@asm/client-core`:

`lib/currency`, `lib/format-money`, `lib/format-time`, `lib/bonus`,
`lib/expiry-times`, `lib/day`, `lib/upi`, `lib/withdrawal-limits`,
`components/trade/{pnl-display,position,stake,trade-state,reconcile}`,
`components/chart/{engine-state,ease}`,
`components/history/{history-model,timeline-model,payment-rows}`,
`components/deposit/limits`, `components/payments/amount-input`.

Any of these that import `@/…` web-only modules or Node APIs are split first so
the moved part is pure. Success = web `vitest run`, `tsc --noEmit` and `next
build` all pass with the same test count.

## 7. Play pre-check (non-code)

Create the Play developer account (separate from other apps), submit the
honest Financial features declaration, and upload a skeleton `apps/mobile`
build (sub-project 2's first task) to Internal testing.

## Testing

Vitest against the shared test DB, run serially (existing convention):

- `request-session`: bearer preferred over cookie; bearer present but invalid
  does not fall back to cookie; cookie-only still works.
- `createSession`/`readSession`: APP sessions get 30-day TTL and refresh rule;
  WEB unchanged; expired APP session rejected and deleted.
- Login/register: app request → token in body, no `Set-Cookie`; web unchanged.
- Google native: bad signature, wrong `aud`, unverified email, expired → 401;
  valid → creates once, then logs in.
- Each `/api/v1` route: 401 when signed out; response parses with its contract
  schema; `payments` cursor paging is stable.
- Preferences: rejects unknown locale; works while KYC is locked.
- Proxy: maintenance JSON has `code`; old app version → 426 except config.
- `client-core`: moved tests pass unchanged.

## Out of scope

Logged-in devices UI, login 2FA, any change to existing response shapes the
website depends on.
