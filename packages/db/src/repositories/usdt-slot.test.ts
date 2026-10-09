import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import { USDT_SLOT_GAP_MS, UsdtSlotBusy, createUsdtSlotDepositIntent } from "./deposit";
import { matchChainCreditToDeposit, withinSlotTolerance } from "./chain-credit-matcher";

const NETWORK = "tron";
const CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const userIds: string[] = [];
const creditIds: string[] = [];

/** A fresh, never-before-used receiving address, so tests never share a slot. */
function addr(): string {
  return `T${randomUUID().replace(/-/g, "")}`.slice(0, 34);
}

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({ data: { email: `usdt-slot-${randomUUID()}@test.local`, passwordHash: "x" } });
  await createAccountsForUser(user.id, 0);
  userIds.push(user.id);
  return user.id;
}

function slot(userId: string, receivingAddresses: string[], amountUsdtMinorRequested = 2_500, senderAddress?: string) {
  return createUsdtSlotDepositIntent({
    userId,
    amountUsdtMinorRequested,
    network: NETWORK,
    tokenContract: CONTRACT,
    receivingAddresses,
    senderAddress: senderAddress ?? null,
    correlationId: randomUUID(),
  });
}

/** A FINAL, PENDING ChainCredit — what ingestion + finality would have produced. */
async function credit(amountUsdtMinor: number, toAddress: string, blockTimestamp: Date, fromAddress = addr()): Promise<string> {
  const row = await prisma.chainCredit.create({
    data: {
      network: NETWORK,
      tokenContract: CONTRACT,
      txHash: `tx-${randomUUID()}`,
      eventIndex: 0,
      fromAddress,
      toAddress,
      rawAmount: (BigInt(amountUsdtMinor) * 10_000n).toString(),
      normalizedAmountMinor: amountUsdtMinor,
      blockNumber: 1_000_000n,
      blockTimestamp,
      finalityState: "FINAL",
      rawPayload: {},
    },
  });
  creditIds.push(row.id);
  return row.id;
}

function match(chainCreditId: string, receivingAddress: string) {
  return matchChainCreditToDeposit({
    chainCreditId,
    expectedNetwork: NETWORK,
    expectedTokenContract: CONTRACT,
    expectedReceivingAddresses: [receivingAddress],
  });
}

const inWindow = (d: { createdAt: Date }) => new Date(d.createdAt.getTime() + 1_000);

beforeAll(() => {
  expect(USDT_SLOT_GAP_MS).toBe(2 * 60_000);
});

