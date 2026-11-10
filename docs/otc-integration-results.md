# OTC integration: test results

The website integration is implemented in the separate
`codex/otc-website-integration` checkout. The local website is
`http://127.0.0.1:4300/trade`. The owner subsequently authorized production
deployment: source `71ced0c` is live with OTC enabled. See
`otc-production-release.md` for the post-merge checks, deployment and live
authenticated verification. The remaining screenshot requires a working
browser-tool connection.

**Latest correction:** the owner's screenshots exposed an artificial startup
trend caused by illustrative prices being used before the first reference pull.
This is fixed for new books; the corrected preview uses fresh reference-seeded
history. Earlier ledger/load tests below do not prove the old startup charts
were realistic. See [cause and before/after settings](otc-startup-fix.md).
All30 corrected live feeds were checked; initial maximum high/low range1.761%.
The90 three-hour market/seed regression runs had maximum reference distance3.356%.

The main page now uses draggable chart SL/TP with no price input fields. Reference
lines, Order book/Market flow and Chart performance sections are removed as
requested; the simulation still uses references internally. Refresh and log in
again after the corrected preview database switch. The original history remains
preserved in its old database.

Normal signup/login works. USER + LIVE trades move the order book. DEMO trades
use the same prices for paper settlement and never move the book. The 6,000
internal bots have no website logins. Their top-10 leaderboard comes from their
actual engine wallets.

## Trading checks

| Check | Result |
| --- | --- |
| Markets | 30 markets, with 200 internal bots each |
| Real references | All 30 saved, with source/time/proxy labels and measured movement calibration |
| ₹100 winning contract | ₹192 total returned |
| Stop loss | ₹100 stake lost |
| Take profit | Same fixed ₹192 total return |
| Exact expiry tie | Stake refunded |
| Manual OTC close | Refused |
| Multiple positions | Opened and settled independently |
| Currency change during a trade | Original contract kept in INR; winning payout correctly credited as $1.92 after account changed to USD |
| Ownership and role spoofing | Refused through the normal website API |
| Restart recovery | Books/wallets restored; crash tests prevented duplicate stakes and payouts |

The 100 acceptance accounts were created through normal registration and logged
in normally. Only a separate disposable local database received explicitly
audited paper test balances. No production account was funded.

## Simultaneous accounts

Each account requested ten ₹100 trades. These are the latest saved runs.

| Accounts | Combination | Completed trades | Final liquidity rejections/refunds |
| ---: | --- | ---: | ---: |
| 1 | Rapid balanced directions | 10 | 0 |
| 10 | Rapid balanced directions | 91 | 9 |
| 20 | Rapid balanced directions | 199 | 1 |
| 40 | Rapid balanced directions | 387 | 13 |
| 100 | Rapid balanced directions, rotating across 30 markets | 528 | 472 |
| 100 | Paced across 30 markets | 1,000 | 0 after four recorded refunded retries |
| 100 | Buy-heavy burst into Bitcoin only | 18 | 982 |
| 100 | Sell-heavy staggered orders into Bitcoin only | 35 | 965 |

Every accepted trade settled. All balances and ledger entries reconciled.
No private trade notification went to another account.

The heavy single-market tests deliberately emptied a finite order book. Those
large rejection counts are a liquidity limitation, not evidence that the
server can promise every requested fill. Rejected stakes were returned. Do not
describe these tests as 1,000 successful single-market fills.

All **2,268 accepted entries** were separately reconciled against saved matched
executions: quantity and volume-weighted entry price matched. Reports contain
the account number, direction, stake, exact request/entry/expiry/settlement
times, retries, fills, outcomes, closed candles and sampled price/flow phases.
Profit/loss is recorded as an observation; it is not a pass condition or quota.

## Local computing measurements

The full website/crowd run reached 100 authenticated chart connections. Across
49 five-second measurements, engine CPU p95 was about **18% of one CPU core**,
peak observed engine memory was **534 MiB**, and the simple database probe p95
was **1.8 ms**. These figures exclude the separate web, PostgreSQL, Redis and
browser processes. They are laptop measurements, not KVM measurements.

The durable accelerated test targeted 300× and achieved approximately **232×**
while saving 244,603 matched executions and checkpoints. Its authenticated
health request p95 was **194 ms**, maximum **273 ms**. The restored market
matched exactly. Do not claim that durable 300× was achieved on this device.

