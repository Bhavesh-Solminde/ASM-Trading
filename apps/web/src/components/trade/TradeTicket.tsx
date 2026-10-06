"use client";

import { useEffect, useState } from "react";
import { DURATIONS_SEC } from "@asm/trading";
import type { OpenTradeResult } from "@asm/contracts";
import { Icon } from "@/components/shell/Icon";
import { durationForTargetTime, offeredExpirySlots } from "@/lib/expiry-times";
import { minStakeMinor } from "@/lib/currency";
import { currencySymbol, formatMinor } from "@/lib/format-money";
import { clockTime, hms } from "@/lib/format-time";
import { useMarketClosed, useNowSec } from "@/lib/use-now";

/** Quick-pick stakes (major units), all at or above the currency's minimum. */
function stakePresets(currency: string): readonly number[] {
  return currency === "INR" ? [100, 250, 500, 1000, 2500] : [1, 5, 10, 25, 100];
}

/** Opening stake for a fresh ticket: the INR minimum, or $10. */
function defaultStake(currency: string): string {
  return currency === "INR" ? "100" : "10";
}

type TimeMode = "timer" | "time";

/** The next wall-clock occurrence of an HH:MM, today or (if already past) tomorrow. */
function nextOccurrenceMs(hhmm: string, nowMs: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(nowMs);
  d.setHours(h, min, 0, 0);
  let t = d.getTime();
  if (t <= nowMs) t += 24 * 60 * 60 * 1000;
  return t;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

const STEP =
  "grid h-12 place-items-center rounded border border-rule text-ink-2 hover:border-tile-hi hover:bg-panel hover:text-ink phone:h-[26px]";
const DISPLAY = "grid h-12 place-items-center rounded border border-rule bg-panel phone:h-[26px]";
/** Stepper glyphs: default size on desktop, 30% smaller in the phone ticket. */
const STEP_ICON = "size-[18px] phone:size-3";

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
  payoutPct,
  onOpened,
}: {
  symbol: string;
  pair: string;
  accountId: string;
  currency: string;
  payoutPct: number | null;
  onOpened: (result: OpenTradeResult) => void;
}) {
  const [durationSec, setDurationSec] = useState<number>(30);
  const [mode, setMode] = useState<TimeMode>("timer");
  // Absolute expiry chosen in TIME mode; snapped to a valid duration at submit.
  const [targetMs, setTargetMs] = useState<number | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [stakeInput, setStakeInput] = useState(() => defaultStake(currency));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fired, setFired] = useState<"UP" | "DOWN" | null>(null);
  const closed = useMarketClosed(symbol);
  const minStake = minStakeMinor(currency);

  // Switching to an account in another currency resets the stake to that
  // currency's default, so an INR ticket never opens below the ₹100 minimum.
  useEffect(() => {
    setStakeInput(defaultStake(currency));
    setError(null);
  }, [currency]);

  const stakeMajor = Number(stakeInput);
  const stakeMinor = Number.isFinite(stakeMajor) && stakeMajor > 0 ? Math.round(stakeMajor * 100) : 0;
  const profitMinor =
    payoutPct === null || stakeMinor === 0 ? null : Math.floor((stakeMinor * payoutPct) / 100);
  const durationIndex = DURATIONS_SEC.indexOf(durationSec as (typeof DURATIONS_SEC)[number]);

  function stepDuration(delta: number): void {
    const next = Math.min(DURATIONS_SEC.length - 1, Math.max(0, durationIndex + delta));
    setDurationSec(DURATIONS_SEC[next]!);
  }

  function switchMode(next: TimeMode): void {
    if (next === "time" && targetMs === null) setTargetMs(Date.now() + durationSec * 1000);
    setMode(next);
    setGridOpen(false);
  }

  /** In TIME mode, +/- move to the neighbouring offered expiry time. */
  function stepTime(delta: number): void {
    const now = Date.now();
    const base = targetMs ?? now + durationSec * 1000;
    const idx = DURATIONS_SEC.indexOf(durationForTargetTime(now, base) as (typeof DURATIONS_SEC)[number]);
    const next = Math.min(DURATIONS_SEC.length - 1, Math.max(0, idx + delta));
    setTargetMs(now + DURATIONS_SEC[next]! * 1000);
  }

  // The expiry actually submitted: the offered duration nearest the chosen
  // time in TIME mode (the engine only accepts the discrete durations), or the
  // stepper value in TIMER mode.
  const effectiveDurationSec =
    mode === "time" && targetMs !== null ? durationForTargetTime(Date.now(), targetMs) : durationSec;

  function nudge(delta: number): void {
    const step = currency === "INR" ? 10 : 1;
    const minMajor = minStake / 100;
    const current = Number.isFinite(stakeMajor) ? Math.floor(stakeMajor) : minMajor;
    setStakeInput(String(Math.max(minMajor, current + delta * step)));
  }

  async function place(direction: "UP" | "DOWN"): Promise<void> {
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
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, direction, stake: stakeMinor, durationSec: effectiveDurationSec, accountId }),
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
    "relative grid h-[58px] grid-cols-[1fr_auto] items-center overflow-hidden rounded pl-[18px] pr-4 text-left text-[17px] font-black uppercase tracking-[0.08em] transition-[filter,transform] phone:h-[31px] phone:pl-2.5 phone:pr-2 phone:text-[11px] phone:leading-none";
  const slabLive = "hover:brightness-110 active:translate-y-px disabled:cursor-wait";
  const slabClosed = "cursor-not-allowed bg-tile text-ink-3";
  const slabNote =
    "mt-0.5 block text-[10px] font-bold normal-case tracking-[0.1em] opacity-75 phone:text-[8px] max-[359px]:hidden";

  return (
    <div className="relative grid gap-3 border-b border-rule px-4 pb-4 pt-3.5 phone:gap-0.5 phone:border-b-0 phone:px-2 phone:pb-1 phone:pt-1 land:pb-[max(4px,env(safe-area-inset-bottom))]">
      <div className="flex items-baseline justify-between phone:hidden">
        <span className="text-[17px] font-bold tracking-[0.03em]">{pair}</span>
        <span className="text-[17px] font-extrabold text-brand">{payoutPct === null ? "—" : `${payoutPct}%`}</span>
      </div>

      <div className="grid gap-3 phone:grid-cols-2 phone:gap-x-2 phone:gap-y-1">
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <span className="legend phone:text-[9px]!" id="ticket-time">
              Time
            </span>
            <div role="tablist" aria-label="Expiry mode" className="flex gap-0.5 rounded-[3px] border border-rule p-0.5">
              {(["timer", "time"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => switchMode(m)}
                  className={`rounded-[2px] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] phone:px-1.5 phone:py-0 phone:text-[8px] ${
                    mode === m ? "bg-up text-up-ink" : "text-ink-3 hover:text-ink"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[36px_1fr_36px] items-center gap-1.5 phone:grid-cols-[28px_minmax(0,1fr)_28px] phone:gap-1">
            <button
              type="button"
              aria-label={mode === "time" ? "Earlier" : "Shorter"}
              onClick={() => (mode === "time" ? stepTime(-1) : stepDuration(-1))}
              className={STEP}
            >
              <Icon name="minus" className={STEP_ICON} />
            </button>
            <button
              type="button"
              aria-labelledby="ticket-time"
              aria-expanded={gridOpen}
              aria-controls="ticket-durations"
              onClick={() => setGridOpen((o) => !o)}
              className={`${DISPLAY} hover:border-tile-hi`}
            >
              {mode === "time" ? (
                <span className="led led-lit text-[22px] phone:text-[13px]">
                  {targetMs === null ? "--:--" : clockTime(Math.floor(targetMs / 1000))}
                </span>
              ) : (
                <>
                  <span className="led led-lit text-[22px] phone:hidden">{hms(durationSec)}</span>
                  <span className="led led-lit hidden text-[13px] phone:inline">{formatDuration(durationSec)}</span>
                </>
              )}
            </button>
            <button
              type="button"
              aria-label={mode === "time" ? "Later" : "Longer"}
              onClick={() => (mode === "time" ? stepTime(1) : stepDuration(1))}
              className={STEP}
            >
              <Icon name="plus" className={STEP_ICON} />
            </button>
          </div>
          {gridOpen ? (
            <div
              id="ticket-durations"
              className="grid grid-cols-4 gap-1 phone:absolute phone:inset-x-3 phone:z-20 phone:mt-1 phone:gap-1.5 phone:rounded phone:border phone:border-rule phone:bg-[#2c3036] phone:p-2 phone:shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)]"
            >
              {mode === "time"
                ? offeredExpirySlots(Date.now()).map((slot) => {
                    const active =
                      targetMs !== null && durationForTargetTime(Date.now(), targetMs) === slot.durationSec;
                    return (
                      <button
                        key={slot.durationSec}
                        type="button"
                        onClick={() => {
                          setTargetMs(slot.epochMs);
                          setGridOpen(false);
                        }}
                        className={`h-[30px] rounded-[2px] text-xs font-semibold phone:h-10 phone:text-sm ${
                          active ? "bg-up text-up-ink" : "bg-tile text-ink-2 hover:bg-tile-hi hover:text-ink"
                        }`}
                      >
                        {clockTime(Math.floor(slot.epochMs / 1000))}
                      </button>
                    );
                  })
                : DURATIONS_SEC.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setDurationSec(d);
                        setGridOpen(false);
                      }}
                      className={`h-[30px] rounded-[2px] text-xs font-semibold phone:h-10 phone:text-sm ${
                        d === durationSec ? "bg-up text-up-ink" : "bg-tile text-ink-2 hover:bg-tile-hi hover:text-ink"
                      }`}
                    >
                      {formatDuration(d)}
                    </button>
                  ))}
              {mode === "time" ? (
                <label className="col-span-4 mt-0.5 flex items-center justify-between gap-2 rounded-[2px] bg-tile px-2 py-1.5 text-xs text-ink-2">
                  <span className="font-semibold">Set manually</span>
                  <input
                    type="time"
                    aria-label="Set expiry time manually"
                    onChange={(e) => {
                      const t = nextOccurrenceMs(e.target.value, Date.now());
                      if (t !== null) {
                        setTargetMs(t);
                        setGridOpen(false);
                      }
                    }}
                    className="bg-transparent text-ink outline-none [color-scheme:dark]"
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-between text-xs text-ink-3 phone:hidden">
            <span>Expires at</span>
            {mode === "time" ? (
              <b className="font-semibold text-ink-2">
                {targetMs === null ? "" : clockTime(Math.floor(targetMs / 1000))}
              </b>
            ) : (
              <ExpiresAt durationSec={durationSec} />
            )}
          </div>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="stake" className="legend phone:text-[9px]!">
            Investment
          </label>
          <div className="grid grid-cols-[36px_1fr_36px] items-center gap-1.5 phone:grid-cols-[28px_minmax(0,1fr)_28px] phone:gap-1">
            <button type="button" aria-label="Decrease investment" onClick={() => nudge(-1)} className={STEP}>
              <Icon name="minus" className={STEP_ICON} />
            </button>
            <div className={`${DISPLAY} focus-within:border-brand`}>
              <span className="flex items-center justify-center gap-0.5 text-[22px] font-bold phone:text-[13px]">
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
              <Icon name="plus" className={STEP_ICON} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1 phone:hidden">
        {stakePresets(currency).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStakeInput(String(value))}
            className={`h-7 rounded-[2px] border bg-panel text-xs font-semibold phone:h-10 phone:text-sm ${
              stakeMajor === value ? "border-up text-up" : "border-rule text-ink-2 hover:text-ink"
            }`}
          >
            {currencySymbol(currency)}
            {value}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 border-t border-dashed border-rule pb-0.5 pt-2.5 phone:hidden">
        <span className="legend self-center">If correct</span>
        <span className="led led-lit text-[20px] text-up">
          {profitMinor === null ? "—" : `+${formatMinor(profitMinor, currency)}`}
        </span>
        <span className="text-xs text-ink-3">You get back</span>
        <span className="text-right text-xs text-ink-3">
          {profitMinor === null ? "—" : formatMinor(stakeMinor + profitMinor, currency)}
        </span>
      </div>

      <div className="hidden phone:flex phone:items-center phone:justify-between phone:gap-2 phone:border-t phone:border-dashed phone:border-rule phone:pt-0.5">
        <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-ink-3">Payout</span>
        <span className="led led-lit text-[11px] text-up">
          {profitMinor === null ? "—" : `+${formatMinor(profitMinor, currency)}`}
        </span>
      </div>

      {closed ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[2px] border border-rule bg-panel px-2.5 py-2 text-xs font-semibold text-ink-2 phone:gap-1.5 phone:px-2 phone:py-1 phone:text-[10px]"
        >
          <Icon name="alert" className="size-4 flex-none phone:size-3" />
          <span>{pair} is closed for the night. Trading resumes at 5:00 AM IST.</span>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-[2px] bg-warn-bg px-2.5 py-2 text-xs text-[#ffb3a8] shadow-[inset_0_0_0_1px_rgba(229,65,59,.5)] phone:gap-1.5 phone:px-2 phone:py-1 phone:text-[10px]"
        >
          <Icon name="alert" className="size-4 phone:size-3" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-2 phone:grid-cols-2 phone:gap-1.5 phone:pt-0 land:grid-cols-1 land:gap-1.5">
        <button
          type="button"
          disabled={busy || closed}
          onClick={() => void place("UP")}
          onAnimationEnd={() => setFired(null)}
          className={`${slab} ${closed ? slabClosed : `${slabLive} bg-up text-up-ink`} ${fired === "UP" ? "slab-fired" : ""}`}
        >
          <span>
            Buy<small className={slabNote}>{closed ? "Market closed" : "Price ends higher"}</small>
          </span>
          <Icon name="up" className="size-[26px] phone:size-[18px]" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          disabled={busy || closed}
          onClick={() => void place("DOWN")}
          onAnimationEnd={() => setFired(null)}
          className={`${slab} ${closed ? slabClosed : `${slabLive} bg-down text-down-ink`} ${fired === "DOWN" ? "slab-fired" : ""}`}
        >
          <span>
            Sell<small className={slabNote}>{closed ? "Market closed" : "Price ends lower"}</small>
          </span>
          <Icon name="down" className="size-[26px] phone:size-[18px]" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
