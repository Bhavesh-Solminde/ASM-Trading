import { randomBytes } from "node:crypto";
import { prisma } from "../client";
import {
  DepositAlreadyResolved,
  MAX_DEPOSIT_USDT_MINOR,
  MIN_DEPOSIT_USDT_MINOR,
  creditDepositToAccount,
} from "./deposit";
import type { ChainCredit, Deposit } from "../../generated/prisma/client";

/**
 * Payment-gateway (Tatum) USDT deposits: every deposit is issued its OWN
 * receiving address, derived from the gateway's HD-wallet xpub at a unique
 * index. Matching is therefore by address, never by amount — the opposite of
 * the manual flow (createUsdtDepositIntent / matchChainCreditToDeposit),
 * which is untouched. See
 * docs/superpowers/specs/2026-10-05-tatum-usdt-gateway-design.md.
 *
 * packages/db stays network-agnostic: no HTTP, no env. Address derivation
 * and chain verification live in @asm/tatum; this file only persists.
 */

export const GATEWAY_TATUM = "TATUM";
/** Per-address deposits have no amount reservation to protect, so the window can be generous. */
export const GATEWAY_USDT_DEPOSIT_TTL_MINUTES = 30;
/**
 * A deposit stays AWAITING_PAYMENT this long past expiresAt before being
 * marked EXPIRED, so a payment SENT in time (judged by block timestamp) but
 * finalized after expiresAt still auto-credits — creditDepositToAccount
 * requires a live deposit.
 */
export const GATEWAY_EXPIRE_GRACE_MS = 2 * 60 * 60 * 1000;
/** The poller keeps checking an address this long past expiresAt, so a late payment still lands in admin review. */
export const GATEWAY_WATCH_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Next HD derivation index for `network` — 1, 2, 3, … (0 is reserved and
 * never issued). One atomic upsert-increment, so concurrent deposits can
 * never be handed the same index (and therefore the same address).
 */
export async function allocateGatewayAddressIndex(network: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ nextIndex: number }[]>`
    INSERT INTO "GatewayAddressCounter" ("network", "nextIndex", "updatedAt")
    VALUES (${network}, 2, NOW())
    ON CONFLICT ("network")
    DO UPDATE SET "nextIndex" = "GatewayAddressCounter"."nextIndex" + 1, "updatedAt" = NOW()
    RETURNING "nextIndex"`;
  const next = rows[0]?.nextIndex;
  if (typeof next !== "number") throw new Error("Failed to allocate a gateway address index.");
  // nextIndex is the index the NEXT caller gets; this caller's is one less.
  return next - 1;
}

