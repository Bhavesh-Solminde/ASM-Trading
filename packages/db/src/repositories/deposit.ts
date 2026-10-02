import { randomBytes } from "node:crypto";
import { prisma } from "../client";
import { flagLinkageForUser } from "./fraud";
import { convertMinorBetween } from "./account";
import type { Deposit, Prisma } from "../../generated/prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * The PSP-style conversion rate. Deliberately above interbank — that spread is
 * the margin the real processors take before a customer has traded anything.
 */
export const USD_TO_INR_RATE = 107.64;

/**
 * The offset window is symmetric around the converted base amount: from
 * OFFSET_LOW to OFFSET_LOW + OFFSET_SPACE - 1 paise, i.e. -999 to +1000 for
 * the current values — roughly ±₹10, ~2,000 distinct slots. This is the pool
 * of possible unique amounts, NOT a tolerance applied at match time: matching
 * is always exact against whichever single value was actually reserved.
 */
export const OFFSET_LOW = -999;
export const OFFSET_SPACE = 2000;

export const DEPOSIT_TTL_MINUTES = 60;
export const MIN_DEPOSIT_USD_MINOR = 1_000; // $10.00
export const MAX_DEPOSIT_USD_MINOR = 96_100; // $961.00
// Deposits are collected in rupees over UPI. Paise (minor units).
export const MIN_DEPOSIT_INR_MINOR = 100_000; // ₹1,000.00
export const MAX_DEPOSIT_INR_MINOR = 100_000_000; // ₹10,00,000.00

/**
 * VPA no longer participates in matching (amount is the sole reconciliation
 * key — see the design doc), so every deposit uses one fixed demo collection
 * identity. It still matters for the QR/UPI deep link, which routes real
 * payment traffic to this address.
 */
export const DEMO_VPA = "ulkasolminde@okhdfcbank";

export class AmountSpaceExhausted extends Error {
  constructor() {
    super("No deposit slot is free right now. Try again in a few minutes.");
    this.name = "AmountSpaceExhausted";
  }
}

export class DepositNotFound extends Error {
  constructor() {
    super("Deposit not found.");
    this.name = "DepositNotFound";
  }
}

export class DepositAlreadyResolved extends Error {
  constructor() {
    super("This deposit has already been resolved.");
    this.name = "DepositAlreadyResolved";
  }
}

export class UtrAlreadyClaimed extends Error {
  constructor() {
    super("A reference has already been submitted for this deposit.");
    this.name = "UtrAlreadyClaimed";
  }
}

/**
 * Creates a deposit intent with a RESERVED amount, unique among all
 * currently-live deposits regardless of VPA.
 *
 * A UTR proves nothing on its own — anyone can type any number, and for a
 * relayed SMS there is often no UTR to check at all. But if ₹10,764.37 is
 * reserved to exactly one live deposit, a credit of exactly that amount can
 * only belong to that deposit. The amount is the identifier, which is why
 * it's an odd number rather than the round figure the user asked for.
 *
 * Uniqueness is enforced by a partial unique index (Task 1's migration), so
 * two concurrent requests cannot be handed the same amount. We retry on
 * collision rather than locking, starting from a random offset so concurrent
 * callers don't all probe the same slot first.
 */
