export type Range = { from: Date; to: Date };
export type Bucket = "day" | "week" | "month";

export interface AffiliateLevelStatus {
  current: { level: number; name: string };
  next: { level: number; name: string };
  monthQualifyingDeposits: number;
  toKeep: number;
  toNextLevel: number | null;
}

export interface AffiliateTotals {
  clicks: number;
  registrations: number;
  ftdCount: number;
  ftdSumMinor: number;
  depositsCount: number;
  depositsSumMinor: number;
  withdrawalsCount: number;
  withdrawalsSumMinor: number;
  turnoverMinor: number;
  earningsMinor: number;
}

export interface AffiliateSeriesPoint {
  start: Date;
  clicks: number;
  registrations: number;
  ftdCount: number;
}

export interface AffiliateStatsRow extends AffiliateTotals {
  key: string;
  label: string;
  bonusesSumMinor: number;
}

export interface AffiliateTraderRow {
  traderId: string;
  registeredAt: Date;
  linkId: string | null;
  country: string | null;
  ftdAt: Date | null;
  ftdMinor: number;
  depositsCount: number;
  depositsSumMinor: number;
  withdrawalsSumMinor: number;
  turnoverMinor: number;
  earningsMinor: number;
}

export interface AffiliateLinkRow {
  id: string;
  code: string;
  url: string;
  kind: "HOME" | "REGISTER" | "APP";
  comment: string | null;
  isDefault: boolean;
  createdAt: Date;
}

export { getAffiliateLevelStatus, listLevelTerms } from "./affiliate-levels";
export { getAffiliateTotals, getAffiliateSeries, getAffiliateStatsBy, listAffiliateTraders } from "./affiliate-statistics";
export { listAffiliateLinks, createAffiliateLink } from "./affiliate-links";
