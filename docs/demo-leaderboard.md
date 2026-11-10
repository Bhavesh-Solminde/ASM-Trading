# Development leaderboard

The current preview uses `LEADERBOARD_MODE=demo`. It displays actual human
LIVE-account results and the ten fictional profiles from the earlier roster in
one profit-ranked table. Bots remain excluded from the real-account query even
when the order-book flag is enabled. There are no separate views or URL modes.
Disabling preview removes the fictional profiles and keeps the same table for
actual traders only.

Web startup seeds the profiles idempotently with disabled logins, `isBot=true`,
`liveAccess=false`, and zero-balance DEMO accounts. No LIVE accounts, settled
trades, deposits, or ledger credits are created by this feature.

Display fixtures generate ₹10,000–₹20,000 positive P/L per profile each IST day.
They remain stable for the day and refresh after midnight IST on the next page
load. BANKNIFTY is the sample market; return uses an illustrative ₹1,00,000
stake. These amounts are not stored as account profits or balances. The viewer's
selected display currency is respected.

## Switch to actual traders before launch

Set `LEADERBOARD_MODE=live` in the deployment environment (and use `live` as the
fallback in `deploy/docker-compose.yml`), then deploy through GitHub Actions.
Both the page and API will use only actual human LIVE-account results, including
losses. Demo profiles stay excluded via `isBot`; their records can remain for
future testing. No daily cron or cleanup of fictional trade history is needed.

For local development, select demo mode and seed once with:

```sh
pnpm --filter @asm/db exec tsx src/seed-demo-leaderboard.ts
```

The command needs the normal database environment loaded. Docker Compose does
this automatically at web startup. Without an explicit demo mode, the application
uses the human leaderboard. The preview Compose stack defaults to demo mode
until launch.
