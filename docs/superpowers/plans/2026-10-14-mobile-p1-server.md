# Mobile P1 — Server for the App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the native app use the existing backend: bearer-token sessions, native Google sign-in, the missing `/api/v1` JSON reads, stable error codes, a language preference and a shared `@asm/client-core` package — with no change to money rules or the website.

**Architecture:** Sessions stay in the `Session` table; a new `client` column picks the TTL (WEB 7d, APP 30d). A `getSession(req)` helper reads `Authorization: Bearer` or the cookie and replaces the cookie-only reads in all 18 API routes. New `/api/v1/*` routes reuse loader functions extracted from the RSC pages so web and app read the same code. Response shapes are zod schemas in `@asm/contracts`.

**Tech Stack:** Next.js 16 route handlers (`apps/web`), Prisma 7 (`packages/db`), zod 4 (`packages/contracts`), vitest 5 against the shared Postgres test DB (`fileParallelism: false`), Redis, `jose` (new) for Google JWKS verification.

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-p1-server-design.md`

## Global Constraints

- Money rules (stake limits, KYC gate, withdrawal limits, bonus, fraud status) are not changed anywhere in this plan.
- Migrations are hand-written SQL. Never run `prisma format` or `prisma migrate dev` against the shared DB; apply with `prisma migrate deploy`.
- WEB session TTL stays 7 days with the existing 6-day refresh threshold. APP sessions: TTL 30 days, refresh when < 29 days remain.
- App requests are identified by header `X-Client: app/<major>.<minor>.<patch>`; device name by `X-Device-Name` (trimmed, max 80 chars).
- Every JSON error the app depends on carries `code`: `maintenance` (503), `vpn_blocked` (403), `rate_limited` (429), `unauthenticated` (401), `upgrade_required` (426).
- All `/api/v1/*` responses set `Cache-Control: no-store`.
- Locales: `"en" | "hi"`, default `"en"`.
- Tests run serially against the shared DB; every test that creates rows deletes them in `afterAll`; every test that sets `process.env` restores it in `afterEach`.
- `apps/web/AGENTS.md`: this Next.js version has breaking changes — check `node_modules/next/dist/docs/` before using an unfamiliar API.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (omitted below for brevity — add it to every commit).

## File Map

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` | `SessionClient` enum, `Session.client/deviceName`, `User.locale` |
| `packages/db/prisma/migrations/20261015090000_mobile_sessions_locale/migration.sql` | hand-written migration |
| `packages/db/src/repositories/deposit.ts`, `withdrawal.ts` | optional `before` cursor on the `list*ForActor` functions |
| `packages/db/src/repositories/profile.ts` | `loadProfile` returns `locale`; `setLocale()` |
| `apps/web/src/lib/session-cookie.ts` | APP TTL constants |
| `apps/web/src/lib/session.ts` | per-client TTL in `createSession` / `readSession` |
| `apps/web/src/lib/app-client.ts` | dependency-free header helpers + version compare (used by proxy too) |
| `apps/web/src/lib/request-session.ts` | `sessionTokenFrom`, `getSession`, `unauthenticated`, `rateLimited`, `noStoreJson` |
| `apps/web/src/lib/google-account.ts` | shared Google find-or-create + provisioning |
| `apps/web/src/lib/google-native.ts` | verify a native Google ID token with JWKS |
| `apps/web/src/lib/platform-bootstrap.ts` | data the platform layout and `/api/v1/bootstrap` share |
| `apps/web/src/lib/deposit-config.ts` | data the deposit page and `/api/v1/deposit-config` share |
| `apps/web/src/lib/checkout-view.ts` | data the checkout page and `/api/v1/checkout/:token` share |
| `apps/web/src/lib/withdrawal-prefill.ts` | `lastPayoutsFrom` + loader shared with the withdrawal page |
| `apps/web/src/lib/app-config.ts` | env → app config |
| `apps/web/src/app/api/v1/**/route.ts` | new routes |
| `packages/contracts/src/app.ts` | response schemas for every `/api/v1` route |
| `packages/client-core/**` | shared pure logic moved from `apps/web` |

---

### Task 1: Schema + migration for session client, device name and locale

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Session`, model `User`, new enum)
- Create: `packages/db/prisma/migrations/20261015090000_mobile_sessions_locale/migration.sql`

**Interfaces:**
- Produces: Prisma fields `Session.client: "WEB" | "APP"` (default `WEB`), `Session.deviceName: string | null`, `User.locale: string` (default `"en"`).

- [ ] **Step 1: Edit the schema by hand (do not run `prisma format`)**

Add after `enum KycStatus { … }`:

```prisma
/// Which kind of client a session was issued to; picks its lifetime.
enum SessionClient {
  WEB
  APP
}
```

In `model Session`, after `userAgent  String?` add:

```prisma
  client     SessionClient @default(WEB)
  deviceName String?
```

In `model User`, after `googleSub          String?    @unique` add:

```prisma
  // UI + push language: "en" | "hi" (validated by zod, not a DB enum).
  locale             String     @default("en")
```

- [ ] **Step 2: Write the migration SQL**

`packages/db/prisma/migrations/20261015090000_mobile_sessions_locale/migration.sql`:

```sql
-- Mobile app: sessions remember which client they were issued to (the app
-- gets a 30-day sliding session, the website keeps 7 days), the device name
-- for a future devices list, and users get a UI/push language.

CREATE TYPE "SessionClient" AS ENUM ('WEB', 'APP');

ALTER TABLE "Session"
  ADD COLUMN "client" "SessionClient" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "deviceName" TEXT;

ALTER TABLE "User"
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
```

- [ ] **Step 3: Apply to the local DB and regenerate the client**

Run:
```bash
cd packages/db && pnpm exec dotenv -e ../../.env -- prisma migrate deploy && pnpm generate
```
Expected: `1 migration found … applied`, then `Generated Prisma Client`.

- [ ] **Step 4: Confirm only known drift remains**

Run:
```bash
cd packages/db && pnpm exec dotenv -e ../../.env -- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```
Expected: only the pre-existing drift (`Asset.garchOmega` default, `FraudFlag.linkedUserIds` default, `HouseDay` timestamps). Nothing mentioning `Session` or `locale`.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @asm/db exec tsc --noEmit` → no errors.

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261015090000_mobile_sessions_locale
git commit -m "feat(db): session client + device name, user locale"
```

---

### Task 2: Per-client session lifetime

**Files:**
- Modify: `apps/web/src/lib/session-cookie.ts`
- Modify: `apps/web/src/lib/session.ts`
- Test: `apps/web/src/lib/session.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `type SessionClient = "WEB" | "APP"` (exported from `session.ts`)
  - `createSession(userId: string, meta: { ip?: string; userAgent?: string; client?: SessionClient; deviceName?: string | null }): Promise<string>`
  - `readSession(token)` unchanged signature; `SessionReadResult` gains `client: SessionClient`.
  - Constants `APP_SESSION_TTL_MS`, `APP_SESSION_REFRESH_THRESHOLD_MS` in `session-cookie.ts`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/session.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { createSession, readSession } from "./session";
import { APP_SESSION_TTL_MS, SESSION_TTL_MS } from "./session-cookie";

const DAY = 24 * 60 * 60 * 1000;
let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `session-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

async function rowFor(token: string) {
  const { createHash } = await import("node:crypto");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return prisma.session.findUniqueOrThrow({ where: { tokenHash } });
}

describe("createSession", () => {
  it("gives a web session the 7-day lifetime by default", async () => {
    const token = await createSession(userId, {});
    const row = await rowFor(token);
    expect(row.client).toBe("WEB");
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(Math.abs(ttl - SESSION_TTL_MS)).toBeLessThan(5_000);
  });

  it("gives an app session the 30-day lifetime and records the device name", async () => {
    const token = await createSession(userId, { client: "APP", deviceName: "Redmi Note 13" });
    const row = await rowFor(token);
    expect(row.client).toBe("APP");
    expect(row.deviceName).toBe("Redmi Note 13");
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(Math.abs(ttl - APP_SESSION_TTL_MS)).toBeLessThan(5_000);
  });
});

describe("readSession", () => {
  it("reports the client of the session", async () => {
    const token = await createSession(userId, { client: "APP" });
    expect((await readSession(token))?.client).toBe("APP");
  });

  it("rolls an app session forward to 30 days once it has less than 29 days left", async () => {
    const token = await createSession(userId, { client: "APP" });
    const row = await rowFor(token);
    await prisma.session.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() + 28 * DAY) },
    });
    const result = await readSession(token);
    expect(result?.refreshed).toBe(true);
    const after = await rowFor(token);
    expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29.9 * DAY);
  });

  it("leaves an app session alone while it has more than 29 days left", async () => {
    const token = await createSession(userId, { client: "APP" });
    expect((await readSession(token))?.refreshed).toBe(false);
  });

  it("rejects and deletes an expired app session", async () => {
    const token = await createSession(userId, { client: "APP" });
    const row = await rowFor(token);
    await prisma.session.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await readSession(token)).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: row.id } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @asm/web exec vitest run src/lib/session.test.ts`
Expected: FAIL — `APP_SESSION_TTL_MS` is not exported / `client` missing.

- [ ] **Step 3: Add the constants**

In `apps/web/src/lib/session-cookie.ts`, after `SESSION_REFRESH_THRESHOLD_MS`:

```ts
/**
 * The native app keeps a longer sliding session (it is protected on the device
 * by the app lock). Rolled forward at most once a day.
 */
export const APP_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const APP_SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 29;
```

- [ ] **Step 4: Implement per-client lifetime in `session.ts`**

Replace the import block and `createSession`, and update `SessionReadResult` / `readSession`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma, type Role } from "@asm/db";
import {
  APP_SESSION_REFRESH_THRESHOLD_MS,
  APP_SESSION_TTL_MS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_REFRESH_THRESHOLD_MS,
  SESSION_TTL_MS,
} from "./session-cookie";

export { SESSION_COOKIE, SESSION_COOKIE_OPTIONS };

export type SessionClient = "WEB" | "APP";

const TTL_MS: Record<SessionClient, number> = { WEB: SESSION_TTL_MS, APP: APP_SESSION_TTL_MS };
const REFRESH_BELOW_MS: Record<SessionClient, number> = {
  WEB: SESSION_REFRESH_THRESHOLD_MS,
  APP: APP_SESSION_REFRESH_THRESHOLD_MS,
};

/** Tokens are stored hashed — a database leak must not yield usable sessions. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string; client?: SessionClient; deviceName?: string | null },
): Promise<string> {
  const client = meta.client ?? "WEB";
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TTL_MS[client]),
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      client,
      deviceName: meta.deviceName ?? null,
    },
  });
  return token;
}

export type SessionReadResult = {
  userId: string;
  role: Role;
  client: SessionClient;
  /** True when readSession extended the DB expiry; the caller should re-issue the cookie. */
  refreshed: boolean;
};
```

In `readSession`, replace the sliding-refresh block with:

