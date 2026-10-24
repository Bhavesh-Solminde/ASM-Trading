"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { TIMEFRAMES, type TradeView } from "@asm/contracts";
import { useChartProtection } from "@/lib/chart-protection-preference";
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
} from "@/components/shell/PlatformProvider";
import { changePct, tickDirection } from "@/components/shell/quotes";
import { splitAssetName } from "@/lib/asset-name";
import { formatMinor } from "@/lib/format-money";
import { clockTime } from "@/lib/format-time";
import { useDismiss } from "@/lib/use-dismiss";
import { useNowSec } from "@/lib/use-now";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { MarketSelector } from "./MarketSelector";
import type { CfdOpenTradeResult } from "@asm/contracts";
import { CfdTradeTicket } from "./CfdTradeTicket";
import { TradeTicket } from "./TradeTicket";
import { TradesPanel } from "./TradesPanel";

import { AssetIcon } from "./AssetIcon";
import { SettlementResultCard } from "./SettlementResultCard";
import { PositionStrip } from "./PositionStrip";

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
        live ? "bg-up text-up-ink" : "border border-dotted border-ink-3 text-ink-2"
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
                  className={`size-3.5 rounded-full ${active ? "border-[4px] border-up" : "border-[1.5px] border-ink-3"}`}
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
  const asset = assets.find((a) => a.symbol === trade.symbol);
  const pair = asset ? splitAssetName(asset.displayName).pair : trade.symbol;

  return (
    <SettlementResultCard
      trade={trade}
      currency={activeAccount.currency}
      pair={pair}
      onDismiss={() => {
        setShown(null);
        clearSettlement();
      }}
    />
  );
}

/**
 * Trader sentiment. Desktop keeps the labelled column beside the chart; on
 * phones it is a thin overlay on the chart's left edge (labels live in the
 * aria-label) so the chart can run edge to edge.
 */
function LiveSentiment() {
  const { market } = usePlatform();
  const sentiment = useMarket(market, (s) => s.chart.sentiment);
  const upPct = sentiment?.upPct ?? 50;
  const downPct = sentiment?.downPct ?? 50;
  return (
    <>
      <div className="contents phone:hidden">
        <SentimentBar upPct={upPct} downPct={downPct} />
      </div>
      <div
        role="img"
        aria-label={`Trader sentiment: ${upPct}% up, ${downPct}% down`}
        className="pointer-events-none absolute bottom-24 left-1.5 top-24 z-[5] hidden w-[3px] flex-col overflow-hidden rounded-sm bg-down phone:flex land:bottom-20 land:top-16"
      >
        <div className="mt-auto bg-up transition-[height] duration-[600ms] ease-[cubic-bezier(.2,.8,.2,1)]" style={{ height: `${upPct}%` }} />
      </div>
    </>
  );
}

/** Phone price readout under the market pill: last price (blue, ticks green/red) and the move since the history started. */
function PhoneReadout({ symbol, precision }: { symbol: string; precision: number }) {
  const { market } = usePlatform();
  const lastPrice = useMarket(
    market,
    (s) => (s.chart.symbol === symbol ? s.chart.lastPrice : null) ?? s.quotes[symbol]?.price ?? null,
  );
  const quote = useQuote(symbol);
  const direction = quote ? tickDirection(quote) : null;
  const change = quote ? changePct(quote) : null;

  return (
    <div className="pointer-events-none flex items-baseline gap-2 pl-0.5">
      <span
        key={lastPrice ?? "none"}
        className={`led led-lit text-[26px] font-extrabold leading-none tracking-[-0.02em] text-brand land:text-[20px] ${
          direction ? `tick-${direction}` : ""
        }`}
      >
        {lastPrice === null ? "—" : lastPrice.toFixed(precision)}
      </span>
      {change !== null ? (
        <span className={`text-xs font-bold tabular-nums ${change >= 0 ? "text-up" : "text-down"}`}>
          {change >= 0 ? "+" : "−"}
          {Math.abs(change).toFixed(2)}%
        </span>
      ) : null}
    </div>
  );
}

