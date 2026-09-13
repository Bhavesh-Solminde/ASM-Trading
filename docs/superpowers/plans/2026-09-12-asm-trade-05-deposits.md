# ASM Trade — Plan 05: Deposit Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The full deposit architecture — odd-amount reservation, a PSP-style hosted checkout with QR and VPA, a self-declared UTR, automatic reconciliation against a bank feed, an admin queue for the residue, and a 50% bonus with turnover — running against a simulated bank so no real money moves.

**Architecture:** The amount is the primary key, not the UTR. A partial unique index reserves each odd rupee amount to exactly one live deposit, which makes a matching credit unambiguously attributable. Three `BankFeed` adapters sit behind one interface selected by `BANK_FEED`; only `simulated` is ever configured. SMS and email share one candidate-plus-disambiguate parser, so adding a bank is a table row rather than a code change.

**Tech Stack:** TypeScript · Prisma 7 · Postgres 16 · Next.js 16 · Zod 4 · Vitest 5

## Global Constraints

- **Everything from Plans 01–04 applies** — Node `>=22.0.0`, exact pinned versions, `z.strictObject()` at every boundary, money as integer minor units, `actorId` on every user-owned query, no Docker.
- **No real money, ever.** `BANK_FEED=simulated` is the only configured value. The `sms` and `email` adapters are built and exercised against sources the operator controls, never attached to a real collection account or anyone else's device.
- **The amount is the match key.** A UTR is a *claim*, not proof — nothing verifies it against NPCI. It is a tiebreaker and an audit trail.
- **One credit settles exactly one deposit.** The `consumed` flag is set in the same transaction as the approval.
- **The admin queue sees only the residue.** Exact and amount-only matches auto-approve; near-misses and orphans go to a human.
- **Bonus funds are not withdrawable until turnover clears.** `realBalance` and `bonusBalance` stay separate, and withdrawals draw only from real.
- **New exact version:** `qrcode@1.5.5`.

---

## File Structure

```
packages/contracts/src/
└── deposit.ts              CreateDepositSchema, ClaimUtrSchema, WithdrawSchema

packages/bankfeed/
├── package.json
├── tsconfig.json
└── src/
    ├── types.ts            BankFeed, Credit
    ├── parser/
    │   ├── candidates.ts   generic amount + reference extraction
    │   ├── disambiguate.ts keyword scoring, credit vs debit
    │   └── index.ts        parseBankMessage
    ├── simulated.ts        injects matching credits on a timer
    ├── sms-relay.ts        consumes POSTed SMS bodies
    ├── imap.ts             polls a mailbox
    ├── factory.ts          createBankFeed(kind)
    └── index.ts

packages/db/
├── prisma/migrations/*_deposit_partial_unique/migration.sql
└── src/repositories/
    ├── deposit.ts          intent, claim, matcher, approve, reject
    └── withdrawal.ts       request, approve, reject

apps/web/src/
├── app/api/deposits/route.ts              POST intent, GET list
├── app/api/deposits/[id]/claim/route.ts      POST UTR claim
├── app/api/bank-feed/sms/route.ts         SMS relay ingress
├── app/checkout/[token]/page.tsx          the PSP-style page
├── app/(platform)/deposit/page.tsx        method picker + amount
├── app/admin/deposits/page.tsx            approval queue
├── app/admin/deposits/actions.ts          approve/reject server actions
└── components/deposit/
    ├── MethodPicker.tsx
    └── AmountStep.tsx

apps/engine/src/
└── bank-feed-runner.ts     starts the configured feed + matcher loop
```

---

## Task 1: Amount reservation and the partial unique index

**Files:**
- Create: `packages/db/prisma/migrations/20260912000000_deposit_partial_unique/migration.sql`
- Create: `packages/db/src/repositories/deposit.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/repositories/deposit.test.ts`

**Interfaces:**
- Consumes: `prisma`
- Produces:
  - `class AmountSpaceExhausted extends Error`
  - `createDepositIntent(input: { userId: string; method: string; amountUsdMinor: number; correlationId: string }): Promise<Deposit>`
  - `getDepositByToken(token: string): Promise<Deposit | null>`
  - `listDepositsForActor(actorId: string, limit: number): Promise<Deposit[]>`
  - `USD_TO_INR_RATE`, `OFFSET_SPACE`, `DEPOSIT_TTL_MINUTES`

**Why a hand-written migration.** The reservation guarantee needs a **partial** unique index — unique on `(vpa, amountInr)` only while a deposit is live. Prisma cannot express that declaratively, which is why Plan 01 left an ordinary index with a comment. A plain unique would be wrong: it would block two legitimate completed deposits that happened to share an amount months apart.

- [ ] **Step 1: Write the migration**

```sql
-- The amount is the reconciliation key, so it must be unique among LIVE
-- deposits only. A full unique constraint would wrongly reject two legitimate
-- COMPLETED deposits that share an amount at different times.
DROP INDEX IF EXISTS "Deposit_vpa_amountInr_status_idx";

CREATE UNIQUE INDEX "Deposit_live_amount_unique"
  ON "Deposit" ("vpa", "amountInr")
  WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION');

CREATE INDEX "Deposit_vpa_amount_idx" ON "Deposit" ("vpa", "amountInr");
```

- [ ] **Step 2: Apply the migration**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
for DB in asm_trade asm_trade_test; do
  DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/$DB?schema=public" \
    pnpm exec prisma migrate deploy
done
psql -d asm_trade -c "\di Deposit_live_amount_unique"
```

Expected: the index is listed.

- [ ] **Step 3: Write the failing test**

Create `packages/db/src/repositories/deposit.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client.js";
import {
  DEPOSIT_TTL_MINUTES,
  USD_TO_INR_RATE,
  createDepositIntent,
  getDepositByToken,
  listDepositsForActor,
} from "./deposit.js";

const prisma = new PrismaClient();

let userId = "";

