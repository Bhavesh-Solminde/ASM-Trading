# ASM Trade — Plan 01: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running ASM Trade web app where a person can register, log in, and see their Live account at $0.00 and their Demo account at $10,000.00, with the database schema, logging, and security baseline the later phases build on.

**Architecture:** A pnpm monorepo. `apps/web` is a Next.js App Router application. Four shared packages carry the pieces every later phase needs: `db` (Prisma schema plus an ownership-scoped repository layer), `contracts` (Zod schemas shared by HTTP and, later, WebSocket), `logger` (pino with redaction and correlation ids), and `config` (validated environment). Postgres and Redis run as local Homebrew services — this machine has no container runtime, and both are already installed. Money is stored as integer minor units everywhere; floats never touch a balance.

**Tech Stack:** Node 22 · pnpm 10 · TypeScript 5 · Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Prisma 7 + PostgreSQL 16 · Redis 8 · Zod 4 · pino 10 · argon2 · Vitest 5

## Global Constraints

- **Node `>=22.0.0`.** Next.js 16.3.4 requires `>=20.9.0`; the machine currently runs 18.20.8, which will fail. Task 1 fixes this. Pin with `.nvmrc` and `engines`.
- **No Docker on this machine.** Postgres and Redis run via `brew services`. Never add a `docker-compose.yml` to this plan.
- **Exact dependency versions, no ranges.** `next@16.3.4`, `react@19.3.0`, `react-dom@19.3.0`, `prisma@7.10.0`, `@prisma/client@7.10.0`, `zod@4.6.1`, `tailwindcss@4.3.3`, `pino@10.3.1`, `argon2@0.45.1`, `vitest@5.0.0`, `typescript@5.9.3`.
- **Prisma 7 generator syntax.** `provider = "prisma-client"` with a mandatory `output` path. The old `prisma-client-js` provider is removed in v7.
- **Zod 4 uses `z.strictObject()`.** Every schema that parses external input must be strict — unknown keys are rejected, not stripped. This is what closes mass assignment and role injection.
- **Money is `Int`, in minor units** (cents for USD, paise for INR). Never `Float`, never `Decimal`, never a JS number holding rupees.
- **`role` is never accepted as input.** It exists only on the `User` row and is read server-side per request.
- **Every user-owned query takes `actorId`.** Ownership lives in the query predicate, never in an `if` after the fetch.
- **Demo build only.** No deployment steps, no production secrets, no real payment integration.

---

## File Structure

```
asmtrading/
├── .nvmrc                          Node version pin
├── package.json                    workspace root, scripts
├── pnpm-workspace.yaml             workspace globs
├── tsconfig.base.json              shared TS config
├── eslint.config.mjs               flat config incl. security gates
├── .env.example                    committed
├── .env                            gitignored
├── .gitignore
├── reference/                      the 16 platform screenshots
├── docs/superpowers/plans/         this plan series
├── packages/
│   ├── config/
│   │   ├── package.json
│   │   └── src/index.ts            env parsing — fails fast on bad config
│   ├── logger/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts            pino instance + redaction
│   │       └── correlation.ts      correlation id generation/propagation
│   ├── contracts/
│   │   ├── package.json
│   │   └── src/
│   │       ├── auth.ts             register/login schemas
│   │       └── index.ts            barrel
│   └── db/
│       ├── package.json
│       ├── prisma/
│       │   ├── schema.prisma       full schema, all phases
│       │   └── seed.ts             3 assets + admin user
│       ├── sql/
│       │   └── restrict-role.sql   least-privilege runtime DB role
│       └── src/
│           ├── client.ts           PrismaClient singleton
│           ├── money.ts            integer money helpers
│           ├── repositories/
│           │   ├── account.ts      ownership-scoped account access
│           │   └── user.ts         user lookup by email/id
│           └── index.ts            barrel
└── apps/
    └── web/
        ├── package.json
        ├── next.config.ts
        ├── postcss.config.mjs
        ├── vitest.config.ts
        └── src/
            ├── app/
            │   ├── layout.tsx
            │   ├── globals.css     Tailwind 4 CSS-first entry
            │   ├── page.tsx        redirects by auth state
            │   ├── (auth)/
            │   │   ├── register/page.tsx
            │   │   └── login/page.tsx
            │   ├── (platform)/
            │   │   └── trade/page.tsx    account switcher shell
            │   └── api/
            │       └── auth/
            │           ├── register/route.ts
            │           ├── login/route.ts
            │           └── logout/route.ts
            ├── lib/
            │   ├── password.ts     argon2id hash/verify
            │   ├── session.ts      create/read/destroy sessions
            │   ├── rate-limit.ts   Redis token bucket
            │   └── request-context.ts  correlation id per request
            ├── middleware.ts       security headers
            └── components/
                └── AccountSwitcher.tsx
```

Responsibilities are split so that later phases extend rather than restructure: the engine (Plan 02) imports `db`, `logger`, and `config` without touching `apps/web`; the repository layer is where every later ownership check lands.

---

## Task 1: Repository, toolchain, and workspace scaffold

**Files:**
- Create: `.nvmrc`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Move: the 16 `Screenshot *.png` files into `reference/`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a pnpm workspace where `pnpm -r <script>` runs across `packages/*` and `apps/*`; Node 22 active in the shell

- [ ] **Step 1: Upgrade Node to 22 and verify**

The active Node is 18.20.8. Next.js 16 requires `>=20.9.0`.

```bash
brew install node@22
brew link --overwrite --force node@22
hash -r
node -v
```

Expected: `v22.23.1` or later 22.x. If `node -v` still shows v18, a version manager (nvm/fnm) is shadowing brew — run `nvm install 22 && nvm use 22` or `fnm use 22` instead, then re-check.

- [ ] **Step 2: Initialise git and tidy the working directory**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git init
mkdir -p reference
mv Screenshot*.png reference/
rm -f .DS_Store
ls reference | wc -l
```

Expected: `16`

- [ ] **Step 3: Write `.gitignore`**

```gitignore
node_modules/
.next/
dist/
generated/
.env
.env.local
*.log
.DS_Store
coverage/
.turbo/
```

- [ ] **Step 4: Write `.nvmrc`**

```
22
```

- [ ] **Step 5: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 6: Write root `package.json`**

```json
{
  "name": "asm-trade",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "packageManager": "pnpm@10.33.0",
  "scripts": {
    "dev": "pnpm --filter @asm/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "eslint .",
    "typecheck": "pnpm -r exec tsc --noEmit",
    "db:generate": "pnpm --filter @asm/db generate",
    "db:migrate": "pnpm --filter @asm/db migrate",
    "db:seed": "pnpm --filter @asm/db seed",
    "services:up": "brew services start postgresql@16 && brew services start redis",
    "services:down": "brew services stop postgresql@16 && brew services stop redis"
  },
  "devDependencies": {
    "@types/node": "22.20.2",
    "eslint": "9.42.0",
    "typescript": "5.9.3",
    "vitest": "5.0.0"
  }
}
```

- [ ] **Step 7: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 8: Write `.env.example`**

```bash
# Postgres — local Homebrew service
DATABASE_URL="postgresql://asm_app:asm_dev_password@localhost:5432/asm_trade?schema=public"
DATABASE_MIGRATE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade?schema=public"

# Redis — local Homebrew service
REDIS_URL="redis://localhost:6379"

# Sessions
SESSION_SECRET="change-me-32-bytes-minimum-for-local-dev-only"

# Feed selection — see Plan 05. Only "simulated" is ever configured.
BANK_FEED="simulated"