```ts
  const client = session.client as SessionClient;
  let refreshed = false;
  const remainingMs = session.expiresAt.getTime() - now;
  if (remainingMs < REFRESH_BELOW_MS[client]) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: {
          expiresAt: new Date(now + TTL_MS[client]),
          lastUsedAt: new Date(now),
        },
      })
      .then(() => {
        refreshed = true;
      })
      .catch(() => {});
  }

  return { userId: session.user.id, role: session.user.role, client, refreshed };
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @asm/web exec vitest run src/lib/session.test.ts src/app/api/auth`
Expected: PASS (all session tests and existing auth route tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/session.ts apps/web/src/lib/session-cookie.ts apps/web/src/lib/session.test.ts
git commit -m "feat(web): per-client session lifetime (app 30d sliding)"
```

---

### Task 3: App-client header helpers and request-session

**Files:**
- Create: `apps/web/src/lib/app-client.ts`, `apps/web/src/lib/app-client.test.ts`
- Create: `apps/web/src/lib/request-session.ts`, `apps/web/src/lib/request-session.test.ts`

**Interfaces:**
- Produces (`app-client.ts`, no imports besides types — safe for `proxy.ts`):
  - `appVersionFrom(headers: Pick<Headers, "get">): string | null` — `"1.2.3"` from `X-Client: app/1.2.3`, else null
  - `isAppRequest(headers: Pick<Headers, "get">): boolean`
  - `deviceNameFrom(headers: Pick<Headers, "get">): string | null`
  - `compareVersions(a: string, b: string): -1 | 0 | 1`
- Produces (`request-session.ts`):
  - `sessionTokenFrom(req: Pick<NextRequest, "headers" | "cookies">): string | undefined`
  - `getSession(req: Pick<NextRequest, "headers" | "cookies">): Promise<SessionReadResult | null>`
  - `unauthenticated(): NextResponse` — 401 `{ error: "Not signed in.", code: "unauthenticated" }`
  - `rateLimited(message?: string): NextResponse` — 429 `{ error, code: "rate_limited" }`
  - `noStoreJson(body: unknown, init?: ResponseInit): NextResponse` — JSON with `Cache-Control: no-store`

- [ ] **Step 1: Write failing tests for `app-client.ts`**

```ts
import { describe, expect, it } from "vitest";
import { appVersionFrom, compareVersions, deviceNameFrom, isAppRequest } from "./app-client";

const h = (entries: Record<string, string>) => new Headers(entries);

describe("appVersionFrom", () => {
  it("reads the version from an app client header", () => {
    expect(appVersionFrom(h({ "x-client": "app/1.4.0" }))).toBe("1.4.0");
  });
  it("ignores missing or malformed headers", () => {
    expect(appVersionFrom(h({}))).toBeNull();
    expect(appVersionFrom(h({ "x-client": "web" }))).toBeNull();
    expect(appVersionFrom(h({ "x-client": "app/1.4" }))).toBeNull();
  });
});

describe("isAppRequest", () => {
  it("is true only for a well-formed app client header", () => {
    expect(isAppRequest(h({ "x-client": "app/0.1.0" }))).toBe(true);
    expect(isAppRequest(h({ "x-client": "app/" }))).toBe(false);
  });
});

describe("deviceNameFrom", () => {
  it("trims and caps the device name at 80 characters", () => {
    expect(deviceNameFrom(h({ "x-device-name": "  Pixel 8  " }))).toBe("Pixel 8");
    expect(deviceNameFrom(h({ "x-device-name": "x".repeat(200) }))?.length).toBe(80);
    expect(deviceNameFrom(h({}))).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares numerically, not as strings", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @asm/web exec vitest run src/lib/app-client.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `app-client.ts`**

```ts
/**
 * Headers the native app sends on every request. Dependency-free on purpose:
 * proxy.ts imports this, and it must stay cheap.
 *   X-Client: app/<major>.<minor>.<patch>
 *   X-Device-Name: <model>
 */
const APP_CLIENT = /^app\/(\d+\.\d+\.\d+)$/;

export function appVersionFrom(headers: Pick<Headers, "get">): string | null {
  const match = APP_CLIENT.exec(headers.get("x-client")?.trim() ?? "");
  return match?.[1] ?? null;
}

export function isAppRequest(headers: Pick<Headers, "get">): boolean {
  return appVersionFrom(headers) !== null;
}

export function deviceNameFrom(headers: Pick<Headers, "get">): string | null {
  const raw = headers.get("x-device-name")?.trim();
  return raw ? raw.slice(0, 80) : null;
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
```

- [ ] **Step 4: Write failing tests for `request-session.ts`**

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { SESSION_COOKIE, createSession } from "./session";
import { getSession, noStoreJson, sessionTokenFrom, unauthenticated } from "./request-session";

let userId = "";
let otherUserId = "";
let appToken = "";
let webToken = "";

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { email: `rs-a-${randomUUID()}@test.local`, passwordHash: "x" } }),
    prisma.user.create({ data: { email: `rs-b-${randomUUID()}@test.local`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  appToken = await createSession(userId, { client: "APP" });
  webToken = await createSession(otherUserId, {});
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.$disconnect();
});

function req(headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/anything", { headers });
}

describe("sessionTokenFrom", () => {
  it("prefers the bearer token over the cookie", () => {
    const r = req({ authorization: `Bearer ${appToken}`, cookie: `${SESSION_COOKIE}=${webToken}` });
    expect(sessionTokenFrom(r)).toBe(appToken);
  });
  it("does not fall back to the cookie when the bearer header is malformed", () => {
    const r = req({ authorization: "Bearer !!", cookie: `${SESSION_COOKIE}=${webToken}` });
    expect(sessionTokenFrom(r)).toBeUndefined();
  });
  it("uses the cookie when there is no authorization header", () => {
    expect(sessionTokenFrom(req({ cookie: `${SESSION_COOKIE}=${webToken}` }))).toBe(webToken);
  });
});

describe("getSession", () => {
  it("resolves a bearer token to its user", async () => {
    expect((await getSession(req({ authorization: `Bearer ${appToken}` })))?.userId).toBe(userId);
  });
  it("still resolves a cookie session", async () => {
    expect((await getSession(req({ cookie: `${SESSION_COOKIE}=${webToken}` })))?.userId).toBe(otherUserId);
  });
  it("returns null for an unknown bearer token", async () => {
    expect(await getSession(req({ authorization: `Bearer ${"a".repeat(43)}` }))).toBeNull();
  });
});

describe("responses", () => {
  it("unauthenticated carries the stable code", async () => {
    const res = unauthenticated();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in.", code: "unauthenticated" });
  });
  it("noStoreJson disables caching", () => {
    expect(noStoreJson({ ok: true }).headers.get("cache-control")).toBe("no-store");
  });
});
```

- [ ] **Step 5: Implement `request-session.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./session-cookie";
import { readSession, type SessionReadResult } from "./session";

/** Session tokens are 32 random bytes, base64url (43 chars). */
const BEARER = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/;

type SessionSource = Pick<NextRequest, "headers" | "cookies">;

/**
 * The app sends `Authorization: Bearer <token>`; the website sends the cookie.
 * A request that carries an Authorization header is judged on it alone — a
 * malformed or wrong bearer never falls back to a cookie riding along.
 */
export function sessionTokenFrom(req: SessionSource): string | undefined {
  const auth = req.headers.get("authorization");
  if (auth !== null) return BEARER.exec(auth.trim())?.[1];
  return req.cookies.get(SESSION_COOKIE)?.value;
}

export function getSession(req: SessionSource): Promise<SessionReadResult | null> {
  return readSession(sessionTokenFrom(req));
}

export function unauthenticated(): NextResponse {
  return NextResponse.json({ error: "Not signed in.", code: "unauthenticated" }, { status: 401 });
}

export function rateLimited(message = "Too many requests."): NextResponse {
  return NextResponse.json({ error: message, code: "rate_limited" }, { status: 429 });
}

export function noStoreJson(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @asm/web exec vitest run src/lib/app-client.test.ts src/lib/request-session.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/app-client.ts apps/web/src/lib/app-client.test.ts apps/web/src/lib/request-session.ts apps/web/src/lib/request-session.test.ts
git commit -m "feat(web): bearer-or-cookie session helper and app client headers"
```

---

### Task 4: Switch every user API route to `getSession`

**Files (modify all 18):**
`apps/web/src/app/api/account/{route,currency/route,demo-balance/route,kyc/documents/route,kyc/submit/route,two-factor/route}.ts`,
`apps/web/src/app/api/auth/{logout,ws-ticket}/route.ts`,
`apps/web/src/app/api/deposits/{route,[id]/claim/route,[id]/screenshot/route,[id]/status/route,[id]/usdt-claim/route}.ts`,
`apps/web/src/app/api/{leaderboard,support,trades,withdrawals}/route.ts`,
`apps/web/src/app/api/withdrawals/[id]/cancel/route.ts`
- Test: `apps/web/src/app/api/auth/ws-ticket/route.test.ts` (add case), `apps/web/src/app/api/account/route.test.ts` (create)

**Interfaces:**
- Consumes: `getSession`, `sessionTokenFrom`, `unauthenticated`, `rateLimited` (Task 3).

- [ ] **Step 1: Add failing bearer tests**

Append to `apps/web/src/app/api/auth/ws-ticket/route.test.ts` inside the `describe`:

```ts
  it("accepts the app's bearer token instead of the cookie", async () => {
    const headers = { "x-forwarded-for": randomUUID(), authorization: `Bearer ${sessionToken}` };
    const res = await POST(new NextRequest("http://localhost/api/auth/ws-ticket", { method: "POST", headers }));
    expect(res.status).toBe(200);
  });
```

Create `apps/web/src/app/api/account/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `account-${randomUUID()}@test.local`, passwordHash: "x", nickname: "Asha" },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("GET /api/account", () => {
  it("answers an app bearer token with the caller's profile", async () => {
    const res = await GET(new NextRequest("http://localhost/api/account", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { nickname: string | null } };
    expect(body.profile.nickname).toBe("Asha");
  });

  it("refuses a signed-out caller with the unauthenticated code", async () => {
    const res = await GET(new NextRequest("http://localhost/api/account"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("unauthenticated");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @asm/web exec vitest run src/app/api/auth/ws-ticket src/app/api/account/route.test.ts`
Expected: FAIL — bearer request gets 401; 401 body has no `code`.

- [ ] **Step 3: Apply the mechanical change to each route**

In every file listed (except logout, Step 4), make exactly these edits:

1. Replace `readSession(req.cookies.get(SESSION_COOKIE)?.value)` with `getSession(req)` (if the handler's parameter is named `request`, use `getSession(request)`).
2. Replace the 401 response that follows it — `NextResponse.json({ error: "Not signed in." }, { status: 401 })` — with `unauthenticated()`.
3. Replace `NextResponse.json({ error: "Too many requests." }, { status: 429 })` with `rateLimited()`. Where the 429 message differs, pass it: `rateLimited("<same message>")`.
4. Fix imports: remove `SESSION_COOKIE` / `readSession` from `@/lib/session` if no longer used; add
   `import { getSession, rateLimited, unauthenticated } from "@/lib/request-session";` (only the names used).

Example — `apps/web/src/app/api/account/route.ts` `GET` becomes:

```ts
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  return NextResponse.json({ profile: await loadProfile(session.userId) });
}
```

- [ ] **Step 4: Update logout to accept bearer tokens**

In `apps/web/src/app/api/auth/logout/route.ts`, replace
`const token = req.cookies.get(SESSION_COOKIE)?.value;` with
`const token = sessionTokenFrom(req);` and add
`import { sessionTokenFrom } from "@/lib/request-session";`.
Keep clearing the cookie on every response (harmless for the app, required for the web).

Add to `apps/web/src/app/api/auth/logout/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll } from "vitest";
import { prisma } from "@asm/db";
import { createSession, readSession } from "@/lib/session";

describe("POST /api/auth/logout with a bearer token", () => {
  let userId = "";
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("revokes the app session the token belongs to", async () => {
    const user = await prisma.user.create({ data: { email: `logout-${randomUUID()}@test.local`, passwordHash: "x" } });
    userId = user.id;
    const token = await createSession(userId, { client: "APP" });
    const res = await POST(post({ authorization: `Bearer ${token}` }));
    expect(res.status).toBe(204);
    expect(await readSession(token)).toBeNull();
  });
});
```

(Merge the new imports into the file's existing import block.)

- [ ] **Step 5: Verify nothing still reads the cookie directly**

Run: `grep -rn "readSession(req.cookies\|readSession(request.cookies" apps/web/src/app/api`
Expected: no output.

- [ ] **Step 6: Run the whole web suite**

Run: `pnpm --filter @asm/web test`
Expected: PASS. If an existing test asserted the old 401 body exactly (`{ error: "Not signed in." }`), update its expectation to include `code: "unauthenticated"` and keep the test name accurate.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @asm/web exec tsc --noEmit` → no errors.

```bash
git add apps/web/src/app/api
git commit -m "feat(web): user API routes accept app bearer tokens"
```

---

### Task 5: Token responses for app login and register

**Files:**
- Modify: `apps/web/src/app/api/auth/login/route.ts`, `apps/web/src/app/api/auth/register/route.ts`
- Test: `apps/web/src/app/api/auth/login/route.test.ts` (create), `apps/web/src/app/api/auth/register/route.test.ts` (add case)

**Interfaces:**
- Consumes: `isAppRequest`, `deviceNameFrom` (Task 3), `createSession` meta (Task 2).
- Produces: app login → `200 { token: string, userId: string }`, app register → `201 { token, userId }`; no `Set-Cookie` for app requests.

- [ ] **Step 1: Write the failing login tests**

`apps/web/src/app/api/auth/login/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { hashPassword } from "@/lib/password";
import { readSession } from "@/lib/session";
import { POST } from "./route";

const email = `login-${randomUUID()}@test.local`;
const password = "correct horse battery";
let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.quit();
});

function login(headers: Record<string, string>) {
  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID(), ...headers },
      body: JSON.stringify({ email, password }),
    }),
  );
}

describe("POST /api/auth/login", () => {
  it("returns a 30-day app session token in the body, without a cookie, for the app", async () => {
    const res = await login({ "x-client": "app/1.0.0", "x-device-name": "Pixel 8" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as { token: string; userId: string };
    expect(body.userId).toBe(userId);
    const session = await readSession(body.token);
    expect(session?.client).toBe("APP");
  });

  it("keeps the cookie response for the website", async () => {
    const res = await login({});
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/asm_session=/);
    expect(await res.json()).toEqual({ userId });
  });
});
```

Add to `apps/web/src/app/api/auth/register/route.test.ts` (reuse its existing request helper and cleanup list; register a fresh email):

```ts
  it("returns an app session token in the body for the app", async () => {
    const email = `reg-app-${randomUUID()}@test.local`;
    const res = await POST(
      new NextRequest("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": randomUUID(), "x-client": "app/1.0.0" },
        body: JSON.stringify({ email, password: "correct horse battery" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as { token: string; userId: string };
    expect(typeof body.token).toBe("string");
    createdEmails.push(email);
  });
```

If the register test file has no `createdEmails` cleanup array, add `const createdEmails: string[] = [];` at the top and `await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });` to its `afterAll`. Match `RegisterSchema`'s required fields (copy them from the file's existing happy-path case).

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @asm/web exec vitest run src/app/api/auth/login src/app/api/auth/register`
Expected: FAIL — app request still gets a cookie and `{ userId }`.

- [ ] **Step 3: Implement in login**

At the end of `login/route.ts`, replace the `createSession` call and response with:

```ts
  const app = isAppRequest(req.headers);
  const token = await createSession(user.id, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    client: app ? "APP" : "WEB",
    deviceName: app ? deviceNameFrom(req.headers) : null,
  });
  updateUserLastSeen({ userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent }).catch(() => {
    /* logged elsewhere via the db client's own error path */
  });
  log.info({ evt: "auth.login", userId: user.id, client: app ? "app" : "web" }, "login succeeded");

  if (app) return NextResponse.json({ token, userId: user.id }, { status: 200 });

  const response = NextResponse.json({ userId: user.id }, { status: 200 });
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
```

Add `import { deviceNameFrom, isAppRequest } from "@/lib/app-client";`.

- [ ] **Step 4: Implement in register**

In `register/route.ts`, replace the `createSession` call with:

```ts
  const app = isAppRequest(req.headers);
  const token = await createSession(user.id, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    client: app ? "APP" : "WEB",
    deviceName: app ? deviceNameFrom(req.headers) : null,
  });
```

and the final response with:

```ts
  if (app) return NextResponse.json({ token, userId: user.id }, { status: 201 });

  const response = NextResponse.json({ userId: user.id }, { status: 201 });
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
```

Add the same import.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @asm/web exec vitest run src/app/api/auth` → PASS.

```bash
git add apps/web/src/app/api/auth/login apps/web/src/app/api/auth/register
git commit -m "feat(web): app login/register return a session token"
```

---

### Task 6: Native Google sign-in

**Files:**
- Create: `apps/web/src/lib/google-account.ts`
- Modify: `apps/web/src/app/api/auth/google/callback/route.ts`
- Create: `apps/web/src/lib/google-native.ts`, `apps/web/src/lib/google-native.test.ts`
- Create: `apps/web/src/app/api/v1/auth/google/native/route.ts`, `…/route.test.ts`
- Modify: `apps/web/package.json` (add `jose`)

**Interfaces:**
- Produces:
  - `signInWithGoogleProfile(profile: GoogleProfile, ctx: RequestContext, log: Logger): Promise<{ userId: string; created: boolean }>` (`google-account.ts`)
  - `verifyNativeIdToken(idToken: string, opts: { audiences: string[]; jwks?: JWTVerifyGetKey; nowMs?: number }): Promise<GoogleProfile>` (`google-native.ts`), throws `GoogleSignInError`
  - `googleNativeAudiences(env?: Record<string, string | undefined>): string[]`
  - `POST /api/v1/auth/google/native` body `{ idToken: string }` → `200 { token, userId, created }`; 401 `{ error, code: "google_failed" }`; 403 `vpn_blocked`; 429 `rate_limited`; 503 `{ code: "google_disabled" }` when no audiences configured.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @asm/web add jose@6.1.0`
Expected: `jose 6.1.0` added to `apps/web/package.json` dependencies.

- [ ] **Step 2: Extract the shared sign-in logic**

Create `apps/web/src/lib/google-account.ts`:

```ts
import { randomBytes } from "node:crypto";
import { bonusPercentForDeposit, findOrCreateGoogleUser, updateUserLastSeen } from "@asm/db";
import type { Logger } from "@asm/logger";
import { sendWelcomeEmail } from "@asm/mail";
import type { GoogleProfile } from "./google-oauth";
import { hashPassword } from "./password";
import type { RequestContext } from "./request-context";
import { provisionNewUser } from "./signup";

/**
 * Signs in, links, or creates the account for a verified Google identity.
 * Shared by the web OAuth callback and the native app route so both apply the
 * same linking rules, welcome email and provisioning.
 */
export async function signInWithGoogleProfile(
  profile: GoogleProfile,
  ctx: RequestContext,
  log: Logger,
): Promise<{ userId: string; created: boolean }> {
  const result = await findOrCreateGoogleUser({
    sub: profile.sub,
    email: profile.email,
    firstName: profile.givenName,
    lastName: profile.familyName,
    passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
  });

  if (result.created) {
    await provisionNewUser(result.userId, ctx);
    log.info({ evt: "auth.register", userId: result.userId, via: "google" }, "account created");
    void sendWelcomeEmail({
      to: profile.email,
      cid: ctx.cid,
      userId: result.userId,
      name: profile.givenName || null,
      firstDepositBonusPercent: bonusPercentForDeposit(1),
    });
  } else {
    updateUserLastSeen({ userId: result.userId, ip: ctx.ip, userAgent: ctx.userAgent }).catch(() => {
      /* best-effort, as on the password login route */
    });
    log.info({ evt: "auth.login", userId: result.userId, via: "google" }, "login succeeded");
  }
  return { userId: result.userId, created: result.created };
}
```

If `@asm/logger` does not export a `Logger` type, use `type Logger = ReturnType<typeof childLogger>` with `import { childLogger } from "@asm/logger"` instead.

In `callback/route.ts`, replace the block from `let result;` through the end of the `if (result.created) … else …` with:

```ts
  let result;
  try {
    result = await signInWithGoogleProfile(profile, ctx, log);
  } catch (err) {
    return fail(err instanceof Error ? err.name : "link_failed");
  }
```

and remove the now-unused imports (`randomBytes`, `bonusPercentForDeposit`, `findOrCreateGoogleUser`, `updateUserLastSeen`, `sendWelcomeEmail`, `hashPassword`, `provisionNewUser`). Add `import { signInWithGoogleProfile } from "@/lib/google-account";`.

Run: `pnpm --filter @asm/web exec tsc --noEmit` → no errors.

- [ ] **Step 3: Write failing tests for `verifyNativeIdToken`**

`apps/web/src/lib/google-native.test.ts`:

```ts
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { GoogleSignInError } from "./google-oauth";
import { googleNativeAudiences, verifyNativeIdToken } from "./google-native";

const AUD = "android-client.apps.googleusercontent.com";
let sign: (claims: Record<string, unknown>) => Promise<string>;
let jwks: ReturnType<typeof createLocalJWKSet>;
let otherKeySign: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [jwk] });
  sign = (claims) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).sign(privateKey);
  const other = await generateKeyPair("RS256");
  otherKeySign = (claims) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).sign(other.privateKey);
});

