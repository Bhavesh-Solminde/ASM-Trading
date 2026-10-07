# VPN / Proxy Blocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop people on a VPN, proxy, Tor, or cloud server from signing up, logging in, opening the trading platform, trading, depositing, or withdrawing on asmtrader.com.

**Architecture:** Each guarded request takes its client IP from nginx's `X-Real-IP` header and looks it up with ipapi.is. The answer is reduced to a verdict (`clean | relay | vpn | proxy | tor | datacenter`) and cached in Redis for 24h. A single `checkNetwork()` guard is called from the six sensitive API routes and from the `(platform)` layout. When it blocks, API routes return `403 {code:"vpn_blocked"}` and pages redirect to `/network-blocked`. An env switch (`VPN_BLOCK_MODE=off|log|block`) allows a log-only rollout first. A per-user `vpnExempt` flag in the admin panel covers false positives.

**Tech Stack:** Next.js 16 route handlers + server components, ioredis, Prisma (Postgres), vitest, ipapi.is HTTP API.

## Why this matters for this codebase (read first)

- **The linked-accounts fraud detector depends on IP** (`packages/db/src/repositories/fraud.ts`, `SCORE_SHARED_IP`). A VPN lets one person open many bonus-eligible accounts that never share an IP. This plan closes that gap.
- **The client IP can currently be spoofed.** `apps/web/src/lib/request-context.ts` reads the *first* `X-Forwarded-For` entry. nginx uses `$proxy_add_x_forwarded_for`, which *appends* the real peer to whatever the client sent. So `curl -H "X-Forwarded-For: 1.2.3.4"` makes the app believe the caller is `1.2.3.4`. That already bypasses rate limits and pollutes `signupIp`/`lastIp`, and it would defeat any VPN check. Task 1 fixes it.
- There is **no Cloudflare** in front, so `CF-IPCountry` and similar headers aren't available. Detection has to be done in the app.

## Decisions baked into this plan (change before executing if you disagree)

| Decision | Default chosen | Why |
|---|---|---|
| Detection provider | **ipapi.is**: `GET https://api.ipapi.is/?q=<ip>&key=<key>` | Flat flags (`is_vpn`, `is_proxy`, `is_tor`, `is_datacenter`). Marks iCloud Private Relay explicitly via `egress_service.type`. 1,000 free lookups/day; after that $1 buys 30,000 lookups, with no subscription. |
| What gets blocked | `vpn`, `proxy`, `tor`, `datacenter` | Most commercial VPNs exit from datacenters, and self-hosted VPNs only ever show up as `datacenter`. |
| What is allowed | `clean` (home/mobile), `relay` (iCloud Private Relay, Cloudflare WARP, corporate gateways like Zscaler) | Relays keep the user's real country and are on by default for many iPhone Safari users. Blocking them would block ordinary customers. |
| Where it's enforced | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/ws-ticket`, `POST /api/trades`, `POST /api/deposits`, `POST /api/withdrawals`, `(platform)/layout.tsx` | Covers every way to get in and every way money moves. The engine WebSocket needs a ticket, so gating `ws-ticket` gates the live price feed too. |
| Not enforced | Landing/content/SEO pages, `/admin/*`, read-only `GET` APIs | Search crawlers and admins (who may use a VPN themselves) must keep working. |
| Provider down / quota spent | **Fail open** (allow + log `security.vpn_check_unavailable`) | Locking out every trader because a third party is down is worse than missing a VPN for 5 minutes. |
| Rollout | `VPN_BLOCK_MODE` defaults to `off`. Run production in `log` for about 7 days, then switch to `block` | Measures the false-positive rate on real Indian mobile/broadband traffic before anyone is locked out. |
| Exceptions | `User.vpnExempt` toggle in the admin user page | Handles a genuine customer on a corporate VPN without a deploy. |

## Global Constraints

- Never run `prisma migrate dev` against the shared Supabase dev DB. `packages/db/prisma.config.ts` prefers `DIRECT_URL`, and the repo `.env` points every DB URL at Supabase. Execute this plan in a worktree whose own `.env` sets `DIRECT_URL`, `DATABASE_MIGRATE_URL` and `DATABASE_URL` to a local scratch Postgres (e.g. `postgresql://solminde@localhost:5433/asm_vpn`). Check the `Datasource "db"` line Prisma prints before trusting any migrate command.
- Tests must never call ipapi.is. They seed the Redis verdict cache or inject a fake `fetch`.
- `VPN_BLOCK_MODE` unset ⇒ `off`. Dev, CI and every existing test must behave exactly as before.
- Web-only env vars are read via `process.env` directly (same pattern as `apps/web/src/lib/mail.ts`). Do not add them to `packages/config`.
- User-facing block copy (single source, `VPN_BLOCKED_MESSAGE`): `VPN, proxy or Tor detected. Turn it off and try again.`
- Block response: HTTP `403`, body `{ "error": VPN_BLOCKED_MESSAGE, "code": "vpn_blocked" }`.
- Log events: `security.vpn_blocked`, `security.vpn_detected` (log mode), `security.vpn_exempt`, `security.vpn_check_unavailable`.
- Redis key: `vpn:ip:<ip>`. TTL is 86400s for a verdict and 300s for `"unknown"`.
- Commit style: `feat(web): …` / `fix(web): …` / `feat(db,web): …`, ending with the `Co-Authored-By` trailer the session specifies.
- Run web tests with `pnpm --filter @asm/web test -- <path>`. Files run serially against a real Postgres and Redis.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/web/src/lib/request-context.ts` | Modify | `clientIpFrom(headers)`: trusted client IP (X-Real-IP → last XFF hop) |
| `apps/web/src/lib/request-context.test.ts` | Create | Spoofing tests |
| `apps/web/src/lib/network-guard/classify.ts` | Create | Pure: ipapi.is JSON → `IpVerdict`; `isPublicIp`; `BLOCKED_VERDICTS` |
| `apps/web/src/lib/network-guard/classify.test.ts` | Create | |
| `apps/web/src/lib/network-guard/lookup.ts` | Create | `lookupIp(ip, fetch?)`: Redis-cached provider call, 1.5s timeout |
| `apps/web/src/lib/network-guard/lookup.test.ts` | Create | Real Redis, fake fetch |
| `packages/db/prisma/schema.prisma` + migration | Modify/Create | `User.vpnExempt` |
| `apps/web/src/app/admin/(console)/users/actions.ts`, `users/[id]/page.tsx` | Modify | Admin toggle + pill |
| `apps/web/src/lib/network-guard/guard.ts` | Create | `checkNetwork()`, `guardMode()`, `vpnBlockedResponse()` |
| `apps/web/src/lib/network-guard/guard.test.ts` | Create | Injected deps, no I/O |
| `apps/web/src/lib/network-guard/routes.test.ts` | Create | End-to-end wiring of all six routes (seeded cache) |
| 6 route files | Modify | One guard call each |
| `apps/web/src/app/(platform)/layout.tsx` | Modify | Redirect blocked networks |
| `apps/web/src/app/network-blocked/page.tsx` | Create | Explanation + retry |
| `apps/web/src/components/chart/useEngineSocket.ts` | Modify | 403 on ticket → `/network-blocked` |
| `.env.example`, `.env.production.example` | Modify | Document `VPN_BLOCK_MODE`, `IPAPI_KEY` |

---

### Task 1: Trust only the IP nginx saw

**Files:**
- Modify: `apps/web/src/lib/request-context.ts`
- Test: `apps/web/src/lib/request-context.test.ts`

**Interfaces:**
- Produces: `clientIpFrom(headers: Pick<Headers, "get">): string`. Returns `"local"` when no proxy header exists. `requestContext(req).ip` now uses it.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/request-context.test.ts
import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./request-context";

describe("clientIpFrom", () => {
  it("prefers X-Real-IP, which nginx overwrites with the TCP peer address", () => {
    const h = new Headers({ "x-real-ip": "49.36.1.2", "x-forwarded-for": "1.1.1.1, 49.36.1.2" });
    expect(clientIpFrom(h)).toBe("49.36.1.2");
  });

  it("ignores a client-supplied first X-Forwarded-For hop and takes the one nginx appended", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "1.1.1.1, 49.36.1.2" }))).toBe("49.36.1.2");
  });

  it("handles a single-hop X-Forwarded-For", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": " 49.36.1.2 " }))).toBe("49.36.1.2");
  });

  it("falls back to 'local' when no proxy header is present", () => {
    expect(clientIpFrom(new Headers())).toBe("local");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @asm/web test -- src/lib/request-context.test.ts`
