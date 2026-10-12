import type { ReactNode } from "react";

export interface SummaryRow {
  label: string;
  value: ReactNode;
  /** A "Change" control that sends the user back to the step that owns this value. */
  change?: { label: string; onClick: () => void };
}

/** Read-only recap of what was chosen on earlier steps, each row with an optional Change. */
export function SummaryCard({ rows }: { rows: SummaryRow[] }) {
  return (
    <dl className="divide-y divide-tile rounded-2xl bg-panel px-4">
      {rows.map((r) => (
        <div key={r.label} className="flex min-h-14 items-center gap-3 py-2">
          <dt className="text-[13px] text-ink-2">{r.label}</dt>
          <dd className="ml-auto min-w-0 truncate text-right text-[15px] font-bold tabular-nums">{r.value}</dd>
          {r.change ? (
            <button
              type="button"
              onClick={r.change.onClick}
              aria-label={r.change.label}
              className="grid h-11 flex-none place-items-center rounded-[10px] bg-tile px-3 text-[13px] font-bold text-brand hover:bg-tile-hi phone:h-11"
            >
              Change
            </button>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