The worker-only test ran normal playback, 300× playback and a 36-hour long
session with frozen references. It processed 9,089,573 matches, reconciled every
closed candle's volume, conserved funding, bounded recent history to 1,500 bars
per market and resumed exactly after checkpoint restoration. Its performance
scope differs from the full durable engine test.

## Saved evidence

- `verification/otc-website-lifecycle.json`: normal account, DEMO, SL/TP, expiry,
  manual-close rejection and currency lifecycle.
- `verification/otc-website-crowd.json`: 1/10/20/40/100-account burst schedules.
- `verification/otc-website-crowd-paced.json`: 1,000 completed paced trades.
- `verification/otc-website-buy-heavy-burst.json` and
  `verification/otc-website-sell-heavy-staggered.json`: single-market stress.
- `verification/otc-website-accounting.json` and
  `verification/otc-website-mix-accounting.json`: account/ledger reconciliation.
- `verification/otc-reference-snapshot.json`: all 30 reference/calibration rows.
- `verification/otc-website-server-performance.json`: full website server samples.
- `verification/otc-worker-benchmark.json`: worker long-session and volume checks.
- `verification/otc-durable-benchmark.json`: persisted accelerated run and HTTP latency.

## Remaining acceptance gates

Fresh desktop/phone review and actual browser frame/switch/long-task recording
remain pending because local browser control is disabled in Work settings.
Earlier browser login and chart rendering were verified, but their saved image
predates the newest overlays and diagnostics.

The user enabled Browser, but the tool still reports disabled after a reset and
reconnect. The latest main chart styling is built locally and matches the demo's
Lightweight Charts settings. Its fresh browser review remains unverified.

The isolated KVM acceptance run has now passed. The existing deploy login works
when its existing SSH key is selected explicitly. Production container IDs and
start times remained unchanged. Production activation has not been performed.

The production web build, web/engine/database typechecks and full website test
suite pass (458 website checks;19 focused engine checks on actual PostgreSQL).
One pre-existing legacy catalogue display-step test fails for
DOGEUSDT/USDJPY; its legacy source and test are unchanged. The new OTC catalogue
and focused OTC/account tests pass. The complete goal remains active until
the remaining browser acceptance gate is verified.

## Actual VPS results

These are separate server runs, not estimates from the laptop. All 30 references
and movement calibrations were verified. The test accounts signed up normally.

| Accounts | Combination | Completed trades | Refunded liquidity rejections |
| ---: | --- | ---: | ---: |
| 1 | Rapid balanced | 10 | 0 |
| 10 | Rapid balanced | 98 | 2 |
| 20 | Rapid balanced | 195 | 5 |
| 40 | Rapid balanced | 361 | 39 |
| 100 | Rapid balanced across 30 markets | 981 | 19 |
| 100 | Paced across 30 markets | 1,000 | 0 final; 17 refunded retries recorded |
| 100 | Bitcoin buy-heavy burst | 46 | 954 |
| 100 | Bitcoin sell-heavy staggered | 43 | 957 |
| 100 | Separate performance follow-up | 1,000 | 0 final |

All **3,734 accepted LIVE entries** matched the saved executions. Every accepted
trade settled and all 100 final balances/ledgers reconciled. Liquidity remains
finite; these results do not promise every requested order will fill.

With 100 authenticated chart connections, the valid follow-up recorded engine
CPU p95 **35.9% of one core**, peak engine memory **461 MiB**, database probe p95
**2.6 ms** and metrics HTTP p95 **6.2 ms**. It captured 33 samples with zero
measurement errors and zero slow-client closes. The full crowd's separate
four-container samples peaked at about **1.33 GiB combined memory**. The load
generator and existing production services are excluded from those app figures.
This supports the tested 100-connection workload; it is not an unlimited-user
capacity claim or a browser smoothness measurement.

The VPS worker-only test sustained 300×. Saving all executions/checkpoints in
the durable test achieved **103×**, with health HTTP p95 **616 ms**, max **1,054 ms**,
zero failed probes and exact restart. Its 246,542 matches persisted exactly.
The separate 36-hour worker run also conserved funding and reconciled volume.

The first process collector had a variable-shadowing bug and saved no samples;
that empty original file is retained. The collector was fixed, made fail loudly,
and the valid 100-client follow-up was rerun. See
`verification/kvm/README.md` and its linked JSON evidence.

For the latest bot-settings question, a direct one-hour comparison of the demo
and website engines produced identical executions and all 200 bot wallets for
Bitcoin, EUR/USD and NIFTY under identical frozen inputs/seed. The record is
`verification/otc-demo-bot-parity.json`.