afterAll(async () => {
  await prisma.chainCredit.deleteMany({ where: { id: { in: creditIds } } });
  await prisma.transaction.deleteMany({ where: { account: { userId: { in: userIds } } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId: { in: userIds } } } });
  await prisma.deposit.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("createUsdtSlotDepositIntent", () => {
  it("gives each user a free address with their own round amount, and tells the next one when an address frees", async () => {
    const [a1, a2] = [addr(), addr()];
    const [alice, bob, carol] = [await makeUser(), await makeUser(), await makeUser()];

    const da = await slot(alice, [a1, a2]);
    const db = await slot(bob, [a1, a2]);
    expect([da.receivingAddress, db.receivingAddress]).toEqual([a1, a2]);
    // Same $25.00 for both — no unique cents.
    expect([da.amountUsdtMinor, db.amountUsdtMinor]).toEqual([2_500, 2_500]);
    expect(da).toMatchObject({ usdtMatch: "SLOT", status: "AWAITING_PAYMENT" });
    expect(da.expiresAt.getTime() - da.createdAt.getTime()).toBeGreaterThanOrEqual(5 * 60_000 - 5);

    const busy = await slot(carol, [a1, a2]).catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(UsdtSlotBusy);
    expect((busy as UsdtSlotBusy).retryAt.getTime()).toBe(Math.min(da.expiresAt.getTime(), db.expiresAt.getTime()) + USDT_SLOT_GAP_MS);
  });

  it("replaces the user's own open slot on the same address instead of blocking them", async () => {
    const a1 = addr();
    const alice = await makeUser();
    const first = await slot(alice, [a1], 2_500);
    const second = await slot(alice, [a1], 4_000);

    expect(second.receivingAddress).toBe(a1);
    const old = await prisma.deposit.findUniqueOrThrow({ where: { id: first.id } });
    // Closed, but still AWAITING_PAYMENT: a payment already sent inside its window is still its own.
    expect(old.status).toBe("AWAITING_PAYMENT");
    expect(old.expiresAt.getTime()).toBeLessThan(second.createdAt.getTime());
  });

  it("holds an unpaid slot's address for the 2-minute gap, and frees a credited one at once", async () => {
    const a1 = addr();
    const [alice, bob, carol] = [await makeUser(), await makeUser(), await makeUser()];

    const da = await slot(alice, [a1]);
    await prisma.deposit.update({ where: { id: da.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(slot(bob, [a1])).rejects.toBeInstanceOf(UsdtSlotBusy);

    await prisma.deposit.update({ where: { id: da.id }, data: { expiresAt: new Date(Date.now() - 3 * 60_000) } });
    const db = await slot(bob, [a1]);
    expect(db.receivingAddress).toBe(a1);

    await prisma.deposit.update({ where: { id: db.id }, data: { status: "COMPLETED" } });
    expect((await slot(carol, [a1])).receivingAddress).toBe(a1);
  });

  it("never hands the same address to two simultaneous requests", async () => {
    const a1 = addr();
    const [alice, bob] = [await makeUser(), await makeUser()];
    const results = await Promise.allSettled([slot(alice, [a1]), slot(bob, [a1])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(UsdtSlotBusy);
  });
});

describe("matching a slot deposit", () => {
  it("accepts amounts within ±3% of the request, edges included", () => {
    expect(withinSlotTolerance(970, 1_000)).toBe(true);
    expect(withinSlotTolerance(1_030, 1_000)).toBe(true);
    expect(withinSlotTolerance(969, 1_000)).toBe(false);
    expect(withinSlotTolerance(1_031, 1_000)).toBe(false);
  });

  it("credits the amount actually received when it is within ±3%", async () => {
    const a1 = addr();
    const d = await slot(await makeUser(), [a1], 1_000);
    const outcome = await match(await credit(970, a1, inWindow(d)), a1);
    expect(outcome).toEqual({ kind: "auto_approved", depositId: d.id });
    const after = await prisma.deposit.findUniqueOrThrow({ where: { id: d.id } });
    expect(after).toMatchObject({ status: "COMPLETED", amountUsdtMinor: 970 });
  });

  it("sends a payment more than 3% off to admin review and keeps the slot open for the real payment", async () => {
    const a1 = addr();
    const d = await slot(await makeUser(), [a1], 1_000);

    // e.g. TRON address-poisoning dust from a look-alike address.
    const dust = await credit(1, a1, inWindow(d));
    expect(await match(dust, a1)).toEqual({ kind: "manual_review", reason: "slot_review", depositId: d.id });
    expect(await prisma.chainCredit.findUniqueOrThrow({ where: { id: dust } })).toMatchObject({
      processingStatus: "MANUAL_REVIEW",
      reviewReason: "SLOT_AMOUNT_MISMATCH",
    });
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("AWAITING_PAYMENT");

    const real = await credit(1_000, a1, inWindow(d));
    expect(await match(real, a1)).toEqual({ kind: "auto_approved", depositId: d.id });
  });

  it("credits any amount that comes from the wallet the user entered", async () => {
    const [a1, wallet] = [addr(), addr()];
    const d = await slot(await makeUser(), [a1], 2_500, wallet);
    const outcome = await match(await credit(1_200, a1, inWindow(d), wallet), a1);
    expect(outcome).toEqual({ kind: "auto_approved", depositId: d.id });
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: d.id } })).amountUsdtMinor).toBe(1_200);
  });

  it("sends an above-maximum payment to review even from the user's wallet", async () => {
    const [a1, wallet] = [addr(), addr()];
    const d = await slot(await makeUser(), [a1], 2_500, wallet);
    const c = await credit(2_000_000, a1, inWindow(d), wallet);
    expect(await match(c, a1)).toEqual({ kind: "manual_review", reason: "slot_review", depositId: d.id });
    expect((await prisma.chainCredit.findUniqueOrThrow({ where: { id: c } })).reviewReason).toBe("ABOVE_MAXIMUM");
  });

  it("never gives a slot a transfer from outside its window, even at the exact amount", async () => {
    const a1 = addr();
    const d = await slot(await makeUser(), [a1], 1_000);
    const before = await credit(1_000, a1, new Date(d.createdAt.getTime() - 60_000));
    expect(await match(before, a1)).toEqual({ kind: "unmatched" });
    const after = await credit(1_000, a1, new Date(d.expiresAt.getTime() + 1_000));
    expect(await match(after, a1)).toEqual({ kind: "unmatched" });
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("AWAITING_PAYMENT");
  });
});
