import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import {
  GATEWAY_EXPIRE_GRACE_MS,
  GATEWAY_TATUM,
  allocateGatewayAddressIndex,
  createGatewayUsdtDeposit,
  expireGatewayDeposit,
  findGatewayDepositByAddress,
  listDetectedGatewayCredits,
  listGatewayDepositsToExpire,
  listGatewayDepositsToWatch,
  markChainCreditsFinalForTx,
  matchGatewayChainCredit,
} from "./gateway-deposit";

// A test-only network id so the per-network address counter never collides
// with a real "tron"/"bsc" counter in a shared DB.
const NETWORK = `tron-test-${randomUUID().slice(0, 8)}`;
const CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";

let userId = "";
const creditIds: string[] = [];

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `gateway-deposit-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  // A USD live account: 1 USDT-cent credits exactly 1 USD-cent.
  await createAccountsForUser(userId, 0, "USD");
});

afterAll(async () => {
  await prisma.chainCredit.deleteMany({ where: { id: { in: creditIds } } });
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.auditLog.deleteMany({ where: { targetType: "Deposit", targetId: { in: (await prisma.deposit.findMany({ where: { userId }, select: { id: true } })).map((d) => d.id) } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.gatewayAddressCounter.deleteMany({ where: { network: NETWORK } });
});

let addrSeq = 0;
async function newDeposit(amountUsdtMinorRequested: number) {
  const addressIndex = await allocateGatewayAddressIndex(NETWORK);
  return createGatewayUsdtDeposit({
    userId,
    amountUsdtMinorRequested,
    network: NETWORK,
    tokenContract: CONTRACT,
    receivingAddress: `TAddr${++addrSeq}-${randomUUID()}`,
    addressIndex,
    correlationId: randomUUID(),
  });
}

async function makeCredit(input: {
  toAddress: string;
  amountUsdtMinor: number | null;
  finality?: "DETECTED" | "FINAL";
  tokenContract?: string;
  blockTimestamp?: Date;
  txHash?: string;
}): Promise<string> {
  const credit = await prisma.chainCredit.create({
    data: {
      network: NETWORK,
      tokenContract: input.tokenContract ?? CONTRACT,
      txHash: input.txHash ?? `tx-${randomUUID()}`,
      eventIndex: 0,
      fromAddress: "TSender11111111111111111111111111",
      toAddress: input.toAddress,
      rawAmount: (BigInt(input.amountUsdtMinor ?? 1) * 10_000n + (input.amountUsdtMinor === null ? 1n : 0n)).toString(),
      tokenDecimals: 6,
      normalizedAmountMinor: input.amountUsdtMinor,
      blockNumber: 1_000_000n,
      blockTimestamp: input.blockTimestamp ?? new Date(),
      finalityState: input.finality ?? "FINAL",
      ...(input.amountUsdtMinor === null
        ? { processingStatus: "MANUAL_REVIEW" as const, reviewReason: "PRECISION_NOT_REPRESENTABLE" }
        : {}),
      rawPayload: {},
    },
  });
  creditIds.push(credit.id);
  return credit.id;
}

async function liveBalance(): Promise<number> {
  const acct = await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } });
  return acct.realBalance;
}

describe("allocateGatewayAddressIndex", () => {
  it("hands out unique indexes starting at 1, never 0", async () => {
    const network = `${NETWORK}-alloc`;
    try {
      const got = await Promise.all(Array.from({ length: 8 }, () => allocateGatewayAddressIndex(network)));
      expect(new Set(got).size).toBe(8);
      expect(Math.min(...got)).toBe(1);
      expect(Math.max(...got)).toBe(8);
    } finally {
      await prisma.gatewayAddressCounter.deleteMany({ where: { network } });
    }
  });
});

describe("createGatewayUsdtDeposit", () => {
  it("stores the exact requested amount and lets two live same-amount deposits coexist", async () => {
    const a = await newDeposit(5_000);
    const b = await newDeposit(5_000);
    for (const d of [a, b]) {
      expect(d.gateway).toBe(GATEWAY_TATUM);
      expect(d.method).toBe("USDT");
      expect(d.amountUsdtMinor).toBe(5_000);
      expect(d.status).toBe("AWAITING_PAYMENT");
      expect(d.expiresAt.getTime() - d.createdAt.getTime()).toBeGreaterThanOrEqual(29 * 60_000);
    }
    expect(a.receivingAddress).not.toBe(b.receivingAddress);
    expect(await findGatewayDepositByAddress(NETWORK, a.receivingAddress!)).toMatchObject({ id: a.id });
  });

  it("rejects amounts outside the USDT min/max", async () => {
    await expect(newDeposit(10)).rejects.toThrow(/minimum/i);
  });
});

describe("matchGatewayChainCredit", () => {
  it("credits an exact payment to the deposit's own address", async () => {
    const before = await liveBalance();
    const d = await newDeposit(2_000);
    const id = await makeCredit({ toAddress: d.receivingAddress!, amountUsdtMinor: 2_000 });
    const out = await matchGatewayChainCredit(id);
    expect(out).toEqual({ kind: "credited", depositId: d.id, creditedUsdtMinor: 2_000 });
    expect(await liveBalance()).toBe(before + 2_000);
    const after = await prisma.deposit.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.matchedChainCreditId).toBe(id);
    const cc = await prisma.chainCredit.findUniqueOrThrow({ where: { id } });
    expect(cc).toMatchObject({ processingStatus: "MATCHED", consumed: true });
  });

  it("credits the full received amount on an overpayment", async () => {
    const before = await liveBalance();
    const d = await newDeposit(2_000);
    const id = await makeCredit({ toAddress: d.receivingAddress!, amountUsdtMinor: 2_550 });
    expect(await matchGatewayChainCredit(id)).toEqual({ kind: "credited", depositId: d.id, creditedUsdtMinor: 2_550 });
    expect(await liveBalance()).toBe(before + 2_550);
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: d.id } })).amountUsdtMinor).toBe(2_550);
  });

  it("sends an underpayment to manual review and credits nothing", async () => {
    const before = await liveBalance();
    const d = await newDeposit(2_000);
    const id = await makeCredit({ toAddress: d.receivingAddress!, amountUsdtMinor: 1_999 });
    expect(await matchGatewayChainCredit(id)).toEqual({ kind: "manual_review", reason: "UNDERPAID", depositId: d.id });
    expect(await liveBalance()).toBe(before);
    expect((await prisma.chainCredit.findUniqueOrThrow({ where: { id } })).reviewReason).toBe("UNDERPAID");
  });

  it("sends a payment made after expiry to manual review", async () => {
    const d = await newDeposit(2_000);
    const id = await makeCredit({
      toAddress: d.receivingAddress!,
      amountUsdtMinor: 2_000,
      blockTimestamp: new Date(d.expiresAt.getTime() + 1_000),
    });
    expect(await matchGatewayChainCredit(id)).toEqual({ kind: "manual_review", reason: "EXPIRED_DEPOSIT", depositId: d.id });
  });

  it("sends a second payment to an already-completed address to manual review", async () => {
    const d = await newDeposit(2_000);
    const first = await makeCredit({ toAddress: d.receivingAddress!, amountUsdtMinor: 2_000 });
    expect((await matchGatewayChainCredit(first)).kind).toBe("credited");
    const second = await makeCredit({ toAddress: d.receivingAddress!, amountUsdtMinor: 2_000 });
    expect(await matchGatewayChainCredit(second)).toEqual({
      kind: "manual_review",
      reason: "ADDRESS_ALREADY_USED",
      depositId: d.id,
    });
  });

  it("flags a transfer of a different token contract", async () => {
    const d = await newDeposit(2_000);
    const id = await makeCredit({ toAddress: d.receivingAddress!, amountUsdtMinor: 2_000, tokenContract: "TOtherToken" });
    expect(await matchGatewayChainCredit(id)).toEqual({
      kind: "manual_review",
      reason: "WRONG_TOKEN_CONTRACT",
      depositId: d.id,
    });
  });

  it("marks a transfer to an address no deposit owns as UNMATCHED", async () => {
    const id = await makeCredit({ toAddress: `TNobody-${randomUUID()}`, amountUsdtMinor: 2_000 });
    expect(await matchGatewayChainCredit(id)).toEqual({ kind: "unmatched" });
    expect((await prisma.chainCredit.findUniqueOrThrow({ where: { id } })).processingStatus).toBe("UNMATCHED");
  });

  it("never credits a credit that is not FINAL yet, and never re-decides a processed one", async () => {
    const d = await newDeposit(2_000);
    const id = await makeCredit({ toAddress: d.receivingAddress!, amountUsdtMinor: 2_000, finality: "DETECTED" });
    expect(await matchGatewayChainCredit(id)).toEqual({ kind: "skipped", reason: "not_final" });
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("AWAITING_PAYMENT");

    const done = await makeCredit({ toAddress: `TNobody-${randomUUID()}`, amountUsdtMinor: 2_000 });
    await matchGatewayChainCredit(done);
    expect(await matchGatewayChainCredit(done)).toEqual({ kind: "skipped", reason: "already_processed" });
  });
});

describe("finality + watch/expiry bookkeeping", () => {
  it("markChainCreditsFinalForTx promotes DETECTED rows of one tx and listDetectedGatewayCredits sees them first", async () => {
    const d = await newDeposit(2_000);
    const txHash = `tx-${randomUUID()}`;
    const id = await makeCredit({ toAddress: d.receivingAddress!, amountUsdtMinor: 2_000, finality: "DETECTED", txHash });
    expect((await listDetectedGatewayCredits(500)).map((c) => c.id)).toContain(id);
    expect(await markChainCreditsFinalForTx({ network: NETWORK, tokenContract: CONTRACT, txHash })).toBe(1);
    expect((await prisma.chainCredit.findUniqueOrThrow({ where: { id } })).finalityState).toBe("FINAL");
  });

  it("watches live deposits and expires only those past the grace period", async () => {
    const live = await newDeposit(2_000);
    const stale = await newDeposit(2_000);
    await prisma.deposit.update({
      where: { id: stale.id },
      data: { expiresAt: new Date(Date.now() - GATEWAY_EXPIRE_GRACE_MS - 60_000) },
    });
    const now = new Date();
    const watched = (await listGatewayDepositsToWatch(now)).map((x) => x.id);
    expect(watched).toEqual(expect.arrayContaining([live.id, stale.id]));
    const toExpire = (await listGatewayDepositsToExpire(now)).map((x) => x.id);
    expect(toExpire).toContain(stale.id);
    expect(toExpire).not.toContain(live.id);
    expect(await expireGatewayDeposit(stale.id)).toBe(true);
    expect(await expireGatewayDeposit(stale.id)).toBe(false);
  });
});