Expected: FAIL. `clientIpFrom` is not exported.

- [ ] **Step 3: Implement**

Replace the whole of `apps/web/src/lib/request-context.ts` with:

```ts
import { newCorrelationId } from "@asm/logger";
import type { NextRequest } from "next/server";

export interface RequestContext {
  cid: string;
  ip: string;
  userAgent: string;
}

/**
 * The caller's address as nginx saw it. nginx sets X-Real-IP to $remote_addr
 * (overwriting anything the client sent) and *appends* the peer to
 * X-Forwarded-For, so the first XFF entry is attacker-controlled and only the
 * last one is trustworthy. Port 3000 is bound to loopback, so nothing but
 * nginx can reach the app in production.
 */
export function clientIpFrom(headers: Pick<Headers, "get">): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return hops?.at(-1) ?? "local";
}

export function requestContext(req: NextRequest): RequestContext {
  return {
    cid: newCorrelationId(),
    ip: clientIpFrom(req.headers),
    userAgent: req.headers.get("user-agent") ?? "unknown",
  };
}
```

- [ ] **Step 4: Run the new test and the full web suite**

Run: `pnpm --filter @asm/web test -- src/lib/request-context.test.ts` → PASS.
Run: `pnpm --filter @asm/web test` → all PASS. Existing route tests send a single-value `x-forwarded-for: <uuid>`, which still resolves to the same value.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/request-context.ts apps/web/src/lib/request-context.test.ts
git commit -m "fix(web): take client IP from X-Real-IP / last XFF hop — first hop is spoofable"
```

---

### Task 2: Classify an ipapi.is response

**Files:**
- Create: `apps/web/src/lib/network-guard/classify.ts`
- Test: `apps/web/src/lib/network-guard/classify.test.ts`

**Interfaces:**
- Produces:
  - `type IpVerdict = "clean" | "relay" | "vpn" | "proxy" | "tor" | "datacenter"`
  - `BLOCKED_VERDICTS: ReadonlySet<IpVerdict>`, which is `{vpn, proxy, tor, datacenter}`
  - `isIpVerdict(v: string): v is IpVerdict`
  - `classifyIpapi(body: unknown): IpVerdict | null` (null for error bodies or garbage)
  - `isPublicIp(ip: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/network-guard/classify.test.ts
import { describe, expect, it } from "vitest";
import { BLOCKED_VERDICTS, classifyIpapi, isPublicIp } from "./classify";

const base = {
  ip: "203.0.113.7",
  is_mobile: false,
  is_datacenter: false,
  is_tor: false,
  is_proxy: false,
  is_vpn: false,
  is_abuser: false,
};

describe("classifyIpapi", () => {
  it("treats a residential or mobile address as clean", () => {
    expect(classifyIpapi(base)).toBe("clean");
    expect(classifyIpapi({ ...base, is_mobile: true })).toBe("clean");
  });

  it("flags a known VPN exit, including ipapi's truthy non-boolean values", () => {
    expect(classifyIpapi({ ...base, is_vpn: true, is_datacenter: true })).toBe("vpn");
    expect(classifyIpapi({ ...base, is_vpn: "NordVPN" })).toBe("vpn");
  });

  it("flags Tor ahead of every other signal", () => {
    expect(classifyIpapi({ ...base, is_tor: true, is_vpn: true, is_datacenter: true })).toBe("tor");
  });

  it("flags open proxies", () => {
    expect(classifyIpapi({ ...base, is_proxy: true })).toBe("proxy");
  });

  it("flags an unlabelled datacenter address (a self-hosted VPN on a cloud VM)", () => {
    expect(classifyIpapi({ ...base, is_datacenter: true })).toBe("datacenter");
  });

  it("lets iCloud Private Relay through as relay even though it reports is_datacenter", () => {
    const body = {
      ...base,
      is_datacenter: true,
      egress_service: { type: "private_relay", provider: "iCloud Private Relay" },
    };
    expect(classifyIpapi(body)).toBe("relay");
  });

  it("lets corporate secure web gateways through as relay", () => {
    const body = { ...base, egress_service: { type: "secure_web_gateway", provider: "Zscaler" } };
    expect(classifyIpapi(body)).toBe("relay");
  });

  it("returns null for an error body or anything that isn't a lookup", () => {
    expect(
      classifyIpapi({ error: "Invalid IP Address or AS Number", error_code: "ERR_INVALID_IP_OR_ASN" }),
    ).toBeNull();
    expect(classifyIpapi(null)).toBeNull();
    expect(classifyIpapi("nope")).toBeNull();
  });
});

describe("BLOCKED_VERDICTS", () => {
  it("blocks vpn, proxy, tor and datacenter but never clean or relay", () => {
    expect([...BLOCKED_VERDICTS].sort()).toEqual(["datacenter", "proxy", "tor", "vpn"]);
  });
});

describe("isPublicIp", () => {
  it.each(["49.36.1.2", "203.0.113.7", "2405:201:abcd::1"])("%s is public", (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  it.each([
    "local",
    "not-an-ip",
    "127.0.0.1",
    "10.1.2.3",
    "172.18.0.5",
    "192.168.1.9",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("%s is not public", (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/classify.test.ts`
Expected: FAIL. The module `./classify` does not exist.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/network-guard/classify.ts
import { BlockList, isIP } from "node:net";

/** What ipapi.is says about an address, collapsed to the decision we make on it. */
export type IpVerdict = "clean" | "relay" | "vpn" | "proxy" | "tor" | "datacenter";

/**
 * "relay" (iCloud Private Relay, Cloudflare WARP, corporate gateways such as
 * Zscaler) is deliberately allowed: those keep the user's real country and are
 * common on ordinary iPhones and office networks. "datacenter" is blocked
 * because a self-hosted VPN on a cloud VM shows up as nothing else.
 */
export const BLOCKED_VERDICTS: ReadonlySet<IpVerdict> = new Set<IpVerdict>([
  "vpn",
  "proxy",
  "tor",
  "datacenter",
]);

const VERDICTS: ReadonlySet<string> = new Set<IpVerdict>([
  "clean",
  "relay",
  "vpn",
  "proxy",
  "tor",
  "datacenter",
]);

export function isIpVerdict(v: string): v is IpVerdict {
  return VERDICTS.has(v);
}

const RELAY_EGRESS = new Set(["private_relay", "secure_web_gateway"]);

/** Returns null when the body is an error or not an ipapi.is lookup at all. */
export function classifyIpapi(body: unknown): IpVerdict | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if ("error" in b || typeof b.ip !== "string") return null;

  // ipapi.is documents is_vpn as occasionally truthy-but-not-`true`, so every
  // flag is tested for truthiness rather than `=== true`.
  if (b.is_tor) return "tor";
  const egress = b.egress_service;
  if (
    typeof egress === "object" &&
    egress !== null &&
    RELAY_EGRESS.has(String((egress as { type?: unknown }).type))
  ) {
    return "relay";
  }
  if (b.is_vpn) return "vpn";
  if (b.is_proxy) return "proxy";
  if (b.is_datacenter) return "datacenter";
  return "clean";
}

const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, "ipv4");
}
NON_PUBLIC.addAddress("::1", "ipv6");
NON_PUBLIC.addSubnet("fc00::", 7, "ipv6");
NON_PUBLIC.addSubnet("fe80::", 10, "ipv6");

/**
 * Loopback, private, CGNAT and malformed addresses (dev, docker, tests) never
 * reach the provider. They can't be looked up and would only burn quota.
 */
export function isPublicIp(raw: string): boolean {
  const unmapped = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  const ip = isIP(unmapped) === 4 ? unmapped : raw;
  const family = isIP(ip);
  if (family === 0) return false;
  return !NON_PUBLIC.check(ip, family === 4 ? "ipv4" : "ipv6");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/classify.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/network-guard/classify.ts apps/web/src/lib/network-guard/classify.test.ts
git commit -m "feat(web): classify ipapi.is lookups into VPN/proxy/tor/datacenter verdicts"
```

---

### Task 3: Cached provider lookup

**Files:**
- Create: `apps/web/src/lib/network-guard/lookup.ts`
- Test: `apps/web/src/lib/network-guard/lookup.test.ts`

**Interfaces:**
- Consumes: `classifyIpapi`, `isIpVerdict`, `IpVerdict` from `./classify`; `redis` from `@/lib/redis`.
- Produces:
  - `type LookupResult = IpVerdict | "unknown"`
  - `verdictCacheKey(ip: string): string`, which returns `` `vpn:ip:${ip}` ``
  - `lookupIp(ip: string, fetchImpl?: typeof fetch): Promise<LookupResult>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/network-guard/lookup.test.ts
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { redis } from "@/lib/redis";
import { lookupIp, verdictCacheKey } from "./lookup";

const IP = "203.0.113.41";

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

afterEach(async () => {
  await redis.del(verdictCacheKey(IP));
});

afterAll(async () => {
  await redis.quit();
});

describe("lookupIp", () => {
  it("asks ipapi.is about the exact address and caches the verdict for a day", async () => {
    const f = fakeFetch({ ip: IP, is_vpn: true, is_datacenter: true });
    expect(await lookupIp(IP, f as unknown as typeof fetch)).toBe("vpn");

    const url = f.mock.calls[0]![0];
    expect(url.hostname).toBe("api.ipapi.is");
    expect(url.searchParams.get("q")).toBe(IP);

    expect(await redis.get(verdictCacheKey(IP))).toBe("vpn");
    const ttl = await redis.ttl(verdictCacheKey(IP));
    expect(ttl).toBeGreaterThan(23 * 3600);
    expect(ttl).toBeLessThanOrEqual(24 * 3600);
  });

  it("serves a cached verdict without calling the provider", async () => {
    await redis.set(verdictCacheKey(IP), "clean", "EX", 60);
    const f = fakeFetch({});
    expect(await lookupIp(IP, f as unknown as typeof fetch)).toBe("clean");
    expect(f).not.toHaveBeenCalled();
  });

  it("returns unknown and remembers it for at most five minutes when the quota is spent", async () => {
    const f = fakeFetch({ error: "quota", error_code: "ERR_QUOTA_EXCEEDED" }, 429);
    expect(await lookupIp(IP, f as unknown as typeof fetch)).toBe("unknown");
    expect(await redis.get(verdictCacheKey(IP))).toBe("unknown");
    expect(await redis.ttl(verdictCacheKey(IP))).toBeLessThanOrEqual(300);
  });

  it("returns unknown when the provider is unreachable", async () => {
    const f = vi.fn<(input: URL) => Promise<Response>>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await lookupIp(IP, f as unknown as typeof fetch)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/lookup.test.ts`
Expected: FAIL. The module `./lookup` does not exist.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/network-guard/lookup.ts
import { redis } from "@/lib/redis";
import { classifyIpapi, isIpVerdict, type IpVerdict } from "./classify";

export type LookupResult = IpVerdict | "unknown";

const VERDICT_TTL_SEC = 24 * 3600;
/**
 * A failed lookup is remembered briefly, so an outage or spent quota costs one
 * slow call per IP per window instead of one per request.
 */
const UNKNOWN_TTL_SEC = 300;
const TIMEOUT_MS = 1500;

export function verdictCacheKey(ip: string): string {
  return `vpn:ip:${ip}`;
}

export async function lookupIp(
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LookupResult> {
  const key = verdictCacheKey(ip);
  const cached = await redis.get(key).catch(() => null);
  if (cached !== null && (cached === "unknown" || isIpVerdict(cached))) return cached;

  const url = new URL("https://api.ipapi.is/");
  url.searchParams.set("q", ip);
  const apiKey = process.env.IPAPI_KEY;
  if (apiKey) url.searchParams.set("key", apiKey);

  let verdict: IpVerdict | null = null;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) verdict = classifyIpapi(await res.json());
  } catch {
    verdict = null;
  }

  const result: LookupResult = verdict ?? "unknown";
  await redis
    .set(key, result, "EX", verdict ? VERDICT_TTL_SEC : UNKNOWN_TTL_SEC)
    .catch(() => {});
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/lookup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/network-guard/lookup.ts apps/web/src/lib/network-guard/lookup.test.ts
git commit -m "feat(web): Redis-cached ipapi.is lookup with 1.5s timeout and fail-open unknown"
```

---

### Task 4: `User.vpnExempt` + admin toggle

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `User`, after `liveAccess`)
- Create: `packages/db/prisma/migrations/20261006120000_user_vpn_exempt/migration.sql`
- Modify: `apps/web/src/app/admin/(console)/users/actions.ts`
- Modify: `apps/web/src/app/admin/(console)/users/[id]/page.tsx`

**Interfaces:**
- Produces: `User.vpnExempt: boolean`, default `false`. Task 5 reads it.

- [ ] **Step 1: Add the field to the schema**

In `packages/db/prisma/schema.prisma`, directly below the `liveAccess  Boolean @default(false)` line of `model User`, add:

```prisma
  // Lets one user through the VPN/proxy block (corporate VPN, false positive).
  // Set only from the admin Users panel; never by the user's own flow.
  vpnExempt          Boolean    @default(false)
```

- [ ] **Step 2: Hand-write the migration (do NOT run `migrate dev` against the shared DB)**

```sql
-- packages/db/prisma/migrations/20261006120000_user_vpn_exempt/migration.sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN "vpnExempt" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Apply to the local scratch DB and regenerate the client**

Run (from the worktree, whose `.env` points all three URLs at local Postgres):
```bash
pnpm --filter @asm/db exec dotenv -e ../../.env -- prisma migrate deploy
```
Expected: the printed `Datasource "db"` line shows `localhost:5433`, followed by `Applying migration 20261006120000_user_vpn_exempt` and then `All migrations have been successfully applied.`

```bash
pnpm db:generate
```
Expected: `Generated Prisma Client`.

- [ ] **Step 4: Admin action reads and audits the flag**

In `apps/web/src/app/admin/(console)/users/actions.ts`, inside `updateUserAction`:

Below `const liveAccess = String(formData.get("liveAccess") ?? "") === "true";` add:
```ts
  const vpnExempt = String(formData.get("vpnExempt") ?? "") === "true";
```

Replace the `before` query's `select` with:
```ts
    select: { role: true, kycStatus: true, liveAccess: true, vpnExempt: true, email: true },
```

Replace the change-detection `if (...)` line with:
```ts
  if (
    before.role !== role ||
    before.kycStatus !== kycStatus ||
    before.liveAccess !== liveAccess ||
    before.vpnExempt !== vpnExempt
  ) {
```

In the `prisma.user.update` call, change `data` to:
```ts
      data: { role: role as Role, kycStatus: kycStatus as KycStatus, liveAccess, vpnExempt },
```

In the `auditLog.create` call, change `before`/`after` to:
```ts
        before: {
          role: before.role,
          kycStatus: before.kycStatus,
          liveAccess: before.liveAccess,
          vpnExempt: before.vpnExempt,
        },
        after: { role, kycStatus, liveAccess, vpnExempt },
```

In the `logger.info` object, add `vpnExempt` after `liveAccess`.

- [ ] **Step 5: Admin page shows and edits the flag**

In `apps/web/src/app/admin/(console)/users/[id]/page.tsx`, directly after the `liveAccess` pill block (`{user.liveAccess ? (…) : (…)}`) add:
```tsx
                {user.vpnExempt ? (
                  <span className="admin-pill admin-pill--pos">VPN exempt</span>
                ) : null}
```

Directly after the closing `</div>` of the `liveAccess` `admin-field`, add:
```tsx
              <div className="admin-field">
                <label htmlFor="vpnExempt">VPN / proxy block</label>
                <select
                  id="vpnExempt"
                  name="vpnExempt"
                  className="admin-select"
                  defaultValue={String(user.vpnExempt)}
                >
                  <option value="false">Enforced — VPN users are blocked</option>
                  <option value="true">Exempt — allowed through a VPN</option>
                </select>
              </div>
```

The page loads `user` with `findUnique(... include ...)`, so every scalar field (including `vpnExempt`) is already present.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @asm/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261006120000_user_vpn_exempt apps/web/src/app/admin/\(console\)/users/actions.ts "apps/web/src/app/admin/(console)/users/[id]/page.tsx"
git commit -m "feat(db,web): per-user vpnExempt flag with audited admin toggle"
```

---

### Task 5: The guard

**Files:**
- Create: `apps/web/src/lib/network-guard/guard.ts`
- Test: `apps/web/src/lib/network-guard/guard.test.ts`

**Interfaces:**
- Consumes: `BLOCKED_VERDICTS`, `isPublicIp` (Task 2); `lookupIp`, `LookupResult` (Task 3); `User.vpnExempt` (Task 4).
- Produces:
  - `type GuardMode = "off" | "log" | "block"`; `guardMode(): GuardMode`
  - `interface GuardDeps { mode(): GuardMode; lookup(ip: string): Promise<LookupResult>; isExempt(userId: string): Promise<boolean> }`
  - `interface NetworkCheck { readonly blocked: boolean; readonly verdict: LookupResult | "skipped" }`
  - `checkNetwork(input: { ip: string; route: string; log: Logger; userId?: string }, deps?: GuardDeps): Promise<NetworkCheck>`
  - `VPN_BLOCKED_MESSAGE: string`; `vpnBlockedResponse(): NextResponse` (403, `{ error, code: "vpn_blocked" }`)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/network-guard/guard.test.ts
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@asm/logger";
import { VPN_BLOCKED_MESSAGE, checkNetwork, vpnBlockedResponse, type GuardMode } from "./guard";
import type { LookupResult } from "./lookup";

const PUBLIC_IP = "203.0.113.7";

function setup(mode: GuardMode, verdict: LookupResult, exempt = false) {
  const lookup = vi.fn<(ip: string) => Promise<LookupResult>>(async () => verdict);
  const isExempt = vi.fn<(userId: string) => Promise<boolean>>(async () => exempt);
  const log = { warn: vi.fn(), info: vi.fn() };
  const run = (ip = PUBLIC_IP, userId?: string) =>
    checkNetwork(
      { ip, route: "test", log: log as unknown as Logger, userId },
      { mode: () => mode, lookup, isExempt },
    );
  return { lookup, isExempt, log, run };
}

describe("checkNetwork", () => {
  it("does nothing when the mode is off", async () => {
    const t = setup("off", "vpn");
    expect(await t.run()).toEqual({ blocked: false, verdict: "skipped" });
    expect(t.lookup).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "local", "10.0.0.4"])("skips non-public address %s without a lookup", async (ip) => {
    const t = setup("block", "vpn");
    expect(await t.run(ip)).toEqual({ blocked: false, verdict: "skipped" });
    expect(t.lookup).not.toHaveBeenCalled();
  });

  it("allows a clean address", async () => {
    expect(await setup("block", "clean").run()).toEqual({ blocked: false, verdict: "clean" });
  });

  it("allows a privacy relay such as iCloud Private Relay", async () => {
    expect(await setup("block", "relay").run()).toEqual({ blocked: false, verdict: "relay" });
  });

  it.each(["vpn", "proxy", "tor", "datacenter"] as const)("blocks %s in block mode and logs it", async (v) => {
    const t = setup("block", v);
    expect(await t.run()).toEqual({ blocked: true, verdict: v });
    expect(t.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "security.vpn_blocked", verdict: v, ip: PUBLIC_IP }),
      expect.any(String),
    );
  });

  it("only logs a VPN in log mode", async () => {
    const t = setup("log", "vpn");
    expect(await t.run()).toEqual({ blocked: false, verdict: "vpn" });
    expect(t.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "security.vpn_detected" }),
      expect.any(String),
    );
  });

  it("fails open when the provider couldn't answer", async () => {
    const t = setup("block", "unknown");
    expect(await t.run()).toEqual({ blocked: false, verdict: "unknown" });
    expect(t.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "security.vpn_check_unavailable" }),
      expect.any(String),
    );
  });

  it("lets an exempt user through a VPN", async () => {
    const t = setup("block", "vpn", true);
    expect(await t.run(PUBLIC_IP, "user-1")).toEqual({ blocked: false, verdict: "vpn" });
    expect(t.isExempt).toHaveBeenCalledWith("user-1");
  });

  it("never queries exemption for a clean address", async () => {
    const t = setup("block", "clean");
    await t.run(PUBLIC_IP, "user-1");
    expect(t.isExempt).not.toHaveBeenCalled();
  });
});

describe("vpnBlockedResponse", () => {
  it("is a 403 with a stable machine-readable code", async () => {
    const res = vpnBlockedResponse();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: VPN_BLOCKED_MESSAGE, code: "vpn_blocked" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/guard.test.ts`
Expected: FAIL. The module `./guard` does not exist.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/network-guard/guard.ts
import { NextResponse } from "next/server";
import { prisma } from "@asm/db";
import type { Logger } from "@asm/logger";
import { BLOCKED_VERDICTS, isPublicIp } from "./classify";
import { lookupIp, type LookupResult } from "./lookup";

export type GuardMode = "off" | "log" | "block";

/** Off unless explicitly configured, so dev, tests and CI never call the provider. */
export function guardMode(): GuardMode {
  const v = process.env.VPN_BLOCK_MODE;
  return v === "log" || v === "block" ? v : "off";
}

export interface NetworkCheck {
  readonly blocked: boolean;
  readonly verdict: LookupResult | "skipped";
}

export interface GuardDeps {
  mode(): GuardMode;
  lookup(ip: string): Promise<LookupResult>;
  isExempt(userId: string): Promise<boolean>;
}

const defaultDeps: GuardDeps = {
  mode: guardMode,
  lookup: (ip) => lookupIp(ip),
  isExempt: async (userId) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { vpnExempt: true } }))
      ?.vpnExempt ?? false,
};

/**
 * Decides whether this request's network may use the platform. Fails OPEN: a
 * provider outage or spent quota lets traffic through (logged), because
 * locking every trader out is worse than missing a VPN for five minutes.
 * Exemption is only read for a flagged address, so clean traffic costs no
 * extra DB query.
 */
export async function checkNetwork(
  input: { ip: string; route: string; log: Logger; userId?: string },
  deps: GuardDeps = defaultDeps,
): Promise<NetworkCheck> {
  const mode = deps.mode();
  if (mode === "off" || !isPublicIp(input.ip)) return { blocked: false, verdict: "skipped" };

  const verdict = await deps.lookup(input.ip);
  const fields = { ip: input.ip, verdict, route: input.route, userId: input.userId };

  if (verdict === "unknown") {
    input.log.warn({ evt: "security.vpn_check_unavailable", ...fields }, "vpn check unavailable, allowing");
    return { blocked: false, verdict };
  }
  if (!BLOCKED_VERDICTS.has(verdict)) return { blocked: false, verdict };

  if (input.userId && (await deps.isExempt(input.userId))) {
    input.log.info({ evt: "security.vpn_exempt", ...fields }, "vpn allowed for exempt user");
    return { blocked: false, verdict };
  }
  if (mode === "log") {
    input.log.warn({ evt: "security.vpn_detected", ...fields }, "vpn detected (log mode, allowed)");
    return { blocked: false, verdict };
  }
  input.log.warn({ evt: "security.vpn_blocked", ...fields }, "vpn blocked");
  return { blocked: true, verdict };
}

export const VPN_BLOCKED_MESSAGE = "VPN, proxy or Tor detected. Turn it off and try again.";

export function vpnBlockedResponse(): NextResponse {
  return NextResponse.json({ error: VPN_BLOCKED_MESSAGE, code: "vpn_blocked" }, { status: 403 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/network-guard/guard.ts apps/web/src/lib/network-guard/guard.test.ts
git commit -m "feat(web): checkNetwork guard with off/log/block modes, fail-open and exemptions"
```

---

### Task 6: Guard register and login

**Files:**
- Modify: `apps/web/src/app/api/auth/register/route.ts`
- Modify: `apps/web/src/app/api/auth/login/route.ts`
- Test: `apps/web/src/lib/network-guard/routes.test.ts` (create)

**Interfaces:**
- Consumes: `checkNetwork`, `vpnBlockedResponse` (Task 5); `verdictCacheKey` (Task 3).
- Produces: `routes.test.ts` with helpers `post()`, `randomPublicIp()`, `VPN_IP`, `CLEAN_IP`, `userId`, `email`, `PASSWORD`. Task 7 appends to this file.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/network-guard/routes.test.ts
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";
import { hashPassword } from "@/lib/password";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE } from "@/lib/session";
import { verdictCacheKey } from "./lookup";

// Fresh documentation-range IPv6 addresses per run, so per-IP rate-limit keys
// never carry over between runs. The verdict cache is seeded, so nothing here
// ever reaches ipapi.is.
function randomPublicIp(): string {
  return `2001:db8::${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}`;
}
const VPN_IP = randomPublicIp();
const CLEAN_IP = randomPublicIp();
const PASSWORD = "correct-horse-battery-staple";
const NEW_EMAIL_PREFIX = `vpn-guard-new-${randomUUID()}`;

let previousMode: string | undefined;
let userId = "";
let email = "";

beforeAll(async () => {
  previousMode = process.env.VPN_BLOCK_MODE;
  process.env.VPN_BLOCK_MODE = "block";
  await redis.set(verdictCacheKey(VPN_IP), "vpn", "EX", 600);
  await redis.set(verdictCacheKey(CLEAN_IP), "clean", "EX", 600);
  email = `vpn-guard-${randomUUID()}@test.local`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(PASSWORD) },
  });
  userId = user.id;
});

afterAll(async () => {
  if (previousMode === undefined) delete process.env.VPN_BLOCK_MODE;
  else process.env.VPN_BLOCK_MODE = previousMode;
  await redis.del(verdictCacheKey(VPN_IP), verdictCacheKey(CLEAN_IP));
  await prisma.user.deleteMany({
    where: { OR: [{ id: userId }, { email: { startsWith: NEW_EMAIL_PREFIX } }] },
  });
  await prisma.$disconnect();
  await redis.quit();
});

function post(path: string, ip: string, body: unknown, session?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": ip };
  if (session) headers.cookie = `${SESSION_COOKIE}=${session}`;
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("VPN guard on auth routes", () => {
  it("refuses to create an account from a VPN", async () => {
    const newEmail = `${NEW_EMAIL_PREFIX}-a@test.local`;
    const res = await register(post("/api/auth/register", VPN_IP, { email: newEmail, password: PASSWORD }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("vpn_blocked");
    expect(await prisma.user.findUnique({ where: { email: newEmail } })).toBeNull();
  });

  it("still registers from a clean network", async () => {
    const newEmail = `${NEW_EMAIL_PREFIX}-b@test.local`;
    const res = await register(post("/api/auth/register", CLEAN_IP, { email: newEmail, password: PASSWORD }));
    expect(res.status).toBe(201);
  });

  it("refuses a correct login from a VPN and issues no session", async () => {
    const res = await login(post("/api/auth/login", VPN_IP, { email, password: PASSWORD }));
    expect(res.status).toBe(403);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("lets an exempt user log in through a VPN", async () => {
    await prisma.user.update({ where: { id: userId }, data: { vpnExempt: true } });
    try {
      const res = await login(post("/api/auth/login", VPN_IP, { email, password: PASSWORD }));
      expect(res.status).toBe(200);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { vpnExempt: false } });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/routes.test.ts`
Expected: FAIL. "refuses to create an account from a VPN" gets 201 and "refuses a correct login" gets 200.

- [ ] **Step 3: Guard register (before any user is created)**

In `apps/web/src/app/api/auth/register/route.ts`, add the import:
```ts
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
```
Directly after the rate-limit `if (!okIp) { … }` block, and before `const body: unknown = …`, insert:
```ts
  if ((await checkNetwork({ ip: ctx.ip, route: "register", log })).blocked) {
    return vpnBlockedResponse();
  }
```

- [ ] **Step 4: Guard login (after the password check, so exemptions apply)**

In `apps/web/src/app/api/auth/login/route.ts`, add the same import. Directly after the `if (!(await verifyPassword(...))) { … }` block, and before `const token = await createSession(...)`, insert:
```ts
  if ((await checkNetwork({ ip: ctx.ip, route: "login", log, userId: user.id })).blocked) {
    return vpnBlockedResponse();
  }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/routes.test.ts` → PASS.
Run: `pnpm --filter @asm/web test` → all PASS. Existing tests leave `VPN_BLOCK_MODE` unset, so the guard is off for them.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/auth/register/route.ts apps/web/src/app/api/auth/login/route.ts apps/web/src/lib/network-guard/routes.test.ts
git commit -m "feat(web): block VPN/proxy networks at register and login"
```

---

### Task 7: Guard the session routes (WS ticket, trades, deposits, withdrawals)

**Files:**
- Modify: `apps/web/src/app/api/auth/ws-ticket/route.ts`
- Modify: `apps/web/src/app/api/trades/route.ts` (`POST` only)
- Modify: `apps/web/src/app/api/deposits/route.ts` (`POST` only)
- Modify: `apps/web/src/app/api/withdrawals/route.ts` (`POST` only)
- Modify: `apps/web/src/components/chart/useEngineSocket.ts`
- Test: `apps/web/src/lib/network-guard/routes.test.ts` (append)

**Interfaces:**
- Consumes: everything from `routes.test.ts` (Task 6); `checkNetwork`, `vpnBlockedResponse`.

- [ ] **Step 1: Append the failing tests**

Add these imports to the top of `routes.test.ts`, next to the existing ones:
```ts
import { POST as deposit } from "@/app/api/deposits/route";
import { POST as openTrade } from "@/app/api/trades/route";
import { POST as withdraw } from "@/app/api/withdrawals/route";
import { POST as wsTicket } from "@/app/api/auth/ws-ticket/route";
import { createSession } from "@/lib/session";
```
(`SESSION_COOKIE` is already imported from `@/lib/session`. Merge `createSession` into that import line.)

Append at the end of the file:
```ts
describe("VPN guard on signed-in routes", () => {
  let session = "";

  beforeAll(async () => {
    session = await createSession(userId, {});
  });

  it.each([
    ["ws-ticket", "/api/auth/ws-ticket", wsTicket],
    ["trades", "/api/trades", openTrade],
    ["deposits", "/api/deposits", deposit],
    ["withdrawals", "/api/withdrawals", withdraw],
  ] as const)("%s refuses a signed-in user on a VPN before touching the body", async (_name, path, handler) => {
    const res = await handler(post(path, VPN_IP, {}, session));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("vpn_blocked");
  });

  it("still issues a WS ticket on a clean network", async () => {
    const res = await wsTicket(post("/api/auth/ws-ticket", CLEAN_IP, {}, session));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/routes.test.ts`
Expected: FAIL. ws-ticket returns 200, and trades/deposits/withdrawals return 400 (bad body) instead of 403.

- [ ] **Step 3: Insert the guard in all four routes**

Add to each of the four route files:
```ts
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
```

`apps/web/src/app/api/auth/ws-ticket/route.ts`: directly after `if (!session) { … }`, insert:
```ts
  if ((await checkNetwork({ ip: ctx.ip, route: "ws_ticket", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }
```

`apps/web/src/app/api/trades/route.ts`, in `POST`: directly after `if (!session) { … }`, insert:
```ts
  if ((await checkNetwork({ ip: ctx.ip, route: "trades", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }
```

`apps/web/src/app/api/deposits/route.ts`, in `POST`: directly after `if (!session) { … }`, insert:
```ts
  if ((await checkNetwork({ ip: ctx.ip, route: "deposits", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }
```

`apps/web/src/app/api/withdrawals/route.ts`, in `POST`: directly after `if (!session) { … }`, insert:
```ts
  if ((await checkNetwork({ ip: ctx.ip, route: "withdrawals", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }
```

(Each `POST` already defines `const ctx = requestContext(req); const log = childLogger(ctx.cid);` above the session check.)

- [ ] **Step 4: Send the socket to the block page on a 403**

In `apps/web/src/components/chart/useEngineSocket.ts`, in `fetchTicket()`, directly after the `if (res?.status === 401) …` line, add:
```ts
  // The network guard refused this connection (VPN/proxy). Retrying can't
  // succeed until the user changes network, so show them why instead.
  if (res?.status === 403) {
    window.location.assign("/network-blocked");
    return { kind: "unauthorised" };
  }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @asm/web test -- src/lib/network-guard/routes.test.ts` → PASS.
Run: `pnpm --filter @asm/web test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/auth/ws-ticket/route.ts apps/web/src/app/api/trades/route.ts apps/web/src/app/api/deposits/route.ts apps/web/src/app/api/withdrawals/route.ts apps/web/src/components/chart/useEngineSocket.ts apps/web/src/lib/network-guard/routes.test.ts
git commit -m "feat(web): block VPN/proxy networks on WS ticket, trades, deposits and withdrawals"
```

---

### Task 8: Platform layout redirect + `/network-blocked` page

**Files:**
- Modify: `apps/web/src/app/(platform)/layout.tsx`
- Create: `apps/web/src/app/network-blocked/page.tsx`

**Interfaces:**
- Consumes: `checkNetwork`, `VPN_BLOCKED_MESSAGE` (Task 5); `clientIpFrom` (Task 1).

- [ ] **Step 1: Guard the layout**

In `apps/web/src/app/(platform)/layout.tsx`:

Change `import { cookies } from "next/headers";` to:
```ts
import { cookies, headers } from "next/headers";
```
Add imports:
```ts
import { childLogger, newCorrelationId } from "@asm/logger";
import { checkNetwork } from "@/lib/network-guard/guard";
import { clientIpFrom } from "@/lib/request-context";
```
Directly after `if (!session) redirect("/login");`, insert:
```ts
  const network = await checkNetwork({
    ip: clientIpFrom(await headers()),
    route: "platform_layout",
    log: childLogger(newCorrelationId()),
    userId: session.userId,
  });
  if (network.blocked) redirect("/network-blocked");
```

- [ ] **Step 2: Create the block page**

```tsx
// apps/web/src/app/network-blocked/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { VPN_BLOCKED_MESSAGE } from "@/lib/network-guard/guard";

export const metadata: Metadata = {
  title: "Turn off your VPN",
  robots: { index: false, follow: false },
};

export default function NetworkBlockedPage() {
  return (
    <AuthShell
      eyebrow="Connection blocked"
      title="Turn off your VPN."
      subtitle={VPN_BLOCKED_MESSAGE}
      imageCaption="Every tick settles on a real ledger."
      footer={
        <>Using a work VPN you can&apos;t switch off? Contact support from a normal connection and we can allow your account.</>
      }
    >
      <div className="flex flex-col gap-4 text-sm text-ink-2">
        <p>
          To protect accounts and keep bonuses fair, ASM doesn&apos;t accept connections from VPNs,
          proxies, Tor or cloud servers.
        </p>
        <p>Switch off the VPN or proxy app, then press retry.</p>
        <Link
          href="/trade"
          className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-brand text-sm font-black text-brand-ink transition hover:brightness-110"
        >
          Retry <span aria-hidden>→</span>
        </Link>
      </div>
    </AuthShell>
  );
}
```

The footer has no link to `/support` on purpose: that route is inside `(platform)`, so a blocked user would be sent straight back here. `text-ink-2` is the same muted token `AuthShell` uses for its subtitle.

- [ ] **Step 3: Typecheck and build**

Run: `pnpm --filter @asm/web exec tsc --noEmit` → no errors.
Run: `pnpm --filter @asm/web build` → succeeds, and `/network-blocked` appears in the route list.

- [ ] **Step 4: Verify in the browser**

Start a local verification instance (isolated DB, free port, per the `local-browser-verification` memory) with `VPN_BLOCK_MODE=block`. Seed a verdict for a fake public IP: `redis-cli -p <port> SET vpn:ip:203.0.113.99 vpn EX 600`. Locally nothing sets `X-Real-IP`, so send it with curl:
```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -H "x-real-ip: 203.0.113.99" -H "cookie: <session cookie of a signed-in test user>" http://localhost:<port>/trade
```
Expected: `307 http://localhost:<port>/network-blocked`. Then open `/network-blocked` in the browser pane and screenshot it in light and dark themes, plus at mobile width.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(platform)/layout.tsx" apps/web/src/app/network-blocked/page.tsx
git commit -m "feat(web): redirect VPN/proxy networks from the platform to /network-blocked"
```

---

### Task 9: Env docs + production rollout (log → block)

**Files:**
- Modify: `.env.example`, `.env.production.example`

- [ ] **Step 1: Document the env vars**

Append to both `.env.example` and `.env.production.example`:
```bash
# --- VPN / proxy blocking (apps/web/src/lib/network-guard) ---
# off   = never checks (default; dev/CI)
# log   = checks and logs security.vpn_detected, but lets everyone in
# block = refuses VPN/proxy/Tor/datacenter networks with a 403 / redirect
VPN_BLOCK_MODE=off
# ipapi.is key: free account = 1,000 lookups/day; credits are $1 per 30k.
# Empty works on ipapi's small anonymous budget, which is not enough for prod.
IPAPI_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example .env.production.example
git commit -m "docs(env): document VPN_BLOCK_MODE and IPAPI_KEY"
```

- [ ] **Step 3: Production env BEFORE merging (memory `vps-access`: env read at compose start, not mid-deploy)**

The user creates a free ipapi.is account and copies the API key. An agent must not create the account. Then append both vars idempotently:
```bash
ssh -o ConnectTimeout=10 -o IdentitiesOnly=yes -i ~/.ssh/asmtrader_ci deploy@187.52.118.185 'cd /opt/asmtrader && sed -i "/^VPN_BLOCK_MODE=/d;/^IPAPI_KEY=/d" .env.production && sed -i "\$aVPN_BLOCK_MODE=log" .env.production && sed -i "\$aIPAPI_KEY=<key>" .env.production'
```

- [ ] **Step 4: Deploy**

Merge to `main` (the user clicks Merge). GitHub Actions runs `prisma migrate deploy`, which adds `vpnExempt`, and restarts web/engine. Verify:
```bash
ssh -o ConnectTimeout=10 -o IdentitiesOnly=yes -i ~/.ssh/asmtrader_ci deploy@187.52.118.185 'cd /opt/asmtrader/deploy && docker compose --env-file ../.env.production exec -T web printenv VPN_BLOCK_MODE'
```
Expected: `log`.

- [ ] **Step 5: Measure for about 7 days in log mode**

```bash
ssh -o ConnectTimeout=10 -o IdentitiesOnly=yes -i ~/.ssh/asmtrader_ci deploy@187.52.118.185 'cd /opt/asmtrader/deploy && docker compose --env-file ../.env.production logs --since 168h web | grep -oE "security\.vpn_(detected|check_unavailable)[^}]*" | grep -oE "\"verdict\":\"[a-z]+\"" | sort | uniq -c'
```
Look at:
- How many distinct `userId`s were `vpn_detected`. Spot-check a few in the admin panel: are they the multi-account / bonus-abuse patterns, or ordinary customers?
- The `datacenter` count specifically. If real Indian mobile users show up as `datacenter`, move `"datacenter"` out of `BLOCKED_VERDICTS` (a one-line change in `classify.ts` plus its test).
- `vpn_check_unavailable` volume. If it's frequent, the daily quota is too small: buy ipapi.is credits.

- [ ] **Step 6: Flip to block**

```bash
ssh -o ConnectTimeout=10 -o IdentitiesOnly=yes -i ~/.ssh/asmtrader_ci deploy@187.52.118.185 'cd /opt/asmtrader && sed -i "s/^VPN_BLOCK_MODE=.*/VPN_BLOCK_MODE=block/" .env.production && cd deploy && docker compose --env-file ../.env.production up -d --force-recreate --no-deps web'
```
Then check from a phone on a commercial VPN that `/trade` lands on `/network-blocked`, and that login shows the block message. Turn the VPN off and confirm both work.

Rollback: set `VPN_BLOCK_MODE=off` with the same command. No deploy is needed.

---

## Out of scope (possible follow-ups, not in this plan)

- **nginx-level blocking** with a static VPN CIDR list (e.g. X4BNet `lists_vpn`). It's cheaper per request but blunt: no exemptions, no UI, and the list needs a refresh cron. Consider it only if API volume makes per-IP lookups expensive.
- **Feeding the verdict into the fraud detector** (e.g. a `VPN_SIGNUP` `FraudFlagKind`) for accounts created before this shipped.
- **Client-side signals** (browser timezone ≠ IP country, WebRTC leaks). These are noisy, easy to fake, and need CSP changes.
- **Residential proxies** are designed to look like home connections. No IP-reputation check catches all of them, so the deposit-method and device signals in `fraud.ts` remain the backstop.
