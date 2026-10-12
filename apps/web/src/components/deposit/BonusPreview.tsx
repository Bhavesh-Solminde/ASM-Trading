"use client";

import { useState } from "react";
import { BONUS_TIERS, bonusPercentForDeposit, ordinal } from "@/lib/bonus";
import { BonusOfferSheet } from "@/components/shell/PromoBanner";

/**
 * What this deposit is worth: the bonus tier it falls in, the total trading
 * balance it produces and the four-tier ladder with the next one lit.
 * Renders nothing once every tier is used. The one-line disclosure must stay —
 * the bonus is trading credit, not withdrawable.
 */
export function BonusPreview({
  amountInr,
  completedDeposits,
}: {
  amountInr: number;
  completedDeposits: number;
}) {
  const [open, setOpen] = useState(false);
  const next = completedDeposits + 1;
  const pct = bonusPercentForDeposit(next);
  if (pct === 0) return null;

  const bonus = Math.floor((amountInr * pct) / 100);
  const money = (n: number) => `₹${n.toLocaleString("en-US")}`;

  return (
    <section aria-labelledby="bonus-preview-title" className="rounded-2xl bg-[#0d1a12] p-[18px] ring-1 ring-up/20">
      <div className="flex items-center justify-between gap-3">
        <h2 id="bonus-preview-title" className="text-[13px] font-bold text-up">
          {ordinal(next)} deposit &middot; +{pct}% bonus
        </h2>
        <span className="rounded-full bg-up/15 px-2 py-[3px] text-[11px] font-extrabold leading-4 text-up">NEXT</span>
      </div>

      <p className="mt-3 text-[13px] text-ink-2">You will trade with</p>
      <p className="text-[34px] font-extrabold leading-tight tracking-[-0.02em] text-up tabular-nums">
        {money(amountInr + bonus)}
      </p>
      <p className="mt-1 text-[13px] text-ink-2 tabular-nums">
        {money(amountInr)} your money + {money(bonus)} bonus
      </p>

      <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Bonus tiers">
        {BONUS_TIERS.map((tier, i) => {
          const n = i + 1;
          const claimed = n <= completedDeposits;
          const isNext = n === next;
          return (
            <li
              key={n}
              aria-current={isNext ? "step" : undefined}
              className={`grid gap-0.5 rounded-[10px] py-2 text-center ${
                isNext ? "bg-up/[0.18]" : "bg-white/[0.04]"
              } ${claimed ? "opacity-55" : ""}`}
            >
              <b className={`text-sm ${isNext ? "text-up" : "text-ink"}`}>{tier}%</b>
              <span className="text-[10px] text-ink-2">
                {ordinal(n)}
                {claimed ? <span className="sr-only"> (used)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-3.5 text-xs leading-normal text-ink-2">
        Bonus is trading credit and can&apos;t be withdrawn.{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-semibold text-brand underline-offset-4 hover:underline phone:min-h-11"
        >
          How it works
        </button>
      </p>

      {open ? <BonusOfferSheet completedDeposits={completedDeposits} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
