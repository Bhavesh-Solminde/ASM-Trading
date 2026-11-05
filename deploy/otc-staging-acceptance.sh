#!/usr/bin/env bash
# Run from the separate, already-started staging checkout. Never production.
set -euo pipefail
test -f deploy/docker-compose.otc-staging.yml
test -f .env.otc-staging
compose=(docker compose --env-file .env.otc-staging -f deploy/docker-compose.otc-staging.yml)
if docker inspect asmtrader-otc-staging-proof >/dev/null 2>&1; then
  echo 'The previous proof container is retained. Copy/review its reports before explicitly removing that test container.' >&2
  exit 1
fi
"${compose[@]}" run --name asmtrader-otc-staging-proof --no-deps -T \
  -e OTC_STAGING_RUN=true -e OTC_STAGING_PROJECT=asmtrader-otc-staging \
  -v "$PWD/apps/engine/scripts/otc-website-proof.mjs:/app/apps/engine/scripts/otc-website-proof.mjs:ro" \
  -v "$PWD/apps/engine/scripts/otc-mix-proof.mjs:/app/apps/engine/scripts/otc-mix-proof.mjs:ro" \
  -v "$PWD/apps/engine/scripts/otc-audit-reports.mjs:/app/apps/engine/scripts/otc-audit-reports.mjs:ro" \
  -v "$PWD/apps/engine/scripts/otc-staging-target.mjs:/app/apps/engine/scripts/otc-staging-target.mjs:ro" \
  engine sh -ec '
    pnpm --filter @asm/engine exec tsx scripts/otc-website-proof.mjs
    pnpm --filter @asm/engine exec tsx scripts/otc-mix-proof.mjs /tmp/otc-credentials/*.otc-credentials.json
    pnpm --filter @asm/engine exec tsx scripts/otc-audit-reports.mjs
  '
mkdir -p reports
docker cp asmtrader-otc-staging-proof:/tmp/otc-reports/. reports/
echo 'Isolated KVM proof reports copied to reports/. Test credentials stay inside the private proof container.'
