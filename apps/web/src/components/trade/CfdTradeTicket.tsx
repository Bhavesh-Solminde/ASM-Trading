"use client";

import { useState } from "react";
import { cfdSpreadFeeMinor, cfdSpreadFeePct, CFD_LEVERAGE, type CfdOpenTradeResult } from "@asm/contracts";
import { DURATIONS_SEC } from "@asm/trading";
import { Icon } from "@/components/shell/Icon";
import { usePlatform } from "@/components/shell/PlatformProvider";
import type { CfdMarketStatus } from "@/lib/use-cfd-market-status";
import { minStakeMinor } from "@/lib/currency";
import { currencySymbol, formatMinor } from "@/lib/format-money";
import { hms } from "@/lib/format-time";
import { defaultStake, nextStakeInput, MAX_STAKE_MAJOR } from "./stake";

type CfdDirection = "LONG" | "SHORT";

/** The desktop stepper's durations: the platform's offered ones up to the CFD maximum of 1h. */
const STEP_DURATIONS = DURATIONS_SEC.filter((sec) => sec <= 3600);

const STEP =
  "grid h-12 place-items-center rounded border border-white/40 text-ink-2 hover:border-white/70 hover:bg-panel hover:text-ink";
const DISPLAY = "grid h-12 place-items-center rounded border border-white/40 bg-panel";

