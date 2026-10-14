import { withFetchedTrades, type TradeState } from "@asm/client-core";
import type { BalancesDto, Bootstrap, TradeView } from "@asm/contracts";
import { parseTrades } from "./trades";

/**
 * Folds a bootstrap response into live trade state without undoing anything the socket delivered while the
 * request was in flight.
 *  - Trades merge (a settled version always beats an open one), so settlements missed in the background
 *    appear and fresher socket settlements are never rolled back.
 *  - A balance is replaced only if the request STARTED after the last socket `balance:update` for that
 *    account (`balanceAt`, epoch ms): then the response reflects it. Otherwise the socket's figure is newer.
 *    An account with no balance yet always takes the bootstrap's.
 */
export function mergeBootstrap(
  state: TradeState,
  balanceAt: Readonly<Record<string, number>>,
  boot: Bootstrap,
  requestedAt: number,
): TradeState {
  const byAccount = new Map<string, TradeView[]>();
  for (const t of parseTrades(boot.recentTrades)) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);

  let next = state;
  for (const [accountId, fetched] of byAccount) next = withFetchedTrades(next, accountId, fetched);

  const balances: Record<string, BalancesDto> = { ...next.balances };
  for (const a of boot.accounts) {
    const socketAt = balanceAt[a.id];
    if (balances[a.id] === undefined || socketAt === undefined || requestedAt > socketAt) {
      balances[a.id] = { realBalance: a.realBalance, bonusBalance: a.bonusBalance };
    }
  }
  return { ...next, balances };
}
