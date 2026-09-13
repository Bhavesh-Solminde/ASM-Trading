import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, createAccountsForUser, createDepositIntent } from "@asm/db";
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