export async function createDepositIntent(input: {
  userId: string;
  method: string;
  amountInrMinor: number;
  correlationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<Deposit> {
  if (input.amountInrMinor < MIN_DEPOSIT_INR_MINOR) {
    throw new Error(
      `Below the minimum deposit of ₹${(MIN_DEPOSIT_INR_MINOR / 100).toLocaleString("en-IN")}.`,
    );
  }
  if (input.amountInrMinor > MAX_DEPOSIT_INR_MINOR) {
    throw new Error(
      `Above the maximum deposit of ₹${(MAX_DEPOSIT_INR_MINOR / 100).toLocaleString("en-IN")}.`,
    );
  }

  // The user enters rupees; that is the amount reserved and, for an INR
  // account, credited. The USD figure is kept for the record only.
  const baseInr = input.amountInrMinor;
  const amountUsd = Math.round(input.amountInrMinor / USD_TO_INR_RATE);
  const expiresAt = new Date(Date.now() + DEPOSIT_TTL_MINUTES * 60_000);

  const start = randomBytes(2).readUInt16BE(0) % OFFSET_SPACE;

  for (let probe = 0; probe < OFFSET_SPACE; probe++) {
    const offset = OFFSET_LOW + ((start + probe) % OFFSET_SPACE);
    const amountInr = baseInr + offset;

    try {
      return await prisma.deposit.create({
        data: {
          userId: input.userId,
          method: input.method,
          amountUsd,
          amountInr,
          vpa: DEMO_VPA,
          checkoutToken: randomBytes(24).toString("base64url"),
          status: "AWAITING_PAYMENT",
          correlationId: input.correlationId,
          expiresAt,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") continue;
      throw err;
    }
  }

  throw new AmountSpaceExhausted();
}

/**
 * USDT reservation offsets — deliberately a SEPARATE constant pool from
 * OFFSET_LOW/OFFSET_SPACE above, in the same 2-decimal-cent granularity (not
 * the token's native 6dp/18dp — see usdt-money.ts for why): a window of ±$0.99
 * around the requested amount, ~198 distinct slots. Small on purpose: many
 * exchanges cannot send more than 2-decimal USDT precision anyway, so this is
 * also the most precision a real user could realistically hit exactly.
 */
export const USDT_OFFSET_LOW = -99;
export const USDT_OFFSET_SPACE = 198;

// The payment window the user sees counting down on the checkout page. A
// transfer counts as on time by its on-chain block timestamp, not by when the
// matcher gets to it (see findLiveDepositByUsdtAmount) — so a payment sent
// just before the deadline is still credited after it solidifies.
export const USDT_DEPOSIT_TTL_MINUTES = 5;
// Placeholder business bounds pending an explicit decision — deliberately
// conservative and easy to find/change; not derived from any verified
// requirement.
export const MIN_DEPOSIT_USDT_MINOR = 1_000; // $10.00
export const MAX_DEPOSIT_USDT_MINOR = 1_000_000; // $10,000.00

/**
 * The USDT analog of createDepositIntent — deliberately a SEPARATE function
 * rather than a branch inside createDepositIntent, so the INR path's
 * signature, behavior and tests are provably untouched by this feature (see
 * the design doc). Network/token contract/receiving address are the caller's
 * live config (read from process.env in the engine/web layer, never
 * hardcoded here — packages/db stays environment-agnostic, same as every
 * other repository function in this file).
 */
export async function createUsdtDepositIntent(input: {
  userId: string;
  amountUsdtMinorRequested: number;
  network: string;
  tokenContract: string;
  receivingAddress: string;
  correlationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<Deposit> {
  if (input.amountUsdtMinorRequested < MIN_DEPOSIT_USDT_MINOR) {
    throw new Error(
      `Below the minimum deposit of $${(MIN_DEPOSIT_USDT_MINOR / 100).toLocaleString("en-US")}.`,
    );
  }
  if (input.amountUsdtMinorRequested > MAX_DEPOSIT_USDT_MINOR) {
    throw new Error(
      `Above the maximum deposit of $${(MAX_DEPOSIT_USDT_MINOR / 100).toLocaleString("en-US")}.`,
    );
  }

  const expiresAt = new Date(Date.now() + USDT_DEPOSIT_TTL_MINUTES * 60_000);
  const start = randomBytes(2).readUInt16BE(0) % USDT_OFFSET_SPACE;

  for (let probe = 0; probe < USDT_OFFSET_SPACE; probe++) {
    const offset = USDT_OFFSET_LOW + ((start + probe) % USDT_OFFSET_SPACE);
    const amountUsdtMinor = input.amountUsdtMinorRequested + offset;
    if (amountUsdtMinor <= 0) continue;

    try {
      return await prisma.deposit.create({
        data: {
          userId: input.userId,
          method: "USDT",
          // amountUsd/amountInr are legacy required columns predating the
          // USDT method. amountUsd has no uniqueness constraint, so 0 (never
          // a real USD/INR value — MIN_DEPOSIT_*_MINOR forbid it) is a safe
          // "not applicable" sentinel. amountInr is NOT safe to fix at a
          // constant: it's the column Deposit_live_amount_unique enforces
          // uniqueness on while a deposit is live, and every USDT deposit
          // would otherwise collide with every OTHER live USDT deposit on
          // that same INR index (a real bug caught by this feature's own
          // tests — a second simultaneously-pending USDT deposit exhausted
          // the entire reservation probe because both rows fixed amountInr
          // at 0). Storing the negative of amountUsdtMinor instead is always
          // representable (Int, only 8-9 digits here even at the max
          // supported deposit), always negative (real INR amounts are always
          // positive — MIN_DEPOSIT_INR_MINOR — so no cross-currency
          // collision is possible), and — since amountUsdtMinor is already
          // unique among live USDT deposits via its own partial index — is
          // therefore unique among live rows on amountInr too, for free.
          amountUsd: 0,
          amountInr: -amountUsdtMinor,
          // vpa is a legacy NOT NULL column (the UPI collection identity);
          // for a USDT deposit it denormalizes the receiving address instead
          // of a fake/empty value — cosmetic display data only, same role it
          // already plays for INR (see matchCreditToDeposit's doc comment).
          vpa: input.receivingAddress,
          network: input.network,
          tokenContract: input.tokenContract,
          receivingAddress: input.receivingAddress,
          amountUsdtMinor,
          checkoutToken: randomBytes(24).toString("base64url"),
          status: "AWAITING_PAYMENT",
          correlationId: input.correlationId,
          expiresAt,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") continue;
      throw err;
    }
  }

  throw new AmountSpaceExhausted();
}

/** All live (not yet resolved) deposits that reserved exactly this amount. In
 * practice this is 0 or 1 rows — the partial unique index guarantees at most
 * one — but the caller (the matcher) treats more than one as a bug to flag,
 * not something to silently pick between. */
export async function findLiveDepositByAmount(amountInr: number): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: {
      amountInr,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
    },
  });
}

export async function findLiveDepositByClaimedUtr(utr: string): Promise<Deposit | null> {
  return prisma.deposit.findFirst({
    where: {
      claimedUtr: utr,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
    },
  });
}

/** One deposit by its opaque checkout token — the hosted checkout page's key. */
export async function getDepositByToken(token: string): Promise<Deposit | null> {
  return prisma.deposit.findUnique({ where: { checkoutToken: token } });
}

/**
 * Deposits a human confirmed (a UTR was entered) that the feed never credited —
 * the residue the admin queue exists for. Exact and amount-only matches are
 * approved automatically and never reach here.
 */
export async function listPendingDeposits(limit: number): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: { status: "PENDING_CONFIRMATION" },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}

/**
 * Rejects a live deposit. The Deposit model carries no reason column, so the
 * reason is recorded on the audit log only. Idempotent via the status guard.
 */
export async function rejectDeposit(input: {
  depositId: string;
  adminId: string;
  reason: string;
}): Promise<void> {
  const claimed = await prisma.deposit.updateMany({
    where: {
      id: input.depositId,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
    },
    data: { status: "REJECTED" },
  });
  if (claimed.count !== 1) throw new DepositAlreadyResolved();

  await prisma.auditLog.create({
    data: {
      actorId: input.adminId,
      action: "deposit.rejected",
      targetType: "Deposit",
      targetId: input.depositId,
      after: { status: "REJECTED", reason: input.reason },
    },
  });
}

/** A user's own deposits, newest first. Ownership is in the predicate. */
export async function listDepositsForActor(actorId: string, limit: number): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: { userId: actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}

/**
 * Records the user's self-declared reference and moves the deposit to
 * PENDING_CONFIRMATION, so the matcher's amount check is joined by a reference
 * tiebreaker. Ownership is enforced in the same UPDATE that claims the row: a
 * deposit belonging to another user, already resolved, or already claimed is
 * never touched, and the caller cannot tell an authz failure apart from a
 * genuinely missing row.
 */
export async function claimUtr(
  actorId: string,
  depositId: string,
  utr: string,
  screenshotUrl?: string,
): Promise<Deposit> {
  const claimed = await prisma.deposit.updateMany({
    where: {
      id: depositId,
      userId: actorId,
      status: "AWAITING_PAYMENT",
      claimedUtr: null,
    },
    data: {
      claimedUtr: utr,
      status: "PENDING_CONFIRMATION",
      ...(screenshotUrl ? { screenshotUrl } : {}),
    },
  });

  if (claimed.count !== 1) {
    // Distinguish "not yours / gone" (404) from "already claimed" (409) so the
    // checkout page can tell the user which happened.
    const existing = await prisma.deposit.findFirst({ where: { id: depositId, userId: actorId } });
    if (!existing) throw new DepositNotFound();
    throw new UtrAlreadyClaimed();
  }

  return prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
}

/**
 * USDT "I already paid": records the transaction hash the user says paid
 * their deposit (plus an optional screenshot) as EVIDENCE for an admin
 * reviewing an unmatched on-chain transfer.
 *
 * Security: a tx hash is public on-chain, so anyone can claim anyone's hash.
 * This therefore never credits anything, never changes the deposit's status,
 * and is never read by the automatic matcher — the admin decides. It is also
 * never exclusive (no uniqueness on the hash): a fraudulent claim must not
 * block the real payer from claiming the same hash.
 *
 * Ownership is enforced in the same guarded UPDATE, like claimUtr. A user may
 * overwrite their own earlier claim while the deposit is still open
 * (AWAITING_PAYMENT or EXPIRED) — they may have pasted the wrong hash.
 */
export async function claimUsdtPayment(input: {
  actorId: string;
  depositId: string;
  txHash: string;
  screenshotUrl?: string | null;
}): Promise<Deposit> {
  const txHash = input.txHash.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txHash)) {
    throw new Error("Invalid transaction hash.");
  }

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.deposit.updateMany({
      where: {
        id: input.depositId,
        userId: input.actorId,
        method: "USDT",
        status: { in: ["AWAITING_PAYMENT", "EXPIRED"] },
      },
      data: {
        claimedTxHash: txHash,
        ...(input.screenshotUrl ? { screenshotUrl: input.screenshotUrl } : {}),
      },
    });

    if (claimed.count !== 1) {
      // Not yours / not USDT / gone (404) vs. already resolved (409). The
      // caller cannot tell another user's deposit apart from a missing one.
      const existing = await tx.deposit.findFirst({
        where: { id: input.depositId, userId: input.actorId, method: "USDT" },
        select: { id: true },
      });
      if (!existing) throw new DepositNotFound();
      throw new DepositAlreadyResolved();
    }

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "deposit.usdt_payment_claimed",
        targetType: "Deposit",
        targetId: input.depositId,
        after: { txHash, hasScreenshot: Boolean(input.screenshotUrl) },
      },
    });

    return tx.deposit.findUniqueOrThrow({ where: { id: input.depositId } });
  });
}

