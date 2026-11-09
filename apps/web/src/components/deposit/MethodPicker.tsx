"use client";

import { DEPOSIT_METHODS, UPI_METHODS } from "@asm/contracts";
import { Icon } from "@/components/shell/Icon";
import { GatewayIcon } from "./GatewayIcon";
import { formatInr, inrToUsdt, methodAmountProblem } from "@asm/client-core";

const UPI_SET = new Set<string>(UPI_METHODS);

export function MethodPicker({
  onPick,
  amountInr,
  usdtEnabled,
  upiEnabled,
}: {
  onPick: (method: (typeof DEPOSIT_METHODS)[number]) => void;
  /** The amount chosen on step 1, in whole rupees; methods whose limits exclude it are disabled with a reason. */
  amountInr: number;
  /** False when no USDT network is configured — the method is hidden, not shown broken. */
  usdtEnabled: boolean;
  /** False until a relay phone is settling INR deposits (UPI_DEPOSITS_ENABLED). */
  upiEnabled: boolean;
}) {
  // While UPI rails are closed the rows stay visible with a "Coming soon"
  // subtitle, so the user sees that INR payments are planned, just not open yet.
  const methods = DEPOSIT_METHODS.filter((m) => m !== "USDT" || usdtEnabled);
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <Icon name="globe" className="size-4 flex-none" aria-hidden />
        <span>Showing methods for India</span>
      </p>

      <div>
        <p className="mb-2 text-xs font-semibold text-ink-2">
          Popular in your region ({methods.length})
        </p>
        <ul className="grid gap-2">
          {methods.map((method) => {
            const comingSoon = UPI_SET.has(method) && !upiEnabled;
            const problem = comingSoon ? null : methodAmountProblem(method, amountInr);
            const disabled = comingSoon || problem !== null;
            return (
              <li key={method}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    onPick(method);
                  }}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-2xl bg-panel px-4 py-3 text-left ring-1 ring-rule ${
                    disabled ? "cursor-not-allowed opacity-60" : "hover:ring-brand"
                  }`}
                >
                  <GatewayIcon method={method} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-bold">{method}</span>
                    <span className={`text-xs ${disabled ? "text-ink-3" : "text-ink-2"}`}>
                      {comingSoon
                        ? "Coming soon"
                        : (problem ??
                          (UPI_SET.has(method)
                            ? `Pay ${formatInr(amountInr)}`
                            : `Pay about $${inrToUsdt(amountInr).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`))}
                    </span>
                  </span>
                  {disabled ? null : <Icon name="chevron" className="size-[18px] text-ink-2" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
