import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@asm/db";
import { runEvmIngestTick, type EvmIngestConfig } from "./evm-ingest";
import type { EvmChainProvider, EvmTransferLog } from "./types";

const hex = (bytes: number) => `0x${randomBytes(bytes).toString("hex")}`;
const USDT = 10n ** 18n;

// Every test uses its own fake lowercase contract/address; cleanup is by those only.
const usedContracts: string[] = [];

function config(overrides: Partial<EvmIngestConfig> = {}): EvmIngestConfig {
  const tokenContract = hex(20);
  usedContracts.push(tokenContract);
  return {
    network: "bsc",
    tokenContract,
    receivingAddress: hex(20),
    tokenDecimals: 18,
    maxBlockRange: 2000,
    initialLookbackBlocks: 100,
    maxChunksPerTick: 25,
    ...overrides,
  };
}

function log(cfg: EvmIngestConfig, overrides: Partial<EvmTransferLog> = {}): EvmTransferLog {
  return {
    txHash: hex(32),
    logIndex: 7,
    blockNumber: 950n,
    fromAddress: hex(20),
    toAddress: cfg.receivingAddress,
    rawValue: 12n * USDT + 34n * 10n ** 16n, // 12.34 USDT
    removed: false,
    ...overrides,
  };
}

/** Logs are served only when their block lies inside the requested range — like a real node. */
function provider(logs: EvmTransferLog[], overrides: Partial<EvmChainProvider> = {}) {
  return {
    getChainId: vi.fn(async () => 97),
    getTokenDecimals: vi.fn(async () => 18),
    getLatestBlockNumber: vi.fn(async () => 1000n),
    getFinalizedBlockNumber: vi.fn(async () => 990n),
    getTransferLogs: vi.fn(async (p: { fromBlock: bigint; toBlock: bigint }) =>
      logs.filter((l) => l.blockNumber >= p.fromBlock && l.blockNumber <= p.toBlock),
    ),
    getBlockTimestampMs: vi.fn(async (n: bigint) => 1_700_000_000_000 + Number(n) * 1000),
    getReceipt: vi.fn(async () => null),
    ...overrides,
  } satisfies EvmChainProvider;
}

async function cursorBlock(cfg: EvmIngestConfig): Promise<bigint | null> {
  const c = await prisma.chainScanCursor.findUniqueOrThrow({
    where: {
      network_tokenContract_receivingAddress: {
        network: cfg.network,
        tokenContract: cfg.tokenContract,
        receivingAddress: cfg.receivingAddress,
      },
    },
  });
  return c.lastScannedBlock;
}

afterEach(async () => {
  const contracts = usedContracts.splice(0);
  await prisma.chainCredit.deleteMany({ where: { tokenContract: { in: contracts } } });
  await prisma.chainScanCursor.deleteMany({ where: { tokenContract: { in: contracts } } });
});

