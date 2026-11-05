# Actual isolated KVM verification — 5 November 2026

Host: existing 4-vCPU / 16-GB VPS. Separate project: `asmtrader-otc-staging`.
All ports stay on loopback. No production nginx, data, environment, account
funding or container restart was changed. `production-baseline.txt` and
`production-after.txt` match exactly.

The normal registration API created 100 USER accounts, each with LIVE and DEMO.
Only this disposable database received audited paper LIVE balances. Bots have
no registered users. `otc-staging-snapshot.json` confirms the catalogue, account
types, 30 real reference sources, 30 movement calibrations and durable archives.

- `otc-website-lifecycle.json`: DEMO isolation, fixed SL/TP, expiry, currency
  conversion, foreign-account/role rejection and refused manual close.
- `otc-website-crowd.json`: 1/10/20/40/100 rapid cohorts and their exact schedules.
- `otc-website-crowd-paced.json`: 1,000 completed trades, 17 refunded retries.
- `otc-website-buy-heavy-burst.json`, `otc-website-sell-heavy-staggered.json`:
  finite single-market liquidity stress. Rejections are refunded, not fabricated fills.
- `otc-website-performance-crowd.json`: another 1,000 completed trades.
- Every crowd report includes audited entry fills/VWAP and scenario candles.
  `otc-final-accounting.json`: all 3,734 LIVE trades settled; 100 final account
  balances reconcile against both their ledgers and cumulative contract P&L.
- `otc-website-performance-followup.json`: **valid** 33-sample process, DB, HTTP
  and transport recording with 100 authenticated chart clients, no errors.
  Engine CPU p95 35.94% of one logical core, peak RSS460.875MiB, DB probe
  p95 2.605ms / max81.804ms, metrics HTTP p95 6.241ms / max20.709ms.
  Engine event-loop maximum observed72.221ms. Zero slow-client closes.
- `container-measurements.jsonl`: 54 samples each for engine/web/Postgres/Redis
  during the original complete crowd run, using `docker stats --no-stream`.
  Combined app CPU p95 140.97% of one core (=35.24% of four CPUs), max153.21%;
  peak combined sampled container memory1,356.959MiB. These figures exclude the
  separate load generator, browser and existing production services.
- `otc-website-server-performance.json`: original **empty/invalid** process
  collector output. A variable-shadowing error prevented collection; do not use
  it for capacity claims. Source collector fixed; use the valid follow-up above.
- `otc-durable-benchmark.json`: isolated `otc_benchmark` DB, all41migrations;
  target300×, achieved103.29×; 246,542 matches persisted exactly; exact restart;
  zero failed HTTP probes, health p95 615.63ms / max1,054.28ms. Process CPU/RSS
  excludes the separate database, web, Redis and browser.
- `otc-worker-benchmark.json`: normal scheduling, worker-only300×, 36hours;
  every tick retained, bounded1,500bar buffers, conserved wallets, exact volume
  and restart. This frozen-input worker scope differs from the durable test.

The KVM web build predates the newest demo-style chart appearance; its server
matching/settlement code is the same tested engine. The newest chart is built
in the local preview. Fresh actual browser visual/frame/switch measurements
remain pending; no server measurement above establishes browser FPS.

Credentials/cookies/secrets are excluded. Retained proof/benchmark/performance
containers are private; the load generators are stopped. Reproduction and
restart instructions are in `../../otc-staging-runbook.md`.
