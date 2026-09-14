"use client";

import { DEPOSIT_METHODS } from "@asm/contracts";

const MIN_USD = 10;

export function MethodPicker({
  onPick,
}: {
  onPick: (method: (typeof DEPOSIT_METHODS)[number]) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-4 py-2.5 text-sm">
        <span aria-hidden>🌐</span>
        <span>India</span>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-[var(--color-ink-2)]">
          Popular in your region ({DEPOSIT_METHODS.length})
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {DEPOSIT_METHODS.map((method) => (
            <li key={method}>
              <button
                type="button"
                onClick={() => onPick(method)}
                className="flex w-full items-center justify-between rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-3 text-left hover:border-[var(--color-brand)]"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{method}</span>
                  <span className="text-xs text-[var(--color-ink-2)]">
                    Min. ${MIN_USD.toFixed(2)}
                  </span>
                </span>
                <span aria-hidden className="text-[var(--color-ink-2)]">
                  &rsaquo;
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
