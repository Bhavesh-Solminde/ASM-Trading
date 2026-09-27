import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@asm/db";
import { runIngestTick } from "./ingest";
import type { ChainProvider, EventResolution, RawTrc20Row, TransferPage } from "./types";

function config(overrides: Partial<Parameters<typeof runIngestTick>[1]> = {}) {
  return {
    network: `test-${randomUUID()}`,
    tokenContract: "TContract111",
    receivingAddress: "TReceiving111",
    overlapMs: 0,
    maxPagesPerTick: 50,
    ...overrides,
  };
}

function row(overrides: Partial<RawTrc20Row> = {}): RawTrc20Row {
  return {
    transactionId: `tx-${randomUUID()}`,
    fromAddress: "TFrom111",
    toAddress: "TReceiving111",
    rawValue: "1000000",
    tokenContract: "TContract111",
    tokenDecimals: 6,
    blockTimestampMs: 1_700_000_000_000,
    ...overrides,
  };
}

/** A minimal provider stub — the only place a mock belongs, per the design doc. */
function provider(overrides: Partial<ChainProvider> = {}): ChainProvider {
  return {
    fetchTransferPage: vi.fn(async (): Promise<TransferPage> => ({ rows: [], nextFingerprint: null })),
    resolveTransferEvent: vi.fn(
      async (): Promise<EventResolution> => ({ kind: "resolved", eventIndex: 0, blockNumber: 1_000_000n }),
    ),
    getExecutionResult: vi.fn(async () => ({ state: "not_yet_solidified" }) as const),
    getTokenDecimals: vi.fn(async () => 6),
    ...overrides,
  };
}

afterEach(async () => {
  await prisma.chainCredit.deleteMany({ where: { txHash: { startsWith: "tx-" } } });
  await prisma.chainScanCursor.deleteMany({ where: { network: { startsWith: "test-" } } });
});

describe("runIngestTick — cursor/checkpoint behavior", () => {
  it("opens a session, persists rows, and closes the session (checkpoint advances) when the page is fully drained", async () => {
    const cfg = config();
    const r = row();
    const p = provider({ fetchTransferPage: vi.fn(async () => ({ rows: [r], nextFingerprint: null })) });

    const result = await runIngestTick(p, cfg, 5_000_000);
    expect(result).toEqual({ pagesFetched: 1, rowsPersisted: 1, rowsSkipped: 0, stoppedReason: "session_closed" });

    const cursor = await prisma.chainScanCursor.findUniqueOrThrow({
      where: {
        network_tokenContract_receivingAddress: {
          network: cfg.network,
          tokenContract: cfg.tokenContract,
          receivingAddress: cfg.receivingAddress,
        },
      },
    });
    expect(cursor.lastCommittedTimestampMs).toBe(5_000_000n);
    expect(cursor.activeSessionFingerprint).toBeNull();

    const credit = await prisma.chainCredit.findFirstOrThrow({ where: { txHash: r.transactionId } });
    expect(credit.finalityState).toBe("DETECTED");
    expect(credit.processingStatus).toBe("PENDING");
  });

  it("is idempotent — re-ingesting the same row a second time creates no duplicate ChainCredit", async () => {
    const cfg = config();
    const r = row();
    const p = provider({ fetchTransferPage: vi.fn(async () => ({ rows: [r], nextFingerprint: null })) });

    await runIngestTick(p, cfg, 5_000_000);
    // A later tick's overlap window re-observes the same transfer.
    await runIngestTick(p, cfg, 6_000_000);

    const count = await prisma.chainCredit.count({ where: { txHash: r.transactionId } });
    expect(count).toBe(1);
  });

  it("a provider failure leaves the checkpoint (and any in-progress session) completely unchanged", async () => {
    const cfg = config();
    const p = provider({ fetchTransferPage: vi.fn().mockRejectedValue(new Error("network down")) });

    const result = await runIngestTick(p, cfg, 5_000_000);
    expect(result.stoppedReason).toBe("provider_error");
    expect(result.rowsPersisted).toBe(0);

    const cursor = await prisma.chainScanCursor.findUniqueOrThrow({
      where: {
        network_tokenContract_receivingAddress: {
          network: cfg.network,
          tokenContract: cfg.tokenContract,
          receivingAddress: cfg.receivingAddress,
        },
      },
    });
    // The session that ensureSessionOpen itself opened (at cursor-creation
    // time, before the failing fetch) is still open — closeSession was never
    // reached, so the checkpoint floor never moved past its initial value.
    expect(cursor.lastCommittedTimestampMs).toBe(5_000_000n);
    expect(cursor.activeSessionMinTimestampMs).not.toBeNull();
  });

  it("paginates across multiple pages before closing the session, advancing the fingerprint page by page", async () => {
    const cfg = config({ maxPagesPerTick: 50 });
    const rowA = row();
    const rowB = row();
    const fetchTransferPage = vi
      .fn()
      .mockResolvedValueOnce({ rows: [rowA], nextFingerprint: "page-2" })
      .mockResolvedValueOnce({ rows: [rowB], nextFingerprint: null });
    const p = provider({ fetchTransferPage });

    const result = await runIngestTick(p, cfg, 5_000_000);
    expect(result).toEqual({ pagesFetched: 2, rowsPersisted: 2, rowsSkipped: 0, stoppedReason: "session_closed" });
    expect(fetchTransferPage).toHaveBeenCalledTimes(2);
    expect(fetchTransferPage.mock.calls[1]![0]).toMatchObject({ fingerprint: "page-2" });
  });

  it("stops at the page budget without closing the session — the next tick resumes from the persisted fingerprint", async () => {
    const cfg = config({ maxPagesPerTick: 1 });
    const fetchTransferPage = vi.fn().mockResolvedValue({ rows: [row()], nextFingerprint: "still-more" });
    const p = provider({ fetchTransferPage });

    const result = await runIngestTick(p, cfg, 5_000_000);
    expect(result.stoppedReason).toBe("page_budget");

    const cursor = await prisma.chainScanCursor.findUniqueOrThrow({
      where: {
        network_tokenContract_receivingAddress: {
          network: cfg.network,
          tokenContract: cfg.tokenContract,
          receivingAddress: cfg.receivingAddress,
        },
      },
    });
    expect(cursor.activeSessionFingerprint).toBe("still-more");
    expect(cursor.lastCommittedTimestampMs).toBe(5_000_000n); // unchanged from creation — session not yet closed
  });
});

