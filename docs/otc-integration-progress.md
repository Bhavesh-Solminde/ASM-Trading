# Integration progress — 2026-11-05

Latest owner instruction: remove OTC from displayed market names, do not push,
and stop after that change. All30 source catalogue names and corrected local
preview Asset display names now omit the suffix. Catalogue test and authenticated
preview render check passed. No push performed. Further goal work is paused at
the owner's request; the earlier browser verification gate remains unverified.

Worktree: `/Users/solminde/.codex/worktrees/otc-website-integration/asmtrading`.
Branch: `codex/otc-website-integration`, based on local `main` (`f937b9c`).
Original checkout/prototype preserved. No integration commit, PR, production
activation or production database mutation has been performed. The goal remains
active: fresh actual browser review/measurements are still pending.

## Implemented

- Shared neutral 30-market order-book worker, 200 funded internal bots per
  market, finite wallets, matched-order prices/volume, deterministic recovery.
  No payout quota, vault target or customer-loss input enters this model.
- Normal USER + LIVE account flow is Tob flow. DEMO and non-USER paper contracts
  cannot mutate the book or create book wallets. Bots have no website accounts.
- Normal signup/login, multiple independent OTC contracts, 92% profit, fixed
  expiry, optional first-execution SL/TP, exact expiry tie refund, no manual close.
- Immutable contract currency, account-row locks, serializable/idempotent stake,
  fill, refund and payout accounting; account currency changes remain supported.
- Ordered WAL, writer advisory lock, generation fencing, checkpoints, bounded
  catch-up, closed-candle and execution archives. Boot refuses missing checkpoint
  reseeding over durable history and refuses activation over OPEN legacy trades.
- Reference puller with all 30 mappings, actual source/proxy/time metadata,
  movement calibration, durable cooldown/backoff across process restarts, and
  cached last-good values. `OTC_YAHOO_RATES_ONLY` avoids consuming a shared VPS
  IP's keyless Live-Rates quota in staging.
- Authenticated single-use-ticket WebSocket: selected chart, compact watchlist,
  depth/tape, wallet-based top-10 bot leaderboard, per-owner trade/balance events,
  generation/cursor recovery, backpressure and history paging.
- Stable incremental chart/volume, six-entry switch cache, stale-response guards,
  hidden-tab suspension, price/SL/TP/reference/expiry overlays, desktop/phone UI.
- The OTC chart uses the screenshot demo's Lightweight Charts appearance:
  background/grid, teal/red candles, natural autoscale, initial fit, volume,
  IST times, logo and pan/wheel controls. Its price updates use
  actual matched prices directly and chart-type changes avoid the legacy wave.
  The owner subsequently requested hiding reference lines, Order book/Market
  flow and Chart performance sections. These are now removed from the main trade
  page. Reference inputs still guide the internal bots. SL/TP is now set with
  draggable/keyboard-adjustable draft chart lines, not number fields. A separate
  Buy/Sell choice controls their direction; accepted terms remain immutable.

## Verified locally

- Web: 71 files / 458 checks passed; production build passed after chart changes.
- Engine OTC: all 5 files / 19 checks passed with real disposable PostgreSQL.
- Market-sim: 39 checks; contracts: 77 checks; OTC/account ledger: 34 checks.
- Web, engine and database strict TypeScript checks passed. Diff whitespace clean.
- All 41 migrations applied to three isolated local clusters and fresh KVM DBs.
- Local crowd, accounting, reference, worker/durable benchmarks are retained in
  `docs/verification/`. All 2,268 accepted local entries were reconciled to actual
  matched executions. See `otc-integration-results.md` for exact limitations.
- Direct prototype-versus-website bot comparison: identical one-hour executions,
  all 200 bot wallets and summaries for BTC, EUR/USD and NIFTY under the same
  frozen illustrative inputs/seed. Evidence: `otc-demo-bot-parity.json`.
- One unrelated baseline legacy catalogue test fails for DOGEUSDT/USDJPY display
  steps. Legacy source/test are unchanged. Do not claim the entire DB suite passes.

## Startup defect discovered from owner's screenshots and fixed

The original preview booted at illustrative catalogue prices before fetching
its first references. SOL150 versus96.82, DOGE0.15 versus0.07699, WTI65 versus88.07
caused artificial one-direction convergence over hours. Earlier accounting/load
tests did not prove the quality of that startup price path; do not claim they did.

Fresh runtime bootstrap now polls/calibrates under the writer lock before
creating the worker and requires verified non-illustrative quotes for all30.
Missing quotes create no placeholder checkpoint/history. Existing durable
checkpoints remain unchanged. The original preview database and all its history
are preserved. The corrected preview uses `otc_preview_fixed` on port55439.

- `otc-startup-defect.json`: read-only audit of actual original first prices/pulls.
- `otc-reference-path-proof.json`: 90 runs (30markets ×3seeds ×3hours), frozen
  recorded real quotes/measured calibration, 200bots/market, noTobs; maximum
  close-price distance3.356%, initial opening within0.5% of reference.
- `otc-corrected-preview-markets.json`: actual authenticated30chart snapshots;
  maximum initial retained high/low range1.761%; no placeholder initialization.
