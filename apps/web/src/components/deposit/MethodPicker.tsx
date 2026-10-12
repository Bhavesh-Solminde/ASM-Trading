"use client";

import { DEPOSIT_METHODS, UPI_METHODS } from "@asm/contracts";
import { Icon } from "@/components/shell/Icon";
import { GatewayIcon } from "./GatewayIcon";

// Mirrors MIN_DEPOSIT_INR_MINOR / MIN_DEPOSIT_USDT_MINOR in @asm/db, which
// a client component can't import.
const MIN_INR = 500;
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
      <div className="flex items-center gap-2 rounded border border-rule bg-tile px-4 py-2.5 text-sm">
        <Icon name="globe" className="size-4 text-ink-2" aria-hidden />
        <span>India</span>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-ink-2">
          Popular in your region ({methods.length})
        </p>
        <ul className="grid grid-cols-2 gap-2 phone:grid-cols-1">
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
                  className={`flex w-full items-center gap-3 rounded border border-rule bg-panel px-4 py-3 text-left ${
                    comingSoon
                      ? "cursor-not-allowed opacity-60"
                      : "hover:border-brand"
                  }`}
                >
                  <GatewayIcon method={method} />
                  <span className="flex flex-1 flex-col">
                    <span className="text-sm font-semibold">{method}</span>
                    <span className="text-xs text-ink-2">
                      {comingSoon
                        ? "Coming soon"
                        : UPI_SET.has(method)
                          ? `Min. ₹${MIN_INR}`
                          : `Min. $${MIN_USD.toFixed(2)}`}
                    </span>
                  </span>
                  {comingSoon ? (
                    <span className="rounded-full border border-rule bg-tile px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-2">
                      Soon
                    </span>
                  ) : (
                    <span aria-hidden className="text-ink-2">
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