beforeEach(async () => {
  await prisma.deposit.deleteMany({});
  const user = await prisma.user.create({
    data: { email: `d-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function intent(amountUsdMinor = 10_000) {
  return createDepositIntent({
    userId,
    method: "PhonePe",
    amountUsdMinor,
    correlationId: "abc123",
  });
}

describe("createDepositIntent", () => {
  it("converts USD to INR at the configured rate", async () => {
    const deposit = await intent(10_000); // $100.00
    const expectedBase = Math.round(10_000 * USD_TO_INR_RATE);
    expect(deposit.amountInr).toBeGreaterThanOrEqual(expectedBase);
    expect(deposit.amountInr).toBeLessThan(expectedBase + 1_000);
  });

  it("assigns an odd amount rather than a round one", async () => {
    const deposit = await intent(10_000);
    // The offset guarantees a non-round paise value in the reserved space.
    expect(deposit.amountInr % 100_000).not.toBe(0);
  });

  it("reserves a distinct amount for each concurrent deposit", async () => {
    const deposits = await Promise.all([intent(), intent(), intent(), intent()]);
    const amounts = deposits.map((d) => `${d.vpa}:${d.amountInr}`);
    expect(new Set(amounts).size).toBe(4);
  });

  it("issues a unique checkout token", async () => {
    const a = await intent();
    const b = await intent();
    expect(a.checkoutToken).not.toBe(b.checkoutToken);
    expect(a.checkoutToken.length).toBeGreaterThan(20);
  });

  it("starts in AWAITING_PAYMENT with an expiry in the future", async () => {
    const deposit = await intent();
    expect(deposit.status).toBe("AWAITING_PAYMENT");
    const minutesOut = (deposit.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutesOut).toBeGreaterThan(DEPOSIT_TTL_MINUTES - 2);
  });

  it("rejects an amount below the minimum", async () => {
    await expect(intent(100)).rejects.toThrow(/minimum/i);
  });

  it("frees the reserved amount once a deposit completes", async () => {
    const first = await intent();
    await prisma.deposit.update({
      where: { id: first.id },
      data: { status: "COMPLETED" },
    });

    // A new intent may now legitimately land on the same amount.
    const second = await intent();
    expect(second.id).not.toBe(first.id);
  });
});

describe("getDepositByToken and listDepositsForActor", () => {
  it("finds a deposit by its checkout token", async () => {
    const deposit = await intent();
    const found = await getDepositByToken(deposit.checkoutToken);
    expect(found?.id).toBe(deposit.id);
  });

  it("returns null for an unknown token", async () => {
    expect(await getDepositByToken("not-a-token")).toBeNull();
  });

  it("lists only the actor's own deposits", async () => {
    await intent();
    const other = await prisma.user.create({
      data: { email: `o-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
    });
    expect(await listDepositsForActor(other.id, 20)).toEqual([]);
    expect((await listDepositsForActor(userId, 20)).length).toBe(1);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/deposit.test.ts
```

Expected: FAIL — cannot resolve `./deposit.js`.

- [ ] **Step 5: Write `packages/db/src/repositories/deposit.ts`**

```ts
import { randomBytes } from "node:crypto";
import { prisma } from "../client.js";
import type { Deposit } from "../../generated/prisma/client.js";

/**
 * The PSP-style conversion rate. Deliberately above interbank — that spread is
 * the margin the real processors take before a customer has traded anything.
 */
export const USD_TO_INR_RATE = 107.64;

/** Paise offsets available per VPA for reservation. */
export const OFFSET_SPACE = 1_000;

export const DEPOSIT_TTL_MINUTES = 60;
export const MIN_DEPOSIT_USD_MINOR = 1_000; // $10.00
export const MAX_DEPOSIT_USD_MINOR = 96_100; // $961.00 — the UPI ceiling showing through

/**
 * Pool of collection identities. In the real architecture these rotate as banks
 * freeze them; here they are static and fictitious.
 */
const VPA_POOL = [
  "asmtrade.demo1@okaxis",
  "asmtrade.demo2@okaxis",
  "asmtrade.demo3@okhdfcbank",
];

export class AmountSpaceExhausted extends Error {
  constructor() {
    super("No deposit slot is free right now. Try again in a few minutes.");
    this.name = "AmountSpaceExhausted";
  }
}

function pickVpa(seed: number): string {
  return VPA_POOL[seed % VPA_POOL.length]!;
}

/**
 * Creates a deposit intent with a RESERVED amount.
 *
 * This is the mechanism the whole flow turns on. A UTR proves nothing — anyone
 * can type any number and there is no endpoint to verify it. But if ₹10,764.37
 * is reserved to exactly one live deposit, a credit of exactly ₹10,764.37 on
 * that VPA can only belong to that deposit. The amount becomes the identifier,
 * which is why these platforms send an odd number rather than a round one.
 *
 * Uniqueness is enforced by a partial unique index, so two concurrent requests
 * cannot be handed the same amount. We retry on collision rather than locking.
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

  // Randomised start so concurrent callers do not all probe offset 0 first.
  const start = randomBytes(2).readUInt16BE(0) % OFFSET_SPACE;

  for (let probe = 0; probe < OFFSET_SPACE; probe++) {
    const offset = (start + probe) % OFFSET_SPACE;
    const amountInr = baseInr + offset;
    const vpa = pickVpa(offset);

    try {
      return await prisma.deposit.create({
        data: {
          userId: input.userId,
          method: input.method,
          amountUsd: input.amountUsdMinor,
          amountInr,
          vpa,
          checkoutToken: randomBytes(24).toString("base64url"),
          status: "AWAITING_PAYMENT",
          correlationId: input.correlationId,
          expiresAt,
        },
      });
    } catch (err) {
      // Unique violation on the partial index means this amount is taken.
      const code = (err as { code?: string }).code;
      if (code === "P2002") continue;
      throw err;
    }
  }

  throw new AmountSpaceExhausted();
}

export async function getDepositByToken(token: string): Promise<Deposit | null> {
  return prisma.deposit.findUnique({ where: { checkoutToken: token } });
}

/** Ownership is in the predicate. */
export async function listDepositsForActor(
  actorId: string,
  limit: number,
): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: { userId: actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}
```

- [ ] **Step 6: Append to `packages/db/src/index.ts`**

```ts
export {
  AmountSpaceExhausted,
  USD_TO_INR_RATE,
  OFFSET_SPACE,
  DEPOSIT_TTL_MINUTES,
  MIN_DEPOSIT_USD_MINOR,
  MAX_DEPOSIT_USD_MINOR,
  createDepositIntent,
  getDepositByToken,
  listDepositsForActor,
} from "./repositories/deposit.js";
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/deposit.test.ts
```

Expected: PASS — 10 tests.

- [ ] **Step 8: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add packages/db
git commit -m "feat(db): deposit intent with partial-unique amount reservation"
```

---

## Task 2: The reconciliation matcher

**Files:**
- Modify: `packages/db/src/repositories/deposit.ts`
- Test: `packages/db/src/repositories/matcher.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `MatchTier = "EXACT" | "AMOUNT_ONLY" | "NEAR" | "NONE"`
  - `claimUtr(actorId: string, depositId: string, utr: string): Promise<Deposit>`
  - `classifyMatch(deposit: Deposit, credit: BankCreditRow | null): MatchTier`
  - `runMatcher(): Promise<{ approved: number; held: number; expired: number }>`
  - `approveDeposit(input: { depositId: string; adminId: string | null; creditId: string | null }): Promise<void>`
  - `rejectDeposit(input: { depositId: string; adminId: string; reason: string }): Promise<void>`
  - `listPendingDeposits(limit: number): Promise<Deposit[]>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/repositories/matcher.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client.js";
import { createAccountsForUser } from "./account.js";
import {
  approveDeposit,
  claimUtr,
  createDepositIntent,
  rejectDeposit,
  runMatcher,
} from "./deposit.js";

const prisma = new PrismaClient();

let userId = "";
let liveAccountId = "";

beforeEach(async () => {
  await prisma.bankCredit.deleteMany({});
  await prisma.deposit.deleteMany({});
  const user = await prisma.user.create({
    data: { email: `m-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  const accounts = await createAccountsForUser(userId, 1_000_000);
  liveAccountId = accounts.find((a) => a.type === "LIVE")!.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function pending(utr = "123456789012") {
  const deposit = await createDepositIntent({
    userId,
    method: "PhonePe",
    amountUsdMinor: 10_000,
    correlationId: "cid1",
  });
  return claimUtr(userId, deposit.id, utr);
}

async function credit(deposit: { vpa: string; amountInr: number }, utr: string) {
  return prisma.bankCredit.create({
    data: {
      vpa: deposit.vpa,
      amountInr: deposit.amountInr,
      utr,
      receivedAt: new Date(),
      raw: "simulated",
    },
  });
}

describe("claimUtr", () => {
  it("moves the deposit to PENDING_CONFIRMATION", async () => {
    const deposit = await pending();
    expect(deposit.status).toBe("PENDING_CONFIRMATION");
    expect(deposit.claimedUtr).toBe("123456789012");
  });

  it("refuses to claim another user's deposit", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "PhonePe",
      amountUsdMinor: 10_000,
      correlationId: "cid2",
    });
    const other = await prisma.user.create({
      data: { email: `x-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
    });
    await expect(claimUtr(other.id, deposit.id, "999")).rejects.toThrow(/not found/i);
  });

  it("rejects a UTR already claimed by another deposit", async () => {
    await pending("111111111111");
    const second = await createDepositIntent({
      userId,
      method: "PhonePe",
      amountUsdMinor: 10_000,
      correlationId: "cid3",
    });
    await expect(claimUtr(userId, second.id, "111111111111")).rejects.toThrow(
      /already/i,
    );
  });
});

describe("runMatcher", () => {
  it("auto-approves an exact match and credits the balance", async () => {
    const deposit = await pending("222222222222");
    await credit(deposit, "222222222222");

    const result = await runMatcher();
    expect(result.approved).toBe(1);

    const after = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(after.status).toBe("COMPLETED");

    const account = await prisma.account.findUniqueOrThrow({ where: { id: liveAccountId } });
    expect(account.realBalance).toBe(10_000);
  });

  it("auto-approves when the amount matches but the UTR differs", async () => {
    const deposit = await pending("333333333333");
    await credit(deposit, "999999999999"); // typo in what the user typed

    const result = await runMatcher();
    expect(result.approved).toBe(1);
  });

  it("consumes the credit so it cannot settle a second deposit", async () => {
    const first = await pending("444444444444");
    const bankCredit = await credit(first, "444444444444");
    await runMatcher();

    const after = await prisma.bankCredit.findUniqueOrThrow({ where: { id: bankCredit.id } });
    expect(after.consumed).toBe(true);
  });

  it("holds a deposit with no matching credit", async () => {
    await pending("555555555555");
    const result = await runMatcher();
    expect(result.approved).toBe(0);
    expect(result.held).toBe(1);
  });

  it("does not match a credit on a different VPA", async () => {
    const deposit = await pending("666666666666");
    await prisma.bankCredit.create({
      data: {
        vpa: "someone.else@okaxis",
        amountInr: deposit.amountInr,
        utr: "666666666666",
        receivedAt: new Date(),
      },
    });
    expect((await runMatcher()).approved).toBe(0);
  });

  it("does not match a near-miss amount", async () => {
    const deposit = await pending("777777777777");
    await prisma.bankCredit.create({
      data: {
        vpa: deposit.vpa,
        amountInr: deposit.amountInr - 500,
        utr: "777777777777",
        receivedAt: new Date(),
      },
    });
    expect((await runMatcher()).approved).toBe(0);
  });

  it("expires a deposit past its TTL", async () => {
    const deposit = await pending("888888888888");
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const result = await runMatcher();
    expect(result.expired).toBe(1);

    const after = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(after.status).toBe("EXPIRED");
  });

  it("still matches a late credit against an expired deposit before writing it off", async () => {
    const deposit = await pending("999000111222");
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await credit(deposit, "999000111222");

    const result = await runMatcher();
    expect(result.approved).toBe(1);
    expect(result.expired).toBe(0);
  });

  it("updates cumulativeDeposits so the lifecycle stage can advance", async () => {
    const deposit = await pending("101010101010");
    await credit(deposit, "101010101010");
    await runMatcher();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.cumulativeDeposits).toBe(10_000);
  });
});

describe("approveDeposit and rejectDeposit", () => {
  it("credits on manual approval", async () => {
    const deposit = await pending("121212121212");
    await approveDeposit({ depositId: deposit.id, adminId: "admin-1", creditId: null });

    const account = await prisma.account.findUniqueOrThrow({ where: { id: liveAccountId } });
    expect(account.realBalance).toBe(10_000);
  });

  it("writes an audit row on manual approval", async () => {
    const deposit = await pending("131313131313");
    await approveDeposit({ depositId: deposit.id, adminId: "admin-1", creditId: null });

    const audits = await prisma.auditLog.findMany({
      where: { targetType: "Deposit", targetId: deposit.id },
    });
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0]!.actorId).toBe("admin-1");
  });

  it("credits nothing on rejection", async () => {
    const deposit = await pending("141414141414");
    await rejectDeposit({
      depositId: deposit.id,
      adminId: "admin-1",
      reason: "no credit found",
    });

    const account = await prisma.account.findUniqueOrThrow({ where: { id: liveAccountId } });
    expect(account.realBalance).toBe(0);

    const after = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(after.status).toBe("REJECTED");
  });

  it("refuses to approve the same deposit twice", async () => {
    const deposit = await pending("151515151515");
    await approveDeposit({ depositId: deposit.id, adminId: "admin-1", creditId: null });
    await expect(
      approveDeposit({ depositId: deposit.id, adminId: "admin-1", creditId: null }),
    ).rejects.toThrow(/already/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/matcher.test.ts
```

Expected: FAIL — `claimUtr` is not exported.

- [ ] **Step 3: Append the matcher to `packages/db/src/repositories/deposit.ts`**

```ts
import { logger } from "@asm/logger";
import type { BankCredit } from "../../generated/prisma/client.js";

export type MatchTier = "EXACT" | "AMOUNT_ONLY" | "NEAR" | "NONE";

export class DepositNotFound extends Error {
  constructor() {
    super("Deposit not found.");
    this.name = "DepositNotFound";
  }
}

export class UtrAlreadyClaimed extends Error {
  constructor() {
    super("That reference number has already been submitted.");
    this.name = "UtrAlreadyClaimed";
  }
}

export class DepositAlreadyResolved extends Error {
  constructor() {
    super("That deposit has already been resolved.");
    this.name = "DepositAlreadyResolved";
  }
}

/** The bonus rate on deposit, and the turnover multiple required to release it. */
export const BONUS_PERCENT = 50;
export const TURNOVER_MULTIPLE = 30;

/**
 * Records the user's self-declared reference.
 *
 * The UTR is a CLAIM, not proof — nothing verifies it against NPCI. Its real
 * jobs are as a matching tiebreaker, an audit trail, and to make the payer feel
 * they have submitted something. The amount does the actual work.
 */
export async function claimUtr(
  actorId: string,
  depositId: string,
  utr: string,
): Promise<Deposit> {
  const deposit = await prisma.deposit.findFirst({
    where: { id: depositId, userId: actorId },
  });
  if (!deposit) throw new DepositNotFound();
  if (deposit.status !== "AWAITING_PAYMENT") throw new DepositAlreadyResolved();

  const duplicate = await prisma.deposit.findFirst({
    where: { claimedUtr: utr, NOT: { id: depositId } },
  });
  if (duplicate) throw new UtrAlreadyClaimed();

  return prisma.deposit.update({
    where: { id: depositId },
    data: { claimedUtr: utr, status: "PENDING_CONFIRMATION" },
  });
}

export function classifyMatch(
  deposit: Deposit,
  credit: BankCredit | null,
): MatchTier {
  if (!credit) return "NONE";
  if (credit.vpa !== deposit.vpa) return "NONE";
  if (credit.amountInr !== deposit.amountInr) return "NEAR";
  return credit.utr === deposit.claimedUtr ? "EXACT" : "AMOUNT_ONLY";
}

async function creditDepositToAccount(
  deposit: Deposit,
  adminId: string | null,
  creditId: string | null,
): Promise<void> {
  const account = await prisma.account.findFirstOrThrow({
    where: { userId: deposit.userId, type: "LIVE" },
  });

  const bonus = Math.floor((deposit.amountUsd * BONUS_PERCENT) / 100);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.deposit.updateMany({
      where: { id: deposit.id, status: "PENDING_CONFIRMATION" },
      data: { status: "COMPLETED", matchedCreditId: creditId },
    });
    if (claimed.count !== 1) throw new DepositAlreadyResolved();

    if (creditId) {
      // One credit settles exactly one deposit. Set inside the same
      // transaction as the approval so a replay cannot double-credit.
      const consumed = await tx.bankCredit.updateMany({
        where: { id: creditId, consumed: false },
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

    // Drives the lifecycle stage in @asm/algo on the account's next settled trade.
    await tx.user.update({
      where: { id: deposit.userId },
      data: { cumulativeDeposits: { increment: deposit.amountUsd } },
    });

    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: adminId ? "deposit.approved_manual" : "deposit.approved_auto",
        targetType: "Deposit",
        targetId: deposit.id,
        after: { status: "COMPLETED", creditId, bonus },
      },
    });
  });
}

/**
 * One reconciliation pass.
 *
 * Exact and amount-only both auto-approve: UTR typos are extremely common and
 * the amount is the real key. Near-misses and unmatched deposits are held for a
 * human. A late credit is matched before anything is written off, which is why
 * expiry is checked last.
 */
export async function runMatcher(): Promise<{
  approved: number;
  held: number;
  expired: number;
}> {
  const pending = await prisma.deposit.findMany({
    where: { status: "PENDING_CONFIRMATION" },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  let approved = 0;
  let held = 0;
  let expired = 0;

  for (const deposit of pending) {
    const candidate = await prisma.bankCredit.findFirst({
      where: {
        vpa: deposit.vpa,
        amountInr: deposit.amountInr,
        consumed: false,
      },
      orderBy: { receivedAt: "asc" },
    });

    const tier = classifyMatch(deposit, candidate);

    if ((tier === "EXACT" || tier === "AMOUNT_ONLY") && candidate) {
      try {
        await creditDepositToAccount(deposit, null, candidate.id);
        approved++;
        logger.info(
          {
            evt: tier === "EXACT" ? "deposit.match_exact" : "deposit.match_amount_only",
            depositId: deposit.id,
            cid: deposit.correlationId,
          },
          "deposit auto-approved",
        );
      } catch {
        held++;
      }
      continue;
    }

    if (deposit.expiresAt.getTime() < Date.now()) {
      await prisma.deposit.updateMany({
        where: { id: deposit.id, status: "PENDING_CONFIRMATION" },
        data: { status: "EXPIRED" },
      });
      expired++;
      logger.warn(
        { evt: "deposit.expired", depositId: deposit.id, cid: deposit.correlationId },
        "deposit expired without a matching credit",
      );
      continue;
    }

    held++;
    logger.info(
      {
        evt: tier === "NEAR" ? "deposit.match_near" : "deposit.match_none",
        depositId: deposit.id,
        cid: deposit.correlationId,
      },
      "deposit held for review",
    );
  }

  return { approved, held, expired };
}

export async function approveDeposit(input: {
  depositId: string;
  adminId: string | null;
  creditId: string | null;
}): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: input.depositId } });
  if (!deposit) throw new DepositNotFound();
  if (deposit.status !== "PENDING_CONFIRMATION") throw new DepositAlreadyResolved();
  await creditDepositToAccount(deposit, input.adminId, input.creditId);
}

