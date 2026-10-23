"use client";

import { useCallback, useRef, useState } from "react";
import type { CfdOpenTradeResult } from "@asm/contracts";
import { Icon } from "@/components/shell/Icon";
import { usePlatform, useQuote } from "@/components/shell/PlatformProvider";
import { minStakeMinor } from "@/lib/currency";
import { currencySymbol, formatMinor } from "@/lib/format-money";
import { StakeSheet } from "./StakeSheet";
import { defaultStake, groupAmount } from "./stake";

type CfdDirection = "LONG" | "SHORT";

const DURATION_PRESETS = [
  { label: "30s", sec: 30 },
  { label: "1m", sec: 60 },
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "1h", sec: 3600 },
] as const;

const CHIP =
  "h-10 min-w-0 rounded-xl text-[13px] font-bold tabular-nums transition-colors land:h-9";

function formatDurationLabel(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function CfdTradeTicket({
  symbol,
  pair,
  accountId,
  currency,
  onOpened,
}: {
  symbol: string;
  pair: string;
  accountId: string;
  currency: string;
  onOpened: (result: CfdOpenTradeResult) => void;
}) {
  const [durationSec, setDurationSec] = useState(300);
  const [stakeInput, setStakeInput] = useState(() => defaultStake(currency));
  const [slEnabled, setSlEnabled] = useState(false);
  const [tpEnabled, setTpEnabled] = useState(false);
  const [slPct, setSlPct] = useState("10");
  const [tpPct, setTpPct] = useState("10");
  const [stakeOpen, setStakeOpen] = useState(false);
  const tileRef = useRef<HTMLButtonElement | null>(null);
  const { balances, accounts } = usePlatform();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fired, setFired] = useState<CfdDirection | null>(null);
  const quote = useQuote(symbol);
  const currentPrice = quote?.price ?? 0;
  const minStake = minStakeMinor(currency);

  const stakeMajor = Number(stakeInput);
  const stakeMinor =
    Number.isFinite(stakeMajor) && stakeMajor > 0
      ? Math.round(stakeMajor * 100)
      : 0;
  const accountBalance = balances[accountId];
  const balanceMinor = accountBalance
    ? accountBalance.realBalance + accountBalance.bonusBalance
    : null;
  const accountLabel =
    accounts.find((a) => a.id === accountId)?.type === "LIVE"
      ? "Live"
      : "Demo";

  const closeStake = useCallback(() => {
    setStakeOpen(false);
    tileRef.current?.focus();
  }, []);

  const slPrice =
    slEnabled && currentPrice > 0
      ? currentPrice * (1 - Number(slPct) / 100)
      : null;
  const tpPrice =
    tpEnabled && currentPrice > 0
      ? currentPrice * (1 + Number(tpPct) / 100)
      : null;

  async function place(direction: CfdDirection): Promise<void> {
    if (stakeMinor === 0) {
      setError("Enter an investment amount.");
      return;
    }
    if (stakeMinor < minStake) {
      setError(`Minimum investment is ${formatMinor(minStake, currency)}.`);
      return;
    }
    setFired(direction);
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        symbol,
        direction,
        stake: stakeMinor,
        durationSec,
        accountId,
      };
      if (slEnabled && slPct) body.stopLoss = Number(slPct);
      if (tpEnabled && tpPct) body.takeProfit = Number(tpPct);

      const res = await fetch("/api/cfd/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<CfdOpenTradeResult> & {
        error?: string;
      };
      if (res.ok && data.trade && data.balances) {
        onOpened({ trade: data.trade, balances: data.balances });
      } else {
        setError(data.error ?? "Could not place that trade.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const slab =
    "relative grid h-[58px] grid-cols-[1fr_auto] items-center overflow-hidden rounded pl-[18px] pr-4 text-left text-[17px] font-black uppercase tracking-[0.08em] transition-[filter,transform] phone:h-16 phone:rounded-2xl phone:pl-3.5 phone:pr-3.5 phone:text-lg phone:font-extrabold phone:leading-none land:h-12";
  const slabLive =
    "hover:brightness-110 active:translate-y-px disabled:cursor-wait";
  const slabNote =
    "mt-0.5 block text-[10px] font-bold normal-case tracking-[0.1em] opacity-75 max-[359px]:hidden";
  const pnlIfUp =
    stakeMinor > 0 ? formatMinor(Math.floor(stakeMinor * 0.01), currency) : "—";

  return (
    <div className="relative grid gap-3 border-b border-rule px-4 pb-4 pt-3.5 phone:mx-auto phone:w-full phone:max-w-[560px] phone:gap-2.5 phone:border-b-0 phone:pb-3 phone:pt-3 land:max-w-none land:gap-1.5 land:px-2 land:pb-[max(4px,env(safe-area-inset-bottom))] land:pt-2">
      <div className="flex items-baseline justify-between phone:hidden">
        <span className="text-[17px] font-bold tracking-[0.03em]">{pair}</span>
        <span className="text-xs text-ink-2">CFD</span>
      </div>

      <div className="grid gap-3 phone:flex phone:flex-col phone:gap-2.5 land:gap-1.5">
        {/* ── Duration ────────────────────────────────── */}
        <div className="grid gap-1.5">
          <span className="legend phone:hidden">Duration</span>
          <div
            role="group"
            aria-label="Duration"
            className="grid grid-cols-5 gap-1.5"
          >
            {DURATION_PRESETS.map((p) => (
              <button
                key={p.sec}
                type="button"
                aria-pressed={durationSec === p.sec}
                onClick={() => setDurationSec(p.sec)}
                className={`${CHIP} ${
                  durationSec === p.sec
                    ? "bg-brand-fill text-white"
                    : "bg-tile text-ink-2 hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={5}
            max={3600}
            step={1}
            value={durationSec}
            onChange={(e) => setDurationSec(Number(e.target.value))}
            aria-label="Duration slider"
            className="mt-1 h-1.5 w-full cursor-pointer accent-brand phone:hidden"
          />
          <div className="flex justify-between text-xs text-ink-3 phone:hidden">
            <span>5s</span>
            <span className="font-semibold text-ink-2">
              {formatDurationLabel(durationSec)}
            </span>
            <span>1h</span>
          </div>
        </div>

        {/* ── Stake ───────────────────────────────────── */}
        <div className="grid gap-1.5 phone:order-first">
          <label htmlFor="cfd-stake" className="legend phone:hidden">
            Investment
          </label>
          <button
            ref={tileRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={stakeOpen}
            aria-label={`Investment ${formatMinor(stakeMinor, currency)}. Change investment`}
            onClick={() => setStakeOpen(true)}
            className="hidden h-14 w-full items-center gap-3 rounded-[14px] bg-tile px-3.5 text-left transition-colors active:bg-tile-hi phone:flex land:h-12"
          >
            <span className="grid gap-0.5">
              <span className="text-[11px] leading-none text-ink-2">
                Investment
              </span>
              <span
                className={`text-[22px] font-extrabold leading-none tracking-[-0.02em] tabular-nums ${
                  stakeMinor < minStake ? "text-down" : "text-ink"
                }`}
              >
                {currencySymbol(currency)}
                {groupAmount(stakeInput === "" ? "0" : stakeInput)}
              </span>
            </span>
            <Icon
              name="chevron"
              className="ml-auto size-[18px] flex-none text-ink-3"
              strokeWidth={2}
            />
          </button>
          <div className="flex items-center gap-1.5 phone:hidden">
            <div className="grid h-12 flex-1 place-items-center rounded border border-white/40 bg-panel focus-within:border-brand">
              <span className="flex items-center justify-center gap-0.5 text-[22px] font-bold">
                {currencySymbol(currency)}
                <input
                  id="cfd-stake"
                  inputMode="decimal"
                  autoComplete="off"
                  value={stakeInput}
                  onChange={(e) =>
                    setStakeInput(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                  className="w-[5ch] bg-transparent font-bold outline-none"
                />
              </span>
            </div>
          </div>
        </div>

        {/* ── SL / TP toggle ─────────────────────────── */}
        <div className="grid gap-2 rounded border border-rule p-2.5 phone:gap-2 phone:p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-2">
              Stop Loss / Take Profit
            </span>
            <button
              type="button"
              onClick={() => {
                const next = !(slEnabled || tpEnabled);
                setSlEnabled(next);
                setTpEnabled(next);
              }}
              className={`h-6 w-10 rounded-full transition-colors ${
                slEnabled || tpEnabled ? "bg-brand-fill" : "bg-white/20"
              }`}
              aria-pressed={slEnabled || tpEnabled}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  slEnabled || tpEnabled ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {(slEnabled || tpEnabled) && (
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <label className="text-[11px] font-semibold text-down">
                  Stop Loss %
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={slPct}
                  onChange={(e) => setSlPct(e.target.value)}
                  className="h-9 rounded border border-rule bg-panel px-2 text-sm font-semibold tabular-nums text-ink outline-none focus:border-down"
                />
                {slPrice !== null && (
                  <span className="text-[10px] tabular-nums text-ink-3">
                    ~{slPrice.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="grid gap-1">
                <label className="text-[11px] font-semibold text-up">
                  Take Profit %
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={tpPct}
                  onChange={(e) => setTpPct(e.target.value)}
                  className="h-9 rounded border border-rule bg-panel px-2 text-sm font-semibold tabular-nums text-ink outline-none focus:border-up"
                />
                {tpPrice !== null && (
                  <span className="text-[10px] tabular-nums text-ink-3">
                    ~{tpPrice.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Preview ───────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-dashed border-rule pb-0.5 pt-2.5 text-xs text-ink-3 phone:hidden">
        <span>If +1% move</span>
        <span className="font-semibold text-up">+{pnlIfUp}</span>
        <span>If -1% move</span>
        <span className="font-semibold text-down">-{pnlIfUp}</span>
      </div>

      {error ? (
        <div
          role="alert"
          className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-[2px] bg-warn-bg px-2.5 py-2 text-xs text-down shadow-[inset_0_0_0_1px_rgba(229,65,59,.5)] phone:rounded-xl phone:px-3 phone:py-2.5"
        >
          <Icon name="alert" className="size-4" />
          {error}
        </div>
      ) : null}

      {/* ── BUY / SELL buttons ─────────────────────── */}
      <div className="grid gap-2 phone:grid-cols-2 phone:gap-2.5 land:grid-cols-1 land:gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void place("LONG")}
          onAnimationEnd={() => setFired(null)}
          className={`${slab} ${slabLive} bg-up text-up-ink ${fired === "LONG" ? "slab-fired" : ""}`}
        >
          <span className="phone:hidden">
            Buy
            <small className={slabNote}>Price goes up, you profit</small>
          </span>
          <span className="hidden min-w-0 gap-1 text-left phone:grid">
            <span className="tracking-[0.04em]">Buy</span>
            <span className="truncate text-[11px] font-semibold normal-case tracking-normal">
              Buy at market
            </span>
          </span>
          <Icon
            name="up"
            className="size-[26px] phone:size-[22px]"
            strokeWidth={2.6}
          />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void place("SHORT")}
          onAnimationEnd={() => setFired(null)}
          className={`${slab} ${slabLive} bg-down text-down-ink ${fired === "SHORT" ? "slab-fired" : ""}`}
        >
          <span className="phone:hidden">
            Sell
            <small className={slabNote}>Price goes down, you profit</small>
          </span>
          <span className="hidden min-w-0 gap-1 text-left phone:grid">
            <span className="tracking-[0.04em]">Sell</span>
            <span className="truncate text-[11px] font-semibold normal-case tracking-normal">
              Sell at market
            </span>
          </span>
          <Icon
            name="down"
            className="size-[26px] phone:size-[22px]"
            strokeWidth={2.6}
          />
        </button>
      </div>

      {stakeOpen ? (
        <StakeSheet
          currency={currency}
          initial={stakeInput}
          initialPercent=""
          unit="amount"
          balanceMinor={balanceMinor}
          minStakeMinor={minStake}
          payoutPct={null}
          accountLabel={accountLabel}
          onSet={(stake) => {
            setStakeInput(stake);
            setError(null);
            closeStake();
          }}
          onClose={closeStake}
        />
      ) : null}
    </div>
  );
}
