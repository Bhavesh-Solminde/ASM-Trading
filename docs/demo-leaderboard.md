# Development leaderboard

The current preview uses `LEADERBOARD_MODE=demo`. It displays the same five
columns with ten fictional profiles from the earlier roster. The heading and
API response identify the results as demo data.

While preview mode is enabled, the leaderboard has Real traders and Demo traders
views. Real traders always uses actual human LIVE-account results, with bots
excluded even when the order-book flag is enabled. Demo traders uses the ten
fictional profiles. The rankings are separate. The page and API accept
`?view=live` or `?view=demo`; without a view, the preview defaults to Demo traders.
Disabling preview hides the demo view and ignores requests for demo results.

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
