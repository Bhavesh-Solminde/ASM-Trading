# Production OTC release — 5 November 2026

The owner authorized pushing to main, updating production configuration,
applying migrations, and logging into the actual website for a screenshot.

Source release: `71ced0c6911d23340afbf46ba3a328e0db0509ca`.
Deployment: https://github.com/Bhavesh-Solminde/ASM-Trading/actions/runs/42020404323
(successful). Production: https://indianxtrade.com/trade.

## Completed

- Merged all 24 newer main commits before release, preserving the mobile,
  chart controls, closed-result display and investment-input changes.
- Passed strict type checks for deployed packages, the production Next build,
  491 website checks, 19 isolated PostgreSQL engine checks, 39 market-model
  checks and 82 contract checks after the merge.
- Saved a private pre-release database dump, production environment backup
  and rollback image on the VPS. Checked that the dump archive is readable.
- Deployed first with `OTC_ORDER_BOOK_ENABLED=false` and
  `OTC_DRAIN_LEGACY=true`; confirmed zero OPEN legacy trades before switching.
- Applied the four OTC migrations; production now has 41 finished migrations.
  Confirmed the runtime database role can read/write the new tables.
- Ran only `seed:otc-markets`: 30 open markets, all with 92% payout. This seed
  does not create users, change balances, or change trade outcomes.
- Activated `OTC_ORDER_BOOK_ENABLED=true`, `OTC_DRAIN_LEGACY=false` and
  `OTC_YAHOO_RATES_ONLY=true` on the production web/engine environment. The
  last option avoids sharing the restricted keyless rates quota with staging.
  Existing payment, authentication and funding configuration was preserved.
- Recreated web and engine with the updated environment. Engine announced
  readiness at 11:42:14 UTC / 17:12:14 IST, with 30 markets and 6,000 bots.
- Loaded 30 genuine reference snapshots before creating the first world;
  none was illustrative. Saved candles cover all 30 markets and executions
  continue to persist. Reference inputs stay internal to the chart behavior.
- Live internal authenticated health check returned HTTP 200, `OTC_FIXED`,
  and 30 markets. Public homepage/login returned 200; anonymous trade access
  redirects to login as expected.
- Logged in through the normal public login endpoint with an existing account.
  Authenticated trade and leaderboard pages returned 200. Trade HTML includes
  the chart, without numeric SL/TP fields, lower diagnostic panels, or OTC
  suffixes in market names.
- Obtained a normal single-use WebSocket ticket and visited all 30 markets
  over the actual public WSS route. All supplied valid candles, the bot
  leaderboard supplied 10 rows, and no protocol errors occurred. Maximum
  sampled full chart range was 1.509% of reference, including generated warm-up
  history. This is a startup sample, not a guarantee about future price paths.

Recorded authenticated transport evidence:
`verification/otc-production-release.json`. Credentials and session cookies
are excluded from reports and Git. No production test trades were placed.

## Remaining screenshot and visual verification

The browser-control tool still rejects access with “Local browser use is
disabled in Work settings,” despite the owner's screenshots showing the site
permission allowed. Resetting its session and opening the actual login URL
returned the same error. No fresh production screenshot has been captured.
The owner was asked to toggle Browser off/on to reconnect it.

HTTP, WebSocket and server tests are not visual or browser FPS measurements.
Real mouse/touch SL/TP, phone layout and browser smoothness remain unverified
until the supported browser connection works. Do not label the entire goal
complete while its requested production screenshot remains outstanding.

## Recovery

Private pre-release backups live under the deploy user's
`asmtrader-backups/otc-20261105`; rollback image tag is
`asmtrader-app:pre-otc-20261105`. Never delete OTC checkpoints/history to fix an
error. Do not start a legacy engine over OPEN OTC positions. Any future rollback
must first stop new entries and let accepted OTC positions settle under their
own engine; preserve funding workers and take a fresh database backup first.
