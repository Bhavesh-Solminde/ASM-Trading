# ASM Trade — Demo Runbook

A demonstration build of how a manipulated trading platform works.
**Demo only — never deployed, no real users, no real money.** `BANK_FEED` is
always `simulated`; no payment ever leaves the machine and no order reaches a
market.

Phase 1 is complete: registration/login, a live chart from the price engine,
trades that settle against captured prices, deposits reconciled by a simulated
bank feed, withdrawals with bonus turnover, the account/KYC/2FA screens,
support, and an admin surface — all merged to `main`.

> The covert win-rate controller (Plan 04) is **not** part of this build and is
> intentionally absent.

---

## Prerequisites

- **Node ≥ 22** (required — the toolchain uses `node:util.styleText`).
  `nvm use` picks it up from `.nvmrc`. Verify with `node -v`.
- **pnpm**, **PostgreSQL** on `localhost:5433`, **Redis** on the URL in `.env`.
- `.env` at the repo root is already populated (session/admin/relay/engine
  secrets, `BANK_FEED=simulated`). `TWELVE_DATA_API_KEY` is optional — without
  it the engine replays a bundled dataset.

One-time (already done in this checkout; re-run only on a fresh clone or DB):

```bash
nvm use
pnpm install
pnpm --filter @asm/db exec prisma migrate deploy   # apply schema
pnpm --filter @asm/db seed                          # 20 markets + admin + 10 test users
```

The dev database is already migrated and seeded with **20 open markets** —
6 crypto (BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT, DOGE/USDT),
6 forex (EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD), 6 India
indices (NIFTY 50, BANK NIFTY, FINNIFTY, SENSEX, NIFTY IT, NIFTY MIDCAP 100),
plus the original BTC/USD and Gold — all open at 100% payout. Crypto anchors to
Binance's live WebSocket, forex + gold to Twelve Data (if `TWELVE_DATA_API_KEY`
is set), and the India indices run fully synthetic. The seed is idempotent, so
re-running it re-funds the test accounts to a known state.

### Test accounts

The seed creates **10 live test users** — `test1@asmtrade.local` …
`test10@asmtrade.local` — sharing one password: **`asm-demo-test-2026`**. Each
has a funded **Live** account (₹1,00,000) and a funded **Demo** account
(₹1,00,000). These are DEMO-ONLY credentials (a single shared, well-known
password) and must never exist in a real deployment. All 10 appear in the admin
**Users** panel; every market appears in the admin **Markets** panel.

### Live-account access (per-user gate)

The real-money **Live** account is gated so it is **not** exposed to everyone by
default. Access is per-user via `User.liveAccess`:

- The 10 test users are seeded with `liveAccess = true`, so they can switch to
  and trade the Live account. Everyone else (including new registrations) stays
  Demo-only and sees the "Live account — coming soon" notice.
- Grant or revoke it in **`/admin/users/<id>`** → *Manage account* →
  *Live account access* (audited).
- The gate is enforced both in the UI (the account switcher) and server-side in
  the trade API, so it can't be bypassed by calling the API directly.
- To launch Live for **everyone at once**, set
  `NEXT_PUBLIC_LIVE_ACCOUNT_ENABLED="true"` in `.env` (default `false`). This
  overrides the per-user gate globally, so use it only for a real launch.

---

## Start the demo

Two processes, two terminals (both need Node 22 on PATH):

```bash
pnpm dev:engine   # price engine + trade desk + simulated bank feed (ports 4001/4002)
```

```bash
pnpm dev          # Next.js web app on http://localhost:3000
```

Wait for the engine to log `engine.started` and the web to serve
`http://localhost:3000`. Open **http://localhost:3000**.

Optional — make deposits credit fast during the demo (default is 3s):

```bash
SIMULATED_FEED_DELAY_MS=1500 SIMULATED_FEED_FAILURE_RATE=0 pnpm dev:engine
```

Set `SIMULATED_FEED_FAILURE_RATE=1` to show a deposit that never gets a credit
and lands in the admin queue instead.

---

## Suggested walk-through

1. **Register** at `/register` (email + a 12+ character password). You get a
   funded **Demo** account and an empty **Live** account.
2. **Trade** on `/trade`: the live candle chart, the vertical **sentiment bar**
   (stake-weighted from the bot book), and the **asset tabs**. Place an Up/Down
   trade with a short expiry on the Demo account and watch it settle in place —
   balance and history update over the socket, no reload.
3. **Deposit** via `+ Deposit`: pick a method, enter an amount. The
   provider-style **checkout page** shows a UPI QR and a paise-precise rupee
   amount (that odd amount is how the payment is matched). Enter any 12-digit
   reference and confirm. Within a few seconds the simulated feed credits it —
   the Live account shows the deposit **plus a 50% bonus**.
4. **Withdrawal** via `/withdrawal`: the bonus is shown **locked** with the
   remaining 3× turnover; a withdrawal above the withdrawable balance is
   refused, and one within it (real funds) is accepted.
5. **Account** `/account`: personal + KYC fields (stored, never verified), and
   the two-factor toggles. "Send a test code" writes the code to the **server
   log** — look for `evt: "auth.2fa_sent"` in the engine/web terminal (no email
   provider is configured, by design).
6. **Payments** `/balance`: the combined deposit/withdrawal history.
7. **Support** `/support`: the FAQ and a plain-text ticket form.

### Admin surface

Go to **`/admin/login`** and enter the **`ADMIN_PANEL_SECRET`** value from
`.env` (it's a shared secret, not a user login).

- **`/admin/markets`** — every market, searchable and filterable by type
  (Real/OTC) and status. Change a market's payout or open/close it; payout
  changes apply to new trades only, so open positions keep the payout they were
  opened at.
- **`/admin/users`** — all users (including the 10 test accounts), with balances
  and per-user detail.
- **`/admin/approvals`** — the deposit/withdrawal reconciliation queue.
- **`/admin/messages`** — the raw relayed-message log.

---

## Notes

- **2FA is a demonstration seam:** preferences and codes work and codes are
  single-use, but this build does not yet gate login or withdrawal behind them.
- **Reset the demo:** stop both processes and re-run the seed, or delete users
  directly. The three assets and the `admin@asmtrade.local` row come from the
  seed.
- **Nothing is real:** every "payment" is injected by the simulated feed; the
  UPI QR points at a fictitious demo VPA; 2FA codes go to the log.