NODE_ENV="development"
LOG_LEVEL="info"
```

- [ ] **Step 9: Install and commit**

```bash
cp .env.example .env
pnpm install
git add -A
git commit -m "chore: initialise pnpm workspace and toolchain"
```

Expected: install completes; `git log --oneline` shows one commit.

---

## Task 2: Local Postgres and Redis services

**Files:**
- Create: `packages/db/sql/restrict-role.sql`

**Interfaces:**
- Consumes: `.env` from Task 1
- Produces: a running Postgres 16 with database `asm_trade` and two roles — `asm_owner` (migrations, owns schema) and `asm_app` (runtime, DML only, no DDL); a running Redis on 6379

- [ ] **Step 1: Start the services**

Both are already installed via Homebrew (`postgresql@16` 16.15, `redis` 8.8.0).

```bash
brew services start postgresql@16
brew services start redis
sleep 3
pg_isready -h localhost -p 5432
redis-cli ping
```

Expected: `localhost:5432 - accepting connections` and `PONG`.

If `pg_isready` fails, `postgresql@16` may not be on PATH — run `export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"` and retry.

- [ ] **Step 2: Create the database and roles**

```bash
createdb asm_trade 2>/dev/null || echo "database already exists"
psql -d asm_trade -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  CREATE ROLE asm_owner LOGIN PASSWORD 'asm_dev_password';
EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'asm_owner exists'; END $$;
DO $$ BEGIN
  CREATE ROLE asm_app LOGIN PASSWORD 'asm_dev_password';
EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'asm_app exists'; END $$;
ALTER DATABASE asm_trade OWNER TO asm_owner;
GRANT ALL ON SCHEMA public TO asm_owner;
SQL
psql -d asm_trade -c "\du" | grep asm_
```

Expected: both `asm_app` and `asm_owner` listed.

- [ ] **Step 3: Write `packages/db/sql/restrict-role.sql`**

This is the least-privilege control from the threat model: the runtime role can read and write rows but cannot alter the schema, so a SQL-injection bug cannot become schema compromise. It is applied *after* migrations, in Task 4.

```sql
-- Runtime role: DML only. No DDL, no GRANT, no schema ownership.
REVOKE ALL ON SCHEMA public FROM asm_app;
GRANT USAGE ON SCHEMA public TO asm_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO asm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO asm_app;

-- Tables created by future migrations inherit the same grants.
ALTER DEFAULT PRIVILEGES FOR ROLE asm_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO asm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE asm_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO asm_app;

-- AuditLog is append-only even for the runtime role.
REVOKE UPDATE, DELETE ON "AuditLog" FROM asm_app;
```

- [ ] **Step 4: Create the test database**

```bash
createdb asm_trade_test 2>/dev/null || echo "test database already exists"
psql -d asm_trade_test -c "ALTER DATABASE asm_trade_test OWNER TO asm_owner;"
psql -lqt | cut -d'|' -f1 | grep asm_trade
```

Expected: both `asm_trade` and `asm_trade_test` listed.

- [ ] **Step 5: Commit**

```bash
git add packages/db/sql/restrict-role.sql
git commit -m "chore: local postgres and redis service setup"
```

---

## Task 3: Config package — fail-fast environment parsing

**Files:**
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`, `packages/config/src/index.ts`
- Test: `packages/config/src/index.test.ts`

**Interfaces:**
- Consumes: `.env`
- Produces: `import { config } from "@asm/config"` — a frozen, validated object with `databaseUrl`, `redisUrl`, `sessionSecret`, `bankFeed`, `nodeEnv`, `logLevel`. Also exports `parseConfig(env: Record<string,string|undefined>): Config` for testing.

- [ ] **Step 1: Write `packages/config/package.json`**

```json
{
  "name": "@asm/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "zod": "4.6.1" }
}
```

- [ ] **Step 2: Write `packages/config/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing test**

Create `packages/config/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseConfig } from "./index.js";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  BANK_FEED: "simulated",
  NODE_ENV: "development",
  LOG_LEVEL: "info",
};

describe("parseConfig", () => {
  it("parses a valid environment", () => {
    const c = parseConfig(valid);
    expect(c.databaseUrl).toBe(valid.DATABASE_URL);
    expect(c.bankFeed).toBe("simulated");
  });

  it("rejects a session secret under 32 characters", () => {
    expect(() => parseConfig({ ...valid, SESSION_SECRET: "tooshort" })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("rejects an unknown bank feed", () => {
    expect(() => parseConfig({ ...valid, BANK_FEED: "sms-live" })).toThrow();
  });

  it("defaults bank feed to simulated when absent", () => {
    const { BANK_FEED: _omit, ...rest } = valid;
    expect(parseConfig(rest).bankFeed).toBe("simulated");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm --filter @asm/config test
```

Expected: FAIL — `Failed to resolve import "./index.js"`.

- [ ] **Step 5: Write `packages/config/src/index.ts`**

```ts
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  BANK_FEED: z.enum(["simulated", "sms", "email"]).default("simulated"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug"]).default("info"),
});

export type BankFeedKind = "simulated" | "sms" | "email";

export interface Config {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly sessionSecret: string;
  readonly bankFeed: BankFeedKind;
  readonly nodeEnv: "development" | "test" | "production";
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug";
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment — ${detail}`);
  }
  const e = parsed.data;
  return Object.freeze({
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    sessionSecret: e.SESSION_SECRET,
    bankFeed: e.BANK_FEED,
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
  });
}

export const config: Config = parseConfig(process.env);
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm install
pnpm --filter @asm/config test
```

Expected: PASS — 4 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/config
git commit -m "feat: config package with fail-fast env validation"
```

---

## Task 4: Logger package — redaction and correlation ids

**Files:**
- Create: `packages/logger/package.json`, `packages/logger/tsconfig.json`, `packages/logger/src/index.ts`, `packages/logger/src/correlation.ts`
- Test: `packages/logger/src/index.test.ts`

**Interfaces:**
- Consumes: `@asm/config`
- Produces:
  - `logger` — the root pino instance
  - `childLogger(cid: string): Logger` — a logger that stamps `cid` on every line
  - `newCorrelationId(): string` — 6 hex characters
  - `buildLogger(opts: { level: string; destination?: object }): Logger` — for tests

- [ ] **Step 1: Write `packages/logger/package.json`**

```json
{
  "name": "@asm/logger",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@asm/config": "workspace:*",
    "pino": "10.3.1"
  }
}
```

- [ ] **Step 2: Write `packages/logger/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing test**

Create `packages/logger/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { buildLogger, newCorrelationId } from "./index.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)));
      cb();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  it("redacts password, token and cookie fields", () => {
    const { lines, stream } = capture();
    const log = buildLogger({ level: "info", destination: stream });
    log.info(
      { password: "hunter2", token: "abc", cookie: "sid=1", email: "a@b.com" },
      "test",
    );
    const line = lines[0]!;
    expect(line.password).toBe("[REDACTED]");
    expect(line.token).toBe("[REDACTED]");
    expect(line.cookie).toBe("[REDACTED]");
    expect(line.email).toBe("a@b.com");
  });

  it("redacts nested request headers", () => {
    const { lines, stream } = capture();
    const log = buildLogger({ level: "info", destination: stream });
    log.info({ req: { headers: { authorization: "Bearer x" } } }, "test");
    expect((lines[0]!.req as any).headers.authorization).toBe("[REDACTED]");
  });

  it("emits evt and lvl on every line", () => {
    const { lines, stream } = capture();
    const log = buildLogger({ level: "info", destination: stream });
    log.warn({ evt: "engine.feed_gap", asset: "AUDNZD_OTC" }, "gap");
    expect(lines[0]!.evt).toBe("engine.feed_gap");
    expect(lines[0]!.lvl).toBe("warn");
  });

  it("generates 6-character hex correlation ids", () => {
    const id = newCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{6}$/);
    expect(newCorrelationId()).not.toBe(id);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm --filter @asm/logger test
```

Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 5: Write `packages/logger/src/correlation.ts`**

```ts
import { randomBytes } from "node:crypto";

/** Short id stamped on every log line belonging to one request or operation. */
export function newCorrelationId(): string {
  return randomBytes(3).toString("hex");
}
```

- [ ] **Step 6: Write `packages/logger/src/index.ts`**

```ts
import pino, { type Logger, type LoggerOptions } from "pino";
import { config } from "@asm/config";

export { newCorrelationId } from "./correlation.js";
export type { Logger } from "pino";

/**
 * Redaction is applied at the logger, not at call sites, so it cannot be
 * forgotten. Paths are explicit rather than pattern-matched so the list is
 * auditable.
 */
const REDACT_PATHS = [
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "sessionToken",
  "cookie",
  "secret",
  "authorization",
  "*.password",
  "*.token",
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers['set-cookie']",
];

export function buildLogger(opts: {
  level: string;
  destination?: NodeJS.WritableStream;
}): Logger {
  const options: LoggerOptions = {
    level: opts.level,
    base: undefined,
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ lvl: label }),
    },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

