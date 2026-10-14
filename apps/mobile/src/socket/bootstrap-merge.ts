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
 *  - That timestamp rule is the ONLY way a balance is replaced. A settlement recovered by this response (the
 *    store held the trade open) does not override it: a newer balance may come from after the reconnect or from
 *    an HTTP open result stamped while the socket was down, and the response can predate it. When such a
 *    balance is kept, `recoveredAccountsWithStaleBalance` names the account so the caller can refetch once more
 *    (that request starts later, so it wins under the same rule).
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
    if (takesBootstrapBalance(balances[a.id] !== undefined, balanceAt[a.id], requestedAt)) {
      balances[a.id] = { realBalance: a.realBalance, bonusBalance: a.bonusBalance };
    }
  }
  return { ...next, balances };
}

/** The one balance rule: an account with no balance takes the bootstrap's; otherwise the request must have started after the last stamp. */
function takesBootstrapBalance(hasBalance: boolean, stampedAt: number | undefined, requestedAt: number): boolean {
  return !hasBalance || stampedAt === undefined || requestedAt > stampedAt;
}

/**
 * Accounts that `mergeBootstrap` recovered a settlement for but whose bootstrap balance it did NOT apply because a
 * newer stamp exists. The kept balance is probably right already, but nothing proves it, so these accounts want one
 * follow-up bootstrap. It cannot repeat: a recovered trade is settled in the store afterwards, so the follow-up
 * recovers nothing and reports nothing. `state` is the store state BEFORE the merge.
 */
export function recoveredAccountsWithStaleBalance(
  state: TradeState,
  recovered: readonly TradeView[],
  balanceAt: Readonly<Record<string, number>>,
  boot: Bootstrap,
  requestedAt: number,
): string[] {
  const accounts = new Set(recovered.map((t) => t.accountId));
  return boot.accounts
    .filter((a) => accounts.has(a.id) && !takesBootstrapBalance(state.balances[a.id] !== undefined, balanceAt[a.id], requestedAt))
    .map((a) => a.id);
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