export const BONUS_PERCENT = 100;
export const TURNOVER_MULTIPLE = 3;

/**
 * The amount (minor units of `accountCurrency`) a deposit credits to — and a
 * reversal reclaims from — a LIVE account. Shared by creditDepositToAccount
 * and reverseCompletedDeposit so the two can never disagree.
 *
 * USDT deposits: amountInr holds a NEGATIVE uniqueness sentinel and amountUsd
 * is 0 (see createUsdtDepositIntent), so neither may ever be credited. The
 * USDT-cents amount is converted instead, treating 1 USDT as 1 USD (USDT-cents
 * == USD-cents): an INR account gets ×USD_INR_RATE paise, a USD account the
 * same figure. A legacy "USDT"-denominated account gets USDT-cents as-is.
 * `usdtMinorOverride` is the amount actually received on-chain, for an admin
 * resolution.
 *
 * Any other method: unchanged INR/UPI semantics (INR rail → amountInr,
 * otherwise amountUsd).
 *
 * Throws unless the result is a positive integer — a deposit must never
 * reduce a balance.
 */
export function depositCreditMinor(
  deposit: Pick<Deposit, "method" | "amountInr" | "amountUsd" | "amountUsdtMinor">,
  accountCurrency: string,
  usdtMinorOverride?: number | null,
): number {
  let credit: number;
  if (deposit.method === "USDT") {
    const usdtMinor = usdtMinorOverride ?? deposit.amountUsdtMinor;
    if (usdtMinor === null || usdtMinor <= 0) {
      throw new Error("USDT deposit has no positive USDT amount to credit.");
    }
    if (accountCurrency === "USDT") {
      credit = usdtMinor;
    } else if (accountCurrency === "INR" || accountCurrency === "USD") {
      credit = convertMinorBetween(usdtMinor, "USD", accountCurrency);
    } else {
      throw new Error(`Cannot credit a USDT deposit to a ${accountCurrency} account.`);
    }
  } else if (accountCurrency === "INR") {
    credit = deposit.amountInr;
  } else if (accountCurrency === "USDT") {
    throw new Error(`Cannot credit a ${deposit.method} deposit to a USDT account.`);
  } else {
    credit = deposit.amountUsd;
  }
  if (!Number.isInteger(credit) || credit <= 0) {
    throw new Error(`Refusing a non-positive deposit credit (${credit}).`);
  }
  return credit;
}