export const logger: Logger = buildLogger({ level: config.logLevel });

/** A logger that stamps a correlation id on every line it writes. */
export function childLogger(cid: string): Logger {
  return logger.child({ cid });
}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm install
pnpm --filter @asm/logger test
```

Expected: PASS — 4 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/logger
git commit -m "feat: logger with redaction and correlation ids"
```

---

## Task 5: Database schema

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/prisma/schema.prisma`, `packages/db/src/client.ts`, `packages/db/src/money.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/money.test.ts`

**Interfaces:**
- Consumes: `@asm/config`
- Produces:
  - `prisma` — the shared `PrismaClient`
  - `toMinor(major: number): number`, `toMajor(minor: number): number`, `formatMoney(minor: number, currency: string): string`
  - Generated Prisma types re-exported from `@asm/db`

The full schema lands now — including tables Plans 02–07 use — so later phases add migrations for changes, not for tables that were always going to exist.

- [ ] **Step 1: Write `packages/db/package.json`**

```json
{
  "name": "@asm/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "generate": "prisma generate",
    "migrate": "dotenv -e ../../.env -- prisma migrate dev",
    "seed": "tsx prisma/seed.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@asm/config": "workspace:*",
    "@prisma/client": "7.10.0"
  },
  "devDependencies": {
    "dotenv-cli": "10.0.0",
    "prisma": "7.10.0",
    "tsx": "4.20.6"
  }
}
```

- [ ] **Step 2: Write `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "prisma/**/*.ts"]
}
```

- [ ] **Step 3: Write `packages/db/prisma/schema.prisma`**

Note the Prisma 7 generator block — `provider = "prisma-client"` with a mandatory `output`.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

enum AccountType {
  LIVE
  DEMO
}

enum LifecycleStage {
  PRE_DEPOSIT
  DEPOSITED
  HIGH_VALUE
}

enum KycStatus {
  NOT_STARTED
  PENDING
  VERIFIED
  REJECTED
}

enum AssetKind {
  REAL
  OTC
}

enum Direction {
  UP
  DOWN
}

enum TradeStatus {
  OPEN
  WON
  LOST
  REFUNDED
}

enum DepositStatus {
  AWAITING_PAYMENT
  PENDING_CONFIRMATION
  COMPLETED
  REJECTED
  EXPIRED
}

enum WithdrawalStatus {
  REQUESTED
  APPROVED
  REJECTED
  PAID
}

enum TxKind {
  DEPOSIT
  WITHDRAWAL
  TRADE_STAKE
  TRADE_PAYOUT
  TRADE_REFUND
  BONUS_GRANT
  BONUS_CONVERT
  DEMO_RESET
}

model User {
  id                  String    @id @default(uuid())
  email               String    @unique
  passwordHash        String
  role                Role      @default(USER)
  emailVerified       Boolean   @default(false)
  twoFaEnabled        Boolean   @default(false)
  twoFaForLogin       Boolean   @default(false)
  twoFaForWithdrawal  Boolean   @default(false)
  nickname            String?
  firstName           String?
  lastName            String?
  dateOfBirth         DateTime?
  aadhaar             String?
  address             String?
  country             String?
  kycStatus           KycStatus @default(NOT_STARTED)
  cumulativeDeposits  Int       @default(0)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  accounts    Account[]
  sessions    Session[]
  deposits    Deposit[]
  withdrawals Withdrawal[]

  @@index([email])
}

model Session {
  id         String   @id @default(uuid())
  userId     String
  tokenHash  String   @unique
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  lastUsedAt DateTime @default(now())
  ipAddress  String?
  userAgent  String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}

model Account {
  id               String         @id @default(uuid())
  userId           String
  type             AccountType
  currency         String         @default("USD")
  realBalance      Int            @default(0)
  bonusBalance     Int            @default(0)
  turnoverProgress Int            @default(0)
  lifecycleStage   LifecycleStage @default(PRE_DEPOSIT)
  rollingWinRate   Float          @default(0)
  tradesCount      Int            @default(0)
  medianStake      Int            @default(100)
  lossStreak       Int            @default(0)
  winStreak        Int            @default(0)
  dailyLimit       Int?
  version          Int            @default(0)
  createdAt        DateTime       @default(now())

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  trades       Trade[]
  transactions Transaction[]
  bonusGrants  BonusGrant[]

  @@unique([userId, type])
  @@index([userId])
}

model Asset {
  id          String    @id @default(uuid())
  symbol      String    @unique
  displayName String
  kind        AssetKind
  payoutPct   Int       @default(100)
  payoutMin   Int       @default(100)
  payoutMax   Int       @default(100)
  isOpen      Boolean   @default(true)
  tickSize    Float     @default(0.00001)
  precision   Int       @default(5)
  basePrice   Float     @default(1.0)
  garchOmega  Float     @default(0.000001)
  garchAlpha  Float     @default(0.08)
  garchBeta   Float     @default(0.90)
  anchorAlpha Float     @default(0.08)
  createdAt   DateTime  @default(now())

  candles Candle[]
  trades  Trade[]
}

model Candle {
  assetId   String
  timeframe String
  openTs    DateTime
  o         Float
  h         Float
  l         Float
  c         Float
  shadowO   Float?
  shadowH   Float?
  shadowL   Float?
  shadowC   Float?

  asset Asset @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@id([assetId, timeframe, openTs])
  @@index([assetId, timeframe, openTs])
}

model Trade {
  id         String      @id @default(uuid())
  accountId  String
  assetId    String
  direction  Direction
  stake      Int
  payoutPct  Int
  entryPrice Float
  entryTs    DateTime
  expiryTs   DateTime
  exitPrice  Float?
  status     TradeStatus @default(OPEN)
  pnl        Int         @default(0)
  createdAt  DateTime    @default(now())

  account Account      @relation(fields: [accountId], references: [id], onDelete: Cascade)
  asset   Asset        @relation(fields: [assetId], references: [id])
  shadow  TradeShadow?

  @@index([accountId, createdAt])
  @@index([expiryTs, status])
}

/// Recorded for every settled trade, never exposed to a trading client.
model TradeShadow {
  tradeId          String   @id
  shownExitPrice   Float
  honestExitPrice  Float
  shownResult      String
  honestResult     String
  deltaPips        Float
  biasApplied      Float
  magnetApplied    Float
  imbalanceAtEntry Float
  exposureUp       Int
  exposureDown     Int
  lifecycleStage   String
  createdAt        DateTime @default(now())

  trade Trade @relation(fields: [tradeId], references: [id], onDelete: Cascade)
}

model ShadowTick {
  id          BigInt   @id @default(autoincrement())
  assetId     String
  ts          DateTime
  shownPrice  Float
  honestPrice Float

  @@index([assetId, ts])
}

model Deposit {
  id              String        @id @default(uuid())
  userId          String
  method          String
  amountUsd       Int
  amountInr       Int
  vpa             String
  checkoutToken   String        @unique
  claimedUtr      String?
  status          DepositStatus @default(AWAITING_PAYMENT)
  matchedCreditId String?
  correlationId   String
  expiresAt       DateTime
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  // NOTE: the amount-reservation guarantee needs a PARTIAL unique index —
  // unique on (vpa, amountInr) only WHERE status IN ('AWAITING_PAYMENT',
  // 'PENDING_CONFIRMATION'). Prisma cannot express that declaratively, so
  // Plan 05 adds it via a hand-written migration. A plain @@unique here would
  // be wrong: it would block two legitimate COMPLETED deposits that happened to
  // share an amount months apart.
  @@index([vpa, amountInr, status])
  @@index([userId, createdAt])
  @@index([status])
}

/// Stands in for a bank statement. Populated by whichever BankFeed is configured.
model BankCredit {
  id         String   @id @default(uuid())
  vpa        String
  amountInr  Int
  utr        String   @unique
  receivedAt DateTime
  raw        String?
  consumed   Boolean  @default(false)
  createdAt  DateTime @default(now())

  @@index([vpa, amountInr, consumed])
}

model Withdrawal {
  id         String           @id @default(uuid())
  userId     String
  amount     Int
  method     String
  status     WithdrawalStatus @default(REQUESTED)
  reviewedBy String?
  reason     String?
  createdAt  DateTime         @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
}

/// Append-only ledger. Every balance change writes exactly one row.
model Transaction {
  id           String   @id @default(uuid())
  accountId    String
  kind         TxKind
  amount       Int
  balanceAfter Int
  refType      String?
  refId        String?
  createdAt    DateTime @default(now())

  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, createdAt])
}

model BonusGrant {
  id               String   @id @default(uuid())
  accountId        String
  amount           Int
  turnoverRequired Int
  turnoverDone     Int      @default(0)
  status           String   @default("ACTIVE")
  createdAt        DateTime @default(now())

  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
}

/// Append-only. UPDATE and DELETE are revoked from the runtime role.
model AuditLog {
  id         String   @id @default(uuid())
  actorId    String?
  action     String
  targetType String
  targetId   String
  before     Json?
  after      Json?
  createdAt  DateTime @default(now())

  @@index([targetType, targetId])
  @@index([createdAt])
}
```

