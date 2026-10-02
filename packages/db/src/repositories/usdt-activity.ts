import { prisma } from "../client";

/**
 * DB-only (no chain calls) check the chain watcher runs every fast interval to
 * decide whether it's worth spending TronGrid calls right now. True when, for
 * THIS watcher's network/contract/address:
 *  - a USDT deposit is awaiting payment and its window closed less than
 *    `lateGraceMs` ago (or is still open) — payments often arrive a bit late;
 *  - a transfer is still being confirmed (DETECTED/CONFIRMING);
 *  - a FINAL transfer is waiting to be matched, if the match stage is running
 *    (with auto-confirm off such rows wait forever and must not pin fast mode);
 *  - a pagination session is mid-catch-up.
 * Scoped to the watcher's own config so unrelated rows (other contracts, test
 * fixtures) never influence it.
 */
export async function hasActiveUsdtWork(input: {
  network: string;
  tokenContract: string;
  receivingAddress: string;
  now: Date;
  lateGraceMs: number;
  includePendingMatches: boolean;
}): Promise<boolean> {
  const scope = { network: input.network, tokenContract: input.tokenContract };

  const [openDeposit, pendingCredit, catchUp] = await Promise.all([
    prisma.deposit.findFirst({
      where: {
        ...scope,
        method: "USDT",
        receivingAddress: input.receivingAddress,
        status: "AWAITING_PAYMENT",
        expiresAt: { gt: new Date(input.now.getTime() - input.lateGraceMs) },
      },
      select: { id: true },
    }),
    prisma.chainCredit.findFirst({
      where: {
        ...scope,
        toAddress: input.receivingAddress,
        OR: [
          { finalityState: { in: ["DETECTED", "CONFIRMING"] } },
          ...(input.includePendingMatches
            ? [{ finalityState: "FINAL" as const, processingStatus: "PENDING" as const }]
            : []),
        ],
      },
      select: { id: true },
    }),
    prisma.chainScanCursor.findFirst({
      where: {
        ...scope,
        receivingAddress: input.receivingAddress,
        activeSessionMinTimestampMs: { not: null },
      },
      select: { network: true },
    }),
  ]);

  return openDeposit !== null || pendingCredit !== null || catchUp !== null;
}