- `otc-corrected-preview-http.json`: normal fresh registration/login and
  authenticated page render; removed panels/number fields absent from HTML.
- SL/TP DOM checks prove snapped drag, navigation restoration, keyboard changes,
  correct-side validation and exact ambiguous retry body/key. These are not FPS.

See `docs/otc-startup-fix.md` for the root cause, original/new test settings and
reproduction. New tests use the disposable regression DB; legacy website tests
need their existing legacy asset fixture, so do not run that suite on fresh
preview databases.

## Actual KVM acceptance

Existing SSH access is verified with user `deploy` and explicit existing key
`~/.ssh/asmtrader_ci`. Never print or copy key contents. The access note was at
`/Users/solminde/.claude/projects/-Users-solminde-Developer-Personal-AMScoins-asmtrading/memory/vps-access.md`.

The isolated project `asmtrader-otc-staging` runs under
`/home/deploy/asmtrader-otc-staging-20261105` with private host ports web14301,
WS14401, HTTP14402, Postgres15440 and distinct database/Redis volumes/secrets.
All original production container IDs/start times match the saved baseline.

- 100 normal signups, all USER, 100 LIVE + 100 DEMO accounts. Only explicitly
  audited staging paper balances were funded. No production balance was funded.
- Lifecycle, currency conversion, ownership/role rejection, DEMO isolation,
  SL/TP, expiry, private notifications and balance/ledger reconciliation passed.
- Rapid 1/10/20/40/100 cohorts accepted 10/98/195/361/981 trades respectively.
  All requests were recorded, and known liquidity rejections were refunded.
- Paced 100 accounts completed 1,000 trades with 17 recorded refunded retries.
- Bitcoin buy-heavy burst: 46 fills, 954 refunded liquidity rejections;
  sell-heavy staggered: 43 fills, 957 refunded liquidity rejections.
- A separate performance follow-up completed another 1,000 trades with 100
  authenticated chart sockets. 33 process/DB/HTTP samples, zero measurement errors.
- All **3,734** accepted LIVE entries were reconciled to matched quantities/VWAP;
  every accepted contract settled; all 100 final balances/ledgers reconcile.
- All 30 external references and all 30 movement calibrations verified on the VPS.
- These original crowd runs predate the startup fix. Their ledger/transport/load
  evidence remains valid; they do not validate the corrected bootstrap price path.
  The isolated web container was refreshed once to demo-style appearance, before
  the subsequent SL/TP/reference-hiding changes. Production remains untouched.
- 36-hour worker benchmark: every tick retained, finite funding conserved,
  candle volume reconciled, 1,500-bar cap, exact restart. Worker-only 300× achieved.
- Separate disposable `otc_benchmark` DB durable target300× achieved **103.29×**;
  246,542 executions saved exactly, exact restart, no failed health requests.
  Do not claim durable 300× was achieved. Health p95 616ms, max1,054ms.
- First KVM process-measurement collector produced zero samples because of a
  variable-shadowing bug. It was fixed and made fail loudly. The empty original
  file is retained; valid 100-client samples are in the follow-up report.

Evidence is in `docs/verification/kvm/`, separate from laptop results. Test
containers and private credentials are retained; performance load generator
stopped after completion. No load-generator job remains running.

## Current local services

- Preview: `http://127.0.0.1:4300/trade`; WS4401, internalHTTP4402.
- Preview engine session37812; web session40853, restarted on the final build.
  Verify listeners before reuse.
- Preview DB55439 `otc_preview_fixed`: `/tmp/asm-otc-db.bkgj16/data`, Redis56389.
  Its original sibling `otc_integration` is preserved with affected history.
- Crowd DB55440: `/tmp/asm-otc-history.M6lJHY/data`, Redis56390. Crowd web/engine
  stopped after final proof; its reports and normally created accounts remain.
- Disposable regression DB55441: `/tmp/asm-otc-regression.40Yo4h/data`.
- No destructive runtime test may use preview/crowd databases while live.
- Owner preview credentials remain in the ignored local credential manifest.
  USER, LIVE balance zero, funded DEMO balance.
- `.env`, `.env.otc-staging`, `.secrets` and credential manifests are ignored;
  never publish them. VPS staging secrets are in `.secrets/vps-otc-staging.env`.

## Remaining work

1. Fresh browser visual/interaction check on desktop and phone; record actual
   frame intervals, long tasks, chart JS work, switch latency and bytes using
   permitted developer profiling. The owner removed the recorder from the trade UI.
   Test all timeframes/styles, chart SL/TP pointer/touch controls,
   pan/zoom, account switching, overlays and leaderboard.
2. Browser tool still returns “Local browser use is disabled in Work settings”
   even after the user said Enabled and CUA was reset/reconnected. Do not bypass
   the disabled tool with external Playwright/CDP/native automation. It needs
   the app's permission state to become effective. Earlier screenshot predates
   these changes and is not fresh evidence. No browser-FPS claim is permitted.
3. Final requirement audit after browser verification; production activation
   remains a separate, unperformed step. No shutdown is requested now.

Restart/test/isolation instructions: `docs/otc-staging-runbook.md`. Scope and
acceptance criteria: `docs/otc-website-integration-plan.md`.
