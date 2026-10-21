import { prisma } from "../client";
import type { Deposit } from "../models";

/** One ledger row of the deposit, as the receipt reads it. Amounts may arrive as `bigint` or already as numbers. */
export interface ReceiptTx {
  kind: string;
  amount: number | bigint;
  balanceAfter: number | bigint;
  createdAt: Date;
  account: { currency: string };
}

/** What the app's receipt shows beyond the deposit row itself. Every field is null until it is known. */
export interface DepositReceipt {
  creditedAt: Date | null;
  /** The credit, in the account's own currency (`creditedCurrency`); the bonus is not in it. */
  creditedMinor: number | null;
  creditedCurrency: string | null;
  bonusMinor: number | null;
  /** The account's real plus bonus balance right after the credit. */
  balanceAfterMinor: number | null;
  utr: string | null;
}

const EMPTY: Omit<DepositReceipt, "utr"> = { creditedAt: null, creditedMinor: null, creditedCurrency: null, bonusMinor: null, balanceAfterMinor: null };

/** A money value as a JS number, or null when it cannot be one exactly: a receipt never shows a rounded figure. */
function safeMinor(value: number | bigint): number | null {
  const n = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(n) ? n : null;
}

function earliest(txs: readonly ReceiptTx[], kind: string): ReceiptTx | undefined {
  return txs
    .filter((tx) => tx.kind === kind && tx.amount > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
}

/**
 * Pure: the receipt from a deposit's ledger rows and its UTR. The credit is the first positive `DEPOSIT` row (a later
 * reversal is a negative row and never counts), the bonus the first positive `BONUS_GRANT`.
 */
export function buildDepositReceipt(input: { txs: readonly ReceiptTx[]; utr: string | null }): DepositReceipt {
  const credit = earliest(input.txs, "DEPOSIT");
  const bonus = earliest(input.txs, "BONUS_GRANT");
  return {
    creditedAt: credit?.createdAt ?? null,
    creditedMinor: credit ? safeMinor(credit.amount) : null,
    creditedCurrency: credit?.account.currency ?? null,
    bonusMinor: bonus ? safeMinor(bonus.amount) : null,
    balanceAfterMinor: credit ? safeMinor(credit.balanceAfter) : null,
    utr: input.utr,
  };
}

/**
 * The receipt data for one deposit, for the hosted checkout view the app polls. A deposit that has not been credited
 * costs no query at all (the poll runs every 4s while it is open). A credited one reads its own `DEPOSIT` and
 * `BONUS_GRANT` rows on the owner's LIVE account, and the matched bank credit's UTR only when the user never entered one.
 */
export async function getDepositReceipt(deposit: Pick<Deposit, "id" | "userId" | "status" | "claimedUtr" | "matchedCreditId">): Promise<DepositReceipt> {
  if (deposit.status !== "COMPLETED") return { ...EMPTY, utr: deposit.claimedUtr ?? null };
  const [txs, matched] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        refType: "Deposit",
        refId: deposit.id,
        kind: { in: ["DEPOSIT", "BONUS_GRANT"] },
        amount: { gt: 0 },
        account: { userId: deposit.userId, type: "LIVE" },
      },
      select: { kind: true, amount: true, balanceAfter: true, createdAt: true, account: { select: { currency: true } } },
      orderBy: { createdAt: "asc" },
      take: 10,
    }),
    deposit.claimedUtr === null && deposit.matchedCreditId !== null
      ? prisma.bankCredit.findUnique({ where: { id: deposit.matchedCreditId }, select: { utr: true } })
      : Promise.resolve(null),
  ]);
  return buildDepositReceipt({ txs, utr: deposit.claimedUtr ?? matched?.utr ?? null });
}
