import { prisma } from "../client";
import { creditDepositToAccount, DepositAlreadyResolved } from "./deposit";
import type { ChainCredit, Deposit } from "../../generated/prisma/client";

/**
 * Admin-side handling of USDT ChainCredits the matcher could not auto-credit
 * (MANUAL_REVIEW / UNMATCHED): list the queue, suggest deposits, resolve a
 * credit to a deposit for the amount actually received, or dismiss it.
 */

export class ChainCreditResolutionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainCreditResolutionRefused";
  }
}

const REVIEWABLE_STATUSES = ["MANUAL_REVIEW", "UNMATCHED"] as const;
const REVIEW_QUEUE_WHERE = {
  consumed: false,
  processingStatus: { in: [...REVIEWABLE_STATUSES] },
};

/** Unconsumed rows in MANUAL_REVIEW or UNMATCHED, newest blockTimestamp first. */
export async function listUsdtReviewQueue(limit: number): Promise<ChainCredit[]> {
  return prisma.chainCredit.findMany({
    where: REVIEW_QUEUE_WHERE,
    orderBy: { blockTimestamp: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}

/** Count of the same set, for a stat card. */
export async function countUsdtReviewQueue(): Promise<number> {
  return prisma.chainCredit.count({ where: REVIEW_QUEUE_WHERE });
}

const CANDIDATE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const CANDIDATE_LOOKAHEAD_MS = 10 * 60 * 1000;
const CANDIDATE_FETCH_CAP = 200;

type CandidateDeposit = Deposit & {
  user: { email: string; firstName: string | null; lastName: string | null };
};

/** Deposit.claimedTxHash is stored as 64 lowercase hex chars without 0x; normalize a ChainCredit's txHash the same way before comparing. */
function normalizeTxHash(hash: string): string {
  return hash.trim().replace(/^0x/i, "").toLowerCase();
}

/** USDT deposits an admin could plausibly attach this credit to: method "USDT", same network/tokenContract as the credit and receivingAddress === credit.toAddress, status in (AWAITING_PAYMENT, EXPIRED), and EITHER createdAt between blockTimestamp-48h and blockTimestamp+10min OR the user claimed this credit's txHash ("I already paid" — see claimUsdtPayment; any age). Fetch up to 200, sort in JS: deposits claiming this txHash first, then by |amountUsdtMinor - credit.normalizedAmountMinor| ascending (nulls last), then createdAt desc; return the first `limit` (default 20). Includes the user's email/firstName/lastName. A claim only ORDERS the suggestions — it is unverified evidence (tx hashes are public) and never credits anything. */
export async function listCandidateDepositsForChainCredit(
  chainCreditId: string,
  limit = 20,
): Promise<CandidateDeposit[]> {
  const credit = await prisma.chainCredit.findUnique({ where: { id: chainCreditId } });
  if (!credit) return [];

  const ts = credit.blockTimestamp.getTime();
  const claimedHash = normalizeTxHash(credit.txHash);
  const base = {
    method: "USDT",
    network: credit.network,
    tokenContract: credit.tokenContract,
    receivingAddress: credit.toAddress,
    status: { in: ["AWAITING_PAYMENT" as const, "EXPIRED" as const] },
  };
  const include = { user: { select: { email: true, firstName: true, lastName: true } } };

  // Two queries rather than one OR, so a flood of in-window deposits can never
  // push a claimant (any age) out of the fetch cap.
  const [claimants, windowRows] = await Promise.all([
    prisma.deposit.findMany({
      where: { ...base, claimedTxHash: claimedHash },
      include,
      orderBy: { createdAt: "desc" },
      take: CANDIDATE_FETCH_CAP,
    }),
    prisma.deposit.findMany({
      where: {
        ...base,
        createdAt: {
          gte: new Date(ts - CANDIDATE_LOOKBACK_MS),
          lte: new Date(ts + CANDIDATE_LOOKAHEAD_MS),
        },
      },
      include,
      orderBy: { createdAt: "desc" },
      take: CANDIDATE_FETCH_CAP,
    }),
  ]);
  const claimantIds = new Set(claimants.map((d) => d.id));
  const rows = [...claimants, ...windowRows.filter((d) => !claimantIds.has(d.id))];

  const target = credit.normalizedAmountMinor;
  const distance = (d: Deposit): number | null =>
    target === null || d.amountUsdtMinor === null ? null : Math.abs(d.amountUsdtMinor - target);

  rows.sort((a, b) => {
    const ca = claimantIds.has(a.id);
    const cb = claimantIds.has(b.id);
    if (ca !== cb) return ca ? -1 : 1;
    const da = distance(a);
    const db = distance(b);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return rows.slice(0, Math.max(limit, 0));
}

export type UsdtClaimEvidence = {
  depositId: string;
  status: string; // Deposit.status
  amountUsdtMinor: number | null; // reserved
  screenshotUrl: string | null;
  createdAt: Date;
  user: { id: string; email: string };
};
export type UsdtKnownSender = { userId: string; email: string; paidCount: number };
export type UsdtReviewEvidence = { claims: UsdtClaimEvidence[]; knownSenders: UsdtKnownSender[] };

/** Batch (no N+1): for each given ChainCredit id → claims = USDT deposits whose claimedTxHash equals that credit's txHash (any status), newest first; knownSenders = distinct users owning deposits linked (Deposit.matchedChainCreditId) to OTHER ChainCredits with the same fromAddress and processingStatus "MATCHED", with a count per user, most paid first. Every requested id present in the result (empty arrays if nothing).
 *
 * Both are unverified EVIDENCE for the admin: a claim can be made by anyone
 * (tx hashes are public), and a shared sender address may be an exchange hot
 * wallet used by many unrelated users. Nothing here credits or matches. */
export async function getUsdtReviewEvidence(
  chainCreditIds: string[],
): Promise<Record<string, UsdtReviewEvidence>> {
  const ids = [...new Set(chainCreditIds)];
  const result: Record<string, UsdtReviewEvidence> = {};
  for (const id of ids) result[id] = { claims: [], knownSenders: [] };
  if (ids.length === 0) return result;

  const credits = await prisma.chainCredit.findMany({
    where: { id: { in: ids } },
    select: { id: true, txHash: true, fromAddress: true },
  });
  if (credits.length === 0) return result;

  const hashes = [...new Set(credits.map((c) => normalizeTxHash(c.txHash)))];
  const senders = [...new Set(credits.map((c) => c.fromAddress))];

  const [claimRows, senderCredits] = await Promise.all([
    prisma.deposit.findMany({
      where: { method: "USDT", claimedTxHash: { in: hashes } },
      select: {
        id: true,
        status: true,
        amountUsdtMinor: true,
        screenshotUrl: true,
        createdAt: true,
        claimedTxHash: true,
        user: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.chainCredit.findMany({
      where: { fromAddress: { in: senders }, processingStatus: "MATCHED" },
      select: { id: true, fromAddress: true },
    }),
  ]);

  const paidDeposits =
    senderCredits.length === 0
      ? []
      : await prisma.deposit.findMany({
          where: { matchedChainCreditId: { in: senderCredits.map((c) => c.id) } },
          select: { matchedChainCreditId: true, user: { select: { id: true, email: true } } },
        });

  const claimsByHash = new Map<string, UsdtClaimEvidence[]>();
  for (const d of claimRows) {
    if (!d.claimedTxHash) continue;
    const list = claimsByHash.get(d.claimedTxHash) ?? [];
    list.push({
      depositId: d.id,
      status: d.status,
      amountUsdtMinor: d.amountUsdtMinor,
      screenshotUrl: d.screenshotUrl,
      createdAt: d.createdAt,
      user: { id: d.user.id, email: d.user.email },
    });
    claimsByHash.set(d.claimedTxHash, list);
  }

  const senderOfCredit = new Map(senderCredits.map((c) => [c.id, c.fromAddress]));
  // fromAddress -> list of (matched credit id, user) pairs.
  const paidBySender = new Map<string, { creditId: string; user: { id: string; email: string } }[]>();
  for (const d of paidDeposits) {
    if (!d.matchedChainCreditId) continue;
    const from = senderOfCredit.get(d.matchedChainCreditId);
    if (from === undefined) continue;
    const list = paidBySender.get(from) ?? [];
    list.push({ creditId: d.matchedChainCreditId, user: d.user });
    paidBySender.set(from, list);
  }

  for (const credit of credits) {
    const claims = claimsByHash.get(normalizeTxHash(credit.txHash)) ?? [];

    const counts = new Map<string, UsdtKnownSender>();
    for (const p of paidBySender.get(credit.fromAddress) ?? []) {
      if (p.creditId === credit.id) continue; // OTHER credits only
      const entry = counts.get(p.user.id) ?? { userId: p.user.id, email: p.user.email, paidCount: 0 };
      entry.paidCount += 1;
      counts.set(p.user.id, entry);
    }
    const knownSenders = [...counts.values()].sort(
      (a, b) => b.paidCount - a.paidCount || a.email.localeCompare(b.email),
    );

    result[credit.id] = { claims: [...claims], knownSenders };
  }

  return result;
}

/** Admin credits a reviewed on-chain payment to a user's USDT deposit, for the amount actually received. */
export async function resolveChainCreditToDeposit(input: {
  chainCreditId: string;
  depositId: string;
  adminId: string;
  expectedNetwork: string;
  expectedTokenContract: string;
  expectedReceivingAddress: string;
}): Promise<void> {
  const credit = await prisma.chainCredit.findUnique({ where: { id: input.chainCreditId } });
  if (!credit) throw new ChainCreditResolutionRefused("Payment not found.");
  if (credit.consumed) throw new ChainCreditResolutionRefused("Already resolved.");
  if (!(REVIEWABLE_STATUSES as readonly string[]).includes(credit.processingStatus)) {
    throw new ChainCreditResolutionRefused("Payment is not awaiting review.");
  }
  if (credit.finalityState !== "FINAL") {
    throw new ChainCreditResolutionRefused("Payment is not final on-chain.");
  }
  const amount = credit.normalizedAmountMinor;
  if (amount === null || amount <= 0) {
    throw new ChainCreditResolutionRefused("Payment amount cannot be credited at 2-decimal precision.");
  }
  // Re-verified against LIVE config, never trusted from the stored row alone —
  // a transfer to the wrong address/contract/network is not our money.
  if (credit.network !== input.expectedNetwork) {
    throw new ChainCreditResolutionRefused("Payment is on the wrong network.");
  }
  if (credit.tokenContract !== input.expectedTokenContract) {
    throw new ChainCreditResolutionRefused("Payment is for the wrong token contract.");
  }
  if (credit.toAddress !== input.expectedReceivingAddress) {
    throw new ChainCreditResolutionRefused("Payment was sent to a different address.");
  }

  const deposit = await prisma.deposit.findUnique({ where: { id: input.depositId } });
  if (!deposit) throw new ChainCreditResolutionRefused("Deposit not found.");
  if (deposit.method !== "USDT") {
    throw new ChainCreditResolutionRefused("Deposit is not a USDT deposit.");
  }
  if (deposit.status !== "AWAITING_PAYMENT" && deposit.status !== "EXPIRED") {
    throw new ChainCreditResolutionRefused(`Deposit is ${deposit.status}, not open for resolution.`);
  }
  if (
    deposit.network !== credit.network ||
    deposit.tokenContract !== credit.tokenContract ||
    deposit.receivingAddress !== credit.toAddress
  ) {
    throw new ChainCreditResolutionRefused("Deposit does not match this payment's network, token or address.");
  }

  try {
    await creditDepositToAccount({
      depositId: deposit.id,
      adminId: input.adminId,
      chainCreditId: credit.id,
      adminResolution: { usdtMinorOverride: amount },
    });
  } catch (err) {
    // A concurrent/double submit: the guarded UPDATEs inside the credit
    // transaction lost the race (DepositAlreadyResolved), or two resolves of
    // the same credit to DIFFERENT deposits collided on the unique
    // Deposit.matchedChainCreditId (P2002). Either way nothing was credited.
    if (err instanceof DepositAlreadyResolved || (err as { code?: string }).code === "P2002") {
      throw new ChainCreditResolutionRefused("Already resolved.");
    }
    throw err;
  }
}

/** Admin marks a reviewed on-chain payment as handled without crediting (e.g. refunded off-platform, spam). */
export async function dismissChainCredit(input: {
  chainCreditId: string;
  adminId: string;
  note: string;
}): Promise<void> {
  const note = input.note.trim();
  if (note.length === 0) throw new ChainCreditResolutionRefused("A note is required.");
  if (note.length > 500) throw new ChainCreditResolutionRefused("Note is too long (max 500 characters).");

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.chainCredit.updateMany({
      where: {
        id: input.chainCreditId,
        consumed: false,
        processingStatus: { in: [...REVIEWABLE_STATUSES] },
      },
      data: { processingStatus: "DISMISSED", consumed: true },
    });
    if (claimed.count !== 1) {
      throw new ChainCreditResolutionRefused("Already resolved or not reviewable.");
    }

    const credit = await tx.chainCredit.findUniqueOrThrow({
      where: { id: input.chainCreditId },
      select: { reviewReason: true, normalizedAmountMinor: true, txHash: true },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "chain_credit.dismissed",
        targetType: "ChainCredit",
        targetId: input.chainCreditId,
        after: {
          note,
          reviewReason: credit.reviewReason,
          normalizedAmountMinor: credit.normalizedAmountMinor,
          txHash: credit.txHash,
        },
      },
    });
  });
}