export async function rejectDeposit(input: {
  depositId: string;
  adminId: string;
  reason: string;
}): Promise<void> {
  const claimed = await prisma.deposit.updateMany({
    where: { id: input.depositId, status: "PENDING_CONFIRMATION" },
    data: { status: "REJECTED" },
  });
  if (claimed.count !== 1) throw new DepositAlreadyResolved();

  await prisma.auditLog.create({
    data: {
      actorId: input.adminId,
      action: "deposit.rejected",
      targetType: "Deposit",
      targetId: input.depositId,
      after: { status: "REJECTED", reason: input.reason },
    },
  });
}

export async function listPendingDeposits(limit: number): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: { status: "PENDING_CONFIRMATION" },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}
```

- [ ] **Step 4: Append to `packages/db/src/index.ts`**

```ts
export {
  DepositNotFound,
  UtrAlreadyClaimed,
  DepositAlreadyResolved,
  BONUS_PERCENT,
  TURNOVER_MULTIPLE,
  claimUtr,
  classifyMatch,
  runMatcher,
  approveDeposit,
  rejectDeposit,
  listPendingDeposits,
  type MatchTier,
} from "./repositories/deposit.js";
```

- [ ] **Step 5: Add the logger dependency to the db package**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm --filter @asm/db add @asm/logger@workspace:*
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/matcher.test.ts
```

Expected: PASS — 17 tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add packages/db
git commit -m "feat(db): reconciliation matcher with confidence tiers"
```

---

## Task 3: The shared bank-message parser

**Files:**
- Create: `packages/bankfeed/package.json`, `packages/bankfeed/tsconfig.json`, `packages/bankfeed/src/types.ts`, `packages/bankfeed/src/parser/candidates.ts`, `packages/bankfeed/src/parser/disambiguate.ts`, `packages/bankfeed/src/parser/index.ts`
- Test: `packages/bankfeed/src/parser/parser.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Credit = { amountInr: number; utr: string | null; vpa: string | null; receivedAt: Date; raw: string }`
  - `BankFeed = { start(onCredit: (c: Credit) => void): Promise<void>; stop(): Promise<void> }`
  - `ParsedMessage = { amountInr: number; utr: string | null; isCredit: boolean } | null`
  - `parseBankMessage(text: string): ParsedMessage`

**Why not a trained model.** Amount and UTR are *structured tokens*, not fuzzy language — an amount is a number next to a currency mark, a UTR is a long digit run near "Ref". A named-entity model would need thousands of labelled messages to learn what two generic patterns capture exactly. The real weakness of regex-per-bank is disambiguation and template drift, and the fix for that is architectural: extract every candidate generically, then score by context.

- [ ] **Step 1: Write `packages/bankfeed/package.json`**

```json
{
  "name": "@asm/bankfeed",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@asm/config": "workspace:*",
    "@asm/db": "workspace:*",
    "@asm/logger": "workspace:*"
  }
}
```

- [ ] **Step 2: Write `packages/bankfeed/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing parser test**

Create `packages/bankfeed/src/parser/parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseBankMessage } from "./index.js";

describe("parseBankMessage", () => {
  it("parses an HDFC-style credit alert", () => {
    const result = parseBankMessage(
      "Rs.10764.37 credited to a/c XXXXXX4321 on 12-09-26 by a/c linked to VPA someone@okaxis (UPI Ref 528312345678)",
    );
    expect(result).not.toBeNull();
    expect(result!.amountInr).toBe(1_076_437);
    expect(result!.utr).toBe("528312345678");
    expect(result!.isCredit).toBe(true);
  });

  it("parses an ICICI-style credit alert", () => {
    const result = parseBankMessage(
      "Dear Customer, Acct XX321 is credited with INR 10764.37 on 12-Sep-26 from someone@okhdfcbank. UPI:528312345678",
    );
    expect(result!.amountInr).toBe(1_076_437);
    expect(result!.utr).toBe("528312345678");
    expect(result!.isCredit).toBe(true);
  });

  it("parses a comma-grouped amount", () => {
    const result = parseBankMessage(
      "Rs 1,07,64.37 credited to your account. Ref No 528312345678",
    );
    expect(result!.amountInr).toBe(1_076_437);
  });

  it("handles an amount with no paise", () => {
    const result = parseBankMessage("INR 10764 credited. UPI Ref 528312345678");
    expect(result!.amountInr).toBe(1_076_400);
  });

  it("marks a debit alert as not a credit", () => {
    const result = parseBankMessage(
      "Rs.500.00 debited from a/c XX4321 on 12-09-26. UPI Ref 528399999999",
    );
    expect(result!.isCredit).toBe(false);
  });

  it("rejects a message with a debit keyword and no credit keyword", () => {
    const result = parseBankMessage("Rs.500.00 spent on your card XX4321");
    expect(result!.isCredit).toBe(false);
  });

  it("returns null when there is no amount at all", () => {
    expect(parseBankMessage("Your OTP is 123456. Do not share it.")).toBeNull();
  });

  it("returns null for a promotional message from a bank sender", () => {
    expect(
      parseBankMessage("Get a personal loan up to Rs 5,00,000! Apply now. T&C apply."),
    ).toBeNull();
  });

  it("does not mistake the account tail for the amount", () => {
    const result = parseBankMessage(
      "A/c XX4321 credited with Rs.10764.37. Ref 528312345678",
    );
    expect(result!.amountInr).toBe(1_076_437);
  });

  it("does not mistake a date for the reference", () => {
    const result = parseBankMessage(
      "Rs.10764.37 credited on 12092026. UPI Ref No. 528312345678",
    );
    expect(result!.utr).toBe("528312345678");
  });

  it("returns a null utr when the message carries no reference", () => {
    const result = parseBankMessage("Rs.10764.37 credited to a/c XX4321 by NEFT");
    expect(result!.amountInr).toBe(1_076_437);
    expect(result!.utr).toBeNull();
  });

  it("is linear-time on an adversarial input", () => {
    // ReDoS guard. A catastrophically backtracking pattern would hang here.
    const hostile = `Rs.${"9".repeat(5000)}.37 credited ${"a".repeat(5000)}`;
    const start = Date.now();
    parseBankMessage(hostile);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("caps input length rather than parsing unbounded text", () => {
    expect(parseBankMessage("x".repeat(100_000))).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm --filter @asm/bankfeed test
```

Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 5: Write `packages/bankfeed/src/types.ts`**

```ts
export interface Credit {
  readonly amountInr: number;
  readonly utr: string | null;
  readonly vpa: string | null;
  readonly receivedAt: Date;
  readonly raw: string;
}

export interface BankFeed {
  start(onCredit: (credit: Credit) => void): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 6: Write `packages/bankfeed/src/parser/candidates.ts`**

```ts
/**
 * Generic, bank-agnostic candidate extraction.
 *
 * Two patterns pull EVERY currency-shaped number and EVERY long digit run.
 * There are no per-bank templates here — that is the point. Both patterns are
 * linear-time with no nested quantifiers, because this parser consumes
 * attacker-influenced text and catastrophic backtracking would hang the process.
 */

export const MAX_INPUT_LENGTH = 1_000;

/** Rs.10764.37 | INR 10764 | Rs 1,07,64.37 */
const AMOUNT_RE = /(?:rs\.?|inr)\s?([0-9][0-9,]{0,18}(?:\.[0-9]{1,2})?)/gi;

/** A run of 9 to 22 digits — UPI UTRs are 12, NEFT references vary. */
const REFERENCE_RE = /\b([0-9]{9,22})\b/g;

export interface AmountCandidate {
  /** Minor units (paise). */
  readonly minor: number;
  readonly index: number;
}

export interface ReferenceCandidate {
  readonly value: string;
  readonly index: number;
}

export function amountCandidates(text: string): AmountCandidate[] {
  const out: AmountCandidate[] = [];
  AMOUNT_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = AMOUNT_RE.exec(text)) !== null) {
    const digits = match[1]!.replace(/,/g, "");
    const value = Number(digits);
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({ minor: Math.round(value * 100), index: match.index });
  }
  return out;
}

export function referenceCandidates(text: string): ReferenceCandidate[] {
  const out: ReferenceCandidate[] = [];
  REFERENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = REFERENCE_RE.exec(text)) !== null) {
    out.push({ value: match[1]!, index: match.index });
  }
  return out;
}
```

- [ ] **Step 7: Write `packages/bankfeed/src/parser/disambiguate.ts`**

```ts
import type { ReferenceCandidate } from "./candidates.js";

