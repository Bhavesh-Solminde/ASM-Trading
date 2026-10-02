import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@asm/db";
import { runEvmFinalityTick } from "./evm-finality";
import { REORG_MIN_CONSECUTIVE_CHECKS, REORG_MIN_ELAPSED_MS } from "./finality";
import { TRANSFER_TOPIC } from "./evm-codec";
import type { EvmChainProvider, EvmReceipt } from "./types";

const hex = (bytes: number) => `0x${randomBytes(bytes).toString("hex")}`;
const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`;
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const VALUE = 25n * 10n ** 18n + 5n * 10n ** 16n; // 25.05 USDT, 18dp

const usedContracts: string[] = [];

function scope() {
  const tokenContract = hex(20);
  usedContracts.push(tokenContract);
  return { network: "bsc", tokenContract, receivingAddress: hex(20) };
}
type Scope = ReturnType<typeof scope>;

async function seed(s: Scope, overrides: Partial<Parameters<typeof prisma.chainCredit.create>[0]["data"]> = {}) {
  return prisma.chainCredit.create({
    data: {
      network: s.network,
      tokenContract: s.tokenContract,
      txHash: hex(32),
      eventIndex: 4,
      fromAddress: hex(20),
      toAddress: s.receivingAddress,
      rawAmount: VALUE.toString(),
      tokenDecimals: 18,
      normalizedAmountMinor: 2505,
      blockNumber: 900n,
      blockTimestamp: new Date(),
      finalityState: "DETECTED",
      rawPayload: {},
      ...overrides,
    },
  });
}

function receipt(s: Scope, overrides: Partial<EvmReceipt> = {}, log: Partial<{ logIndex: number; value: bigint; to: string; contract: string }> = {}): EvmReceipt {
  return {
    status: 1,
    blockNumber: 900n,
    logs: [
      { logIndex: 0, address: hex(20), topics: [hex(32)], data: "0x" }, // unrelated log in the same tx
      {
        logIndex: log.logIndex ?? 4,
        address: log.contract ?? s.tokenContract,
        topics: [TRANSFER_TOPIC, pad(hex(20)), pad(log.to ?? s.receivingAddress)],
        data: word(log.value ?? VALUE),
      },
    ],
    ...overrides,
  };
}

function provider(overrides: Partial<EvmChainProvider> = {}) {
  return {
    getChainId: vi.fn(async () => 97),
    getTokenDecimals: vi.fn(async () => 18),
    getLatestBlockNumber: vi.fn(async () => 1000n),
    getFinalizedBlockNumber: vi.fn(async () => 990n),
    getTransferLogs: vi.fn(async () => []),
    getBlockTimestampMs: vi.fn(async () => Date.now()),
    getReceipt: vi.fn(async (): Promise<EvmReceipt | null> => null),
    ...overrides,
  } satisfies EvmChainProvider;
}

const reload = (id: string) => prisma.chainCredit.findUniqueOrThrow({ where: { id } });

afterEach(async () => {
  const contracts = usedContracts.splice(0);
  await prisma.chainCredit.deleteMany({ where: { tokenContract: { in: contracts } } });
});

describe("runEvmFinalityTick", () => {
  it("FINAL: finalized, successful receipt with a matching Transfer at eventIndex", async () => {
    const s = scope();
    const credit = await seed(s);
    const p = provider({ getReceipt: vi.fn(async () => receipt(s)) });

    const result = await runEvmFinalityTick(p, s);
    expect(result).toMatchObject({ checked: 1, finalized: 1 });
    expect((await reload(credit.id)).finalityState).toBe("FINAL");
  });

  it("FAILED_ON_CHAIN: finalized receipt with status 0", async () => {
    const s = scope();
    const credit = await seed(s);
    const p = provider({ getReceipt: vi.fn(async () => receipt(s, { status: 0, logs: [] })) });

    const result = await runEvmFinalityTick(p, s);
    expect(result.failedOnChain).toBe(1);
    expect((await reload(credit.id)).finalityState).toBe("FAILED_ON_CHAIN");
  });

  it("not yet finalized → CONFIRMING, and the missing-receipt streak resets", async () => {
    const s = scope();
    const credit = await seed(s, { checkAttempts: 2, firstNotFoundAt: new Date(Date.now() - 60_000) });
    const p = provider({ getReceipt: vi.fn(async () => receipt(s, { blockNumber: 995n })) });

    const result = await runEvmFinalityTick(p, s);
    expect(result.stillPending).toBe(1);
    const updated = await reload(credit.id);
    expect(updated.finalityState).toBe("CONFIRMING");
    expect(updated.checkAttempts).toBe(0);
    expect(updated.firstNotFoundAt).toBeNull();
  });

  it("finalized but no Transfer at that log index → REORGED", async () => {
    const s = scope();
    const credit = await seed(s);
    const p = provider({ getReceipt: vi.fn(async () => receipt(s, {}, { logIndex: 5 })) });

    const result = await runEvmFinalityTick(p, s);
    expect(result.reorged).toBe(1);
    expect((await reload(credit.id)).finalityState).toBe("REORGED");
  });

  it("finalized log at that index with a different value, destination or contract → REORGED, never FINAL", async () => {
    const s = scope();
    const a = await seed(s);
    const b = await seed(s);
    const c = await seed(s);
    const receipts = new Map<string, EvmReceipt>([
      [a.txHash, receipt(s, {}, { value: VALUE + 1n })],
      [b.txHash, receipt(s, {}, { to: hex(20) })],
      [c.txHash, receipt(s, {}, { contract: hex(20) })],
    ]);
    const p = provider({ getReceipt: vi.fn(async (tx: string) => receipts.get(tx) ?? null) });

    const result = await runEvmFinalityTick(p, s);
    expect(result.reorged).toBe(3);
    for (const credit of [a, b, c]) expect((await reload(credit.id)).finalityState).toBe("REORGED");
  });

  it("receipt missing: the first observation only starts the streak", async () => {
    const s = scope();
    const credit = await seed(s);
    const p = provider();

    const result = await runEvmFinalityTick(p, s);
    expect(result.reorged).toBe(0);
    const updated = await reload(credit.id);
    expect(updated.finalityState).toBe("DETECTED");
    expect(updated.checkAttempts).toBe(1);
    expect(updated.firstNotFoundAt).not.toBeNull();
  });

  it("receipt missing: enough checks but under 10 minutes → not REORGED", async () => {
    const s = scope();
    const now = Date.now();
    const credit = await seed(s, {
      checkAttempts: REORG_MIN_CONSECUTIVE_CHECKS - 1,
      firstNotFoundAt: new Date(now - (REORG_MIN_ELAPSED_MS - 1000)),
    });

    const result = await runEvmFinalityTick(provider(), s, 200, now);
    expect(result.reorged).toBe(0);
    expect((await reload(credit.id)).finalityState).toBe("DETECTED");
  });

  it("receipt missing: >= 3 consecutive checks AND >= 10 minutes → REORGED", async () => {
    const s = scope();
    const now = Date.now();
    const credit = await seed(s, {
      checkAttempts: REORG_MIN_CONSECUTIVE_CHECKS - 1,
      firstNotFoundAt: new Date(now - REORG_MIN_ELAPSED_MS - 1000),
    });

    const result = await runEvmFinalityTick(provider(), s, 200, now);
    expect(result.reorged).toBe(1);
    expect((await reload(credit.id)).finalityState).toBe("REORGED");
  });

  it("provider errors never change state", async () => {
    const s = scope();
    const credit = await seed(s, { finalityState: "CONFIRMING", checkAttempts: 1 });

    const r1 = await runEvmFinalityTick(provider({ getReceipt: vi.fn().mockRejectedValue(new Error("HTTP 429")) }), s);
    expect(r1.providerErrors).toBe(1);
    const r2 = await runEvmFinalityTick(provider({ getFinalizedBlockNumber: vi.fn().mockRejectedValue(new Error("down")) }), s);
    expect(r2.providerErrors).toBe(1);

    const updated = await reload(credit.id);
    expect(updated.finalityState).toBe("CONFIRMING");
    expect(updated.checkAttempts).toBe(1);
  });

  it("never touches a TRON row, even one sharing the same contract string", async () => {
    const s = scope();
    const tron = await seed({ ...s, network: "tron" }, { rawAmount: "25050000", tokenDecimals: 6 });
    const p = provider({ getReceipt: vi.fn(async () => receipt(s)) });

    const result = await runEvmFinalityTick(p, s);
    expect(result.checked).toBe(0);
    expect(p.getReceipt).not.toHaveBeenCalled();
    expect(p.getFinalizedBlockNumber).not.toHaveBeenCalled(); // nothing to check → no RPC at all
    const unchanged = await reload(tron.id);
    expect(unchanged.finalityState).toBe("DETECTED");
    expect(unchanged.lastCheckedAt).toBeNull();
  });

  it("is idempotent — a FINAL row is never re-checked", async () => {
    const s = scope();
    await seed(s, { finalityState: "FINAL" });
    const p = provider({ getReceipt: vi.fn(async () => receipt(s, { status: 0 })) });

    const result = await runEvmFinalityTick(p, s);
    expect(result.checked).toBe(0);
  });
});
