import { prisma, type DbClient, type DbTransaction } from "../client";
import { programSettingRowAt } from "./program-settings";

type Db = DbClient | DbTransaction;

export interface AffiliateRateAt {
  /** "assigned": the affiliate's own AffiliateRate; "default": the DEFAULT_REVENUE_SHARE_BPS setting. */
  source: "assigned" | "default";
  /** The AffiliateRate in force; null when the default applies. */
  rateId: string | null;
  /** The DEFAULT_REVENUE_SHARE_BPS ProgramSetting in force when the default applies; else null. */
  settingId: string | null;
  revenueShareBps: number;
  /** Null = use the global AFFILIATE_DEPOSIT_REWARD_BPS setting. */
  depositRewardBps: number | null;
  effectiveFrom: Date | null;
}

/** The DEFAULT_REVENUE_SHARE_BPS version in force at `at` (the shared rule in program-settings.ts). */
export function defaultRevenueShareAt(at: Date, client: Db = prisma) {
  return programSettingRowAt("DEFAULT_REVENUE_SHARE_BPS", at, client);
}

/** The default terms for an affiliate with no AffiliateRate in force (0 bps if the setting is missing). */
export function defaultRate(setting: { id: string; value: number; effectiveFrom: Date } | null): AffiliateRateAt {
  return {
    source: "default",
    rateId: null,
    settingId: setting?.id ?? null,
    revenueShareBps: setting?.value ?? 0,
    depositRewardBps: null,
    effectiveFrom: setting?.effectiveFrom ?? null,
  };
}

/**
 * The affiliate's terms in force at `at`: their own AffiliateRate (latest
 * effectiveFrom <= at; ties → newest row), else the DEFAULT_REVENUE_SHARE_BPS
 * setting in force at `at`.
 */
export async function getAffiliateRateAt(affiliateId: string, at: Date, client: Db = prisma): Promise<AffiliateRateAt> {
  const row = await client.affiliateRate.findFirst({
    where: { affiliateId, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  if (!row) return defaultRate(await defaultRevenueShareAt(at, client));
  return {
    source: "assigned",
    rateId: row.id,
    settingId: null,
    revenueShareBps: row.revenueShareBps,
    depositRewardBps: row.depositRewardBps,
    effectiveFrom: row.effectiveFrom,
  };
}
