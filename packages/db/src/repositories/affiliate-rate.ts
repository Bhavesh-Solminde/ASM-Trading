import { prisma, type DbClient, type DbTransaction } from "../client";
import type { AffiliateLevelTerms, AffiliateRate } from "../../generated/prisma/client";
import { programSettingRowAt } from "./program-settings";
import { houseDateForInstant } from "./house-day";
import { getAffiliateMonthLevels, levelTermsOrder } from "./affiliate-levels";

type Db = DbClient | DbTransaction;

/** Daily Revenue Share changes start at the first IST midnight at/after the requested time. */
export function revenueShareEffectiveFrom(at: Date): Date {
  const start = houseDateForInstant(at).getTime() - 330 * 60_000;
  return new Date(start === at.getTime() ? start : start + 86_400_000);
}

export interface AffiliateRateAt {
  /** Source of Revenue Share. A custom share can have a level deposit reward. */
  source: "assigned" | "level" | "default";
  rateId: string | null;
  level: number | null;
  /** Level terms used for either earning type. */
  levelTermsId: string | null;
  /** The DEFAULT_REVENUE_SHARE_BPS ProgramSetting when the global default applies. */
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
    level: null,
    levelTermsId: null,
    settingId: setting?.id ?? null,
    revenueShareBps: setting?.value ?? 0,
    depositRewardBps: null,
    effectiveFrom: setting?.effectiveFrom ?? null,
  };
}

/**
 * An assigned rate wins for each earning type it specifies. Otherwise use
 * the terms for the frozen month's level, followed by the global settings.
 */
export async function getAffiliateRateAt(affiliateId: string, at: Date, client: Db = prisma): Promise<AffiliateRateAt> {
  const row = await client.affiliateRate.findFirst({
    where: { affiliateId, effectiveFrom: { lte: at } },
    orderBy: [...levelTermsOrder],
  });
  if (row?.depositRewardBps != null) return rateFromAssignment(row);
  const affiliate = await client.user.findUnique({
    where: { id: affiliateId, role: "AFFILIATE", legacySimulated: false },
    select: { id: true },
  });
  if (affiliate) {
    const month = (await getAffiliateMonthLevels([affiliateId], at, client)).get(affiliateId)!;
    const terms = await client.affiliateLevelTerms.findFirst({
      where: { level: month.level, effectiveFrom: { lte: at } },
      orderBy: [...levelTermsOrder],
    });
    if (row) return rateFromAssignment(row, terms);
    if (terms) return rateFromLevelTerms(terms);
    return { ...defaultRate(await defaultRevenueShareAt(at, client)), level: month.level };
  }
  return row ? rateFromAssignment(row) : defaultRate(await defaultRevenueShareAt(at, client));
}

export function rateFromAssignment(row: AffiliateRate, terms?: AffiliateLevelTerms | null): AffiliateRateAt {
  const depositTerms = row.depositRewardBps === null ? terms : null;
  return {
    source: "assigned",
    rateId: row.id,
    level: depositTerms?.level ?? null,
    levelTermsId: depositTerms?.id ?? null,
    settingId: null,
    revenueShareBps: row.revenueShareBps,
    depositRewardBps: row.depositRewardBps ?? depositTerms?.depositRewardBps ?? null,
    effectiveFrom: row.effectiveFrom,
  };
}

export function rateFromLevelTerms(terms: AffiliateLevelTerms): AffiliateRateAt {
  return {
    source: "level",
    rateId: null,
    level: terms.level,
    levelTermsId: terms.id,
    settingId: null,
    revenueShareBps: terms.revenueShareBps,
    depositRewardBps: terms.depositRewardBps,
    effectiveFrom: terms.effectiveFrom,
  };
}