const CREDIT_WORDS = /\b(credited|credit|received|deposited)\b/i;
const DEBIT_WORDS = /\b(debited|debit|spent|withdrawn|paid|purchase)\b/i;
const PROMO_WORDS = /\b(apply now|t&c|offer|loan up to|eligible|congratulations)\b/i;
const REFERENCE_HINTS = /\b(utr|ref|rrn|upi|txn|transaction)\b/gi;

/**
 * Direction detection.
 *
 * A debit alert reads almost identically to a credit alert, and confusing them
 * credits a deposit that never arrived. So require an explicit credit word AND
 * the absence of a debit word — anything ambiguous is reported as not-a-credit
 * and ends up in the review queue rather than being guessed at.
 */
export function isCredit(text: string): boolean {
  return CREDIT_WORDS.test(text) && !DEBIT_WORDS.test(text);
}

export function isPromotional(text: string): boolean {
  return PROMO_WORDS.test(text) && !CREDIT_WORDS.test(text);
}

/**
 * Picks the reference nearest a hint word. A date like 12092026 is also a long
 * digit run, so proximity to "Ref" or "UPI" is what separates them.
 */
export function pickReference(
  text: string,
  candidates: readonly ReferenceCandidate[],
): string | null {
  if (candidates.length === 0) return null;

  const hints: number[] = [];
  REFERENCE_HINTS.lastIndex = 0;
  let hint: RegExpExecArray | null;
  while ((hint = REFERENCE_HINTS.exec(text)) !== null) hints.push(hint.index);

  if (hints.length === 0) {
    // No hint at all — prefer a 12-digit run, the UPI UTR length.
    const twelve = candidates.find((c) => c.value.length === 12);
    return twelve ? twelve.value : null;
  }

  let best = candidates[0]!;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    for (const hintIndex of hints) {
      const distance = Math.abs(candidate.index - hintIndex);
      // A hint should sit shortly before its reference, not paragraphs away.
      if (distance < bestDistance && distance < 40) {
        bestDistance = distance;
        best = candidate;
      }
    }
  }

  return bestDistance === Infinity ? null : best.value;
}
```

- [ ] **Step 8: Write `packages/bankfeed/src/parser/index.ts`**

```ts
import {
  MAX_INPUT_LENGTH,
  amountCandidates,
  referenceCandidates,
} from "./candidates.js";
import { isCredit, isPromotional, pickReference } from "./disambiguate.js";

export interface ParsedMessage {
  readonly amountInr: number;
  readonly utr: string | null;
  readonly isCredit: boolean;
}

/**
 * Layers 1 and 2 of the parser: generic extraction, then contextual
 * disambiguation. No per-bank templates, no model, no training data.
 *
 * Layer 3 — an LLM fallback for messages this cannot resolve — is deliberately
 * out of scope here. Rules handle the overwhelming majority in microseconds;
 * the fallback is worth adding only once a real unparsed message appears.
 */
export function parseBankMessage(text: string): ParsedMessage | null {
  if (text.length > MAX_INPUT_LENGTH) return null;
  if (isPromotional(text)) return null;

  const amounts = amountCandidates(text);
  if (amounts.length === 0) return null;

  // The largest currency-marked amount is the transaction value; smaller ones
  // are typically balances or fees.
  const amount = amounts.reduce((a, b) => (b.minor > a.minor ? b : a));

  const utr = pickReference(text, referenceCandidates(text));

  return { amountInr: amount.minor, utr, isCredit: isCredit(text) };
}

export { MAX_INPUT_LENGTH } from "./candidates.js";
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm install
pnpm --filter @asm/bankfeed test
```

Expected: PASS — 13 tests.

- [ ] **Step 10: Commit**

```bash
git add packages/bankfeed
git commit -m "feat(bankfeed): candidate-plus-disambiguate message parser"
```

---

## Task 4: The three feed adapters

**Files:**
- Create: `packages/bankfeed/src/simulated.ts`, `packages/bankfeed/src/sms-relay.ts`, `packages/bankfeed/src/imap.ts`, `packages/bankfeed/src/factory.ts`, `packages/bankfeed/src/index.ts`
- Create: `apps/engine/src/bank-feed-runner.ts`
- Modify: `apps/engine/src/main.ts`
- Test: `packages/bankfeed/src/simulated.test.ts`

**Interfaces:**
- Consumes: `BankFeed`, `Credit`, `parseBankMessage`; `prisma` from `@asm/db`
- Produces:
  - `createSimulatedFeed(opts: { delayMs: number; failureRate: number }): BankFeed`
  - `submitRelayedSms(body: { sender: string; body: string; receivedAt: string }): Credit | null`
  - `createSmsRelayFeed(): BankFeed`
  - `createImapFeed(opts: { host: string; user: string; password: string }): BankFeed`
  - `createBankFeed(kind: "simulated" | "sms" | "email"): BankFeed`
  - `startBankFeedRunner(): Promise<{ stop(): Promise<void> }>`

- [ ] **Step 1: Write the failing simulated-feed test**

Create `packages/bankfeed/src/simulated.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@asm/db";
import { createSimulatedFeed } from "./simulated.js";
import type { Credit } from "./types.js";

