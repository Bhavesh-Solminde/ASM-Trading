import {
  creditDepositToAccount,
  findLiveDepositByAmount,
  findLiveDepositByClaimedUtr,
} from "./deposit";

export type MatchOutcome =
  | { kind: "auto_approved"; depositId: string }
  | {
      kind: "manual_review";
      reason: "reference_mismatch" | "reference_matches_different_deposit" | "ambiguous_amount";
      depositId: string | null;
    }
  | { kind: "orphan" };

/**
 * Priority: Amount -> Reference -> VPA (VPA is never checked here at all — it
 * isn't even a parameter). Amount is an exact match against whichever single
 * value was reserved to a live deposit, never a fuzzy tolerance. Never
 * auto-rejects: every path ends in either an approval or a queue for a human,
 * so a legitimate but slightly-off payment is never lost.
 *
 * Lives in @asm/db, not the web app, because both the SMS relay route and the
 * engine's simulated feed reconcile credits and neither can import the other.
 */
export async function matchCreditToDeposit(credit: {
  creditId: string;
  amountInr: number;
  utr: string | null;
}): Promise<MatchOutcome> {
  const amountMatches = await findLiveDepositByAmount(credit.amountInr);

  if (amountMatches.length > 1) {
    // Should be prevented by the partial unique index — defense in depth
    // against a bug or a race. Never guess between two live deposits.
    return { kind: "manual_review", reason: "ambiguous_amount", depositId: null };
  }

  if (amountMatches.length === 1) {
    const deposit = amountMatches[0]!;
    const referenceMissing = !credit.utr || !deposit.claimedUtr;
    const referenceMatches = deposit.claimedUtr === credit.utr;

    if (referenceMissing || referenceMatches) {
      await creditDepositToAccount({ depositId: deposit.id, adminId: null, creditId: credit.creditId });
      return { kind: "auto_approved", depositId: deposit.id };
    }

    return { kind: "manual_review", reason: "reference_mismatch", depositId: deposit.id };
  }

  // No live deposit reserved this exact amount. Amount is primary and it didn't
  // match anything — but check whether the reference at least points at a
  // specific deposit, so a human reviewing the orphan queue has a lead.
  if (credit.utr) {
    const byReference = await findLiveDepositByClaimedUtr(credit.utr);
    if (byReference) {
      return {
        kind: "manual_review",
        reason: "reference_matches_different_deposit",
        depositId: byReference.id,
      };
    }
  }

  return { kind: "orphan" };
}
