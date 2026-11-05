# OTC staging and restart instructions

Implementation branch: `codex/otc-website-integration`.
Checkout: `/Users/solminde/.codex/worktrees/otc-website-integration/asmtrading`.
Production activation remains a separate step. Do not copy the local `.env`,
test credentials or paper funding fixtures into production.

## Current local preview

- Website: `http://127.0.0.1:4300/trade`.
- Engine: WebSocket 4401; authenticated internal HTTP 4402.
- Database: PostgreSQL 16, `127.0.0.1:55439/otc_preview_fixed`.
- Redis: `127.0.0.1:56389`.
- PostgreSQL data: `/tmp/asm-otc-db.bkgj16/data`.

The original `otc_integration` database on that same cluster is preserved for
auditing the placeholder-start defect. Do not point the corrected preview back
to it or delete its old checkpoint/history. Fresh runtime startup now requires
verified references for all30 markets before creating any chart history. If a
provider is unavailable and no last-good cache exists, startup refuses the
missing markets rather than showing illustrative prices. Restore provider access
or a valid reference cache; never fabricate production quotes to bypass the guard.

Use normal signup and login. The existing owner preview login is recorded in
the local progress document. New LIVE accounts start at zero. Only USER + LIVE
creates Tob flow; DEMO stays paper-only. Internal bots never register accounts.

From the implementation checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @asm/db generate
pnpm --filter @asm/db exec prisma migrate deploy
pnpm --filter @asm/db seed:otc-markets
pnpm --filter @asm/web exec dotenv -e ../../.env -- next build
pnpm --filter @asm/engine start
```

In another terminal, from the same checkout:

```sh
pnpm --filter @asm/web exec dotenv -e ../../.env -- next start -p 4300
```

Check listeners before restarting; never run two engines on the same database.
The advisory writer lock rejects a second writer. A graceful stop checkpoints;
an interrupted process restores the last checkpoint and replays the ordered
command log. Do not delete a checkpoint to resolve a startup error.

Before switching a real existing installation from legacy/CFD mode, set
`OTC_DRAIN_LEGACY=true` on the web process while keeping
`OTC_ORDER_BOOK_ENABLED=false`. New legacy opens are refused with a clear
message; leave the original engine running to settle its accepted positions.
Wait for in-flight requests to finish and for all legacy OPEN positions to
settle. The OTC boot preflight refuses activation while any remain. Do not
cancel, rewrite or abandon them to bypass this guard. Only then activate the
reviewed OTC web/engine configuration together.

## Isolated local acceptance environment

The separate acceptance stack uses web 4301, WS 4501, internal HTTP 4502,
Postgres 55440 and Redis 56390. Its database also uses the name
`otc_integration`, but is a different PostgreSQL cluster:
`/tmp/asm-otc-history.M6lJHY/data`.

`apps/engine/scripts/otc-website-proof.mjs` accepts only this loopback port/name
or the separately named staging container target below. It creates accounts through `/api/auth/register`, funds
only that disposable database with explicitly audited paper balances, logs in
normally, verifies DEMO/SL/TP/ownership, runs the crowd and reconciles the ledger.
It never inserts users or sessions directly. Reusing its ignored credential
manifest avoids creating another cohort.

```sh
OTC_STAGING_RUN=true \
DATABASE_URL=postgresql://solminde@127.0.0.1:55440/otc_integration \
pnpm --filter @asm/engine exec dotenv -e ../../.env -- \
  tsx scripts/otc-website-proof.mjs ../../.secrets/OWNER_MANIFEST.otc-credentials.json
```

The ordinary reusable crowd runner does not fund accounts. Give it a local
JSON array of `{email,password}` for accounts already created through signup.
The file must stay in `.secrets/` or end with `.otc-credentials.json`; both are
excluded from Git and Docker build contexts. Reports omit credentials/cookies.

```sh
OTC_STAGING_RUN=true \
OTC_STAGING_URL=http://127.0.0.1:4301 \
OTC_STAGING_WS=ws://127.0.0.1:4501 \
node apps/engine/scripts/otc-crowd.mjs \
  .secrets/OWNER_MANIFEST.otc-credentials.json docs/verification/owner-crowd.json
