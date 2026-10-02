import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import {
  DISPLAY_LOOKUP_SLACK_MS,
  createChainCreditIfNew,
  findChainCreditForDepositDisplay,
  listOrphanChainCredits,
  listPendingFinalityChecks,
  listPendingMatches,
} from "./chain-credit";

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
    tokenDecimals: 6,
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
    expect(BigInt(credit!.rawAmount.toFixed(0))).toBe(100_000_001n);
    expect(credit!.tokenDecimals).toBe(6);
  });

  it("round-trips an 18-decimal amount far above the int8 range exactly (1,000,000 USDT on BSC)", async () => {
    const raw = 1_000_000n * 10n ** 18n; // 1e24 — int8 tops out at ~9.2e18
    const created = await createChainCreditIfNew(
      input({
        network: "bsc",
        tokenContract: `0xtest${randomUUID().replace(/-/g, "")}`,
        txHash: `0x${randomUUID().replace(/-/g, "")}`,
        rawAmount: raw,
        tokenDecimals: 18,
      }),
    );
    createdIds.push(created!.id);
    expect(created!.tokenDecimals).toBe(18);
    expect(created!.normalizedAmountMinor).toBe(100_000_000); // $1,000,000.00
    expect(created!.processingStatus).toBe("PENDING");

    const row = await prisma.chainCredit.findUniqueOrThrow({ where: { id: created!.id } });
    expect(BigInt(row.rawAmount.toFixed(0))).toBe(raw);
    expect(row.rawAmount.toFixed(0)).toBe("1000000000000000000000000");
  });

  it("an 18-decimal sub-cent amount -> null normalized amount, manual review, raw value kept exactly", async () => {
    const raw = 25_260_000_000_000_000_001n;
    const created = await createChainCreditIfNew(
      input({ network: "bsc", tokenContract: `0xtest${randomUUID().replace(/-/g, "")}`, rawAmount: raw, tokenDecimals: 18 }),
    );
    createdIds.push(created!.id);
    expect(created!.normalizedAmountMinor).toBeNull();
    expect(created!.reviewReason).toBe("PRECISION_NOT_REPRESENTABLE");
    expect(BigInt(created!.rawAmount.toFixed(0))).toBe(raw);
  });

  it("rejects tokenDecimals < 2 before writing anything", async () => {
    const txHash = `bad-decimals-${randomUUID()}`;
    await expect(createChainCreditIfNew(input({ txHash, tokenDecimals: 1 }))).rejects.toThrow(/>= 2/);
    expect(await prisma.chainCredit.findFirst({ where: { txHash } })).toBeNull();
  });
});

describe("listPendingFinalityChecks / listPendingMatches scoping", () => {
  // One unique fake contract shared by a "tron" and a "bsc" row, plus a
  // second fake contract on "tron", so only network OR contract differs.
  const contractA = `TEST-SCOPE-A-${randomUUID()}`;
  const contractB = `TEST-SCOPE-B-${randomUUID()}`;

  async function make(network: string, tokenContract: string, state: "DETECTED" | "FINAL"): Promise<string> {
    const c = await createChainCreditIfNew(
      input({ network, tokenContract, tokenDecimals: network === "bsc" ? 18 : 6, rawAmount: network === "bsc" ? 10n ** 18n : 1_000_000n }),
    );
    createdIds.push(c!.id);
    if (state === "FINAL") {
      await prisma.chainCredit.update({ where: { id: c!.id }, data: { finalityState: "FINAL" } });
    }
    return c!.id;
  }

  it("never returns a bsc row for a tron scope, nor a tron row for a bsc scope, nor another contract's row", async () => {
    const tronPending = await make("tron", contractA, "DETECTED");
    const bscPending = await make("bsc", contractA, "DETECTED");
    const otherContractPending = await make("tron", contractB, "DETECTED");
    const tronFinal = await make("tron", contractA, "FINAL");
    const bscFinal = await make("bsc", contractA, "FINAL");
    const otherContractFinal = await make("tron", contractB, "FINAL");

    const tronChecks = (await listPendingFinalityChecks(500, { network: "tron", tokenContract: contractA })).map((c) => c.id);
    expect(tronChecks).toEqual([tronPending]);
    const bscChecks = (await listPendingFinalityChecks(500, { network: "bsc", tokenContract: contractA })).map((c) => c.id);
    expect(bscChecks).toEqual([bscPending]);
    const otherChecks = (await listPendingFinalityChecks(500, { network: "tron", tokenContract: contractB })).map((c) => c.id);
    expect(otherChecks).toEqual([otherContractPending]);

    const tronMatches = (await listPendingMatches(500, { network: "tron", tokenContract: contractA })).map((c) => c.id);
    expect(tronMatches).toEqual([tronFinal]);
    const bscMatches = (await listPendingMatches(500, { network: "bsc", tokenContract: contractA })).map((c) => c.id);
    expect(bscMatches).toEqual([bscFinal]);
    const otherMatches = (await listPendingMatches(500, { network: "tron", tokenContract: contractB })).map((c) => c.id);
    expect(otherMatches).toEqual([otherContractFinal]);
  });

  it("throws rather than silently widening when the scope is missing or empty", async () => {
    await expect(listPendingFinalityChecks(10, undefined as never)).rejects.toThrow(/scope is required/);
    await expect(listPendingMatches(10, { network: "tron", tokenContract: "" })).rejects.toThrow(/scope is required/);
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

describe("findChainCreditForDepositDisplay", () => {
  it("finds the transfer with the exact amount/destination, and ignores one from before the deposit existed", async () => {
    const toAddress = `TDisplay${randomUUID().slice(0, 8)}`;
    const depositCreatedAt = new Date();

    const stale = await createChainCreditIfNew(
      input({
        toAddress,
        rawAmount: 25_940_000n,
        blockTimestamp: new Date(depositCreatedAt.getTime() - DISPLAY_LOOKUP_SLACK_MS - 60_000),
      }),
    );
    createdIds.push(stale!.id);

    const lookup = {
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: toAddress,
      amountUsdtMinor: 2594,
      depositCreatedAt,
    };
    expect(await findChainCreditForDepositDisplay(lookup)).toBeNull();

    const wrongAmount = await createChainCreditIfNew(input({ toAddress, rawAmount: 25_950_000n }));
    createdIds.push(wrongAmount!.id);
    expect(await findChainCreditForDepositDisplay(lookup)).toBeNull();

    const real = await createChainCreditIfNew(input({ toAddress, rawAmount: 25_940_000n }));
    createdIds.push(real!.id);
    expect((await findChainCreditForDepositDisplay(lookup))?.id).toBe(real!.id);
  });
});
