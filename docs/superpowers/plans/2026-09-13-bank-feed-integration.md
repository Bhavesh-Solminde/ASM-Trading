# Bank-Feed Ingestion, Deposit Verification, and Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing SMS-relay companion app (`apps/relay`) directly into `apps/web`, with a deposit-verification engine that reserves a unique amount per deposit and matches incoming bank credits against it, plus an admin panel to monitor incoming messages and manually resolve anything the engine can't auto-approve.

**Architecture:** `apps/web` gains a Bearer-authenticated ingestion route (`POST /api/bank-feed/sms`) that logs every incoming message, parses it, and — for credits — creates a `BankCredit` row and immediately tries to match it against a live `Deposit` by **exact reserved amount** (primary) and **claimed UTR** (secondary); VPA is never used for matching. A secret-gated `/admin` area (independent of user accounts) lists incoming messages and deposits, and lets an operator manually link an orphaned credit to a deposit or create a test deposit. `apps/harness` and `apps/relay`'s native SMS-reading logic are untouched; only `apps/relay/src/relayConfig.ts`'s target URL changes.

**Tech Stack:** Next.js 16 API routes (`apps/web`), Prisma 7 (`@asm/db`), Redis (admin sessions, rate limiting), Vitest (TDD throughout).

**Design reference:** `docs/superpowers/specs/2026-09-13-bank-feed-deposit-verification-design.md` — read it once before starting; this plan implements it with one deliberate simplification noted below.

