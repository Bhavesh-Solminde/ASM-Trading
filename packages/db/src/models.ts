/**
 * Row types as the extended client returns them: BIGINT money columns are
 * `number`, not `bigint` (see client.ts). Import these model types from here
 * rather than from the generated client, whose types still say `bigint`.
 */
import type * as G from "../generated/prisma/client";

/** Swap the listed `bigint` fields of `T` for `number`, keeping nullability. */
type WithNumbers<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: null extends T[P] ? number | null : number;
};

export type User = WithNumbers<G.User, "cumulativeDeposits">;
export type Account = WithNumbers<
  G.Account,
  "realBalance" | "bonusBalance" | "turnoverProgress" | "medianStake" | "dailyLimit"
>;
export type Trade = WithNumbers<G.Trade, "stake" | "stakeFromBonus" | "pnl">;
export type HouseDay = WithNumbers<
  G.HouseDay,
  "targetProfitMinor" | "realizedProfitMinor" | "totalStakesMinor" | "totalPayoutsMinor"
>;
export type HouseTreasury = WithNumbers<G.HouseTreasury, "treasuryMinor" | "treasuryTargetMinor">;
export type TradeShadow = WithNumbers<G.TradeShadow, "exposureUp" | "exposureDown">;
export type Deposit = WithNumbers<G.Deposit, "amountUsd" | "amountInr" | "amountUsdtMinor">;
export type BankCredit = WithNumbers<G.BankCredit, "amountInr">;
export type RelayMessage = WithNumbers<G.RelayMessage, "parsedAmountInr">;
export type ChainCredit = WithNumbers<G.ChainCredit, "normalizedAmountMinor">;
export type Withdrawal = WithNumbers<G.Withdrawal, "amount">;
export type Transaction = WithNumbers<G.Transaction, "amount" | "balanceAfter">;
export type BonusGrant = WithNumbers<G.BonusGrant, "amount" | "turnoverRequired" | "turnoverDone">;
