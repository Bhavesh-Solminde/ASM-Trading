"use client";

import { useActionState } from "react";
import { saveDailyTarget } from "./actions";

export function DailyTargetForm({ dailyTargetMinor }: { dailyTargetMinor: number }) {
  const [result, save, pending] = useActionState(saveDailyTarget, null);

  return (
    <form action={save} className="mt-3">
      <label className="admin-label" htmlFor="vault-daily-target">New target (₹)</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          key={dailyTargetMinor}
          id="vault-daily-target"
          name="targetRupees"
          type="number"
          inputMode="decimal"
          min="0.01"
          max="999999999999.99"
          step="0.01"
          defaultValue={(dailyTargetMinor / 100).toFixed(2)}
          required
          className="admin-input max-w-40"
        />
        <button type="submit" className="admin-btn admin-btn--primary" disabled={pending}>
          {pending ? "Saving…" : "Save target"}
        </button>
      </div>
      {result ? (
        <p className={result.saved ? "mt-2 text-[var(--admin-pos)]" : "admin-form-error mt-2"} role={result.saved ? "status" : "alert"}>
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