const base = () => ({
  iss: "https://accounts.google.com",
  aud: AUD,
  sub: "1234567890",
  email: "Asha@Example.com",
  email_verified: true,
  given_name: "Asha",
  exp: Math.floor(Date.now() / 1000) + 600,
  iat: Math.floor(Date.now() / 1000),
});

describe("verifyNativeIdToken", () => {
  it("returns the normalised profile for a valid token", async () => {
    const profile = await verifyNativeIdToken(await sign(base()), { audiences: [AUD], jwks });
    expect(profile).toEqual({ sub: "1234567890", email: "asha@example.com", givenName: "Asha", familyName: null });
  });

  it("rejects a token signed by another key", async () => {
    await expect(verifyNativeIdToken(await otherKeySign(base()), { audiences: [AUD], jwks })).rejects.toBeInstanceOf(
      GoogleSignInError,
    );
  });

  it("rejects a token issued for another app", async () => {
    await expect(
      verifyNativeIdToken(await sign({ ...base(), aud: "someone-else" }), { audiences: [AUD], jwks }),
    ).rejects.toBeInstanceOf(GoogleSignInError);
  });

  it("rejects an unverified email", async () => {
    await expect(
      verifyNativeIdToken(await sign({ ...base(), email_verified: false }), { audiences: [AUD], jwks }),
    ).rejects.toBeInstanceOf(GoogleSignInError);
  });

  it("rejects an expired token", async () => {
    const expired = { ...base(), exp: Math.floor(Date.now() / 1000) - 60 };
    await expect(verifyNativeIdToken(await sign(expired), { audiences: [AUD], jwks })).rejects.toBeInstanceOf(
      GoogleSignInError,
    );
  });
});

describe("googleNativeAudiences", () => {
  it("accepts the Android client ids plus the web client id", () => {
    expect(
      googleNativeAudiences({ GOOGLE_ANDROID_CLIENT_IDS: " a , b ", GOOGLE_CLIENT_ID: "web" }),
    ).toEqual(["a", "b", "web"]);
  });
  it("is empty when nothing is configured", () => {
    expect(googleNativeAudiences({})).toEqual([]);
  });
});
```

- [ ] **Step 4: Run to confirm failure**

Run: `pnpm --filter @asm/web exec vitest run src/lib/google-native.test.ts` → FAIL (module not found).

- [ ] **Step 5: Implement `google-native.ts`**

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { GoogleSignInError, type GoogleProfile } from "./google-oauth";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

/**
 * Audiences a native ID token may carry: the Android OAuth client ids, plus the
 * web client id (Android Credential Manager issues tokens for the web client
 * when it is passed as the server client id).
 */
export function googleNativeAudiences(env: Record<string, string | undefined> = process.env): string[] {
  const android = (env["GOOGLE_ANDROID_CLIENT_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const web = env["GOOGLE_CLIENT_ID"]?.trim();
  return web ? [...android, web] : android;
}

/** Verifies signature + claims of an ID token the app got from Google. */
export async function verifyNativeIdToken(
  idToken: string,
  opts: { audiences: string[]; jwks?: JWTVerifyGetKey; nowMs?: number },
): Promise<GoogleProfile> {
  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(idToken, opts.jwks ?? GOOGLE_JWKS, {
      issuer: ISSUERS,
      audience: opts.audiences,
      currentDate: opts.nowMs ? new Date(opts.nowMs) : undefined,
    });
    claims = payload as Record<string, unknown>;
  } catch {
    throw new GoogleSignInError("invalid id_token");
  }

  if (typeof claims.sub !== "string" || claims.sub === "") throw new GoogleSignInError("no subject");
  if (typeof claims.email !== "string" || claims.email_verified !== true) {
    throw new GoogleSignInError("email not verified");
  }
  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    givenName: typeof claims.given_name === "string" ? claims.given_name : null,
    familyName: typeof claims.family_name === "string" ? claims.family_name : null,
  };
}
```

