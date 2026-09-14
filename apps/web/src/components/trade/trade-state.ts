import type { BalancesDto, ServerMessage, TradeView } from "@asm/contracts";

const MAX_TRADES_PER_ACCOUNT = 50;

export interface TradeState {
  /** Newest first, per account. */
  readonly tradesByAccount: Readonly<Record<string, TradeView[]>>;
  readonly balances: Readonly<Record<string, BalancesDto>>;
}

export function initialTradeState(
  trades: TradeView[],
  balances: Record<string, BalancesDto>,
): TradeState {
  let state: TradeState = { tradesByAccount: {}, balances };
  for (const trade of trades) state = withTrade(state, trade);
  return state;
}

/**
 * Inserts or replaces a trade by id, newest first.
 *
 * A settled version always replaces an open one and never the reverse: the
 * HTTP response to "open" and the socket's trade:opened / trade:settled can
 * arrive in any order, and a late "OPEN" must not resurrect a finished trade.
 */
export function upsertTrade(trades: readonly TradeView[], trade: TradeView): TradeView[] {
  const existing = trades.find((t) => t.id === trade.id);
  if (existing && existing.status !== "OPEN" && trade.status === "OPEN") return [...trades];
  return [trade, ...trades.filter((t) => t.id !== trade.id)]
    .sort((a, b) => b.entryTs - a.entryTs)
    .slice(0, MAX_TRADES_PER_ACCOUNT);
}

export function withTrade(state: TradeState, trade: TradeView): TradeState {
  const current = state.tradesByAccount[trade.accountId] ?? [];
  return {
    ...state,
    tradesByAccount: { ...state.tradesByAccount, [trade.accountId]: upsertTrade(current, trade) },
  };
}

export function withBalances(state: TradeState, accountId: string, balances: BalancesDto): TradeState {
  return { ...state, balances: { ...state.balances, [accountId]: balances } };
}

/**
 * Replaces one account's list with a freshly fetched one, without losing a
 * more final version already received over the socket while the fetch was
 * in flight.
 */
export function withFetchedTrades(
  state: TradeState,
  accountId: string,
  fetched: readonly TradeView[],
): TradeState {
  let merged: TradeView[] = [];
  for (const trade of fetched) merged = upsertTrade(merged, trade);
  for (const trade of state.tradesByAccount[accountId] ?? []) merged = upsertTrade(merged, trade);
  return { ...state, tradesByAccount: { ...state.tradesByAccount, [accountId]: merged } };
}

export function applyTradeMessage(state: TradeState, message: ServerMessage): TradeState {
  switch (message.type) {
    case "trade:opened":
    case "trade:settled":
      return withTrade(state, message.trade);
    case "balance:update":
      return withBalances(state, message.accountId, {
        realBalance: message.realBalance,
        bonusBalance: message.bonusBalance,
      });
    default:
      return state;
  }
}