describe("runEvmIngestTick", () => {
  it("creates ChainCredit rows with tokenDecimals 18 and the exact raw amount, and advances the cursor only to the finalized block", async () => {
    const cfg = config();
    const l = log(cfg);
    const p = provider([l]);

    const result = await runEvmIngestTick(p, cfg);
    expect(result).toMatchObject({ rowsPersisted: 1, rowsSkipped: 0, scannedTo: 1000n, cursorBlock: 990n, stoppedReason: "caught_up" });

    // First run starts at latest - lookback = 900, so it scans 901..1000.
    expect(p.getTransferLogs).toHaveBeenCalledWith(
      expect.objectContaining({ tokenContract: cfg.tokenContract, toAddress: cfg.receivingAddress, fromBlock: 901n, toBlock: 1000n }),
    );

    const credit = await prisma.chainCredit.findFirstOrThrow({ where: { tokenContract: cfg.tokenContract, txHash: l.txHash } });
    expect(credit.network).toBe("bsc");
    expect(credit.eventIndex).toBe(7);
    expect(credit.tokenDecimals).toBe(18);
    expect(credit.rawAmount.toFixed(0)).toBe("12340000000000000000");
    expect(credit.normalizedAmountMinor).toBe(1234);
    expect(credit.blockNumber).toBe(950n);
    expect(credit.blockTimestamp.getTime()).toBe(1_700_000_000_000 + 950_000);
    expect(credit.finalityState).toBe("DETECTED");
    expect(credit.processingStatus).toBe("PENDING");

    expect(await cursorBlock(cfg)).toBe(990n); // never past finalized, even though 1000 was scanned
  });

  it("re-scans the unfinalized tail every tick without creating duplicates", async () => {
    const cfg = config();
    const tailLog = log(cfg, { blockNumber: 995n }); // above finalized (990) — re-scanned next tick
    const p = provider([tailLog]);

    await runEvmIngestTick(p, cfg);
    const second = await runEvmIngestTick(p, cfg);

    expect(p.getTransferLogs).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 991n, toBlock: 1000n }));
    expect(second.logsSeen).toBe(1);
    expect(second.rowsPersisted).toBe(0); // duplicate — unique key no-op
    expect(await prisma.chainCredit.count({ where: { tokenContract: cfg.tokenContract } })).toBe(1);
  });

  it("persists a sub-cent 18-decimal value with a null normalized amount (routed to manual review), and skips removed and zero-value logs", async () => {
    const cfg = config();
    const subCent = log(cfg, { rawValue: 5n * USDT + 1n });
    const removed = log(cfg, { removed: true });
    const zero = log(cfg, { rawValue: 0n });
    const p = provider([subCent, removed, zero]);

    const result = await runEvmIngestTick(p, cfg);
    expect(result).toMatchObject({ rowsPersisted: 1, rowsSkipped: 2 });

    const credits = await prisma.chainCredit.findMany({ where: { tokenContract: cfg.tokenContract } });
    expect(credits).toHaveLength(1);
    expect(credits[0]!.txHash).toBe(subCent.txHash);
    expect(credits[0]!.rawAmount.toFixed(0)).toBe((5n * USDT + 1n).toString());
    expect(credits[0]!.normalizedAmountMinor).toBeNull();
    expect(credits[0]!.processingStatus).toBe("MANUAL_REVIEW");
  });

  it("skips a log for a different destination address", async () => {
    const cfg = config();
    const p = provider([log(cfg, { toAddress: hex(20) })]);
    const result = await runEvmIngestTick(p, cfg);
    expect(result.rowsSkipped).toBe(1);
    expect(await prisma.chainCredit.count({ where: { tokenContract: cfg.tokenContract } })).toBe(0);
  });

  it("scans in chunks of maxBlockRange and caches block timestamps within a tick", async () => {
    const cfg = config({ maxBlockRange: 30 });
    const a = log(cfg, { blockNumber: 910n, logIndex: 1 });
    const b = log(cfg, { blockNumber: 910n, logIndex: 2 });
    const p = provider([a, b]);

    await runEvmIngestTick(p, cfg);
    const ranges = vi.mocked(p.getTransferLogs).mock.calls.map((c) => [c[0].fromBlock, c[0].toBlock]);
    expect(ranges).toEqual([
      [901n, 930n],
      [931n, 960n],
      [961n, 990n],
      [991n, 1000n],
    ]);
    expect(p.getBlockTimestampMs).toHaveBeenCalledTimes(1);
    expect(await prisma.chainCredit.count({ where: { tokenContract: cfg.tokenContract } })).toBe(2);
  });

  it("stops at the chunk budget; the next tick continues from the persisted cursor", async () => {
    const cfg = config({ maxBlockRange: 10, maxChunksPerTick: 2 });
    const p = provider([]);

    const first = await runEvmIngestTick(p, cfg);
    expect(first).toMatchObject({ chunksScanned: 2, scannedTo: 920n, cursorBlock: 920n, stoppedReason: "chunk_budget" });

    await runEvmIngestTick(p, cfg);
    expect(p.getTransferLogs).toHaveBeenLastCalledWith(expect.objectContaining({ fromBlock: 931n, toBlock: 940n }));
    expect(await cursorBlock(cfg)).toBe(940n);
  });

  it("a failing first chunk leaves the cursor unchanged", async () => {
    const cfg = config();
    const p = provider([], { getTransferLogs: vi.fn().mockRejectedValue(new Error("limit exceeded")) });

    const result = await runEvmIngestTick(p, cfg);
    expect(result.stoppedReason).toBe("provider_error");
    expect(await cursorBlock(cfg)).toBe(900n); // the initial latest - lookback
  });

  it("a failing later chunk only advances the cursor over the chunks that fully succeeded", async () => {
    const cfg = config({ maxBlockRange: 30 });
    const getTransferLogs = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("HTTP 502"));
    const p = provider([], { getTransferLogs });

    const result = await runEvmIngestTick(p, cfg);
    expect(result).toMatchObject({ stoppedReason: "provider_error", scannedTo: 930n });
    expect(await cursorBlock(cfg)).toBe(930n);
  });

  it("a failing block-timestamp lookup fails the chunk — the cursor does not move past it", async () => {
    const cfg = config();
    const p = provider([log(cfg)], { getBlockTimestampMs: vi.fn().mockRejectedValue(new Error("timeout")) });

    const result = await runEvmIngestTick(p, cfg);
    expect(result.stoppedReason).toBe("provider_error");
    expect(await cursorBlock(cfg)).toBe(900n);
  });

  it("a failing block-head call changes nothing (no cursor is even created)", async () => {
    const cfg = config();
    const p = provider([], { getFinalizedBlockNumber: vi.fn().mockRejectedValue(new Error("down")) });

    const result = await runEvmIngestTick(p, cfg);
    expect(result.stoppedReason).toBe("provider_error");
    expect(await prisma.chainScanCursor.count({ where: { tokenContract: cfg.tokenContract } })).toBe(0);
  });
});