- [ ] **Step 4: Write the failing money test**

Create `packages/db/src/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatMoney, toMajor, toMinor } from "./money.js";

describe("money", () => {
  it("converts major units to integer minor units", () => {
    expect(toMinor(100)).toBe(10000);
    expect(toMinor(10.5)).toBe(1050);
    expect(toMinor(0.01)).toBe(1);
  });

  it("rounds half away from zero rather than using float truncation", () => {
    expect(toMinor(0.005)).toBe(1);
    expect(toMinor(10.145)).toBe(1015);
  });

  it("converts minor units back to major", () => {
    expect(toMajor(10000)).toBe(100);
    expect(toMajor(1050)).toBe(10.5);
  });

  it("rejects non-integer minor units", () => {
    expect(() => toMajor(10.5)).toThrow(/integer/);
  });

  it("formats with two decimals and a currency symbol", () => {
    expect(formatMoney(1000646, "USD")).toBe("$10,006.46");
    expect(formatMoney(1076400, "INR")).toBe("₹10,764.00");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
pnpm --filter @asm/db test
```

Expected: FAIL — cannot resolve `./money.js`.

- [ ] **Step 6: Write `packages/db/src/money.ts`**

```ts
/**
 * Money is stored as integer minor units everywhere — cents for USD, paise for
 * INR. No balance is ever a float. These helpers are the only sanctioned way to
 * cross between display values and stored values.
 */

const MINOR_PER_MAJOR = 100;

/** 100.5 -> 10050. Rounds half away from zero. */
export function toMinor(major: number): number {
  if (!Number.isFinite(major)) {
    throw new Error(`toMinor: expected a finite number, received ${major}`);
  }
  const scaled = major * MINOR_PER_MAJOR;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** 10050 -> 100.5. Only for display; never feed the result back into arithmetic. */
export function toMajor(minor: number): number {
  if (!Number.isInteger(minor)) {
    throw new Error(`toMajor: expected an integer, received ${minor}`);
  }
  return minor / MINOR_PER_MAJOR;
}

const SYMBOLS: Record<string, string> = { USD: "$", INR: "₹", EUR: "€" };

export function formatMoney(minor: number, currency: string): string {
  const symbol = SYMBOLS[currency] ?? "";
  const value = toMajor(minor).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${value}`;
}
```

- [ ] **Step 7: Write `packages/db/src/client.ts`**

```ts
import { PrismaClient } from "../generated/prisma/client.js";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * A single client per process. Next.js dev-server hot reload would otherwise
 * open a new pool on every edit until Postgres refuses connections.
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 8: Write `packages/db/src/index.ts`**

```ts
export { prisma } from "./client.js";
export { toMinor, toMajor, formatMoney } from "./money.js";
export * from "../generated/prisma/client.js";
```

- [ ] **Step 9: Generate the client and run the migration**

```bash
pnpm install
cd packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade?schema=public" \
  pnpm exec prisma migrate dev --name init
cd ../..
psql -d asm_trade -c "\dt" | grep -c .
```

Expected: migration applies; the table count is 13 or more.

- [ ] **Step 10: Apply the restricted runtime role**

```bash
psql -d asm_trade -v ON_ERROR_STOP=1 -f packages/db/sql/restrict-role.sql
psql -d asm_trade -c "SELECT has_table_privilege('asm_app','\"User\"','SELECT') AS can_read, has_table_privilege('asm_app','\"AuditLog\"','DELETE') AS can_delete_audit;"
```

Expected: `can_read = t`, `can_delete_audit = f`.

- [ ] **Step 11: Run the money test to verify it passes**

```bash
pnpm --filter @asm/db test
```

Expected: PASS — 5 tests.

- [ ] **Step 12: Commit**

```bash
git add packages/db
git commit -m "feat: prisma schema, money helpers, restricted runtime role"
```

---

## Task 6: Seed data

**Files:**
- Create: `packages/db/prisma/seed.ts`

**Interfaces:**
- Consumes: `@asm/db`
- Produces: three seeded assets (`USDJPY`, `AUDNZD_OTC`, `EURUSD_OTC`) and one admin user whose password is printed once

- [ ] **Step 1: Write `packages/db/prisma/seed.ts`**

Payouts start at 100% per the specification, adjustable later from the admin panel.