/** Phone candle-timeframe switch, top-right of the chart: a tile with 44px-tall hit areas around 28px buttons. */
function PhoneTimeframeTabs() {
  const { timeframe, selectTimeframe } = usePlatform();
  return (
    <div
      role="group"
      aria-label="Candle timeframe"
      className="pointer-events-auto mt-1 flex flex-none gap-0.5 rounded-[10px] bg-tile/94 p-[3px]"
    >
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          aria-pressed={tf === timeframe}
          onClick={() => selectTimeframe(tf)}
          className={`relative h-7 rounded-lg px-2 text-xs font-bold transition-colors after:absolute after:inset-x-0 after:-inset-y-2 min-[380px]:px-[9px] ${
            tf === timeframe ? "bg-tile-hi text-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}

const TOOL_TILE =
  "relative grid size-10 place-items-center rounded-xl bg-tile/94 text-ink-2 transition-colors hover:bg-tile-hi hover:text-ink active:bg-tile-hi";

/**
 * Phone chart tools, bottom-left of the chart (secondary: the market pill and
 * timeframes are the primary controls up top): chart style, and the trades &
 * history sheet with a badge for the open-trade count.
 */
function ChartTools({
  chartType,
  onChartTypeChange,
  openCount,
  onOpenHistory,
  className = "",
}: {
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
  openCount: number;
  onOpenHistory: () => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 ${className}`}>
      <ChartTypeSelector tool value={chartType} onChange={onChartTypeChange} />
      <button
        type="button"
        onClick={onOpenHistory}
        aria-label={`Trades & history (${openCount} open)`}
        title="Trades & history"
        className={`${TOOL_TILE} land:hidden`}
      >
        <Icon name="briefcase" className="size-[18px]" />
        <span
          className={`absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-extrabold leading-none ${
            openCount > 0 ? "bg-brand-fill text-white" : "bg-tile-hi text-ink-2"
          }`}
        >
          {openCount}
        </span>
      </button>
    </div>
  );
}

/**
 * History / trades bottom sheet — the compact + fullscreen replacement for the
 * always-on desktop trades panel. Locks the page behind it so a swipe on the
 * list scrolls the list, not the page.
 */
function TradesSheet({ onClose, ...panel }: ComponentProps<typeof TradesPanel> & { onClose: () => void }) {
  useScrollLock();
  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trades-sheet-title"
        className="sheet sheet-in absolute inset-x-0 bottom-0 mx-auto grid max-h-[72vh] w-full max-w-[560px] grid-rows-[auto_auto_minmax(0,1fr)] overscroll-contain">
        <div aria-hidden className="sheet-handle" />
        <div className="flex items-center justify-between pl-4 pr-2">
          <h2 id="trades-sheet-title" className="text-sm font-semibold text-ink">Trades &amp; history</h2>
          <button
            type="button"
            aria-label="Close trades"
            onClick={onClose}
            className="grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-tile hover:text-ink"
          >
            <Icon name="close" className="size-[18px]" />
          </button>
        </div>
        <div className="min-h-0 overflow-hidden">
          <TradesPanel {...panel} />
        </div>
      </div>
    </div>
  );
}

