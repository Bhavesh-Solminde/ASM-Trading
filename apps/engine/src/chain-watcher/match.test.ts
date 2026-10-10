import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAccountsForUser, createUsdtDepositIntent, prisma } from "@asm/db";
import { runMatchTick } from "./match";

const NETWORK = "tron";
const CONTRACT = "TContract111";
const RECEIVING_ADDRESS = "TReceiving111";

function config() {
  return { expectedNetwork: NETWORK, expectedTokenContract: CONTRACT, expectedReceivingAddresses: [RECEIVING_ADDRESS] };
}

async function makeFinalCredit(amountUsdtMinor: number) {
  return prisma.chainCredit.create({
    data: {
      network: NETWORK,
      tokenContract: CONTRACT,
      txHash: `tx-${randomUUID()}`,
      eventIndex: 0,
      fromAddress: "TFrom111",
      toAddress: RECEIVING_ADDRESS,
      rawAmount: (BigInt(amountUsdtMinor) * 10_000n).toString(),
      normalizedAmountMinor: amountUsdtMinor,
      blockNumber: 1_000_000n,
      blockTimestamp: new Date(),
      finalityState: "FINAL",
      rawPayload: {},
    },
  });
}

let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `match-test-${Date.now()}@test.local`, passwordHash: "x" } });
  userId = user.id;
  await createAccountsForUser(userId, 0);
  await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "USDT" } });
});

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

// Tests share the dev database: only ever delete rows under this file's own
// fake contract, never real ingested transfers (network "tron" alone matches them).
afterEach(async () => {
  await prisma.chainCredit.deleteMany({ where: { network: NETWORK, tokenContract: CONTRACT } });
});

describe("runMatchTick", () => {
  it("auto-approves and credits an exact-amount FINAL+PENDING chain credit", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 70_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
    await makeFinalCredit(deposit.amountUsdtMinor!);

    const result = await runMatchTick(config());
    expect(result).toEqual({ checked: 1, autoApproved: 1, manualReview: 0, unmatched: 0, raceLost: 0 });

    const updated = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updated.status).toBe("COMPLETED");
  });

  it("never picks up a DETECTED/CONFIRMING credit — listPendingMatches only returns FINAL rows", async () => {
    await prisma.chainCredit.create({
      data: {
        network: NETWORK,
        tokenContract: CONTRACT,
        txHash: `tx-${randomUUID()}`,
        eventIndex: 0,
        fromAddress: "TFrom111",
        toAddress: RECEIVING_ADDRESS,
        rawAmount: "800000000",
        normalizedAmountMinor: 80_000,
        blockNumber: 1_000_000n,
        blockTimestamp: new Date(),
        finalityState: "CONFIRMING",
        rawPayload: {},
      },
    });

    const result = await runMatchTick(config());
    expect(result.checked).toBe(0);
  });

  it("repeated matching cannot double-credit — a second tick over an already-MATCHED row finds nothing left to do", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 71_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
    await makeFinalCredit(deposit.amountUsdtMinor!);

    const first = await runMatchTick(config());
    expect(first.autoApproved).toBe(1);

    // Simulates the runner firing again (its normal, expected behavior) —
    // listPendingMatches only returns PENDING rows, and this one is now MATCHED.
    const second = await runMatchTick(config());
    expect(second.checked).toBe(0);

    const depositTxCount = await prisma.transaction.count({
      where: { account: { userId }, refType: "Deposit", refId: deposit.id, kind: "DEPOSIT" },
    });
    expect(depositTxCount).toBe(1);
  });

  it("two concurrent matching attempts on the same chain credit result in exactly one credit — the loser is counted as raceLost, not an error", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 72_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
    await makeFinalCredit(deposit.amountUsdtMinor!);

    const [a, b] = await Promise.all([runMatchTick(config()), runMatchTick(config())]);
    const totalApproved = a.autoApproved + b.autoApproved;
    const totalRaceLost = a.raceLost + b.raceLost;
    // Both ticks see the same PENDING row (they ran concurrently before
    // either committed); exactly one wins, the other's attempt is caught and
    // counted as a benign race loss.
    expect(totalApproved).toBe(1);
    expect(totalRaceLost).toBe(1);

    const depositTxCount = await prisma.transaction.count({
      where: { account: { userId }, refType: "Deposit", refId: deposit.id, kind: "DEPOSIT" },
    });
    expect(depositTxCount).toBe(1);
  });

  it("no live deposit for the amount -> unmatched, never guessed", async () => {
    await makeFinalCredit(999_999);
    const result = await runMatchTick(config());
    expect(result.unmatched).toBe(1);
  });
});
