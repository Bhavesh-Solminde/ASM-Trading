import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import { createUsdtDepositIntent } from "./deposit";
import { matchChainCreditToDeposit } from "./chain-credit-matcher";

const NETWORK = "tron";
const CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const RECEIVING_ADDRESS = "TReceivingAddress1111111111111111";

let userId = "";
const createdCreditIds: string[] = [];

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `chain-matcher-test-${Date.now()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.chainCredit.deleteMany({ where: { id: { in: createdCreditIds } } });
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

/** A FINAL, PENDING ChainCredit ready for the matcher — the state ingestion + finality would have produced. */
async function makeFinalCredit(
  amountUsdtMinor: number,
  overrides: Partial<{ network: string; tokenContract: string; toAddress: string }> = {},
): Promise<string> {
  const credit = await prisma.chainCredit.create({
    data: {
      network: overrides.network ?? NETWORK,
      tokenContract: overrides.tokenContract ?? CONTRACT,
      txHash: `tx-${randomUUID()}`,
      eventIndex: 0,
      fromAddress: "TSender11111111111111111111111111",
      toAddress: overrides.toAddress ?? RECEIVING_ADDRESS,
      rawAmount: BigInt(amountUsdtMinor) * 10_000n,
      normalizedAmountMinor: amountUsdtMinor,
      blockNumber: 1_000_000n,
      blockTimestamp: new Date(),
      finalityState: "FINAL",
      rawPayload: {},
    },
  });
  createdCreditIds.push(credit.id);
  return credit.id;
}

function expectedConfig(overrides: Partial<Parameters<typeof matchChainCreditToDeposit>[0]> = {}) {
  return {
    expectedNetwork: NETWORK,
    expectedTokenContract: CONTRACT,
    expectedReceivingAddress: RECEIVING_ADDRESS,
    ...overrides,
  };
}

describe("matchChainCreditToDeposit", () => {
  it("exact amount match on a FINAL credit -> auto-approves and credits the account", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 10_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
    const creditId = await makeFinalCredit(deposit.amountUsdtMinor!);

    const outcome = await matchChainCreditToDeposit({ chainCreditId: creditId, ...expectedConfig() });
    expect(outcome).toEqual({ kind: "auto_approved", depositId: deposit.id });

    const updatedDeposit = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updatedDeposit.status).toBe("COMPLETED");
    expect(updatedDeposit.matchedChainCreditId).toBe(creditId);

    const updatedCredit = await prisma.chainCredit.findUniqueOrThrow({ where: { id: creditId } });
    expect(updatedCredit.consumed).toBe(true);
    expect(updatedCredit.processingStatus).toBe("MATCHED");
  });

  it("no live deposit reserved this amount -> unmatched, never guessed", async () => {
    const creditId = await makeFinalCredit(999_999);

    const outcome = await matchChainCreditToDeposit({ chainCreditId: creditId, ...expectedConfig() });
    expect(outcome).toEqual({ kind: "unmatched" });

    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: creditId } });
    expect(updated.processingStatus).toBe("UNMATCHED");
    expect(updated.reviewReason).toBe("NO_LIVE_DEPOSIT");
  });

  it("DETECTED/CONFIRMING (not yet FINAL) is never eligible for matching, regardless of amount", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 20_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
    const credit = await prisma.chainCredit.create({
      data: {
        network: NETWORK,
        tokenContract: CONTRACT,
        txHash: `tx-${randomUUID()}`,
        eventIndex: 0,
        fromAddress: "TSender11111111111111111111111111",
        toAddress: RECEIVING_ADDRESS,
        rawAmount: BigInt(deposit.amountUsdtMinor!) * 10_000n,
        normalizedAmountMinor: deposit.amountUsdtMinor,
        blockNumber: 1_000_000n,
        blockTimestamp: new Date(),
        finalityState: "CONFIRMING",
        rawPayload: {},
      },
    });
    createdCreditIds.push(credit.id);

    const outcome = await matchChainCreditToDeposit({ chainCreditId: credit.id, ...expectedConfig() });
    expect(outcome).toEqual({ kind: "manual_review", reason: "not_final", depositId: null });

    const updatedDeposit = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updatedDeposit.status).toBe("AWAITING_PAYMENT");
  });

  it("wrong token contract on an otherwise-exact-amount FINAL credit -> manual review, never credited", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 30_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
    const creditId = await makeFinalCredit(deposit.amountUsdtMinor!, { tokenContract: "TSomeOtherContract1111111111111" });

    const outcome = await matchChainCreditToDeposit({ chainCreditId: creditId, ...expectedConfig() });
    expect(outcome).toEqual({ kind: "manual_review", reason: "wrong_token_contract", depositId: null });

    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: creditId } });
    expect(updated.reviewReason).toBe("WRONG_TOKEN_CONTRACT");
    expect(updated.consumed).toBe(false);
  });

  it("wrong network -> manual review, never credited", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 31_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
    const creditId = await makeFinalCredit(deposit.amountUsdtMinor!, { network: "ethereum" });

    const outcome = await matchChainCreditToDeposit({ chainCreditId: creditId, ...expectedConfig() });
    expect(outcome).toEqual({ kind: "manual_review", reason: "wrong_network", depositId: null });
  });

  it("wrong destination address -> manual review, never credited", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 32_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
    const creditId = await makeFinalCredit(deposit.amountUsdtMinor!, { toAddress: "TSomeoneElsesWallet111111111111" });

    const outcome = await matchChainCreditToDeposit({ chainCreditId: creditId, ...expectedConfig() });
    expect(outcome).toEqual({ kind: "manual_review", reason: "wrong_destination", depositId: null });
  });

  it("an expired deposit is not a live candidate — a late payment lands in unmatched, never auto-credited", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 40_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({ where: { id: deposit.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const creditId = await makeFinalCredit(deposit.amountUsdtMinor!);

    const outcome = await matchChainCreditToDeposit({ chainCreditId: creditId, ...expectedConfig() });
    expect(outcome).toEqual({ kind: "unmatched" });
  });

  it("an already-MATCHED/consumed credit is never re-decided", async () => {
    const creditId = await makeFinalCredit(50_000);
    await prisma.chainCredit.update({
      where: { id: creditId },
      data: { processingStatus: "MATCHED", consumed: true },
    });

    const outcome = await matchChainCreditToDeposit({ chainCreditId: creditId, ...expectedConfig() });
    expect(outcome).toEqual({ kind: "manual_review", reason: "already_processed", depositId: null });
  });

  it("safety rule: amount matches more than one live deposit -> manual review, never a guess", async () => {
    // Mirrors the INR matcher's equivalent defense-in-depth test: the
    // partial unique index (Deposit_live_usdt_amount_unique) is a real
    // Postgres constraint that should prevent this from ever happening; this
    // test exercises the matcher's own defense-in-depth branch by dropping
    // the index, creating two live deposits at the same amount, then
    // restoring it.
    const shared = 60_000;

    await prisma.$executeRaw`DROP INDEX "Deposit_live_usdt_amount_unique"`;
    try {
      const expiresAt = new Date(Date.now() + 3_600_000);
      await prisma.deposit.create({
        data: {
          userId,
          method: "USDT",
          amountUsd: 0,
          amountInr: 0,
          vpa: RECEIVING_ADDRESS,
          network: NETWORK,
          tokenContract: CONTRACT,
          receivingAddress: RECEIVING_ADDRESS,
          amountUsdtMinor: shared,
          checkoutToken: `tok-${randomUUID()}`,
          status: "AWAITING_PAYMENT",
          correlationId: randomUUID(),
          expiresAt,
        },
      });
      await prisma.deposit.create({
        data: {
          userId,
          method: "USDT",
          amountUsd: 0,
          amountInr: 0,
          vpa: RECEIVING_ADDRESS,
          network: NETWORK,
          tokenContract: CONTRACT,
          receivingAddress: RECEIVING_ADDRESS,
          amountUsdtMinor: shared,
          checkoutToken: `tok-${randomUUID()}`,
          status: "AWAITING_PAYMENT",
          correlationId: randomUUID(),
          expiresAt,
        },
      });

      const creditId = await makeFinalCredit(shared);
      const outcome = await matchChainCreditToDeposit({ chainCreditId: creditId, ...expectedConfig() });
      expect(outcome).toEqual({ kind: "manual_review", reason: "ambiguous_amount", depositId: null });
    } finally {
      await prisma.deposit.deleteMany({ where: { amountUsdtMinor: shared } });
      await prisma.$executeRaw`CREATE UNIQUE INDEX "Deposit_live_usdt_amount_unique" ON "Deposit" ("amountUsdtMinor") WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION') AND "amountUsdtMinor" IS NOT NULL`;
    }
  });
});
