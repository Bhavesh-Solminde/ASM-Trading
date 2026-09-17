import { prisma } from "@asm/db";
import { TARGETS, HARD_CEILING } from "@asm/algo";

export const dynamic = "force-dynamic";

export default async function AlgorithmPage() {
  const [byStage, shadows, assets] = await Promise.all([
    prisma.$queryRaw<{ stage: string; settled: bigint; won: bigint }[]>`
      SELECT a."lifecycleStage" AS stage,
             count(*) AS settled,
             sum(CASE WHEN t.status = 'WON' THEN 1 ELSE 0 END) AS won
      FROM "Trade" t
      JOIN "Account" a ON a.id = t."accountId"
      WHERE t.status IN ('WON', 'LOST')
      GROUP BY a."lifecycleStage"
    `,
    prisma.$queryRaw<{ total: bigint; flipped: bigint; avg_delta: number | null }[]>`
      SELECT count(*) AS total,
             sum(CASE WHEN "shownResult" <> "honestResult" THEN 1 ELSE 0 END) AS flipped,
             avg(abs("deltaPips")) AS avg_delta
      FROM "TradeShadow"
    `,
    prisma.asset.findMany({
      select: { symbol: true, payoutPct: true, isOpen: true },
      orderBy: { symbol: "asc" },
    }),
  ]);

  const shadow = shadows[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">
          Admin · not visible to traders
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Algorithm dashboard
        </h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Realised versus target</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">
              <th className="pb-2">Stage</th>
              <th className="pb-2">Settled</th>
              <th className="pb-2">Realised</th>
              <th className="pb-2">Target</th>
              <th className="pb-2">Drift</th>
            </tr>
          </thead>
          <tbody>
            {byStage.map((row) => {
              const settled = Number(row.settled);
              const realised = settled === 0 ? 0 : Number(row.won) / settled;
              const target = TARGETS[row.stage as keyof typeof TARGETS] ?? 0;
              const drift = realised - target;
              return (
                <tr key={row.stage} className="border-t border-[var(--color-edge)]">
                  <td className="py-2">{row.stage}</td>
                  <td className="py-2 tabular-nums">{settled}</td>
                  <td className="py-2 tabular-nums">{(realised * 100).toFixed(1)}%</td>
                  <td className="py-2 tabular-nums text-[var(--color-ink-2)]">{(target * 100).toFixed(0)}%</td>
                  <td className="py-2 tabular-nums" style={{
                    color: Math.abs(drift) > 0.05 ? "var(--color-down)" : "var(--color-up)",
                  }}>
                    {drift >= 0 ? "+" : "−"}{(Math.abs(drift) * 100).toFixed(1)} pts
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-[var(--color-ink-2)]">
          Hard ceiling {(HARD_CEILING * 100).toFixed(0)}%.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Shadow ledger</h2>
        <dl className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">Records</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{Number(shadow?.total ?? 0)}</dd>
          </div>
          <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">Outcome flipped</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{Number(shadow?.flipped ?? 0)}</dd>
          </div>
          <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">Mean |Δ| pips</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{(shadow?.avg_delta ?? 0).toFixed(2)}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Assets</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {assets.map((a) => (
            <li key={a.symbol} className="flex justify-between border-t border-[var(--color-edge)] py-2">
              <span>{a.symbol}</span>
              <span className="tabular-nums">{a.payoutPct}% {a.isOpen ? "" : "· closed"}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