/**
 * Approves a deposit and credits the account, in one transaction so a crash
 * or a retry cannot double-credit. `creditId` may be null for a manually
 * approved deposit with no specific bank credit on record (e.g. an admin
 * override); when present, that credit is atomically marked consumed inside
 * the same transaction as the approval. `chainCreditId` is the USDT analog —
 * mutually exclusive with `creditId` in practice (a deposit is either an
 * INR/UPI deposit with a BankCredit or a USDT deposit with a ChainCredit,
 * never both), guarded the same way: atomically marked consumed inside the
 * same transaction, and a 0-row guard throws exactly like the BankCredit one.
 */
export async function creditDepositToAccount(input: {
  depositId: string;
  adminId: string | null;
  creditId?: string | null;
  chainCreditId?: string | null;
  /**
   * Admin resolution of a reviewed ChainCredit (see chain-credit-admin.ts).
   * Only valid with chainCreditId on a USDT deposit. Widens the deposit guard
   * to EXPIRED and the chain-credit guard to MANUAL_REVIEW/UNMATCHED, and
   * credits `usdtMinorOverride` (the amount actually received on-chain),
   * rewriting the deposit's amounts to match in the same guarded UPDATE.
   */
  adminResolution?: { usdtMinorOverride: number };
}): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: input.depositId } });
  if (!deposit) throw new DepositNotFound();

  const account = await prisma.account.findFirstOrThrow({
    where: { userId: deposit.userId, type: "LIVE" },
  });

  const admin = input.adminResolution ?? null;
  if (admin) {
    if (!input.chainCreditId) {
      throw new Error("adminResolution requires a chainCreditId.");
    }
    if (deposit.method !== "USDT") {
      throw new Error("adminResolution is only valid for a USDT deposit.");
    }
    if (!Number.isInteger(admin.usdtMinorOverride) || admin.usdtMinorOverride <= 0) {
      throw new Error("adminResolution.usdtMinorOverride must be a positive integer.");
    }
  }

  // Credit in the account's own currency — see depositCreditMinor. For an
  // admin resolution the credit is what actually arrived on-chain, which may
  // differ from what the deposit reserved.
  const credit = depositCreditMinor(deposit, account.currency, admin?.usdtMinorOverride ?? null);
  const bonus = Math.floor((credit * BONUS_PERCENT) / 100);

  await prisma.$transaction(async (tx) => {
    // With an admin resolution the deposit's amounts are rewritten to what
    // actually arrived. Safe w.r.t. the partial unique indexes
    // (Deposit_live_amount_unique on amountInr, Deposit_live_usdt_amount_unique
    // on amountUsdtMinor): both cover only AWAITING_PAYMENT/PENDING_CONFIRMATION,
    // and this same UPDATE moves the row to COMPLETED, so the new values never
    // enter either index.
    const claimed = await tx.deposit.updateMany({
      where: {
        id: deposit.id,
        status: {
          in: admin
            ? ["AWAITING_PAYMENT", "PENDING_CONFIRMATION", "EXPIRED"]
            : ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"],
        },
      },
      data: {
        status: "COMPLETED",
        matchedCreditId: input.creditId ?? null,
        matchedChainCreditId: input.chainCreditId ?? null,
        ...(admin
          ? { amountUsdtMinor: admin.usdtMinorOverride, amountInr: -admin.usdtMinorOverride }
          : {}),
      },
    });
    if (claimed.count !== 1) throw new DepositAlreadyResolved();

    if (input.creditId) {
      const consumed = await tx.bankCredit.updateMany({
        where: { id: input.creditId, consumed: false },
        data: { consumed: true },
      });
      if (consumed.count !== 1) throw new DepositAlreadyResolved();
    }

    if (input.chainCreditId) {
      const consumed = await tx.chainCredit.updateMany({
        where: admin
          ? {
              id: input.chainCreditId,
              consumed: false,
              processingStatus: { in: ["PENDING", "MANUAL_REVIEW", "UNMATCHED"] },
            }
          : { id: input.chainCreditId, consumed: false, processingStatus: "PENDING" },
        data: { consumed: true, processingStatus: "MATCHED" },
      });
      if (consumed.count !== 1) throw new DepositAlreadyResolved();
    }

    const updated = await tx.account.update({
      where: { id: account.id },
      data: {
        realBalance: { increment: credit },
        bonusBalance: { increment: bonus },
        version: { increment: 1 },
      },
    });

    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "DEPOSIT",
        amount: credit,
        balanceAfter: updated.realBalance + updated.bonusBalance,
        refType: "Deposit",
        refId: deposit.id,
      },
    });

    if (bonus > 0) {
      await tx.bonusGrant.create({
        data: {
          accountId: account.id,
          amount: bonus,
          turnoverRequired: bonus * TURNOVER_MULTIPLE,
        },
      });
      await tx.transaction.create({
        data: {
          accountId: account.id,
          kind: "BONUS_GRANT",
          amount: bonus,
          balanceAfter: updated.realBalance + updated.bonusBalance,
          refType: "Deposit",
          refId: deposit.id,
        },
      });
    }

    await tx.user.update({
      where: { id: deposit.userId },
      data: { cumulativeDeposits: { increment: credit } },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: input.adminId ? "deposit.approved_manual" : "deposit.approved_auto",
        targetType: "Deposit",
        targetId: deposit.id,
        after: admin
          ? {
              status: "COMPLETED",
              creditId: input.creditId,
              bonus,
              resolvedByAdmin: true,
              usdtMinorOverride: admin.usdtMinorOverride,
              reservedUsdtMinor: deposit.amountUsdtMinor,
            }
          : { status: "COMPLETED", creditId: input.creditId, bonus },
      },
    });
  });

  // The bonus grant is when the multi-account attack pays off — every account
  // gets one, so this is the moment to check whether the user just picked up
  // is one of many linked accounts. Run OUTSIDE the transaction: a detector
  // failure must never roll back a completed deposit, and the flag itself is
  // advisory (admin decides), not a hold on the credit.
  flagLinkageForUser({ userId: deposit.userId }).catch(() => {
    /* the detector logs its own failures via the prisma client */
  });
}

