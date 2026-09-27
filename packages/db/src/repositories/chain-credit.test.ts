import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createChainCreditIfNew, listOrphanChainCredits } from "./chain-credit";

const NETWORK = "tron";
const CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const createdIds: string[] = [];

function input(overrides: Partial<Parameters<typeof createChainCreditIfNew>[0]> = {}) {
  return {
    network: NETWORK,
    tokenContract: CONTRACT,
    txHash: `tx-${randomUUID()}`,
    eventIndex: 0,
    fromAddress: "TFromAddress111111111111111111111",
    toAddress: "TToAddress1111111111111111111111",
    rawAmount: 100_000_000n,
    blockNumber: 1_000_000n,
    blockTimestamp: new Date(),
    rawPayload: { note: "test" },
    ...overrides,
  };
}

afterAll(async () => {
  await prisma.chainCredit.deleteMany({ where: { id: { in: createdIds } } });
});

describe("createChainCreditIfNew", () => {
  it("creates a credit for a new (network, tokenContract, txHash, eventIndex)", async () => {
    const credit = await createChainCreditIfNew(input());
    expect(credit).not.toBeNull();
    createdIds.push(credit!.id);
    expect(credit!.consumed).toBe(false);
    expect(credit!.finalityState).toBe("DETECTED");
    expect(credit!.processingStatus).toBe("PENDING");
    // 100_000_000 raw / 10_000 = 10_000 USDT-cents = $100.00
    expect(credit!.normalizedAmountMinor).toBe(10_000);
  });

  it("returns null rather than throwing on a duplicate (network, tokenContract, txHash, eventIndex)", async () => {
    const txHash = `dup-${randomUUID()}`;
    const first = await createChainCreditIfNew(input({ txHash }));
    createdIds.push(first!.id);

    const second = await createChainCreditIfNew(input({ txHash }));
    expect(second).toBeNull();
  });

  it("allows the SAME txHash at a DIFFERENT eventIndex — multiple Transfer events in one transaction are distinct rows", async () => {
    const txHash = `multi-${randomUUID()}`;
    const first = await createChainCreditIfNew(input({ txHash, eventIndex: 0 }));
    createdIds.push(first!.id);

    const second = await createChainCreditIfNew(input({ txHash, eventIndex: 1 }));
    expect(second).not.toBeNull();
    createdIds.push(second!.id);
    expect(second!.id).not.toBe(first!.id);
  });

  it("stores a null normalizedAmountMinor and routes to manual review when the raw amount has genuine sub-cent on-chain precision — never rounds", async () => {
    const credit = await createChainCreditIfNew(input({ rawAmount: 100_000_001n }));
    createdIds.push(credit!.id);
    expect(credit!.normalizedAmountMinor).toBeNull();
    expect(credit!.processingStatus).toBe("MANUAL_REVIEW");
    expect(credit!.reviewReason).toBe("PRECISION_NOT_REPRESENTABLE");
    // The lossless raw value is still there for the admin to see.
    expect(credit!.rawAmount).toBe(100_000_001n);
  });
});

describe("listOrphanChainCredits", () => {
  it("lists only UNMATCHED credits", async () => {
    const unmatched = await createChainCreditIfNew(input());
    createdIds.push(unmatched!.id);
    await prisma.chainCredit.update({
      where: { id: unmatched!.id },
      data: { processingStatus: "UNMATCHED", reviewReason: "NO_LIVE_DEPOSIT" },
    });

    const matched = await createChainCreditIfNew(input());
    createdIds.push(matched!.id);
    await prisma.chainCredit.update({
      where: { id: matched!.id },
      data: { processingStatus: "MATCHED", consumed: true },
    });

    const found = await listOrphanChainCredits(200);
    const foundIds = found.map((c) => c.id);
    expect(foundIds).toContain(unmatched!.id);
    expect(foundIds).not.toContain(matched!.id);
  });
});