beforeEach(async () => {
  await prisma.bankCredit.deleteMany({});
  await prisma.deposit.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function awaitingDeposit() {
  const user = await prisma.user.create({
    data: { email: `sf-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
  });
  return prisma.deposit.create({
    data: {
      userId: user.id,
      method: "PhonePe",
      amountUsd: 10_000,
      amountInr: 1_076_437,
      vpa: "asmtrade.demo1@okaxis",
      checkoutToken: `tok-${process.hrtime.bigint()}`,
      status: "PENDING_CONFIRMATION",
      claimedUtr: "528312345678",
      correlationId: "cid",
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
}

describe("createSimulatedFeed", () => {
  it("emits a credit matching a pending deposit", async () => {
    vi.useFakeTimers();
    const deposit = await awaitingDeposit();
    const seen: Credit[] = [];

    const feed = createSimulatedFeed({ delayMs: 1000, failureRate: 0 });
    await feed.start((c) => seen.push(c));
    await vi.advanceTimersByTimeAsync(4000);
    await feed.stop();
    vi.useRealTimers();

    const match = seen.find((c) => c.amountInr === deposit.amountInr);
    expect(match).toBeDefined();
    expect(match!.vpa).toBe(deposit.vpa);
    expect(match!.utr).toBe(deposit.claimedUtr);
  });

  it("emits nothing when no deposit is pending", async () => {
    vi.useFakeTimers();
    const seen: Credit[] = [];
    const feed = createSimulatedFeed({ delayMs: 500, failureRate: 0 });
    await feed.start((c) => seen.push(c));
    await vi.advanceTimersByTimeAsync(3000);
    await feed.stop();
    vi.useRealTimers();

    expect(seen).toEqual([]);
  });

  it("emits nothing at a failure rate of 1 — the never-credited case", async () => {
    vi.useFakeTimers();
    await awaitingDeposit();
    const seen: Credit[] = [];
    const feed = createSimulatedFeed({ delayMs: 500, failureRate: 1 });
    await feed.start((c) => seen.push(c));
    await vi.advanceTimersByTimeAsync(5000);
    await feed.stop();
    vi.useRealTimers();

    expect(seen).toEqual([]);
  });

  it("does not re-emit a credit for a deposit it has already served", async () => {
    vi.useFakeTimers();
    await awaitingDeposit();
    const seen: Credit[] = [];
    const feed = createSimulatedFeed({ delayMs: 200, failureRate: 0 });
    await feed.start((c) => seen.push(c));
    await vi.advanceTimersByTimeAsync(5000);
    await feed.stop();
    vi.useRealTimers();

    expect(seen.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm --filter @asm/bankfeed test
```

Expected: FAIL — cannot resolve `./simulated.js`.

- [ ] **Step 3: Write `packages/bankfeed/src/simulated.ts`**

```ts
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import type { BankFeed, Credit } from "./types.js";

/**
 * The simulation boundary.
 *
 * This is the ONLY thing that differs from a real system. Every rule downstream
 * — reservation, tiers, consumption, the late sweep, the admin queue — is
 * production logic. In a live system this table is populated by a bank Virtual
 * Account API or a gateway webhook instead; the matcher never changes.
 */
export function createSimulatedFeed(opts: {
  delayMs: number;
  failureRate: number;
}): BankFeed {
  let timer: NodeJS.Timeout | null = null;
  const served = new Set<string>();

  return {
    async start(onCredit: (credit: Credit) => void) {
      logger.info(
        { evt: "bankfeed.started", feed: "simulated", delayMs: opts.delayMs },
        "simulated bank feed started",
      );

      timer = setInterval(() => {
        void (async () => {
          const pending = await prisma.deposit.findMany({
            where: { status: "PENDING_CONFIRMATION" },
            orderBy: { createdAt: "asc" },
            take: 20,
          });

          for (const deposit of pending) {
            if (served.has(deposit.id)) continue;

            const age = Date.now() - deposit.updatedAt.getTime();
            if (age < opts.delayMs) continue;

            served.add(deposit.id);

            // The never-credited failure mode — the flow must handle a payment
            // that simply does not arrive.
            // eslint-disable-next-line no-restricted-properties -- simulation noise, not security
            if (opts.failureRate > 0 && Math.random() < opts.failureRate) {
              logger.info(
                { evt: "bankfeed.simulated_drop", depositId: deposit.id },
                "simulated feed deliberately dropped this credit",
              );
              continue;
            }

            onCredit({
              amountInr: deposit.amountInr,
              utr: deposit.claimedUtr,
              vpa: deposit.vpa,
              receivedAt: new Date(),
              raw: `simulated credit for deposit ${deposit.id}`,
            });
          }
        })();
      }, Math.max(250, Math.floor(opts.delayMs / 4)));
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
```


- [ ] **Step 4: Write `packages/bankfeed/src/sms-relay.ts`**

```ts
import { logger } from "@asm/logger";
import { parseBankMessage } from "./parser/index.js";
import type { BankFeed, Credit } from "./types.js";

type Listener = (credit: Credit) => void;

const listeners = new Set<Listener>();
const allowedSenders = (process.env.BANK_SMS_SENDERS ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

/**
 * Ingress for the companion app (Plan 06). The HTTP route calls this; the feed
 * itself only holds listeners, so the two processes stay decoupled.
 *
 * Returns the parsed credit, or null when the message is not a usable credit
 * alert — the caller turns that into a 202 rather than an error, since an
 * ignored promotional SMS is normal.
 */
export function submitRelayedSms(input: {
  sender: string;
  body: string;
  receivedAt: string;
}): Credit | null {
  if (
    allowedSenders.length > 0 &&
    !allowedSenders.some((s) => input.sender.toUpperCase().includes(s))
  ) {
    return null;
  }

  const parsed = parseBankMessage(input.body);
  if (!parsed || !parsed.isCredit) return null;

  const receivedAt = new Date(input.receivedAt);
  const credit: Credit = {
    amountInr: parsed.amountInr,
    utr: parsed.utr,
    vpa: null,
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    raw: input.body,
  };

  for (const listener of listeners) listener(credit);
  logger.info(
    { evt: "bankfeed.sms_relayed", amountInr: credit.amountInr },
    "relayed sms parsed as a credit",
  );

  return credit;
}

export function createSmsRelayFeed(): BankFeed {
  let listener: Listener | null = null;

  return {
    async start(onCredit) {
      listener = onCredit;
      listeners.add(listener);
      logger.info({ evt: "bankfeed.started", feed: "sms" }, "sms relay feed started");
    },
    async stop() {
      if (listener) listeners.delete(listener);
      listener = null;
    },
  };
}
```

- [ ] **Step 5: Write `packages/bankfeed/src/imap.ts`**

```ts
import { logger } from "@asm/logger";
import type { BankFeed, Credit } from "./types.js";

/**
 * IMAP adapter.
 *
 * Present for completeness and never configured in this build. Worth knowing
 * before reaching for it: several Indian banks gate email alerts by amount
 * (ICICI defaults to ₹5,000+), so a small deposit may generate no email at all
 * — a silent failure, which is the worst kind for a payment matcher. SMS has
 * guaranteed per-transaction coverage because RBI mandates transaction alerts.
 */
export function createImapFeed(opts: {
  host: string;
  user: string;
  password: string;
}): BankFeed {
  return {
    async start() {
      logger.warn(
        { evt: "bankfeed.not_implemented", feed: "email", host: opts.host },
        "the IMAP adapter is a documented seam and is not implemented in this build",
      );
      throw new Error(
        "BANK_FEED=email is not implemented. Use BANK_FEED=simulated for the demo, " +
          "or BANK_FEED=sms with the companion app from Plan 06.",
      );
    },
    async stop() {
      /* nothing started */
    },
  };
}

export type { Credit };
```

- [ ] **Step 6: Write `packages/bankfeed/src/factory.ts` and the barrel**

`packages/bankfeed/src/factory.ts`:

```ts
import { config } from "@asm/config";
import { logger } from "@asm/logger";
import { createSimulatedFeed } from "./simulated.js";
import { createSmsRelayFeed } from "./sms-relay.js";
import { createImapFeed } from "./imap.js";
import type { BankFeed } from "./types.js";

/**
 * One switch selects the source of BankCredit rows. Everything downstream is
 * identical regardless of which adapter runs — that is the whole point of the
 * interface, and it is why moving to a real feed would be one class rather than
 * a rewrite.
 */
export function createBankFeed(kind = config.bankFeed): BankFeed {
  switch (kind) {
    case "sms":
      return createSmsRelayFeed();

    case "email":
      return createImapFeed({
        host: process.env.IMAP_HOST ?? "",
        user: process.env.IMAP_USER ?? "",
        password: process.env.IMAP_PASSWORD ?? "",
      });

    case "simulated":
    default:
      logger.info(
        { evt: "bankfeed.selected", feed: "simulated" },
        "using the simulated bank feed — no real money is involved",
      );
      return createSimulatedFeed({
        delayMs: Number(process.env.SIMULATED_FEED_DELAY_MS ?? 8_000),
        failureRate: Number(process.env.SIMULATED_FEED_FAILURE_RATE ?? 0.1),
      });
  }
}
```

`packages/bankfeed/src/index.ts`:

```ts
export type { BankFeed, Credit } from "./types.js";
export { parseBankMessage, type ParsedMessage } from "./parser/index.js";
export { createSimulatedFeed } from "./simulated.js";
export { createSmsRelayFeed, submitRelayedSms } from "./sms-relay.js";
export { createImapFeed } from "./imap.js";
export { createBankFeed } from "./factory.js";
```

- [ ] **Step 7: Write `apps/engine/src/bank-feed-runner.ts`**

```ts
import { createBankFeed, type Credit } from "@asm/bankfeed";
import { prisma, runMatcher } from "@asm/db";
import { logger } from "@asm/logger";

const MATCHER_INTERVAL_MS = 3_000;

/**
 * Persists incoming credits, then runs the matcher on a timer. Persisting and
 * matching are separate so a credit is never lost because the matcher happened
 * to be mid-pass.
 */
export async function startBankFeedRunner(): Promise<{ stop(): Promise<void> }> {
  const feed = createBankFeed();

  await feed.start((credit: Credit) => {
    void (async () => {
      try {
        await prisma.bankCredit.create({
          data: {
            vpa: credit.vpa ?? "unknown",
            amountInr: credit.amountInr,
            utr: credit.utr ?? `no-utr-${Date.now()}`,
            receivedAt: credit.receivedAt,
            raw: credit.raw,
          },
        });
      } catch (err) {
        // A duplicate UTR means we have already seen this credit. Expected.
        const code = (err as { code?: string }).code;
        if (code !== "P2002") {
          logger.error(
            {
              evt: "bankfeed.persist_failed",
              reason: err instanceof Error ? err.message : "unknown",
            },
            "could not persist a bank credit",
          );
        }
      }
    })();
  });

  const timer = setInterval(() => {
    void runMatcher()
      .then((result) => {
        if (result.approved > 0 || result.expired > 0) {
          logger.info(
            { evt: "deposit.matcher_pass", ...result },
            "matcher pass complete",
          );
        }
      })
      .catch((err: unknown) => {
        logger.error(
          {
            evt: "deposit.matcher_failed",
            reason: err instanceof Error ? err.message : "unknown",
          },
          "matcher pass failed",
        );
      });
  }, MATCHER_INTERVAL_MS);

  return {
    async stop() {
      clearInterval(timer);
      await feed.stop();
    },
  };
}
```

- [ ] **Step 8: Wire it into `apps/engine/src/main.ts`**

Add the import:

```ts
import { startBankFeedRunner } from "./bank-feed-runner.js";
```

After the bot crowd block, add:

```ts
  const bankFeed = await startBankFeedRunner();
```

And in `shutdown`, before `await feed.stop();`:

```ts
    await bankFeed.stop();
```

- [ ] **Step 9: Add dependencies and environment**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm --filter @asm/engine add @asm/bankfeed@workspace:*
```

Append to both `.env.example` and `.env`:

```bash
# Simulated bank feed behaviour. Raise the failure rate to exercise the admin queue.
SIMULATED_FEED_DELAY_MS="8000"
SIMULATED_FEED_FAILURE_RATE="0.1"
# Only used when BANK_FEED=sms. Comma-separated DLT sender fragments.
BANK_SMS_SENDERS="ICICIB,HDFCBK,AXISBK,SBIINB"
# Shared secret for the companion app's relay endpoint (Plan 06).
SMS_RELAY_SECRET="local-dev-relay-secret-change-me"
```

- [ ] **Step 10: Run the tests to verify they pass**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/bankfeed
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run
```

Expected: PASS — 17 tests.

- [ ] **Step 11: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add packages/bankfeed apps/engine .env.example
git commit -m "feat(bankfeed): three adapters behind one switch, plus the matcher runner"
```

---

## Task 5: Deposit contracts and API routes

**Files:**
- Create: `packages/contracts/src/deposit.ts`, `apps/web/src/app/api/deposits/route.ts`, `apps/web/src/app/api/deposits/[id]/claim/route.ts`, `apps/web/src/app/api/bank-feed/sms/route.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/deposit.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4
- Produces:
  - `CreateDepositSchema` — `{ method, amountUsd }` only
  - `ClaimUtrSchema` — `{ utr }` only
  - `RelayedSmsSchema` — `{ sender, body, receivedAt }`
  - `POST /api/deposits` → `201 { checkoutToken }`
  - `POST /api/deposits/[id]/claim` → `200 { status }`
  - `POST /api/bank-feed/sms` → `202`

- [ ] **Step 1: Write the failing contract test**

Create `packages/contracts/src/deposit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ClaimUtrSchema, CreateDepositSchema, RelayedSmsSchema } from "./deposit.js";

describe("CreateDepositSchema", () => {
  const valid = { method: "PhonePe", amountUsd: 10_000 };

  it("accepts a valid request", () => {
    expect(CreateDepositSchema.parse(valid).amountUsd).toBe(10_000);
  });

  it("rejects a client-supplied INR amount", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, amountInr: 1 }).success).toBe(false);
  });

  it("rejects a client-supplied VPA", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, vpa: "me@bank" }).success).toBe(
      false,
    );
  });

  it("rejects a client-supplied status", () => {
    expect(
      CreateDepositSchema.safeParse({ ...valid, status: "COMPLETED" }).success,
    ).toBe(false);
  });

  it("rejects an unknown method", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, method: "Cash" }).success).toBe(
      false,
    );
  });

  it("rejects a fractional amount", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, amountUsd: 10.5 }).success).toBe(
      false,
    );
  });
});

describe("ClaimUtrSchema", () => {
  it("accepts a 12-digit reference", () => {
    expect(ClaimUtrSchema.parse({ utr: "528312345678" }).utr).toBe("528312345678");
  });

  it("trims surrounding whitespace", () => {
    expect(ClaimUtrSchema.parse({ utr: "  528312345678  " }).utr).toBe("528312345678");
  });

  it("rejects a reference that is too short", () => {
    expect(ClaimUtrSchema.safeParse({ utr: "123" }).success).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(ClaimUtrSchema.safeParse({ utr: "5283abc45678" }).success).toBe(false);
  });

  it("rejects an injected depositId", () => {
    expect(
      ClaimUtrSchema.safeParse({ utr: "528312345678", depositId: "other" }).success,
    ).toBe(false);
  });
});

describe("RelayedSmsSchema", () => {
  it("accepts a relayed message", () => {
    const parsed = RelayedSmsSchema.parse({
      sender: "AX-ICICIB",
      body: "Rs.100.00 credited",
      receivedAt: "2026-09-12T10:00:00.000Z",
    });
    expect(parsed.sender).toBe("AX-ICICIB");
  });

  it("rejects a body over the length cap", () => {
    expect(
      RelayedSmsSchema.safeParse({
        sender: "AX-ICICIB",
        body: "x".repeat(5_000),
        receivedAt: "2026-09-12T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects extra keys", () => {
    expect(
      RelayedSmsSchema.safeParse({
        sender: "AX-ICICIB",
        body: "ok",
        receivedAt: "2026-09-12T10:00:00.000Z",
        amountInr: 999_999,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm --filter @asm/contracts test
```

Expected: FAIL — cannot resolve `./deposit.js`.

- [ ] **Step 3: Write `packages/contracts/src/deposit.ts`**

```ts
import { z } from "zod";

export const DEPOSIT_METHODS = [
  "PhonePe",
  "UPI",
  "PayTM",
  "UPI Intent",
] as const;

/**
 * Strict. A request carrying amountInr, vpa, checkoutToken or status is
 * rejected — all of those are server-determined, and an attempt to supply them
 * is worth logging rather than silently dropping.
 */
export const CreateDepositSchema = z.strictObject({
  method: z.enum(DEPOSIT_METHODS),
  /** Minor units. Bounds are enforced again server-side. */
  amountUsd: z.number().int().positive().max(100_000_000),
});
export type CreateDepositInput = z.infer<typeof CreateDepositSchema>;

export const ClaimUtrSchema = z.strictObject({
  utr: z
    .string()
    .trim()
    .regex(/^[0-9]{9,22}$/, "Enter the numeric reference from your payment app"),
});
export type ClaimUtrInput = z.infer<typeof ClaimUtrSchema>;

export const RelayedSmsSchema = z.strictObject({
  sender: z.string().min(1).max(32),
  body: z.string().min(1).max(1_000),
  receivedAt: z.string().datetime(),
});
export type RelayedSmsInput = z.infer<typeof RelayedSmsSchema>;

export interface DepositView {
  id: string;
  method: string;
  amountUsd: number;
  amountInr: number;
  status: string;
  claimedUtr: string | null;
  createdAt: number;
}
```

- [ ] **Step 4: Append to `packages/contracts/src/index.ts`**

```ts
export {
  DEPOSIT_METHODS,
  CreateDepositSchema,
  ClaimUtrSchema,
  RelayedSmsSchema,
  type CreateDepositInput,
  type ClaimUtrInput,
  type RelayedSmsInput,
  type DepositView,
} from "./deposit.js";
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @asm/contracts test
```

Expected: PASS — 36 tests total.

- [ ] **Step 6: Write `apps/web/src/app/api/deposits/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { CreateDepositSchema, type DepositView } from "@asm/contracts";
import {
  AmountSpaceExhausted,
  createDepositIntent,
  listDepositsForActor,
} from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:deposit:${session.userId}`, 10, 300))) {
    return NextResponse.json(
      { error: "Too many deposit attempts. Wait a few minutes." },
      { status: 429 },
    );
  }

  const parsed = CreateDepositSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn(
      { evt: "security.validation_rejected", route: "deposits" },
      "rejected deposit payload",
    );
    return NextResponse.json({ error: "Check the deposit details." }, { status: 400 });
  }

  try {
    const deposit = await createDepositIntent({
      userId: session.userId,
      method: parsed.data.method,
      amountUsdMinor: parsed.data.amountUsd,
      correlationId: ctx.cid,
    });

    log.info(
      {
        evt: "deposit.intent",
        depositId: deposit.id,
        method: deposit.method,
        amountInr: deposit.amountInr,
      },
      "deposit intent created",
    );

    return NextResponse.json(
      { checkoutToken: deposit.checkoutToken },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AmountSpaceExhausted) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof Error && /minimum|maximum/i.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const deposits = await listDepositsForActor(session.userId, 50);
  const view: DepositView[] = deposits.map((d) => ({
    id: d.id,
    method: d.method,
    amountUsd: d.amountUsd,
    amountInr: d.amountInr,
    status: d.status,
    claimedUtr: d.claimedUtr,
    createdAt: Math.floor(d.createdAt.getTime() / 1000),
  }));

  return NextResponse.json({ deposits: view });
}
```

- [ ] **Step 7: Write `apps/web/src/app/api/deposits/[id]/claim/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { ClaimUtrSchema } from "@asm/contracts";
import { DepositNotFound, UtrAlreadyClaimed, claimUtr } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const parsed = ClaimUtrSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter the numeric reference from your payment app." },
      { status: 400 },
    );
  }

  try {
    // Ownership is enforced inside claimUtr, which takes the actor id.
    const deposit = await claimUtr(session.userId, id, parsed.data.utr);
    log.info(
      { evt: "deposit.utr_claimed", depositId: deposit.id, cid: deposit.correlationId },
      "utr claimed",
    );
    return NextResponse.json({ status: deposit.status });
  } catch (err) {
    if (err instanceof DepositNotFound) {
      log.warn(
        { evt: "security.authz_denied", route: "deposit_claim", depositId: id },
        "deposit does not belong to actor",
      );
      return NextResponse.json({ error: "Deposit not found." }, { status: 404 });
    }
    if (err instanceof UtrAlreadyClaimed) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 8: Write `apps/web/src/app/api/bank-feed/sms/route.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { RelayedSmsSchema } from "@asm/contracts";
import { submitRelayedSms } from "@asm/bankfeed";
import { prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { requestContext } from "@/lib/request-context";

const SECRET = process.env.SMS_RELAY_SECRET ?? "";

function authorised(header: string | null): boolean {
  if (!SECRET || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${SECRET}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Ingress for the companion app (Plan 06). Accepts a bank SMS the operator's
 * own phone forwarded, parses it, and persists any credit it yields.
 *
 * Returns 202 for a message that parsed to nothing — an ignored promotional SMS
 * is normal operation, not an error.
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

  const parsed = RelayedSmsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed relay payload." }, { status: 400 });
  }

  const credit = submitRelayedSms(parsed.data);
  if (!credit) {
    return NextResponse.json({ ignored: true }, { status: 202 });
  }

  try {
    await prisma.bankCredit.create({
      data: {
        vpa: credit.vpa ?? "relayed",
        amountInr: credit.amountInr,
        utr: credit.utr ?? `no-utr-${Date.now()}`,
        receivedAt: credit.receivedAt,
        raw: credit.raw,
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "P2002") throw err;
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
```

- [ ] **Step 9: Add the bankfeed dependency to the web app**

```bash
pnpm --filter @asm/web add @asm/bankfeed@workspace:*
```

- [ ] **Step 10: Commit**

```bash
git add packages/contracts apps/web
git commit -m "feat(web): deposit intent, utr claim, and sms relay routes"
```

---

## Task 6: Deposit UI and the hosted checkout

**Files:**
- Create: `apps/web/src/components/deposit/MethodPicker.tsx`, `apps/web/src/components/deposit/AmountStep.tsx`, `apps/web/src/app/(platform)/deposit/page.tsx`, `apps/web/src/app/checkout/[token]/page.tsx`, `apps/web/src/app/checkout/[token]/ClaimForm.tsx`

**Interfaces:**
- Consumes: `DEPOSIT_METHODS`, `getDepositByToken`, `USD_TO_INR_RATE`
- Produces: the two-step deposit flow and a deliberately separate checkout page

**Why the checkout page looks different.** The original hands off to an off-domain, provider-branded page, and that visual break is part of the fidelity — it is the moment the user leaves the platform and trusts something else. Reproducing it means the demonstration shows the handoff, not just the form.

- [ ] **Step 1: Add the QR dependency**

```bash
pnpm --filter @asm/web add qrcode@1.5.5
pnpm --filter @asm/web add -D @types/qrcode@1.5.5
```

- [ ] **Step 2: Write `apps/web/src/components/deposit/MethodPicker.tsx`**

```tsx
"use client";

import { DEPOSIT_METHODS } from "@asm/contracts";

const MIN_USD = 10;

export function MethodPicker({
  onPick,
}: {
  onPick: (method: (typeof DEPOSIT_METHODS)[number]) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-4 py-2.5 text-sm">
        <span aria-hidden>🌐</span>
        <span>India</span>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-[var(--color-ink-2)]">
          Popular in your region ({DEPOSIT_METHODS.length})
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {DEPOSIT_METHODS.map((method) => (
            <li key={method}>
              <button
                type="button"
                onClick={() => onPick(method)}
                className="flex w-full items-center justify-between rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-3 text-left hover:border-[var(--color-brand)]"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{method}</span>
                  <span className="text-xs text-[var(--color-ink-2)]">
                    Min. ${MIN_USD.toFixed(2)}
                  </span>
                </span>
                <span aria-hidden className="text-[var(--color-ink-2)]">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `apps/web/src/components/deposit/AmountStep.tsx`**

```tsx
"use client";

import { useState } from "react";

const QUICK = [150, 200, 300, 500];

export function AmountStep({
  method,
  onBack,
}: {
  method: string;
  onBack: () => void;
}) {
  const [amountMajor, setAmountMajor] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proceed() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, amountUsd: Math.round(amountMajor * 100) }),
    });

    if (res.ok) {
      const data = (await res.json()) as { checkoutToken: string };
      // Full navigation, not a router push — the handoff to the "provider" page
      // is deliberately a page change, as it is on the original.
      window.location.href = `/checkout/${data.checkoutToken}`;
      return;
    }

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not start that deposit.");
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
      >
        ‹ Change method
      </button>

      <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
        <p className="text-sm font-semibold">{method}</p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--color-ink-2)]">
          <div>
            <dt>Min</dt>
            <dd className="tabular-nums text-[var(--color-ink)]">$10.00</dd>
          </div>
          <div>
            <dt>Max</dt>
            <dd className="tabular-nums text-[var(--color-ink)]">$961.00</dd>
          </div>
          <div>
            <dt>Processing</dt>
            <dd className="text-[var(--color-ink)]">48 hours</dd>
          </div>
        </dl>
      </div>

      <div>
        <label
          htmlFor="amount"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Deposit amount
        </label>
        <input
          id="amount"
          type="number"
          min={10}
          max={961}
          value={amountMajor}
          onChange={(e) => setAmountMajor(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-4 py-2.5 text-sm tabular-nums outline-none focus:border-[var(--color-brand)]"
        />
        <div className="mt-2 flex gap-2">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmountMajor(q)}
              className="flex-1 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-2 py-1.5 text-xs font-semibold"
            >
              ${q}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-warn,#8A5A02)] bg-[#2a2213] p-3 text-xs leading-relaxed text-[#e0ac50]">
        Payments with this method can take up to 48 hours to process. The status
        may appear as “Failed” until the funds are received on our side.
      </div>

      <div className="flex items-baseline justify-between border-t border-dashed border-[var(--color-edge)] pt-3 text-sm">
        <span className="text-[var(--color-ink-2)]">You will receive</span>
        <span className="font-semibold tabular-nums">
          ${amountMajor.toFixed(2)}
        </span>
      </div>

      <div className="flex items-baseline justify-between text-xs text-[var(--color-ink-2)]">
        <span>Bonus (50%)</span>
        <span className="tabular-nums text-[var(--color-up)]">
          +${(amountMajor * 0.5).toFixed(2)}
        </span>
      </div>

      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void proceed()}
        className="rounded-lg bg-[var(--color-brand)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {busy ? "Starting…" : "Proceed to Pay"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write `apps/web/src/app/(platform)/deposit/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { DEPOSIT_METHODS } from "@asm/contracts";