```

Default login spacing respects the ordinary 20-per-five-minute IP limit.
Only isolated staging may set `LOGIN_IP_RL=200` and
`OTC_LOGIN_SPACING_MS=0`. Production limits remain unchanged. Useful controls:
`OTC_MIX=buy-heavy|sell-heavy|balanced`,
`OTC_ARRIVAL=burst|staggered`, `OTC_ROUND_SPACING_MS=6500`, and
`OTC_DURATION_SEC=30`. Every attempt, timestamp, combination, result and sampled
chart phase is retained. Empty liquidity is a real rejection with a refund,
not a server-capacity failure. An ambiguous network retry retains its key;
retrying a confirmed refunded rejection uses a new key and is recorded.

## Isolated KVM acceptance stack

Prepared file: `deploy/docker-compose.otc-staging.yml`. This uses a distinct
project, image, network, database and volumes, with loopback-only ports 14301,
14401, 14402 and 15440. It does not modify production nginx or production data.
The isolated KVM stack is running in
`/home/deploy/asmtrader-otc-staging-20261105`. Existing SSH access works with the
explicit `~/.ssh/asmtrader_ci` key and user `deploy`; no key contents should be
copied into reports or chat. The earlier authentication failure was caused by
the key not being selected automatically. Production is unchanged.

For a fresh staging installation, copy the reviewed source to a separate
staging directory. Generate three new hex secrets on the server into a
mode-600 `.env.otc-staging` (never reuse production secrets):

```sh
umask 077
{
  echo "OTC_STAGE_DB_PASSWORD=$(openssl rand -hex 24)"
  echo "OTC_STAGE_SESSION_SECRET=$(openssl rand -hex 32)"
  echo "OTC_STAGE_ENGINE_SECRET=$(openssl rand -hex 32)"
} > .env.otc-staging
docker compose --env-file .env.otc-staging \
  -f deploy/docker-compose.otc-staging.yml up --build -d
```

Use a temporary SSH tunnel to inspect it locally; leave all staging ports
private. Stop the local acceptance services first if their ports are occupied.

```sh
ssh -N -L 4301:127.0.0.1:14301 -L 4501:127.0.0.1:14401 \
  -L 4502:127.0.0.1:14402 -L 55440:127.0.0.1:15440 deploy@187.52.118.185
```

The web image uses `ws://127.0.0.1:4501` for that private tunnel. Add
`-o IdentitiesOnly=yes -i ~/.ssh/asmtrader_ci` to the SSH command when using the
existing VPS access. The staging database user is `otc_stage`.

Run `bash deploy/otc-staging-acceptance.sh` from the separate server checkout.
It runs the normal-signup/lifecycle/crowd/matched-execution audit inside a
separate load-generator container. Its internal fixture guard requires the
literal project marker `asmtrader-otc-staging`, DB `postgres:5432/otc_integration`
and user `otc_stage`; API/WS targets are fixed to `web:3000`/`engine:4001`.
It does not accept arbitrary remote hosts or production databases. Reports are
copied to `reports/`; the private credential manifest stays inside the retained
proof container. Keep that container private and preserve reports before removal.

After the crowd run, `bash deploy/otc-staging-benchmark.sh` creates a **different**
`otc_benchmark` database in the staging Postgres, migrates it, then runs the
durable accelerated and worker-only long-session benchmarks. Its reset guard
requires that exact benchmark name, never the acceptance database. A rerun
must explicitly handle the retained test container/database; scripts refuse
to overwrite them automatically. Save KVM measurements under
`docs/verification/kvm/` separately from laptop results.

## Diagnostics and data retention

- Authenticated internal `GET /otc/metrics` exposes engine CPU, RSS, event-loop
  delay and transport counters. CPU is a percentage of one logical core and
  includes the worker; web, Postgres, Redis and browser are separate.
- The owner requested removal of the trade-page **Chart performance** recorder.
  Its bounded measurement helper remains in source, but the main page does not
  render it. Use permitted developer profiling for actual browser frame/switch
  measurements; DOM and server checks must not be described as GPU/frame tests.
- Closed one-minute candles persist for 365 days and aggregate on paged reads.
  The private execution audit persists for seven days. System commands older
  than a day compact only behind a durable checkpoint. Trade receipts stay for
  idempotency. Cleanup runs at most hourly after checkpoint persistence.
- The worker retains 1,500 recent candles per market, and the UI has bounded
  history and a six-market/timeframe cache. All executions and settlement ticks
  still run; display coalescing never drops market operations.

The regression database is yet another cluster, port 55441, data directory
`/tmp/asm-otc-regression.40Yo4h/data`. Destructive coordinator tests must use
this disposable database, never the preview or acceptance database while live.
