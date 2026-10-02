import { prisma } from "../client";
import { creditDepositToAccount } from "./deposit";
import type { Deposit } from "../../generated/prisma/client";

export type ChainMatchOutcome =
  | { kind: "auto_approved"; depositId: string }
  | {
      kind: "manual_review";
      reason:
        | "ambiguous_amount"
        | "wrong_token_contract"
        | "wrong_network"
        | "wrong_destination"
        | "not_final"
        | "already_processed";
      depositId: string | null;
    }
  | { kind: "unmatched" };

/**
 * All live (not yet resolved, not yet expired) USDT deposits that reserved
 * exactly this amount. In practice 0 or 1 rows — the USDT partial unique
 * index (Deposit_live_usdt_amount_unique) guarantees at most one — but the
 * caller treats more than one as a bug to flag, never something to guess
 * between.
 *
 * Expiry is judged at `paidAt` — the transfer's on-chain block timestamp —
 * never at match time. Matching only happens after solidification (~1 min)
 * plus watcher ticks, so with a short payment window, "now" would wrongly
 * reject a transfer the user sent in time.
 *
 * The expiresAt check here is new relative to the INR equivalent
 * (findLiveDepositByAmount has none) and is deliberately USDT-only: it does
 * not touch, generalize, or "fix" the INR path's lack of an expiry sweep,
 * which is separate, pre-existing, and out of scope for this feature.
 *
 * `scope` restricts candidates to deposits that asked to be paid on this
 * exact network/contract/address. The live-amount unique index is global
 * across networks, so without it a TRON transfer could credit a BSC deposit
 * reserving the same amount (and vice versa). The matcher always passes it.
 */
export async function findLiveDepositByUsdtAmount(
  amountUsdtMinor: number,
  paidAt: Date,
  scope?: { network: string; tokenContract: string; receivingAddress: string },
): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: {
      method: "USDT",
      amountUsdtMinor,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
      expiresAt: { gt: paidAt },
      ...(scope
        ? {
            network: scope.network,
            tokenContract: scope.tokenContract,
            receivingAddress: scope.receivingAddress,
          }
        : {}),
    },
  });
}

/**
 * The ChainCredit -> Deposit decision function. Structurally mirrors
 * matchCreditToDeposit (INR): amount is the sole reconciliation key, matched
 * exactly, never with tolerance, never disambiguated by a secondary signal
 * (a user-submitted tx hash plays no role here at all — it isn't even a
 * parameter, same as VPA isn't a parameter of matchCreditToDeposit).
 *
 * Preconditions (network/token/destination/finality) are re-verified against
 * the caller-supplied live config here, at match time — never trusted from
 * the stored row alone, since config can change between when a row was
 * ingested and when it's matched.
 *
 * Lives in @asm/db, not the engine, so both the chain-watcher and (if ever
 * needed) an admin manual-relink action can call the same function.
 */
export async function matchChainCreditToDeposit(input: {
  chainCreditId: string;
  expectedNetwork: string;
  expectedTokenContract: string;
  expectedReceivingAddress: string;
}): Promise<ChainMatchOutcome> {
  const credit = await prisma.chainCredit.findUniqueOrThrow({ where: { id: input.chainCreditId } });

  if (credit.processingStatus !== "PENDING") {
    // Already matched/manual_review/unmatched by an earlier (possibly
    // concurrent) run — never re-decide a row that already has an outcome.
    return { kind: "manual_review", reason: "already_processed", depositId: null };
  }

  if (credit.finalityState !== "FINAL") {
    // Observed is not the same as safe to credit — only a FINAL row (the
    // independent solidity re-check has already passed) is eligible at all.
    return { kind: "manual_review", reason: "not_final", depositId: null };
  }

  if (credit.network !== input.expectedNetwork) {
    await markManualReview(credit.id, "WRONG_NETWORK");
    return { kind: "manual_review", reason: "wrong_network", depositId: null };
  }
  if (credit.tokenContract !== input.expectedTokenContract) {
    await markManualReview(credit.id, "WRONG_TOKEN_CONTRACT");
    return { kind: "manual_review", reason: "wrong_token_contract", depositId: null };
  }
  if (credit.toAddress !== input.expectedReceivingAddress) {
    await markManualReview(credit.id, "WRONG_DESTINATION");
    return { kind: "manual_review", reason: "wrong_destination", depositId: null };
  }

  if (credit.normalizedAmountMinor === null) {
    // Already MANUAL_REVIEW/PRECISION_NOT_REPRESENTABLE from ingestion
    // (createChainCreditIfNew) — processingStatus would not be PENDING here.
    // Guarded anyway: never let a null amount reach findLiveDepositByUsdtAmount.
    await markManualReview(credit.id, "PRECISION_NOT_REPRESENTABLE");
    return { kind: "manual_review", reason: "not_final", depositId: null };
  }

  // Scoped to the credit's own network/contract/destination (already checked
  // equal to live config above): a same-amount deposit on the OTHER network
  // is never a candidate — that payment lands in UNMATCHED for the admin.
  const candidates = await findLiveDepositByUsdtAmount(credit.normalizedAmountMinor, credit.blockTimestamp, {
    network: credit.network,
    tokenContract: credit.tokenContract,
    receivingAddress: credit.toAddress,
  });

  if (candidates.length > 1) {
    // Should be prevented by Deposit_live_usdt_amount_unique — defense in
    // depth against a bug or a race, exactly like the INR matcher's
    // equivalent branch. Never guess between two live deposits.
    await markManualReview(credit.id, "AMBIGUOUS_AMOUNT");
    return { kind: "manual_review", reason: "ambiguous_amount", depositId: null };
  }

  if (candidates.length === 1) {
    const deposit = candidates[0]!;
    await creditDepositToAccount({ depositId: deposit.id, adminId: null, chainCreditId: credit.id });
    return { kind: "auto_approved", depositId: deposit.id };
  }

  // No live deposit reserved this exact amount. Unlike the INR matcher there
  // is no reference (tx hash) fallback lookup here — a user-submitted tx hash
  // is evidence-only (see the design doc) and never selects a deposit.
  const unmatched = await prisma.chainCredit.updateMany({
    where: { id: credit.id, processingStatus: "PENDING" },
    data: { processingStatus: "UNMATCHED", reviewReason: "NO_LIVE_DEPOSIT" },
  });
  if (unmatched.count !== 1) {
    return { kind: "manual_review", reason: "already_processed", depositId: null };
  }
  return { kind: "unmatched" };
}

async function markManualReview(chainCreditId: string, reason: string): Promise<void> {
  await prisma.chainCredit.updateMany({
    where: { id: chainCreditId, processingStatus: "PENDING" },
    data: { processingStatus: "MANUAL_REVIEW", reviewReason: reason },
  });
}
