import { BONUS_TIERS, bonusPercentForDeposit, ordinal } from "@/lib/bonus";

/**
 * The deposit-bonus ladder at the top of the deposit page: what this deposit
 * gets, and every tier with the ones already used ticked off. Nothing once the
 * user is past the last tier.
 */
export function DepositBonusStrip({ completedDeposits }: { completedDeposits: number }) {
  const next = completedDeposits + 1;
  const pct = bonusPercentForDeposit(next);
  if (pct === 0) return null;

  return (
    <section className="rounded-lg border border-[var(--color-up)]/45 bg-[var(--color-up)]/[0.07] p-3.5">
      <p className="text-sm font-semibold">
        Your {ordinal(next)} deposit gets{" "}
        <span className="font-black text-[var(--color-up)]">+{pct}% bonus</span>
      </p>
      <ol className="mt-2.5 grid grid-cols-4 gap-1.5">
        {BONUS_TIERS.map((tier, i) => {
          const n = i + 1;
          const claimed = n <= completedDeposits;
          const isNext = n === next;
          return (
            <li
              key={n}
              className={`rounded-md border px-1 py-1.5 text-center ${
                isNext
                  ? "border-[var(--color-up)] bg-[var(--color-up)]/15"
                  : "border-[var(--color-rule)] bg-[var(--color-panel)]"
              } ${claimed ? "opacity-55" : ""}`}
            >
              <span className={`led block text-[15px] leading-tight ${claimed ? "text-[var(--color-ink-3)]" : "text-[var(--color-up)]"}`}>
                {tier}%
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-2)]">
                {claimed ? "✓ " : ""}
                {ordinal(n)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
