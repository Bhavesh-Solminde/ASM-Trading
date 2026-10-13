"use client";

import { useState } from "react";

/**
 * Payout percentage with − / + steps. Save and Undo only appear once the value
 * differs from what's live, so an untouched row stays quiet.
 */
export function PayoutStepper({
  assetId,
  symbol,
  initial,
  action,
}: {
  assetId: string;
  symbol: string;
  initial: number;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const changed = value !== initial;
  const clamp = (n: number) => Math.min(200, Math.max(1, Math.round(n)));

  return (
    <form action={action} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input type="hidden" name="assetId" value={assetId} />
      <div className={`admin-stepper${changed ? " edited" : ""}`}>
        <button type="button" onClick={() => setValue((v) => clamp(v - 1))} aria-label={`Lower ${symbol} payout`}>
          −
        </button>
        <input
          name="payoutPct"
          type="number"
          min={1}
          max={200}
          value={value}
          onChange={(e) => setValue(clamp(Number(e.target.value) || 1))}
          aria-label={`Payout percent for ${symbol}`}
        />
        <span aria-hidden="true">%</span>
        <button type="button" onClick={() => setValue((v) => clamp(v + 1))} aria-label={`Raise ${symbol} payout`}>
          +
        </button>
      </div>
      {changed ? (
        <>
          <span className="admin-cell-sub" style={{ textDecoration: "line-through" }}>
            {initial}%
          </span>
          <button type="button" className="admin-btn admin-btn--sm admin-btn--ghost" onClick={() => setValue(initial)}>
            Undo
          </button>
          <button type="submit" className="admin-btn admin-btn--sm admin-btn--primary">
            Save
          </button>
        </>
      ) : null}
    </form>
  );
}
