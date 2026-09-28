import { prisma } from "../client";
import type { ReconciliationIssue } from "../../generated/prisma/client";

/**
 * Read-only USDT (TRON + BSC) deposit reconciliation. Verifies invariants the
 * deposit/matching code paths (deposit.ts, chain-credit-matcher.ts) are
 * supposed to guarantee, and raises findings for anything that doesn't hold.
 *
 * This module NEVER mutates a Deposit, Account, Transaction, or ChainCredit —
 * the only table it writes to is ReconciliationIssue, and only via
 * `runUsdtReconciliation`. Scoped entirely to USDT; the INR/UPI path has no
 * equivalent reconciliation and is out of scope.
 *
 * Two things this deliberately does NOT flag (see the design notes this
 * implements):
 *  - A non-COMPLETED USDT deposit having a DEPOSIT transaction: a reversed
 *    (REJECTED) deposit legitimately keeps its original DEPOSIT transaction
 *    plus a second, negative-amount one (see reverseCompletedDeposit /
 *    reverseUsdtDepositAndRequeue). The real invariant is narrower: a
 *    COMPLETED deposit must have EXACTLY ONE (see #completed_usdt_transaction_count).
 *  - A lapsed AWAITING_PAYMENT USDT deposit: normal until it's EXPIRED by
 *    expireStaleUsdtDeposits after USDT_RESERVATION_QUARANTINE_MS.
 *  - The existing MANUAL_REVIEW/UNMATCHED admin queue (chain-credit-admin.ts):
 *    already has its own visibility; not duplicated here.
 */

export type ReconciliationSeverity = "P1" | "WARNING";

export interface ReconciliationFinding {
  checkName: string;
  severity: ReconciliationSeverity;
  /** The row's own network id ("tron" | "bsc"), or "global" for a cross-network check. */
  network: string;
  subjectType: "Deposit" | "ChainCredit";
  subjectId: string;
  /** Human-readable, includes the actual conflicting values. */
  message: string;
}

/** A DETECTED/CONFIRMING ChainCredit older than this is flagged as stuck (2 hours). */
export const STUCK_TRANSFER_AGE_MS = 2 * 60 * 60 * 1000;

type CompletedUsdtDeposit = {
  id: string;
  network: string | null;
  tokenContract: string | null;
  receivingAddress: string | null;
  amountUsdtMinor: number | null;
  matchedChainCreditId: string | null;
};

type MatchedCreditForLinkCheck = {
  id: string;
  network: string;
  tokenContract: string;
  toAddress: string;
  normalizedAmountMinor: number | null;
  consumed: boolean;
  processingStatus: string;
};

/**
 * Checks #1 (completed_deposit_broken_credit_link), #3
 * (completed_usdt_amount_mismatch), #4 (completed_usdt_network_mismatch) and
 * #5 (completed_usdt_transaction_count) all start from the same set of
 * COMPLETED USDT deposits, so they share one fetch here rather than four.
 */