export class DepositReversalRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositReversalRefused";
  }
}

/**
 * Reverses a COMPLETED deposit. This is the admin-only path for chargebacks,
 * confirmed fraud rulings, and duplicate-credit corrections. Not exposed to
 * the user's flow — a user cannot ever reverse their own deposit.
 *
 * Correctness invariants:
 *   1. cumulativeDeposits is decremented BY THE SAME `credit` VALUE that was
 *      added at approval, so lifecycle stage derives correctly on the next
 *      controller call. Without this, a refunded deposit leaves the user
 *      stuck in HIGH_VALUE with no matching money on file.
 *   2. Real and bonus balances are debited by exactly what was credited. If
 *      the user has already spent below what would need to be reclaimed and
 *      `force` is false, the reversal is REFUSED (admin decides whether to
 *      force-cap at zero or freeze the account and pursue recovery).
 *   3. The Deposit row is moved to REJECTED (no separate REVERSED status —
 *      that would be a schema migration; the audit log distinguishes the two).
 *   4. Any BankCredit that was consumed by this deposit stays consumed.
 *      Un-consuming would let the matcher re-fire against another live
 *      deposit for the same amount — a real risk of double-spend.
 */
export async function reverseCompletedDeposit(input: {
  depositId: string;
  adminId: string;
  reason: string;
  force?: boolean;
}): Promise<void> {
  return performDepositReversal(input);
}

