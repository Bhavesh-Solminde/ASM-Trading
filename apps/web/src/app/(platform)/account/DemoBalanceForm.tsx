"use client";

import { useState, type FormEvent } from "react";
import { currencySymbol } from "@asm/client-core";

/**
 * Lets the user set their DEMO balance to any amount up to the currency's cap,
 * or reset it to the full default. Amounts are entered in major units and sent
 * to the API in minor units; the cap and ownership are re-checked server-side.
 */
export function DemoBalanceForm({
  accountId,
  currency,
  currentLabel,
  capMinor,
  capLabel,
}: {
  accountId: string;
  currency: string;
  currentLabel: string;
  capMinor: number;
  capLabel: string;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capMajor = capMinor / 100;
  const presets = [0.01, 0.05, 0.1, 0.5, 1].map((f) => Math.round(capMajor * f));

  async function submit(amountMinor: number | null): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/demo-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, amountMinor }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not update the demo balance.");
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  function onSet(e: FormEvent): void {
    e.preventDefault();
    const major = Number(amount);
    if (!Number.isFinite(major) || major <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    const minor = Math.round(major * 100);
    if (minor > capMinor) {
      setError(`The demo balance can't exceed ${capLabel}.`);
      return;
    }
    void submit(minor);
  }

  const symbol = currencySymbol(currency);

  return (
    <section className="rounded-xl border border-rule bg-panel">
      <h2 className="border-b border-rule px-4 py-3 text-[15px] font-semibold">Demo account</h2>
      <div className="p-4">
        <p className="text-[13px] leading-relaxed text-ink-2">
          Current balance <span className="font-semibold text-ink">{currentLabel}</span>. Virtual funds only — set any
          amount up to {capLabel}.
        </p>

        <form onSubmit={onSet} className="mt-3 flex flex-wrap items-center gap-2 phone:grid phone:grid-cols-2">
          <div className="relative w-44 phone:col-span-2 phone:w-auto">
            {symbol ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-ink-3"
              >
                {symbol}
              </span>
            ) : null}
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Amount in ${currency}`}
              aria-label={`Demo balance amount in ${currency}`}
              className={`h-9 w-full min-w-0 rounded-lg border border-rule bg-ground pr-3 text-sm tabular-nums outline-none focus:border-brand phone:h-11 phone:text-base ${
                symbol ? "pl-7" : "pl-3"
              }`}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="h-9 rounded-lg bg-brand-fill px-3 text-[13px] font-bold text-white hover:bg-brand-fill-hi disabled:opacity-60 phone:h-11"
          >
            {busy ? "Updating…" : "Set balance"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(null)}
            aria-label={`Reset to ${capLabel}`}
            className="h-9 rounded-lg border border-rule px-3 text-[13px] font-semibold text-ink-2 hover:text-ink disabled:opacity-60 phone:h-11 phone:border-transparent phone:bg-tile"
          >
            Reset<span className="phone:hidden"> to {capLabel}</span>
          </button>
        </form>

        <div className="mt-2.5 flex flex-wrap gap-1.5 phone:mt-3 phone:grid phone:grid-cols-3 phone:gap-2">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy}
              onClick={() => setAmount(String(p))}
              className="rounded-lg border border-rule px-2 py-1 text-[11px] font-semibold tabular-nums text-ink-2 hover:text-ink disabled:opacity-60 phone:h-11 phone:text-[13px]"
            >
              {symbol}
              {p.toLocaleString("en-US")}
            </button>
          ))}
        </div>

        {error ? <p role="alert" className="mt-2 text-[12px] text-down">{error}</p> : null}
      </div>
    </section>
  );
}