import { MethodPicker } from "@/components/deposit/MethodPicker";
import { AmountStep } from "@/components/deposit/AmountStep";

type Method = (typeof DEPOSIT_METHODS)[number];

export default function DepositPage() {
  const [method, setMethod] = useState<Method | null>(null);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Deposit</h1>
        <p className="mt-1 text-xs text-[var(--color-ink-2)]">
          Simulated — no real payment is taken.
        </p>
      </header>

      {method === null ? (
        <MethodPicker onPick={setMethod} />
      ) : (
        <AmountStep method={method} onBack={() => setMethod(null)} />
      )}
    </main>
  );
}
```

- [ ] **Step 5: Write `apps/web/src/app/checkout/[token]/ClaimForm.tsx`**

```tsx
"use client";

import { useState } from "react";

export function ClaimForm({ depositId }: { depositId: string }) {
  const [utr, setUtr] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);

    const res = await fetch(`/api/deposits/${depositId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ utr }),
    });

    if (res.ok) {
      setState("done");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not submit that reference.");
    setState("idle");
  }

  if (state === "done") {
    return (
      <div className="rounded-lg bg-[#efe7fb] p-4 text-center">
        <p className="text-sm font-semibold text-[#4b2d86]">
          Reference received
        </p>
        <p className="mt-1 text-xs text-[#6b5a8a]">
          Your deposit is being confirmed. This can take up to 48 hours.
        </p>
        <a
          href="/trade"
          className="mt-3 inline-block text-xs font-semibold text-[#5b2d9e] underline underline-offset-4"
        >
          Back to trading
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label
        htmlFor="utr"
        className="text-center text-xs font-bold uppercase tracking-wide text-[#5b2d9e]"
      >
        UTR / UPI Reference No.
      </label>
      <input
        id="utr"
        inputMode="numeric"
        required
        value={utr}
        onChange={(e) => setUtr(e.target.value)}
        placeholder="12-digit reference"
        className="rounded-lg border border-[#d8cdf0] bg-white px-4 py-2.5 text-center text-sm tabular-nums text-[#241436] outline-none focus:border-[#5b2d9e]"
      />
      {error ? (
        <p className="text-center text-xs text-[#b8384c]">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={state === "busy"}
        className="rounded-lg bg-[#5b2d9e] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {state === "busy" ? "Submitting…" : "Confirm"}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Write `apps/web/src/app/checkout/[token]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getDepositByToken } from "@asm/db";
