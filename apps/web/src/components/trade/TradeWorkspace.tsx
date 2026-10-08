"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TradeView } from "@asm/contracts";
import { PriceChart } from "@/components/chart/PriceChart";
import { SentimentBar } from "@/components/chart/SentimentBar";
import { TimeframeTabs } from "@/components/chart/TimeframeTabs";
import { ChartTypeSelector } from "@/components/chart/ChartTypeSelector";
import type { ChartType } from "@/components/chart/chart-types";
import { Icon } from "@/components/shell/Icon";
import { useMarket } from "@/components/shell/market-store";
import {
  usePlatform,
  useQuote,
  type AccountView,
  type PlatformAsset,
} from "@/components/shell/PlatformProvider";
import { tickDirection } from "@/components/shell/quotes";
import { splitAssetName } from "@/lib/asset-name";
import { formatMinor } from "@/lib/format-money";
import { clockTime } from "@/lib/format-time";
import { useDismiss } from "@/lib/use-dismiss";
import { useNowSec } from "@/lib/use-now";
import { MarketSelector } from "./MarketSelector";
import { TradeTicket } from "./TradeTicket";
import { TradesPanel } from "./TradesPanel";
import { AssetIcon } from "./AssetIcon";
import { grossReturnMinor } from "./pnl-display";

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
    <div className="pointer-events-none grid gap-0.5">
      <div className="flex items-center gap-2">
        <AssetIcon symbol={symbol} size="sm" />
        <span className="text-[14px] font-bold tracking-[0.03em] phone:text-[12px]">{pair}</span>
        {qualifier ? <span className="legend">{qualifier}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <span
          key={lastPrice ?? "none"}
          className={`led led-lit text-[26px] leading-none text-brand phone:text-[17px] ${
            direction ? `tick-${direction}` : ""
          }`}
        >
          {lastPrice === null ? "—" : lastPrice.toFixed(precision)}
        </span>
        <Icon
          name="arrow"
          className={`size-4 transition-[transform,color] duration-200 phone:size-3.5 ${
            direction === "down" ? "rotate-180 text-down" : direction === "up" ? "text-up" : "text-ink-3"
          }`}
        />
      </div>
    </div>
  );
}

/** Wall-clock chip inside the chart (blue dot / near-black pill / white time). */
function ChartClock() {
  const now = useNowSec();
  return (
    <div className="pointer-events-none flex w-max items-center gap-1.5 rounded-[4px] border border-brand/40 bg-ground/75 px-2 py-[3px] backdrop-blur">
      <span aria-hidden className="size-1.5 rounded-full bg-up shadow-[0_0_6px_var(--color-up)]" />
      <span className="led text-[12px] tracking-[0.05em] text-white">{now === null ? "" : clockTime(now)}</span>
    </div>
  );
}

function AccountPlateMini({ type }: { type: AccountView["type"] }) {
  const live = type === "LIVE";
  return (
    <span
      className={`grid grid-flow-col items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[9px] font-extrabold tracking-[0.12em] ${
        live ? "bg-up text-up-ink" : "border border-dotted border-[#555] text-ink-2"
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${
          live ? "bg-down shadow-[0_0_5px_var(--color-down)] live-pulse" : "bg-ink-3"
        }`}
      />
      {live ? "LIVE" : "DEMO"}
    </span>
  );
}

/**
 * Balance + account type inside the chart in fullscreen (focus) mode — and a
 * switcher: tapping it opens a menu to move between the DEMO and LIVE accounts
 * without leaving fullscreen.
 */
