import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@asm/db";
import { REORG_MIN_CONSECUTIVE_CHECKS, REORG_MIN_ELAPSED_MS, runFinalityTick } from "./finality";
import type { ChainProvider, ExecutionResult } from "./types";

async function seedCredit(overrides: Partial<Parameters<typeof prisma.chainCredit.create>[0]["data"]> = {}) {
  return prisma.chainCredit.create({
    data: {
      network: `test-${randomUUID()}`,
      tokenContract: "TContract111",
      txHash: `tx-${randomUUID()}`,
      eventIndex: 0,
      fromAddress: "TFrom111",
      toAddress: "TReceiving111",
      rawAmount: 1_000_000n,
      normalizedAmountMinor: 100,
      blockNumber: 1_000_000n,
      blockTimestamp: new Date(),
      finalityState: "DETECTED",
      rawPayload: {},
      ...overrides,
    },
  });
}

function providerReturning(exec: ExecutionResult): ChainProvider {
  return {
    fetchTransferPage: vi.fn(),
    resolveTransferEvent: vi.fn(),
    getExecutionResult: vi.fn(async () => exec),
    getTokenDecimals: vi.fn(async () => 6),
  };
}

afterEach(async () => {
  await prisma.chainCredit.deleteMany({ where: { txHash: { startsWith: "tx-" } } });
});

describe("runFinalityTick", () => {
  it("promotes to FINAL only on solidified success — never from the ingestion-time observation alone", async () => {
    const credit = await seedCredit();
    const provider = providerReturning({ state: "solidified", success: true });

    const result = await runFinalityTick(provider, 200);
    expect(result).toMatchObject({ checked: 1, finalized: 1 });

    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(updated.finalityState).toBe("FINAL");
  });

  it("moves to FAILED_ON_CHAIN on a solidified but unsuccessful execution — never credited", async () => {
    const credit = await seedCredit();
    const provider = providerReturning({ state: "solidified", success: false });

    const result = await runFinalityTick(provider, 200);
    expect(result.failedOnChain).toBe(1);

    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(updated.finalityState).toBe("FAILED_ON_CHAIN");
  });

  it("a single not_yet_solidified response only moves DETECTED -> CONFIRMING, never toward REORGED", async () => {
    const credit = await seedCredit();
    const provider = providerReturning({ state: "not_yet_solidified" });

    await runFinalityTick(provider, 200);
    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(updated.finalityState).toBe("CONFIRMING");
    expect(updated.checkAttempts).toBe(0);
  });

  it("a single not_found_on_solidity_node response, still visible on the full node, is never treated as a reorg signal", async () => {
    const credit = await seedCredit({ checkAttempts: 2, firstNotFoundAt: new Date(Date.now() - 20 * 60_000) });
    const provider = providerReturning({ state: "not_found_on_solidity_node", alsoMissingOnFullNode: false });

    await runFinalityTick(provider, 200);
    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(updated.finalityState).toBe("CONFIRMING");
    // The streak resets — this check wasn't "missing everywhere".
    expect(updated.checkAttempts).toBe(0);
    expect(updated.firstNotFoundAt).toBeNull();
  });

  it("does not mark REORGED on the first missing-everywhere observation, even past the time window — requires the consecutive-check count too", async () => {
    const credit = await seedCredit({
      checkAttempts: 0,
      firstNotFoundAt: null,
    });
    const provider = providerReturning({ state: "not_found_on_solidity_node", alsoMissingOnFullNode: true });

    const result = await runFinalityTick(provider, 200, Date.now());
    expect(result.reorged).toBe(0);
    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(updated.finalityState).toBe("DETECTED"); // unchanged — not enough evidence yet
    expect(updated.checkAttempts).toBe(1);
    expect(updated.firstNotFoundAt).not.toBeNull();
  });

  it("does not mark REORGED before the minimum elapsed time, even with enough consecutive checks", async () => {
    const now = Date.now();
    const credit = await seedCredit({
      checkAttempts: REORG_MIN_CONSECUTIVE_CHECKS - 1,
      firstNotFoundAt: new Date(now - (REORG_MIN_ELAPSED_MS - 1000)), // just under the window
    });
    const provider = providerReturning({ state: "not_found_on_solidity_node", alsoMissingOnFullNode: true });

    const result = await runFinalityTick(provider, 200, now);
    expect(result.reorged).toBe(0);
    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(updated.finalityState).toBe("DETECTED");
  });

  it("marks REORGED only once BOTH the consecutive-check count AND the elapsed-time window are satisfied, and missing on the full node too", async () => {
    const now = Date.now();
    const credit = await seedCredit({
      checkAttempts: REORG_MIN_CONSECUTIVE_CHECKS - 1,
      firstNotFoundAt: new Date(now - REORG_MIN_ELAPSED_MS - 1000),
    });
    const provider = providerReturning({ state: "not_found_on_solidity_node", alsoMissingOnFullNode: true });

    const result = await runFinalityTick(provider, 200, now);
    expect(result.reorged).toBe(1);
    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(updated.finalityState).toBe("REORGED");
  });

  it("a provider error leaves the row's state completely untouched", async () => {
    const credit = await seedCredit({ finalityState: "CONFIRMING", checkAttempts: 1 });
    const provider = providerReturning({ state: "provider_error", retryable: true, message: "timeout" });

    const result = await runFinalityTick(provider, 200);
    expect(result.providerErrors).toBe(1);
    const updated = await prisma.chainCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(updated.finalityState).toBe("CONFIRMING");
    expect(updated.checkAttempts).toBe(1);
  });

  it("is idempotent — a row already FINAL is never re-checked or re-processed", async () => {
    await seedCredit({ finalityState: "FINAL" });
    const provider = providerReturning({ state: "solidified", success: false }); // would flip it to FAILED_ON_CHAIN if ever re-checked

    const result = await runFinalityTick(provider, 200);
    expect(result.checked).toBe(0); // listPendingFinalityChecks never returns FINAL rows
  });

  it("a network exception from getExecutionResult is caught and counted as a provider error, not thrown", async () => {
    await seedCredit();
    const provider: ChainProvider = {
      fetchTransferPage: vi.fn(),
      resolveTransferEvent: vi.fn(),
      getExecutionResult: vi.fn().mockRejectedValue(new Error("connection reset")),
      getTokenDecimals: vi.fn(async () => 6),
    };

    const result = await runFinalityTick(provider, 200);
    expect(result.providerErrors).toBe(1);
  });
});