```ts
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { PrismaClient } from "../generated/prisma/client.js";

const prisma = new PrismaClient();

async function main() {
  await prisma.asset.upsert({
    where: { symbol: "USDJPY" },
    update: {},
    create: {
      symbol: "USDJPY",
      displayName: "USD/JPY",
      kind: "REAL",
      payoutPct: 100,
      payoutMin: 60,
      payoutMax: 100,
      basePrice: 157.25,
      precision: 3,
      tickSize: 0.001,
    },
  });

  await prisma.asset.upsert({
    where: { symbol: "AUDNZD_OTC" },
    update: {},
    create: {
      symbol: "AUDNZD_OTC",
      displayName: "AUD/NZD (OTC)",
      kind: "OTC",
      payoutPct: 100,
      payoutMin: 85,
      payoutMax: 100,
      basePrice: 1.1735,
      precision: 5,
      tickSize: 0.00001,
    },
  });

  await prisma.asset.upsert({
    where: { symbol: "EURUSD_OTC" },
    update: {},
    create: {
      symbol: "EURUSD_OTC",
      displayName: "EUR/USD (OTC)",
      kind: "OTC",
      payoutPct: 100,
      payoutMin: 85,
      payoutMax: 100,
      basePrice: 1.0842,
      precision: 5,
      tickSize: 0.00001,
    },
  });

  const existingAdmin = await prisma.user.findUnique({
    where: { email: "admin@asmtrade.local" },
  });

  if (!existingAdmin) {
    // Random password printed once — never a known default, per the threat model.
    const password = randomBytes(12).toString("base64url");
    const admin = await prisma.user.create({
      data: {
        email: "admin@asmtrade.local",
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: "ADMIN",
        emailVerified: true,
      },
    });
    await prisma.account.createMany({
      data: [
        { userId: admin.id, type: "LIVE", realBalance: 0 },
        { userId: admin.id, type: "DEMO", realBalance: 1_000_000 },
      ],
    });
    console.log("\n  Admin created: admin@asmtrade.local");
    console.log(`  Password (shown once): ${password}\n`);
  } else {
    console.log("  Admin already exists — password unchanged.");
  }

  const assets = await prisma.asset.count();
  console.log(`  Seeded. Assets: ${assets}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add argon2 to the db package**

```bash
pnpm --filter @asm/db add argon2@0.45.1
```

- [ ] **Step 3: Run the seed**

```bash
cd packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade?schema=public" \
  pnpm exec tsx prisma/seed.ts
cd ../..
```

Expected: `Seeded. Assets: 3` plus a printed admin password. **Save that password.**

- [ ] **Step 4: Verify idempotency**

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade?schema=public" pnpm exec tsx prisma/seed.ts; cd ../..
```

Expected: `Admin already exists — password unchanged.` and still `Assets: 3`.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat: seed three assets and an admin user"
```

---

## Task 7: Contracts package — strict Zod schemas

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/auth.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/auth.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `RegisterInput`, `LoginInput` (types) and `RegisterSchema`, `LoginSchema` (Zod schemas). Both are strict — unknown keys throw.

- [ ] **Step 1: Write `packages/contracts/package.json`**

```json
{
  "name": "@asm/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "zod": "4.6.1" }
}
```

- [ ] **Step 2: Write `packages/contracts/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing test**

This test is the security control from the threat model, expressed as an assertion: a request carrying `role` must be **rejected**, not silently stripped.

Create `packages/contracts/src/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LoginSchema, RegisterSchema } from "./auth.js";