function FocusAccountSwitcher() {
  const { accounts, activeAccount, balances, setActiveAccountId } = usePlatform();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(ref, open, () => setOpen(false));
  if (!activeAccount) return null;

  const total = (acc: AccountView) => {
    const b = balances[acc.id];
    return b ? formatMinor(b.realBalance + b.bonusBalance, acc.currency) : "—";
  };
  const ordered = [...accounts].sort((a, b) => (a.type === b.type ? 0 : a.type === "LIVE" ? -1 : 1));

  return (
    <div ref={ref} className="pointer-events-auto relative w-max">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch account"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-[4px] border border-rule bg-ground/80 px-2 py-1 backdrop-blur hover:border-tile-hi"
      >
        <AccountPlateMini type={activeAccount.type} />
        <span className="led text-[14px] text-ink">{total(activeAccount)}</span>
        <Icon name="caret" className={`size-3.5 text-ink-2 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-40 w-[230px] rounded border border-rule bg-panel p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)]"
        >
          {ordered.map((acc) => {
            const isLive = acc.type === "LIVE";
            const active = acc.id === activeAccount.id;
            return (
              <button
                key={acc.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setActiveAccountId(acc.id);
                  setOpen(false);
                }}
                className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-[2px] px-2 py-2 text-left ${
                  active ? "bg-tile" : "hover:bg-tile"
                }`}
              >
                <AccountPlateMini type={acc.type} />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">{isLive ? "Live account" : "Demo account"}</span>
                  <span className="block text-[11px] text-ink-3">{total(acc)}</span>
                </span>
                <span
                  aria-hidden
                  className={`size-3.5 rounded-full ${active ? "border-[4px] border-up" : "border-[1.5px] border-[#4a4f55]"}`}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The win/loss card that pops on the chart when the active account's trade settles. */
function ResultPopup() {
  const { settlement, clearSettlement, activeAccount, assets } = usePlatform();
  const [shown, setShown] = useState<{ trade: TradeView; at: number } | null>(null);

  useEffect(() => {
    if (!settlement) return;
    setShown(settlement);
    const id = setTimeout(() => {
      setShown(null);
      clearSettlement();
    }, 3800);
    return () => clearTimeout(id);
  }, [settlement, clearSettlement]);

  if (!shown || !activeAccount) return null;
  const { trade } = shown;
  const won = trade.status === "WON";
  const refunded = trade.status === "REFUNDED";
  // A win shows what lands back in the balance: the stake plus the profit.
  const amountMinor = won ? grossReturnMinor(trade.stake, trade.pnl) : refunded ? 0 : Math.abs(trade.pnl);
  const sign = won ? "+" : refunded ? "" : "−";
  const asset = assets.find((a) => a.symbol === trade.symbol);
  const pair = asset ? splitAssetName(asset.displayName).pair : trade.symbol;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[40%] z-20 grid place-items-center px-4">
      <div
        className={`result-pop pointer-events-auto relative grid gap-0.5 rounded-md py-1.5 pl-3 pr-6 text-center shadow-[0_14px_34px_-12px_rgba(0,0,0,.85)] ${
          won ? "bg-up text-up-ink" : refunded ? "bg-tile text-ink" : "bg-down text-down-ink"
        }`}
      >
        <button
          type="button"
          aria-label="Dismiss result"
          onClick={() => {
            setShown(null);
            clearSettlement();
          }}
          className="absolute right-1 top-1 grid size-4 place-items-center rounded-full opacity-70 hover:bg-black/10 hover:opacity-100"
        >
          <Icon name="close" className="size-3" />
        </button>
        <span className="text-[8px] font-bold uppercase tracking-[0.14em] opacity-80">
          {won ? "Payout" : "Result"} · {pair}
        </span>
        <span className="led text-[17px] font-black leading-none">
          {sign}
          {formatMinor(amountMinor, activeAccount.currency)}
        </span>
      </div>
    </div>
  );
}

function LiveSentiment() {
  const { market } = usePlatform();
  const sentiment = useMarket(market, (s) => s.chart.sentiment);
  return <SentimentBar upPct={sentiment?.upPct ?? 50} downPct={sentiment?.downPct ?? 50} />;
}

const TOOL_BTN =
  "relative grid size-[34px] place-items-center rounded-[6px] border backdrop-blur transition-colors";

/**
 * Quotex-style in-chart tool stack for compact widths: a "⋯" button that
 * expands downward into the market and chart-type pickers, and a briefcase
 * under it (pushed down while expanded) that opens trades & history
 * (badge = open trades).
 */
function ChartToolCluster({
  assets,
  active,
  onSelect,
  onMarketOpenChange,
  chartType,
  onChartTypeChange,
  openCount,
  onOpenHistory,
  className = "",
}: {
  assets: PlatformAsset[];
  active: string;
  onSelect: (symbol: string) => void;
  onMarketOpenChange: (open: boolean) => void;
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
  openCount: number;
  onOpenHistory: () => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const collapse = useCallback(() => setExpanded(false), []);
  useDismiss(ref, expanded, collapse);

  return (
    <div ref={ref} className={`pointer-events-auto w-max flex-col gap-1.5 ${className}`}>
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          aria-label={expanded ? "Hide chart tools" : "Chart tools"}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className={`${TOOL_BTN} ${
            expanded ? "border-brand bg-brand/25 text-brand" : "border-rule bg-tile/85 text-ink hover:border-tile-hi"
          }`}
        >
          <Icon name={expanded ? "close" : "more"} className="size-4" strokeWidth={expanded ? 2 : 3.2} />
        </button>
        {expanded ? (
          <>
            <MarketSelector
              assets={assets}
              active={active}
              onSelect={(symbol) => {
                onSelect(symbol);
                setExpanded(false);
              }}
              compact
              iconOnly
              onOpenChange={onMarketOpenChange}
            />
            <ChartTypeSelector
              value={chartType}
              onChange={(type) => {
                onChartTypeChange(type);
                setExpanded(false);
              }}
            />
          </>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpenHistory}
        aria-label={`Trades & history (${openCount} open)`}
        title="Trades & history"
        className={`${TOOL_BTN} border-rule bg-tile/85 text-ink hover:border-tile-hi land:hidden`}
      >
        <Icon name="briefcase" className="size-4" />
        <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[9px] font-bold leading-none text-brand-ink">
          {openCount}
        </span>
      </button>
    </div>
  );
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

  const [historyOpen, setHistoryOpen] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("asm_chart_type") as ChartType | null;
      if (
        saved &&
        [
          "bars",
          "candles",
          "hollow_candles",
          "volume_candles",
          "hlc_bars",
          "line",
          "line_markers",
          "step_line",
          "area",
          "hlc_area",
          "baseline",
        ].includes(saved)
      ) {
        setChartType(saved);
      }
    } catch {}
  }, []);

  const handleChartTypeChange = (type: ChartType) => {
    setChartType(type);
    try {
      localStorage.setItem("asm_chart_type", type);
    } catch {}
  };

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
  const openCount = useMemo(() => trades.filter((t) => t.status === "OPEN").length, [trades]);

  const asset = assets.find((a) => a.symbol === chartSymbol);
  if (!asset || !activeAccount) {
    return (
      <p className="px-6 py-16 text-sm text-ink-2">
        No assets seeded. Run <code>pnpm db:seed</code>.
      </p>
    );
  }

  // Desktop fullscreen keeps the inline market + history row; compact widths use
  // the expandable tool cluster instead (see ChartToolCluster).
  const controlsClass = focusMode ? "flex phone:hidden" : "hidden";

  return (
    <section
      aria-label="Trade"
      className={`${focusMode ? "h-dvh" : "h-full"} grid w-full grid-cols-[minmax(0,1fr)_312px] phone:grid-cols-[minmax(0,1fr)] phone:grid-rows-[minmax(0,1fr)_auto] land:grid-cols-[minmax(0,1fr)_290px] land:grid-rows-[minmax(0,1fr)] wide:grid-cols-[minmax(0,1fr)_360px]`}
    >
      <div
        className={
          focusMode
            ? "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] gap-1 p-1.5"
            : "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5 py-3 pl-4 pr-3 phone:grid-rows-[minmax(0,1fr)] phone:gap-1 phone:p-1.5"
        }
      >
        {/* Desktop keeps the roomy market selector above the chart; on compact
            widths and in focus mode the market switch moves inside the chart.
            It deliberately doesn't report open/closed: marketPickerOpen lifts the
            in-chart overlay to z-50 for the in-chart pickers, and lifting it for
            this one would put the clock and price readout on top of its list. */}
        {focusMode ? null : (
          <div className="relative z-30 phone:hidden">
            <MarketSelector assets={assets} active={asset.symbol} onSelect={selectChartSymbol} />
          </div>
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
              chartType={chartType}
            />

            {/* Top-left overlay: account switcher (focus), then the compact tool
                cluster (phone) with the clock row and price readout beside it. */}
            <div className={`pointer-events-none absolute left-2 top-2 ${marketPickerOpen ? "z-50" : "z-10"} grid max-w-[calc(100%-16px)] gap-1.5 phone:gap-2`}>
              {focusMode ? <FocusAccountSwitcher /> : null}
              <div className="flex items-start gap-2 phone:gap-4">
                <ChartToolCluster
                  className="hidden phone:flex"
                  assets={assets}
                  active={asset.symbol}
                  onSelect={selectChartSymbol}
                  onMarketOpenChange={setMarketPickerOpen}
                  chartType={chartType}
                  onChartTypeChange={handleChartTypeChange}
                  openCount={openCount}
                  onOpenHistory={() => setHistoryOpen(true)}
                />
                <div className="grid min-w-0 gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <ChartClock />
                    <div className={`${controlsClass} pointer-events-auto items-center gap-1.5`}>
                      <MarketSelector
                        assets={assets}
                        active={asset.symbol}
                        onSelect={selectChartSymbol}
                        compact
                        iconOnly
                        onOpenChange={setMarketPickerOpen}
                      />
                      <button
                        type="button"
                        onClick={() => setHistoryOpen(true)}
                        aria-label="Trades & history"
                        title="Trades & history"
                        className="relative grid size-[34px] place-items-center rounded-[4px] border border-brand/50 bg-brand/15 text-brand backdrop-blur hover:border-brand hover:bg-brand/25 land:hidden"
                      >
                        <Icon name="history" className="size-5" />
                        {openCount > 0 ? (
                          <span className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-up text-[9px] font-bold text-up-ink">
                            {openCount}
                          </span>
                        ) : null}
                      </button>
                    </div>
                    <ChartTypeSelector
                      value={chartType}
                      onChange={handleChartTypeChange}
                      className="pointer-events-auto phone:hidden"
                    />
                  </div>
                  <ChartReadout symbol={asset.symbol} displayName={asset.displayName} precision={asset.precision} />
                </div>
              </div>
            </div>

            {status === "unauthorised" ? (
              <p className="absolute left-2 bottom-2 z-10 text-xs text-down">Your session has ended. Log in again.</p>
            ) : null}

            <TimeframeTabs className="absolute right-2 top-2 z-10" />
            {!marketPickerOpen ? (
              <button
                type="button"
                onClick={focusMode ? exitFocus : enterFocus}
                aria-label={focusMode ? "Exit fullscreen" : "Fullscreen chart"}
                className="absolute bottom-2 right-2 z-10 grid size-8 place-items-center phone:bottom-1 phone:right-1 phone:size-6 rounded border border-rule bg-ground/70 text-ink-2 backdrop-blur hover:border-tile-hi hover:text-ink"
              >
                <Icon name={focusMode ? "collapse" : "expand"} className="size-4 phone:size-3.5" />
              </button>
            ) : null}

            <ResultPopup />
          </div>
        </div>
      </div>

      <aside
        aria-label="Trade ticket and trades"
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-rule phone:grid-rows-[auto] phone:border-l-0 land:grid-rows-[auto_minmax(0,1fr)] land:border-l"
      >
        <TradeTicket
          symbol={asset.symbol}
          pair={splitAssetName(asset.displayName).pair}
          payoutPct={payoutPct}
          accountId={activeAccount.id}
          currency={activeAccount.currency}
          onOpened={recordOpened}
        />
        {focusMode ? null : (
          <div className="min-h-0 phone:hidden land:block">
            <TradesPanel trades={trades} currency={activeAccount.currency} assets={assets} />
          </div>
        )}
      </aside>

      {/* History / trades bottom sheet — the compact + fullscreen replacement for
          the always-on desktop trades panel. */}
      {historyOpen ? (
        <div className="fixed inset-0 z-50">
          <div aria-hidden onClick={() => setHistoryOpen(false)} className="absolute inset-0 bg-black/60" />
          <div className="sheet-in absolute inset-x-0 bottom-0 grid max-h-[72vh] grid-rows-[auto_minmax(0,1fr)] rounded-t-xl border-t border-rule bg-panel pb-[env(safe-area-inset-bottom)] shadow-[0_-24px_48px_-12px_rgba(0,0,0,.8)]">
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-2">Trades &amp; history</span>
              <button
                type="button"
                aria-label="Close trades"
                onClick={() => setHistoryOpen(false)}
                className="grid size-8 place-items-center rounded text-ink-2 hover:bg-tile hover:text-ink"
              >
                <Icon name="close" className="size-[18px]" />
              </button>
            </div>
            <div className="min-h-0 overflow-hidden">
              <TradesPanel trades={trades} currency={activeAccount.currency} assets={assets} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
