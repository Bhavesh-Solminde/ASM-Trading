import { convertMinorBetween } from "@asm/contracts";
import { prisma } from "../client";
import {
  ACTOR_SELECT,
  ProgramActionRefused,
  isUniqueViolation,
  lockProgramWallet,
  moveProgramWallet,
  programActionBlockers,
} from "./program-wallet";

export interface ProgramTransferResult {
  transferId: string;
  creditedMinor: number;
  creditedCurrency: string;
}

const fxCode = (c: string) => (c === "USDT" ? "USD" : c);

/** INR paise → account minor units through the single platform rate, rounded down (never overpay). */
export function inrToAccountMinorFloor(inrMinor: number, currency: string): number {
  let out = convertMinorBetween(inrMinor, "INR", fxCode(currency));
  if (convertMinorBetween(out, fxCode(currency), "INR") > inrMinor) out -= 1;
  return out;
}

async function existing(userId: string, idempotencyKey: string, amountMinor: number): Promise<ProgramTransferResult | null> {
  const t = await prisma.programTransfer.findUnique({ where: { idempotencyKey } });
  if (!t) return null;
  if (t.userId !== userId || t.amountMinor !== amountMinor) throw new ProgramActionRefused("invalid_state", "Idempotency key already used.");
  return { transferId: t.id, creditedMinor: t.creditedMinor, creditedCurrency: t.creditedCurrency };
}

/**
 * §11: moves available program money into the user's own LIVE account as real
 * balance. Ledger kind PROGRAM_TRANSFER — never a deposit, so no bonus, no
 * qualification, no cumulativeDeposits. One-way. A retry with the same
 * idempotencyKey returns the original transfer.
 */
export async function transferProgramEarningsToTrading(input: {
  userId: string;
  amountMinor: number;
  idempotencyKey: string;
}): Promise<ProgramTransferResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new ProgramActionRefused("invalid_amount");
  const prior = await existing(input.userId, input.idempotencyKey, input.amountMinor);
  if (prior) return prior;

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockProgramWallet(tx, input.userId);
      // Status, KYC and affiliate state read under the wallet lock.
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { ...ACTOR_SELECT, accounts: { where: { type: "LIVE" }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } } },
      });
      if (!user) throw new ProgramActionRefused("not_found");
      const live = user.accounts[0];
      const blockers = programActionBlockers(user, "transfer", !!live);
      if (blockers[0]) throw new ProgramActionRefused(blockers[0]);
      if (input.amountMinor > locked.availableMinor) throw new ProgramActionRefused("insufficient_funds");

      const [account] = await tx.$queryRaw<{ currency: string }[]>`SELECT currency FROM "Account" WHERE id = ${live!.id} FOR UPDATE`;
      if (!account) throw new ProgramActionRefused("no_live_account");
      const creditedMinor = inrToAccountMinorFloor(input.amountMinor, account.currency);
      if (creditedMinor <= 0) throw new ProgramActionRefused("below_minimum");

      const transfer = await tx.programTransfer.create({
        data: {
          userId: input.userId,
          accountId: live!.id,
          amountMinor: input.amountMinor,
          creditedMinor,
          creditedCurrency: account.currency,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await moveProgramWallet(tx, input.userId, locked, { availableMinor: -input.amountMinor, transferredMinor: input.amountMinor }, {
        kind: "TRANSFER_TO_TRADING",
        refType: "ProgramTransfer",
        refId: transfer.id,
      });
      // Row locked above; the version bump makes concurrent optimistic writers (trades, withdrawals) retry.
      const credited = await tx.account.update({
        where: { id: live!.id },
        data: { realBalance: { increment: creditedMinor }, version: { increment: 1 } },
        select: { realBalance: true, bonusBalance: true },
      });
      await tx.transaction.create({
        data: {
          accountId: live!.id,
          kind: "PROGRAM_TRANSFER",
          amount: creditedMinor,
          balanceAfter: credited.realBalance + credited.bonusBalance,
          refType: "ProgramTransfer",
          refId: transfer.id,
        },
      });
      return { transferId: transfer.id, creditedMinor, creditedCurrency: account.currency };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await existing(input.userId, input.idempotencyKey, input.amountMinor);
      if (again) return again;
    }
    throw err;
  }
}