Run: `pnpm --filter @asm/web exec vitest run src/lib/google-native.test.ts` → PASS.

- [ ] **Step 6: Write the route test**

`apps/web/src/app/api/v1/auth/google/native/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { readSession } from "@/lib/session";

const email = `gnative-${randomUUID()}@test.local`;
vi.mock("@/lib/google-native", async (orig) => {
  const real = await orig<typeof import("@/lib/google-native")>();
  return {
    ...real,
    verifyNativeIdToken: vi.fn(async (token: string) => {
      if (token !== "good") throw new (await import("@/lib/google-oauth")).GoogleSignInError("invalid id_token");
      return { sub: `sub-${email}`, email, givenName: "Asha", familyName: null };
    }),
  };
});
vi.mock("@asm/mail", () => ({ sendWelcomeEmail: vi.fn(async () => {}) }));

const { POST } = await import("./route");
const savedEnv = process.env["GOOGLE_ANDROID_CLIENT_IDS"];

afterEach(() => {
  if (savedEnv === undefined) delete process.env["GOOGLE_ANDROID_CLIENT_IDS"];
  else process.env["GOOGLE_ANDROID_CLIENT_IDS"] = savedEnv;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  await redis.quit();
});

function call(idToken: string) {
  return POST(
    new NextRequest("http://localhost/api/v1/auth/google/native", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID(), "x-client": "app/1.0.0" },
      body: JSON.stringify({ idToken }),
    }),
  );
}

describe("POST /api/v1/auth/google/native", () => {
  it("is unavailable when no Google client ids are configured", async () => {
    process.env["GOOGLE_ANDROID_CLIENT_IDS"] = "";
    const saved = process.env["GOOGLE_CLIENT_ID"];
    delete process.env["GOOGLE_CLIENT_ID"];
    const res = await call("good");
    if (saved !== undefined) process.env["GOOGLE_CLIENT_ID"] = saved;
    expect(res.status).toBe(503);
  });

  it("refuses an invalid token", async () => {
    process.env["GOOGLE_ANDROID_CLIENT_IDS"] = "android-id";
    const res = await call("bad");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("google_failed");
  });

  it("creates the account once, then signs the same person in", async () => {
    process.env["GOOGLE_ANDROID_CLIENT_IDS"] = "android-id";
    const first = (await (await call("good")).json()) as { token: string; userId: string; created: boolean };
    expect(first.created).toBe(true);
    expect((await readSession(first.token))?.client).toBe("APP");
    const second = (await (await call("good")).json()) as { userId: string; created: boolean };
    expect(second).toMatchObject({ userId: first.userId, created: false });
  });
});
```

- [ ] **Step 7: Implement the route**

`apps/web/src/app/api/v1/auth/google/native/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { findUserByEmail } from "@asm/db";
import { childLogger } from "@asm/logger";
import { deviceNameFrom } from "@/lib/app-client";
import { signInWithGoogleProfile } from "@/lib/google-account";
import { googleNativeAudiences, verifyNativeIdToken } from "@/lib/google-native";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { noStoreJson, rateLimited } from "@/lib/request-session";
import { createSession } from "@/lib/session";

const Body = z.strictObject({ idToken: z.string().min(20).max(4096) });

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const audiences = googleNativeAudiences();
  if (audiences.length === 0) {
    return NextResponse.json({ error: "Google sign-in is not available.", code: "google_disabled" }, { status: 503 });
  }
  if (!(await checkRateLimit(`rl:google_native:ip:${ctx.ip}`, 20, 300))) return rateLimited();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Google sign-in failed.", code: "google_failed" }, { status: 400 });
  }

  let profile;
  try {
    profile = await verifyNativeIdToken(parsed.data.idToken, { audiences });
  } catch (err) {
    log.info({ evt: "auth.google_failed", reason: err instanceof Error ? err.message : "verify" }, "native google failed");
    return NextResponse.json({ error: "Google sign-in failed.", code: "google_failed" }, { status: 401 });
  }

  const existing = await findUserByEmail(profile.email);
  const guardInput = existing
    ? { ip: ctx.ip, route: "google_native", log, userId: existing.id }
    : { ip: ctx.ip, route: "google_native", log };
  if ((await checkNetwork(guardInput)).blocked) return vpnBlockedResponse();

  let result;
  try {
    result = await signInWithGoogleProfile(profile, ctx, log);
  } catch (err) {
    log.warn({ evt: "auth.google_failed", reason: err instanceof Error ? err.name : "link" }, "native google link failed");
    return NextResponse.json({ error: "Google sign-in failed.", code: "google_failed" }, { status: 401 });
  }

  const token = await createSession(result.userId, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    client: "APP",
    deviceName: deviceNameFrom(req.headers),
  });
  return noStoreJson({ token, userId: result.userId, created: result.created });
}
```

- [ ] **Step 8: Run tests and commit**

Run: `pnpm --filter @asm/web exec vitest run src/lib/google-native.test.ts src/app/api/v1/auth src/app/api/auth/google` → PASS.

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/google-account.ts apps/web/src/lib/google-native.ts apps/web/src/lib/google-native.test.ts apps/web/src/app/api/auth/google/callback/route.ts apps/web/src/app/api/v1/auth
git commit -m "feat(web): native Google sign-in for the app"
```

Add to `.env.example` (root): `GOOGLE_ANDROID_CLIENT_IDS=` with a comment "comma-separated Android OAuth client ids for the app".

---

### Task 7: Response contracts for `/api/v1`

**Files:**
- Create: `packages/contracts/src/app.ts`, `packages/contracts/src/app.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces (all zod schemas + inferred types, exported from `@asm/contracts`):
  `LocaleSchema`, `AppAssetSchema`, `AppAccountSchema`, `BootstrapSchema`, `WalletSchema`, `PaymentRowSchema`, `PaymentsPageSchema`, `DepositConfigSchema`, `CheckoutViewSchema`, `WithdrawalPrefillSchema`, `AppConfigSchema`, `PreferencesUpdateSchema`, `PreferencesSchema`, `ApiErrorSchema`, and types `Locale`, `Bootstrap`, `Wallet`, `PaymentRowDto`, `PaymentsPage`, `DepositConfig`, `CheckoutView`, `WithdrawalPrefill`, `AppConfig`, `PreferencesUpdate`, `Preferences`, `ApiError`.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/app.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppConfigSchema, ApiErrorSchema, PreferencesUpdateSchema, WalletSchema } from "./app";