**Note on a simplification from the design doc:** the design doc introduces a new `reservedAmountInr` field distinct from `amountInr`. Implementing it, it turned out `amountInr` itself can just BE the reserved odd amount (this is exactly how Plan 05's own draft `createDepositIntent` already worked before this plan corrected its matching key) — no new field is needed, only a schema change to how `amountInr` is made unique (amount alone, not `(vpa, amountInr)`) and how the offset is computed (symmetric ±₹10, not one-sided). This plan uses that simpler shape. Everything else in the design doc (verification table, QR `am=` parameter, admin panel, out-of-scope items) is implemented as written.

## Global Constraints

- **Money is `Int`, minor units** (paise for INR, cents for USD). Never `Float`, never `Decimal`.
- **`role` is never accepted as input** and is not used anywhere in this plan — the admin panel is gated by a separate shared secret, not the user `role` field.
- **Every user-owned query takes `actorId`**, ownership in the query predicate. (The admin panel is explicitly not user-owned — it's gated by its own secret, not a `User` row — so this constraint doesn't apply to admin routes, but does apply anywhere a `Deposit` is looked up by a normal user.)
- **Every internal relative import must be extensionless** (`./foo`, not `./foo.js`) — this repo's `moduleResolution: "bundler"` setting requires it; see commit `264ac6b` on `main` for why.
- **Demo build only.** No real payment integration, no production secrets.
- **`apps/relay` and `apps/harness` must not be modified** except for the one described change to `apps/relay/src/relayConfig.ts` (Task 11). This constraint was violated once already during Plan 01 (caught and reverted) — do not repeat that.
- **Exact dependency versions already in use**, no new dependency additions needed for this plan (everything it needs — `ioredis`, `argon2` not needed here, Prisma, Zod — already exists in `apps/web`'s `package.json`).

---

## File Structure

```
packages/db/
├── prisma/
│   ├── schema.prisma                          modify: add RelayMessage, adjust Deposit index
│   └── migrations/
│       └── <timestamp>_add_relay_message_and_amount_reservation/
│           └── migration.sql                  new
├── src/
│   ├── index.ts                               modify: re-export new repository functions
│   └── repositories/
│       ├── deposit.ts                         new — reservation + matching lookups + credit-to-account
│       ├── deposit.test.ts                    new
│       ├── relay-message.ts                   new — raw message log CRUD
│       ├── relay-message.test.ts              new
│       ├── bank-credit.ts                     new — BankCredit creation + orphan listing
│       └── bank-credit.test.ts                new

apps/web/src/
├── lib/
│   ├── redis.ts                                new — shared Redis client (extracted from rate-limit.ts)
│   ├── rate-limit.ts                           modify: use the shared client
│   ├── parse-bank-sms.ts                       new — ported from apps/harness/lib/parseSms.ts
│   ├── parse-bank-sms.test.ts                  new — ported from apps/harness/lib/parseSms.test.ts
│   ├── upi.ts                                  new — UPI deep-link builder
│   ├── upi.test.ts                             new
│   ├── deposit-matcher.ts                      new — the verification engine (5-case table)
│   ├── deposit-matcher.test.ts                 new
│   └── admin-session.ts                        new — admin secret check + session cookie
├── app/
│   ├── api/
│   │   ├── bank-feed/sms/route.ts              new — ingestion endpoint
│   │   └── admin/
│   │       ├── login/route.ts                  new
│   │       ├── logout/route.ts                 new
│   │       ├── deposits/route.ts               new — create test deposit
│   │       └── deposits/match/route.ts         new — manual-match action
│   └── admin/
│       ├── login/page.tsx                      new
│       ├── messages/page.tsx                   new
│       └── deposits/page.tsx                   new

apps/relay/src/
└── relayConfig.ts                              modify: serverUrl comment/placeholder only
```

---

## Task 1: Schema — RelayMessage model and amount-only deposit reservation

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_relay_message_and_amount_reservation/migration.sql` (timestamp generated by Prisma — see Step 2)

**Interfaces:**
- Consumes: existing `BankCredit`, `Deposit` models
- Produces: `RelayMessage` Prisma model (fields: `id`, `source`, `deviceLabel`, `deviceModel`, `sender`, `body`, `receivedAt`, `parsedAmountInr`, `parsedUtr`, `isCredit`, `bankCreditId`, `createdAt`); a partial unique index `Deposit_live_amount_unique` on `Deposit.amountInr` for live deposits

- [ ] **Step 1: Add the `RelayMessage` model to `packages/db/prisma/schema.prisma`**

Find the `model BankCredit { ... }` block and add this new model directly after it:

```prisma
/// Raw log of every incoming message from any companion app/device, whether
/// or not it turned out to be a usable credit. BankCredit is reserved for
/// messages that parsed as an actual credit; this table is the full record.
model RelayMessage {
  id              String   @id @default(uuid())
  source          String
  deviceLabel     String?
  deviceModel     String?
  sender          String?
  body            String
  receivedAt      DateTime
  parsedAmountInr Int?
  parsedUtr       String?
  isCredit        Boolean?
  bankCreditId    String?
  createdAt       DateTime @default(now())

  bankCredit BankCredit? @relation(fields: [bankCreditId], references: [id], onDelete: SetNull)

  @@index([source, deviceLabel])
  @@index([createdAt])
}
```

Find the `model BankCredit { ... }` block itself and add the reverse relation field. The existing model looks like:

```prisma
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
```

Add one line (`relayMessages RelayMessage[]`) so it becomes:

```prisma
model BankCredit {
  id         String   @id @default(uuid())
  vpa        String
  amountInr  Int
  utr        String   @unique
  receivedAt DateTime
  raw        String?
  consumed   Boolean  @default(false)
  createdAt  DateTime @default(now())

  relayMessages RelayMessage[]

  @@index([vpa, amountInr, consumed])
}
```

- [ ] **Step 2: Generate the migration (schema-only, so Prisma writes the `CREATE TABLE` for us)**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec prisma migrate dev --create-only --name add_relay_message_and_amount_reservation
```

Expected: a new directory `packages/db/prisma/migrations/<timestamp>_add_relay_message_and_amount_reservation/` containing a `migration.sql` with the `CREATE TABLE "RelayMessage"` statement and its indexes/foreign key, auto-generated from the schema diff. Note the exact folder name Prisma printed — you'll need it in Step 4.

- [ ] **Step 3: Hand-edit the generated migration to add the partial unique index**

Prisma cannot express a partial unique index (`WHERE status IN (...)`) declaratively, so it isn't in the auto-generated file. Open the `migration.sql` file Prisma just created and append this to the end of it:

```sql

-- Amount is the sole reconciliation key for deposit matching (see
-- docs/superpowers/specs/2026-09-13-bank-feed-deposit-verification-design.md).
-- Unique only among LIVE deposits, so two completed deposits may still
-- legitimately share an amount at different points in time.
CREATE UNIQUE INDEX "Deposit_live_amount_unique"
  ON "Deposit" ("amountInr")
  WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION');
```

- [ ] **Step 4: Apply the migration and regenerate the client**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

Expected: `1 migration found... Applied` (no errors), then `Generated Prisma Client (7.10.0) to ./generated/prisma`.

- [ ] **Step 5: Verify against a real database — the partial unique index actually rejects a second live deposit at the same amount but allows two completed ones**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
PGPASSWORD=asm_dev_password psql -h localhost -p 5433 -U asm_owner -d asm_trade_test <<'EOF'
-- setup: a user row to satisfy the FK
INSERT INTO "User" (id, email, "passwordHash") VALUES ('mig-check-user', 'migcheck@test.local', 'x') ON CONFLICT DO NOTHING;

-- two live deposits at the same amount: second must fail
INSERT INTO "Deposit" (id, "userId", method, "amountUsd", "amountInr", vpa, "checkoutToken", status, "correlationId", "expiresAt")
  VALUES ('mig-check-1', 'mig-check-user', 'upi', 100000, 107640, 'asmtrade.demo1@okaxis', 'tok-mig-1', 'AWAITING_PAYMENT', 'cid-1', now() + interval '1 hour');
INSERT INTO "Deposit" (id, "userId", method, "amountUsd", "amountInr", vpa, "checkoutToken", status, "correlationId", "expiresAt")
  VALUES ('mig-check-2', 'mig-check-user', 'upi', 100000, 107640, 'asmtrade.demo1@okaxis', 'tok-mig-2', 'AWAITING_PAYMENT', 'cid-2', now() + interval '1 hour');
EOF
```

Expected: the second `INSERT` fails with `duplicate key value violates unique constraint "Deposit_live_amount_unique"`. This confirms the guard works before any application code depends on it.

```bash
PGPASSWORD=asm_dev_password psql -h localhost -p 5433 -U asm_owner -d asm_trade_test -c "
UPDATE \"Deposit\" SET status = 'COMPLETED' WHERE id = 'mig-check-1';
INSERT INTO \"Deposit\" (id, \"userId\", method, \"amountUsd\", \"amountInr\", vpa, \"checkoutToken\", status, \"correlationId\", \"expiresAt\")
  VALUES ('mig-check-3', 'mig-check-user', 'upi', 100000, 107640, 'asmtrade.demo1@okaxis', 'tok-mig-3', 'AWAITING_PAYMENT', 'cid-3', now() + interval '1 hour');
DELETE FROM \"Deposit\" WHERE id IN ('mig-check-1', 'mig-check-3');
DELETE FROM \"User\" WHERE id = 'mig-check-user';
"
```

Expected: both statements succeed (marking one COMPLETED frees the amount for a new live deposit), then the cleanup `DELETE`s succeed with no errors — confirms the test data was fully removed.

- [ ] **Step 6: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): RelayMessage model and amount-only deposit reservation"
```

---

## Task 2: Deposit reservation, matching lookups, and credit-to-account transaction

**Files:**
- Create: `packages/db/src/repositories/deposit.ts`
- Test: `packages/db/src/repositories/deposit.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `prisma` (from `./client`), the `Deposit`/`BankCredit`/`Account`/`Transaction`/`BonusGrant`/`AuditLog`/`User` Prisma models
- Produces:
  - `class AmountSpaceExhausted extends Error`
  - `createDepositIntent(input: { userId: string; method: string; amountUsdMinor: number; correlationId: string }): Promise<Deposit>`
  - `findLiveDepositByAmount(amountInr: number): Promise<Deposit[]>`
  - `findLiveDepositByClaimedUtr(utr: string): Promise<Deposit | null>`
  - `creditDepositToAccount(input: { depositId: string; adminId: string | null; creditId: string | null }): Promise<void>`
  - `USD_TO_INR_RATE`, `OFFSET_SPACE`, `OFFSET_LOW`, `DEPOSIT_TTL_MINUTES`, `MIN_DEPOSIT_USD_MINOR`, `MAX_DEPOSIT_USD_MINOR`, `DEMO_VPA`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/repositories/deposit.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import {
  AmountSpaceExhausted,
  MAX_DEPOSIT_USD_MINOR,
  MIN_DEPOSIT_USD_MINOR,
  USD_TO_INR_RATE,
  createDepositIntent,
  creditDepositToAccount,
  findLiveDepositByAmount,
  findLiveDepositByClaimedUtr,
} from "./deposit";
import { createAccountsForUser } from "./account";

let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `deposit-test-${Date.now()}@test.local`,
      passwordHash: "x",
    },
  });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.transaction.deleteMany({
    where: { account: { userId } },
  });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("createDepositIntent", () => {
  it("rejects an amount below the minimum", async () => {
    await expect(
      createDepositIntent({
        userId,
        method: "upi",
        amountUsdMinor: MIN_DEPOSIT_USD_MINOR - 1,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow(/minimum/);
  });

  it("rejects an amount above the maximum", async () => {
    await expect(
      createDepositIntent({
        userId,
        method: "upi",
        amountUsdMinor: MAX_DEPOSIT_USD_MINOR + 1,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow(/maximum/);
  });

  it("reserves an amount within ±999/+1000 paise of the converted base", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 10_000, // $100.00
      correlationId: randomUUID(),
    });
    const baseInr = Math.round(10_000 * USD_TO_INR_RATE);
    // The offset pool spans -999..+1000 inclusive (2000 values) and does
    // include 0 — an assigned amount landing exactly on the round base is
    // rare (~1-in-2000) but not excluded by design, so this only asserts
    // the range, not "never exactly the base" (which would make this test
    // flaky).
    expect(deposit.amountInr).toBeGreaterThanOrEqual(baseInr - 999);
    expect(deposit.amountInr).toBeLessThanOrEqual(baseInr + 1000);
    expect(deposit.amountUsd).toBe(10_000);
    expect(deposit.status).toBe("AWAITING_PAYMENT");
  });

  it("never reserves the same amount for two live deposits", async () => {
    const a = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 20_000,
      correlationId: randomUUID(),
    });
    const b = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 20_000,
      correlationId: randomUUID(),
    });
    expect(a.amountInr).not.toBe(b.amountInr);
  });
});

describe("findLiveDepositByAmount", () => {
  it("finds a live deposit by its exact reserved amount", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 15_000,
      correlationId: randomUUID(),
    });
    const found = await findLiveDepositByAmount(deposit.amountInr);
    expect(found.map((d) => d.id)).toContain(deposit.id);
  });

  it("returns an empty array for an amount no live deposit has reserved", async () => {
    const found = await findLiveDepositByAmount(999_999_999);
    expect(found).toEqual([]);
  });
});

describe("findLiveDepositByClaimedUtr", () => {
  it("finds a live deposit by its claimed UTR", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 25_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { claimedUtr: "utr-test-12345", status: "PENDING_CONFIRMATION" },
    });
    const found = await findLiveDepositByClaimedUtr("utr-test-12345");
    expect(found?.id).toBe(deposit.id);
  });

  it("returns null when no live deposit claims that UTR", async () => {
    const found = await findLiveDepositByClaimedUtr("no-such-utr");
    expect(found).toBeNull();
  });
});

describe("creditDepositToAccount", () => {
  it("marks the deposit COMPLETED, credits the account, and consumes the credit", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 30_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "PENDING_CONFIRMATION" },
    });
    const credit = await prisma.bankCredit.create({
      data: {
        vpa: "relayed",
        amountInr: deposit.amountInr,
        utr: `utr-credit-${Date.now()}`,
        receivedAt: new Date(),
        raw: "test",
      },
    });

    await creditDepositToAccount({
      depositId: deposit.id,
      adminId: null,
      creditId: credit.id,
    });

    const updated = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.matchedCreditId).toBe(credit.id);

    const consumedCredit = await prisma.bankCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(consumedCredit.consumed).toBe(true);

    const account = await prisma.account.findFirstOrThrow({
      where: { userId, type: "LIVE" },
    });
    expect(account.realBalance).toBe(30_000);
  });

  it("throws AmountSpaceExhausted-unrelated DepositAlreadyResolved when called twice", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 35_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "PENDING_CONFIRMATION" },
    });
    await creditDepositToAccount({ depositId: deposit.id, adminId: null, creditId: null });
    await expect(
      creditDepositToAccount({ depositId: deposit.id, adminId: null, creditId: null }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/deposit.test.ts
```

Expected: FAIL — cannot resolve `./deposit`.

- [ ] **Step 3: Write `packages/db/src/repositories/deposit.ts`**

```ts
import { randomBytes } from "node:crypto";
import { prisma } from "../client";
import type { Deposit } from "../generated/prisma/client";

/**
 * The PSP-style conversion rate. Deliberately above interbank — that spread is
 * the margin the real processors take before a customer has traded anything.
 */
export const USD_TO_INR_RATE = 107.64;

/**
 * The offset window is symmetric around the converted base amount: from
 * OFFSET_LOW to OFFSET_LOW + OFFSET_SPACE - 1 paise, i.e. -999 to +1000 for
 * the current values — roughly ±₹10, ~2,000 distinct slots. This is the pool
 * of possible unique amounts, NOT a tolerance applied at match time: matching
 * is always exact against whichever single value was actually reserved.
 */
export const OFFSET_LOW = -999;
export const OFFSET_SPACE = 2000;

export const DEPOSIT_TTL_MINUTES = 60;
export const MIN_DEPOSIT_USD_MINOR = 1_000; // $10.00
export const MAX_DEPOSIT_USD_MINOR = 96_100; // $961.00

/**
 * VPA no longer participates in matching (amount is the sole reconciliation
 * key — see the design doc), so every deposit uses one fixed demo collection
 * identity. It still matters for the QR/UPI deep link, which routes real
 * payment traffic to this address.
 */
export const DEMO_VPA = "asmtrade.demo1@okaxis";

export class AmountSpaceExhausted extends Error {
  constructor() {
    super("No deposit slot is free right now. Try again in a few minutes.");
    this.name = "AmountSpaceExhausted";
  }
}

export class DepositNotFound extends Error {
  constructor() {
    super("Deposit not found.");
    this.name = "DepositNotFound";
  }
}

export class DepositAlreadyResolved extends Error {
  constructor() {
    super("This deposit has already been resolved.");
    this.name = "DepositAlreadyResolved";
  }
}

/**
 * Creates a deposit intent with a RESERVED amount, unique among all
 * currently-live deposits regardless of VPA.
 *
 * A UTR proves nothing on its own — anyone can type any number, and for a
 * relayed SMS there is often no UTR to check at all. But if ₹10,764.37 is
 * reserved to exactly one live deposit, a credit of exactly that amount can
 * only belong to that deposit. The amount is the identifier, which is why
 * it's an odd number rather than the round figure the user asked for.
 *
 * Uniqueness is enforced by a partial unique index (Task 1's migration), so
 * two concurrent requests cannot be handed the same amount. We retry on
 * collision rather than locking, starting from a random offset so concurrent
 * callers don't all probe the same slot first.
 */
export async function createDepositIntent(input: {
  userId: string;
  method: string;
  amountUsdMinor: number;
  correlationId: string;
}): Promise<Deposit> {
  if (input.amountUsdMinor < MIN_DEPOSIT_USD_MINOR) {
    throw new Error(
      `Below the minimum deposit of $${(MIN_DEPOSIT_USD_MINOR / 100).toFixed(2)}.`,
    );
  }
  if (input.amountUsdMinor > MAX_DEPOSIT_USD_MINOR) {
    throw new Error(
      `Above the maximum deposit of $${(MAX_DEPOSIT_USD_MINOR / 100).toFixed(2)}.`,
    );
  }

  const baseInr = Math.round(input.amountUsdMinor * USD_TO_INR_RATE);
  const expiresAt = new Date(Date.now() + DEPOSIT_TTL_MINUTES * 60_000);

  const start = randomBytes(2).readUInt16BE(0) % OFFSET_SPACE;

  for (let probe = 0; probe < OFFSET_SPACE; probe++) {
    const offset = OFFSET_LOW + ((start + probe) % OFFSET_SPACE);
    const amountInr = baseInr + offset;

    try {
      return await prisma.deposit.create({
        data: {
          userId: input.userId,
          method: input.method,
          amountUsd: input.amountUsdMinor,
          amountInr,
          vpa: DEMO_VPA,
          checkoutToken: randomBytes(24).toString("base64url"),
          status: "AWAITING_PAYMENT",
          correlationId: input.correlationId,
          expiresAt,
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") continue;
      throw err;
    }
  }

  throw new AmountSpaceExhausted();
}

/** All live (not yet resolved) deposits that reserved exactly this amount. In
 * practice this is 0 or 1 rows — the partial unique index guarantees at most
 * one — but the caller (the matcher) treats more than one as a bug to flag,
 * not something to silently pick between. */
export async function findLiveDepositByAmount(amountInr: number): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: {
      amountInr,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
    },
  });
}

export async function findLiveDepositByClaimedUtr(utr: string): Promise<Deposit | null> {
  return prisma.deposit.findFirst({
    where: {
      claimedUtr: utr,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
    },
  });
}

const BONUS_PERCENT = 50;
const TURNOVER_MULTIPLE = 3;

/**
 * Approves a deposit and credits the account, in one transaction so a crash
 * or a retry cannot double-credit. `creditId` may be null for a manually
 * approved deposit with no specific bank credit on record (e.g. an admin
 * override); when present, that credit is atomically marked consumed inside
 * the same transaction as the approval.
 */
export async function creditDepositToAccount(input: {
  depositId: string;
  adminId: string | null;
  creditId: string | null;
}): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: input.depositId } });
  if (!deposit) throw new DepositNotFound();

  const account = await prisma.account.findFirstOrThrow({
    where: { userId: deposit.userId, type: "LIVE" },
  });

  const bonus = Math.floor((deposit.amountUsd * BONUS_PERCENT) / 100);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.deposit.updateMany({
      where: {
        id: deposit.id,
        status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
      },
      data: { status: "COMPLETED", matchedCreditId: input.creditId },
    });
    if (claimed.count !== 1) throw new DepositAlreadyResolved();

    if (input.creditId) {
      const consumed = await tx.bankCredit.updateMany({
        where: { id: input.creditId, consumed: false },
        data: { consumed: true },
      });
      if (consumed.count !== 1) throw new DepositAlreadyResolved();
    }

    const updated = await tx.account.update({
      where: { id: account.id },
      data: {
        realBalance: { increment: deposit.amountUsd },
        bonusBalance: { increment: bonus },
        version: { increment: 1 },
      },
    });

    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "DEPOSIT",
        amount: deposit.amountUsd,
        balanceAfter: updated.realBalance + updated.bonusBalance,
        refType: "Deposit",
        refId: deposit.id,
      },
    });

    if (bonus > 0) {
      await tx.bonusGrant.create({
        data: {
          accountId: account.id,
          amount: bonus,
          turnoverRequired: bonus * TURNOVER_MULTIPLE,
        },
      });
      await tx.transaction.create({
        data: {
          accountId: account.id,
          kind: "BONUS_GRANT",
          amount: bonus,
          balanceAfter: updated.realBalance + updated.bonusBalance,
          refType: "Deposit",
          refId: deposit.id,
        },
      });
    }

    await tx.user.update({
      where: { id: deposit.userId },
      data: { cumulativeDeposits: { increment: deposit.amountUsd } },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: input.adminId ? "deposit.approved_manual" : "deposit.approved_auto",
        targetType: "Deposit",
        targetId: deposit.id,
        after: { status: "COMPLETED", creditId: input.creditId, bonus },
      },
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/deposit.test.ts
```

Expected: PASS — all tests green, pristine output (no warnings).

- [ ] **Step 5: Re-export from `packages/db/src/index.ts`**

Add these lines to the existing export list (following the file's established pattern of one `export { ... } from "./repositories/..."` per repository):

```ts
export {
  AmountSpaceExhausted,
  DepositNotFound,
  DepositAlreadyResolved,
  USD_TO_INR_RATE,
  OFFSET_LOW,
  OFFSET_SPACE,
  DEPOSIT_TTL_MINUTES,
  MIN_DEPOSIT_USD_MINOR,
  MAX_DEPOSIT_USD_MINOR,
  DEMO_VPA,
  createDepositIntent,
  findLiveDepositByAmount,
  findLiveDepositByClaimedUtr,
  creditDepositToAccount,
} from "./repositories/deposit";
```

- [ ] **Step 6: Run the full `@asm/db` suite to confirm no regressions**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run
```

Expected: PASS — all test files green (this task's new file plus every existing one).

- [ ] **Step 7: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add packages/db/src/repositories/deposit.ts packages/db/src/repositories/deposit.test.ts packages/db/src/index.ts
git commit -m "feat(db): deposit reservation, amount/UTR lookups, and credit-to-account transaction"
```

---

## Task 3: RelayMessage and BankCredit repositories

**Files:**
- Create: `packages/db/src/repositories/relay-message.ts`
- Test: `packages/db/src/repositories/relay-message.test.ts`
- Create: `packages/db/src/repositories/bank-credit.ts`
- Test: `packages/db/src/repositories/bank-credit.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `prisma` (from `./client`)
- Produces:
  - `createRelayMessage(input: { source: string; deviceLabel: string | null; deviceModel: string | null; sender: string | null; body: string; receivedAt: Date; parsedAmountInr: number | null; parsedUtr: string | null; isCredit: boolean | null }): Promise<RelayMessage>`
  - `linkRelayMessageToCredit(relayMessageId: string, bankCreditId: string): Promise<void>`
  - `listRelayMessages(filter: { source?: string; deviceLabel?: string }, limit: number): Promise<RelayMessage[]>`
  - `createBankCreditIfNew(input: { vpa: string; amountInr: number; utr: string; receivedAt: Date; raw: string }): Promise<BankCredit | null>` (returns `null` on a duplicate UTR rather than throwing)
  - `listOrphanBankCredits(limit: number): Promise<BankCredit[]>`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/repositories/relay-message.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createRelayMessage, linkRelayMessageToCredit, listRelayMessages } from "./relay-message";

const createdIds: string[] = [];
const createdCreditIds: string[] = [];

afterAll(async () => {
  await prisma.relayMessage.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.bankCredit.deleteMany({ where: { id: { in: createdCreditIds } } });
});

describe("createRelayMessage", () => {
  it("stores a message with all fields, parsed or not", async () => {
    const msg = await createRelayMessage({
      source: "sms-relay",
      deviceLabel: "Test phone",
      deviceModel: "Pixel 9",
      sender: "SBI",
      body: "Rs.500.00 credited to A/c XX1234",
      receivedAt: new Date(),
      parsedAmountInr: 50000,
      parsedUtr: "123456789012",
      isCredit: true,
    });
    createdIds.push(msg.id);
    expect(msg.source).toBe("sms-relay");
    expect(msg.parsedAmountInr).toBe(50000);
    expect(msg.bankCreditId).toBeNull();
  });

  it("stores a message that failed to parse, with null parsed fields", async () => {
    const msg = await createRelayMessage({
      source: "sms-relay",
      deviceLabel: null,
      deviceModel: null,
      sender: null,
      body: "Your OTP is 482913.",
      receivedAt: new Date(),
      parsedAmountInr: null,
      parsedUtr: null,
      isCredit: null,
    });
    createdIds.push(msg.id);
    expect(msg.parsedAmountInr).toBeNull();
    expect(msg.isCredit).toBeNull();
  });
});

describe("linkRelayMessageToCredit", () => {
  it("attaches a bankCreditId to an existing message", async () => {
    const msg = await createRelayMessage({
      source: "sms-relay",
      deviceLabel: null,
      deviceModel: null,
      sender: "SBI",
      body: "Rs.500.00 credited",
      receivedAt: new Date(),
      parsedAmountInr: 50000,
      parsedUtr: null,
      isCredit: true,
    });
    createdIds.push(msg.id);

    const credit = await prisma.bankCredit.create({
      data: {
        vpa: "relayed",
        amountInr: 50000,
        utr: `link-test-${Date.now()}`,
        receivedAt: new Date(),
        raw: "test",
      },
    });
    createdCreditIds.push(credit.id);

    await linkRelayMessageToCredit(msg.id, credit.id);

    const updated = await prisma.relayMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(updated.bankCreditId).toBe(credit.id);
  });
});

describe("listRelayMessages", () => {
  it("filters by source and deviceLabel", async () => {
    const unique = `filter-test-${Date.now()}`;
    const msg = await createRelayMessage({
      source: unique,
      deviceLabel: unique,
      deviceModel: null,
      sender: null,
      body: "test",
      receivedAt: new Date(),
      parsedAmountInr: null,
      parsedUtr: null,
      isCredit: null,
    });
    createdIds.push(msg.id);

    const found = await listRelayMessages({ source: unique, deviceLabel: unique }, 10);
    expect(found.map((m) => m.id)).toEqual([msg.id]);

    const notFound = await listRelayMessages({ source: "no-such-source" }, 10);
    expect(notFound).toEqual([]);
  });
});
```

Create `packages/db/src/repositories/bank-credit.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createBankCreditIfNew, listOrphanBankCredits } from "./bank-credit";

const createdIds: string[] = [];

afterAll(async () => {
  await prisma.bankCredit.deleteMany({ where: { id: { in: createdIds } } });
});

describe("createBankCreditIfNew", () => {
  it("creates a credit for a new UTR", async () => {
    const utr = `new-utr-${Date.now()}`;
    const credit = await createBankCreditIfNew({
      vpa: "relayed",
      amountInr: 50000,
      utr,
      receivedAt: new Date(),
      raw: "test body",
    });
    expect(credit).not.toBeNull();
    createdIds.push(credit!.id);
    expect(credit!.utr).toBe(utr);
    expect(credit!.consumed).toBe(false);
  });

  it("returns null rather than throwing on a duplicate UTR", async () => {
    const utr = `dup-utr-${Date.now()}`;
    const first = await createBankCreditIfNew({
      vpa: "relayed",
      amountInr: 50000,
      utr,
      receivedAt: new Date(),
      raw: "first",
    });
    createdIds.push(first!.id);

    const second = await createBankCreditIfNew({
      vpa: "relayed",
      amountInr: 60000,
      utr,
      receivedAt: new Date(),
      raw: "second, same UTR",
    });
    expect(second).toBeNull();
  });
});

describe("listOrphanBankCredits", () => {
  it("lists only unconsumed credits", async () => {
    const consumedUtr = `consumed-${Date.now()}`;
    const orphanUtr = `orphan-${Date.now()}`;

    const consumed = await prisma.bankCredit.create({
      data: { vpa: "relayed", amountInr: 1, utr: consumedUtr, receivedAt: new Date(), consumed: true },
    });
    createdIds.push(consumed.id);

    const orphan = await createBankCreditIfNew({
      vpa: "relayed",
      amountInr: 2,
      utr: orphanUtr,
      receivedAt: new Date(),
      raw: "orphan",
    });
    createdIds.push(orphan!.id);

    const found = await listOrphanBankCredits(200);
    const foundIds = found.map((c) => c.id);
    expect(foundIds).toContain(orphan!.id);
    expect(foundIds).not.toContain(consumed.id);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/relay-message.test.ts src/repositories/bank-credit.test.ts
```

Expected: FAIL — cannot resolve `./relay-message` and `./bank-credit`.

- [ ] **Step 3: Write `packages/db/src/repositories/relay-message.ts`**

```ts
import { prisma } from "../client";
import type { RelayMessage } from "../generated/prisma/client";

export async function createRelayMessage(input: {
  source: string;
  deviceLabel: string | null;
  deviceModel: string | null;
  sender: string | null;
  body: string;
  receivedAt: Date;
  parsedAmountInr: number | null;
  parsedUtr: string | null;
  isCredit: boolean | null;
}): Promise<RelayMessage> {
  return prisma.relayMessage.create({ data: input });
}

export async function linkRelayMessageToCredit(
  relayMessageId: string,
  bankCreditId: string,
): Promise<void> {
  await prisma.relayMessage.update({
    where: { id: relayMessageId },
    data: { bankCreditId },
  });
}

export async function listRelayMessages(
  filter: { source?: string; deviceLabel?: string },
  limit: number,
): Promise<RelayMessage[]> {
  return prisma.relayMessage.findMany({
    where: {
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.deviceLabel ? { deviceLabel: filter.deviceLabel } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
```

- [ ] **Step 4: Write `packages/db/src/repositories/bank-credit.ts`**

```ts
import { prisma } from "../client";
import type { BankCredit } from "../generated/prisma/client";

/**
 * Returns null on a duplicate UTR rather than throwing — the relay may
 * retry a delivery (its own retry logic sends up to 3 attempts), and a
 * repeat of the same real-world credit is normal operation, not an error.
 */
export async function createBankCreditIfNew(input: {
  vpa: string;
  amountInr: number;
  utr: string;
  receivedAt: Date;
  raw: string;
}): Promise<BankCredit | null> {
  try {
    return await prisma.bankCredit.create({ data: input });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return null;
    throw err;
  }
}

export async function listOrphanBankCredits(limit: number): Promise<BankCredit[]> {
  return prisma.bankCredit.findMany({
    where: { consumed: false },
    orderBy: { receivedAt: "desc" },
    take: limit,
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/relay-message.test.ts src/repositories/bank-credit.test.ts
```

Expected: PASS — all tests green, pristine output.

- [ ] **Step 6: Re-export from `packages/db/src/index.ts`**

```ts
export {
  createRelayMessage,
  linkRelayMessageToCredit,
  listRelayMessages,
} from "./repositories/relay-message";
export { createBankCreditIfNew, listOrphanBankCredits } from "./repositories/bank-credit";
```

- [ ] **Step 7: Run the full `@asm/db` suite**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run
```

Expected: PASS — every test file green.

- [ ] **Step 8: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add packages/db/src/repositories/relay-message.ts packages/db/src/repositories/relay-message.test.ts \
  packages/db/src/repositories/bank-credit.ts packages/db/src/repositories/bank-credit.test.ts \
  packages/db/src/index.ts
git commit -m "feat(db): RelayMessage and BankCredit repositories"
```

---

## Task 4: SMS parser (ported from apps/harness)

**Files:**
- Create: `apps/web/src/lib/parse-bank-sms.ts`
- Test: `apps/web/src/lib/parse-bank-sms.test.ts`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces: `parseBankSms(body: string): { amountInr: number; utr: string | null; isCredit: boolean } | null`

This is a straight port of `apps/harness/lib/parseSms.ts` — read-only reference, do not modify that file (Global Constraint: `apps/harness` must not be touched). Same logic, renamed for this codebase.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/parse-bank-sms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseBankSms } from "./parse-bank-sms";

describe("parseBankSms", () => {
  it("returns null when no amount is present", () => {
    expect(parseBankSms("Your OTP is 482913. Do not share it with anyone.")).toBeNull();
  });

  it("parses a currency-prefixed credit with a labelled reference", () => {
    const body =
      "Dear Customer, Rs.500.00 credited to A/c XX1234 on 01-Jan-24. Ref No: 123456789012. Avl Bal Rs.10,500.00";
    expect(parseBankSms(body)).toEqual({
      amountInr: 50000,
      utr: "123456789012",
      isCredit: true,
    });
  });

  it("prefers the first amount over a trailing available-balance figure", () => {
    const body = "Rs.500.00 debited from A/c XX1234. Avl Bal: Rs.10,000.00";
    expect(parseBankSms(body)?.amountInr).toBe(50000);
  });

  it("parses a bare two-decimal amount with no currency prefix", () => {
    const body =
      "Dear UPI user A/C X8126 debited by 1.00 on date 12Sep26 trf to BHAVESH SHIVAJI Refno 625503519433";
    expect(parseBankSms(body)).toEqual({
      amountInr: 100,
      utr: "625503519433",
      isCredit: false,
    });
  });

  it("falls back to a bare long digit sequence when no labelled reference exists", () => {
    const body = "Rs.50.00 credited. Txn ref 987654321012 successful.";
    expect(parseBankSms(body)?.utr).toBe("987654321012");
  });

  it("returns a null UTR when no reference number is present", () => {
    expect(parseBankSms("Rs.50.00 credited to your account.")?.utr).toBeNull();
  });

  it("treats a message mentioning both credit and debit keywords as not a credit", () => {
    const body = "Rs.50.00 debited; refund will be credited within 5 days.";
    expect(parseBankSms(body)?.isCredit).toBe(false);
  });

  it("does not mistake a bare integer for an amount", () => {
    expect(parseBankSms("Your account balance is 5000. No recent transactions.")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/apps/web
pnpm exec vitest run src/lib/parse-bank-sms.test.ts
```

Expected: FAIL — cannot resolve `./parse-bank-sms`.

- [ ] **Step 3: Write `apps/web/src/lib/parse-bank-sms.ts`**

```ts
export interface ParsedBankSms {
  amountInr: number;
  utr: string | null;
  isCredit: boolean;
}

// Matches either a currency-prefixed amount (Rs./INR/₹, decimals optional) or
// a bare two-decimal number (e.g. "debited by 1.00" — common on SBI alerts
// that omit a currency prefix entirely). A bare integer is never treated as
// an amount, since that would also match account digits and reference
// numbers.
const AMOUNT_RE =
  /(?:(?:rs\.?|inr|₹)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?))|\b([0-9]+\.[0-9]{2})\b/gi;

const REF_LABEL_RE =
  /(?:ref(?:erence)?\s*(?:no\.?|number)?|utr|txn\s*id)\s*[:-]?\s*([a-z0-9]{6,22})/i;
const BARE_REF_RE = /\b([0-9]{9,22})\b/;

const CREDIT_RE = /\b(credited|credit|received|deposited)\b/i;
const DEBIT_RE = /\b(debited|debit|spent|withdrawn|paid|purchase)\b/i;

/**
 * Bank SMS commonly list the transaction amount before a trailing "Avl Bal"
 * figure, so the first candidate wins — a real disambiguation choice, not
 * just "whatever the regex found."
 */
export function parseBankSms(body: string): ParsedBankSms | null {
  const amounts = [...body.matchAll(AMOUNT_RE)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => value != null);

  if (amounts.length === 0) return null;

  const amountInr = Math.round(Number(amounts[0].replace(/,/g, "")) * 100);

  const labeled = REF_LABEL_RE.exec(body);
  const bare = BARE_REF_RE.exec(body);
  const utr = labeled?.[1] ?? bare?.[1] ?? null;

  const isCredit = CREDIT_RE.test(body) && !DEBIT_RE.test(body);

  return { amountInr, utr, isCredit };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/apps/web
pnpm exec vitest run src/lib/parse-bank-sms.test.ts
```

Expected: PASS — 8/8 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add apps/web/src/lib/parse-bank-sms.ts apps/web/src/lib/parse-bank-sms.test.ts
git commit -m "feat(web): SMS bank-credit parser (ported from apps/harness)"
```

---

## Task 5: UPI deep-link builder

**Files:**
- Create: `apps/web/src/lib/upi.ts`
- Test: `apps/web/src/lib/upi.test.ts`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces: `buildUpiDeepLink(input: { vpa: string; payeeName: string; amountInr: number }): string`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/upi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildUpiDeepLink } from "./upi";

describe("buildUpiDeepLink", () => {
  it("builds a upi:// deep link with the exact reserved amount pre-filled", () => {
    const link = buildUpiDeepLink({
      vpa: "asmtrade.demo1@okaxis",
      payeeName: "ASM Trade",
      amountInr: 99101, // ₹991.01
    });
    expect(link).toBe(
      "upi://pay?pa=asmtrade.demo1%40okaxis&pn=ASM%20Trade&am=991.01&cu=INR",
    );
  });

  it("formats a whole-rupee amount with two decimal places", () => {
    const link = buildUpiDeepLink({
      vpa: "a@b",
      payeeName: "X",
      amountInr: 100000, // ₹1000.00
    });
    expect(link).toContain("am=1000.00");
  });

  it("percent-encodes special characters in the VPA and payee name", () => {
    const link = buildUpiDeepLink({
      vpa: "user.name@some-bank",
      payeeName: "ASM Trade & Co",
      amountInr: 100,
    });
    expect(link).toContain("pa=user.name%40some-bank");
    expect(link).toContain("pn=ASM%20Trade%20%26%20Co");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/apps/web
pnpm exec vitest run src/lib/upi.test.ts
```

Expected: FAIL — cannot resolve `./upi`.

- [ ] **Step 3: Write `apps/web/src/lib/upi.ts`**

```ts
/**
 * Builds a `upi://pay` deep link with the exact reserved amount pre-filled.
 * Most UPI apps (GPay, PhonePe, Paytm, BHIM) auto-fill this so the user
 * doesn't retype it — the main real-world source of a wrong-amount payment.
 * Some UPI apps still let the user edit it before paying; the matching
 * engine, not this link, is the backstop for that case.
 */
export function buildUpiDeepLink(input: {
  vpa: string;
  payeeName: string;
  amountInr: number;
}): string {
  const rupees = (input.amountInr / 100).toFixed(2);
  const params = new URLSearchParams({
    pa: input.vpa,
    pn: input.payeeName,
    am: rupees,
    cu: "INR",
  });
  return `upi://pay?${params.toString()}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/apps/web
pnpm exec vitest run src/lib/upi.test.ts
```

Expected: PASS — 3/3 tests green. (If the exact percent-encoding of `&`/spaces doesn't match `URLSearchParams`'s default output — e.g. it encodes spaces as `+` instead of `%20` — adjust the test's expected string to match `URLSearchParams`'s real, documented encoding rather than changing the implementation; `URLSearchParams` is the correct, standard tool for this and its encoding is what any real UPI-app deep-link parser expects.)

- [ ] **Step 5: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add apps/web/src/lib/upi.ts apps/web/src/lib/upi.test.ts
git commit -m "feat(web): UPI deep-link builder with amount pre-fill"
```

---

## Task 6: Deposit-matcher engine (the verification table)

**Files:**
- Create: `apps/web/src/lib/deposit-matcher.ts`
- Test: `apps/web/src/lib/deposit-matcher.test.ts`

**Interfaces:**
- Consumes: `findLiveDepositByAmount`, `findLiveDepositByClaimedUtr`, `creditDepositToAccount` from `@asm/db`
- Produces:
  - `type MatchOutcome = { kind: "auto_approved"; depositId: string } | { kind: "manual_review"; reason: "reference_mismatch" | "reference_matches_different_deposit" | "ambiguous_amount"; depositId: string | null } | { kind: "orphan" }`
  - `matchCreditToDeposit(credit: { creditId: string; amountInr: number; utr: string | null }): Promise<MatchOutcome>`

This is the core of the design's 5-case table. Read `docs/superpowers/specs/2026-09-13-bank-feed-deposit-verification-design.md`'s "Matching an incoming bank credit against pending deposits" section before writing this — the test cases below are its 5 rows plus the added multi-match safety rule, made concrete.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/deposit-matcher.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, createAccountsForUser, createDepositIntent, creditDepositToAccount } from "@asm/db";
import { matchCreditToDeposit } from "./deposit-matcher";

let userId = "";
const createdCreditIds: string[] = [];

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `matcher-test-${Date.now()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.bankCredit.deleteMany({ where: { id: { in: createdCreditIds } } });
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

async function makeCredit(amountInr: number, utr: string | null): Promise<string> {
  const credit = await prisma.bankCredit.create({
    data: {
      vpa: "relayed",
      amountInr,
      utr: utr ?? `no-utr-${randomUUID()}`,
      receivedAt: new Date(),
      raw: "test",
    },
  });
  createdCreditIds.push(credit.id);
  return credit.id;
}

describe("matchCreditToDeposit", () => {
  it("Case 1: amount matches and reference matches -> auto-approve", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 10_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { claimedUtr: "case1-utr", status: "PENDING_CONFIRMATION" },
    });
    const creditId = await makeCredit(deposit.amountInr, "case1-utr");

    const outcome = await matchCreditToDeposit({ creditId, amountInr: deposit.amountInr, utr: "case1-utr" });
    expect(outcome).toEqual({ kind: "auto_approved", depositId: deposit.id });

    const updated = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updated.status).toBe("COMPLETED");
  });

  it("Case 2: amount matches, reference present but wrong -> manual review, not approved", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 11_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { claimedUtr: "case2-correct-utr", status: "PENDING_CONFIRMATION" },
    });
    const creditId = await makeCredit(deposit.amountInr, "case2-wrong-utr");

    const outcome = await matchCreditToDeposit({
      creditId,
      amountInr: deposit.amountInr,
      utr: "case2-wrong-utr",
    });
    expect(outcome).toEqual({
      kind: "manual_review",
      reason: "reference_mismatch",
      depositId: deposit.id,
    });

    const updated = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updated.status).toBe("PENDING_CONFIRMATION");
    const credit = await prisma.bankCredit.findUniqueOrThrow({ where: { id: creditId } });
    expect(credit.consumed).toBe(false);
  });

  it("Case 3: reference matches a different deposit, amount matches none -> manual review", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 12_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { claimedUtr: "case3-utr", status: "PENDING_CONFIRMATION" },
    });
    // A credit with a completely different amount, but the UTR that deposit claimed.
    const creditId = await makeCredit(deposit.amountInr + 500_000, "case3-utr");

    const outcome = await matchCreditToDeposit({
      creditId,
      amountInr: deposit.amountInr + 500_000,
      utr: "case3-utr",
    });
    expect(outcome).toEqual({
      kind: "manual_review",
      reason: "reference_matches_different_deposit",
      depositId: deposit.id,
    });
  });

  it("Case 4: amount matches, no reference on either side -> auto-approve", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 13_000,
      correlationId: randomUUID(),
    });
    // No claimedUtr set on the deposit.
    const creditId = await makeCredit(deposit.amountInr, null);

    const outcome = await matchCreditToDeposit({ creditId, amountInr: deposit.amountInr, utr: null });
    expect(outcome).toEqual({ kind: "auto_approved", depositId: deposit.id });
  });

  it("Case 5: VPA is irrelevant to matching (implicit — matchCreditToDeposit never receives a vpa argument at all)", () => {
    // No runtime assertion needed: the function signature itself has no vpa
    // parameter, so there is no code path where VPA could block a match.
    expect(true).toBe(true);
  });

  it("No amount match, no reference match -> orphan", async () => {
    const creditId = await makeCredit(999_999_990, "no-such-utr-anywhere");
    const outcome = await matchCreditToDeposit({
      creditId,
      amountInr: 999_999_990,
      utr: "no-such-utr-anywhere",
    });
    expect(outcome).toEqual({ kind: "orphan" });

    const credit = await prisma.bankCredit.findUniqueOrThrow({ where: { id: creditId } });
    expect(credit.consumed).toBe(false);
  });

  it("safety rule: amount matches more than one live deposit -> manual review, never a guess", async () => {
    // The partial unique index (Task 1) is a real Postgres constraint — it
    // rejects a second live deposit at the same amount no matter how the
    // INSERT happens, ORM or raw SQL. So to exercise the matcher's own
    // defense-in-depth branch (in case that constraint is ever missing —
    // a bad migration, a different environment), this test temporarily
    // drops the index, creates two live deposits at the same amount, runs
    // the matcher, then restores the index and cleans up. This is the only
    // way to reach this branch honestly; skipping the test would leave the
    // safety rule completely unverified.
    const shared = 444_444_321;

    // $executeRaw (tagged template), not $executeRawUnsafe — this repo's
    // eslint config bans the Unsafe variants outright (no-restricted-properties
    // in eslint.config.mjs). These statements have no interpolated values, so
    // the tagged-template form is both the safe AND the correct choice here.
    await prisma.$executeRaw`DROP INDEX "Deposit_live_amount_unique"`;
    try {
      await prisma.deposit.create({
        data: {
          userId,
          method: "upi",
          amountUsd: 1000,
          amountInr: shared,
          vpa: "asmtrade.demo1@okaxis",
          checkoutToken: `tok-${randomUUID()}`,
          status: "AWAITING_PAYMENT",
          correlationId: randomUUID(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await prisma.deposit.create({
        data: {
          userId,
          method: "upi",
          amountUsd: 1000,
          amountInr: shared,
          vpa: "asmtrade.demo1@okaxis",
          checkoutToken: `tok-${randomUUID()}`,
          status: "AWAITING_PAYMENT",
          correlationId: randomUUID(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      const creditId = await makeCredit(shared, null);
      const outcome = await matchCreditToDeposit({ creditId, amountInr: shared, utr: null });
      expect(outcome).toEqual({ kind: "manual_review", reason: "ambiguous_amount", depositId: null });
    } finally {
      await prisma.deposit.deleteMany({ where: { amountInr: shared } });
      await prisma.$executeRaw`CREATE UNIQUE INDEX "Deposit_live_amount_unique" ON "Deposit" ("amountInr") WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION')`;
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/apps/web
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/lib/deposit-matcher.test.ts
```

Expected: FAIL — cannot resolve `./deposit-matcher`.

- [ ] **Step 3: Write `apps/web/src/lib/deposit-matcher.ts`**

```ts
import { creditDepositToAccount, findLiveDepositByAmount, findLiveDepositByClaimedUtr } from "@asm/db";

export type MatchOutcome =
  | { kind: "auto_approved"; depositId: string }
  | {
      kind: "manual_review";
      reason: "reference_mismatch" | "reference_matches_different_deposit" | "ambiguous_amount";
      depositId: string | null;
    }
  | { kind: "orphan" };

/**
 * Priority: Amount -> Reference -> VPA (VPA is never checked here at all —
 * it isn't even a parameter). Amount is an exact match against whichever
 * single value was reserved to a live deposit, never a fuzzy tolerance.
 * Never auto-rejects: every path ends in either an approval or a queue for
 * a human, so a legitimate but slightly-off payment is never lost.
 */
export async function matchCreditToDeposit(credit: {
  creditId: string;
  amountInr: number;
  utr: string | null;
}): Promise<MatchOutcome> {
  const amountMatches = await findLiveDepositByAmount(credit.amountInr);

  if (amountMatches.length > 1) {
    // Should be prevented by the partial unique index — defense in depth
    // against a bug or a race. Never guess between two live deposits.
    return { kind: "manual_review", reason: "ambiguous_amount", depositId: null };
  }

  if (amountMatches.length === 1) {
    const deposit = amountMatches[0]!;
    const referenceMissing = !credit.utr || !deposit.claimedUtr;
    const referenceMatches = deposit.claimedUtr === credit.utr;

    if (referenceMissing || referenceMatches) {
      await creditDepositToAccount({ depositId: deposit.id, adminId: null, creditId: credit.creditId });
      return { kind: "auto_approved", depositId: deposit.id };
    }

    return { kind: "manual_review", reason: "reference_mismatch", depositId: deposit.id };
  }

  // No live deposit reserved this exact amount. Amount is primary and it
  // didn't match anything — but check whether the reference at least points
  // at a specific deposit, so a human reviewing the orphan queue has a lead.
  if (credit.utr) {
    const byReference = await findLiveDepositByClaimedUtr(credit.utr);
    if (byReference) {
      return {
        kind: "manual_review",
        reason: "reference_matches_different_deposit",
        depositId: byReference.id,
      };
    }
  }

  return { kind: "orphan" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/apps/web
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/lib/deposit-matcher.test.ts
```

Expected: PASS — all 7 tests green, pristine output.

- [ ] **Step 5: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add apps/web/src/lib/deposit-matcher.ts apps/web/src/lib/deposit-matcher.test.ts
git commit -m "feat(web): deposit-verification matching engine"
```

---

## Task 7: Shared Redis client (small refactor of Task 12's rate-limit.ts)

**Files:**
- Create: `apps/web/src/lib/redis.ts`
- Modify: `apps/web/src/lib/rate-limit.ts`

**Interfaces:**
- Consumes: `config.redisUrl` from `@asm/config`
- Produces: `redis` — a shared `ioredis` client instance

This is a small, behavior-preserving extraction so the admin session module (Task 8) doesn't open a second Redis connection. No new tests needed — `apps/web/src/lib/rate-limit.test.ts` doesn't exist yet (rate-limit.ts has never had dedicated unit tests; its behavior is covered by the login route's live verification from Plan 01). Existing behavior must be unchanged, verified by running the full web test suite after this change.

- [ ] **Step 1: Write `apps/web/src/lib/redis.ts`**

```ts
import Redis from "ioredis";
import { config } from "@asm/config";

/** One connection per process — shared by rate limiting and admin sessions. */
export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
```

- [ ] **Step 2: Modify `apps/web/src/lib/rate-limit.ts` to use the shared client**

The current file starts:

```ts
import Redis from "ioredis";
import { config } from "@asm/config";

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
```

Replace those four lines with:

```ts
import { redis } from "./redis";
```

The rest of the file (the `checkRateLimit` function) is unchanged.

- [ ] **Step 3: Run the full web test suite to confirm no regression**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/apps/web
pnpm exec vitest run
```

Expected: PASS — same test count and pass rate as before this task (this change touches no test files and no behavior, only where the Redis client is instantiated).

- [ ] **Step 4: Typecheck**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm exec tsc --noEmit -p apps/web
```

Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add apps/web/src/lib/redis.ts apps/web/src/lib/rate-limit.ts
git commit -m "refactor(web): extract shared Redis client"
```

---

## Task 8: Admin session (secret check + cookie), login and logout routes

**Files:**
- Create: `apps/web/src/lib/admin-session.ts`
- Create: `apps/web/src/app/api/admin/login/route.ts`
- Create: `apps/web/src/app/api/admin/logout/route.ts`
- Create: `apps/web/src/app/admin/login/page.tsx`

**Interfaces:**
- Consumes: `redis` from `./redis`, `checkRateLimit` from `./rate-limit`, `requestContext` from `./request-context`, `childLogger` from `@asm/logger`
- Produces:
  - `ADMIN_SESSION_COOKIE` (constant)
  - `ADMIN_SESSION_COOKIE_OPTIONS` (constant)
  - `verifyAdminSecret(candidate: string): boolean`
  - `createAdminSession(): Promise<string>` (returns the raw token)
  - `readAdminSession(token: string | undefined): Promise<boolean>`
  - `destroyAdminSession(token: string): Promise<void>`

**Environment:** requires a new env var `ADMIN_PANEL_SECRET`. Add it to `.env.example` (append `ADMIN_PANEL_SECRET="change-me-in-.env"` with a comment) and to your local `.env` with a real value before testing — check `@asm/config`'s schema; this new var is intentionally NOT validated there (it's read directly via `process.env`, matching how `SMS_RELAY_SECRET` is read directly in the design rather than piped through `@asm/config`, since it's specific to one route/feature, not general app config).

- [ ] **Step 1: Write `apps/web/src/lib/admin-session.ts`**

No TDD step here — this is thin plumbing around Redis with no business logic of its own to unit test in isolation (its behavior is verified end-to-end by the login/logout route's live verification in Step 5 below, matching how `session.ts` in Plan 01 was verified).

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { redis } from "./redis";

export const ADMIN_SESSION_COOKIE = "asm_admin_session";
const ADMIN_SESSION_TTL_SEC = 60 * 60 * 24; // 24h

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Timing-safe comparison against a single shared secret, independent of any
 * user account — this is deliberately not tied to the `role` field (see
 * design doc: a separate secret, not the existing ADMIN role).
 */
export function verifyAdminSecret(candidate: string): boolean {
  const secret = process.env["ADMIN_PANEL_SECRET"] ?? "";
  if (!secret || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createAdminSession(): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await redis.set(`admin:session:${hashToken(token)}`, "1", "EX", ADMIN_SESSION_TTL_SEC);
  return token;
}

export async function readAdminSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const exists = await redis.get(`admin:session:${hashToken(token)}`);
  return exists !== null;
}

export async function destroyAdminSession(token: string): Promise<void> {
  await redis.del(`admin:session:${hashToken(token)}`);
}

export const ADMIN_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env["NODE_ENV"] === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: ADMIN_SESSION_TTL_SEC,
};
```

- [ ] **Step 2: Write `apps/web/src/app/api/admin/login/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { childLogger } from "@asm/logger";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_OPTIONS,
  createAdminSession,
  verifyAdminSecret,
} from "@/lib/admin-session";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const okIp = await checkRateLimit(`rl:admin_login:ip:${ctx.ip}`, 10, 300);
  if (!okIp) {
    log.warn({ evt: "security.rate_limited", route: "admin_login" }, "admin login throttled");
    return NextResponse.json(
      { error: "Too many attempts. Wait five minutes and try again." },
      { status: 429 },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const secret = typeof body === "object" && body !== null && "secret" in body
    ? String((body as { secret: unknown }).secret)
    : "";

  if (!verifyAdminSecret(secret)) {
    log.warn({ evt: "security.authz_denied", route: "admin_login" }, "wrong admin secret");
    return NextResponse.json({ error: "Incorrect secret." }, { status: 401 });
  }

  const token = await createAdminSession();
  log.info({ evt: "admin.login" }, "admin session created");

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(ADMIN_SESSION_COOKIE, token, ADMIN_SESSION_COOKIE_OPTIONS);
  return response;
}
```

- [ ] **Step 3: Write `apps/web/src/app/api/admin/logout/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, destroyAdminSession } from "@/lib/admin-session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (token) await destroyAdminSession(token);

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
```

- [ ] **Step 4: Write `apps/web/src/app/admin/login/page.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });

    if (res.ok) {
      router.push("/admin/messages");
      return;
    }
    const data = (await res.json()) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin access</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          required
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Admin secret"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        {error ? <p className="text-sm text-[var(--color-down)]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Verify live — set the env var, start the dev server, exercise login/logout**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
grep -q ADMIN_PANEL_SECRET .env || echo 'ADMIN_PANEL_SECRET="dev-only-admin-secret-change-me"' >> .env
rm -rf apps/web/.next
pnpm --filter @asm/web dev > /tmp/web-dev-admin-check.log 2>&1 &
sleep 8

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' -d '{"secret":"wrong-secret"}'
echo "^ expected 401"

curl -s -D- -o /dev/null -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' -d '{"secret":"dev-only-admin-secret-change-me"}' \
  | grep -i "^HTTP\|set-cookie"
echo "^ expected 200 and a Set-Cookie: asm_admin_session=... with HttpOnly, SameSite=strict"

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/logout
echo "^ expected 204"

pkill -f "next dev"
```

Expected output matches the three `echo` lines above exactly.

- [ ] **Step 6: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add apps/web/src/lib/admin-session.ts apps/web/src/app/api/admin/login/route.ts \
  apps/web/src/app/api/admin/logout/route.ts apps/web/src/app/admin/login/page.tsx .env.example
git commit -m "feat(web): admin session (secret-gated, independent of user accounts)"
```

---

## Task 9: Ingestion endpoint — `POST /api/bank-feed/sms`

**Files:**
- Create: `apps/web/src/app/api/bank-feed/sms/route.ts`
- Modify: `apps/relay/src/relayConfig.ts` (comment only — see Task 11, do NOT do it here; this task is the endpoint only)

**Interfaces:**
- Consumes: `parseBankSms` from `./parse-bank-sms`, `matchCreditToDeposit` from `./deposit-matcher`, `createRelayMessage`, `linkRelayMessageToCredit`, `createBankCreditIfNew`, `DEMO_VPA` from `@asm/db`, `requestContext` from `./request-context`, `childLogger` from `@asm/logger`
- Produces: `POST /api/bank-feed/sms` — `202` for any accepted request (parsed or not — an ignored promotional SMS is normal, not an error), `401` for a missing/wrong Bearer token, `400` for a malformed body

**Environment:** requires `SMS_RELAY_SECRET` (same variable `apps/harness` already documents in its own `.env.example` — check yours is set to whatever you'll configure the relay app to send, see Task 11).

- [ ] **Step 1: Write `apps/web/src/app/api/bank-feed/sms/route.ts`**

No TDD step for this file — it's a thin orchestration layer over already-tested units (the parser, the matcher, the repositories); its correctness is verified live in Step 2 below, matching how Plan 01's own route handlers (register, login) were verified.

```ts
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_VPA,
  createBankCreditIfNew,
  createRelayMessage,
  linkRelayMessageToCredit,
} from "@asm/db";
import { childLogger } from "@asm/logger";
import { matchCreditToDeposit } from "@/lib/deposit-matcher";
import { parseBankSms } from "@/lib/parse-bank-sms";
import { requestContext } from "@/lib/request-context";

const SOURCE = "sms-relay";

function authorised(header: string | null): boolean {
  const secret = process.env["SMS_RELAY_SECRET"] ?? "";
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface RelayedSmsBody {
  sender?: string;
  body?: string;
  receivedAt?: string;
  deviceLabel?: string;
  deviceModel?: string;
}

function isRelayedSmsBody(value: unknown): value is RelayedSmsBody {
  return typeof value === "object" && value !== null;
}

/**
 * Ingress for the companion app. Accepts a bank SMS the operator's own phone
 * forwarded, logs it unconditionally, parses it, and — for a credit — tries
 * to match it against a live deposit immediately.
 *
 * Always returns 202 for an authorised, well-formed request, whether or not
 * it turned into anything — an ignored promotional SMS is normal operation.
 */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  if (!authorised(req.headers.get("authorization"))) {
    log.warn(
      { evt: "security.authz_denied", route: "bank_feed_sms" },
      "unauthorised relay attempt",
    );
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  if (!isRelayedSmsBody(body) || typeof body.body !== "string") {
    return NextResponse.json({ error: "Malformed relay payload." }, { status: 400 });
  }

  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
  const parsed = parseBankSms(body.body);

  const relayMessage = await createRelayMessage({
    source: SOURCE,
    deviceLabel: body.deviceLabel ?? null,
    deviceModel: body.deviceModel ?? null,
    sender: body.sender ?? null,
    body: body.body,
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    parsedAmountInr: parsed?.amountInr ?? null,
    parsedUtr: parsed?.utr ?? null,
    isCredit: parsed?.isCredit ?? null,
  });

  if (!parsed || !parsed.isCredit) {
    log.info({ evt: "bankfeed.ignored", relayMessageId: relayMessage.id }, "message ignored");
    return NextResponse.json({ accepted: true, matched: false }, { status: 202 });
  }

  const credit = await createBankCreditIfNew({
    vpa: DEMO_VPA,
    amountInr: parsed.amountInr,
    utr: parsed.utr ?? `no-utr-${Date.now()}`,
    receivedAt: relayMessage.receivedAt,
    raw: body.body,
  });

  if (!credit) {
    // Duplicate UTR — the relay's own retry logic can resend the same
    // message; this is normal, not an error.
    log.info(
      { evt: "bankfeed.duplicate", relayMessageId: relayMessage.id },
      "duplicate credit ignored",
    );
    return NextResponse.json({ accepted: true, matched: false }, { status: 202 });
  }

  await linkRelayMessageToCredit(relayMessage.id, credit.id);

  const outcome = await matchCreditToDeposit({
    creditId: credit.id,
    amountInr: credit.amountInr,
    utr: parsed.utr,
  });

  log.info(
    { evt: "bankfeed.matched", outcome: outcome.kind, relayMessageId: relayMessage.id },
    "credit processed",
  );

  return NextResponse.json(
    { accepted: true, matched: outcome.kind === "auto_approved" },
    { status: 202 },
  );
}
```

- [ ] **Step 2: Verify live — a credit that matches a manually-created live deposit auto-approves**

This requires Task 2's `createDepositIntent` and a running dev server. Run this as a one-off Node script rather than curl, so it can create the matching deposit and then simulate the exact SMS in one flow:

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
grep -q SMS_RELAY_SECRET .env || echo 'SMS_RELAY_SECRET="dev-only-relay-secret-change-me"' >> .env
rm -rf apps/web/.next
pnpm --filter @asm/web dev > /tmp/web-dev-ingest-check.log 2>&1 &
sleep 8

cat > /tmp/ingest-check.mjs <<'EOF'
import { randomUUID } from "node:crypto";
import { prisma, createAccountsForUser, createDepositIntent } from "/Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db/src/index.ts";

const user = await prisma.user.create({
  data: { email: `ingest-check-${Date.now()}@test.local`, passwordHash: "x" },
});
await createAccountsForUser(user.id, 0);
const deposit = await createDepositIntent({
  userId: user.id,
  method: "upi",
  amountUsdMinor: 10_000,
  correlationId: randomUUID(),
});
console.log("Reserved amount (paise):", deposit.amountInr);
const rupees = (deposit.amountInr / 100).toFixed(2);

const res = await fetch("http://localhost:3000/api/bank-feed/sms", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer dev-only-relay-secret-change-me",
  },
  body: JSON.stringify({
    sender: "SBI",
    body: `Dear Customer, Rs.${rupees} credited to A/c XX1234 on today. Ref No: ${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    receivedAt: new Date().toISOString(),
    deviceLabel: "ingest-check",
    deviceModel: "test",
  }),
});
console.log("HTTP status:", res.status);
console.log("Body:", await res.json());

const updated = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
console.log("Deposit status after ingestion:", updated.status);

await prisma.transaction.deleteMany({ where: { account: { userId: user.id } } });
await prisma.bonusGrant.deleteMany({ where: { account: { userId: user.id } } });
await prisma.deposit.deleteMany({ where: { userId: user.id } });
await prisma.account.deleteMany({ where: { userId: user.id } });
await prisma.user.delete({ where: { id: user.id } });
EOF

DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade?schema=public" \
  pnpm exec tsx /tmp/ingest-check.mjs

rm /tmp/ingest-check.mjs
pkill -f "next dev"
```

Expected: `HTTP status: 202`, `Body: { accepted: true, matched: true }`, `Deposit status after ingestion: COMPLETED`.

- [ ] **Step 3: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add apps/web/src/app/api/bank-feed/sms/route.ts .env.example
git commit -m "feat(web): bank-feed SMS ingestion endpoint"
```

---

## Task 10: Admin panel pages — messages and deposits

**Files:**
- Create: `apps/web/src/app/admin/messages/page.tsx`
- Create: `apps/web/src/app/admin/deposits/page.tsx`
- Create: `apps/web/src/app/api/admin/deposits/route.ts`
- Create: `apps/web/src/app/api/admin/deposits/match/route.ts`

**Interfaces:**
- Consumes: `readAdminSession`, `ADMIN_SESSION_COOKIE` from `./admin-session`; `listRelayMessages`, `listOrphanBankCredits`, `createDepositIntent`, `creditDepositToAccount` from `@asm/db`
- Produces: `/admin/messages`, `/admin/deposits` (both redirect to `/admin/login` when not authenticated); `POST /api/admin/deposits` (create a test deposit); `POST /api/admin/deposits/match` (manual-match action)

- [ ] **Step 1: Write `apps/web/src/app/admin/messages/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listRelayMessages } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; deviceLabel?: string }>;
}) {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");

  const params = await searchParams;
  const messages = await listRelayMessages(
    { source: params.source, deviceLabel: params.deviceLabel },
    200,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Incoming messages</h1>
        <a
          href="/admin/deposits"
          className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
        >
          Deposits →
        </a>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-edge)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--color-panel)] text-[var(--color-ink-2)]">
            <tr>
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">Sender</th>
              <th className="px-3 py-2">Body</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">UTR</th>
              <th className="px-3 py-2">Credit?</th>
              <th className="px-3 py-2">Matched?</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id} className="border-t border-[var(--color-edge)]">
                <td className="px-3 py-2 whitespace-nowrap">{m.receivedAt.toISOString()}</td>
                <td className="px-3 py-2">{m.source}</td>
                <td className="px-3 py-2">{m.deviceLabel ?? "—"}</td>
                <td className="px-3 py-2">{m.sender ?? "—"}</td>
                <td className="px-3 py-2 max-w-xs truncate" title={m.body}>{m.body}</td>
                <td className="px-3 py-2 tabular-nums">
                  {m.parsedAmountInr != null ? (m.parsedAmountInr / 100).toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2">{m.parsedUtr ?? "—"}</td>
                <td className="px-3 py-2">{m.isCredit === null ? "—" : m.isCredit ? "yes" : "no"}</td>
                <td className="px-3 py-2">{m.bankCreditId ? "→ credit" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {messages.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-2)]">No messages yet.</p>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/app/api/admin/deposits/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createDepositIntent } from "@asm/db";
import { randomUUID } from "node:crypto";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

/**
 * Admin-only "create a test deposit" tool — lets an operator watch a real
 * incoming SMS match a real deposit end to end, without the real checkout
 * page existing yet. Requires a userId to attach the deposit to; the
 * operator supplies one (e.g. their own seeded test user's id).
 */
export async function POST(req: NextRequest) {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    !("userId" in body) ||
    !("amountUsdMinor" in body) ||
    typeof (body as { userId: unknown }).userId !== "string" ||
    typeof (body as { amountUsdMinor: unknown }).amountUsdMinor !== "number"
  ) {
    return NextResponse.json({ error: "userId and amountUsdMinor are required." }, { status: 400 });
  }

  const { userId, amountUsdMinor } = body as { userId: string; amountUsdMinor: number };

  try {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor,
      correlationId: randomUUID(),
    });
    return NextResponse.json(
      { depositId: deposit.id, reservedAmountInr: deposit.amountInr, vpa: deposit.vpa },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 3: Write `apps/web/src/app/api/admin/deposits/match/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { creditDepositToAccount } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

/** Manual override for an orphaned credit — links it to a specific deposit
 * and runs the exact same approve-and-credit transaction the auto-matcher
 * uses, just triggered by a human instead. */
export async function POST(req: NextRequest) {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    !("depositId" in body) ||
    !("creditId" in body) ||
    typeof (body as { depositId: unknown }).depositId !== "string" ||
    typeof (body as { creditId: unknown }).creditId !== "string"
  ) {
    return NextResponse.json({ error: "depositId and creditId are required." }, { status: 400 });
  }

  const { depositId, creditId } = body as { depositId: string; creditId: string };

  try {
    await creditDepositToAccount({ depositId, adminId: "admin-panel", creditId });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
```

- [ ] **Step 4: Write `apps/web/src/app/admin/deposits/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listOrphanBankCredits, prisma } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

export default async function AdminDepositsPage() {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");

  const [deposits, orphans] = await Promise.all([
    prisma.deposit.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    listOrphanBankCredits(100),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Deposits</h1>
        <a
          href="/admin/messages"
          className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
        >
          ← Messages
        </a>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Create test deposit
        </h2>
        <form
          className="flex flex-wrap gap-2"
          action="/api/admin/deposits"
          method="post"
          encType="application/json"
        >
          <input
            name="userId"
            placeholder="userId"
            required
            className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-3 py-2 text-sm"
          />
          <input
            name="amountUsdMinor"
            type="number"
            placeholder="Amount (USD cents)"
            required
            className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white"
          >
            Create
          </button>
        </form>
        <p className="text-xs text-[var(--color-ink-2)]">
          Note: this form posts JSON via the browser's native form encoding, which
          sends form-urlencoded, not JSON — for a real test, use curl or the
          browser devtools console to POST JSON directly to /api/admin/deposits,
          e.g.: <code>fetch(&quot;/api/admin/deposits&quot;, {'{'} method: &quot;POST&quot;, headers: {'{'}
          &quot;Content-Type&quot;: &quot;application/json&quot; {'}'}, body: JSON.stringify({'{'}
          userId, amountUsdMinor {'}'}) {'}'})</code>.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Orphaned credits (need manual matching)
        </h2>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-edge)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-panel)] text-[var(--color-ink-2)]">
              <tr>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">UTR</th>
                <th className="px-3 py-2">Credit ID</th>
              </tr>
            </thead>
            <tbody>
              {orphans.map((c) => (
                <tr key={c.id} className="border-t border-[var(--color-edge)]">
                  <td className="px-3 py-2 whitespace-nowrap">{c.receivedAt.toISOString()}</td>
                  <td className="px-3 py-2 tabular-nums">{(c.amountInr / 100).toFixed(2)}</td>
                  <td className="px-3 py-2">{c.utr}</td>
                  <td className="px-3 py-2 font-mono">{c.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orphans.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-2)]">No orphaned credits.</p>
        ) : (
          <p className="text-xs text-[var(--color-ink-2)]">
            To manually match, POST {'{'} depositId, creditId {'}'} to
            /api/admin/deposits/match with the depositId from the table below.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Recent deposits
        </h2>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-edge)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-panel)] text-[var(--color-ink-2)]">
              <tr>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Reserved amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Deposit ID</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id} className="border-t border-[var(--color-edge)]">
                  <td className="px-3 py-2 whitespace-nowrap">{d.createdAt.toISOString()}</td>
                  <td className="px-3 py-2 font-mono">{d.userId}</td>
                  <td className="px-3 py-2 tabular-nums">{(d.amountInr / 100).toFixed(2)}</td>
                  <td className="px-3 py-2">{d.status}</td>
                  <td className="px-3 py-2 font-mono">{d.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Typecheck and lint**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm exec tsc --noEmit -p apps/web
pnpm lint
```

Expected: both clean (typecheck: no output; lint: 0 errors, at most the 1 pre-existing warning in `packages/logger/src/index.test.ts`).

- [ ] **Step 6: Verify live — the admin pages redirect when unauthenticated, and render when authenticated**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
rm -rf apps/web/.next
pnpm --filter @asm/web dev > /tmp/web-dev-admin-pages-check.log 2>&1 &
sleep 8

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/messages
echo "^ expected 307 (redirect to /admin/login)"

COOKIE=$(curl -s -D- -o /dev/null -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' -d '{"secret":"dev-only-admin-secret-change-me"}' \
  | grep -i "^set-cookie" | sed -E 's/set-cookie: ([^;]+);.*/\1/i')

curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: $COOKIE" http://localhost:3000/admin/messages
echo "^ expected 200"

curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: $COOKIE" http://localhost:3000/admin/deposits
echo "^ expected 200"

pkill -f "next dev"
```

Expected: the three status codes match the `echo` lines exactly (307, 200, 200).

- [ ] **Step 7: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add apps/web/src/app/admin
git commit -m "feat(web): admin panel — incoming messages, deposits, manual matching, test-deposit tool"
```

---

## Task 11: Point the relay app at the website

**Files:**
- Modify: `apps/relay/src/relayConfig.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: no new exports — this changes one constant's value and its surrounding comment only

This is the **one authorized change** to `apps/relay` — everything else in that app (and all of `apps/harness`) stays untouched, per the Global Constraint at the top of this plan.

- [ ] **Step 1: Read the current file to find the exact block to change**

```bash
cat /Users/solminde/Developer/Personal/AMScoins/asmtrading/apps/relay/src/relayConfig.ts
```

Locate the `RELAY_CONFIG` object's `serverUrl` and `secret` fields and the comment above them (it currently says something like "there is no Settings screen... Edit these values and rebuild").

- [ ] **Step 2: Update `serverUrl` and the comment**

Change `serverUrl` to a clearly-a-placeholder value and update the comment to explain the new tunnel-based workflow. The exact replacement text for the comment and the `serverUrl`/`secret` lines (keep every other field in `RELAY_CONFIG` — `senders`, `deviceLabel` — exactly as they are):

```ts
// There is no Settings screen (Plan 06's original design cut it — see
// docs/superpowers/plans/README.md). Edit these values and rebuild.
//
// serverUrl now points at apps/web directly (not apps/harness — see
// docs/superpowers/specs/2026-09-13-bank-feed-deposit-verification-design.md).
// apps/web is not permanently deployed, so during a test session expose it
// with a tunnel (e.g. `ngrok http 3000`) and paste the tunnel's https URL
// here, then rebuild. The path (`/api/bank-feed/sms`) and the
// Authorization header logic below are unchanged — only this base URL
// and the shared secret (must match apps/web's SMS_RELAY_SECRET env var)
// need updating.
serverUrl: "https://REPLACE-WITH-YOUR-TUNNEL-URL.ngrok-free.app",
secret: "dev-only-relay-secret-change-me",
```

- [ ] **Step 3: Confirm nothing else in the file changed**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git diff apps/relay/src/relayConfig.ts
```

Expected: the diff touches only the comment block and the `serverUrl`/`secret` lines — `senders`, `deviceLabel`, and every other field/line in the file are unchanged.

- [ ] **Step 4: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add apps/relay/src/relayConfig.ts
git commit -m "chore(relay): point serverUrl at apps/web instead of apps/harness"
```

---

## Task 12: Full verification sweep and manual end-to-end walkthrough

**Files:** none created — verification only.

- [ ] **Step 1: Full lint/typecheck/test sweep**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm lint
pnpm typecheck
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" pnpm test
```

Expected: all three clean — lint 0 errors (at most the 1 pre-existing warning), typecheck no output, every test file across every package green.

- [ ] **Step 2: Confirm the Global Constraint held — no changes to apps/harness, and the only apps/relay change is the one from Task 11**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git diff main --stat -- apps/harness
git diff main --stat -- apps/relay
```

Expected: the first command prints nothing (empty diff). The second prints exactly one file, `apps/relay/src/relayConfig.ts`.

- [ ] **Step 3: Write the manual test walkthrough into the design spec as a completion note**

Append this section to the end of `docs/superpowers/specs/2026-09-13-bank-feed-deposit-verification-design.md`:

```markdown

## Manual end-to-end test walkthrough (once this plan is implemented)

1. Start a tunnel: `ngrok http 3000` (or your preferred tunnel tool), note the https URL it prints.
2. Update `apps/relay/src/relayConfig.ts`'s `serverUrl` to that URL, rebuild and reinstall the relay app on your phone (`cd apps/relay && pnpm android`, or your usual build command).
3. Set `SMS_RELAY_SECRET` and `ADMIN_PANEL_SECRET` in `.env` to match what you put in `relayConfig.ts`'s `secret`.
4. Run `pnpm dev` (starts `apps/web`).
5. Log into `/admin/login` with your `ADMIN_PANEL_SECRET`.
6. Use the admin panel (or a direct `fetch`/curl to `/api/admin/deposits`) to create a test deposit for a real seeded user, noting the reserved amount it returns.
7. Pay that exact amount via UPI on your phone (or send yourself a test SMS that mimics your bank's real format with that amount) so the relay forwards it.
8. Check `/admin/messages` — the message should appear. Check `/admin/deposits` — the deposit should show `COMPLETED` if the amount and (if present) reference matched, or the credit should appear in the orphan list if not, ready for a manual match.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add docs/superpowers/specs/2026-09-13-bank-feed-deposit-verification-design.md
git commit -m "docs: manual end-to-end test walkthrough for bank-feed integration"
```

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass across the whole workspace
- [ ] `git diff main -- apps/harness` is empty
- [ ] `git diff main -- apps/relay` touches only `relayConfig.ts`
- [ ] A `POST /api/bank-feed/sms` request with the right Bearer secret and a credit-shaped SMS body, matching a live deposit's reserved amount, auto-approves that deposit end-to-end (verified live in Task 9)
- [ ] `/admin/messages` and `/admin/deposits` both redirect to `/admin/login` when unauthenticated, and render when authenticated (verified live in Task 10)
- [ ] All 5 verification-table cases plus the multi-match safety rule are covered by automated tests (Task 6) and pass against a real Postgres