export function TradeWorkspace({ tradingModel }: { tradingModel: "BINARY" | "CFD" }) {
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

  const recordCfdOpened = useCallback(
    (result: CfdOpenTradeResult) => {
      recordOpened({
        balances: result.balances,
        trade: { ...result.trade, direction: result.trade.direction === "LONG" ? "UP" : "DOWN", payoutPct: 0, durationSec: result.trade.expiryTs - result.trade.entryTs },
      });
    },
    [recordOpened],
  );

  const chartProtection = useChartProtection();
  const chartTimeframe = useMarket(market, s => s.chart.timeframe);
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
            ? "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] gap-1 p-1.5 phone:p-0"
            : "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5 py-3 pl-4 pr-3 phone:grid-rows-[minmax(0,1fr)] phone:gap-0 phone:p-0"
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

        <div className="chartbox-bg relative grid min-h-0 grid-cols-[30px_minmax(0,1fr)] gap-2.5 rounded border border-rule pl-2.5 pt-2.5 phone:grid-cols-[minmax(0,1fr)] phone:gap-0 phone:rounded-none phone:border-0 phone:p-0">
          <LiveSentiment />

          <div className="relative min-h-0">
            <PriceChart
              market={market}
              precision={asset.precision}
              watermark={activeAccount.type === "DEMO" ? "DEMO" : ""}
              openTrades={openOnChart}
              currency={activeAccount.currency}
              chartType={chartType}
              enableBrackets={tradingModel === "CFD"}
              bracketScope={`${activeAccount.id}:${asset.symbol}:${chartTimeframe}:${chartType}:${chartProtection}`}
              bracketControls={chartProtection}
              tickSize={asset.tickSize ?? 10 ** -asset.precision}
            />

            {/* Desktop top-left overlay (clock, focus-mode switcher + market/history
                buttons, chart style, price readout). Phones use the pill row and
                bottom tools below instead. */}
            <div className={`pointer-events-none absolute left-2 top-2 ${marketPickerOpen ? "z-50" : "z-10"} grid max-w-[calc(100%-16px)] gap-1.5 phone:hidden`}>
              {focusMode ? <FocusAccountSwitcher /> : null}
              <div className="flex items-start gap-2">
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
                      className="relative grid size-[34px] place-items-center rounded-[4px] border border-brand/50 bg-brand/15 text-brand backdrop-blur hover:border-brand hover:bg-brand/25"
                    >
                      <Icon name="history" className="size-5" />
                      {openCount > 0 ? (
                        <span className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-up text-[9px] font-bold text-up-ink">
                          {openCount}
                        </span>
                      ) : null}
                    </button>
                  </div>
                  <ChartTypeSelector value={chartType} onChange={handleChartTypeChange} className="pointer-events-auto" />
                </div>
                <ChartReadout symbol={asset.symbol} displayName={asset.displayName} precision={asset.precision} />
              </div>
              </div>
            </div>

            {/* Phone top row: the market pill (always one tap from the picker) with
                the price under it, timeframes on the right. In fullscreen the
                account switcher and clock sit above the pill. */}
            <div
              className={`pointer-events-none absolute inset-x-3.5 top-3 ${marketPickerOpen ? "z-50" : "z-10"} hidden items-start justify-between gap-2 phone:flex land:inset-x-2 land:top-2`}
            >
              <div className="grid min-w-0 gap-2 land:gap-1">
                {focusMode ? (
                  <>
                    <FocusAccountSwitcher />
                    <ChartClock />
                  </>
                ) : null}
                <div className="pointer-events-auto flex min-w-0">
                  <MarketSelector
                    assets={assets}
                    active={asset.symbol}
                    onSelect={selectChartSymbol}
                    pill
                    onOpenChange={setMarketPickerOpen}
                  />
                </div>
                <PhoneReadout symbol={asset.symbol} precision={asset.precision} />
              </div>
              <PhoneTimeframeTabs />
            </div>

            {/* Phone bottom row: chart tools bottom-left, the live position strip
                beside them (above the time axis, clear of the fullscreen button). */}
            <div className="pointer-events-none absolute inset-x-3.5 bottom-8 z-10 hidden items-end gap-2 phone:flex land:inset-x-2 land:bottom-7">
              <ChartTools
                className="pointer-events-auto flex-none"
                chartType={chartType}
                onChartTypeChange={handleChartTypeChange}
                openCount={openCount}
                onOpenHistory={() => setHistoryOpen(true)}
              />
              {tradingModel !== "CFD" && <PositionStrip
                className="pointer-events-none min-w-0 max-w-[420px] flex-1 land:hidden"
                trades={trades}
                assets={assets}
                currency={activeAccount.currency}
                onOpen={() => setHistoryOpen(true)}
              />}
            </div>

            {status === "unauthorised" ? (
              <p className="absolute left-2 bottom-2 z-10 text-xs text-down phone:bottom-[88px] phone:left-3.5">Your session has ended. Log in again.</p>
            ) : null}

            <TimeframeTabs className="absolute right-2 top-2 z-10 phone:hidden" />
            {!marketPickerOpen ? (
              <button
                type="button"
                onClick={focusMode ? exitFocus : enterFocus}
                aria-label={focusMode ? "Exit fullscreen" : "Fullscreen chart"}
                className="absolute bottom-2 right-2 z-10 grid size-8 place-items-center phone:bottom-1 phone:right-1 phone:size-6 phone:after:absolute phone:after:-inset-2 rounded border border-rule bg-ground/70 text-ink-2 backdrop-blur hover:border-tile-hi hover:text-ink"
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
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-rule phone:grid-rows-[auto] phone:rounded-t-[20px] phone:border-l-0 phone:bg-panel land:grid-rows-[auto_minmax(0,1fr)] land:rounded-none land:border-l land:bg-transparent"
      >
        {tradingModel === "CFD" ? (
          <CfdTradeTicket
            symbol={asset.symbol}
            pair={splitAssetName(asset.displayName).pair}
            accountId={activeAccount.id}
            currency={activeAccount.currency}
            onOpened={recordCfdOpened}
          />
        ) : (
          <TradeTicket
            symbol={asset.symbol}
            pair={splitAssetName(asset.displayName).pair}
            payoutPct={payoutPct}
            accountId={activeAccount.id}
            currency={activeAccount.currency}
            onOpened={recordOpened}
          />
        )}
        {focusMode ? null : (
          <div className="min-h-0 phone:hidden land:block">
            <TradesPanel trades={trades} currency={activeAccount.currency} assets={assets} />
          </div>
        )}
      </aside>

      {historyOpen ? (
        <TradesSheet
          trades={trades}
          currency={activeAccount.currency}
          assets={assets}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </section>
  );
}