describe("RegisterSchema", () => {
  const valid = { email: "a@b.com", password: "correct-horse-battery" };

  it("accepts a valid registration", () => {
    expect(RegisterSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an injected role field rather than stripping it", () => {
    const result = RegisterSchema.safeParse({ ...valid, role: "ADMIN" });
    expect(result.success).toBe(false);
  });

  it("rejects an injected balance field", () => {
    const result = RegisterSchema.safeParse({ ...valid, realBalance: 999999 });
    expect(result.success).toBe(false);
  });

  it("rejects a password under 12 characters", () => {
    expect(RegisterSchema.safeParse({ ...valid, password: "short" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed email", () => {
    expect(RegisterSchema.safeParse({ ...valid, email: "nope" }).success).toBe(
      false,
    );
  });

  it("lowercases and trims the email", () => {
    const parsed = RegisterSchema.parse({ ...valid, email: "  A@B.COM  " });
    expect(parsed.email).toBe("a@b.com");
  });
});

describe("LoginSchema", () => {
  it("rejects unknown keys", () => {
    const result = LoginSchema.safeParse({
      email: "a@b.com",
      password: "correct-horse-battery",
      impersonate: "someone-else",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm --filter @asm/contracts test
```

Expected: FAIL — cannot resolve `./auth.js`.

- [ ] **Step 5: Write `packages/contracts/src/auth.ts`**

`z.strictObject` is the Zod 4 form. Every boundary schema in this codebase uses it.

```ts
import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address");

const password = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(200, "Password is too long");

/**
 * Strict: a body containing `role`, `realBalance`, or any other unexpected key
 * is rejected outright. Stripping would silently accept a privilege-escalation
 * attempt; rejecting makes it visible and loggable.
 */
export const RegisterSchema = z.strictObject({ email, password });
export const LoginSchema = z.strictObject({ email, password });

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
```

- [ ] **Step 6: Write `packages/contracts/src/index.ts`**

```ts
export {
  RegisterSchema,
  LoginSchema,
  type RegisterInput,
  type LoginInput,
} from "./auth.js";
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm install
pnpm --filter @asm/contracts test
```

Expected: PASS — 7 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts
git commit -m "feat: strict zod contracts for auth"
```

---

## Task 8: Ownership-scoped repository layer

**Files:**
- Create: `packages/db/src/repositories/account.ts`, `packages/db/src/repositories/user.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/repositories/account.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@asm/db`
- Produces:
  - `listAccountsForActor(actorId: string): Promise<Account[]>`
  - `getAccountForActor(actorId: string, accountId: string): Promise<Account | null>`
  - `createAccountsForUser(userId: string, demoBalanceMinor: number): Promise<Account[]>`
  - `findUserByEmail(email: string): Promise<User | null>`
  - `findUserById(id: string): Promise<User | null>`

This is the single most important security control in the plan. **Every function that reads a user-owned row takes `actorId` as a required first argument**, and ownership goes in the `where` clause — never in a check after the fetch. Plans 03–07 add repositories here following the same shape.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/repositories/account.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client.js";
import {
  createAccountsForUser,
  getAccountForActor,
  listAccountsForActor,
} from "./account.js";

const prisma = new PrismaClient();

let alice = "";
let bob = "";
let aliceLiveId = "";

beforeAll(async () => {
  const a = await prisma.user.create({
    data: { email: `alice-${Date.now()}@test.local`, passwordHash: "x" },
  });
  const b = await prisma.user.create({
    data: { email: `bob-${Date.now()}@test.local`, passwordHash: "x" },
  });
  alice = a.id;
  bob = b.id;
  const accounts = await createAccountsForUser(alice, 1_000_000);
  await createAccountsForUser(bob, 1_000_000);
  aliceLiveId = accounts.find((x) => x.type === "LIVE")!.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
  await prisma.$disconnect();
});

describe("account repository", () => {
  it("creates exactly one live and one demo account", async () => {
    const accounts = await listAccountsForActor(alice);
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.type).sort()).toEqual(["DEMO", "LIVE"]);
  });

  it("funds the demo account and leaves live at zero", async () => {
    const accounts = await listAccountsForActor(alice);
    expect(accounts.find((a) => a.type === "DEMO")!.realBalance).toBe(1_000_000);
    expect(accounts.find((a) => a.type === "LIVE")!.realBalance).toBe(0);
  });

  it("returns an owned account to its owner", async () => {
    const account = await getAccountForActor(alice, aliceLiveId);
    expect(account).not.toBeNull();
    expect(account!.userId).toBe(alice);
  });

  it("returns null when another user requests it by id", async () => {
    const account = await getAccountForActor(bob, aliceLiveId);
    expect(account).toBeNull();
  });

  it("never leaks another user's accounts in a list", async () => {
    const accounts = await listAccountsForActor(bob);
    expect(accounts.every((a) => a.userId === bob)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade_test?schema=public" pnpm exec vitest run src/repositories; cd ../..
```

Expected: FAIL — cannot resolve `./account.js`.

- [ ] **Step 3: Apply migrations to the test database**

```bash
cd packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade_test?schema=public" \
  pnpm exec prisma migrate deploy
cd ../..
```

Expected: `All migrations have been successfully applied.`

- [ ] **Step 4: Write `packages/db/src/repositories/account.ts`**

```ts
import { prisma } from "../client.js";
import type { Account } from "../../generated/prisma/client.js";

/**
 * Ownership is expressed in the query predicate, never as a check after the
 * fetch. A caller cannot forget it because `actorId` is a required parameter —
 * this is what closes broken-object-level-authorisation by construction.
 */

export async function listAccountsForActor(actorId: string): Promise<Account[]> {
  return prisma.account.findMany({
    where: { userId: actorId },
    orderBy: { type: "asc" },
  });
}

export async function getAccountForActor(
  actorId: string,
  accountId: string,
): Promise<Account | null> {
  return prisma.account.findFirst({
    where: { id: accountId, userId: actorId },
  });
}

/** Every user gets exactly one LIVE account at zero and one funded DEMO account. */
export async function createAccountsForUser(
  userId: string,
  demoBalanceMinor: number,
): Promise<Account[]> {
  return prisma.$transaction([
    prisma.account.create({
      data: { userId, type: "LIVE", realBalance: 0 },
    }),
    prisma.account.create({
      data: { userId, type: "DEMO", realBalance: demoBalanceMinor },
    }),
  ]);
}
```

- [ ] **Step 5: Write `packages/db/src/repositories/user.ts`**

```ts
import { prisma } from "../client.js";
import type { User } from "../../generated/prisma/client.js";

/**
 * Users are not user-owned rows in the same sense — a person looks up only
 * themselves, and login looks up by email before any session exists. Neither
 * function ever accepts or writes `role`.
 */

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}
```

- [ ] **Step 6: Update `packages/db/src/index.ts`**

```ts
export { prisma } from "./client.js";
export { toMinor, toMajor, formatMoney } from "./money.js";
export {
  listAccountsForActor,
  getAccountForActor,
  createAccountsForUser,
} from "./repositories/account.js";
export { findUserByEmail, findUserById } from "./repositories/user.js";
export * from "../generated/prisma/client.js";
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd packages/db && DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5432/asm_trade_test?schema=public" pnpm exec vitest run src/repositories; cd ../..
```

Expected: PASS — 5 tests. The fourth ("returns null when another user requests it by id") is the IDOR guard.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat: ownership-scoped account and user repositories"
```

---

## Task 9: Web app scaffold

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/page.tsx`, `apps/web/src/middleware.ts`

**Interfaces:**
- Consumes: `@asm/config`, `@asm/db`, `@asm/logger`
- Produces: a Next.js app on `http://localhost:3000` serving a dark ASM Trade shell with security headers on every response

- [ ] **Step 1: Write `apps/web/package.json`**

```json
{
  "name": "@asm/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --turbopack -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "test": "vitest run"
  },
  "dependencies": {
    "@asm/config": "workspace:*",
    "@asm/contracts": "workspace:*",
    "@asm/db": "workspace:*",
    "@asm/logger": "workspace:*",
    "argon2": "0.45.1",
    "ioredis": "5.9.0",
    "next": "16.3.4",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "tailwindcss": "4.3.3"
  }
}
```

- [ ] **Step 2: Write `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "noEmit": true,
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `apps/web/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@asm/db", "@asm/config", "@asm/logger", "@asm/contracts"],
  productionBrowserSourceMaps: false,
};

export default nextConfig;
```

- [ ] **Step 4: Write `apps/web/postcss.config.mjs`**

Tailwind 4 is CSS-first — the PostCSS plugin moved to its own package and there is no `tailwind.config.js`.

```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

- [ ] **Step 5: Write `apps/web/src/app/globals.css`**

```css
@import "tailwindcss";

@theme {
  --color-shell: #0e1621;
  --color-panel: #16202c;
  --color-panel-2: #1c2836;
  --color-edge: #253243;
  --color-ink: #e8edf3;
  --color-ink-2: #93a2b4;
  --color-up: #2fbd85;
  --color-down: #e0526a;
  --color-brand: #3d8bfd;
}

html,
body {
  background: var(--color-shell);
  color: var(--color-ink);
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
```

- [ ] **Step 6: Write `apps/web/src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASM Trade",
  description: "Demonstration trading platform — simulated, no real money.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Write `apps/web/src/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers set centrally so no route can omit them. Asserted by an
 * integration test in Task 13 rather than by inspection.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
```

`'unsafe-inline'` on `script-src` is required by Next's dev-mode hydration and is acceptable for a demo. Plan 07 replaces it with nonces.

- [ ] **Step 8: Write `apps/web/src/app/page.tsx`**

```tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
          Demonstration build — simulated, no real money
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight">ASM Trade</h1>
      </div>
      <div className="flex gap-3">
        <Link
          href="/register"
          className="rounded-lg bg-[var(--color-up)] px-5 py-2.5 text-sm font-semibold text-[#06231a]"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-5 py-2.5 text-sm font-semibold"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 9: Make the root `.env` visible to Next.js**

Next.js loads `.env` from its own project directory (`apps/web`), not from the
monorepo root. Without this, `@asm/config` throws `Invalid environment` the
moment the app boots. Symlink rather than copy, so there is one source of truth.

```bash
ln -sf ../../.env apps/web/.env
echo "apps/web/.env" >> .gitignore
readlink apps/web/.env
```

Expected: `../../.env`

- [ ] **Step 10: Run the dev server and verify**

```bash
pnpm install
pnpm dev
```

In a second terminal:

```bash
curl -s -D- -o /dev/null http://localhost:3000 | grep -iE "x-frame-options|content-security-policy"
```

Expected: both headers present, `X-Frame-Options: DENY`.

- [ ] **Step 11: Commit**

```bash
git add apps/web .gitignore
git commit -m "feat: next.js app shell with security headers"
```

---

## Task 10: Password hashing and sessions

**Files:**
- Create: `apps/web/src/lib/password.ts`, `apps/web/src/lib/session.ts`, `apps/web/vitest.config.ts`
- Test: `apps/web/src/lib/password.test.ts`

**Interfaces:**
- Consumes: `@asm/db`
- Produces:
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(hash: string, plain: string): Promise<boolean>`
  - `createSession(userId: string, meta: { ip?: string; userAgent?: string }): Promise<string>` — returns the raw token
  - `readSession(token: string | undefined): Promise<{ userId: string; role: Role } | null>`
  - `destroySession(token: string): Promise<void>`
  - `SESSION_COOKIE` — the cookie name constant

- [ ] **Step 1: Write `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("produces an argon2id hash", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword(hash, "correct-horse-battery")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword(hash, "wrong-password-here")).toBe(false);
  });

  it("produces a different hash for the same input", async () => {
    const a = await hashPassword("correct-horse-battery");
    const b = await hashPassword("correct-horse-battery");
    expect(a).not.toBe(b);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "anything-at-all")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @asm/web test
```

Expected: FAIL — cannot resolve `./password.js`.

- [ ] **Step 4: Write `apps/web/src/lib/password.ts`**

```ts
import argon2 from "argon2";

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed stored hash — a corrupt row
 * must read as "wrong password", never as a 500 that reveals the row exists.
 */
export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm install
pnpm --filter @asm/web test
```

Expected: PASS — 5 tests.

- [ ] **Step 6: Write `apps/web/src/lib/session.ts`**

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma, type Role } from "@asm/db";

export const SESSION_COOKIE = "asm_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/** Tokens are stored hashed — a database leak must not yield usable sessions. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return token;
}

/**
 * Role is read from the database on every request, never carried in the cookie.
 * A stolen or forged cookie cannot assert a role it does not have.
 */
export async function readSession(
  token: string | undefined,
): Promise<{ userId: string; role: Role } | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const stored = Buffer.from(session.tokenHash, "hex");
  const supplied = Buffer.from(hashToken(token), "hex");
  if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    return null;
  }

  return { userId: session.user.id, role: session.user.role };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session
    .delete({ where: { tokenHash: hashToken(token) } })
    .catch(() => {});
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};
```

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: argon2id password hashing and hashed session tokens"
```

---

## Task 11: Registration

**Files:**
- Create: `apps/web/src/lib/request-context.ts`, `apps/web/src/app/api/auth/register/route.ts`, `apps/web/src/app/(auth)/register/page.tsx`

**Interfaces:**
- Consumes: `RegisterSchema` from `@asm/contracts`; `createAccountsForUser`, `findUserByEmail` from `@asm/db`; `hashPassword`, `createSession` from Task 10
- Produces: `POST /api/auth/register` returning `201 { userId }` and setting the session cookie; `requestContext(req): { cid: string; ip: string; userAgent: string }`

- [ ] **Step 1: Write `apps/web/src/lib/request-context.ts`**

```ts
import { newCorrelationId } from "@asm/logger";
import type { NextRequest } from "next/server";

export interface RequestContext {
  cid: string;
  ip: string;
  userAgent: string;
}

export function requestContext(req: NextRequest): RequestContext {
  return {
    cid: newCorrelationId(),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local",
    userAgent: req.headers.get("user-agent") ?? "unknown",
  };
}
```

- [ ] **Step 2: Write `apps/web/src/app/api/auth/register/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { RegisterSchema } from "@asm/contracts";
import { createAccountsForUser, findUserByEmail, prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { hashPassword } from "@/lib/password";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  createSession,
} from "@/lib/session";
import { requestContext } from "@/lib/request-context";

const DEMO_START_BALANCE = 1_000_000; // $10,000.00 in cents

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const body: unknown = await req.json().catch(() => null);
  const parsed = RegisterSchema.safeParse(body);

  if (!parsed.success) {
    // A rejected unknown key here is a privilege-escalation attempt worth seeing.
    log.warn(
      { evt: "security.validation_rejected", route: "register" },
      "invalid registration payload",
    );
    return NextResponse.json(
      { error: "Check the details you entered and try again." },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;

  if (await findUserByEmail(email)) {
    log.info({ evt: "auth.register_duplicate" }, "email already registered");
    return NextResponse.json(
      { error: "That email is already registered." },
      { status: 409 },
    );
  }

  // role is never set here — it defaults to USER in the schema.
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password) },
    select: { id: true },
  });

  await createAccountsForUser(user.id, DEMO_START_BALANCE);

  const token = await createSession(user.id, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  log.info({ evt: "auth.register", userId: user.id }, "account created");

  const response = NextResponse.json({ userId: user.id }, { status: 201 });
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
}
```

- [ ] **Step 3: Write `apps/web/src/app/(auth)/register/page.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      router.push("/trade");
      return;
    }
    const data = (await res.json()) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <input
          type="password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password — at least 12 characters"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        {error ? <p className="text-sm text-[var(--color-down)]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[var(--color-up)] px-4 py-2.5 text-sm font-semibold text-[#06231a] disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Verify registration end to end**

With `pnpm dev` running:

```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"trader@test.local","password":"correct-horse-battery"}' \
  -D- -o /tmp/reg.json | grep -iE "^HTTP|set-cookie"
cat /tmp/reg.json
```

Expected: `HTTP/1.1 201`, a `set-cookie: asm_session=...; HttpOnly; SameSite=Strict` header, and a JSON body with `userId`.

- [ ] **Step 5: Verify the role-injection rejection**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"attacker@test.local","password":"correct-horse-battery","role":"ADMIN"}'
```

Expected: `400`. Confirm no user was created:

```bash
psql -d asm_trade -c "SELECT count(*) FROM \"User\" WHERE email='attacker@test.local';"
```

Expected: `0`.

- [ ] **Step 6: Verify both accounts exist with correct balances**

```bash
psql -d asm_trade -c "SELECT a.type, a.\"realBalance\" FROM \"Account\" a JOIN \"User\" u ON u.id=a.\"userId\" WHERE u.email='trader@test.local' ORDER BY a.type;"
```

Expected: `DEMO | 1000000` and `LIVE | 0`.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: registration creating live and demo accounts"
```

---

## Task 12: Login, logout, and rate limiting

**Files:**
- Create: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/api/auth/login/route.ts`, `apps/web/src/app/api/auth/logout/route.ts`, `apps/web/src/app/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: `LoginSchema`, `findUserByEmail`, `verifyPassword`, `createSession`, `destroySession`
- Produces: `POST /api/auth/login` → `200 { userId }` + cookie; `POST /api/auth/logout` → `204`; `checkRateLimit(key: string, limit: number, windowSec: number): Promise<boolean>`

- [ ] **Step 1: Write `apps/web/src/lib/rate-limit.ts`**

```ts
import Redis from "ioredis";
import { config } from "@asm/config";

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });

/**
 * Fixed-window counter. Returns true when the request is allowed.
 * Fails CLOSED — if Redis is unreachable, auth attempts are refused rather
 * than waved through.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return count <= limit;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Write `apps/web/src/app/api/auth/login/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { LoginSchema } from "@asm/contracts";
import { findUserByEmail } from "@asm/db";
import { childLogger } from "@asm/logger";
import { verifyPassword, hashPassword } from "@/lib/password";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  createSession,
} from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";

const GENERIC = "Email or password is incorrect.";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const body: unknown = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: GENERIC }, { status: 400 });
  }
  const { email, password } = parsed.data;

  // Limit by IP and by account — one alone leaves a gap.
  const okIp = await checkRateLimit(`rl:login:ip:${ctx.ip}`, 20, 300);
  const okAccount = await checkRateLimit(`rl:login:acct:${email}`, 5, 300);
  if (!okIp || !okAccount) {
    log.warn({ evt: "security.rate_limited", route: "login" }, "login throttled");
    return NextResponse.json(
      { error: "Too many attempts. Wait five minutes and try again." },
      { status: 429 },
    );
  }

  const user = await findUserByEmail(email);

  // Hash a dummy value on miss so response timing does not reveal whether the
  // account exists.
  if (!user) {
    await hashPassword("no-such-user-timing-equaliser");
    log.info({ evt: "auth.failed", reason: "no_user" }, "login failed");
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    log.info(
      { evt: "auth.failed", reason: "bad_password", userId: user.id },
      "login failed",
    );
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  const token = await createSession(user.id, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  log.info({ evt: "auth.login", userId: user.id }, "login succeeded");

  const response = NextResponse.json({ userId: user.id }, { status: 200 });
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
}
```

- [ ] **Step 3: Write `apps/web/src/app/api/auth/logout/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
```

- [ ] **Step 4: Write `apps/web/src/app/(auth)/login/page.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      router.push("/trade");
      return;
    }
    const data = (await res.json()) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        {error ? <p className="text-sm text-[var(--color-down)]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Log in"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Verify login**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"trader@test.local","password":"correct-horse-battery"}'
```

Expected: `200`.

- [ ] **Step 6: Verify wrong password and rate limiting**

```bash
for i in 1 2 3 4 5 6 7; do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"trader@test.local","password":"wrong-password-here"}'
done; echo
```

Expected: five `401` responses, then `429`. Reset with `redis-cli DEL "rl:login:acct:trader@test.local"`.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: login, logout, and per-ip/per-account rate limiting"
```

---

## Task 13: Account switcher and the trade shell

**Files:**
- Create: `apps/web/src/app/(platform)/trade/page.tsx`, `apps/web/src/components/AccountSwitcher.tsx`
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `readSession`, `listAccountsForActor`, `formatMoney`
- Produces: `/trade` — a server-rendered page showing both accounts. Plan 02 replaces its body with the chart.

- [ ] **Step 1: Write `apps/web/src/components/AccountSwitcher.tsx`**

```tsx
"use client";

import { useState } from "react";

export interface AccountView {
  id: string;
  type: "LIVE" | "DEMO";
  balance: string;
}

export function AccountSwitcher({ accounts }: { accounts: AccountView[] }) {
  const [activeId, setActiveId] = useState(
    accounts.find((a) => a.type === "LIVE")?.id ?? accounts[0]?.id ?? "",
  );
  const active = accounts.find((a) => a.id === activeId);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          {active?.type === "DEMO" ? "Demo account" : "Live account"}
        </p>
        <p className="text-lg font-semibold tabular-nums">{active?.balance}</p>
      </div>
      <div className="flex gap-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setActiveId(a.id)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold ${
              a.id === activeId
                ? "border-[var(--color-brand)] bg-[var(--color-panel-2)]"
                : "border-[var(--color-edge)] bg-[var(--color-panel)] text-[var(--color-ink-2)]"
            }`}
          >
            {a.type === "DEMO" ? "Demo" : "Live"}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/app/(platform)/trade/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, listAccountsForActor } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { AccountSwitcher } from "@/components/AccountSwitcher";

