import { listPendingFinalityChecks, prisma } from "@asm/db";
import { logger } from "@asm/logger";
import type { ChainProvider } from "./types";

/**
 * TRON's own protocol-level reorg criteria (see the design doc's finality
 * section): a single transient "not found on the solidity node" is normal —
 * the solidity node commonly lags the full node by a few seconds. Only a
 * transaction that is missing from BOTH the solidity node AND the full node,
 * on at least this many consecutive checks, spread over at least this long,
 * is treated as genuinely reorged. Never set from one response.
 */
export const REORG_MIN_CONSECUTIVE_CHECKS = 3;
export const REORG_MIN_ELAPSED_MS = 10 * 60 * 1000;

export interface FinalityResult {
  checked: number;
  finalized: number;
  failedOnChain: number;
  reorged: number;
  stillPending: number;
  providerErrors: number;
}

/**
 * Re-checks every ChainCredit in DETECTED/CONFIRMING against the independent,
 * authoritative provider signal — never promotes a row to FINAL from the
 * ingestion-time observation alone. Idempotent: every write here is guarded
 * by `finalityState IN (DETECTED, CONFIRMING)`, so a row already resolved by
 * a concurrent run (or a previous tick) is simply skipped, never
 * re-processed or double-transitioned.
 */
export async function runFinalityTick(
  provider: ChainProvider,
  limit = 200,
  nowMs: number = Date.now(),
): Promise<FinalityResult> {
  const rows = await listPendingFinalityChecks(limit);
  const result: FinalityResult = {
    checked: 0,
    finalized: 0,
    failedOnChain: 0,
    reorged: 0,
    stillPending: 0,
    providerErrors: 0,
  };

  for (const row of rows) {
    result.checked++;
    let exec;
    try {
      exec = await provider.getExecutionResult(row.txHash);
    } catch (err) {
      logger.warn(
        { evt: "chain.watcher.provider_error", op: "finality.getExecutionResult", txHash: row.txHash, reason: err instanceof Error ? err.message : "unknown" },
        "finality re-check failed — left in its current state, retried next tick",
      );
      result.providerErrors++;
      continue;
    }

    const guard = { id: row.id, finalityState: { in: ["DETECTED" as const, "CONFIRMING" as const] } };

    if (exec.state === "solidified") {
      const finalityState = exec.success ? "FINAL" : "FAILED_ON_CHAIN";
      const updated = await prisma.chainCredit.updateMany({
        where: guard,
        data: { finalityState, lastCheckedAt: new Date(nowMs), checkAttempts: 0, firstNotFoundAt: null },
      });
      if (updated.count === 1) {
        if (exec.success) {
          result.finalized++;
          logger.info({ evt: "chain.credit.final", txHash: row.txHash }, "transfer reached FINAL");
        } else {
          result.failedOnChain++;
          logger.info({ evt: "chain.credit.failed_on_chain", txHash: row.txHash }, "transfer's underlying transaction did not succeed");
        }
      }
      continue;
    }

    if (exec.state === "provider_error") {
      // Never moves toward REORGED or FAILED_ON_CHAIN from a transient failure.
      result.providerErrors++;
      continue;
    }

    if (exec.state === "not_yet_solidified" || (exec.state === "not_found_on_solidity_node" && !exec.alsoMissingOnFullNode)) {
      // Visible somewhere (or the check was inconclusive) — not a reorg
      // signal. The consecutive-missing-everywhere streak resets.
      await prisma.chainCredit.updateMany({
        where: guard,
        data: { finalityState: "CONFIRMING", lastCheckedAt: new Date(nowMs), checkAttempts: 0, firstNotFoundAt: null },
      });
      result.stillPending++;
      continue;
    }

    // exec.state === "not_found_on_solidity_node" && exec.alsoMissingOnFullNode:
    // the genuine "missing everywhere" signal. Strict, multi-check, time-boxed
    // criteria before ever calling this REORGED — see the constants above.
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
        ...(shouldReorg ? { finalityState: "REORGED" } : {}),
      },
    });
    if (updated.count === 1) {
      if (shouldReorg) {
        result.reorged++;
        logger.warn(
          { evt: "chain.credit.reorged", txHash: row.txHash, attempts, elapsedMs },
          "transfer never solidified on either node after the full grace period — treated as reorged",
        );
      } else {
        result.stillPending++;
      }
    }
  }

  return result;
}
