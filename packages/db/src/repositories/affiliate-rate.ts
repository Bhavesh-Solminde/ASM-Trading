import { prisma, type DbClient, type DbTransaction } from "../client";

export interface AffiliateRateAt {
  /** Null when no rate was ever assigned: Revenue Share is then 0. */
  rateId: string | null;
  revenueShareBps: number;
  /** Null = use the global AFFILIATE_DEPOSIT_REWARD_BPS setting. */
  depositRewardBps: number | null;
}

/** The affiliate's assigned terms in force at `at` (latest effectiveFrom <= at; ties → newest row). */
export async function getAffiliateRateAt(affiliateId: string, at: Date, client: DbClient | DbTransaction = prisma): Promise<AffiliateRateAt> {
  const row = await client.affiliateRate.findFirst({
    where: { affiliateId, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  return row
    ? { rateId: row.id, revenueShareBps: row.revenueShareBps, depositRewardBps: row.depositRewardBps }
    : { rateId: null, revenueShareBps: 0, depositRewardBps: null };
}
