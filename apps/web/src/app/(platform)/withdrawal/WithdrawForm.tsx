"use client";

import { useState } from "react";
import { DEPOSIT_METHODS } from "@asm/contracts";

export function WithdrawForm({
  accountId,
  withdrawableMinor,
}: {
  accountId: string;
  withdrawableMinor: number;
}) {
  const [amountMajor, setAmountMajor] = useState(Math.max(1, Math.floor(withdrawableMinor / 100)));
  const [method, setMethod] = useState<(typeof DEPOSIT_METHODS)[number]>("PhonePe");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const res = await fetch("/api/withdrawals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, amount: Math.round(amountMajor * 100), method }),
    });

    if (res.ok) {
      setDone(true);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not request that withdrawal.");
  }

  if (done) {
    return (
      <p className="rounded-lg border border-[var(--color-up)] bg-[#14301f] p-3 text-sm text-[#4fc08d]">
        Withdrawal requested. Requests are processed in 3 business days.
      </p>
    );
  }

  if (withdrawableMinor <= 0) {
    return (
      <div className="rounded-lg border border-[var(--color-down)] bg-[#2a1418] p-4">
        <p className="text-sm text-[#e8798c]">
          You can withdraw money from your balance to the method you used for depositing. Requests
          are processed in 3 business days.
        </p>
        <a
          href="/deposit"
          className="mt-2 inline-block text-xs font-bold text-[var(--color-up)] underline underline-offset-4"
        >
          Make a deposit
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label
          htmlFor="wamount"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Amount
        </label>
        <input
          id="wamount"
          type="number"
          min={1}
          max={Math.floor(withdrawableMinor / 100)}
          value={amountMajor}
          onChange={(e) => setAmountMajor(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm tabular-nums outline-none focus:border-[var(--color-brand)]"
        />
      </div>

      <div>
        <label
          htmlFor="wmethod"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Method
        </label>
        <select
          id="wmethod"
          value={method}
          onChange={(e) => setMethod(e.target.value as (typeof DEPOSIT_METHODS)[number])}
          className="mt-1 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
        >
          {DEPOSIT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--color-ink-2)]">
          Only a method you have already deposited with is accepted.
        </p>
      </div>

      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}

      <button
        type="submit"
        className="rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white"
      >
        Request withdrawal
      </button>
    </form>
  );
}