export function CfdTradeTicket({
  symbol,
  pair,
  accountId,
  currency,
  onOpened,
  marketStatus,
}: {
  marketStatus: CfdMarketStatus;
  symbol: string;
  pair: string;
  accountId: string;
  currency: string;
  onOpened: (result: CfdOpenTradeResult) => void;
}) {
  const [durationSec, setDurationSec] = useState(300);
  const [stakeInput, setStakeInput] = useState(() => defaultStake(currency));
  const { assets } = usePlatform();
  const canTrade = marketStatus === "open";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fired, setFired] = useState<CfdDirection | null>(null);
  const minStake = minStakeMinor(currency);

  function stepDuration(delta: number): void {
    const at = STEP_DURATIONS.findIndex((sec) => sec >= durationSec);
    const idx = at === -1 ? STEP_DURATIONS.length - 1 : at;
    const next = Math.min(STEP_DURATIONS.length - 1, Math.max(0, idx + delta));
    setDurationSec(STEP_DURATIONS[next]!);
  }

  const stakeMajor = Number(stakeInput);
  const stakeMinor =
    Number.isFinite(stakeMajor) && stakeMajor > 0
      ? Math.round(stakeMajor * 100)
      : 0;
  const spreadBps = assets.find((a) => a.symbol === symbol)?.spreadBps ?? 0;
  const spreadFee = cfdSpreadFeeMinor(stakeMinor, spreadBps);
  function nudgeStake(delta: number): void {
    const step = minStake / 100;
    setStakeInput(String(Math.min(MAX_STAKE_MAJOR, Math.max(step, (Number(stakeInput) || 0) + delta * step))));
  }

  async function place(direction: CfdDirection): Promise<void> {
    if (!canTrade) return;
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
    "relative grid h-[58px] grid-cols-[1fr_auto] items-center overflow-hidden rounded pl-[18px] pr-4 text-left text-[17px] font-black uppercase tracking-[0.08em] transition-[filter,transform] phone:h-14 phone:rounded-2xl phone:pl-3.5 phone:pr-3.5 phone:text-lg phone:font-extrabold phone:leading-none land:h-12";
  const slabLive =
    "hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";
  const slabNote =
    "mt-0.5 block text-[10px] font-bold normal-case tracking-[0.1em] opacity-75 max-[359px]:hidden";
  const pnlIfUp =
    stakeMinor > 0 ? formatMinor(Math.floor(stakeMinor * 0.01 * CFD_LEVERAGE), currency) : "—";

  return (
    <div className="trade-ticket relative grid gap-3 border-b border-rule px-4 pb-4 pt-3.5 phone:mx-auto phone:w-full phone:max-w-[560px] phone:gap-2 phone:border-b-0 phone:pb-2 phone:pt-2 land:max-w-none land:gap-1.5 land:px-2 land:pb-[max(4px,env(safe-area-inset-bottom))] land:pt-2">
      <div className="flex items-baseline justify-between phone:hidden">
        <span className="text-[17px] font-bold tracking-[0.03em]">{pair}</span>
        <span className="text-xs text-ink-2">CFD</span>
      </div>

      <div className="ticket-controls grid gap-3">
        {/* ── Duration ────────────────────────────────── */}
        <div className="grid gap-1.5">
          <span className="legend ticket-label" id="cfd-duration">Timer</span>
          <div className="ticket-stepper grid grid-cols-[36px_1fr_36px] items-center gap-1.5">
            <button type="button" aria-label="Shorter" onClick={() => stepDuration(-1)} className={STEP}>
              <Icon name="minus" className="size-[18px]" />
            </button>
            <div aria-labelledby="cfd-duration" className={DISPLAY}>
              <span className="led led-lit text-[22px]">{hms(durationSec)}</span>
            </div>
            <button type="button" aria-label="Longer" onClick={() => stepDuration(1)} className={STEP}>
              <Icon name="plus" className="size-[18px]" />
            </button>
          </div>

        </div>

        {/* ── Stake ───────────────────────────────────── */}
        <div className="grid gap-1.5">
          <label htmlFor="cfd-stake" className="legend ticket-label">
            Investment
          </label>

          <div className="ticket-stepper grid grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-1.5">
            <button type="button" aria-label="Decrease investment" onClick={() => nudgeStake(-1)} className={STEP}>
              <Icon name="minus" className="size-[18px]" />
            </button>
            <div className="ticket-field grid h-12 min-w-0 place-items-center rounded border border-white/40 bg-panel focus-within:border-brand">
              <span className="flex items-center justify-center gap-0.5 text-[22px] font-bold">
                {currencySymbol(currency)}
                <input
                  id="cfd-stake"
                  inputMode="decimal"
                  autoComplete="off"
                  value={stakeInput}
                  onChange={(e) => setStakeInput(nextStakeInput(e.target.value, stakeInput))}
                  // Inline outline beats the unlayered global :focus-visible ring; the box's border shows focus.
                  style={{ width: `${Math.max(1, Math.min(8, stakeInput.length))}ch`, maxWidth: "100%", outline: "none" }}
                  className="bg-transparent font-bold"
                />
              </span>
            </div>
            <button type="button" aria-label="Increase investment" onClick={() => nudgeStake(1)} className={STEP}>
              <Icon name="plus" className="size-[18px]" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Preview ───────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-dashed border-rule pb-0.5 pt-2.5 text-xs text-ink-3 phone:hidden">
        <span>100× · If +1% move</span>
        <span className="whitespace-nowrap text-right font-semibold tabular-nums text-up">+{pnlIfUp}</span>
        <span>If -1% move</span>
        <span className="whitespace-nowrap text-right font-semibold tabular-nums text-down">-{pnlIfUp}</span>
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

      <div className="ticket-fees flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-ink-2 tabular-nums">
        Spread fee ({cfdSpreadFeePct(spreadBps)}%): {formatMinor(spreadFee, currency)}
        <span>Total deducted: {formatMinor(stakeMinor + spreadFee, currency)}</span>
      </div>
      {!canTrade && <p role="status" className="ticket-status rounded-lg border border-rule bg-tile/50 px-2.5 py-2 text-xs leading-snug text-ink-2">{marketStatus === "closed" ? "Market closed. Trading resumes when live prices return." : "Waiting for live prices. Trading is temporarily unavailable."}</p>}
      {/* ── BUY / SELL buttons ─────────────────────── */}
      <div className="ticket-actions grid gap-2 phone:grid-cols-2 phone:gap-2.5 land:grid-cols-1 land:gap-1.5">
        <button
          type="button"
          disabled={busy || !canTrade}
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
          disabled={busy || !canTrade}
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


    </div>
  );
}
