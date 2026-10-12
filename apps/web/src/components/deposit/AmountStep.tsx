"use client";

import { useState } from "react";

const QUICK = [500, 1000, 4000, 10000];

export function AmountStep({
  method,
  onBack,
  bonusPercent,
}: {
  method: string;
  onBack: () => void;
  /** Bonus tier this deposit will get (0 once every tier is used). */
  bonusPercent: number;
}) {
  const [amountMajor, setAmountMajor] = useState(2000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proceed() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, amountInr: Math.round(amountMajor * 100) }),
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
        className="self-start text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4 phone:py-3"
      >
        &lsaquo; Change method
      </button>

      <div className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-panel)] p-4">
        <p className="text-sm font-semibold">{method}</p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--color-ink-2)]">
          <div>
            <dt>Min</dt>
            <dd className="tabular-nums text-[var(--color-ink)]">₹500</dd>
          </div>
          <div>
            <dt>Max</dt>
            <dd className="tabular-nums text-[var(--color-ink)]">₹10,00,000</dd>
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
          min={500}
          max={1000000}
          value={amountMajor}
          onChange={(e) => setAmountMajor(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-tile)] px-4 py-2.5 text-sm tabular-nums focus:border-brand phone:h-11 phone:py-0 phone:text-base"
        />
        <div className="mt-2 flex gap-2">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmountMajor(q)}
              className="flex-1 rounded-lg border border-[var(--color-rule)] bg-[var(--color-panel)] px-2 py-1.5 text-xs font-semibold phone:min-h-11 phone:py-2.5 phone:text-sm"
            >
              ₹{q.toLocaleString("en-IN")}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/10 p-3 text-xs leading-relaxed text-[var(--color-brand)]">
        Payments with this method can take up to 48 hours to process. The status
        may appear as &ldquo;Failed&rdquo; until the funds are received on our side.
      </div>

      <div className="flex items-baseline justify-between border-t border-dashed border-[var(--color-rule)] pt-3 text-sm">
        <span className="text-[var(--color-ink-2)]">You will receive</span>
        <span className="font-semibold tabular-nums">₹{amountMajor.toLocaleString("en-IN")}</span>
      </div>

      {bonusPercent > 0 ? (
        <>
          <div className="flex items-baseline justify-between text-xs text-[var(--color-ink-2)]">
            <span>Bonus ({bonusPercent}%)</span>
            <span className="tabular-nums text-[var(--color-up)]">
              +₹{Math.floor((amountMajor * bonusPercent) / 100).toLocaleString("en-IN")}
            </span>
          </div>
          <p className="-mt-2 text-[11px] text-[var(--color-ink-3)]">
            Bonus is for trading only and can&apos;t be withdrawn.
          </p>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-down">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void proceed()}
        className="rounded-lg bg-brand-fill px-4 py-3 text-sm font-bold text-white hover:bg-brand-fill-hi disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Starting…" : "Proceed to Pay"}
      </button>
    </div>
  );
}