/**
 * The shared reversal core behind reverseCompletedDeposit and
 * reverseUsdtDepositAndRequeue — one place for the balance-debit math so the
 * two can never drift apart (same reasoning as depositCreditMinor). `onReversed`
 * runs inside the SAME transaction, after the deposit/account/audit writes but
 * before it commits, so a caller-specific follow-up (e.g. re-queuing the
 * on-chain payment) is exactly as atomic as the reversal itself.
 */
async function performDepositReversal(
  input: { depositId: string; adminId: string; reason: string; force?: boolean },
  onReversed?: (tx: Tx, deposit: Deposit) => Promise<void>,
): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: input.depositId } });
  if (!deposit) throw new DepositNotFound();
  if (deposit.status !== "COMPLETED") {
    throw new DepositReversalRefused(
      "Only a COMPLETED deposit can be reversed. Use rejectDeposit for pending ones.",
    );
  }

  const account = await prisma.account.findFirstOrThrow({
    where: { userId: deposit.userId, type: "LIVE" },
  });
  // The same figure creditDepositToAccount added (an admin resolution rewrote
  // amountUsdtMinor to the credited amount, so it is read back here as-is).
  const credit = depositCreditMinor(deposit, account.currency);
  const bonus = Math.floor((credit * BONUS_PERCENT) / 100);

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.account.findUniqueOrThrow({
      where: { id: account.id },
      select: { realBalance: true, bonusBalance: true, version: true },
    });

    const realCap = Math.min(credit, fresh.realBalance);
    const bonusCap = Math.min(bonus, fresh.bonusBalance);
    if (!input.force && (realCap < credit || bonusCap < bonus)) {
      throw new DepositReversalRefused(
        "The account balance is below the amount to be reclaimed. Pass force=true to cap at zero.",
      );
    }

    const claimedDeposit = await tx.deposit.updateMany({
      where: { id: deposit.id, status: "COMPLETED" },
      data: { status: "REJECTED" },
    });
    if (claimedDeposit.count !== 1) throw new DepositAlreadyResolved();

    const claimedAccount = await tx.account.updateMany({
      where: { id: account.id, version: fresh.version },
      data: {
        realBalance: { decrement: realCap },
        bonusBalance: { decrement: bonusCap },
        version: { increment: 1 },
      },
    });
    if (claimedAccount.count !== 1) {
      throw new DepositReversalRefused(
        "Balance changed while the reversal was being applied. Retry.",
      );
    }

    await tx.user.update({
      where: { id: deposit.userId },
      data: { cumulativeDeposits: { decrement: credit } },
    });

    const balanceAfter = fresh.realBalance + fresh.bonusBalance - realCap - bonusCap;
    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "DEPOSIT",
        amount: -realCap,
        balanceAfter,
        refType: "Deposit",
        refId: deposit.id,
      },
    });
    if (bonusCap > 0) {
      await tx.transaction.create({
        data: {
          accountId: account.id,
          kind: "BONUS_CONVERT",
          amount: -bonusCap,
          balanceAfter,
          refType: "Deposit",
          refId: deposit.id,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "deposit.reversed",
        targetType: "Deposit",
        targetId: deposit.id,
        before: { status: "COMPLETED", credit, bonus },
        after: {
          status: "REJECTED",
          reason: input.reason,
          reclaimedReal: realCap,
          reclaimedBonus: bonusCap,
          shortfall: (credit - realCap) + (bonus - bonusCap),
        },
      },
    });

    if (onReversed) await onReversed(tx, deposit);
  });
}

