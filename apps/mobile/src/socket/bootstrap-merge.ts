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
 *  - Exception: an account where the response settles a trade the store still held OPEN. Socket delivery is
 *    ordered, so every socket balance seen so far predates that settlement (its push was lost); the response
 *    includes it, so it wins whatever the stamps say. Without this a settlement recovered by a refetch could
 *    close the trade but leave the balance stale, and the watchdog stops once nothing is open.
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

  const recoveredAccounts = new Set(recoveredSettlements(state, next).map((t) => t.accountId));
  const balances: Record<string, BalancesDto> = { ...next.balances };
  for (const a of boot.accounts) {
    const socketAt = balanceAt[a.id];
    if (balances[a.id] === undefined || socketAt === undefined || requestedAt > socketAt || recoveredAccounts.has(a.id)) {
      balances[a.id] = { realBalance: a.realBalance, bonusBalance: a.bonusBalance };
    }
  }
  return { ...next, balances };
}

/**
 * Trades that `before` held OPEN and `after` holds settled: settlements this device never received over the
 * socket and learned from a refetch. A trade it never saw open is not listed (that is history, not news).
 */
export function recoveredSettlements(before: TradeState, after: TradeState): TradeView[] {
  const wasOpen = new Set<string>();
  for (const list of Object.values(before.tradesByAccount)) for (const t of list) if (t.status === "OPEN") wasOpen.add(t.id);
  if (wasOpen.size === 0) return [];
  const out: TradeView[] = [];
  for (const list of Object.values(after.tradesByAccount)) for (const t of list) if (t.status !== "OPEN" && wasOpen.has(t.id)) out.push(t);
  return out;
}
