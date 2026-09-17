"use client";

import { useState } from "react";
import { DURATIONS_SEC } from "@asm/trading";
import type { OpenTradeResult } from "@asm/contracts";
import { Icon } from "@/components/shell/Icon";
import { currencySymbol, formatMinor } from "@/lib/format-money";
import { clockTime, hms } from "@/lib/format-time";
import { useNowSec } from "@/lib/use-now";

const STAKE_PRESETS = [5, 10, 25, 50, 100] as const;

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

const STEP =
  "grid h-12 place-items-center rounded border border-rule text-ink-2 hover:border-tile-hi hover:bg-panel hover:text-ink";
const DISPLAY = "grid h-12 place-items-center rounded border border-rule bg-panel";

/** Ticks every second on its own, so the rest of the ticket does not re-render. */
function ExpiresAt({ durationSec }: { durationSec: number }) {
  const now = useNowSec();
  return <b className="font-semibold text-ink-2">{now === null ? "" : clockTime(now + durationSec)}</b>;
}

export function TradeTicket({
  symbol,
  pair,
  accountId,
  currency,
  live,
  payoutPct,
  onOpened,
}: {
  symbol: string;
  pair: string;
  accountId: string;
  currency: string;
  live: boolean;
  payoutPct: number | null;
  onOpened: (result: OpenTradeResult) => void;
}) {
  const [durationSec, setDurationSec] = useState<number>(30);
  const [gridOpen, setGridOpen] = useState(false);
  const [stakeInput, setStakeInput] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fired, setFired] = useState<"UP" | "DOWN" | null>(null);

  const stakeMajor = Number(stakeInput);
  const stakeMinor = Number.isFinite(stakeMajor) && stakeMajor > 0 ? Math.round(stakeMajor * 100) : 0;
  const profitMinor =
    payoutPct === null || stakeMinor === 0 ? null : Math.floor((stakeMinor * payoutPct) / 100);
  const durationIndex = DURATIONS_SEC.indexOf(durationSec as (typeof DURATIONS_SEC)[number]);

  function stepDuration(delta: number): void {
    const next = Math.min(DURATIONS_SEC.length - 1, Math.max(0, durationIndex + delta));
    setDurationSec(DURATIONS_SEC[next]!);
  }

  function nudge(delta: number): void {
    const current = Number.isFinite(stakeMajor) ? Math.floor(stakeMajor) : 1;
    setStakeInput(String(Math.max(1, current + delta)));
  }

  async function place(direction: "UP" | "DOWN"): Promise<void> {
    if (stakeMinor === 0) {
      setError("Enter an investment amount.");
      return;
    }
    setFired(direction);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, direction, stake: stakeMinor, durationSec, accountId }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<OpenTradeResult> & { error?: string };
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
    "relative grid h-[58px] grid-cols-[1fr_auto] items-center overflow-hidden rounded pl-[18px] pr-4 text-left text-[17px] font-black uppercase tracking-[0.08em] transition-[filter,transform] hover:brightness-110 active:translate-y-px disabled:cursor-wait";
  const slabNote = "mt-0.5 block text-[10px] font-bold normal-case tracking-[0.1em] opacity-75";

  return (
    <div className="grid gap-3 border-b border-rule px-4 pb-4 pt-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[17px] font-bold tracking-[0.03em]">{pair}</span>
        <span className="text-[17px] font-extrabold text-brand">{payoutPct === null ? "—" : `${payoutPct}%`}</span>
      </div>

      <div className="grid gap-1.5">
        <span className="legend" id="ticket-time">
          Time
        </span>
        <div className="grid grid-cols-[36px_1fr_36px] items-center gap-1.5">
          <button type="button" aria-label="Shorter" onClick={() => stepDuration(-1)} className={STEP}>
            <Icon name="minus" />
          </button>
          <button
            type="button"
            aria-labelledby="ticket-time"
            aria-expanded={gridOpen}
            aria-controls="ticket-durations"
            onClick={() => setGridOpen((o) => !o)}
            className={`${DISPLAY} hover:border-tile-hi`}
          >
            <span className="led led-lit text-[22px]">{hms(durationSec)}</span>
          </button>
          <button type="button" aria-label="Longer" onClick={() => stepDuration(1)} className={STEP}>
            <Icon name="plus" />
          </button>
        </div>
        {gridOpen ? (
          <div id="ticket-durations" className="grid grid-cols-4 gap-1">
            {DURATIONS_SEC.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDurationSec(d);
                  setGridOpen(false);
                }}
                className={`h-[30px] rounded-[2px] text-xs font-semibold ${
                  d === durationSec ? "bg-brand text-brand-ink" : "bg-tile text-ink-2 hover:bg-tile-hi hover:text-ink"
                }`}
              >
                {formatDuration(d)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex justify-between text-xs text-ink-3">
          <span>Expires at</span>
          <ExpiresAt durationSec={durationSec} />
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="stake" className="legend">
          Investment
        </label>
        <div className="grid grid-cols-[36px_1fr_36px] items-center gap-1.5">
          <button type="button" aria-label="Decrease investment" onClick={() => nudge(-1)} className={STEP}>
            <Icon name="minus" />
          </button>
          <div className={`${DISPLAY} focus-within:border-brand`}>
            <span className="flex items-center justify-center gap-0.5 text-[22px] font-bold">
              {currencySymbol(currency)}
              <input
                id="stake"
                inputMode="decimal"
                autoComplete="off"
                value={stakeInput}
                onChange={(e) => setStakeInput(e.target.value.replace(/[^0-9.]/g, ""))}
                className="w-[5ch] bg-transparent font-bold outline-none"
              />
            </span>
          </div>
          <button type="button" aria-label="Increase investment" onClick={() => nudge(1)} className={STEP}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {STAKE_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStakeInput(String(value))}
              className={`h-7 rounded-[2px] border bg-panel text-xs font-semibold ${
                stakeMajor === value ? "border-brand text-brand" : "border-rule text-ink-2 hover:text-ink"
              }`}
            >
              {currencySymbol(currency)}
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 border-t border-dashed border-rule pb-0.5 pt-2.5">
        <span className="legend self-center">If correct</span>
        <span className="led led-lit text-[20px] text-up">
          {profitMinor === null ? "—" : `+${formatMinor(profitMinor, currency)}`}
        </span>
        <span className="text-xs text-ink-3">You get back</span>
        <span className="text-right text-xs text-ink-3">
          {profitMinor === null ? "—" : formatMinor(stakeMinor + profitMinor, currency)}
        </span>
      </div>

      {live ? (
        <div className="flex items-center gap-2 rounded-[2px] bg-brand/10 px-2.5 py-2 text-xs font-semibold text-brand">
          <Icon name="alert" />
          Live account — this uses real balance
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-[2px] bg-warn-bg px-2.5 py-2 text-xs text-[#ffb3a8] shadow-[inset_0_0_0_1px_rgba(229,65,59,.5)]"
        >
          <Icon name="alert" className="size-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void place("UP")}
          onAnimationEnd={() => setFired(null)}
          className={`${slab} bg-up text-up-ink ${fired === "UP" ? "slab-fired" : ""}`}
        >
          <span>
            Up<small className={slabNote}>Price ends higher</small>
          </span>
          <Icon name="up" className="size-[26px]" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void place("DOWN")}
          onAnimationEnd={() => setFired(null)}
          className={`${slab} bg-down text-down-ink ${fired === "DOWN" ? "slab-fired" : ""}`}
        >
          <span>
            Down<small className={slabNote}>Price ends lower</small>
          </span>
          <Icon name="down" className="size-[26px]" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
