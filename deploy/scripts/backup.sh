#!/usr/bin/env bash
# Nightly pg_dump for the asmtrader postgres container.
# Runs from cron as `deploy`; that user is in the docker group.
# Same shape as amscoins' backup — reads specific lines from
# .env.production instead of `source`ing it (values may contain <, >, or
# spaces from other secrets, which the shell would parse as redirection).

set -euo pipefail

SITE_ROOT=/opt/asmtrader
BACKUP_DIR="$SITE_ROOT/backups"
ENV_FILE="$SITE_ROOT/.env.production"
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
OUT="$BACKUP_DIR/asm_trade_$STAMP.sql.gz"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"

if [ ! -r "$ENV_FILE" ]; then
  echo "$(date -u +%FT%TZ) FAIL cannot read $ENV_FILE" >&2
  exit 1
fi

OWNER_PW=$(grep '^POSTGRES_OWNER_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$OWNER_PW" ]; then
  echo "$(date -u +%FT%TZ) FAIL missing POSTGRES_OWNER_PASSWORD" >&2
  exit 1
fi

docker exec -e PGPASSWORD="$OWNER_PW" asmtrader-postgres-1 \
  pg_dump -U asm_owner -d asm_trade --no-owner --clean --if-exists \
  | gzip -9 > "$OUT"

# An empty file means pg_dump exited before writing anything (network
# blip, container restart mid-dump). Do not keep it: an empty archive
# looks like a valid backup on the disk-usage listing.
if [ ! -s "$OUT" ]; then
  echo "$(date -u +%FT%TZ) FAIL empty dump, discarding $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

# Prune older archives — always AFTER the new one lands successfully.
find "$BACKUP_DIR" -maxdepth 1 -name 'asm_trade_*.sql.gz' -mtime +"$KEEP_DAYS" -delete

SIZE=$(du -h "$OUT" | cut -f1)
echo "$(date -u +%FT%TZ) OK $OUT ($SIZE)"
