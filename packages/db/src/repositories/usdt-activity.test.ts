import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import { createUsdtDepositIntent } from "./deposit";
import { hasActiveUsdtWork } from "./usdt-activity";

const NETWORK = "tron";
const GRACE_MS = 15 * 60_000;
let userId = "";
const creditIds: string[] = [];

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `activity-${randomUUID()}@test.local`, passwordHash: "x" } });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.chainCredit.deleteMany({ where: { id: { in: creditIds } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

/** Each test gets its own fake contract/address, so the shared dev DB never leaks in. */
function scope() {
  return { network: NETWORK, tokenContract: `TActContract-${randomUUID()}`, receivingAddress: `TActRecv-${randomUUID()}` };
}

function check(s: ReturnType<typeof scope>, includePendingMatches = true) {
  return hasActiveUsdtWork({ ...s, now: new Date(), lateGraceMs: GRACE_MS, includePendingMatches });
}

async function openDeposit(s: ReturnType<typeof scope>) {
  return createUsdtDepositIntent({
    userId,
    amountUsdtMinorRequested: 3_000,
    network: s.network,
    tokenContract: s.tokenContract,
    receivingAddress: s.receivingAddress,
    correlationId: randomUUID(),
  });
}

async function credit(s: ReturnType<typeof scope>, finalityState: "DETECTED" | "FINAL", processingStatus: "PENDING" | "MATCHED") {
  const c = await prisma.chainCredit.create({
    data: {
      network: s.network,
      tokenContract: s.tokenContract,
      txHash: `tx-${randomUUID()}`,
      eventIndex: 0,
      fromAddress: "TActSender",
      toAddress: s.receivingAddress,
      rawAmount: "10000000",
      normalizedAmountMinor: 1_000,
      blockNumber: 1n,
      blockTimestamp: new Date(),
      finalityState,
      processingStatus,
      rawPayload: {},
    },
  });
  creditIds.push(c.id);
}

describe("hasActiveUsdtWork", () => {
  it("is false when nothing is happening for this watcher's address", async () => {
    expect(await check(scope())).toBe(false);
  });

  it("is true while a deposit window is open", async () => {
    const s = scope();
    await openDeposit(s);
    expect(await check(s)).toBe(true);
  });

  it("stays true for a while after the window closes (late payments), then goes quiet", async () => {
    const s = scope();
    const d = await openDeposit(s);
    await prisma.deposit.update({ where: { id: d.id }, data: { expiresAt: new Date(Date.now() - 5 * 60_000) } });
    expect(await check(s)).toBe(true);
    await prisma.deposit.update({ where: { id: d.id }, data: { expiresAt: new Date(Date.now() - GRACE_MS - 60_000) } });
    expect(await check(s)).toBe(false);
  });

  it("ignores a completed deposit", async () => {
    const s = scope();
    const d = await openDeposit(s);
    await prisma.deposit.update({ where: { id: d.id }, data: { status: "COMPLETED" } });
    expect(await check(s)).toBe(false);
  });

  it("is true while a transfer is still being confirmed", async () => {
    const s = scope();
    await credit(s, "DETECTED", "PENDING");
    expect(await check(s)).toBe(true);
  });

  it("counts a FINAL transfer awaiting a match only when the match stage runs", async () => {
    const s = scope();
    await credit(s, "FINAL", "PENDING");
    expect(await check(s, true)).toBe(true);
    expect(await check(s, false)).toBe(false);
  });

  it("ignores already-matched transfers and other addresses", async () => {
    const s = scope();
    await credit(s, "FINAL", "MATCHED");
    await openDeposit(scope());
    expect(await check(s)).toBe(false);
  });
});
