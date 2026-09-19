# Deploying asmtrader.com

Written after asmcoins.com. Coexists with it on the same VPS
(`187.52.118.185`) — no shared containers, no shared volumes, no shared
loopback ports. `nginx` on the host routes by `server_name`; the two sites
never see each other.

## Where things live on the VPS

```
/opt/amscoins/        # existing — do not touch
/opt/asmtrader/       # this stack
  .env.production     # generated on-box, never committed
  deploy/
    Dockerfile
    docker-compose.yml
    postgres/init.sql
    nginx/asmtrader.conf   # copied to /etc/nginx/sites-available/
  apps/  packages/  ...    # source (rsync'd)
```

## Loopback ports

| Site       | Port  | What                             |
| ---------- | ----- | -------------------------------- |
| amscoins   | 4000  | backend (existing)               |
| amscoins   | 6379  | redis (existing)                 |
| amscoins   | 27017 | mongo (existing)                 |
| asmtrader  | 3000  | Next.js web                      |
| asmtrader  | 4001  | engine WebSocket (nginx `/ws`)   |
| asmtrader  | 5432  | postgres (SSH-tunnel-able)       |
| asmtrader  | 6380  | redis (moved off 6379)           |

Nothing on the asmtrader stack is reachable from the internet. nginx is the
only public door and only exposes `/`, `/api/*`, and `/ws` on port 443.

## First deploy (manual)

Run from your laptop after DNS is confirmed pointing at 187.52.118.185.

```bash
# 1. Get an SSH session as deploy (add key if you don't have one).
ssh deploy@187.52.118.185 'mkdir -p /opt/asmtrader'

# 2. Rsync the repo. `.dockerignore`/`--exclude` keep it lean.
rsync -avz --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude apps/harness --exclude apps/relay \
  ./ deploy@187.52.118.185:/opt/asmtrader/

# 3. Create the production env file on the box (never on your laptop).
ssh deploy@187.52.118.185 'cp /opt/asmtrader/.env.production.example /opt/asmtrader/.env.production && chmod 600 /opt/asmtrader/.env.production && nano /opt/asmtrader/.env.production'
```

Replace every `change-me-*` with `openssl rand -base64 32`. Keep the passwords
inside `DATABASE_URL` and `DATABASE_MIGRATE_URL` in sync with
`POSTGRES_APP_PASSWORD` and `POSTGRES_OWNER_PASSWORD` — the app connects with
those, not with the `postgres` superuser.

```bash
# 4. Build + start the stack. migrate runs as a one-shot; web/engine wait for it.
ssh deploy@187.52.118.185 'cd /opt/asmtrader/deploy && docker compose up -d --build'

# 5. Install the nginx site (root, one-time).
ssh root@187.52.118.185 '
  cp /opt/asmtrader/deploy/nginx/asmtrader.conf /etc/nginx/sites-available/asmtrader.conf
  ln -sfn /etc/nginx/sites-available/asmtrader.conf /etc/nginx/sites-enabled/asmtrader.conf
  nginx -t && systemctl reload nginx
'

# 6. TLS. Certbot rewrites the site file in place with the :443 block + redirect.
ssh root@187.52.118.185 '
  certbot --nginx -d asmtrader.com -d www.asmtrader.com \
    --agree-tos --redirect --email you@example.com
'
```

## Smoke test

```bash
curl -I https://asmtrader.com                    # expect 200, HTTP/2
curl -I https://www.asmtrader.com                # expect 301 -> asmtrader.com
curl -s https://asmtrader.com/api/account -I     # expect 401/403 (auth-gated)
# Then open the site in a browser and check devtools:
#   - wss://asmtrader.com/ws opens
#   - /trade renders live candles
```

## Redeploy (until CI is wired)

```bash
rsync -avz --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude apps/harness --exclude apps/relay \
  ./ deploy@187.52.118.185:/opt/asmtrader/
ssh deploy@187.52.118.185 'cd /opt/asmtrader/deploy && docker compose up -d --build'
```

`postgres` and `redis` stay running across redeploys — only the `web`,
`engine`, and one-shot `migrate` images get rebuilt.

## Useful commands

```bash
# On the VPS as deploy:
docker compose ps                           # asmtrader containers
docker compose logs -f web engine           # tail app logs
docker compose exec postgres psql -U postgres -d asm_trade
docker compose down                         # stop (keeps data)
docker compose down -v                      # DESTROYS postgres/redis data
```

## Never do

- `docker compose down -v` in `/opt/asmtrader/deploy` (drops the DB volume)
- Edit `/etc/nginx/sites-available/amscoins.conf`
- Reuse `.env.production` across sites
- Commit the filled `.env.production`
