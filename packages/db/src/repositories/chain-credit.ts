import { prisma } from "../client";
import { rawToNormalizedMinor } from "../usdt-money";
import type { ChainCredit } from "../../generated/prisma/client";

/**
 * The ChainCredit analog of createBankCreditIfNew. Returns null on a
 * duplicate (network, tokenContract, txHash, eventIndex) rather than
 * throwing — the ingestion loop deliberately re-scans an overlap window on
 * every tick (see the chain-watcher design doc), so re-observing the same
 * transfer is normal operation, not an error.
 *
 * normalizedAmountMinor is computed here, once, at the point of creation —
 * never recomputed or trusted from anywhere else — so a raw amount with
 * genuine sub-cent on-chain precision is null from the moment this row
 * exists, and every downstream reader (the matcher, reconciliation, the
 * admin panel) sees the same non-representable-precision fact consistently.
 */
export async function createChainCreditIfNew(input: {
  network: string;
  tokenContract: string;
  txHash: string;
  eventIndex: number;
  fromAddress: string;
  toAddress: string;
  rawAmount: bigint;
  blockNumber: bigint;
  blockTimestamp: Date;
  rawPayload: unknown;
}): Promise<ChainCredit | null> {
  const normalizedAmountMinor = rawToNormalizedMinor(input.rawAmount);
  try {
    return await prisma.chainCredit.create({
      data: {
        network: input.network,
        tokenContract: input.tokenContract,
        txHash: input.txHash,
        eventIndex: input.eventIndex,
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        rawAmount: input.rawAmount,
        normalizedAmountMinor,
        blockNumber: input.blockNumber,
        blockTimestamp: input.blockTimestamp,
        rawPayload: input.rawPayload as never,
        ...(normalizedAmountMinor === null
          ? { processingStatus: "MANUAL_REVIEW", reviewReason: "PRECISION_NOT_REPRESENTABLE" }
          : {}),
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return null;
    throw err;
  }
}

/** Looks up a ChainCredit by its unique identity — used to recover the row behind a createChainCreditIfNew P2002. */
export async function findChainCreditByKey(input: {
  network: string;
  tokenContract: string;
  txHash: string;
  eventIndex: number;
}): Promise<ChainCredit | null> {
  return prisma.chainCredit.findUnique({
    where: {
      network_tokenContract_txHash_eventIndex: {
        network: input.network,
        tokenContract: input.tokenContract,
        txHash: input.txHash,
        eventIndex: input.eventIndex,
      },
    },
  });
}

/** One ChainCredit by its own id — the checkout page's status-polling endpoint uses this to read the linked row's finality/processing state. */
export async function findChainCreditById(id: string): Promise<ChainCredit | null> {
  return prisma.chainCredit.findUnique({ where: { id } });
}

/**
 * DISPLAY ONLY — never used for matching or crediting. A deposit is only
 * linked to its ChainCredit (matchedChainCreditId) at the moment it's
 * credited, so before that the checkout page has no link to show "payment
 * detected / confirming" progress. This finds the transfer the matcher would
 * later pick — same network/contract/destination/exact amount — observed no
 * earlier than shortly before the deposit was created (the slack absorbs
 * clock skew between this DB and chain block timestamps).
 */
export const DISPLAY_LOOKUP_SLACK_MS = 2 * 60_000;

export async function findChainCreditForDepositDisplay(input: {
  network: string;
  tokenContract: string;
  receivingAddress: string;
  amountUsdtMinor: number;
  depositCreatedAt: Date;
}): Promise<ChainCredit | null> {
  return prisma.chainCredit.findFirst({
    where: {
      network: input.network,
      tokenContract: input.tokenContract,
      toAddress: input.receivingAddress,
      normalizedAmountMinor: input.amountUsdtMinor,
      blockTimestamp: { gte: new Date(input.depositCreatedAt.getTime() - DISPLAY_LOOKUP_SLACK_MS) },
    },
    orderBy: { blockTimestamp: "asc" },
  });
}

/** Rows in DETECTED/CONFIRMING, oldest first — what the finality poller re-checks each tick. */
export async function listPendingFinalityChecks(limit: number): Promise<ChainCredit[]> {
  return prisma.chainCredit.findMany({
    where: { finalityState: { in: ["DETECTED", "CONFIRMING"] } },
    orderBy: { blockTimestamp: "asc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}

/** FINAL + PENDING rows — what the matcher consumes each tick. */
export async function listPendingMatches(limit: number): Promise<ChainCredit[]> {
  return prisma.chainCredit.findMany({
    where: { finalityState: "FINAL", processingStatus: "PENDING" },
    orderBy: { blockTimestamp: "asc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}

/** Never matched to any deposit — the admin orphan queue, analog of listOrphanBankCredits. */
export async function listOrphanChainCredits(limit: number): Promise<ChainCredit[]> {
  return prisma.chainCredit.findMany({
    where: { processingStatus: "UNMATCHED" },
    orderBy: { blockTimestamp: "desc" },
    take: limit,
  });
}

/** The admin manual-review queue for USDT — anything flagged, with its reason visible. */
export async function listManualReviewChainCredits(limit: number): Promise<ChainCredit[]> {
  return prisma.chainCredit.findMany({
    where: { processingStatus: "MANUAL_REVIEW" },
    orderBy: { blockTimestamp: "desc" },
    take: limit,
  });
}
