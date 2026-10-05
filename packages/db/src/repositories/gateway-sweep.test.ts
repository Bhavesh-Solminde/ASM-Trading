import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { GATEWAY_TATUM } from "./gateway-deposit";
import {
  listGatewaySweepCandidates,
  listOpenGatewaySweeps,
  startGatewaySweep,
  updateGatewaySweep,
} from "./gateway-sweep";

// A test-only network id so candidate queries never see real "tron"/"bsc" rows in a shared DB.
const NETWORK = `tron-sweep-test-${randomUUID().slice(0, 8)}`;
const OTHER_NETWORK = `${NETWORK}-other`;
const CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";

let userId = "";
let idx = 0;

async function deposit(status: "AWAITING_PAYMENT" | "PENDING_CONFIRMATION" | "COMPLETED" | "REJECTED" | "EXPIRED", network = NETWORK, gateway: string | null = GATEWAY_TATUM) {
  const i = ++idx;
  return prisma.deposit.create({
    data: {
      userId,
      method: "USDT",
      gateway,
      network,
      tokenContract: CONTRACT,
      receivingAddress: `TSweepAddr${i}-${randomUUID()}`,
      gatewayAddressIndex: gateway ? i : null,
      amountUsdtMinor: 2500,
      amountUsd: 25,
      amountInr: 0,
      vpa: "",
      checkoutToken: randomUUID(),
      correlationId: randomUUID(),
      expiresAt: new Date(Date.now() + 30 * 60_000),
      status,
    },
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `gateway-sweep-${randomUUID()}@test.local`, passwordHash: "x" } });
  userId = user.id;
});

afterAll(async () => {
  await prisma.gatewaySweep.deleteMany({ where: { deposit: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("listGatewaySweepCandidates", () => {
  it("returns only COMPLETED gateway deposits of the network by default, oldest index first", async () => {
    const completedA = await deposit("COMPLETED");
    const completedB = await deposit("COMPLETED");
    const expired = await deposit("EXPIRED");
    const rejected = await deposit("REJECTED");
    await deposit("AWAITING_PAYMENT");
    await deposit("PENDING_CONFIRMATION");
    await deposit("COMPLETED", OTHER_NETWORK);
    await deposit("COMPLETED", NETWORK, null); // manual-flow deposit: not ours to sweep

    const byDefault = await listGatewaySweepCandidates({ network: NETWORK, includeUnresolved: false });
    expect(byDefault.map((c) => c.depositId)).toEqual([completedA.id, completedB.id]);
    expect(byDefault[0]).toMatchObject({
      status: "COMPLETED",
      receivingAddress: completedA.receivingAddress,
      addressIndex: completedA.gatewayAddressIndex,
      tokenContract: CONTRACT,
    });

    const withUnresolved = await listGatewaySweepCandidates({ network: NETWORK, includeUnresolved: true });
    expect(withUnresolved.map((c) => c.depositId)).toEqual([completedA.id, completedB.id, expired.id, rejected.id]);
  });

  it("never offers live deposits, even with includeUnresolved", async () => {
    const all = await listGatewaySweepCandidates({ network: NETWORK, includeUnresolved: true });
    expect(all.every((c) => c.status !== "AWAITING_PAYMENT" && c.status !== "PENDING_CONFIRMATION")).toBe(true);
  });
});

describe("GatewaySweep rows", () => {
  it("walks PENDING -> GAS_SENT -> SUBMITTED -> CONFIRMED and keeps amounts exact", async () => {
    const d = await deposit("COMPLETED");
    const raw = 123_456_789_012_345_678_901n; // > int8, BSC 18-dp scale
    const row = await startGatewaySweep({
      depositId: d.id,
      network: NETWORK,
      fromAddress: d.receivingAddress!,
      toAddress: "TTreasury",
      tokenContract: CONTRACT,
      tokenDecimals: 18,
      rawAmount: raw,
    });
    expect(row.status).toBe("PENDING");
    expect(BigInt(row.rawAmount.toFixed(0))).toBe(raw);

    await updateGatewaySweep(row.id, { status: "GAS_SENT", gasTopUpTxHash: "aa".repeat(32), gasTopUpRaw: 7_500_000n });
    await updateGatewaySweep(row.id, { status: "SUBMITTED", sweepTxHash: "bb".repeat(32) });
    expect((await listOpenGatewaySweeps(NETWORK)).map((r) => r.id)).toContain(row.id);

    const done = await updateGatewaySweep(row.id, { status: "CONFIRMED" });
    expect(done).toMatchObject({ status: "CONFIRMED", gasTopUpTxHash: "aa".repeat(32), sweepTxHash: "bb".repeat(32) });
    expect(BigInt(done.gasTopUpRaw!.toFixed(0))).toBe(7_500_000n);
    expect((await listOpenGatewaySweeps(NETWORK)).map((r) => r.id)).not.toContain(row.id);
  });

  it("records FAILED with the error, and open rows are scoped to the network", async () => {
    const d = await deposit("COMPLETED");
    const base = { depositId: d.id, fromAddress: d.receivingAddress!, toAddress: "TTreasury", tokenContract: CONTRACT, tokenDecimals: 6, rawAmount: 1n };
    const failed = await startGatewaySweep({ ...base, network: NETWORK });
    const other = await startGatewaySweep({ ...base, network: OTHER_NETWORK });

    const row = await updateGatewaySweep(failed.id, { status: "FAILED", error: "boom" });
    expect(row).toMatchObject({ status: "FAILED", error: "boom" });

    const open = (await listOpenGatewaySweeps(NETWORK)).map((r) => r.id);
    expect(open).not.toContain(failed.id);
    expect(open).not.toContain(other.id);
    expect((await listOpenGatewaySweeps(OTHER_NETWORK)).map((r) => r.id)).toEqual([other.id]);
  });
});
