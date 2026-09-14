import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { setOverrideAction, clearOverrideAction } from "./actions";

export const dynamic = "force-dynamic";

const STAGE_OPTIONS = ["", "PRE_DEPOSIT", "DEPOSITED", "HIGH_VALUE"] as const;
const STAGE_TARGETS: Record<string, number> = {
  PRE_DEPOSIT: 0.65,
  DEPOSITED: 0.45,
  HIGH_VALUE: 0.27,
};

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function deltaClass(rate: number, target: number) {
  const d = rate - target;
  if (Math.abs(d) < 0.02) return "text-emerald-400";
  if (d > 0) return "text-red-400";
  return "text-amber-400";
}

export default async function WinRateDashboard() {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");

  // Load accounts with their stats and shadow aggregates.
  const accounts = await prisma.account.findMany({
    where: { user: { isBot: false } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { email: true } } },
  });

  type ShadowRow = {
    shownRate: number;
    honestRate: number;
    avgDeltaPips: number;
    total: number;
  };
  const shadowMap = new Map<string, ShadowRow>();
  for (const account of accounts) {
    const rows = await prisma.tradeShadow.findMany({
      where: { trade: { accountId: account.id } },
      select: { shownResult: true, honestResult: true, deltaPips: true },
    });
    if (rows.length === 0) continue;
    const total = rows.length;
    shadowMap.set(account.id, {
      total,
      shownRate: rows.filter((r) => r.shownResult === "WON").length / total,
      honestRate: rows.filter((r) => r.honestResult === "WON").length / total,
      avgDeltaPips: rows.reduce((s, r) => s + r.deltaPips, 0) / total,
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Win-Rate Controller</h1>
        <a
          href="/admin/deposits"
          className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
        >
          ← Deposits
        </a>
      </div>

      <p className="text-sm text-[var(--color-ink-2)]">
        Targets: PRE_DEPOSIT&nbsp;{pct(0.65)} · DEPOSITED&nbsp;{pct(0.45)} ·
        HIGH_VALUE&nbsp;{pct(0.27)}
      </p>

      <section className="overflow-x-auto rounded-xl border border-[var(--color-border)] text-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-ink-2)]">
              {[
                "User",
                "Account",
                "Stage",
                "Override",
                "Rolling rate",
                "Shadow rate",
                "Honest rate",
                "Avg Δpips",
                "Trades",
                "Actions",
              ].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((acc) => {
              const stage = acc.lifecycleOverride ?? acc.lifecycleStage;
              const target = STAGE_TARGETS[stage] ?? 0.5;
              const shadow = shadowMap.get(acc.id);
              return (
                <tr
                  key={acc.id}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-4 py-2 font-mono text-xs text-[var(--color-ink-2)]">
                    {acc.user.email}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[var(--color-ink-2)]">
                    {acc.id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs">
                      {stage}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {acc.lifecycleOverride ? (
                      <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-amber-300">
                        {acc.lifecycleOverride}
                      </span>
                    ) : (
                      <span className="text-[var(--color-ink-3)]">—</span>
                    )}
                  </td>
                  <td className={`px-4 py-2 font-mono ${deltaClass(acc.rollingWinRate, target)}`}>
                    {pct(acc.rollingWinRate)}
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {shadow ? pct(shadow.shownRate) : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[var(--color-ink-2)]">
                    {shadow ? pct(shadow.honestRate) : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[var(--color-ink-2)]">
                    {shadow ? shadow.avgDeltaPips.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-2 text-[var(--color-ink-2)]">
                    {acc.tradesCount}
                  </td>
                  <td className="px-4 py-2">
                    <form action={setOverrideAction} className="flex gap-1">
                      <input type="hidden" name="accountId" value={acc.id} />
                      <select
                        name="stage"
                        className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 py-0.5 text-xs"
                        defaultValue={acc.lifecycleOverride ?? ""}
                      >
                        {STAGE_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s === "" ? "— computed —" : s}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded bg-[var(--color-accent)] px-2 py-0.5 text-xs text-white"
                      >
                        Set
                      </button>
                    </form>
                    {acc.lifecycleOverride && (
                      <form action={clearOverrideAction} className="mt-1">
                        <input type="hidden" name="accountId" value={acc.id} />
                        <button
                          type="submit"
                          className="text-xs text-[var(--color-ink-2)] underline underline-offset-2"
                        >
                          Clear override
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-[var(--color-ink-2)]">
                  No human accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
