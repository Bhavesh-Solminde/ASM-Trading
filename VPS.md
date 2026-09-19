# VPS.md — How AMScoins Actually Lives on the Internet

> **What this file is:** A reverse-engineered breakdown of the VPS at `187.52.118.185` (asmcoins.com), built by the senior engineer. Written to teach you not just *what* is there, but *why* it was built that way — so you could rebuild it yourself.

---

## The Big Picture

Before any of this, AMScoins was two folders on a laptop: `client/` (React app) and `server/` (Express + MongoDB API). The whole setup below answers one question:

> **How does code on a laptop become a service a stranger's phone can reach, safely, and stay reachable?**

That question splits into three concerns — kept separate because they're solved by different layers:

| Layer | Question it answers |
|-------|-------------------|
| **Networking** | How do packets find the right machine and process? How is the conversation kept private? |
| **Operating System** | Who's allowed to do what on the machine itself? Which user, which permissions, which port? |
| **DevOps** | How do you package the app so it works the same every time, and keep shipping without doing it by hand? |

---

## Architecture Overview

```
Browser (phone / laptop)
        │
        │  HTTPS :443  (the only public door)
        ▼
┌──────────────────────────────────────────┐
│  VPS · 187.52.118.185 · Ubuntu 24.04     │
│                                          │
│  ┌─────────────────────┐                 │
│  │  nginx (host)       │                 │
│  │  reverse proxy      │                 │
│  │  / → dist/ (React)  │                 │
│  │  /api/* → :4000     │                 │
│  └──────────┬──────────┘                 │
│             │  (loopback only)           │
│  ┌──────────▼──────────┐                 │
│  │  backend container  │  :4000          │
│  │  Express + Node.js  │                 │
│  └──────┬──────────────┘                 │
│         │          │                     │
│  ┌──────▼──┐  ┌────▼──────┐             │
│  │  mongo  │  │   redis   │             │
│  │ :27017  │  │   :6379   │             │
│  │(loopback│  │(loopback) │             │
│  │ only)   │  └───────────┘             │
│  └─────────┘                            │
└──────────────────────────────────────────┘
```

**Key insight:** Only nginx has a public door (port 443). Everything to its right — the backend, Mongo, Redis — only exists on the VPS's internal loopback address (`127.0.0.1`). A stranger on the internet cannot address them directly, no matter what port they try.

---

## The Stack

| Component | What it is | Why it's here |
|-----------|------------|---------------|
| **Ubuntu 24.04 KVM** | The operating system on a Virtual Private Server | The "computer" rented from Hostinger. KVM means another customer can't see or touch your slice. |
| **Docker + Docker Compose** | Containerisation runtime | Packages the app so it runs identically every time; isolates processes from each other |
| **Express (Node.js)** | The backend API | Handles all `/api/*` requests, talks to Mongo and Redis |
| **MongoDB 7** (replica set) | Primary database | Stores users, wallets, investments, transactions |
| **Redis 7** | In-memory store | Rate limiting (login attempts), session/queue data |
| **nginx** | Reverse proxy (on the host, not in Docker) | The single public door: routes requests, serves React static files, terminates TLS |
| **GitHub Actions** | CI/CD pipeline | Builds the app and deploys it on every `git push` to `main` |
| **Certbot / Let's Encrypt** | TLS certificate | The `S` in HTTPS — encrypts traffic and proves the site is really asmcoins.com |
| **fail2ban** | SSH intrusion prevention | Temporarily bans IPs that fail SSH login repeatedly |

---

## Phase 1 — Getting Into the Machine (SSH)

The VPS sits in a Hostinger data centre with no keyboard, no monitor. The only way in is **SSH (Secure Shell)** on port 22.

### Why SSH keys, not passwords?

Passwords are a shared secret — both sides know the same string, which can be stolen or guessed. SSH keys work differently:

