"use client";

import { useState } from "react";

const QUICK = [150, 200, 300, 500];

export function AmountStep({ method, onBack }: { method: string; onBack: () => void }) {
  const [amountMajor, setAmountMajor] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proceed() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, amountUsd: Math.round(amountMajor * 100) }),
    });

    if (res.ok) {
      const data = (await res.json()) as { checkoutToken: string };
      window.location.href = `/checkout/${data.checkoutToken}`;
      return;
    }

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not start that deposit.");
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
      >
        &lsaquo; Change method
      </button>

      <div className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-4">
        <p className="text-sm font-semibold">{method}</p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--color-ink-2)]">
          <div>
            <dt>Min</dt>
            <dd className="tabular-nums text-[var(--color-ink)]">$10.00</dd>
          </div>
          <div>
            <dt>Max</dt>
            <dd className="tabular-nums text-[var(--color-ink)]">$961.00</dd>
          </div>
          <div>
            <dt>Processing</dt>
            <dd className="text-[var(--color-ink)]">48 hours</dd>
          </div>
        </dl>
      </div>

      <div>
        <label
          htmlFor="amount"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Deposit amount
        </label>
        <input
          id="amount"
          type="number"
          min={10}
          max={961}
          value={amountMajor}
          onChange={(e) => setAmountMajor(Number(e.target.value))}
          className="mt-1 w-full rounded border border-[var(--color-rule)] bg-[var(--color-tile)] px-4 py-2.5 text-sm tabular-nums outline-none focus:border-[var(--color-brand)]"
        />
        <div className="mt-2 flex gap-2">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmountMajor(q)}
              className="flex-1 rounded border border-[var(--color-rule)] bg-[var(--color-panel)] px-2 py-1.5 text-xs font-semibold phone:py-2.5 phone:text-sm"
            >
              ${q}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/10 p-3 text-xs leading-relaxed text-[var(--color-brand)]">
        Payments with this method can take up to 48 hours to process. The status
        may appear as &ldquo;Failed&rdquo; until the funds are received on our side.
      </div>

      <div className="flex items-baseline justify-between border-t border-dashed border-[var(--color-rule)] pt-3 text-sm">
        <span className="text-[var(--color-ink-2)]">You will receive</span>
        <span className="font-semibold tabular-nums">${amountMajor.toFixed(2)}</span>
      </div>

      <div className="flex items-baseline justify-between text-xs text-[var(--color-ink-2)]">
        <span>Bonus (100%)</span>
        <span className="tabular-nums text-[var(--color-up)]">
          +${amountMajor.toFixed(2)}
        </span>
      </div>

      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void proceed()}
        className="rounded bg-[var(--color-brand)] px-4 py-3 text-sm font-bold text-[var(--color-brand-ink)] disabled:opacity-50"
      >
        {busy ? "Starting…" : "Proceed to Pay"}
      </button>
    </div>
  );
}
