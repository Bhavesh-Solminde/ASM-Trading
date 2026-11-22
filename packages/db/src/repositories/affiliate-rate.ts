import { prisma, type DbTransaction } from "../client";
import type { AffiliateLevelTerms, AffiliateRate } from "../../generated/prisma/client";
import { programSettingRowAt } from "./program-settings";
import { houseDateForInstant } from "./house-day";
import { affiliateLevelTermsAt, getAffiliateMonthLevels, levelTermsOrder } from "./affiliate-levels";

export const affiliateRateActorWhere = { role: "AFFILIATE", legacySimulated: false } as const;

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
export function defaultRevenueShareAt(at: Date, client: DbTransaction = prisma) {
  return programSettingRowAt("DEFAULT_REVENUE_SHARE_BPS", at, client);
}

/** The default terms for an affiliate with no AffiliateRate in force (0 bps if the setting is missing). */
function defaultRate(setting: { id: string; value: number; effectiveFrom: Date } | null): AffiliateRateAt {
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
export async function getAffiliateRateAt(affiliateId: string, at: Date, client: DbTransaction = prisma): Promise<AffiliateRateAt> {
  return (await getAffiliateRatesAt([affiliateId], at, client)).get(affiliateId)!;
}

/** Resolve the same terms in a batch for the admin list and for individual payouts. */
export async function getAffiliateRatesAt(ids: string[], at: Date, client: DbTransaction = prisma): Promise<Map<string, AffiliateRateAt>> {
  const results = new Map<string, AffiliateRateAt>();
  if (ids.length === 0) return results;
  const actors = await client.user.findMany({
    where: { id: { in: ids }, ...affiliateRateActorWhere },
    select: {
      id: true,
      affiliateRates: { where: { effectiveFrom: { lte: at } }, orderBy: [...levelTermsOrder], take: 1 },
    },
  });
  const needsLevel = actors.filter(({ affiliateRates }) => affiliateRates[0]?.depositRewardBps == null).map(({ id }) => id);
  const termsByLevel = needsLevel.length > 0 ? await affiliateLevelTermsAt(at, client) : new Map<number, AffiliateLevelTerms>();
  // A historical calculation before launch only needs the historical global setting.
  const months = termsByLevel.size > 0 ? await getAffiliateMonthLevels(needsLevel, at, client) : null;
  for (const { id, affiliateRates: [assigned] } of actors) {
    const month = months?.get(id);
    const terms = month && termsByLevel.get(month.level);
    if (assigned) results.set(id, rateFromAssignment(assigned, terms));
    else if (terms) results.set(id, rateFromLevelTerms(terms));
  }
  const missing = ids.filter((id) => !results.has(id));
  if (missing.length > 0) {
    const fallback = defaultRate(await defaultRevenueShareAt(at, client));
    for (const id of missing) results.set(id, { ...fallback, level: months?.get(id)?.level ?? null });
  }
  return results;
}

function rateFromAssignment(row: AffiliateRate, terms?: AffiliateLevelTerms): AffiliateRateAt {
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

function rateFromLevelTerms(terms: AffiliateLevelTerms): AffiliateRateAt {
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