async function checkCompletedUsdtDeposits(): Promise<ReconciliationFinding[]> {
  const deposits: CompletedUsdtDeposit[] = await prisma.deposit.findMany({
    where: { status: "COMPLETED", method: "USDT" },
    select: {
      id: true,
      network: true,
      tokenContract: true,
      receivingAddress: true,
      amountUsdtMinor: true,
      matchedChainCreditId: true,
    },
  });
  if (deposits.length === 0) return [];

  const creditIds = [
    ...new Set(
      deposits
        .map((d) => d.matchedChainCreditId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const credits: MatchedCreditForLinkCheck[] = creditIds.length
    ? await prisma.chainCredit.findMany({
        where: { id: { in: creditIds } },
        select: {
          id: true,
          network: true,
          tokenContract: true,
          toAddress: true,
          normalizedAmountMinor: true,
          consumed: true,
          processingStatus: true,
        },
      })
    : [];
  const creditById = new Map(credits.map((c) => [c.id, c]));

  const depositIds = deposits.map((d) => d.id);
  const txCounts = await prisma.transaction.groupBy({
    by: ["refId"],
    where: { kind: "DEPOSIT", refType: "Deposit", refId: { in: depositIds } },
    _count: { id: true },
  });
  const txCountByDepositId = new Map(txCounts.map((t) => [t.refId as string, t._count.id]));

  const findings: ReconciliationFinding[] = [];

  for (const d of deposits) {
    const network = d.network ?? "unknown";

    // #5 completed_usdt_transaction_count — independent of the credit link.
    const count = txCountByDepositId.get(d.id) ?? 0;
    if (count !== 1) {
      findings.push({
        checkName: "completed_usdt_transaction_count",
        severity: "P1",
        network,
        subjectType: "Deposit",
        subjectId: d.id,
        message: `Deposit ${d.id} is COMPLETED but has ${count} DEPOSIT transactions (kind=DEPOSIT, refType=Deposit, refId=${d.id}); expected exactly 1.`,
      });
    }

    // #1 completed_deposit_broken_credit_link
    let credit: MatchedCreditForLinkCheck | undefined;
    let linkBroken = false;
    if (d.matchedChainCreditId === null) {
      linkBroken = true;
      findings.push({
        checkName: "completed_deposit_broken_credit_link",
        severity: "P1",
        network,
        subjectType: "Deposit",
        subjectId: d.id,
        message: `Deposit ${d.id} is COMPLETED (method=USDT) but matchedChainCreditId is null.`,
      });
    } else {
      credit = creditById.get(d.matchedChainCreditId);
      if (!credit) {
        linkBroken = true;
        findings.push({
          checkName: "completed_deposit_broken_credit_link",
          severity: "P1",
          network,
          subjectType: "Deposit",
          subjectId: d.id,
          message: `Deposit ${d.id}.matchedChainCreditId=${d.matchedChainCreditId} does not reference any existing ChainCredit.`,
        });
      } else if (credit.consumed !== true || credit.processingStatus !== "MATCHED") {
        linkBroken = true;
        findings.push({
          checkName: "completed_deposit_broken_credit_link",
          severity: "P1",
          network,
          subjectType: "Deposit",
          subjectId: d.id,
          message: `Deposit ${d.id}'s matched credit ${credit.id} has consumed=${credit.consumed} processingStatus=${credit.processingStatus}; expected consumed=true processingStatus=MATCHED.`,
        });
      }
    }

    if (!linkBroken && credit) {
      // #3 completed_usdt_amount_mismatch
      if (d.amountUsdtMinor !== credit.normalizedAmountMinor) {
        findings.push({
          checkName: "completed_usdt_amount_mismatch",
          severity: "P1",
          network,
          subjectType: "Deposit",
          subjectId: d.id,
          message: `deposit.amountUsdtMinor=${d.amountUsdtMinor} but credit.normalizedAmountMinor=${credit.normalizedAmountMinor} (matched credit ${credit.id}).`,
        });
      }

      // #4 completed_usdt_network_mismatch
      if (
        d.network !== credit.network ||
        d.tokenContract !== credit.tokenContract ||
        d.receivingAddress !== credit.toAddress
      ) {
        findings.push({
          checkName: "completed_usdt_network_mismatch",
          severity: "P1",
          network,
          subjectType: "Deposit",
          subjectId: d.id,
          message: `deposit(network=${d.network}, tokenContract=${d.tokenContract}, receivingAddress=${d.receivingAddress}) != credit(network=${credit.network}, tokenContract=${credit.tokenContract}, toAddress=${credit.toAddress}) for matched credit ${credit.id}.`,
        });
      }
    }
  }

  return findings;
}

/** #2 matched_credit_broken_deposit_link */
async function checkMatchedCreditBrokenDepositLink(): Promise<ReconciliationFinding[]> {
  const credits = await prisma.chainCredit.findMany({
    where: { consumed: true, processingStatus: "MATCHED" },
    select: { id: true, network: true },
  });
  if (credits.length === 0) return [];

  const deposits = await prisma.deposit.findMany({
    where: { matchedChainCreditId: { in: credits.map((c) => c.id) } },
    select: { id: true, status: true, matchedChainCreditId: true },
  });
  const depositsByCreditId = new Map<string, typeof deposits>();
  for (const d of deposits) {
    if (!d.matchedChainCreditId) continue;
    const list = depositsByCreditId.get(d.matchedChainCreditId) ?? [];
    list.push(d);
    depositsByCreditId.set(d.matchedChainCreditId, list);
  }

  const findings: ReconciliationFinding[] = [];
  for (const c of credits) {
    const linked = depositsByCreditId.get(c.id) ?? [];
    if (linked.length === 0) {
      findings.push({
        checkName: "matched_credit_broken_deposit_link",
        severity: "P1",
        network: c.network,
        subjectType: "ChainCredit",
        subjectId: c.id,
        message: `ChainCredit ${c.id} is consumed=true processingStatus=MATCHED, but no Deposit has matchedChainCreditId=${c.id}.`,
      });
      continue;
    }
    // matchedChainCreditId is @unique, so more than one row here is itself
    // covered by duplicate_matched_chain_credit (#7); still checked per-row
    // as defense-in-depth.
    for (const d of linked) {
      if (d.status !== "COMPLETED") {
        findings.push({
          checkName: "matched_credit_broken_deposit_link",
          severity: "P1",
          network: c.network,
          subjectType: "ChainCredit",
          subjectId: c.id,
          message: `ChainCredit ${c.id} is matched to deposit ${d.id} whose status is ${d.status}, not COMPLETED.`,
        });
      }
    }
  }
  return findings;
}

/** #6 duplicate_chain_credit_identity — defense-in-depth against the DB's own @@unique([network, tokenContract, txHash, eventIndex]). */
async function checkDuplicateChainCreditIdentity(): Promise<ReconciliationFinding[]> {
  const groups = await prisma.chainCredit.groupBy({
    by: ["network", "tokenContract", "txHash", "eventIndex"],
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  });
  if (groups.length === 0) return [];

  const findings: ReconciliationFinding[] = [];
  for (const g of groups) {
    const rows = await prisma.chainCredit.findMany({
      where: {
        network: g.network,
        tokenContract: g.tokenContract,
        txHash: g.txHash,
        eventIndex: g.eventIndex,
      },
      select: { id: true },
    });
    for (const r of rows) {
      findings.push({
        checkName: "duplicate_chain_credit_identity",
        severity: "P1",
        network: "global",
        subjectType: "ChainCredit",
        subjectId: r.id,
        message: `ChainCredit ${r.id} shares identity (network=${g.network}, tokenContract=${g.tokenContract}, txHash=${g.txHash}, eventIndex=${g.eventIndex}) with ${g._count.id - 1} other row(s); this should be impossible under the DB's own unique constraint.`,
      });
    }
  }
  return findings;
}

/** #7 duplicate_matched_chain_credit — defense-in-depth against Deposit.matchedChainCreditId's @unique. */
async function checkDuplicateMatchedChainCredit(): Promise<ReconciliationFinding[]> {
  const groups = await prisma.deposit.groupBy({
    by: ["matchedChainCreditId"],
    where: { matchedChainCreditId: { not: null } },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  });
  if (groups.length === 0) return [];

  const findings: ReconciliationFinding[] = [];
  for (const g of groups) {
    const rows = await prisma.deposit.findMany({
      where: { matchedChainCreditId: g.matchedChainCreditId },
      select: { id: true },
    });
    for (const r of rows) {
      findings.push({
        checkName: "duplicate_matched_chain_credit",
        severity: "P1",
        network: "global",
        subjectType: "Deposit",
        subjectId: r.id,
        message: `Deposit ${r.id} shares matchedChainCreditId=${g.matchedChainCreditId} with ${g._count.id - 1} other deposit(s); this should be impossible under that column's unique constraint.`,
      });
    }
  }
  return findings;
}

/** #8 stuck_unconfirmed_transfer (WARNING) */
async function checkStuckUnconfirmedTransfer(now: Date): Promise<ReconciliationFinding[]> {
  const cutoff = new Date(now.getTime() - STUCK_TRANSFER_AGE_MS);
  const credits = await prisma.chainCredit.findMany({
    where: {
      finalityState: { in: ["DETECTED", "CONFIRMING"] },
      blockTimestamp: { lt: cutoff },
    },
    select: { id: true, network: true, finalityState: true, blockTimestamp: true },
  });
  return credits.map((c) => ({
    checkName: "stuck_unconfirmed_transfer",
    severity: "WARNING" as const,
    network: c.network,
    subjectType: "ChainCredit" as const,
    subjectId: c.id,
    message: `ChainCredit ${c.id} has been ${c.finalityState} since ${c.blockTimestamp.toISOString()}, older than the ${STUCK_TRANSFER_AGE_MS}ms stuck-transfer threshold.`,
  }));
}

/** Runs all 8 checks read-only. Never touches any other table. Safe to call as often as wanted. */
export async function findReconciliationIssues(now: Date = new Date()): Promise<ReconciliationFinding[]> {
  const [completedUsdtFindings, matchedCreditFindings, duplicateCreditFindings, duplicateDepositFindings, stuckFindings] =
    await Promise.all([
      checkCompletedUsdtDeposits(),
      checkMatchedCreditBrokenDepositLink(),
      checkDuplicateChainCreditIdentity(),
      checkDuplicateMatchedChainCredit(),
      checkStuckUnconfirmedTransfer(now),
    ]);
  return [
    ...completedUsdtFindings,
    ...matchedCreditFindings,
    ...duplicateCreditFindings,
    ...duplicateDepositFindings,
    ...stuckFindings,
  ];
}

export interface ReconciliationRunSummary {
  findings: ReconciliationFinding[];
  /** Findings that are newly OPEN this run (were not OPEN before). */
  opened: number;
  /** Findings that were already OPEN and still are. */
  stillOpen: number;
  /** Previously-OPEN issues not found this run — marked RESOLVED. */
  resolved: number;
}

function issueKey(row: { checkName: string; subjectType: string; subjectId: string }): string {
  return `${row.checkName}\u0000${row.subjectType}\u0000${row.subjectId}`;
}

/**
 * Runs findReconciliationIssues(), then upserts the ReconciliationIssue
 * table: creates/refreshes an OPEN row per finding (keyed on
 * checkName+subjectType+subjectId), and marks any previously-OPEN issue NOT
 * in this run's findings as RESOLVED (resolvedAt = now). This is the only
 * function that writes to ReconciliationIssue.
 */
export async function runUsdtReconciliation(now: Date = new Date()): Promise<ReconciliationRunSummary> {
  const findings = await findReconciliationIssues(now);

  const openBefore = await prisma.reconciliationIssue.findMany({
    where: { status: "OPEN" },
    select: { checkName: true, subjectType: true, subjectId: true },
  });
  const openBeforeKeys = new Set(openBefore.map(issueKey));

  let opened = 0;
  let stillOpen = 0;
  const findingKeys = new Set<string>();

  const upserts = findings.map((f) => {
    const key = issueKey(f);
    findingKeys.add(key);
    if (openBeforeKeys.has(key)) {
      stillOpen += 1;
    } else {
      opened += 1;
    }
    return prisma.reconciliationIssue.upsert({
      where: {
        checkName_subjectType_subjectId: {
          checkName: f.checkName,
          subjectType: f.subjectType,
          subjectId: f.subjectId,
        },
      },
      create: {
        checkName: f.checkName,
        severity: f.severity,
        network: f.network,
        subjectType: f.subjectType,
        subjectId: f.subjectId,
        message: f.message,
      },
      update: {
        severity: f.severity,
        network: f.network,
        message: f.message,
        status: "OPEN",
        resolvedAt: null,
      },
    });
  });

  const toResolve = openBefore.filter((row) => !findingKeys.has(issueKey(row)));
  const resolveOps = toResolve.map((row) =>
    prisma.reconciliationIssue.update({
      where: {
        checkName_subjectType_subjectId: {
          checkName: row.checkName,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
        },
      },
      data: { status: "RESOLVED", resolvedAt: now },
    }),
  );

  if (upserts.length > 0 || resolveOps.length > 0) {
    await prisma.$transaction([...upserts, ...resolveOps]);
  }

  return { findings, opened, stillOpen, resolved: toResolve.length };
}

/** Open issues, newest first. */
export async function listOpenReconciliationIssues(limit = 100): Promise<ReconciliationIssue[]> {
  return prisma.reconciliationIssue.findMany({
    where: { status: "OPEN" },
    orderBy: { firstDetectedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}

/** { p1, warning } counts of currently-OPEN issues — cheap, for a stat card / nav badge. */
export async function countOpenReconciliationIssues(): Promise<{ p1: number; warning: number }> {
  const [p1, warning] = await Promise.all([
    prisma.reconciliationIssue.count({ where: { status: "OPEN", severity: "P1" } }),
    prisma.reconciliationIssue.count({ where: { status: "OPEN", severity: "WARNING" } }),
  ]);
  return { p1, warning };
}

/** Recently resolved issues, most recently resolved first (for a small "recently fixed" list). */
export async function listRecentlyResolvedReconciliationIssues(limit = 20): Promise<ReconciliationIssue[]> {
  return prisma.reconciliationIssue.findMany({
    where: { status: "RESOLVED" },
    orderBy: { resolvedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}