/**
 * Reverses a COMPLETED USDT deposit exactly like reverseCompletedDeposit, and
 * — in the SAME transaction — returns its linked on-chain payment to the
 * admin review queue (MANUAL_REVIEW, un-consumed) so it can be re-attached to
 * the correct deposit via resolveChainCreditToDeposit. This is the fix for
 * the gap a wrong "Credit to deposit" click leaves behind: without it, the
 * only way to undo a mis-credit is hand-editing the database.
 *
 * Refuses (never partially applies) when the deposit isn't a USDT deposit, or
 * has no linked ChainCredit — those cases have no on-chain payment to give
 * back to the queue, so the generic reverseCompletedDeposit is the right tool.
 */
export async function reverseUsdtDepositAndRequeue(input: {
  depositId: string;
  adminId: string;
  reason: string;
  force?: boolean;
}): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: input.depositId } });
  if (!deposit) throw new DepositNotFound();
  if (deposit.method !== "USDT") {
    throw new DepositReversalRefused("Only a USDT deposit can be reversed and requeued this way.");
  }
  if (!deposit.matchedChainCreditId) {
    throw new DepositReversalRefused("This deposit has no linked on-chain payment to return to the review queue.");
  }

  return performDepositReversal(input, async (tx, freshDeposit) => {
    const chainCreditId = freshDeposit.matchedChainCreditId;
    if (!chainCreditId) throw new DepositReversalRefused("This deposit has no linked on-chain payment to return to the review queue.");

    // Guarded on consumed: true — the one-credit-only guarantee means a
    // COMPLETED deposit's chain credit is always consumed, so count !== 1
    // here means something else already changed it (a genuine anomaly, never
    // silently ignored).
    const requeued = await tx.chainCredit.updateMany({
      where: { id: chainCreditId, consumed: true },
      data: { consumed: false, processingStatus: "MANUAL_REVIEW", reviewReason: "ADMIN_REVERSED" },
    });
    if (requeued.count !== 1) {
      throw new DepositReversalRefused("The linked on-chain payment was not in the expected state — nothing was changed.");
    }

    // Deposit.matchedChainCreditId is @unique — left pointing at this credit,
    // it would permanently block the credit from ever being attached to a
    // different (correct) deposit. The reversed deposit is REJECTED and dead
    // either way, so clearing it here costs nothing.
    await tx.deposit.update({ where: { id: freshDeposit.id }, data: { matchedChainCreditId: null } });

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "chain_credit.requeued_after_reversal",
        targetType: "ChainCredit",
        targetId: chainCreditId,
        after: { processingStatus: "MANUAL_REVIEW", reviewReason: "ADMIN_REVERSED", requeuedFromDepositId: freshDeposit.id },
      },
    });
  });
}