describe("app contracts", () => {
  it("accepts a wallet with live and demo accounts", () => {
    const wallet = {
      accounts: [
        { id: "7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11", type: "LIVE", currency: "INR", realBalance: 150000, bonusBalance: 50000 },
        { id: "8e4d0b2f-4c66-4f9b-8b1c-7a5f3b2e1d22", type: "DEMO", currency: "INR", realBalance: 1000000, bonusBalance: 0 },
      ],
      withdrawable: 150000,
      lockedBonus: 50000,
      completedDeposits: 1,
      nextBonusPercent: 100,
      bonusTiers: [100, 100, 50, 50],
    };
    expect(WalletSchema.parse(wallet)).toEqual(wallet);
  });

  it("rejects an unknown locale", () => {
    expect(PreferencesUpdateSchema.safeParse({ locale: "fr" }).success).toBe(false);
    expect(PreferencesUpdateSchema.safeParse({ locale: "hi" }).success).toBe(true);
  });

  it("requires semver strings in app config", () => {
    const ok = {
      minVersion: "1.0.0",
      latestVersion: "1.2.0",
      apkUrl: "/download/app",
      playUrl: null,
      playLive: false,
      support: { whatsapp: null, telegram: null },
    };
    expect(AppConfigSchema.parse(ok)).toEqual(ok);
    expect(AppConfigSchema.safeParse({ ...ok, minVersion: "1.0" }).success).toBe(false);
  });

  it("describes errors with a stable code", () => {
    expect(ApiErrorSchema.parse({ error: "Not signed in.", code: "unauthenticated" }).code).toBe("unauthenticated");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @asm/contracts test` → FAIL (module not found).

- [ ] **Step 3: Implement `app.ts`**

```ts
import { z } from "zod";
import { PAYOUT_METHODS } from "./withdrawal";
import { USDT_NETWORKS } from "./deposit";

/**
 * Response shapes for the native app's /api/v1 reads. The server parses its
 * own output with these before sending; the app parses on receipt.
 */

const SEMVER = /^\d+\.\d+\.\d+$/;
const minor = z.number().int();

export const LocaleSchema = z.enum(["en", "hi"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const ApiErrorSchema = z.object({ error: z.string(), code: z.string().optional() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const AppAssetSchema = z.object({
  symbol: z.string(),
  displayName: z.string(),
  precision: z.number().int(),
  payoutPct: z.number(),
  assetClass: z.string(),
});

export const AppAccountSchema = z.object({
  id: z.uuid(),
  type: z.enum(["LIVE", "DEMO"]),
  currency: z.string(),
  realBalance: minor,
  bonusBalance: minor,
});

export const ProfileSummarySchema = z.object({
  nickname: z.string().nullable(),
  email: z.string(),
  kycStatus: z.enum(["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"]),
  locale: LocaleSchema,
});

/** Trades use the existing TradeView shape; kept loose here (validated by the engine contract). */
export const BootstrapSchema = z.object({
  userId: z.string(),
  assets: z.array(AppAssetSchema),
  accounts: z.array(AppAccountSchema),
  recentTrades: z.array(z.record(z.string(), z.unknown())),
  defaultSymbol: z.string(),
  liveAccess: z.boolean(),
  completedDeposits: z.number().int(),
  profile: ProfileSummarySchema,
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;

export const WalletSchema = z.object({
  accounts: z.array(AppAccountSchema),
  withdrawable: minor,
  lockedBonus: minor,
  completedDeposits: z.number().int(),
  nextBonusPercent: z.number(),
  bonusTiers: z.array(z.number()),
});
export type Wallet = z.infer<typeof WalletSchema>;

/** Mirrors PaymentRow in apps/web/src/components/history/history-model.ts (moves to @asm/client-core). */
export const PaymentRowSchema = z.object({
  key: z.string(),
  id: z.string(),
  kind: z.enum(["deposit", "withdrawal"]),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  status: z.string(),
  methodLabel: z.string(),
  amountMinor: minor,
  currency: z.string(),
  destination: z.string().nullable(),
  expiresAt: z.string().nullable(),
  holdUntil: z.string().nullable(),
  cancelableUntil: z.string().nullable(),
});
export type PaymentRowDto = z.infer<typeof PaymentRowSchema>;

export const PaymentsPageSchema = z.object({
  rows: z.array(PaymentRowSchema),
  nextCursor: z.string().nullable(),
});
export type PaymentsPage = z.infer<typeof PaymentsPageSchema>;

export const DepositConfigSchema = z.object({
  upiEnabled: z.boolean(),
  usdtNetworks: z.array(z.enum(USDT_NETWORKS)),
  gatewayNetworks: z.array(z.enum(USDT_NETWORKS)),
  completedDeposits: z.number().int(),
  bonusTiers: z.array(z.number()),
});
export type DepositConfig = z.infer<typeof DepositConfigSchema>;

export const CheckoutViewSchema = z.object({
  id: z.string(),
  method: z.string(),
  status: z.enum(["AWAITING_PAYMENT", "PENDING_CONFIRMATION", "COMPLETED", "REJECTED", "EXPIRED"]),
  amountInr: minor,
  amountUsdtMinor: minor.nullable(),
  network: z.string().nullable(),
  expiresAt: z.string(),
  upiUri: z.string().nullable(),
  vpa: z.string().nullable(),
  receivingAddress: z.string().nullable(),
  isGateway: z.boolean(),
  isSlot: z.boolean(),
  claimedUtr: z.string().nullable(),
  claimedTxHash: z.string().nullable(),
  manualClaimDelaySec: z.number().int(),
});
export type CheckoutView = z.infer<typeof CheckoutViewSchema>;

export const WithdrawalPrefillSchema = z.object({
  lastPayouts: z.object({
    BANK: z.object({ accountHolder: z.string(), accountNumber: z.string(), ifsc: z.string() }).optional(),
    UPI: z.object({ upiId: z.string() }).optional(),
    USDT: z.object({ usdtNetwork: z.enum(USDT_NETWORKS), usdtAddress: z.string() }).optional(),
  }),
  initialMethod: z.enum(PAYOUT_METHODS).nullable(),
  kycName: z.string(),
  kycStatus: z.enum(["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"]),
  heldWithdrawals: z.array(z.object({ id: z.string(), amountMinor: minor, createdAt: z.string() })),
});
export type WithdrawalPrefill = z.infer<typeof WithdrawalPrefillSchema>;

export const AppConfigSchema = z.object({
  minVersion: z.string().regex(SEMVER),
  latestVersion: z.string().regex(SEMVER),
  apkUrl: z.string(),
  playUrl: z.string().nullable(),
  playLive: z.boolean(),
  support: z.object({ whatsapp: z.string().nullable(), telegram: z.string().nullable() }),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const PreferencesUpdateSchema = z.strictObject({ locale: LocaleSchema.optional() });
export type PreferencesUpdate = z.infer<typeof PreferencesUpdateSchema>;

export const PreferencesSchema = z.object({ locale: LocaleSchema });
export type Preferences = z.infer<typeof PreferencesSchema>;
```

Before finishing, open `packages/contracts/src/deposit.ts` and `withdrawal.ts` and confirm `USDT_NETWORKS` and `PAYOUT_METHODS` are `as const` tuples (needed by `z.enum`). If either is not, use `z.string()` for that field instead.

In `packages/contracts/src/index.ts` append:

```ts
export * from "./app";
```

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @asm/contracts test && pnpm --filter @asm/contracts exec tsc --noEmit` → PASS.

```bash
git add packages/contracts/src/app.ts packages/contracts/src/app.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): /api/v1 response schemas for the app"
```

---

### Task 8: `/api/v1/bootstrap` (shared with the platform layout)

**Files:**
- Create: `apps/web/src/lib/platform-bootstrap.ts`
- Modify: `apps/web/src/app/(platform)/layout.tsx`
- Modify: `packages/db/src/repositories/profile.ts` (`loadProfile` returns `locale`)
- Create: `apps/web/src/app/api/v1/bootstrap/route.ts`, `…/route.test.ts`

**Interfaces:**
- Consumes: `getSession`, `unauthenticated`, `noStoreJson` (Task 3); `BootstrapSchema` (Task 7).
- Produces: `loadPlatformBootstrap(userId: string): Promise<PlatformBootstrap>` where `PlatformBootstrap` = `{ assets, accounts, balances, recentTrades: TradeView[], defaultSymbol, liveAccess, completedDeposits }` (exactly what the layout passes to `PlatformProvider`, plus raw accounts).

- [ ] **Step 1: Extract the layout's data loading**

Create `apps/web/src/lib/platform-bootstrap.ts`:

```ts
import { tradeViewFrom, type TradeView } from "@asm/contracts";
import { countCompletedDeposits, listAccountsForActor, listTradesForActor, prisma } from "@asm/db";

export interface PlatformBootstrap {
  assets: { symbol: string; displayName: string; payoutPct: number; precision: number; assetClass: string }[];
  accounts: { id: string; type: "LIVE" | "DEMO"; currency: string; realBalance: number; bonusBalance: number }[];
  recentTrades: TradeView[];
  defaultSymbol: string;
  liveAccess: boolean;
  completedDeposits: number;
}

/** Everything the trading shell needs on first paint — web layout and app bootstrap share it. */
export async function loadPlatformBootstrap(userId: string): Promise<PlatformBootstrap> {
  const [accounts, assets, user, completedDeposits] = await Promise.all([
    listAccountsForActor(userId),
    prisma.asset.findMany({
      where: { isOpen: true },
      orderBy: { symbol: "asc" },
      select: { id: true, symbol: true, displayName: true, precision: true, payoutPct: true, assetClass: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { liveAccess: true } }),
    countCompletedDeposits(userId),
  ]);

  const defaultAccount = accounts.find((a) => a.type === "DEMO") ?? accounts[0];
  const recent = defaultAccount ? await listTradesForActor(userId, defaultAccount.id, 50) : [];
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]));
  const defaultSymbol = (assets.find((a) => a.symbol === "NIFTY50") ?? assets[0])?.symbol ?? "";

  return {
    assets: assets.map((a) => ({
      symbol: a.symbol,
      displayName: a.displayName,
      payoutPct: a.payoutPct,
      precision: a.precision,
      assetClass: String(a.assetClass),
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      type: a.type as "LIVE" | "DEMO",
      currency: a.currency,
      realBalance: a.realBalance,
      bonusBalance: a.bonusBalance,
    })),
    recentTrades: recent.map((t) => tradeViewFrom(t, symbolById.get(t.assetId) ?? "UNKNOWN")),
    defaultSymbol,
    liveAccess: user?.liveAccess ?? false,
    completedDeposits,
  };
}
```

In `apps/web/src/app/(platform)/layout.tsx`, replace the `Promise.all` through `defaultSymbol` lines with `const boot = await loadPlatformBootstrap(session.userId);` and pass props from it:

```tsx
    <PlatformProvider
      assets={boot.assets}
      accounts={boot.accounts.map((a) => ({ id: a.id, type: a.type, currency: a.currency }))}
      initialBalances={Object.fromEntries(
        boot.accounts.map((a) => [a.id, { realBalance: a.realBalance, bonusBalance: a.bonusBalance }]),
      )}
      initialTrades={boot.recentTrades}
      defaultSymbol={boot.defaultSymbol}
      liveAccess={boot.liveAccess}
      completedDeposits={boot.completedDeposits}
    >
```

Remove now-unused imports (`tradeViewFrom`, `countCompletedDeposits`, `listAccountsForActor`, `listTradesForActor`, `prisma`). If `assetClass`'s `PlatformAsset` type is an enum rather than `string`, keep the layout passing `boot.assets` with a cast to `PlatformAsset[]` (`as PlatformAsset[]`) and leave `String()` in the loader.

Run: `pnpm --filter @asm/web exec tsc --noEmit` → no errors.

- [ ] **Step 2: Add `locale` to `loadProfile`**

In `packages/db/src/repositories/profile.ts`, add `locale: string` to `ProfileView`, `locale: true` to `loadProfile`'s `select`, and `locale: user.locale` to its return object. Run `pnpm --filter @asm/db exec tsc --noEmit`.

- [ ] **Step 3: Write the failing route test**

`apps/web/src/app/api/v1/bootstrap/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BootstrapSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `boot-${randomUUID()}@test.local`,
      passwordHash: "x",
      accounts: { create: [{ type: "DEMO", realBalance: 1_000_000 }, { type: "LIVE" }] },
    },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.quit();
});

const get = (headers: Record<string, string>) =>
  GET(new NextRequest("http://localhost/api/v1/bootstrap", { headers: { "x-forwarded-for": "127.0.0.1", ...headers } }));

describe("GET /api/v1/bootstrap", () => {
  it("refuses a signed-out caller", async () => {
    expect((await get({})).status).toBe(401);
  });

  it("returns the trading shell data in the agreed shape", async () => {
    const res = await get({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = BootstrapSchema.parse(await res.json());
    expect(body.accounts.map((a) => a.type).sort()).toEqual(["DEMO", "LIVE"]);
    expect(body.profile.locale).toBe("en");
  });
});
```

Run: `pnpm --filter @asm/web exec vitest run src/app/api/v1/bootstrap` → FAIL (route missing).

- [ ] **Step 4: Implement the route**

`apps/web/src/app/api/v1/bootstrap/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { BootstrapSchema } from "@asm/contracts";
import { loadProfile } from "@asm/db";
import { childLogger } from "@asm/logger";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { loadPlatformBootstrap } from "@/lib/platform-bootstrap";
import { requestContext } from "@/lib/request-context";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const ctx = requestContext(req);
  const network = await checkNetwork({
    ip: ctx.ip,
    route: "app_bootstrap",
    log: childLogger(ctx.cid),
    userId: session.userId,
  });
  if (network.blocked) return vpnBlockedResponse();

  const [boot, profile] = await Promise.all([loadPlatformBootstrap(session.userId), loadProfile(session.userId)]);
  return noStoreJson(
    BootstrapSchema.parse({
      ...boot,
      userId: session.userId,
      profile: {
        nickname: profile.nickname,
        email: profile.email,
        kycStatus: profile.kycStatus,
        locale: profile.locale,
      },
    }),
  );
}
```

If `ProfileView` names the email field differently, use that name (check `loadProfile`).

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @asm/web exec vitest run src/app/api/v1/bootstrap && pnpm --filter @asm/db test -- profile` → PASS.

```bash
git add apps/web/src/lib/platform-bootstrap.ts "apps/web/src/app/(platform)/layout.tsx" packages/db/src/repositories/profile.ts apps/web/src/app/api/v1/bootstrap
git commit -m "feat(web): /api/v1/bootstrap shared with the platform layout"
```

---

### Task 9: `/api/v1/wallet`

**Files:**
- Create: `apps/web/src/app/api/v1/wallet/route.ts`, `…/route.test.ts`

**Interfaces:**
- Consumes: `listAccountsForActor`, `withdrawableBalance`, `countCompletedDeposits` (`@asm/db`); `BONUS_TIERS`, `bonusPercentForDeposit` (`@/lib/bonus` — moves to `@asm/client-core` in Task 15; update the import then); `WalletSchema`.

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WalletSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `wallet-${randomUUID()}@test.local`,
      passwordHash: "x",
      accounts: {
        create: [
          { type: "LIVE", realBalance: 150_000, bonusBalance: 50_000 },
          { type: "DEMO", realBalance: 1_000_000 },
        ],
      },
    },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("GET /api/v1/wallet", () => {
  it("refuses a signed-out caller", async () => {
    expect((await GET(new NextRequest("http://localhost/api/v1/wallet"))).status).toBe(401);
  });

  it("reports withdrawable money separately from locked bonus", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v1/wallet", { headers: { authorization: `Bearer ${token}` } }),
    );
    const body = WalletSchema.parse(await res.json());
    expect(body.withdrawable).toBe(150_000);
    expect(body.lockedBonus).toBe(50_000);
    expect(body.completedDeposits).toBe(0);
    expect(body.nextBonusPercent).toBe(body.bonusTiers[0]);
  });
});
```

Run: `pnpm --filter @asm/web exec vitest run src/app/api/v1/wallet` → FAIL.

- [ ] **Step 2: Implement**

```ts
import type { NextRequest } from "next/server";
import { WalletSchema } from "@asm/contracts";
import { countCompletedDeposits, listAccountsForActor, withdrawableBalance } from "@asm/db";
import { BONUS_TIERS, bonusPercentForDeposit } from "@/lib/bonus";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const [accounts, completedDeposits] = await Promise.all([
    listAccountsForActor(session.userId),
    countCompletedDeposits(session.userId),
  ]);
  const live = accounts.find((a) => a.type === "LIVE");
  const balance = live ? await withdrawableBalance(live.id) : { withdrawable: 0, lockedBonus: 0 };

  return noStoreJson(
    WalletSchema.parse({
      accounts: accounts.map((a) => ({
        id: a.id,
        type: a.type,
        currency: a.currency,
        realBalance: a.realBalance,
        bonusBalance: a.bonusBalance,
      })),
      withdrawable: balance.withdrawable,
      lockedBonus: balance.lockedBonus,
      completedDeposits,
      nextBonusPercent: bonusPercentForDeposit(completedDeposits + 1),
      bonusTiers: [...BONUS_TIERS],
    }),
  );
}
```

- [ ] **Step 3: Run tests and commit**

Run: `pnpm --filter @asm/web exec vitest run src/app/api/v1/wallet` → PASS.

```bash
git add apps/web/src/app/api/v1/wallet
git commit -m "feat(web): /api/v1/wallet"
```

---

### Task 10: `/api/v1/payments` with a cursor

**Files:**
- Modify: `packages/db/src/repositories/deposit.ts` (`listDepositsForActor`), `packages/db/src/repositories/withdrawal.ts` (`listWithdrawalsForActor`)
- Modify: `apps/web/src/components/history/load-payment-rows.ts`
- Create: `apps/web/src/app/api/v1/payments/route.ts`, `…/route.test.ts`

**Interfaces:**
- Produces:
  - `listDepositsForActor(actorId: string, limit: number, before?: Date)`; same for `listWithdrawalsForActor`
  - `loadPaymentRows(userId: string, limit = 50, before?: Date): Promise<PaymentRow[]>`
  - `GET /api/v1/payments?limit=<1..50, default 20>&cursor=<ISO date>` → `{ rows, nextCursor }` where `nextCursor` is the `createdAt` of the last row when `rows.length === limit`, else `null`.

- [ ] **Step 1: Add `before` to the repository list functions**

`listDepositsForActor`:

```ts
export async function listDepositsForActor(actorId: string, limit: number, before?: Date): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: { userId: actorId, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}
```

`listWithdrawalsForActor` — same change (`before?: Date`, same `where` spread).

- [ ] **Step 2: Thread it through `loadPaymentRows` and trim to `limit`**

```ts
export async function loadPaymentRows(userId: string, limit = 50, before?: Date): Promise<PaymentRow[]> {
  const [deposits, withdrawals, accounts] = await Promise.all([
    listDepositsForActor(userId, limit, before),
    listWithdrawalsForActor(userId, limit, before),
    listAccountsForActor(userId),
  ]);
```

and change the final line to:

```ts
  return rows
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
```

(Trimming keeps a merged page from exceeding `limit`; the web pages call it with the default 50 and see at most 50 rows, as before when either list alone was ≤ 50 — note this in the PR.)

- [ ] **Step 3: Write the failing route test**

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PaymentsPageSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `payments-${randomUUID()}@test.local`,
      passwordHash: "x",
      kycStatus: "VERIFIED",
      accounts: { create: [{ type: "LIVE" }, { type: "DEMO" }] },
    },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
  const base = Date.now() - 60_000;
  for (let i = 0; i < 5; i++) {
    await prisma.deposit.create({
      data: {
        userId,
        method: "UPI",
        amountUsd: 1200,
        amountInr: 100_000 + i,
        vpa: "test@upi",
        checkoutToken: randomUUID(),
        correlationId: randomUUID(),
        expiresAt: new Date(base + 300_000),
        createdAt: new Date(base + i * 1000),
      },
    });
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

const get = (query: string) =>
  GET(new NextRequest(`http://localhost/api/v1/payments${query}`, { headers: { authorization: `Bearer ${token}` } }));

describe("GET /api/v1/payments", () => {
  it("pages newest-first without repeating or skipping rows", async () => {
    const first = PaymentsPageSchema.parse(await (await get("?limit=2")).json());
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = PaymentsPageSchema.parse(
      await (await get(`?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)).json(),
    );
    const third = PaymentsPageSchema.parse(
      await (await get(`?limit=2&cursor=${encodeURIComponent(second.nextCursor!)}`)).json(),
    );
    const ids = [...first.rows, ...second.rows, ...third.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    expect((await get("?cursor=yesterday")).status).toBe(400);
  });
});
```

Run: `pnpm --filter @asm/web exec vitest run src/app/api/v1/payments` → FAIL.

- [ ] **Step 4: Implement the route**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { PaymentsPageSchema } from "@asm/contracts";
import { loadPaymentRows } from "@/components/history/load-payment-rows";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "20", 10) || 20, 1), 50);
  const rawCursor = params.get("cursor");
  let before: Date | undefined;
  if (rawCursor) {
    before = new Date(rawCursor);
    if (Number.isNaN(before.getTime())) {
      return NextResponse.json({ error: "Bad cursor.", code: "bad_request" }, { status: 400 });
    }
  }

  const rows = await loadPaymentRows(session.userId, limit, before);
  const last = rows.at(-1);
  return noStoreJson(
    PaymentsPageSchema.parse({
      rows,
      nextCursor: rows.length === limit && last ? new Date(last.createdAt).toISOString() : null,
    }),
  );
}
```

- [ ] **Step 5: Run tests (db + web) and commit**

Run: `pnpm --filter @asm/db test && pnpm --filter @asm/web exec vitest run src/app/api/v1/payments src/components/history` → PASS.

```bash
git add packages/db/src/repositories/deposit.ts packages/db/src/repositories/withdrawal.ts apps/web/src/components/history/load-payment-rows.ts apps/web/src/app/api/v1/payments
git commit -m "feat(web): /api/v1/payments with createdAt cursor"
```

---

### Task 11: `/api/v1/deposit-config` and `/api/v1/checkout/:token`

**Files:**
- Create: `apps/web/src/lib/deposit-config.ts`, `apps/web/src/lib/checkout-view.ts`
- Modify: `apps/web/src/app/(platform)/deposit/page.tsx`, `apps/web/src/app/checkout/[token]/page.tsx`
- Create: `apps/web/src/app/api/v1/deposit-config/route.ts`, `apps/web/src/app/api/v1/checkout/[token]/route.ts`, `…/route.test.ts` for each

**Interfaces:**
- Produces:
  - `loadDepositConfig(userId: string): Promise<DepositConfig>`
  - `checkoutViewFor(deposit: Deposit): CheckoutView` (pure apart from env reads) and `upiUriFor(deposit): string`
  - `GET /api/v1/checkout/:token` → `CheckoutView` for the caller's deposit, 404 `{ code: "not_found" }` otherwise.

- [ ] **Step 1: Extract the loaders**

`apps/web/src/lib/deposit-config.ts`:

```ts
import type { DepositConfig } from "@asm/contracts";
import { countCompletedDeposits } from "@asm/db";
import { BONUS_TIERS } from "./bonus";
import { upiDepositsEnabled } from "./upi-collection";
import { listEnabledUsdtNetworks, usdtGatewayActive } from "./usdt-networks";

/** What the deposit flow needs to offer methods — shared by the page and the app route. */
export async function loadDepositConfig(userId: string): Promise<DepositConfig> {
  const usdtNetworks = listEnabledUsdtNetworks();
  return {
    upiEnabled: upiDepositsEnabled(),
    usdtNetworks,
    gatewayNetworks: usdtNetworks.filter((n) => usdtGatewayActive(n)),
    completedDeposits: await countCompletedDeposits(userId),
    bonusTiers: [...BONUS_TIERS],
  };
}
```

In `deposit/page.tsx` replace the `usdtNetworks`, `gatewayNetworks`, `completedDeposits` computations with `const config = await loadDepositConfig(session.userId);` and pass `usdtNetworks={config.usdtNetworks} gatewayNetworks={config.gatewayNetworks} upiEnabled={config.upiEnabled} completedDeposits={config.completedDeposits}`. Remove unused imports.

`apps/web/src/lib/checkout-view.ts`:

```ts
import type { CheckoutView } from "@asm/contracts";
import type { Deposit } from "@asm/db";
import { buildUpiDeepLink } from "./upi";
import { upiCollection, upiManualClaimDelaySec } from "./upi-collection";

/** The exact upi://pay link the checkout page renders — one builder for web and app. */
export function upiUriFor(deposit: Pick<Deposit, "id" | "vpa" | "amountInr">): string {
  const collection = upiCollection();
  return buildUpiDeepLink({
    vpa: deposit.vpa,
    payeeName: collection.payeeName,
    amountInr: deposit.amountInr,
    merchantCode: collection.merchantCode,
    note: `IXT-${deposit.id.slice(0, 8)}`,
  });
}

export function checkoutViewFor(deposit: Deposit): CheckoutView {
  const isUsdt = deposit.method === "USDT";
  return {
    id: deposit.id,
    method: deposit.method,
    status: deposit.status,
    amountInr: deposit.amountInr,
    amountUsdtMinor: deposit.amountUsdtMinor ?? null,
    network: deposit.network ?? null,
    expiresAt: deposit.expiresAt.toISOString(),
    upiUri: isUsdt ? null : upiUriFor(deposit),
    vpa: isUsdt ? null : deposit.vpa,
    receivingAddress: deposit.receivingAddress ?? null,
    isGateway: isUsdt && deposit.gateway !== null,
    isSlot: isUsdt && deposit.usdtMatch === "SLOT",
    claimedUtr: deposit.claimedUtr ?? null,
    claimedTxHash: deposit.claimedTxHash ?? null,
    manualClaimDelaySec: upiManualClaimDelaySec(),
  };
}
```

In `checkout/[token]/page.tsx` replace the inline `buildUpiDeepLink({...})` call with `const upiUri = upiUriFor(deposit);` and drop the now-unused `buildUpiDeepLink` import (keep `upiCollection` only if still used elsewhere in the file).

Run: `pnpm --filter @asm/web exec tsc --noEmit` → no errors. If `Deposit` is not exported from `@asm/db`, export it from `packages/db/src/index.ts` (`export type { Deposit } from "@prisma/client"` style, matching how other model types are exported there).

- [ ] **Step 2: Write failing route tests**

`apps/web/src/app/api/v1/checkout/[token]/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckoutViewSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let ownerId = "";
let strangerId = "";
let ownerToken = "";
let strangerToken = "";
const checkoutToken = randomUUID();

beforeAll(async () => {
  const [owner, stranger] = await Promise.all([
    prisma.user.create({ data: { email: `co-a-${randomUUID()}@test.local`, passwordHash: "x" } }),
    prisma.user.create({ data: { email: `co-b-${randomUUID()}@test.local`, passwordHash: "x" } }),
  ]);
  ownerId = owner.id;
  strangerId = stranger.id;
  ownerToken = await createSession(ownerId, { client: "APP" });
  strangerToken = await createSession(strangerId, { client: "APP" });
  await prisma.deposit.create({
    data: {
      userId: ownerId,
      method: "PhonePe",
      amountUsd: 1200,
      amountInr: 100_000,
      vpa: "collect@ybl",
      checkoutToken,
      correlationId: randomUUID(),
      expiresAt: new Date(Date.now() + 300_000),
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
  await prisma.$disconnect();
});

const get = (bearer: string) =>
  GET(
    new NextRequest(`http://localhost/api/v1/checkout/${checkoutToken}`, {
      headers: { authorization: `Bearer ${bearer}` },
    }),
    { params: Promise.resolve({ token: checkoutToken }) },
  );

describe("GET /api/v1/checkout/:token", () => {
  it("returns the pay details, including the upi link, to the deposit's owner", async () => {
    const res = await get(ownerToken);
    expect(res.status).toBe(200);
    const view = CheckoutViewSchema.parse(await res.json());
    expect(view.upiUri).toMatch(/^upi:\/\/pay\?pa=collect%40ybl/);
    expect(view.status).toBe("AWAITING_PAYMENT");
  });

  it("hides someone else's deposit as not found", async () => {
    expect((await get(strangerToken)).status).toBe(404);
  });
});
```

`apps/web/src/app/api/v1/deposit-config/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DepositConfigSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";
beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `dc-${randomUUID()}@test.local`, passwordHash: "x" } });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("GET /api/v1/deposit-config", () => {
  it("returns the deposit options in the agreed shape", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v1/deposit-config", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(200);
    expect(DepositConfigSchema.parse(await res.json()).completedDeposits).toBe(0);
  });
});
```

Run both → FAIL (routes missing).

- [ ] **Step 3: Implement the routes**

`apps/web/src/app/api/v1/deposit-config/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { DepositConfigSchema } from "@asm/contracts";
import { loadDepositConfig } from "@/lib/deposit-config";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  return noStoreJson(DepositConfigSchema.parse(await loadDepositConfig(session.userId)));
}
```

`apps/web/src/app/api/v1/checkout/[token]/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { CheckoutViewSchema } from "@asm/contracts";
import { getDepositByToken } from "@asm/db";
import { checkoutViewFor } from "@/lib/checkout-view";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const { token } = await params;
  const deposit = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await getDepositByToken(token) : null;
  // Someone else's deposit is indistinguishable from a missing one.
  if (!deposit || deposit.userId !== session.userId) {
    return NextResponse.json({ error: "Deposit not found.", code: "not_found" }, { status: 404 });
  }
  return noStoreJson(CheckoutViewSchema.parse(checkoutViewFor(deposit)));
}
```

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @asm/web exec vitest run src/app/api/v1/deposit-config src/app/api/v1/checkout src/app/api/deposits` → PASS.

```bash
git add apps/web/src/lib/deposit-config.ts apps/web/src/lib/checkout-view.ts "apps/web/src/app/(platform)/deposit/page.tsx" "apps/web/src/app/checkout/[token]/page.tsx" apps/web/src/app/api/v1/deposit-config apps/web/src/app/api/v1/checkout packages/db/src/index.ts
git commit -m "feat(web): /api/v1 deposit config and checkout view"
```

---

### Task 12: `/api/v1/withdrawal-prefill`

**Files:**
- Create: `apps/web/src/lib/withdrawal-prefill.ts`, `apps/web/src/lib/withdrawal-prefill.test.ts`
- Modify: `apps/web/src/app/(platform)/withdrawal/page.tsx`
- Create: `apps/web/src/app/api/v1/withdrawal-prefill/route.ts`, `…/route.test.ts`

**Interfaces:**
- Produces:
  - `lastPayoutsFrom(recent: WithdrawalLike[]): { lastPayouts: LastPayouts; initialMethod: PayoutMethod | null }` (pure)
  - `loadWithdrawalPrefill(userId: string): Promise<WithdrawalPrefill>`

- [ ] **Step 1: Write the failing unit test**

`apps/web/src/lib/withdrawal-prefill.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lastPayoutsFrom } from "./withdrawal-prefill";

const w = (over: Record<string, unknown>) => ({
  method: "UPI",
  accountHolder: null,
  accountNumber: null,
  ifsc: null,
  upiId: null,
  usdtNetwork: null,
  usdtAddress: null,
  ...over,
});

describe("lastPayoutsFrom", () => {
  it("keeps the newest complete destination per method and starts on the newest method", () => {
    const result = lastPayoutsFrom([
      w({ method: "UPI", upiId: "new@upi" }),
      w({ method: "BANK", accountHolder: "Asha", accountNumber: "123", ifsc: "SBIN0001234" }),
      w({ method: "UPI", upiId: "old@upi" }),
    ]);
    expect(result.initialMethod).toBe("UPI");
    expect(result.lastPayouts.UPI).toEqual({ upiId: "new@upi" });
    expect(result.lastPayouts.BANK).toEqual({ accountHolder: "Asha", accountNumber: "123", ifsc: "SBIN0001234" });
  });

  it("skips incomplete bank rows and unknown USDT networks", () => {
    const result = lastPayoutsFrom([
      w({ method: "BANK", accountHolder: "Asha", accountNumber: null, ifsc: "X" }),
      w({ method: "USDT", usdtNetwork: "doge", usdtAddress: "abc" }),
    ]);
    expect(result).toEqual({ lastPayouts: {}, initialMethod: null });
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `withdrawal-prefill.ts` and use it in the page**

```ts
import {
  isUsdtNetwork,
  type PayoutMethod,
  type UsdtNetwork,
  type WithdrawalPrefill,
} from "@asm/contracts";
import { listWithdrawalsForActor, loadProfile } from "@asm/db";

export interface WithdrawalLike {
  method: string;
  accountHolder: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  usdtNetwork: string | null;
  usdtAddress: string | null;
}

export interface LastPayouts {
  BANK?: { accountHolder: string; accountNumber: string; ifsc: string };
  UPI?: { upiId: string };
  USDT?: { usdtNetwork: UsdtNetwork; usdtAddress: string };
}

/** Newest complete payout destination per method, from newest-first withdrawals. */
export function lastPayoutsFrom(recent: WithdrawalLike[]): { lastPayouts: LastPayouts; initialMethod: PayoutMethod | null } {
  const lastPayouts: LastPayouts = {};
  let initialMethod: PayoutMethod | null = null;
  for (const w of recent) {
    if (w.method === "BANK" && !lastPayouts.BANK && w.accountHolder && w.accountNumber && w.ifsc) {
      lastPayouts.BANK = { accountHolder: w.accountHolder, accountNumber: w.accountNumber, ifsc: w.ifsc };
      initialMethod ??= "BANK";
    } else if (w.method === "UPI" && !lastPayouts.UPI && w.upiId) {
      lastPayouts.UPI = { upiId: w.upiId };
      initialMethod ??= "UPI";
    } else if (w.method === "USDT" && !lastPayouts.USDT && w.usdtAddress && isUsdtNetwork(w.usdtNetwork)) {
      lastPayouts.USDT = { usdtNetwork: w.usdtNetwork, usdtAddress: w.usdtAddress };
      initialMethod ??= "USDT";
    }
  }
  return { lastPayouts, initialMethod };
}

export async function loadWithdrawalPrefill(userId: string): Promise<WithdrawalPrefill> {
  const [recent, profile] = await Promise.all([listWithdrawalsForActor(userId, 20), loadProfile(userId)]);
  const { lastPayouts, initialMethod } = lastPayoutsFrom(recent);
  return {
    lastPayouts,
    initialMethod,
    kycName: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
    kycStatus: profile.kycStatus,
    heldWithdrawals: recent
      .filter((w) => w.status === "HELD")
      .map((w) => ({ id: w.id, amountMinor: w.amount, createdAt: w.createdAt.toISOString() })),
  };
}
```

Check the `Withdrawal` model's amount field name (`amount` vs `amountMinor`) in `schema.prisma` and use it. In `withdrawal/page.tsx`, replace the `lastPayouts`/`initialMethod` loop with `const { lastPayouts, initialMethod } = lastPayoutsFrom(recent);`, import `lastPayoutsFrom` and `type LastPayouts` from `@/lib/withdrawal-prefill`, and make `WithdrawForm`'s `LastPayouts` type an alias of it (`export type { LastPayouts } from "@/lib/withdrawal-prefill";` in `WithdrawForm.tsx` if it currently declares its own).

- [ ] **Step 3: Route + test**

`apps/web/src/app/api/v1/withdrawal-prefill/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { WithdrawalPrefillSchema } from "@asm/contracts";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";
import { loadWithdrawalPrefill } from "@/lib/withdrawal-prefill";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  return noStoreJson(WithdrawalPrefillSchema.parse(await loadWithdrawalPrefill(session.userId)));
}
```

`…/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WithdrawalPrefillSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";
beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `wp-${randomUUID()}@test.local`, passwordHash: "x", firstName: "Asha", lastName: "Rao", kycStatus: "VERIFIED" },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("GET /api/v1/withdrawal-prefill", () => {
  it("returns the KYC name and status with no previous payouts", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v1/withdrawal-prefill", { headers: { authorization: `Bearer ${token}` } }),
    );
    const body = WithdrawalPrefillSchema.parse(await res.json());
    expect(body).toMatchObject({ kycName: "Asha Rao", kycStatus: "VERIFIED", initialMethod: null, heldWithdrawals: [] });
  });
});
```

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @asm/web exec vitest run src/lib/withdrawal-prefill.test.ts src/app/api/v1/withdrawal-prefill src/app/api/withdrawals` → PASS.

```bash
git add apps/web/src/lib/withdrawal-prefill.ts apps/web/src/lib/withdrawal-prefill.test.ts "apps/web/src/app/(platform)/withdrawal" apps/web/src/app/api/v1/withdrawal-prefill
git commit -m "feat(web): /api/v1/withdrawal-prefill shared with the withdrawal page"
```

---

### Task 13: `/api/v1/app/config` and `/api/v1/account/preferences`

**Files:**
- Create: `apps/web/src/lib/app-config.ts`, `apps/web/src/lib/app-config.test.ts`
- Create: `apps/web/src/app/api/v1/app/config/route.ts`
- Modify: `packages/db/src/repositories/profile.ts` (add `setLocale`), `packages/db/src/index.ts`
- Create: `apps/web/src/app/api/v1/account/preferences/route.ts`, `…/route.test.ts`

**Interfaces:**
- Produces:
  - `appConfigFromEnv(env?: Record<string, string | undefined>): AppConfig`
  - `setLocale(userId: string, locale: "en" | "hi"): Promise<void>` (`@asm/db`)
  - `GET /api/v1/app/config` (public) ; `PATCH /api/v1/account/preferences` body `PreferencesUpdate` → `Preferences`

- [ ] **Step 1: Failing test for `appConfigFromEnv`**

```ts
import { describe, expect, it } from "vitest";
import { appConfigFromEnv } from "./app-config";

describe("appConfigFromEnv", () => {
  it("uses safe defaults when nothing is configured", () => {
    expect(appConfigFromEnv({})).toEqual({
      minVersion: "0.0.0",
      latestVersion: "0.0.0",
      apkUrl: "/download/app",
      playUrl: null,
      playLive: false,
      support: { whatsapp: null, telegram: null },
    });
  });

  it("reads versions, Play status and support links", () => {
    const cfg = appConfigFromEnv({
      APP_MIN_VERSION: "1.0.0",
      APP_LATEST_VERSION: "1.3.0",
      APP_PLAY_URL: "https://play.google.com/store/apps/details?id=com.indianxtrade.app",
      APP_PLAY_LIVE: "1",
      SUPPORT_WHATSAPP: "https://wa.me/910000000000",
    });
    expect(cfg).toMatchObject({ minVersion: "1.0.0", latestVersion: "1.3.0", playLive: true });
    expect(cfg.support.whatsapp).toBe("https://wa.me/910000000000");
  });

  it("ignores a malformed version instead of breaking the app", () => {
    expect(appConfigFromEnv({ APP_MIN_VERSION: "v1" }).minVersion).toBe("0.0.0");
  });
});
```

- [ ] **Step 2: Implement `app-config.ts` and the public route**

```ts
import type { AppConfig } from "@asm/contracts";

const SEMVER = /^\d+\.\d+\.\d+$/;
const ON = new Set(["1", "true", "on", "yes"]);

function version(raw: string | undefined): string {
  const v = raw?.trim() ?? "";
  return SEMVER.test(v) ? v : "0.0.0";
}

function link(raw: string | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}

export function appConfigFromEnv(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    minVersion: version(env["APP_MIN_VERSION"]),
    latestVersion: version(env["APP_LATEST_VERSION"]),
    apkUrl: "/download/app",
    playUrl: link(env["APP_PLAY_URL"]),
    playLive: ON.has((env["APP_PLAY_LIVE"] ?? "").trim().toLowerCase()),
    support: { whatsapp: link(env["SUPPORT_WHATSAPP"]), telegram: link(env["SUPPORT_TELEGRAM"]) },
  };
}
```

`apps/web/src/app/api/v1/app/config/route.ts`:

```ts
import { AppConfigSchema } from "@asm/contracts";
import { appConfigFromEnv } from "@/lib/app-config";
import { noStoreJson } from "@/lib/request-session";

/** Public: an old or signed-out app must be able to learn it needs an update. */
export function GET() {
  return noStoreJson(AppConfigSchema.parse(appConfigFromEnv()));
}
```

Add the six env vars to the root `.env.example` with one-line comments.

- [ ] **Step 3: `setLocale` in the db package**

In `packages/db/src/repositories/profile.ts`:

```ts
/** UI/push language. Not KYC-locked: it is a preference, not identity data. */
export async function setLocale(userId: string, locale: "en" | "hi"): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { locale } });
}
```

Export it from `packages/db/src/index.ts` next to `loadProfile`.

- [ ] **Step 4: Failing preferences route test**

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { PATCH } from "./route";

let userId = "";
let token = "";
beforeAll(async () => {
  // PENDING KYC locks profile edits — the language must still be changeable.
  const user = await prisma.user.create({
    data: { email: `pref-${randomUUID()}@test.local`, passwordHash: "x", kycStatus: "PENDING" },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

const patch = (body: unknown) =>
  PATCH(
    new NextRequest("http://localhost/api/v1/account/preferences", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("PATCH /api/v1/account/preferences", () => {
  it("switches the language even while KYC locks the profile", async () => {
    const res = await patch({ locale: "hi" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "hi" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale).toBe("hi");
  });

  it("rejects an unsupported language", async () => {
    expect((await patch({ locale: "fr" })).status).toBe(400);
  });
});
```

- [ ] **Step 5: Implement the preferences route**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { PreferencesSchema, PreferencesUpdateSchema } from "@asm/contracts";
import { prisma, setLocale } from "@asm/db";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const parsed = PreferencesUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unsupported preference.", code: "bad_request" }, { status: 400 });
  }
  if (parsed.data.locale) await setLocale(session.userId, parsed.data.locale);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { locale: true } });
  return noStoreJson(PreferencesSchema.parse({ locale: user.locale }));
}
```

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter @asm/web exec vitest run src/lib/app-config.test.ts src/app/api/v1/account src/app/api/v1/app` → PASS.

```bash
git add apps/web/src/lib/app-config.ts apps/web/src/lib/app-config.test.ts apps/web/src/app/api/v1/app apps/web/src/app/api/v1/account packages/db/src/repositories/profile.ts packages/db/src/index.ts .env.example
git commit -m "feat(web): app config endpoint and language preference"
```

---

### Task 14: Stable error codes in the proxy (maintenance, upgrade required)

**Files:**
- Modify: `apps/web/src/proxy.ts`
- Create: `apps/web/src/lib/app-gate.ts`, `apps/web/src/lib/app-gate.test.ts`

**Interfaces:**
- Consumes: `appVersionFrom`, `compareVersions` (Task 3).
- Produces: `appUpgradeRequired(pathname: string, headers: Pick<Headers, "get">, env?): boolean`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { appUpgradeRequired } from "./app-gate";

const h = (v?: string) => new Headers(v ? { "x-client": `app/${v}` } : {});
const env = { APP_MIN_VERSION: "1.2.0" };

describe("appUpgradeRequired", () => {
  it("blocks an app older than the minimum on API calls", () => {
    expect(appUpgradeRequired("/api/v1/wallet", h("1.1.9"), env)).toBe(true);
  });
  it("lets the minimum version and newer through", () => {
    expect(appUpgradeRequired("/api/v1/wallet", h("1.2.0"), env)).toBe(false);
  });
  it("always lets the app read its config so it can show the update screen", () => {
    expect(appUpgradeRequired("/api/v1/app/config", h("0.1.0"), env)).toBe(false);
  });
  it("never affects the website or non-API paths", () => {
    expect(appUpgradeRequired("/api/v1/wallet", h(), env)).toBe(false);
    expect(appUpgradeRequired("/trade", h("0.1.0"), env)).toBe(false);
  });
  it("is off when no minimum is configured", () => {
    expect(appUpgradeRequired("/api/v1/wallet", h("0.0.1"), {})).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `app-gate.ts`**

```ts
import { appVersionFrom, compareVersions } from "./app-client";

const SEMVER = /^\d+\.\d+\.\d+$/;
const ALWAYS_OPEN = new Set(["/api/v1/app/config"]);

/** True when an app build older than APP_MIN_VERSION calls the API. */
export function appUpgradeRequired(
  pathname: string,
  headers: Pick<Headers, "get">,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!pathname.startsWith("/api/") || ALWAYS_OPEN.has(pathname)) return false;
  const min = env["APP_MIN_VERSION"]?.trim() ?? "";
  if (!SEMVER.test(min)) return false;
  const version = appVersionFrom(headers);
  return version !== null && compareVersions(version, min) < 0;
}
```

- [ ] **Step 3: Wire into the proxy and add the maintenance code**

In `apps/web/src/proxy.ts`:

1. In the maintenance API branch, change the body to
   `{ error: "MAINTENANCE", code: "maintenance", message: "Service temporarily unavailable." }` (keep `error` for existing web callers).
2. Directly after the maintenance block, add:

```ts
  if (appUpgradeRequired(pathname, request.headers)) {
    return NextResponse.json(
      { error: "Update the app to continue.", code: "upgrade_required" },
      { status: 426 },
    );
  }
```

3. Import: `import { appUpgradeRequired } from "@/lib/app-gate";`

Check `proxy.ts`'s `config.matcher` includes `/api/:path*`; if API routes are excluded from the matcher, add them (maintenance JSON for `/api/*` implies they are already included — confirm by reading the matcher).

Add an assertion to `apps/web/src/lib/maintenance.test.ts` (or the existing proxy test if one exists) that the 503 body contains `code: "maintenance"`; if no proxy test exists, create `apps/web/src/proxy.test.ts`:

```ts
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("proxy", () => {
  it("answers API calls during maintenance with the maintenance code", async () => {
    process.env["MAINTENANCE_MODE"] = "1";
    const res = proxy(new NextRequest("http://localhost/api/v1/wallet"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("maintenance");
  });

  it("tells an outdated app to upgrade", async () => {
    process.env["MAINTENANCE_MODE"] = "";
    process.env["APP_MIN_VERSION"] = "2.0.0";
    const res = proxy(new NextRequest("http://localhost/api/v1/wallet", { headers: { "x-client": "app/1.0.0" } }));
    expect(res.status).toBe(426);
  });
});
```

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @asm/web exec vitest run src/lib/app-gate.test.ts src/proxy.test.ts src/lib/maintenance.test.ts` → PASS.

```bash
git add apps/web/src/proxy.ts apps/web/src/lib/app-gate.ts apps/web/src/lib/app-gate.test.ts apps/web/src/proxy.test.ts
git commit -m "feat(web): maintenance code and upgrade-required gate for the app"
```

---

### Task 15: `packages/client-core`

**Files:**
- Create: `packages/client-core/package.json`, `packages/client-core/tsconfig.json`, `packages/client-core/src/index.ts`
- Move (with tests, via `git mv`): see Step 2
- Modify: every importer in `apps/web/src` (Step 4), `apps/web/package.json`

**Interfaces:**
- Produces: `@asm/client-core` re-exporting every moved module's public API under the same names (e.g. `formatMoney`, `minStakeMinor`, `bonusPercentForDeposit`, `BONUS_TIERS`, `buildUpiDeepLink`, `lastDayKey`…). Later sub-projects import only from `@asm/client-core`.

- [ ] **Step 1: Create the package**

`packages/client-core/package.json`:

```json
{
  "name": "@asm/client-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "@asm/contracts": "workspace:*" }
}
```

`packages/client-core/tsconfig.json` — copy `packages/contracts/tsconfig.json` verbatim, then set `"lib": ["ES2023"]` and `"types": []` in `compilerOptions` so DOM and Node globals are unavailable (purity check).

- [ ] **Step 2: Check each candidate is pure, then move it**

Candidates (source → destination under `packages/client-core/src/`):

| From `apps/web/src/` | To |
|---|---|
| `lib/currency.ts` (+test) | `money/currency.ts` |
| `lib/format-money.ts` (+test) | `money/format-money.ts` |
| `lib/format-time.ts` (+test) | `time/format-time.ts` |
| `lib/day.ts` (+test) | `time/day.ts` |
| `lib/expiry-times.ts` (+test) | `trade/expiry-times.ts` |
| `lib/bonus.ts` (+test) | `money/bonus.ts` |
| `lib/upi.ts` (+test) | `payments/upi.ts` |
| `lib/withdrawal-limits.ts` (+test) | `payments/withdrawal-limits.ts` |
| `components/trade/pnl-display.ts` (+test) | `trade/pnl-display.ts` |
| `components/trade/position.ts` (+test) | `trade/position.ts` |
| `components/trade/stake.ts` | `trade/stake.ts` |
| `components/trade/trade-state.ts` (+test) | `trade/trade-state.ts` |
| `components/trade/reconcile.ts` (+test) | `trade/reconcile.ts` |
| `components/chart/engine-state.ts` (+test) | `chart/engine-state.ts` |
| `components/chart/ease.ts` (+test) | `chart/ease.ts` |
| `components/history/history-model.ts` (+test) | `history/history-model.ts` |
| `components/history/timeline-model.ts` (+test) | `history/timeline-model.ts` |
| `components/history/payment-rows.ts` (+test) | `history/payment-rows.ts` |
| `components/deposit/limits.ts` (+test) | `payments/deposit-limits.ts` |
| `components/payments/amount-input.ts` (+test) | `payments/amount-input.ts` |

For each, first run:
```bash
grep -nE "from \"(@/|node:|react|next|@asm/db)" apps/web/src/<file>
```
- No output → `git mv` the file and its `.test.ts` to the destination; rewrite relative imports between moved files.
- Imports `@asm/contracts` → fine (declared dependency).
- Imports anything else (`@/…`, `node:*`, `react`, `next`, `@asm/db`) → **leave that file in `apps/web`** and note it in the PR description; do not move part of it in this task.

Record the per-file verdict in the PR description.

- [ ] **Step 3: Write the barrel**

`packages/client-core/src/index.ts`: one `export * from "./<dir>/<file>";` line per moved file, in the table's order. If two modules export the same name, `tsc` will report it — rename-export the second one explicitly (`export { x as y } from …`) and use that name at its web call sites.

- [ ] **Step 4: Repoint web imports**

Add `"@asm/client-core": "workspace:*"` to `apps/web/package.json` dependencies and run `pnpm install`.

For each moved file, find importers and switch them to the package:
```bash
grep -rln "@/lib/currency\|\./currency\"\|\.\./trade/position" apps/web/src
```
(Repeat per moved module.) Replace each import path with `@asm/client-core`, keeping the imported names.

- [ ] **Step 5: Prove nothing changed**

Before Step 2, record the baseline:
```bash
pnpm --filter @asm/web test 2>&1 | tail -5 > /tmp/web-tests-before.txt
```
After Step 4 run:
```bash
pnpm --filter @asm/client-core test && pnpm --filter @asm/client-core exec tsc --noEmit
pnpm --filter @asm/web test 2>&1 | tail -5
pnpm --filter @asm/web exec tsc --noEmit
pnpm --filter @asm/web build
```
Expected: client-core tests pass; web test count = baseline count minus the moved test count; client-core test count = the moved test count; no type errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/client-core apps/web pnpm-lock.yaml
git commit -m "refactor: move shared pure client logic to @asm/client-core"
```

---

### Task 16: Play pre-check (owner, non-code)

**Files:** none (checklist recorded in the PR description).

- [ ] **Step 1:** Create a Google Play developer account dedicated to this app (not the relay app's account).
- [ ] **Step 2:** In Play Console, create the app "IndianxTrade" with package `com.indianxtrade.app`.
- [ ] **Step 3:** Fill the Financial features declaration truthfully (the app offers fixed-time up/down trading on prices).
- [ ] **Step 4:** After sub-project 2 Task 1 produces a signed skeleton AAB, upload it to **Internal testing** and record Google's review outcome and date in `docs/mobile-release.md` (created in sub-project 5) and in `APP_PLAY_LIVE` (stays empty until approved).

---

## Self-Review Notes

- Spec §1 (bearer sessions) → Tasks 1–5. Spec §2 (native Google) → Task 6. Spec §3 (JSON reads) → Tasks 7–13 (bootstrap 8, wallet 9, payments 10, deposit-config + checkout 11, withdrawal-prefill 12, app config + preferences 13). Spec §4 (locale) → Tasks 1, 8, 13. Spec §5 (error codes) → Tasks 3, 4, 14 (`vpn_blocked` already exists). Spec §6 (client-core) → Task 15. Spec §7 (Play pre-check) → Task 16.
- Logout always clears the cookie (spec said "only when a cookie was used"); clearing is harmless for the app and keeps the web tests unchanged — spec updated to match.
