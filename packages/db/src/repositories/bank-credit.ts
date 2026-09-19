import { prisma } from "../client";
import type { BankCredit } from "../../generated/prisma/client";

/**
 * Returns null on a duplicate UTR rather than throwing — the relay may
 * retry a delivery (its own retry logic sends up to 3 attempts), and a
 * repeat of the same real-world credit is normal operation, not an error.
 */
export async function createBankCreditIfNew(input: {
  vpa: string;
  amountInr: number;
  utr: string;
  receivedAt: Date;
  raw: string;
}): Promise<BankCredit | null> {
  try {
    return await prisma.bankCredit.create({ data: input });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return null;
    throw err;
  }
}

/**
 * Looks up a BankCredit by its unique UTR (real or synthetic). Used to
 * recover from a `createBankCreditIfNew` P2002 — the row that already
 * exists is either a genuine duplicate delivery (already `consumed`) or the
 * surviving half of an earlier request that crashed before finishing, in
 * which case the caller retries the rest of the pipeline against it.
 */
export async function findBankCreditByUtr(utr: string): Promise<BankCredit | null> {
  return prisma.bankCredit.findUnique({ where: { utr } });
}

export async function listOrphanBankCredits(limit: number): Promise<BankCredit[]> {
  return prisma.bankCredit.findMany({
    where: { consumed: false },
    orderBy: { receivedAt: "desc" },
    take: limit,
  });
}
