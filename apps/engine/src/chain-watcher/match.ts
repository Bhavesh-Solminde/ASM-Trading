import { DepositAlreadyResolved, listPendingMatches, matchChainCreditToDeposit } from "@asm/db";
import { logger } from "@asm/logger";

export interface MatchConfig {
  expectedNetwork: string;
  expectedTokenContract: string;
  expectedReceivingAddress: string;
}

export interface MatchResult {
  checked: number;
  autoApproved: number;
  manualReview: number;
  unmatched: number;
  raceLost: number;
}

/**
 * Drives matchChainCreditToDeposit (packages/db, Phase 2 — untouched) over
 * every FINAL+PENDING ChainCredit. The exact-amount-only decision, the
 * network/contract/destination re-verification, and the actual account
 * credit all live in that function; this file is purely the "which rows,
 * how often, what to do when two processes raced" orchestration layer.
 *
 * Whether this stage runs at all — the actual production-activation safety
 * gate — is the runner's responsibility (USDT_AUTO_CONFIRM_ENABLED), not
 * this function's. This function always performs real matching/crediting
 * when called; it has no internal dry-run mode, since building one would
 * mean extending the Phase 2 matcher itself, which is deliberately not done
 * here (see the Phase 3 audit's assumptions section).
 */
export async function runMatchTick(config: MatchConfig, limit = 200): Promise<MatchResult> {
  const rows = await listPendingMatches(limit);
  const result: MatchResult = { checked: 0, autoApproved: 0, manualReview: 0, unmatched: 0, raceLost: 0 };

  for (const row of rows) {
    result.checked++;
    try {
      const outcome = await matchChainCreditToDeposit({
        chainCreditId: row.id,
        expectedNetwork: config.expectedNetwork,
        expectedTokenContract: config.expectedTokenContract,
        expectedReceivingAddress: config.expectedReceivingAddress,
      });

      if (outcome.kind === "auto_approved") {
        result.autoApproved++;
        logger.info(
          { evt: "chain.credit.matched", chainCreditId: row.id, depositId: outcome.depositId },
          "USDT deposit auto-confirmed",
        );
      } else if (outcome.kind === "manual_review") {
        result.manualReview++;
        logger.info(
          { evt: "chain.credit.manual_review", chainCreditId: row.id, reason: outcome.reason },
          "USDT transfer routed to manual review",
        );
      } else {
        result.unmatched++;
        logger.info({ evt: "chain.credit.unmatched", chainCreditId: row.id }, "USDT transfer has no live matching deposit");
      }
    } catch (err) {
      if (err instanceof DepositAlreadyResolved) {
        // Expected, benign outcome of the one-credit-only guarantee: a
        // concurrent run (another watcher instance, or an admin action) won
        // the race on this exact (deposit, chainCredit) pair first. Never an
        // error — see the design doc's idempotency section for the full
        // race walkthrough this outcome corresponds to.
        result.raceLost++;
        logger.info(
          { evt: "chain.credit.race_lost", chainCreditId: row.id },
          "lost a benign race to credit this deposit — another process already did",
        );
      } else {
        logger.error(
          { evt: "chain.watcher.match_error", chainCreditId: row.id, reason: err instanceof Error ? err.message : "unknown" },
          "unexpected error while matching a chain credit",
        );
      }
    }
  }

  return result;
}
