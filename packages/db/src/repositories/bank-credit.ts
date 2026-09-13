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

export async function listOrphanBankCredits(limit: number): Promise<BankCredit[]> {
  return prisma.bankCredit.findMany({
    where: { consumed: false },
    orderBy: { receivedAt: "desc" },
    take: limit,
  });
}