/**
 * How long a lapsed USDT deposit keeps its reservation before being marked
 * EXPIRED. Callers pass `new Date(Date.now() - USDT_RESERVATION_QUARANTINE_MS)`
 * to expireStaleUsdtDeposits.
 *
 * Why a quarantine rather than expiring at expiresAt: EXPIRED drops the row
 * out of Deposit_live_usdt_amount_unique, freeing that exact amount for reuse.
 * Freed immediately, a late payment for user A's old amount could auto-credit
 * user B who later reserved the same amount. Holding it AWAITING_PAYMENT for
 * 48h after expiry blocks reuse during the window when late payments
 * realistically arrive; the matcher already ignores it (expiresAt > paidAt),
 * so a late payment lands in UNMATCHED for admin review instead.
 */
export const USDT_RESERVATION_QUARANTINE_MS = 48 * 60 * 60 * 1000;

/** Marks method "USDT" deposits still AWAITING_PAYMENT whose expiresAt < expiredBefore as EXPIRED. Returns the count. Never touches INR deposits. */
export async function expireStaleUsdtDeposits(expiredBefore: Date): Promise<number> {
  const result = await prisma.deposit.updateMany({
    where: { method: "USDT", status: "AWAITING_PAYMENT", expiresAt: { lt: expiredBefore } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}
