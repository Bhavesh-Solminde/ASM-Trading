"use client";

import { DEPOSIT_METHODS, UPI_METHODS } from "@asm/contracts";

const MIN_USD = 10;
const UPI_SET = new Set<string>(UPI_METHODS);

export function MethodPicker({
  onPick,
  usdtEnabled,
  upiEnabled,
}: {
  onPick: (method: (typeof DEPOSIT_METHODS)[number]) => void;
  /** False when no USDT network is configured — the method is hidden, not shown broken. */
  usdtEnabled: boolean;
  /** False until a relay phone is settling INR deposits (UPI_DEPOSITS_ENABLED). */
  upiEnabled: boolean;
}) {
  // While UPI rails are closed the rows stay visible with a "Coming soon"
  // pill, so the user sees that INR payments are planned, just not open yet.
  const methods = DEPOSIT_METHODS.filter((m) => m !== "USDT" || usdtEnabled);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded border border-[var(--color-rule)] bg-[var(--color-tile)] px-4 py-2.5 text-sm">
        <span aria-hidden>🌐</span>
        <span>India</span>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-[var(--color-ink-2)]">
          Popular in your region ({methods.length})
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {methods.map((method) => {
            const comingSoon = UPI_SET.has(method) && !upiEnabled;
            return (
              <li key={method}>
                <button
                  type="button"
                  disabled={comingSoon}
                  aria-disabled={comingSoon}
                  onClick={() => {
                    if (comingSoon) return;
                    onPick(method);
                  }}
                  className={`flex w-full items-center justify-between rounded border border-[var(--color-rule)] bg-[var(--color-panel)] px-4 py-3 text-left ${
                    comingSoon
                      ? "cursor-not-allowed opacity-60"
                      : "hover:border-[var(--color-brand)]"
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold">{method}</span>
                    <span className="text-xs text-[var(--color-ink-2)]">
                      {comingSoon ? "Coming soon" : `Min. $${MIN_USD.toFixed(2)}`}
                    </span>
                  </span>
                  {comingSoon ? (
                    <span className="rounded-full border border-[var(--color-rule)] bg-[var(--color-tile)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink-2)]">
                      Soon
                    </span>
                  ) : (
                    <span aria-hidden className="text-[var(--color-ink-2)]">
                      &rsaquo;
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
