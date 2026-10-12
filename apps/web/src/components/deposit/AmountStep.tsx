"use client";

import { useState } from "react";
import { SummaryCard } from "@/components/payments/SummaryCard";
import { formatInr } from "./limits";

/**
 * Last step for a UPI-rail deposit. The amount was chosen on step 1 and the
 * method on step 2; this recaps both (each with a Change) and starts the
 * deposit through the same API call as before.
 */
export function AmountStep({
  method,
  amountInr,
  onBack,
  onChangeAmount,
  bonusPercent,
}: {
  method: string;
  /** Whole rupees, already validated against this method's limits. */
  amountInr: number;
  /** Back to the method list (step 2). */
  onBack: () => void;
  /** Back to the amount (step 1). */
  onChangeAmount: () => void;
  /** Bonus tier this deposit will get (0 once every tier is used). */
  bonusPercent: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proceed() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, amountInr: Math.round(amountInr * 100) }),
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
      <SummaryCard
        rows={[
          { label: "Method", value: method, change: { label: "Change method", onClick: onBack } },
          { label: "Amount", value: formatInr(amountInr), change: { label: "Change amount", onClick: onChangeAmount } },
        ]}
      />

      <div className="rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/10 p-3.5 text-xs leading-relaxed text-[var(--color-brand)]">
        Payments with this method can take up to 48 hours to process. The status
        may appear as &ldquo;Failed&rdquo; until the funds are received on our side.
      </div>

      <div className="flex items-baseline justify-between border-t border-dashed border-[var(--color-rule)] pt-3 text-sm">
        <span className="text-[var(--color-ink-2)]">You will receive</span>
        <span className="font-semibold tabular-nums">{formatInr(amountInr)}</span>
      </div>

      {bonusPercent > 0 ? (
        <>
          <div className="flex items-baseline justify-between text-xs text-[var(--color-ink-2)]">
            <span>Bonus ({bonusPercent}%)</span>
            <span className="tabular-nums text-[var(--color-up)]">
              +{formatInr(Math.floor((amountInr * bonusPercent) / 100))}
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
        className="h-14 rounded-2xl bg-brand-fill px-4 text-base font-bold text-white hover:bg-brand-fill-hi disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Starting…" : "Proceed to Pay"}
      </button>
    </div>
  );
}
