"use client";

import { useState, type FormEvent } from "react";

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

  return (
    <section className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-4">
      <h2 className="text-sm font-semibold">Demo account</h2>
      <p className="mt-1 text-[13px] text-ink-2">
        Current balance <span className="font-semibold text-ink">{currentLabel}</span>. Virtual funds only — set any
        amount up to {capLabel}.
      </p>

      <form onSubmit={onSet} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Amount in ${currency}`}
          aria-label={`Demo balance amount in ${currency}`}
          className="h-9 w-40 rounded border border-[var(--color-rule)] bg-[var(--color-ground)] px-3 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-9 rounded bg-brand px-3 text-[13px] font-bold text-brand-ink disabled:opacity-60"
        >
          Set balance
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(null)}
          className="h-9 rounded border border-[var(--color-rule)] px-3 text-[13px] font-semibold text-ink-2 hover:text-ink disabled:opacity-60"
        >
          Reset to {capLabel}
        </button>
      </form>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            disabled={busy}
            onClick={() => setAmount(String(p))}
            className="rounded border border-[var(--color-rule)] px-2 py-1 text-[11px] font-semibold text-ink-2 hover:text-ink disabled:opacity-60"
          >
            {p.toLocaleString()}
          </button>
        ))}
      </div>

      {error ? <p className="mt-2 text-[12px] text-down">{error}</p> : null}
    </section>
  );
}
