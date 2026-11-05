#!/usr/bin/env bash
# Separate disposable benchmark DB; never reset the acceptance or production DB.
set -euo pipefail
test -f deploy/docker-compose.otc-staging.yml
test -f .env.otc-staging
compose=(docker compose --env-file .env.otc-staging -f deploy/docker-compose.otc-staging.yml)
if docker inspect asmtrader-otc-staging-benchmark >/dev/null 2>&1; then
  echo 'Previous benchmark container is retained; review/copy its reports first.' >&2
  exit 1
fi
"${compose[@]}" exec -T postgres createdb -U otc_stage otc_benchmark
"${compose[@]}" run --name asmtrader-otc-staging-benchmark --no-deps -T \
  -e OTC_STAGING_RUN=true -e OTC_STAGING_PROJECT=asmtrader-otc-staging \
  -v "$PWD/apps/engine/scripts/otc-durable-benchmark.mjs:/app/apps/engine/scripts/otc-durable-benchmark.mjs:ro" \
  -v "$PWD/apps/engine/scripts/otc-worker-benchmark.mjs:/app/apps/engine/scripts/otc-worker-benchmark.mjs:ro" \
  engine sh -ec '
    export DATABASE_URL="${DATABASE_URL%/otc_integration}/otc_benchmark"
    export DATABASE_MIGRATE_URL="$DATABASE_URL"
    pnpm --filter @asm/db exec prisma migrate deploy
    pnpm --filter @asm/engine exec tsx scripts/otc-durable-benchmark.mjs
    pnpm --filter @asm/engine exec tsx scripts/otc-worker-benchmark.mjs
  '
mkdir -p reports
docker cp asmtrader-otc-staging-benchmark:/tmp/otc-reports/. reports/
