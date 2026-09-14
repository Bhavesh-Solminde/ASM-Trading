"use client";

import { useState } from "react";
import { DURATIONS_SEC } from "@asm/trading";
import type { OpenTradeResult } from "@asm/contracts";
import { formatMinor } from "@/lib/format-money";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

export function TradeTicket({
  symbol,
  accountId,
  currency,
  payoutPct,
  onOpened,
}: {
  symbol: string;
  accountId: string;
  currency: string;
  payoutPct: number | null;
  onOpened: (result: OpenTradeResult) => void;
}) {
  const [durationSec, setDurationSec] = useState<number>(60);
  const [stakeInput, setStakeInput] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stakeMajor = Number(stakeInput);
  const stakeMinor = Number.isFinite(stakeMajor) && stakeMajor > 0 ? Math.round(stakeMajor * 100) : 0;
  const profitMinor =
    payoutPct === null || stakeMinor === 0 ? null : Math.floor((stakeMinor * payoutPct) / 100);

  function nudge(delta: number): void {
    const current = Number.isFinite(stakeMajor) ? Math.floor(stakeMajor) : 1;
    setStakeInput(String(Math.max(1, current + delta)));
  }

  async function place(direction: "UP" | "DOWN"): Promise<void> {
    if (stakeMinor === 0) {
      setError("Enter an investment amount.");
      return;
    }
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

  const label = "text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]";
  const field =
    "rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm tabular-nums outline-none focus:border-[var(--color-brand)]";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
      <div>
        <label htmlFor="duration" className={label}>
          Time
        </label>
        <select
          id="duration"
          value={durationSec}
          onChange={(e) => setDurationSec(Number(e.target.value))}
          className={`mt-1 w-full ${field}`}
        >
          {DURATIONS_SEC.map((d) => (
            <option key={d} value={d}>
              {formatDuration(d)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="stake" className={label}>
          Investment
        </label>
        <div className="mt-1 flex items-center gap-2">
          <button type="button" onClick={() => nudge(-1)} className="h-9 w-9 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] text-sm">
            −
          </button>
          <input
            id="stake"
            type="number"
            min={1}
            step={1}
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            className={`min-w-0 flex-1 ${field}`}
          />
          <button type="button" onClick={() => nudge(1)} className="h-9 w-9 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] text-sm">
            +
          </button>
        </div>
      </div>

      <div className="flex items-baseline justify-between border-t border-dashed border-[var(--color-edge)] pt-3 text-sm">
        <span className="text-[var(--color-ink-2)]">Payout</span>
        <span className="font-semibold tabular-nums text-[var(--color-up)]">
          {profitMinor === null ? "—" : formatMinor(profitMinor, currency)}
        </span>
      </div>

      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void place("UP")}
          className="rounded-lg bg-[var(--color-up)] px-4 py-3 text-sm font-bold text-[#06231a] disabled:opacity-50"
        >
          Up ↑
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void place("DOWN")}
          className="rounded-lg bg-[var(--color-down)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          Down ↓
        </button>
      </div>
    </div>
  );
}
