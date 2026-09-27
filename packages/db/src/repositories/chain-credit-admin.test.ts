import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import { claimUsdtPayment, createDepositIntent, createUsdtDepositIntent } from "./deposit";
import {
  ChainCreditResolutionRefused,
  countUsdtReviewQueue,
  dismissChainCredit,
  getUsdtReviewEvidence,
  listCandidateDepositsForChainCredit,
  listUsdtReviewQueue,
  resolveChainCreditToDeposit,
} from "./chain-credit-admin";
import type { Deposit } from "../../generated/prisma/client";

const NETWORK = "tron";
const CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const RECEIVING_ADDRESS = "TReceivingAddress1111111111111111";
const ADMIN = "admin-test";

let userId = "";
const createdCreditIds: string[] = [];

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `chain-admin-test-${Date.now()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.chainCredit.deleteMany({ where: { id: { in: createdCreditIds } } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

type CreditOverrides = Partial<{
  network: string;
  tokenContract: string;
  toAddress: string;
  blockTimestamp: Date;
  finalityState: "DETECTED" | "CONFIRMING" | "FINAL";
  processingStatus: "PENDING" | "MATCHED" | "MANUAL_REVIEW" | "UNMATCHED" | "DISMISSED";
  consumed: boolean;
  txHash: string;
  fromAddress: string;
}>;

/** A FINAL ChainCredit the matcher already routed to review (UNMATCHED by default). */
async function makeCredit(amountUsdtMinor: number, o: CreditOverrides = {}): Promise<string> {
  const credit = await prisma.chainCredit.create({
    data: {
      network: o.network ?? NETWORK,
      tokenContract: o.tokenContract ?? CONTRACT,
      txHash: o.txHash ?? `tx-${randomUUID()}`,
      eventIndex: 0,
      fromAddress: o.fromAddress ?? "TSender11111111111111111111111111",
      toAddress: o.toAddress ?? RECEIVING_ADDRESS,
      rawAmount: BigInt(amountUsdtMinor) * 10_000n,
      normalizedAmountMinor: amountUsdtMinor,
      blockNumber: 1_000_000n,
      blockTimestamp: o.blockTimestamp ?? new Date(),
      finalityState: o.finalityState ?? "FINAL",
      processingStatus: o.processingStatus ?? "UNMATCHED",
      reviewReason: "NO_LIVE_DEPOSIT",
      consumed: o.consumed ?? false,
      rawPayload: {},
    },
  });
  createdCreditIds.push(credit.id);
  return credit.id;
}

async function makeUsdtDeposit(requested: number, status?: "EXPIRED" | "COMPLETED"): Promise<Deposit> {
  const deposit = await createUsdtDepositIntent({
    userId,
    amountUsdtMinorRequested: requested,
    network: NETWORK,
    tokenContract: CONTRACT,
    receivingAddress: RECEIVING_ADDRESS,
    correlationId: randomUUID(),
  });
  if (!status) return deposit;
  return prisma.deposit.update({ where: { id: deposit.id }, data: { status } });
}

const config = {
  expectedNetwork: NETWORK,
  expectedTokenContract: CONTRACT,
  expectedReceivingAddress: RECEIVING_ADDRESS,
};

async function liveBalance(): Promise<number> {
  return (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).realBalance;
}

describe("resolveChainCreditToDeposit", () => {
  it("credits the RECEIVED amount to an EXPIRED deposit whose reservation differs, and rewrites the deposit", async () => {
    const deposit = await makeUsdtDeposit(70_000, "EXPIRED");
    const received = deposit.amountUsdtMinor! + 37;
    const creditId = await makeCredit(received);
    const before = await liveBalance();

    await resolveChainCreditToDeposit({ chainCreditId: creditId, depositId: deposit.id, adminId: ADMIN, ...config });

    // INR account: received USDT-cents × 100 paise.
    expect((await liveBalance()) - before).toBe(received * 100);

    const d = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(d.status).toBe("COMPLETED");
    expect(d.amountUsdtMinor).toBe(received);
    expect(d.amountInr).toBe(-received);
    expect(d.matchedChainCreditId).toBe(creditId);

    const c = await prisma.chainCredit.findUniqueOrThrow({ where: { id: creditId } });
    expect(c.processingStatus).toBe("MATCHED");
    expect(c.consumed).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetType: "Deposit", targetId: deposit.id, action: "deposit.approved_manual" },
    });
    expect(audit.after).toMatchObject({
      resolvedByAdmin: true,
      usdtMinorOverride: received,
      reservedUsdtMinor: deposit.amountUsdtMinor,
    });
  });

  async function expectRefusedAndUntouched(
    creditId: string,
    depositId: string,
    overrides: Partial<typeof config> = {},
  ): Promise<void> {
    const before = await liveBalance();
    const creditBefore = await prisma.chainCredit.findUniqueOrThrow({ where: { id: creditId } });
    const depositBefore = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    await expect(
      resolveChainCreditToDeposit({ chainCreditId: creditId, depositId, adminId: ADMIN, ...config, ...overrides }),
    ).rejects.toBeInstanceOf(ChainCreditResolutionRefused);
    expect(await liveBalance()).toBe(before);
    const creditAfter = await prisma.chainCredit.findUniqueOrThrow({ where: { id: creditId } });
    expect(creditAfter.consumed).toBe(creditBefore.consumed);
    expect(creditAfter.processingStatus).toBe(creditBefore.processingStatus);
    const depositAfter = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    expect(depositAfter.status).toBe(depositBefore.status);
  }

  it("refuses a credit sent to a different destination than the live config", async () => {
    const deposit = await makeUsdtDeposit(71_000, "EXPIRED");
    const creditId = await makeCredit(deposit.amountUsdtMinor!, { toAddress: "TSomeoneElsesWallet111111111111" });
    await expectRefusedAndUntouched(creditId, deposit.id);
  });

  it("refuses when the live config's receiving address differs from the credit's", async () => {
    const deposit = await makeUsdtDeposit(71_500, "EXPIRED");
    const creditId = await makeCredit(deposit.amountUsdtMinor!);
    await expectRefusedAndUntouched(creditId, deposit.id, { expectedReceivingAddress: "TRotatedAddress11111111111111111" });
  });

  it("refuses a credit for the wrong token contract", async () => {
    const deposit = await makeUsdtDeposit(72_000, "EXPIRED");
    const creditId = await makeCredit(deposit.amountUsdtMinor!, { tokenContract: "TSomeOtherContract1111111111111" });
    await expectRefusedAndUntouched(creditId, deposit.id);
  });

  it("refuses a credit that is not FINAL", async () => {
    const deposit = await makeUsdtDeposit(73_000, "EXPIRED");
    const creditId = await makeCredit(deposit.amountUsdtMinor!, { finalityState: "CONFIRMING" });
    await expectRefusedAndUntouched(creditId, deposit.id);
  });

  it("refuses a credit still PENDING (the matcher has not decided it)", async () => {
    const deposit = await makeUsdtDeposit(74_000, "EXPIRED");
    const creditId = await makeCredit(deposit.amountUsdtMinor!, { processingStatus: "PENDING" });
    await expectRefusedAndUntouched(creditId, deposit.id);
  });

  it("refuses an already-consumed credit", async () => {
    const deposit = await makeUsdtDeposit(75_000, "EXPIRED");
    const creditId = await makeCredit(deposit.amountUsdtMinor!, { consumed: true });
    await expectRefusedAndUntouched(creditId, deposit.id);
  });

  it("refuses a COMPLETED deposit", async () => {
    const deposit = await makeUsdtDeposit(76_000, "COMPLETED");
    const creditId = await makeCredit(deposit.amountUsdtMinor!);
    await expectRefusedAndUntouched(creditId, deposit.id);
  });

  it("refuses a non-USDT deposit", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 2_700_000,
      correlationId: randomUUID(),
    });
    const creditId = await makeCredit(77_000);
    await expectRefusedAndUntouched(creditId, deposit.id);
  });

  it("two concurrent resolves of the same credit -> exactly one DEPOSIT transaction, the other refused", async () => {
    const deposit = await makeUsdtDeposit(78_000, "EXPIRED");
    const creditId = await makeCredit(deposit.amountUsdtMinor!);

    const attempt = () =>
      resolveChainCreditToDeposit({ chainCreditId: creditId, depositId: deposit.id, adminId: ADMIN, ...config });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.length).toBe(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ChainCreditResolutionRefused);

    const depositTxCount = await prisma.transaction.count({
      where: { account: { userId }, refType: "Deposit", refId: deposit.id, kind: "DEPOSIT" },
    });
    expect(depositTxCount).toBe(1);
  });

  it("two concurrent resolves of the same credit to DIFFERENT deposits -> exactly one credited", async () => {
    const a = await makeUsdtDeposit(79_000, "EXPIRED");
    const b = await makeUsdtDeposit(79_500, "EXPIRED");
    const creditId = await makeCredit(a.amountUsdtMinor!);
    const before = await liveBalance();

    const results = await Promise.allSettled([
      resolveChainCreditToDeposit({ chainCreditId: creditId, depositId: a.id, adminId: ADMIN, ...config }),
      resolveChainCreditToDeposit({ chainCreditId: creditId, depositId: b.id, adminId: ADMIN, ...config }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.length).toBe(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ChainCreditResolutionRefused);

    expect((await liveBalance()) - before).toBe(a.amountUsdtMinor! * 100);
    const completed = await prisma.deposit.count({ where: { id: { in: [a.id, b.id] }, status: "COMPLETED" } });
    expect(completed).toBe(1);
  });
});

describe("dismissChainCredit", () => {
  it("dismisses once, refuses a second dismiss, and blocks a later resolve", async () => {
    const deposit = await makeUsdtDeposit(80_000, "EXPIRED");
    const creditId = await makeCredit(deposit.amountUsdtMinor!, { processingStatus: "MANUAL_REVIEW" });

    await dismissChainCredit({ chainCreditId: creditId, adminId: ADMIN, note: "  refunded off-platform  " });

    const c = await prisma.chainCredit.findUniqueOrThrow({ where: { id: creditId } });
    expect(c.processingStatus).toBe("DISMISSED");
    expect(c.consumed).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetType: "ChainCredit", targetId: creditId, action: "chain_credit.dismissed" },
    });
    expect(audit.actorId).toBe(ADMIN);
    expect(audit.after).toMatchObject({
      note: "refunded off-platform",
      reviewReason: "NO_LIVE_DEPOSIT",
      normalizedAmountMinor: deposit.amountUsdtMinor,
      txHash: c.txHash,
    });

    await expect(
      dismissChainCredit({ chainCreditId: creditId, adminId: ADMIN, note: "again" }),
    ).rejects.toBeInstanceOf(ChainCreditResolutionRefused);

    const before = await liveBalance();
    await expect(
      resolveChainCreditToDeposit({ chainCreditId: creditId, depositId: deposit.id, adminId: ADMIN, ...config }),
    ).rejects.toBeInstanceOf(ChainCreditResolutionRefused);
    expect(await liveBalance()).toBe(before);
  });

  it("refuses an empty or over-long note", async () => {
    const creditId = await makeCredit(81_000);
    await expect(dismissChainCredit({ chainCreditId: creditId, adminId: ADMIN, note: "   " })).rejects.toBeInstanceOf(
      ChainCreditResolutionRefused,
    );
    await expect(
      dismissChainCredit({ chainCreditId: creditId, adminId: ADMIN, note: "x".repeat(501) }),
    ).rejects.toBeInstanceOf(ChainCreditResolutionRefused);
    const c = await prisma.chainCredit.findUniqueOrThrow({ where: { id: creditId } });
    expect(c.processingStatus).toBe("UNMATCHED");
    expect(c.consumed).toBe(false);
  });
});

describe("listCandidateDepositsForChainCredit", () => {
  it("orders by amount distance ascending (nulls last), filters by status/address/time window", async () => {
    const target = 90_000;
    const blockTimestamp = new Date();
    const creditId = await makeCredit(target, { blockTimestamp });

    // Park each deposit as EXPIRED before rewriting its amount, so the
    // rewritten amounts never touch the live-amount unique index.
    const withAmount = async (amount: number | null, extra: Partial<Deposit> = {}) => {
      const d = await makeUsdtDeposit(85_000, "EXPIRED");
      return prisma.deposit.update({
        where: { id: d.id },
        data: {
          amountUsdtMinor: amount,
          ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
          ...(extra.receivingAddress ? { receivingAddress: extra.receivingAddress } : {}),
          ...(extra.status ? { status: extra.status } : {}),
        },
      });
    };
    const far = await withAmount(target + 100); // distance 100
    const near = await withAmount(target - 5); // distance 5
    const mid = await withAmount(target + 10); // distance 10
    const noAmount = await withAmount(null); // null -> last
    const tooOld = await withAmount(target, { createdAt: new Date(blockTimestamp.getTime() - 49 * 3_600_000) });
    const otherAddress = await withAmount(target, { receivingAddress: "TSomeoneElsesWallet111111111111" });
    const completed = await withAmount(target, { status: "COMPLETED" });

    const list = await listCandidateDepositsForChainCredit(creditId, 200);
    const ids = list.map((d) => d.id);
    const ours = ids.filter((id) => [far.id, near.id, mid.id, noAmount.id].includes(id));
    expect(ours).toEqual([near.id, mid.id, far.id, noAmount.id]);
    expect(ids).not.toContain(tooOld.id);
    expect(ids).not.toContain(otherAddress.id);
    expect(ids).not.toContain(completed.id);

    const first = list.find((d) => d.id === near.id)!;
    expect(first.user.email).toMatch(/chain-admin-test/);
    expect(first.user).toHaveProperty("firstName");
    expect(first.user).toHaveProperty("lastName");

    // Default limit is 20.
    expect((await listCandidateDepositsForChainCredit(creditId)).length).toBeLessThanOrEqual(20);
  });
});

describe("listUsdtReviewQueue / countUsdtReviewQueue", () => {
  it("includes unconsumed MANUAL_REVIEW/UNMATCHED rows only", async () => {
    const future = new Date(Date.now() + 60_000); // newest first -> ours lead the list
    const unmatched = await makeCredit(91_000, { blockTimestamp: future });
    const review = await makeCredit(91_001, { blockTimestamp: future, processingStatus: "MANUAL_REVIEW" });
    const consumed = await makeCredit(91_002, { blockTimestamp: future, consumed: true });
    const dismissed = await makeCredit(91_003, { blockTimestamp: future, processingStatus: "DISMISSED", consumed: true });
    const matched = await makeCredit(91_004, { blockTimestamp: future, processingStatus: "MATCHED", consumed: true });
    const pending = await makeCredit(91_005, { blockTimestamp: future, processingStatus: "PENDING" });

    const ids = (await listUsdtReviewQueue(500)).map((c) => c.id);
    expect(ids).toContain(unmatched);
    expect(ids).toContain(review);
    for (const excluded of [consumed, dismissed, matched, pending]) {
      expect(ids).not.toContain(excluded);
    }

    const count = await countUsdtReviewQueue();
    expect(count).toBeGreaterThanOrEqual(2);
    const all = await prisma.chainCredit.count({
      where: { consumed: false, processingStatus: { in: ["MANUAL_REVIEW", "UNMATCHED"] } },
    });
    expect(count).toBe(all);
  });
});

const hexHash = () => randomBytes(32).toString("hex");

describe("listCandidateDepositsForChainCredit — user claims", () => {
  it("puts a deposit claiming this txHash first, even outside the 48h window", async () => {
    const target = 92_000;
    const blockTimestamp = new Date();
    const txHash = hexHash();
    const creditId = await makeCredit(target, { blockTimestamp, txHash });

    const near = await makeUsdtDeposit(85_000, "EXPIRED");
    await prisma.deposit.update({ where: { id: near.id }, data: { amountUsdtMinor: target } });

    // Far amount, created 72h before the transfer — outside the window.
    const claimant = await makeUsdtDeposit(85_000, "EXPIRED");
    await prisma.deposit.update({
      where: { id: claimant.id },
      data: { amountUsdtMinor: target + 5_000, createdAt: new Date(blockTimestamp.getTime() - 72 * 3_600_000) },
    });
    await claimUsdtPayment({ actorId: userId, depositId: claimant.id, txHash: `0x${txHash.toUpperCase()}` });

    // A resolved deposit claiming the same hash is still never a candidate.
    const resolved = await makeUsdtDeposit(85_000, "EXPIRED");
    await claimUsdtPayment({ actorId: userId, depositId: resolved.id, txHash });
    await prisma.deposit.update({ where: { id: resolved.id }, data: { status: "COMPLETED" } });

    const ids = (await listCandidateDepositsForChainCredit(creditId, 200)).map((d) => d.id);
    expect(ids[0]).toBe(claimant.id);
    expect(ids).toContain(near.id);
    expect(ids).not.toContain(resolved.id);
  });
});

describe("getUsdtReviewEvidence", () => {
  const otherUserIds: string[] = [];
  afterAll(async () => {
    // Deposits cascade with the user.
    await prisma.user.deleteMany({ where: { id: { in: otherUserIds } } });
  });

  async function otherUser(): Promise<{ id: string; email: string }> {
    const u = await prisma.user.create({
      data: { email: `chain-evidence-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    otherUserIds.push(u.id);
    return u;
  }

  async function usdtDepositFor(ownerId: string, requested: number): Promise<Deposit> {
    return createUsdtDepositIntent({
      userId: ownerId,
      amountUsdtMinorRequested: requested,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING_ADDRESS,
      correlationId: randomUUID(),
    });
  }

  /** A MATCHED credit from `from`, linked to a fresh COMPLETED deposit owned by `ownerId`. */
  async function paidFrom(from: string, ownerId: string): Promise<string> {
    const creditId = await makeCredit(1_234, {
      fromAddress: from,
      processingStatus: "MATCHED",
      consumed: true,
    });
    const d = await usdtDepositFor(ownerId, 60_000);
    await prisma.deposit.update({
      where: { id: d.id },
      data: { status: "COMPLETED", matchedChainCreditId: creditId },
    });
    return creditId;
  }

  it("returns every claim on the credit's hash (two different users both kept), newest first", async () => {
    const txHash = hexHash();
    const creditId = await makeCredit(93_000, { txHash });
    const alice = await otherUser();
    const bob = await otherUser();

    const aliceDeposit = await usdtDepositFor(alice.id, 40_000);
    const bobDeposit = await usdtDepositFor(bob.id, 41_000);
    await claimUsdtPayment({ actorId: alice.id, depositId: aliceDeposit.id, txHash });
    await claimUsdtPayment({
      actorId: bob.id,
      depositId: bobDeposit.id,
      txHash,
      screenshotUrl: "https://res.cloudinary.com/demo/image/upload/v1/deposits/b.png",
    });
    await prisma.deposit.update({ where: { id: aliceDeposit.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await prisma.deposit.update({ where: { id: bobDeposit.id }, data: { status: "EXPIRED" } });

    const evidence = await getUsdtReviewEvidence([creditId]);
    const claims = evidence[creditId]!.claims;
    expect(claims.map((c) => c.depositId)).toEqual([bobDeposit.id, aliceDeposit.id]);
    expect(claims[0]).toMatchObject({
      status: "EXPIRED",
      amountUsdtMinor: bobDeposit.amountUsdtMinor,
      screenshotUrl: "https://res.cloudinary.com/demo/image/upload/v1/deposits/b.png",
      user: { id: bob.id, email: bob.email },
    });
    expect(claims[1]!.user).toEqual({ id: alice.id, email: alice.email });
    expect(claims[1]!.screenshotUrl).toBeNull();
  });

  it("counts known senders from OTHER matched credits with the same fromAddress, most paid first", async () => {
    const from = `TSender-${randomUUID()}`;
    const carol = await otherUser();
    const dave = await otherUser();
    await paidFrom(from, carol.id);
    await paidFrom(from, carol.id);
    const daveCredit = await paidFrom(from, dave.id);
    // Not MATCHED -> ignored.
    await makeCredit(1_235, { fromAddress: from, processingStatus: "UNMATCHED" });

    const reviewed = await makeCredit(94_000, { fromAddress: from });
    const lonely = await makeCredit(94_001, { fromAddress: `TSender-${randomUUID()}` });
    const missing = randomUUID();

    const evidence = await getUsdtReviewEvidence([reviewed, daveCredit, lonely, missing]);

    expect(evidence[reviewed]!.knownSenders).toEqual([
      { userId: carol.id, email: carol.email, paidCount: 2 },
      { userId: dave.id, email: dave.email, paidCount: 1 },
    ]);
    // Dave's only payment IS this credit — excluded as not "other".
    expect(evidence[daveCredit]!.knownSenders).toEqual([
      { userId: carol.id, email: carol.email, paidCount: 2 },
    ]);
    expect(evidence[lonely]).toEqual({ claims: [], knownSenders: [] });
    expect(evidence[missing]).toEqual({ claims: [], knownSenders: [] });
    expect(evidence[reviewed]!.claims).toEqual([]);
  });

  it("returns an empty object for no ids", async () => {
    expect(await getUsdtReviewEvidence([])).toEqual({});
  });
});
