"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { formatMinor } from "@/lib/format-money";
import { convertMinorBetween } from "@/lib/currency";

type Currency = "INR" | "USD";

export interface AccountBalance {
  id: string;
  type: "DEMO" | "LIVE";
  currency: string;
  realBalance: number;
  bonusBalance: number;
  /** Withdrawable minor units — LIVE only. */
  withdrawable?: number;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-2">{label}</p>
      <p className="led text-lg text-ink">{value}</p>
    </div>
  );
}

/**
 * Account balances + real-currency conversion (₹100 = $1). Shows "In account"
 * and, for the live account, "Available for withdrawal" — then lets the trader
 * convert the whole balance between INR and USD.
 */
export function CurrencyConvertCard({ accounts }: { accounts: AccountBalance[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function convert(accountId: string, currency: Currency) {
    setBusyId(accountId);
    setError(null);
    try {
      const res = await fetch("/api/account/currency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, currency }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not convert the balance.");
    } catch {
      setError("Could not reach the server.");
    }
    setBusyId(null);
  }

  return (
    <section className="rounded border border-rule bg-panel p-4">
      <h2 className="mb-1 text-sm font-semibold">Balances &amp; currency</h2>
      <p className="mb-4 flex items-center gap-1.5 text-xs text-ink-2">
        <span
          role="img"
          aria-label="Conversion rate notice"
          title="Fixed conversion rate: ₹100 = $1. This applies to your whole balance (real and bonus). The rate is fixed — it does not follow live market FX."
          className="inline-grid size-4 flex-none cursor-help place-items-center rounded-full text-caution"
        >
          <Icon name="alert" className="size-4" />
        </span>
        Convert your whole balance between rupees and dollars at a fixed{" "}
        <b className="text-ink">₹100 = $1</b>.
      </p>

      <div className="grid gap-3">
        {accounts.map((acct) => {
          const total = acct.realBalance + acct.bonusBalance;
          const target: Currency = acct.currency === "INR" ? "USD" : "INR";
          const preview = convertMinorBetween(total, acct.currency, target);
          const busy = busyId === acct.id;
          const live = acct.type === "LIVE";
          return (
            <div key={acct.id} className="rounded-[3px] border border-rule bg-tile/40 p-3.5">
              <div className="mb-3 flex items-center justify-between">
                <span
                  className={`grid grid-flow-col items-center gap-1.5 rounded-[2px] px-2 py-0.5 text-[10px] font-extrabold tracking-[0.12em] ${
                    live ? "bg-up text-up-ink" : "border border-dotted border-[#555] text-ink-2"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${
                      live ? "bg-down shadow-[0_0_5px_var(--color-down)] blink" : "bg-ink-3"
                    }`}
                  />
                  {live ? "LIVE" : "DEMO"}
                </span>
                <span className="text-[11px] font-bold tracking-[0.08em] text-ink-2">{acct.currency}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="In account" value={formatMinor(total, acct.currency)} />
                {live ? (
                  <Stat
                    label="Available for withdrawal"
                    value={formatMinor(acct.withdrawable ?? 0, acct.currency)}
                  />
                ) : (
                  <Stat label="Play money" value="Demo" />
                )}
              </div>

              <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-dashed border-rule pt-3">
                <span className="text-[11px] text-ink-2">
                  Convert to <b className="text-ink">{target}</b> → ≈{" "}
                  <b className="text-brand">{formatMinor(preview, target)}</b>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void convert(acct.id, target)}
                  className="ml-auto inline-flex h-9 items-center rounded border border-brand bg-brand px-3.5 text-xs font-bold uppercase tracking-[0.06em] text-brand-ink disabled:opacity-60 phone:h-10"
                >
                  {busy ? "Converting…" : `Convert to ${target}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-3 text-xs text-down">{error}</p> : null}
    </section>
  );
}