export async function createGatewayUsdtDeposit(input: {
  userId: string;
  amountUsdtMinorRequested: number;
  network: string;
  tokenContract: string;
  receivingAddress: string;
  addressIndex: number;
  correlationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<Deposit> {
  const amount = input.amountUsdtMinorRequested;
  if (amount < MIN_DEPOSIT_USDT_MINOR) {
    throw new Error(`Below the minimum deposit of $${(MIN_DEPOSIT_USDT_MINOR / 100).toLocaleString("en-US")}.`);
  }
  if (amount > MAX_DEPOSIT_USDT_MINOR) {
    throw new Error(`Above the maximum deposit of $${(MAX_DEPOSIT_USDT_MINOR / 100).toLocaleString("en-US")}.`);
  }
  if (!Number.isInteger(input.addressIndex) || input.addressIndex < 1) {
    throw new Error("Gateway address index must be a positive integer.");
  }

  return prisma.deposit.create({
    data: {
      userId: input.userId,
      method: "USDT",
      gateway: GATEWAY_TATUM,
      gatewayAddressIndex: input.addressIndex,
      // Same legacy-column conventions as createUsdtDepositIntent: amountUsd 0
      // and amountInr = -amountUsdtMinor (never a real INR amount). Gateway
      // rows are excluded from both live-amount unique indexes, so no offset
      // probing is needed — the user pays exactly what they asked for.
      amountUsd: 0,
      amountInr: -amount,
      amountUsdtMinor: amount,
      vpa: input.receivingAddress,
      network: input.network,
      tokenContract: input.tokenContract,
      receivingAddress: input.receivingAddress,
      checkoutToken: randomBytes(24).toString("base64url"),
      status: "AWAITING_PAYMENT",
      correlationId: input.correlationId,
      expiresAt: new Date(Date.now() + GATEWAY_USDT_DEPOSIT_TTL_MINUTES * 60_000),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function setGatewaySubscriptionId(depositId: string, subscriptionId: string | null): Promise<void> {
  await prisma.deposit.update({ where: { id: depositId }, data: { gatewaySubscriptionId: subscriptionId } });
}

/** The gateway deposit that owns `address` on `network` (addresses are never reused, so at most one). */
export async function findGatewayDepositByAddress(network: string, address: string): Promise<Deposit | null> {
  return prisma.deposit.findFirst({
    where: { gateway: GATEWAY_TATUM, network, receivingAddress: address },
    orderBy: { createdAt: "desc" },
  });
}

/** Deposits whose address the poller should scan: still live, or expired less than GATEWAY_WATCH_AFTER_EXPIRY_MS ago. */
export async function listGatewayDepositsToWatch(now: Date, limit = 500): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: {
      gateway: GATEWAY_TATUM,
      OR: [
        { status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] } },
        { status: "EXPIRED", expiresAt: { gt: new Date(now.getTime() - GATEWAY_WATCH_AFTER_EXPIRY_MS) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** AWAITING_PAYMENT gateway deposits more than GATEWAY_EXPIRE_GRACE_MS past expiresAt. */
export async function listGatewayDepositsToExpire(now: Date, limit = 500): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: {
      gateway: GATEWAY_TATUM,
      status: "AWAITING_PAYMENT",
      expiresAt: { lt: new Date(now.getTime() - GATEWAY_EXPIRE_GRACE_MS) },
    },
    take: limit,
  });
}

/** Guarded AWAITING_PAYMENT -> EXPIRED. False if something else resolved it first. */
export async function expireGatewayDeposit(depositId: string): Promise<boolean> {
  const res = await prisma.deposit.updateMany({
    where: { id: depositId, gateway: GATEWAY_TATUM, status: "AWAITING_PAYMENT" },
    data: { status: "EXPIRED" },
  });
  return res.count === 1;
}

/** Promotes every DETECTED/CONFIRMING row of one transaction to FINAL. Returns how many moved. */
export async function markChainCreditsFinalForTx(input: {
  network: string;
  tokenContract: string;
  txHash: string;
}): Promise<number> {
  const res = await prisma.chainCredit.updateMany({
    where: {
      network: input.network,
      tokenContract: input.tokenContract,
      txHash: input.txHash,
      finalityState: { in: ["DETECTED", "CONFIRMING"] },
    },
    data: { finalityState: "FINAL", lastCheckedAt: new Date() },
  });
  return res.count;
}

/** Marks every not-yet-final row of a transaction that turned out to have reverted. */
export async function markChainCreditsFailedForTx(input: {
  network: string;
  tokenContract: string;
  txHash: string;
}): Promise<number> {
  const res = await prisma.chainCredit.updateMany({
    where: {
      network: input.network,
      tokenContract: input.tokenContract,
      txHash: input.txHash,
      finalityState: { in: ["DETECTED", "CONFIRMING"] },
    },
    data: { finalityState: "FAILED_ON_CHAIN", lastCheckedAt: new Date() },
  });
  return res.count;
}

/**
 * Not-yet-final PENDING credits sent to a gateway address — the poller
 * re-checks each until FINAL (then matches it). Oldest-checked first.
 */
export async function listDetectedGatewayCredits(limit: number): Promise<ChainCredit[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id" FROM "ChainCredit" c
    WHERE c."finalityState" IN ('DETECTED', 'CONFIRMING')
      AND c."processingStatus" = 'PENDING'
      AND EXISTS (
        SELECT 1 FROM "Deposit" d
        WHERE d."gateway" = ${GATEWAY_TATUM}
          AND d."network" = c."network"
          AND d."receivingAddress" = c."toAddress"
      )
    ORDER BY c."lastCheckedAt" ASC NULLS FIRST, c."createdAt" ASC
    LIMIT ${limit}`;
  if (rows.length === 0) return [];
  return prisma.chainCredit.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

/** FINAL, still-PENDING gateway credits (e.g. left behind by a crash between finalize and match). */
export async function listFinalUnmatchedGatewayCredits(limit: number): Promise<ChainCredit[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id" FROM "ChainCredit" c
    WHERE c."finalityState" = 'FINAL'
      AND c."processingStatus" = 'PENDING'
      AND EXISTS (
        SELECT 1 FROM "Deposit" d
        WHERE d."gateway" = ${GATEWAY_TATUM}
          AND d."network" = c."network"
          AND d."receivingAddress" = c."toAddress"
      )
    ORDER BY c."createdAt" ASC
    LIMIT ${limit}`;
  if (rows.length === 0) return [];
  return prisma.chainCredit.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

/** Latest transfer seen to a gateway deposit's address — drives the checkout page's status poller. */
export async function findLatestChainCreditForGatewayDeposit(deposit: Deposit): Promise<ChainCredit | null> {
  if (!deposit.gateway || !deposit.network || !deposit.receivingAddress) return null;
  return prisma.chainCredit.findFirst({
    where: { network: deposit.network, toAddress: deposit.receivingAddress },
    orderBy: { createdAt: "desc" },
  });
}

export type GatewayManualReviewReason =
  | "ADDRESS_ALREADY_USED"
  | "EXPIRED_DEPOSIT"
  | "WRONG_TOKEN_CONTRACT"
  | "UNDERPAID"
  | "PRECISION_NOT_REPRESENTABLE";

export type GatewayMatchOutcome =
  | { kind: "credited"; depositId: string; creditedUsdtMinor: number }
  | { kind: "manual_review"; reason: GatewayManualReviewReason; depositId: string | null }
  | { kind: "unmatched" }
  | { kind: "skipped"; reason: "not_final" | "already_processed" };

/**
 * The ChainCredit -> gateway Deposit decision. The deposit is identified by
 * the credit's destination address alone (each address belongs to exactly one
 * deposit). Anything short of a clean, on-time, full payment of the right
 * token goes to the existing admin USDT review queue — never guessed.
 */
export async function matchGatewayChainCredit(chainCreditId: string): Promise<GatewayMatchOutcome> {
  const credit = await prisma.chainCredit.findUniqueOrThrow({ where: { id: chainCreditId } });

  if (credit.processingStatus !== "PENDING") return { kind: "skipped", reason: "already_processed" };
  if (credit.finalityState !== "FINAL") return { kind: "skipped", reason: "not_final" };

  const deposit = await findGatewayDepositByAddress(credit.network, credit.toAddress);
  if (!deposit) {
    const res = await prisma.chainCredit.updateMany({
      where: { id: credit.id, processingStatus: "PENDING" },
      data: { processingStatus: "UNMATCHED", reviewReason: "NO_LIVE_DEPOSIT" },
    });
    return res.count === 1 ? { kind: "unmatched" } : { kind: "skipped", reason: "already_processed" };
  }

  const review = async (reason: GatewayManualReviewReason): Promise<GatewayMatchOutcome> => {
    const res = await prisma.chainCredit.updateMany({
      where: { id: credit.id, processingStatus: "PENDING" },
      data: { processingStatus: "MANUAL_REVIEW", reviewReason: reason },
    });
    return res.count === 1
      ? { kind: "manual_review", reason, depositId: deposit.id }
      : { kind: "skipped", reason: "already_processed" };
  };

  if (deposit.status === "COMPLETED" || deposit.status === "REJECTED") return review("ADDRESS_ALREADY_USED");
  if (credit.tokenContract !== deposit.tokenContract) return review("WRONG_TOKEN_CONTRACT");
  if (deposit.status === "EXPIRED" || credit.blockTimestamp.getTime() >= deposit.expiresAt.getTime()) {
    return review("EXPIRED_DEPOSIT");
  }
  if (credit.normalizedAmountMinor === null) return review("PRECISION_NOT_REPRESENTABLE");
  if (deposit.amountUsdtMinor === null || credit.normalizedAmountMinor < deposit.amountUsdtMinor) {
    return review("UNDERPAID");
  }

  try {
    await creditDepositToAccount({
      depositId: deposit.id,
      adminId: null,
      chainCreditId: credit.id,
      receivedUsdtMinor: credit.normalizedAmountMinor,
    });
  } catch (err) {
    // A concurrent settle (webhook + poller racing on the same tx) won.
    if (err instanceof DepositAlreadyResolved) return { kind: "skipped", reason: "already_processed" };
    throw err;
  }
  return { kind: "credited", depositId: deposit.id, creditedUsdtMinor: credit.normalizedAmountMinor };
}