import { ClaimForm } from "./ClaimForm";

export const dynamic = "force-dynamic";

/**
 * The provider-style hosted checkout.
 *
 * Deliberately light-themed and visually unlike the platform: the original
 * hands off to an off-domain, provider-branded page, and that break is part of
 * what the demonstration is showing.
 */
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const deposit = await getDepositByToken(token);
  if (!deposit) notFound();

  const rupees = (deposit.amountInr / 100).toFixed(2);

  // A real UPI deep link, pointing at a fictitious demo VPA.
  const upiUri =
    `upi://pay?pa=${encodeURIComponent(deposit.vpa)}` +
    `&pn=${encodeURIComponent("ASM Trade Demo")}` +
    `&am=${encodeURIComponent(rupees)}` +
    `&cu=INR&tn=${encodeURIComponent(`ASM-${deposit.id.slice(0, 8)}`)}`;

  const qrDataUri = await QRCode.toDataURL(upiUri, {
    width: 260,
    margin: 1,
    color: { dark: "#241436", light: "#ffffff" },
  });

  const resolved =
    deposit.status === "COMPLETED" ||
    deposit.status === "REJECTED" ||
    deposit.status === "EXPIRED";

  return (
    <main
      className="flex min-h-screen justify-center px-4 py-10"
      style={{ background: "#f6f4fb", color: "#241436" }}
    >
      <div className="flex w-full max-w-md flex-col gap-5">
        <header className="flex items-center justify-between">
          <p className="text-lg font-bold" style={{ color: "#5b2d9e" }}>
            {deposit.method}
          </p>
          <span className="text-xs font-semibold text-[#6b5a8a]">EN</span>
        </header>

        {resolved ? (
          <div className="rounded-xl bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-semibold">
              This payment is already {deposit.status.toLowerCase()}.
            </p>
            <a
              href="/trade"
              className="mt-3 inline-block text-xs font-semibold text-[#5b2d9e] underline underline-offset-4"
            >
              Back to trading
            </a>
          </div>
        ) : (
          <>
            <section className="rounded-xl bg-white p-6 text-center shadow-sm">
              <span className="inline-block rounded-full bg-[#5b2d9e] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Step 1
              </span>
              <h1 className="mt-3 text-sm font-bold" style={{ color: "#5b2d9e" }}>
                Scan QR to pay
              </h1>
              <p className="mt-2 text-3xl font-bold tabular-nums">₹ {rupees}</p>
              <img
                src={qrDataUri}
                alt={`UPI payment QR code for ₹${rupees}`}
                className="mx-auto mt-4 h-[260px] w-[260px]"
              />
            </section>

            <p className="text-center text-xs font-semibold text-[#6b5a8a]">OR</p>

            <section className="rounded-xl bg-white p-5 text-center shadow-sm">
              <p className="text-xs font-bold" style={{ color: "#5b2d9e" }}>
                Open any app that allows UPI payments
              </p>
              <dl className="mt-3 flex flex-col gap-3 text-sm">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                    Amount
                  </dt>
                  <dd className="tabular-nums">{rupees} INR</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                    UPI ID
                  </dt>
                  <dd className="break-all">{deposit.vpa}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed text-[#8a7aa8]">
                Pay this exact amount. The paise are what identify your payment —
                a different amount cannot be matched automatically.
              </p>
            </section>

            <section className="rounded-xl bg-white p-5 shadow-sm">
              <div className="mb-3 text-center">
                <span className="inline-block rounded-full bg-[#5b2d9e] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  Step 2
                </span>
              </div>
              <ClaimForm depositId={deposit.id} />
            </section>
          </>
        )}

        <p className="text-center text-[11px] text-[#8a7aa8]">
          Demonstration only. No payment is taken and no bank is contacted.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Verify the full deposit flow**

Run both processes:

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm dev:engine
```

```bash
pnpm dev
```

Log in, open `http://localhost:3000/deposit`, pick **PhonePe**, keep $100, and press **Proceed to Pay**.

Expected, in order:
1. The checkout page shows a light provider-style layout with a QR, an odd rupee amount like **₹10764.37**, and the demo VPA
2. Entering any 12-digit number and pressing **Confirm** shows “Reference received”
3. Within about ten seconds the engine logs `deposit.match_exact` and `deposit.matcher_pass`
4. `/trade` shows the Live account at **$100.00** plus **$50.00** bonus

```bash
psql -d asm_trade -c "
SELECT d.status, d.\"amountInr\", d.\"claimedUtr\", bc.consumed
FROM \"Deposit\" d LEFT JOIN \"BankCredit\" bc ON bc.id = d.\"matchedCreditId\"
ORDER BY d.\"createdAt\" DESC LIMIT 3;"
```

Expected: `COMPLETED` with `consumed = t`.

- [ ] **Step 8: Verify the admin-queue path**

Raise the drop rate so some deposits never get a credit:

```bash
SIMULATED_FEED_FAILURE_RATE=1 pnpm dev:engine
```

Make another deposit and claim a UTR. Expected: it stays `PENDING_CONFIRMATION`, the engine logs `deposit.match_none`, and no balance changes.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): deposit flow and provider-style hosted checkout"
```

---

## Task 7: Admin approval queue and withdrawals

**Files:**
- Create: `apps/web/src/app/admin/deposits/page.tsx`, `apps/web/src/app/admin/deposits/actions.ts`, `packages/db/src/repositories/withdrawal.ts`, `apps/web/src/app/api/withdrawals/route.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/repositories/withdrawal.test.ts`

**Interfaces:**
- Consumes: `approveDeposit`, `rejectDeposit`, `listPendingDeposits`, `requireAdmin`
- Produces:
  - `withdrawableBalance(accountId: string): Promise<{ withdrawable: number; lockedBonus: number; turnoverRemaining: number }>`
  - `requestWithdrawal(input: { actorId: string; accountId: string; amount: number; method: string }): Promise<Withdrawal>`
  - `approveWithdrawal(input: { withdrawalId: string; adminId: string }): Promise<void>`
  - Admin server actions `approveDepositAction`, `rejectDepositAction`

- [ ] **Step 1: Write the failing withdrawal test**

Create `packages/db/src/repositories/withdrawal.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client.js";
import { createAccountsForUser } from "./account.js";
import { requestWithdrawal, withdrawableBalance } from "./withdrawal.js";

const prisma = new PrismaClient();

let userId = "";
let accountId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `w-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  const accounts = await createAccountsForUser(userId, 0);
  accountId = accounts.find((a) => a.type === "LIVE")!.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("withdrawableBalance", () => {
  it("counts real balance as withdrawable", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 50_000 },
    });
    const result = await withdrawableBalance(accountId);
    expect(result.withdrawable).toBe(50_000);
  });

  it("excludes bonus funds while turnover is outstanding", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 10_000, bonusBalance: 5_000 },
    });
    await prisma.bonusGrant.create({
      data: {
        accountId,
        amount: 5_000,
        turnoverRequired: 150_000,
        turnoverDone: 0,
      },
    });

    const result = await withdrawableBalance(accountId);
    expect(result.withdrawable).toBe(10_000);
    expect(result.lockedBonus).toBe(5_000);
    expect(result.turnoverRemaining).toBe(150_000);
  });

  it("releases bonus funds once turnover is met", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 10_000, bonusBalance: 5_000 },
    });
    await prisma.bonusGrant.create({
      data: {
        accountId,
        amount: 5_000,
        turnoverRequired: 150_000,
        turnoverDone: 150_000,
      },
    });

    const result = await withdrawableBalance(accountId);
    expect(result.withdrawable).toBe(15_000);
    expect(result.turnoverRemaining).toBe(0);
  });
});

describe("requestWithdrawal", () => {
  beforeEach(async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 50_000 },
    });
    await prisma.deposit.create({
      data: {
        userId,
        method: "PhonePe",
        amountUsd: 50_000,
        amountInr: 5_382_000,
        vpa: "asmtrade.demo1@okaxis",
        checkoutToken: `wt-${process.hrtime.bigint()}`,
        status: "COMPLETED",
        correlationId: "cid",
        expiresAt: new Date(),
      },
    });
  });

  it("creates a request and debits the balance", async () => {
    const withdrawal = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 20_000,
      method: "PhonePe",
    });
    expect(withdrawal.status).toBe("REQUESTED");

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBe(30_000);
  });

  it("refuses more than the withdrawable balance", async () => {
    await expect(
      requestWithdrawal({ actorId: userId, accountId, amount: 90_000, method: "PhonePe" }),
    ).rejects.toThrow(/balance/i);
  });

  it("refuses a method never used for a completed deposit", async () => {
    await expect(
      requestWithdrawal({ actorId: userId, accountId, amount: 10_000, method: "PayTM" }),
    ).rejects.toThrow(/method/i);
  });

  it("refuses another user's account", async () => {
    const other = await prisma.user.create({
      data: { email: `ow-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
    });
    await expect(
      requestWithdrawal({
        actorId: other.id,
        accountId,
        amount: 10_000,
        method: "PhonePe",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/withdrawal.test.ts
```

Expected: FAIL — cannot resolve `./withdrawal.js`.

- [ ] **Step 3: Write `packages/db/src/repositories/withdrawal.ts`**

```ts
import { prisma } from "../client.js";
import { debitAccount } from "./trade.js";
import type { Withdrawal } from "../../generated/prisma/client.js";

export class WithdrawalRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WithdrawalRefused";
  }
}

/**
 * Bonus funds are withdrawable only once their turnover requirement clears.
 *
 * Without this, a 50% bonus would let anyone deposit and immediately withdraw
 * 150% — which is why every real platform attaches turnover, and why
 * reproducing it is part of reproducing the platform.
 */
export async function withdrawableBalance(accountId: string): Promise<{
  withdrawable: number;
  lockedBonus: number;
  turnoverRemaining: number;
}> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { realBalance: true, bonusBalance: true },
  });

  const grants = await prisma.bonusGrant.findMany({
    where: { accountId, status: "ACTIVE" },
    select: { amount: true, turnoverRequired: true, turnoverDone: true },
  });

  let lockedBonus = 0;
  let turnoverRemaining = 0;

  for (const grant of grants) {
    const remaining = Math.max(0, grant.turnoverRequired - grant.turnoverDone);
    if (remaining > 0) {
      lockedBonus += grant.amount;
      turnoverRemaining += remaining;
    }
  }

  const releasedBonus = Math.max(0, account.bonusBalance - lockedBonus);

  return {
    withdrawable: account.realBalance + releasedBonus,
    lockedBonus,
    turnoverRemaining,
  };
}

