import { listPendingFinalityChecks, prisma } from "@asm/db";
import { logger } from "@asm/logger";
import { TRANSFER_TOPIC, parseUint256Data, topicToAddress } from "./evm-codec";
import { REORG_MIN_CONSECUTIVE_CHECKS, REORG_MIN_ELAPSED_MS, type ChainScope, type FinalityResult } from "./finality";
import type { EvmChainProvider, EvmReceipt } from "./types";

type PendingRow = Awaited<ReturnType<typeof listPendingFinalityChecks>>[number];

/**
 * EVM (BSC) finality: re-checks every DETECTED/CONFIRMING ChainCredit of THIS
 * network/contract against the transaction receipt and the chain's own
 * "finalized" block (BSC fast finality) — never promotes from the ingestion
 * observation alone.
 *
 * - receipt block > finalized                          → CONFIRMING (streak reset)
 * - finalized, status 0                                → FAILED_ON_CHAIN
 * - finalized, status 1, Transfer log at eventIndex
 *   matching contract/to/value                         → FINAL
 * - finalized, but no such log at that index           → REORGED (the transfer
 *   now lives elsewhere; a re-scan persists it under its new log index)
 * - receipt missing                                    → REORGED only after the
 *   same strict rule as TRON (>= 3 consecutive checks AND >= 10 min)
 * - any provider error                                 → no state change
 *
 * Every write is guarded by finalityState IN (DETECTED, CONFIRMING), so it is
 * idempotent and safe against a concurrent run.
 */
export async function runEvmFinalityTick(
  provider: EvmChainProvider,
  scope: ChainScope,
  limit = 200,
  nowMs: number = Date.now(),
): Promise<FinalityResult> {
  const result: FinalityResult = { checked: 0, finalized: 0, failedOnChain: 0, reorged: 0, stillPending: 0, providerErrors: 0 };
  const rows = await listPendingFinalityChecks(limit, scope);
  if (rows.length === 0) return result;

  let finalizedBlock: bigint;
  try {
    finalizedBlock = await provider.getFinalizedBlockNumber();
  } catch (err) {
    logProviderError(scope.network, "finality.getFinalizedBlockNumber", err);
    result.checked = rows.length;
    result.providerErrors = rows.length;
    return result;
  }

  for (const row of rows) {
    // Defense in depth on top of the scoped query — never touch another network's row.
    if (row.network !== scope.network || row.tokenContract !== scope.tokenContract) continue;
    result.checked++;

    let receipt: EvmReceipt | null;
    try {
      receipt = await provider.getReceipt(row.txHash);
    } catch (err) {
      logProviderError(scope.network, "finality.getReceipt", err, { txHash: row.txHash });
      result.providerErrors++;
      continue;
    }

    const guard = { id: row.id, finalityState: { in: ["DETECTED" as const, "CONFIRMING" as const] } };
    const now = new Date(nowMs);

    if (receipt === null) {
      await handleMissingReceipt(row, guard, nowMs, result);
      continue;
    }

    if (receipt.blockNumber > finalizedBlock) {
      await prisma.chainCredit.updateMany({
        where: guard,
        data: { finalityState: "CONFIRMING", lastCheckedAt: now, checkAttempts: 0, firstNotFoundAt: null },
      });
      result.stillPending++;
      continue;
    }

    if (receipt.status === 0) {
      const updated = await prisma.chainCredit.updateMany({
        where: guard,
        data: { finalityState: "FAILED_ON_CHAIN", lastCheckedAt: now, checkAttempts: 0, firstNotFoundAt: null },
      });
      if (updated.count === 1) {
        result.failedOnChain++;
        logger.info({ evt: "chain.credit.failed_on_chain", network: row.network, txHash: row.txHash }, "transfer's underlying transaction did not succeed");
      }
      continue;
    }

    if (receiptHasMatchingTransfer(receipt, row)) {
      const updated = await prisma.chainCredit.updateMany({
        where: guard,
        data: {
          finalityState: "FINAL",
          blockNumber: receipt.blockNumber,
          lastCheckedAt: now,
          checkAttempts: 0,
          firstNotFoundAt: null,
        },
      });
      if (updated.count === 1) {
        result.finalized++;
        logger.info({ evt: "chain.credit.final", network: row.network, txHash: row.txHash }, "transfer reached FINAL");
      }
      continue;
    }

    // Finalized and successful, but the finalized transaction has no matching
    // Transfer at this log index — this row's observation is not on the
    // canonical chain.
    const updated = await prisma.chainCredit.updateMany({
      where: guard,
      data: { finalityState: "REORGED", lastCheckedAt: now },
    });
    if (updated.count === 1) {
      result.reorged++;
      logger.warn(
        { evt: "chain.credit.reorged", network: row.network, txHash: row.txHash, eventIndex: row.eventIndex },
        "finalized receipt has no matching Transfer at this log index — treated as reorged",
      );
    }
  }

  return result;
}

function receiptHasMatchingTransfer(receipt: EvmReceipt, row: PendingRow): boolean {
  const log = receipt.logs.find((l) => l.logIndex === row.eventIndex);
  if (!log) return false;
  if (log.address.toLowerCase() !== row.tokenContract) return false;
  if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return false;
  try {
    if (topicToAddress(log.topics[2]) !== row.toAddress) return false;
    return parseUint256Data(log.data) === BigInt(row.rawAmount.toFixed(0));
  } catch {
    return false; // malformed log data is never a match
  }
}

async function handleMissingReceipt(
  row: PendingRow,
  guard: { id: string; finalityState: { in: Array<"DETECTED" | "CONFIRMING"> } },
  nowMs: number,
  result: FinalityResult,
): Promise<void> {
  const attempts = row.checkAttempts + 1;
  const firstNotFoundAt = row.firstNotFoundAt ?? new Date(nowMs);
  const elapsedMs = nowMs - firstNotFoundAt.getTime();
  const shouldReorg = attempts >= REORG_MIN_CONSECUTIVE_CHECKS && elapsedMs >= REORG_MIN_ELAPSED_MS;

  const updated = await prisma.chainCredit.updateMany({
    where: guard,
    data: {
      lastCheckedAt: new Date(nowMs),
      checkAttempts: attempts,
      firstNotFoundAt,
      ...(shouldReorg ? { finalityState: "REORGED" as const } : {}),
    },
  });
  if (updated.count !== 1) return;
  if (shouldReorg) {
    result.reorged++;
    logger.warn(
      { evt: "chain.credit.reorged", network: row.network, txHash: row.txHash, attempts, elapsedMs },
      "transaction receipt missing for the full grace period — treated as reorged",
    );
  } else {
    result.stillPending++;
  }
}

function logProviderError(network: string, op: string, err: unknown, extra: Record<string, unknown> = {}): void {
  logger.warn(
    { evt: "chain.watcher.provider_error", network, op, ...extra, reason: err instanceof Error ? err.message : "unknown" },
    "EVM finality re-check failed — left in its current state, retried next tick",
  );
}
