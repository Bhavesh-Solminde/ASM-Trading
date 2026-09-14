"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { BalancesDto, OpenTradeResult, ServerMessage, TradeView } from "@asm/contracts";
import { PriceChart } from "@/components/chart/PriceChart";
import { useEngineSocket } from "@/components/chart/useEngineSocket";
import { AccountSwitcher, type AccountView } from "@/components/AccountSwitcher";
import { TradeTicket } from "./TradeTicket";
import { TradesPanel } from "./TradesPanel";
import {
  applyTradeMessage,
  initialTradeState,
  withFetchedTrades,
  withOpenResult,
  type TradeState,
} from "./trade-state";

type Action =
  | { kind: "message"; message: ServerMessage }
  | { kind: "opened"; result: OpenTradeResult; socketLive: boolean }
  | { kind: "fetched"; accountId: string; trades: TradeView[] };

function reducer(state: TradeState, action: Action): TradeState {
  switch (action.kind) {
    case "message":
      return applyTradeMessage(state, action.message);
    case "opened":
      return withOpenResult(state, action.result, action.socketLive);
    case "fetched":
      return withFetchedTrades(state, action.accountId, action.trades);
  }
}

export function TradeWorkspace({
  symbol,
  displayName,
  precision,
  accounts,
  initialBalances,
  initialTrades,
}: {
  symbol: string;
  displayName: string;
  precision: number;
  accounts: AccountView[];
  initialBalances: Record<string, BalancesDto>;
  initialTrades: TradeView[];
}) {
  const [activeAccountId, setActiveAccountId] = useState(
    accounts.find((a) => a.type === "DEMO")?.id ?? accounts[0]?.id ?? "",
  );
  const [state, dispatch] = useReducer(
    reducer,
    { initialTrades, initialBalances },
    (init) => initialTradeState(init.initialTrades, init.initialBalances),
  );

  const onMessage = useCallback((message: ServerMessage) => dispatch({ kind: "message", message }), []);
  const { status, chart } = useEngineSocket({ symbol, timeframe: "1m", onMessage });

  // The page rendered history for the default account only; fetch on switch.
  useEffect(() => {
    if (!activeAccountId) return;
    const controller = new AbortController();
    void fetch(`/api/trades?accountId=${encodeURIComponent(activeAccountId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ trades: TradeView[] }>) : null))
      .then((body) => {
        if (body) dispatch({ kind: "fetched", accountId: activeAccountId, trades: body.trades });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeAccountId]);

  const active = accounts.find((a) => a.id === activeAccountId);
  const currency = active?.currency ?? "USD";

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <section className="flex flex-col gap-2 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold">{displayName}</span>
            {chart.payoutPct !== null ? (
              <span className="text-xs font-semibold text-[var(--color-up)]">{chart.payoutPct}%</span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {chart.lastPrice !== null ? (
              <span className="text-sm font-semibold tabular-nums">{chart.lastPrice.toFixed(precision)}</span>
            ) : null}
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: status === "open" ? "var(--color-up)" : "var(--color-ink-2)" }}
            >
              {status === "open" ? "Live" : status}
            </span>
          </div>
        </div>
        {status === "unauthorised" ? (
          <p className="text-xs text-[var(--color-down)]">Your session has ended. Log in again.</p>
        ) : null}
        <PriceChart candles={chart.candles} forming={chart.forming} precision={precision} />
      </section>

      <aside className="flex flex-col gap-4">
        <AccountSwitcher
          accounts={accounts}
          balances={state.balances}
          activeId={activeAccountId}
          onChange={setActiveAccountId}
        />
        <TradeTicket
          symbol={symbol}
          accountId={activeAccountId}
          currency={currency}
          payoutPct={chart.payoutPct}
          onOpened={(result) => dispatch({ kind: "opened", result, socketLive: status === "open" })}
        />
        <TradesPanel
          trades={state.tradesByAccount[activeAccountId] ?? []}
          currency={currency}
          precision={precision}
        />
      </aside>
    </div>
  );
}