describe("runIngestTick — row validation and event resolution", () => {
  it("skips a row for the wrong token contract rather than persisting it", async () => {
    const cfg = config();
    const wrongContractRow = row({ tokenContract: "TSomeOtherContract" });
    const p = provider({ fetchTransferPage: vi.fn(async () => ({ rows: [wrongContractRow], nextFingerprint: null })) });

    const result = await runIngestTick(p, cfg, 5_000_000);
    expect(result.rowsPersisted).toBe(0);
    expect(result.rowsSkipped).toBe(1);
    expect(await prisma.chainCredit.count({ where: { txHash: wrongContractRow.transactionId } })).toBe(0);
  });

  it("skips a row for the wrong destination address rather than persisting it", async () => {
    const cfg = config();
    const wrongDestRow = row({ toAddress: "TSomeoneElsesWallet" });
    const p = provider({ fetchTransferPage: vi.fn(async () => ({ rows: [wrongDestRow], nextFingerprint: null })) });

    const result = await runIngestTick(p, cfg, 5_000_000);
    expect(result.rowsPersisted).toBe(0);
    expect(await prisma.chainCredit.count({ where: { txHash: wrongDestRow.transactionId } })).toBe(0);
  });

  it("never persists a ChainCredit when the event index cannot yet be resolved (not_found) — retried via the next overlap re-scan instead", async () => {
    const cfg = config();
    const r = row();
    const p = provider({
      fetchTransferPage: vi.fn(async () => ({ rows: [r], nextFingerprint: null })),
      resolveTransferEvent: vi.fn(async (): Promise<EventResolution> => ({ kind: "not_found" })),
    });

    const result = await runIngestTick(p, cfg, 5_000_000);
    expect(result.rowsPersisted).toBe(0);
    expect(result.rowsSkipped).toBe(1);
    expect(await prisma.chainCredit.count({ where: { txHash: r.transactionId } })).toBe(0);
  });

  it("persists one ChainCredit per candidate index on an ambiguous event, each flagged MANUAL_REVIEW — never auto-picks one", async () => {
    const cfg = config();
    const r = row();
    const p = provider({
      fetchTransferPage: vi.fn(async () => ({ rows: [r], nextFingerprint: null })),
      resolveTransferEvent: vi.fn(
        async (): Promise<EventResolution> => ({ kind: "ambiguous", candidateEventIndexes: [0, 3] }),
      ),
    });

    const result = await runIngestTick(p, cfg, 5_000_000);
    expect(result.rowsPersisted).toBe(1); // one row (of two ChainCredit records) counted as "persisted"

    const credits = await prisma.chainCredit.findMany({ where: { txHash: r.transactionId }, orderBy: { eventIndex: "asc" } });
    expect(credits).toHaveLength(2);
    expect(credits.map((c) => c.eventIndex)).toEqual([0, 3]);
    for (const c of credits) {
      expect(c.processingStatus).toBe("MANUAL_REVIEW");
      expect(c.reviewReason).toBe("AMBIGUOUS_EVENT_WITHIN_TRANSACTION");
    }
  });

  it("skips a row with a non-integer rawValue rather than throwing", async () => {
    const cfg = config();
    const badRow = row({ rawValue: "not-a-number" });
    const p = provider({ fetchTransferPage: vi.fn(async () => ({ rows: [badRow], nextFingerprint: null })) });

    const result = await runIngestTick(p, cfg, 5_000_000);
    expect(result.rowsSkipped).toBe(1);
    expect(result.rowsPersisted).toBe(0);
  });
});