export default async function TradePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  // Scoped by actor — this page cannot render another user's accounts.
  const accounts = await listAccountsForActor(session.userId);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">ASM Trade</h1>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Simulated
        </span>
      </div>

      <AccountSwitcher
        accounts={accounts.map((a) => ({
          id: a.id,
          type: a.type,
          balance: formatMoney(a.realBalance + a.bonusBalance, a.currency),
        }))}
      />

      <p className="text-sm text-[var(--color-ink-2)]">
        Chart and trading arrive in Plan 02.
      </p>

      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Update `apps/web/src/app/page.tsx` to redirect when signed in**

Replace the file written in Task 9 with:

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export default async function Home() {
  const store = await cookies();
  if (await readSession(store.get(SESSION_COOKIE)?.value)) redirect("/trade");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
          Demonstration build — simulated, no real money
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight">ASM Trade</h1>
      </div>
      <div className="flex gap-3">
        <Link
          href="/register"
          className="rounded-lg bg-[var(--color-up)] px-5 py-2.5 text-sm font-semibold text-[#06231a]"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-5 py-2.5 text-sm font-semibold"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify in the browser**

Open `http://localhost:3000`, register a new account, and confirm the `/trade` page shows **Live account $0.00** and, on switching, **Demo account $10,000.00**.

- [ ] **Step 5: Verify the redirect guard**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/trade
```

Expected: `307` (redirect to `/login`) — an unauthenticated request never reaches the page.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: trade shell with account switcher"
```

---

## Task 14: Lint gates and full verification

**Files:**
- Create: `eslint.config.mjs`
- Test: `apps/web/src/lib/headers.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: a passing `pnpm lint`, `pnpm typecheck`, and `pnpm test` across the workspace

- [ ] **Step 1: Write `eslint.config.mjs`**

These rules are the security controls that are cheapest to enforce mechanically. Each corresponds to a row in the threat model.

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/generated/**",
      "**/dist/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "prisma",
          property: "$queryRawUnsafe",
          message:
            "Raw unsafe queries are banned. Use $queryRaw with a tagged template.",
        },
        {
          object: "prisma",
          property: "$executeRawUnsafe",
          message:
            "Raw unsafe queries are banned. Use $executeRaw with a tagged template.",
        },
        {
          object: "Math",
          property: "random",
          message:
            "Math.random is not cryptographically secure. Use node:crypto randomBytes/randomInt for anything security-bearing.",
        },
      ],
      "react/no-danger": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is banned — render text, not HTML.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
```

- [ ] **Step 2: Install lint dependencies**

```bash
pnpm add -Dw @eslint/js@9.42.0 typescript-eslint@8.48.1
```

- [ ] **Step 3: Write the failing security-header test**

Create `apps/web/src/lib/headers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware.js";

describe("security headers", () => {
  const res = middleware(new NextRequest("http://localhost:3000/"));

  it("denies framing", () => {
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets a content security policy with frame-ancestors none", () => {
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("disables MIME sniffing", () => {
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sends no referrer", () => {
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

The middleware already exists from Task 9, so this test should pass on first run — it is a regression guard, not a driver.

```bash
pnpm --filter @asm/web test
```

Expected: PASS — 9 tests total (5 password, 4 headers).

- [ ] **Step 5: Run the full verification sweep**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all three clean. Fix anything red before continuing — a red gate here compounds through every later plan.

- [ ] **Step 6: Verify the lint gate actually catches a violation**

```bash
cat > /tmp/gate-check.ts <<'EOF'
export const x = Math.random();
EOF
cp /tmp/gate-check.ts apps/web/src/lib/gate-check.ts
pnpm lint 2>&1 | grep -c "not cryptographically secure"
rm apps/web/src/lib/gate-check.ts
```

Expected: `1` — the rule fires. If it prints `0`, the ESLint config is not being applied to that path.

- [ ] **Step 7: Commit**

```bash
git add eslint.config.mjs apps/web package.json pnpm-lock.yaml
git commit -m "chore: eslint security gates and header regression tests"
```

---

## Deferred from this plan — and why

**Two-factor authentication.** The build spec lists 2FA under Phase 01. The
schema carries its columns (`twoFaEnabled`, `twoFaForLogin`,
`twoFaForWithdrawal`) so no migration is needed later, but the flow is not
built here, because it needs a decision this plan cannot make for you: how
codes get delivered. The options are an SMTP account, a transactional email
provider, or — for a demo — writing the code to the log and reading it from
the terminal.

That last option is genuinely the right one for a demonstration build. It
needs no provider, no credentials, and no deliverability problems, and it
demonstrates the flow just as well. Decide before Plan 07, which is where the
2FA screens land alongside the rest of the account surface.

## Definition of Done

Plan 01 is complete when all of these hold:

- [ ] `node -v` reports 22.x or later
- [ ] `brew services list` shows `postgresql@16` and `redis` started
- [ ] `pnpm lint`, `pnpm typecheck`, and `pnpm test` all pass
- [ ] Registering at `http://localhost:3000/register` lands on `/trade`
- [ ] `/trade` shows **Live $0.00** and **Demo $10,000.00**
- [ ] `POST /api/auth/register` with a `role` field returns **400** and creates no user
- [ ] `getAccountForActor(bob, aliceAccountId)` returns **null**
- [ ] Six wrong-password attempts return five `401`s then a `429`
- [ ] `has_table_privilege('asm_app','"AuditLog"','DELETE')` is **false**
- [ ] A log line containing a password renders it as `[REDACTED]`
- [ ] `git log --oneline` shows 12 or more commits

## What Plan 02 depends on from here

Plan 02 (Price engine) will import and must not need to change:

- `prisma` and the `Asset` / `Candle` models from `@asm/db`
- `logger` and `childLogger(cid)` from `@asm/logger`
- `config.databaseUrl`, `config.redisUrl` from `@asm/config`
- The three seeded assets: `USDJPY`, `AUDNZD_OTC`, `EURUSD_OTC`
- The `@asm/contracts` package, extended there with WebSocket message schemas
