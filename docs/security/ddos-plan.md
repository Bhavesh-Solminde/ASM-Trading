# DoS / DDoS protection plan — indianxtrade.com

## Why not "log everyone out every 20–30 minutes + OTP"?

A session timeout does not stop a DoS or DDoS attack:

- **The flood arrives before any session exists.** A botnet hitting `/`, `/api/*` or `/ws` never logs in. nginx and Node have already spent CPU and sockets on every request by the time a session would be checked.
- **Forced re-login multiplies the cost of each attack request.** Every re-login is a password hash (argon2) plus an OTP email. That adds load and creates a new target (OTP-send flooding).
- **It breaks trading.** A trader with a 15-minute position would be logged out mid-trade.

The useful parts of the idea are kept, but placed where they work:

- **The bot check goes on sign-up, login, password reset and OTP send** (Turnstile, below).
- **Re-verification is tied to money, not the clock.** Use step-up re-authentication (password/OTP) before withdrawals and security changes.

## The layered plan (in priority order)

### 1. Put Cloudflare in front: the main defence

One VPS cannot absorb a volumetric attack; its uplink fills first, whatever nginx does. Cloudflare's free plan absorbs L3/L4/L7 floods at the edge:

- Move DNS to Cloudflare and proxy `indianxtrade.com` (orange cloud). WebSockets (`/ws`) are supported on every plan.
- Turn on **Bot Fight Mode** and keep the **"I'm Under Attack"** switch ready. It shows a JS challenge to every visitor during an incident.
- **WAF rate-limit rule** (free plan includes one): `/api/auth/*`, 20 requests per minute per IP → block for 10 minutes.
- SSL mode: **Full (strict)** with the existing Let's Encrypt certificate.
- Pro ($20/mo) adds more WAF rules and the managed ruleset. Upgrade only if you are actually targeted.

### 2. Hide and lock down the origin

The VPS address (`187.52.118.185`, shared with amscoins.com) is public in DNS history, so attackers can bypass Cloudflare by hitting it directly. After step 1:

- Firewall ports 80/443 to **Cloudflare IP ranges only** (https://www.cloudflare.com/ips/), using `ufw` or an ipset.
- Ideally move to a **new VPS IP** that has never been in public DNS.
- In nginx, restore the real client IP, or every IP-based control breaks (rate limits, the VPN guard, fraud linking, leaderboard country):
  ```nginx
  # one set_real_ip_from per Cloudflare range
  set_real_ip_from 173.245.48.0/20;   # …
  real_ip_header CF-Connecting-IP;
  ```
- **iCloud Private Relay:** once behind Cloudflare, the origin firewall can't see relay IPs. Move `deploy/scripts/block-private-relay.sh` to a **Cloudflare WAF custom rule** that blocks a Cloudflare IP List built from Apple's egress CSV. The app-level relay block keeps working either way.

### 3. Bot check where bots act: Cloudflare Turnstile

Turnstile is free and usually invisible (no picture puzzles). Add it to register, login, password-reset request and OTP send. Do not add it on every page or on a timer. Server-side, verify the token with `https://challenges.cloudflare.com/turnstile/v0/siteverify` before the route does any work. Follow-up PR, needs the site and secret keys.

### 4. Origin hardening (done in this PR)

| Layer | Control |
| --- | --- |
| nginx `deploy/nginx/asmtrader.conf` | `/api/auth/*`: 20 r/min per IP, burst 20 · `/api/*`: 10 r/s, burst 20 · 100 concurrent connections per IP, 20 on `/ws` · slowloris timeouts (header 10s, body 15s, send 30s, keepalive 30s) · 10 MB body cap · 429 on rejection |
| Engine WebSocket `apps/engine/src/server.ts` | 16 KB max frame (was 100 MB) · unauthenticated sockets closed after 10s · max 5 sockets per user (oldest evicted) · existing 60 messages per 10s budget |
| App (already present) | Per-IP and per-email Redis limits on login, register, password reset, OTP, ws-ticket |

The limits are generous on purpose: Indian mobile carriers put many users behind one IP (CGNAT).

### 5. Sessions: protect money, not the clock

- **Keep** the 7-day sliding session (`apps/web/src/lib/session-cookie.ts`).
- **Add step-up re-authentication** (password or OTP, valid for 10 minutes) before a withdrawal, a payout-method change, or a 2FA/password change.
- **Optional:** a 12–24h *idle* timeout for LIVE accounts only, measured server-side from `Session.lastUsedAt`.

### 6. Monitoring

- Alert on spikes in `security.rate_limited`, `security.vpn_blocked` and nginx 429/5xx.
- Optionally run `fail2ban` with a jail on nginx `limiting requests` log lines, to ban repeat offenders at the firewall for an hour.

## Incident runbook

1. Cloudflare → **Under Attack mode ON**.
2. Check whether traffic is reaching the origin directly (`ss -s`, nginx access log). If so, the origin isn't locked down: apply step 2 now.
3. Tighten the WAF rate-limit rule for the targeted path.
4. Turn Under Attack mode off once traffic is normal.
