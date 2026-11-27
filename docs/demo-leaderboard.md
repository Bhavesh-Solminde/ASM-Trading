# Development leaderboard

`LEADERBOARD_MODE=demo` displays actual human LIVE-account results and 20
fictional profiles in one table. It includes all 20 profiles and the top ten
eligible real traders, plus any other eligible real trader with enough P/L to
match or beat a demo entry. Ranking compares INR values before display currency
conversion.

The background jobs service refreshes the same 20 database profiles at midnight
IST (18:30 UTC). Names and markets change, daily profit ranges from ₹1,000 to
₹14,999.99, and return uses a randomly generated settled stake. The names and
results stay fixed throughout the day. Web startup and the first request on a
new day can also prepare the standings. A database transaction serializes those
writes so a retry or another process uses the same daily results.

The fictional profiles have disabled logins, `isBot=true`, `liveAccess=false`,
and zero-balance DEMO accounts. The display amounts are stored in
`DemoLeaderboardEntry` independently of trades, balances and ledger records.

## Switch to actual traders before launch

Set `LEADERBOARD_MODE=live` in the deployment environment (and use `live` as the
fallback in `deploy/docker-compose.yml`), then deploy through GitHub Actions.
Both the page and API will show only actual human LIVE-account results, including
losses. The jobs service skips the rotation in live mode.

For local development, select demo mode and seed once with:

```sh
pnpm --filter @asm/db exec tsx src/seed-demo-leaderboard.ts
```

Apply Prisma migrations and load the normal database environment first. Docker
Compose runs this command at web startup and defaults the web and jobs services
to demo mode until launch. Outside Compose the leaderboard defaults to live mode.
