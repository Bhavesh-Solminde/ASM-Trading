"use client";

import { useMemo } from "react";
import type { TradeView } from "@asm/contracts";
import { PriceChart } from "@/components/chart/PriceChart";
import { SentimentBar } from "@/components/chart/SentimentBar";
import { Icon } from "@/components/shell/Icon";
import { useMarket } from "@/components/shell/market-store";
import { usePlatform, useQuote } from "@/components/shell/PlatformProvider";
import { tickDirection } from "@/components/shell/quotes";
import { splitAssetName } from "@/lib/asset-name";
import { MarketSelector } from "./MarketSelector";
import { TradeTicket } from "./TradeTicket";
import { TradesPanel } from "./TradesPanel";

const NO_TRADES: TradeView[] = [];

/** Best-effort native fullscreen; the layout's focus mode is the real source of truth. */
function toggleNativeFullscreen(on: boolean): void {
  try {
    if (on) void document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) void document.exitFullscreen?.();
  } catch {
    // Fullscreen API blocked or unsupported — focus mode still applies.
  }
}

/** The big price readout; the only part of the stage that renders on a tick. */
function ChartReadout({ symbol, displayName, precision }: { symbol: string; displayName: string; precision: number }) {
  const { market } = usePlatform();
  const lastPrice = useMarket(
    market,
    (s) => (s.chart.symbol === symbol ? s.chart.lastPrice : null) ?? s.quotes[symbol]?.price ?? null,
  );
  const quote = useQuote(symbol);
  const direction = quote ? tickDirection(quote) : null;
  const { pair, market: qualifier } = splitAssetName(displayName);

  return (
    <div className="pointer-events-none absolute left-2 top-2 grid gap-1.5">
      <div className="flex items-center gap-2.5">
        <span className="text-[15px] font-bold tracking-[0.03em]">{pair}</span>
        {qualifier ? <span className="legend">{qualifier}</span> : null}
      </div>
      <div className="flex items-center gap-2.5">
        <span
          key={lastPrice ?? "none"}
          className={`led led-lit text-[28px] leading-none text-brand phone:text-[22px] ${
            direction ? `tick-${direction}` : ""
          }`}
        >
          {lastPrice === null ? "—" : lastPrice.toFixed(precision)}
        </span>
        <Icon
          name="arrow"
          className={`size-[18px] transition-[transform,color] duration-200 ${
            direction === "down" ? "rotate-180 text-down" : direction === "up" ? "text-up" : "text-ink-3"
          }`}
        />
      </div>
    </div>
  );
}

function LiveSentiment() {
  const { market } = usePlatform();
  const sentiment = useMarket(market, (s) => s.chart.sentiment);
  return <SentimentBar upPct={sentiment?.upPct ?? 50} downPct={sentiment?.downPct ?? 50} />;
}

export function TradeWorkspace() {
  const {
    assets,
    market,
    chartSymbol,
    selectChartSymbol,
    status,
    activeAccount,
    tradesByAccount,
    recordOpened,
    focusMode,
    setFocusMode,
  } = usePlatform();

  function enterFocus(): void {
    setFocusMode(true);
    toggleNativeFullscreen(true);
  }
  function exitFocus(): void {
    setFocusMode(false);
    toggleNativeFullscreen(false);
  }

  const payoutPct = useMarket(
    market,
    (s) => (s.chart.symbol === chartSymbol ? s.chart.payoutPct : null) ?? s.quotes[chartSymbol]?.payoutPct ?? null,
  );
  const trades = (activeAccount && tradesByAccount[activeAccount.id]) || NO_TRADES;
  const openOnChart = useMemo(
    () => trades.filter((t) => t.status === "OPEN" && t.symbol === chartSymbol),
    [trades, chartSymbol],
  );

  const asset = assets.find((a) => a.symbol === chartSymbol);
  if (!asset || !activeAccount) {
    return (
      <p className="px-6 py-16 text-sm text-ink-2">
        No assets seeded. Run <code>pnpm db:seed</code>.
      </p>
    );
  }

  return (
    <section
      aria-label="Trade"
      className={
        focusMode
          ? "grid h-dvh grid-rows-[minmax(0,1fr)_auto] grid-cols-[minmax(0,1fr)]"
          : "grid h-full grid-cols-[minmax(0,1fr)_312px] phone:h-auto phone:grid-cols-[minmax(0,1fr)]"
      }
    >
      <div
        className={
          focusMode
            ? "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] gap-1 p-1.5"
            : "grid min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5 py-3 pl-4 pr-3 phone:grid-rows-[auto_clamp(360px,72dvh,720px)] phone:gap-1 phone:p-1.5"
        }
      >
        {focusMode ? null : (
          <MarketSelector assets={assets} active={asset.symbol} onSelect={selectChartSymbol} />
        )}

        <div className="chartbox-bg relative grid min-h-0 grid-cols-[30px_minmax(0,1fr)] gap-2.5 rounded border border-rule pl-2.5 pt-2.5 phone:grid-cols-[18px_minmax(0,1fr)] phone:gap-1.5 phone:pl-1.5">
          <LiveSentiment />

          <div className="relative min-h-0">
            <PriceChart
              market={market}
              precision={asset.precision}
              watermark={activeAccount.type === "DEMO" ? "DEMO" : ""}
              openTrades={openOnChart}
              currency={activeAccount.currency}
            />
            <ChartReadout symbol={asset.symbol} displayName={asset.displayName} precision={asset.precision} />
            {status === "unauthorised" ? (
              <p className="absolute left-2 top-[78px] text-xs text-down">Your session has ended. Log in again.</p>
            ) : null}
            <div className="legend pointer-events-none absolute right-[92px] top-2.5 text-ink-3! phone:hidden">
              1m candles
            </div>
            <button
              type="button"
              onClick={focusMode ? exitFocus : enterFocus}
              aria-label={focusMode ? "Exit fullscreen" : "Fullscreen chart"}
              className={`absolute right-2 top-2 grid size-8 place-items-center rounded border border-rule bg-ground/70 text-ink-2 backdrop-blur hover:border-tile-hi hover:text-ink ${
                focusMode ? "" : "hidden phone:grid"
              }`}
            >
              <Icon name={focusMode ? "close" : "arrow"} className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <aside
        aria-label="Trade ticket and trades"
        className={
          focusMode
            ? "grid min-h-0 grid-rows-[auto]"
            : "grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-rule phone:border-l-0"
        }
      >
        <TradeTicket
          symbol={asset.symbol}
          pair={splitAssetName(asset.displayName).pair}
          payoutPct={payoutPct}
          accountId={activeAccount.id}
          currency={activeAccount.currency}
          live={activeAccount.type === "LIVE"}
          onOpened={recordOpened}
        />
        {focusMode ? null : (
          <TradesPanel trades={trades} currency={activeAccount.currency} assets={assets} />
        )}
      </aside>
    </section>
  );
}