- You have a **private key** (never leaves your laptop)
- The server has your **public key** (safe to share — it can't reveal the private key)
- When you connect, the server issues a cryptographic challenge. Only your private key can answer it correctly.

Nothing secret ever crosses the network after the first setup.

```bash
# Run locally the very first time — the root password stays on your screen, never in chat
ssh-copy-id root@187.52.118.185
```

From then on, every connection is key-only.

---

## Phase 2 — Least Privilege: The `deploy` User

**Problem:** Logging in as `root` for day-to-day work is dangerous. Root can do anything — delete any file, kill any process, reconfigure the kernel. One mistake (or a compromised key) and there's no limit to the damage.

**Solution:** Create a separate `deploy` user with minimal permissions.

```bash
adduser --disabled-password --gecos "" deploy   # no password — nothing to brute-force
usermod -aG sudo deploy                          # can use sudo for specific commands
usermod -aG docker deploy                        # can run docker/compose commands
```

**Scoped sudo** — `deploy` can only run two commands as root (not blanket root access):

```
# /etc/sudoers.d/deploy
deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload nginx, \
                            /usr/bin/systemctl restart nginx, \
                            /usr/sbin/nginx -t
```

**Why docker group = almost root:** Anyone who can talk to the Docker daemon can mount the host's root filesystem into a container and get a root shell. It's a necessary trade-off for a deploy user, but worth knowing — it's a different door to the same room.

**Key copy from root → deploy:**

```bash
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

The `chmod` lines aren't decoration — SSH actively refuses to trust an `authorized_keys` file that's readable by other users.

---

## Phase 3 — The Firewall (UFW)

**What a firewall does:** It sits in front of the network stack and decides, per packet, whether to let it reach any port at all.

**Default posture:** deny all incoming, allow all outgoing. Then explicitly open only what the world actually needs:

```bash
ufw allow OpenSSH   # port 22 — SSH access
ufw allow 80        # HTTP (redirects to HTTPS)
ufw allow 443       # HTTPS
ufw enable          # IMPORTANT: allow port 22 BEFORE this line, or you lock yourself out
```

**Why this matters:** Every other port — including Mongo's 27017 and Redis's 6379 — is simply invisible from the internet. Not "protected by a password." Unreachable. That's a stronger guarantee.

**fail2ban** runs alongside UFW — it watches the SSH log for repeated failed logins from the same IP and temporarily bans that address. (It became the main character later — see the SSH hardening section.)

---

## Phase 4 — Containers (Docker + Compose)

### Why Docker?

The VPS runs five separate programs (API, MongoDB, Redis, DB browser, nginx's static files). Without Docker, they'd fight over dependencies and file paths. Docker's answer is the **container**: an isolated process that believes it's alone on the machine.

**Container vs VM:**
- A VM emulates an entire computer, including its own kernel — heavy but fully isolated.
- A container is a normal process on the host's kernel, wrapped in Linux namespaces so it has its own view of processes, network, and filesystem. Same kernel, separate everything else.

### The Backend Dockerfile

Multi-stage build — the final image doesn't carry build tools it'll never need:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev                   # install only production deps

FROM node:22-alpine
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
RUN mkdir -p logs && chown nodejs:nodejs logs   # ← earned its place the hard way
USER nodejs
CMD ["node", "src/server.js"]
```

**Why `mkdir logs && chown`?** The container runs as the unprivileged `nodejs` user. The app writes rotating log files to `./logs` on boot. Without a directory it actually owns, the first write threw `EACCES` and the entire process crash-looped — a working image dying for a reason that had nothing to do with the app's logic.

### Volumes — The Only Thing That Outlives a Container

A container's own filesystem is thrown away when it's removed. A **volume** is deliberately outside that lifecycle — storage Docker manages separately.

```
Mongo's /data/db  →  lives in volume named mongo_data
```

So rebuilding the backend image, or even `docker compose down`, never touches the database. Only `docker compose down -v` destroys volumes.

---

## Phase 5 — The Blank-Password Bug

**What happened:** The plan was a `.env.production` file holding every secret. First boot, Mongo started with blank credentials — no authentication at all.

**Why:** Docker Compose has two separate ways to read config:
1. Auto-reads a file literally named `.env` for substituting `${VARS}` written inside `docker-compose.yml`
2. `env_file: .env.production` on a service injects variables into that container's process env only

Since the file wasn't named `.env`, every `${MONGO_ROOT_PASSWORD}` silently resolved to an empty string.

**The fix:** A one-line symlink making the file answer to both names:

```bash
ln -sf .env.production .env
```

**Lesson:** "Environment variables" sounds simple, but a real deployment has several distinct places config gets read — each with its own rules. Assuming they're unified is exactly how a database ends up with no password on first boot.

---

## Phase 6 — MongoDB Replica Set + Keyfile

**Why a replica set for a single server?**

AMScoins moves money between a wallet, an investment record, and a referral credit in a single logical step — either all three happen or none do. MongoDB only offers multi-document transactions on a **replica set**, never on a standalone instance.

A "cluster of one" gets you:
- The oplog (transaction log) which transactions need
- Transaction support
- No actual failover (there's nothing to fail over to — one member)

**The keyfile requirement:**

When you enable both `--replSet` and authentication, MongoDB requires a keyfile — replica set members authenticate to each other, separately from how clients authenticate. Even with one member:

```bash
openssl rand -base64 756 > deploy/mongo/keyfile
chown 999:999 deploy/mongo/keyfile   # mongo:7's baked-in UID
chmod 400 deploy/mongo/keyfile       # readable by owner only, not group or world
```

`chmod 400` isn't cosmetic — MongoDB refuses to start if the keyfile is group- or world-readable, on the reasoning that a secret readable by others isn't really a secret.

**The full Mongo service in `docker-compose.yml`:**

```yaml
mongo:
  image: mongo:7
  command: ["--replSet", "rs0", "--keyFile", "/etc/mongo-keyfile", "--wiredTigerCacheSizeGB", "1.5"]
  volumes:
    - mongo_data:/data/db
    - ./deploy/mongo/keyfile:/etc/mongo-keyfile:ro
  ports: ["127.0.0.1:27017:27017"]     # loopback only — not reachable from internet
```

**Redis (simpler by design):**

```yaml
redis:
  image: redis:7-alpine
  command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru", "--appendonly", "yes"]
  volumes: ["redis_data:/data"]
  ports: ["127.0.0.1:6379:6379"]       # loopback only
```

Redis is a cache and rate-limit store, not a system of record. `allkeys-lru` evicts old keys under memory pressure instead of erroring. The backend client is written to keep working even if Redis is briefly unreachable.

---

## Phase 7 — The Reverse Proxy (nginx)

**What a reverse proxy does:**

A forward proxy sits in front of clients. A reverse proxy sits in front of servers. The public internet only ever sees nginx on port 443. nginx decides, per request, which internal program should actually answer it.

This is what makes one domain, one certificate, and one open port front several different backend processes.

**Routing rule:**
- `/api/*` → Node backend on `127.0.0.1:4000`
- Everything else → built React app (`/opt/amscoins/dist/`)

**The trailing slash bug:**

```nginx
# WRONG — trailing slash strips /api from the path
location /api/ {
    proxy_pass http://127.0.0.1:4000/;   # GET /api/health → Express sees GET /health → 404
}

# CORRECT — no trailing path, original URL passes through unchanged
location /api/ {
    proxy_pass http://127.0.0.1:4000;    # GET /api/health → Express sees GET /api/health → 200
}
```

Both forms are valid nginx, both look reasonable, no startup error — just every single API call returning 404 once real traffic hit it.

---

## Phase 8 — DNS

**What DNS does:** Turns `asmcoins.com` into `187.52.118.185`. Nobody types an IP address into a phone.

Records set:

| Type | Host | Value |
|------|------|-------|
| A | @ | 187.52.118.185 |
| A | www | 187.52.118.185 |
| AAAA | @ | 2a02:4780:5e:861c::1 |
| AAAA | www | 2a02:4780:5e:861c::1 |

Propagation was verified with `dig @1.1.1.1 asmcoins.com` — querying Cloudflare's public resolver directly to bypass any cached answers.

---

## Phase 9 — TLS (HTTPS) with Let's Encrypt

**What the `S` in HTTPS buys you:** TLS wraps the connection in encryption AND proves identity. A certificate, signed by an authority the browser already trusts, says "the entity holding the private key for this cert really does control asmcoins.com."

**How Let's Encrypt proves you control the domain:** It gives your server a random token and checks — over plain HTTP — that the token is served back from that exact domain. That's why port 80 still matters (redirect to HTTPS happens after this challenge), and why this step waited until DNS actually pointed here.

```bash
certbot --nginx -d asmcoins.com -d www.asmcoins.com \
  --agree-tos --redirect --email you@example.com
```

Certbot did three things in one pass:
1. Proved domain control (HTTP challenge)
2. Wrote the certificate to disk
3. Rewrote the nginx config — added `listen 443 ssl` block and a redirect from port 80

It also installed a **systemd timer** to renew automatically before the 90-day certificate expires.

---

## Phase 10 — CI/CD with GitHub Actions

**Goal:** Every `git push` to `main` deploys automatically — no human doing anything by hand.

**Two-job pipeline:**

```
git push main
      │
      ▼
┌─────────────────────────────┐
│  Job 1: build-frontend      │
│  npm ci && vite build       │
│  → uploads dist/ artifact   │
└──────────────┬──────────────┘
               │ hand-off (same bytes that were tested)
               ▼
┌─────────────────────────────┐
│  Job 2: deploy              │
│  downloads dist/ artifact   │
│  scp: dist/, server/,       │
│       compose.yml, deploy/  │
│  ssh: rebuild backend       │
│  ssh: reload nginx          │
└──────────────┬──────────────┘
               │
               ▼
         VPS · asmcoins.com live
```

**Why two separate jobs?** The second job downloads exactly what the first job already produced. What gets tested and what gets shipped are provably the same bytes.

**What does NOT get rebuilt on every push:** Mongo, Redis, and the database browser stay running untouched. Only the backend container (the thing that actually changes when application code changes) gets rebuilt and restarted each time.

**Authentication to the VPS:** The deploy job uses an SSH key — but not anyone's laptop key. A dedicated keypair was generated once, authorized only for the `deploy` user, and stored as GitHub encrypted secrets:

- `VPS_HOST` → `187.52.118.185`
- `VPS_USER` → `deploy`
- `VPS_SSH_KEY` → the private key (never visible in logs)

**The workflow file lives at:** `.github/workflows/deploy.yml`

---

## Phase 11 — The Redis Race Condition (Production Bug)

**What happened:** Fresh deploy, first real registration attempt: `500 — Stream isn't writeable and enableOfflineQueue options is false`.

**Root cause:** The Redis client connects lazily — `.connect()` is called but not *awaited* before the rest of the app finishes loading. The rate limiter, built from the same client a few lines later in startup, tried to run its first command before the connection was ready. With `enableOfflineQueue: false`, a command issued before the connection is ready doesn't wait — it fails immediately. That failure got cached by the rate-limiting library as a permanent state.

**Why it only showed up in production:** Locally, everything connects fast enough. Under a fresh container boot, the timing is different.

```javascript
// Fix — queue commands until ready instead of failing instantly
new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: true,  // queue, don't throw, before connection is ready
})
```

---

## Phase 12 — Trust Proxy (Rate Limiting Behind nginx)

**Problem:** Every request the backend receives now comes from nginx's own loopback address — not the real visitor's IP. The `X-Forwarded-For` header carries the real IP, but anyone could fake that header.

**Fix:** `app.set('trust proxy', 1)` — tells Express to trust exactly one hop of forwarding (the one nginx adds, running on the same machine), and nothing beyond it.

**Without this:** Every visitor shared one rate-limit bucket (nginx's own address). A handful of failed logins from any single visitor could lock out registration for *everyone else* on the site.

---

## Phase 13 — SSH Hardening

Two settings were still open on a live money app:

```
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
```

**The gotcha:** Ubuntu's `sshd_config` begins with `Include /etc/ssh/sshd_config.d/*.conf`. OpenSSH resolves repeated directives by **first match wins**. A cloud-init drop-in shipped with the box to keep passwords available after first boot — it sat above the edit and silently overrode it.

**Fix:** Find and correct the specific drop-in file, not the main config.

**The lockout:** Verifying the fix meant triggering rejected logins. fail2ban was watching — after a few attempts, it banned the verifying machine. `ssh` returned `Connection refused`.

**Recovery:** Hostinger's browser-based console (doesn't depend on SSH) → logged in as root → `fail2ban-client set sshd unbanip <ip>`.

**Lesson:** Confirm out-of-band console access EXISTS before touching SSH hardening. Get it wrong and the only way back over SSH is gone by design.

---

## Phase 14 — SSH Tunnels (Reaching Mongo/Redis Safely)

Mongo and Redis are loopback-only — correctly unreachable from the internet. But sometimes you need to look inside with a GUI tool (MongoDB Compass). The answer isn't opening a port — it's forwarding through the connection you already trust.

```bash
ssh -L 27017:localhost:27017 deploy@187.52.118.185
```

Read that as: "Open port 27017 on my own laptop, and anything that connects to it, carry over SSH and deliver to `localhost:27017` as the VPS sees it."

```
Your laptop                       VPS · 187.52.118.185
Compass                           sshd :22
localhost:27017  ──SSH tunnel──►  mongo container
                                  127.0.0.1:27017
```

**Compass connection string:**
```
mongodb://appuser:<password>@localhost:27017/asmcoins?authSource=asmcoins&directConnection=true
```

**Why `directConnection=true`?** Without it, the driver discovers this is a replica set and tries to reconnect through the hostname Mongo reports internally (meaningless outside the VPS's private Docker network). This flag says: "just use the address I gave you, skip the discovery."

---

## Phase 15 — Nightly Backups

A cron job runs at 2am and dumps the whole database to a compressed archive, keeping two weeks locally:

```cron
0 2 * * * /opt/amscoins/scripts/backup.sh >> backup.log 2>&1
```

**The `source` bug:** The original script used `source .env.production` to load credentials. That's fine for simple `KEY=value` lines. But `MAIL_FROM=ASM Coins <noreply@asmcoins.com>` contains `<` and `>` — the shell tried to parse them as redirection operators mid-line, aborting the script before any backup ran.

**Fix — read only the specific lines needed, as plain text:**

```bash
MONGO_ROOT_USER=$(grep '^MONGO_ROOT_USER=' .env.production | cut -d= -f2-)
MONGO_ROOT_PASSWORD=$(grep '^MONGO_ROOT_PASSWORD=' .env.production | cut -d= -f2-)
```

**What's still open:** Backups are on-box only. They survive a bad deploy, not a lost VPS. The fix is a scheduled sync to separate storage.

---

## Phase 16 — Outbound Email (Not Landing in Spam)

**Problem:** Withdrawal/deposit emails went through a personal Gmail SMTP relay and landed in spam.

**Why:** Receiving mail servers check three DNS records before trusting a message:
- **SPF** — which mail servers are allowed to send for this domain
- **DKIM** — a cryptographic signature proving the message wasn't altered in transit
- **DMARC** — what to do if SPF/DKIM disagree with the visible "From"

A personal Gmail address has none of that domain-level backing.

**Fix:** Move to Resend (dedicated provider authenticated for asmcoins.com itself):

```
RESEND_API_KEY=re_...
MAIL_FROM=ASM Coins <noreply@asmcoins.com>
```

---

## The CI/CD Pipeline — Step by Step

```
Developer laptop
      │
      │  git push origin main
      ▼
GitHub
      │
      │  triggers .github/workflows/deploy.yml
      ▼
┌──────────────────────────────────────┐
│  Job 1: build-frontend               │
│  Runner: ubuntu-latest               │
│  1. Checkout repo                    │
│  2. npm ci (install deps)            │
│  3. vite build → dist/               │
│  4. Upload dist/ as workflow artifact│
└──────────────────┬───────────────────┘
                   │ artifact hand-off
                   ▼
┌──────────────────────────────────────┐
│  Job 2: deploy                       │
│  Runner: ubuntu-latest               │
│  1. Download dist/ artifact          │
│  2. scp dist/ → VPS /opt/amscoins/  │
│  3. scp server/ → VPS               │
│  4. scp docker-compose.yml + deploy/ │
│  5. ssh: docker compose up --build   │
│         (rebuilds backend only)      │
│  6. ssh: sudo nginx -t               │
│  7. ssh: sudo systemctl reload nginx │
└──────────────────┬───────────────────┘
                   │
                   ▼
         asmcoins.com — live
```

**What stays running across deploys:** Mongo, Redis. Only the backend container gets rebuilt.

**Security:** The SSH key the CI runner uses is stored as a GitHub encrypted secret (`VPS_SSH_KEY`). It never appears in logs or the workflow file.

---

## Useful Commands on the VPS

```bash
# See all running containers and their status
docker compose ps

# Live CPU/RAM per container
docker stats

# Full disk usage
df -h

# Docker-specific disk usage
docker system df

# Tail nginx access log (every request, live)
tail -f /var/log/nginx/access.log

# Check if nginx config is valid before reloading
sudo nginx -t

# Reload nginx (picks up new static files / config changes)
sudo systemctl reload nginx

# Rebuild and restart only the backend
docker compose up --build -d backend

# SSH tunnel to Mongo (run this, then open Compass)
ssh -L 27017:localhost:27017 deploy@187.52.118.185
```

---

## What's Still Open (Known Gaps)

| Gap | Risk | Fix |
|-----|------|-----|
| Backups are on-box only | Lost VPS = lost data | Sync nightly to S3 or Backblaze |
| No staging environment | Every push to main hits production | Clone the stack on different ports |
| No uptime monitoring | Outages discovered by users, not you | UptimeRobot / BetterUptime on `/api/health` |

---

## How to Rebuild This From Scratch (The Recipe)

1. **Provision** — Get a VPS (Ubuntu 24.04). Add SSH key with `ssh-copy-id`.
2. **Least privilege** — Create `deploy` user with scoped sudo and docker group.
3. **Firewall** — `ufw allow 22/80/443 && ufw enable` (allow 22 FIRST).
4. **Install Docker** — `apt install docker.io docker-compose-plugin`.
5. **Write Dockerfile** — multi-stage build, non-root user, own the logs directory.
6. **Write docker-compose.yml** — all DB ports on `127.0.0.1` only. Symlink `.env → .env.production`.
7. **Mongo keyfile** — generate, `chown 999:999`, `chmod 400`, mount read-only.
8. **Start stack** — `docker compose up -d`. Init replica set: `rs.initiate()`.
9. **nginx** — Install on host. Route `/api/` without trailing slash. `nginx -t` before reload.
10. **DNS** — A/AAAA records. Verify with `dig @1.1.1.1`.
11. **TLS** — `certbot --nginx`. Port 80 must be reachable for the HTTP challenge.
12. **CI/CD** — Generate CI-only SSH keypair. Add as GitHub secrets. Write workflow.
13. **Redis client** — `enableOfflineQueue: true`. `app.set('trust proxy', 1)`.
14. **Confirm console access** → then: `PermitRootLogin no` + `PasswordAuthentication no`. Check drop-ins.
15. **Backup cron** — `grep` specific lines from env file, never `source` the whole thing.
16. **Email** — Move to domain-authenticated provider (Resend).
17. **Uptime monitor** — External ping on `/api/health`.

---

*Source: Senior_guide.md — every command and bug above is from the actual deploy session for AMScoins.*