/**
 * Withdrawals go only to a method already used for a COMPLETED deposit, which
 * is the rule the original states and a standard anti-laundering control.
 */
export async function requestWithdrawal(input: {
  actorId: string;
  accountId: string;
  amount: number;
  method: string;
}): Promise<Withdrawal> {
  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId: input.actorId },
  });
  if (!account) throw new WithdrawalRefused("Account not found.");
  if (account.type !== "LIVE") {
    throw new WithdrawalRefused("Demo funds cannot be withdrawn.");
  }

  const usedMethod = await prisma.deposit.findFirst({
    where: { userId: input.actorId, method: input.method, status: "COMPLETED" },
  });
  if (!usedMethod) {
    throw new WithdrawalRefused(
      "You can only withdraw to a method you have already deposited with.",
    );
  }

  const { withdrawable } = await withdrawableBalance(input.accountId);
  if (input.amount > withdrawable) {
    throw new WithdrawalRefused(
      "That is more than your withdrawable balance. Bonus funds are locked until turnover clears.",
    );
  }

  await debitAccount(input.accountId, input.amount);

  const withdrawal = await prisma.withdrawal.create({
    data: {
      userId: input.actorId,
      amount: input.amount,
      method: input.method,
      status: "REQUESTED",
    },
  });

  await prisma.transaction.create({
    data: {
      accountId: input.accountId,
      kind: "WITHDRAWAL",
      amount: -input.amount,
      balanceAfter: withdrawable - input.amount,
      refType: "Withdrawal",
      refId: withdrawal.id,
    },
  });

  return withdrawal;
}

export async function approveWithdrawal(input: {
  withdrawalId: string;
  adminId: string;
}): Promise<void> {
  const claimed = await prisma.withdrawal.updateMany({
    where: { id: input.withdrawalId, status: "REQUESTED" },
    data: { status: "APPROVED", reviewedBy: input.adminId },
  });
  if (claimed.count !== 1) {
    throw new WithdrawalRefused("That withdrawal has already been reviewed.");
  }

  await prisma.auditLog.create({
    data: {
      actorId: input.adminId,
      action: "withdrawal.approved",
      targetType: "Withdrawal",
      targetId: input.withdrawalId,
      after: { status: "APPROVED" },
    },
  });
}

export async function listWithdrawalsForActor(
  actorId: string,
  limit: number,
): Promise<Withdrawal[]> {
  return prisma.withdrawal.findMany({
    where: { userId: actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}
```

- [ ] **Step 4: Append to `packages/db/src/index.ts`**

```ts
export {
  WithdrawalRefused,
  withdrawableBalance,
  requestWithdrawal,
  approveWithdrawal,
  listWithdrawalsForActor,
} from "./repositories/withdrawal.js";
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/withdrawal.test.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 6: Write `apps/web/src/app/admin/deposits/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { approveDeposit, rejectDeposit } from "@asm/db";
import { logger } from "@asm/logger";
import { requireAdmin } from "@/lib/require-admin";

export async function approveDepositAction(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  if (!depositId) return;

  await approveDeposit({ depositId, adminId: userId, creditId: null });
  logger.info(
    { evt: "admin.action", action: "deposit.approve", actorId: userId, depositId },
    "deposit approved by admin",
  );
  revalidatePath("/admin/deposits");
}

export async function rejectDepositAction(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  const reason = String(formData.get("reason") ?? "no matching credit");
  if (!depositId) return;

  await rejectDeposit({ depositId, adminId: userId, reason });
  logger.info(
    { evt: "admin.action", action: "deposit.reject", actorId: userId, depositId, reason },
    "deposit rejected by admin",
  );
  revalidatePath("/admin/deposits");
}
```

- [ ] **Step 7: Write `apps/web/src/app/admin/deposits/page.tsx`**

```tsx
import { listPendingDeposits, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/require-admin";
import { approveDepositAction, rejectDepositAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminDepositsPage() {
  await requireAdmin();

  const pending = await listPendingDeposits(50);

  // The bank feed, shown beside the claims so a human can compare them —
  // exactly the comparison the matcher makes automatically.
  const credits = await prisma.bankCredit.findMany({
    where: { consumed: false },
    orderBy: { receivedAt: "desc" },
    take: 50,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">
          Admin
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Deposits awaiting review
        </h1>
        <p className="mt-1 text-xs text-[var(--color-ink-2)]">
          Only the residue reaches here — exact and amount-only matches approve
          automatically.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Pending claims ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-2)]">
            Nothing awaiting review.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3 text-sm"
              >
                <span className="font-semibold">{d.method}</span>
                <span className="tabular-nums">
                  ₹{(d.amountInr / 100).toFixed(2)}
                </span>
                <span className="tabular-nums text-[var(--color-ink-2)]">
                  ${(d.amountUsd / 100).toFixed(2)}
                </span>
                <span className="font-mono text-xs text-[var(--color-ink-2)]">
                  {d.claimedUtr ?? "no reference"}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-ink-3,#6b747f)]">
                  {d.vpa}
                </span>

                <div className="ml-auto flex gap-2">
                  <form action={approveDepositAction}>
                    <input type="hidden" name="depositId" value={d.id} />
                    <button
                      type="submit"
                      className="rounded-md bg-[var(--color-up)] px-3 py-1.5 text-xs font-bold text-[#06231a]"
                    >
                      Approve
                    </button>
                  </form>
                  <form action={rejectDepositAction}>
                    <input type="hidden" name="depositId" value={d.id} />
                    <input
                      type="hidden"
                      name="reason"
                      value="no matching credit found"
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--color-down)] px-3 py-1.5 text-xs font-bold text-[var(--color-down)]"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Unconsumed bank credits ({credits.length})
        </h2>
        {credits.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-2)]">
            No unmatched credits. An orphan here means money arrived that matches
            no deposit — queue it, never discard it.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {credits.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap gap-3 border-t border-[var(--color-edge)] py-2"
              >
                <span className="tabular-nums">₹{(c.amountInr / 100).toFixed(2)}</span>
                <span className="font-mono text-[var(--color-ink-2)]">{c.utr}</span>
                <span className="font-mono text-[10px] text-[var(--color-ink-2)]">
                  {c.vpa}
                </span>
                <span className="ml-auto text-[var(--color-ink-2)]">
                  {c.receivedAt.toISOString().slice(11, 19)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 8: Write `apps/web/src/app/api/withdrawals/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DEPOSIT_METHODS } from "@asm/contracts";
import {
  WithdrawalRefused,
  listWithdrawalsForActor,
  requestWithdrawal,
  withdrawableBalance,
} from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";

const WithdrawSchema = z.strictObject({
  accountId: z.string().uuid(),
  amount: z.number().int().positive().max(100_000_000),
  method: z.enum(DEPOSIT_METHODS),
});

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = WithdrawSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the withdrawal details." }, { status: 400 });
  }

  try {
    const withdrawal = await requestWithdrawal({
      actorId: session.userId,
      ...parsed.data,
    });
    log.info(
      { evt: "withdrawal.requested", withdrawalId: withdrawal.id },
      "withdrawal requested",
    );
    return NextResponse.json({ id: withdrawal.id }, { status: 201 });
  } catch (err) {
    if (err instanceof WithdrawalRefused) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }

  const [balance, withdrawals] = await Promise.all([
    withdrawableBalance(accountId),
    listWithdrawalsForActor(session.userId, 20),
  ]);

  return NextResponse.json({ balance, withdrawals });
}
```

- [ ] **Step 9: Verify the admin queue end to end**

With `SIMULATED_FEED_FAILURE_RATE=1 pnpm dev:engine` running, make a deposit and claim a UTR. Log in as `admin@asmtrade.local` and open `http://localhost:3000/admin/deposits`.

Expected: the claim is listed with its odd rupee amount and reference. Pressing **Approve** credits the balance and writes an `AuditLog` row.

```bash
psql -d asm_trade -c "
SELECT action, \"actorId\" IS NOT NULL AS has_actor, \"targetType\"
FROM \"AuditLog\" ORDER BY \"createdAt\" DESC LIMIT 3;"
```

Expected: `deposit.approved_manual` with `has_actor = t`.

- [ ] **Step 10: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add packages/db apps/web
git commit -m "feat: admin deposit queue and withdrawals with turnover"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the whole suite**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all clean.

- [ ] **Step 2: Run the database-backed suites**

```bash
cd packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" pnpm exec vitest run
cd ../bankfeed
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" pnpm exec vitest run
cd ../..
```

Expected: PASS — 67 tests in `@asm/db`, 17 in `@asm/bankfeed`.

- [ ] **Step 3: Verify the reservation guarantee under concurrency**

```bash
psql -d asm_trade -c "
SELECT vpa, \"amountInr\", count(*)
FROM \"Deposit\"
WHERE status IN ('AWAITING_PAYMENT','PENDING_CONFIRMATION')
GROUP BY vpa, \"amountInr\" HAVING count(*) > 1;"
```

Expected: zero rows. A row here means the partial unique index is missing and the amount is no longer a reliable key.

- [ ] **Step 4: Verify no credit settled two deposits**

```bash
psql -d asm_trade -c "
SELECT \"matchedCreditId\", count(*)
FROM \"Deposit\"
WHERE \"matchedCreditId\" IS NOT NULL
GROUP BY \"matchedCreditId\" HAVING count(*) > 1;"
```

Expected: zero rows.

- [ ] **Step 5: Confirm the configured feed is still simulated**

```bash
grep -E '^BANK_FEED=' .env
```

Expected: `BANK_FEED="simulated"`. This is the standing constraint — the other adapters exist as proven seams and stay unplugged.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: plan 05 verification"
```

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass
- [ ] A $100 deposit produces an odd rupee amount and a working UPI QR
- [ ] Submitting any 12-digit reference moves the deposit to `PENDING_CONFIRMATION`
- [ ] The simulated feed credits it within ~10s and the balance shows $100 plus $50 bonus
- [ ] A credit with a mismatched UTR but a matching amount still auto-approves
- [ ] A credit on a different VPA, or off by any paise, does **not** match
- [ ] One `BankCredit` can settle only one deposit — `consumed` is set atomically
- [ ] A late credit matches an expired deposit before it is written off
- [ ] With `SIMULATED_FEED_FAILURE_RATE=1`, deposits reach the admin queue and approve manually with an audit row
- [ ] Bonus funds are excluded from `withdrawable` until turnover clears
- [ ] A withdrawal to a never-deposited method is refused
- [ ] No two live deposits share a `(vpa, amountInr)` pair
- [ ] `BANK_FEED` is still `simulated`

## What Plans 06 and 07 depend on from here

Plan 06 (Expo companion app):
- `POST /api/bank-feed/sms` with `{ sender, body, receivedAt }` and a `Bearer ${SMS_RELAY_SECRET}` header
- `RelayedSmsSchema` — the exact payload shape and its 1,000-character body cap
- `parseBankMessage` — the app may pre-filter, but the server parses authoritatively

Plan 07 (Platform surface):
- `withdrawableBalance(accountId)` — the withdrawal page's numbers
- `listDepositsForActor` / `listWithdrawalsForActor` — the payments history table
- `requireAdmin()` — every remaining admin screen
- `BONUS_PERCENT`, `TURNOVER_MULTIPLE` — the bonus progress display
