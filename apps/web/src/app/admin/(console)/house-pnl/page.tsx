import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getHouseDay,
  getTreasury,
  houseDateForInstant,
  listHouseDays,
} from "@asm/db";
import {
  DEFAULT_GLG_CONFIG,
  glgLadder,
  treasuryHealth,
} from "@asm/algo";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { setTargetAction, setTreasuryTargetAction } from "./actions";

export const dynamic = "force-dynamic";

function inr(minor: number): string {
  const rupees = minor / 100;
  return rupees.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function HousePnlDashboard() {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");

  const today = houseDateForInstant(new Date());
  const [todayRow, history, treasury] = await Promise.all([
    getHouseDay(today),
    listHouseDays(30),
    getTreasury(),
  ]);

  const target = todayRow?.targetProfitMinor ?? 0;
  const realized = todayRow?.realizedProfitMinor ?? 0;
  const gap = target - realized;

  const treasuryMinor = treasury?.treasuryMinor ?? 0;
  const treasuryTargetMinor = treasury?.treasuryTargetMinor ?? 0;
  const health = treasuryHealth(treasuryMinor, treasuryTargetMinor);
  const basePwin = glgLadder(health, DEFAULT_GLG_CONFIG.basePwinLadder);
  const pwinCapped = Math.min(basePwin, DEFAULT_GLG_CONFIG.pwinCeiling);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">
          Treasury &amp; Daily P&amp;L
        </h1>
        <a
          href="/admin"
          className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
        >
          ← Admin home
        </a>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-2)]">
            Treasury (controls win probability)
          </h2>
          <span className="text-[11px] text-[var(--color-ink-2)]">
            Growth-Loop Governor · live
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card
            label="Treasury balance"
            value={inr(treasuryMinor)}
            tone={treasuryMinor >= treasuryTargetMinor ? "good" : "warn"}
          />
          <Card
            label="Treasury target"
            value={treasuryTargetMinor > 0 ? inr(treasuryTargetMinor) : "—"}
          />
          <Card
            label="Health"
            value={
              treasuryTargetMinor > 0
                ? `${(health * 100).toFixed(0)}%`
                : "—"
            }
            tone={health >= 1 ? "good" : "warn"}
          />
          <Card
            label="Base win prob."
            value={`${(pwinCapped * 100).toFixed(1)}%`}
          />
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
          <form
            action={setTreasuryTargetAction}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col text-xs uppercase tracking-wide text-[var(--color-ink-2)]">
              Treasury target (INR)
              <input
                name="treasuryTargetRupees"
                type="number"
                min={1}
                step={100}
                defaultValue={
                  treasuryTargetMinor > 0
                    ? Math.round(treasuryTargetMinor / 100)
                    : 10000
                }
                className="mt-1 w-48 rounded border border-[var(--color-border)] bg-[var(--color-surface-3)] px-2 py-1 font-mono text-sm text-[var(--color-ink-0)]"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
            >
              Save target
            </button>
            <p className="basis-full text-[11px] leading-relaxed text-[var(--color-ink-2)]">
              Health = balance ÷ target feeds the pWin ladder. Lower target →
              higher health → higher win rate (capped at{" "}
              {(DEFAULT_GLG_CONFIG.pwinCeiling * 100).toFixed(0)}%). Higher
              target → lower health → lower win rate (floor{" "}
              {(DEFAULT_GLG_CONFIG.basePwinLadder[0]![1] * 100).toFixed(0)}%).
              Per-asset edge and giveback clamps may still pull pWin lower at
              trade time.
            </p>
          </form>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-2)]">
          Today&apos;s earnings (IST)
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card label="Target" value={target > 0 ? inr(target) : "—"} />
          <Card
            label="Realized"
            value={inr(realized)}
            tone={realized >= target ? "good" : "warn"}
          />
          <Card
            label="Gap"
            value={gap > 0 ? inr(gap) : "cleared"}
            tone={gap <= 0 ? "good" : "warn"}
          />
          <Card
            label="Progress"
            value={target > 0 ? pct(realized, target) : "—"}
          />
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
          <form action={setTargetAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs uppercase tracking-wide text-[var(--color-ink-2)]">
              Today's target (INR)
              <input
                name="targetRupees"
                type="number"
                min={0}
                step={100}
                defaultValue={target > 0 ? Math.round(target / 100) : 10000}
                className="mt-1 w-40 rounded border border-[var(--color-border)] bg-[var(--color-surface-3)] px-2 py-1 font-mono text-sm text-[var(--color-ink-0)]"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
            >
              Save
            </button>
          </form>
        </div>

        {!todayRow && (
          <p className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-[var(--color-ink-2)]">
            No row for today yet. Default fallback is INR 10,000
            (FALLBACK_DAILY_TARGET_MINOR). First save creates it.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-2)]">
          Last 30 IST days
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] text-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-ink-2)]">
                {[
                  "Date",
                  "Target",
                  "Realized",
                  "Stakes",
                  "Payouts",
                  "Settled",
                  "Progress",
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-2 text-left font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((row) => {
                const p =
                  row.targetProfitMinor > 0
                    ? row.realizedProfitMinor / row.targetProfitMinor
                    : 0;
                const cls =
                  p >= 1
                    ? "text-emerald-400"
                    : p >= 0.5
                      ? "text-amber-300"
                      : "text-red-400";
                return (
                  <tr
                    key={isoDate(row.date)}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      {isoDate(row.date)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {inr(row.targetProfitMinor)}
                    </td>
                    <td className={`px-4 py-2 font-mono text-xs ${cls}`}>
                      {inr(row.realizedProfitMinor)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-[var(--color-ink-2)]">
                      {inr(row.totalStakesMinor)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-[var(--color-ink-2)]">
                      {inr(row.totalPayoutsMinor)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-[var(--color-ink-2)]">
                      {row.tradesSettled}
                    </td>
                    <td className={`px-4 py-2 font-mono text-xs ${cls}`}>
                      {row.targetProfitMinor > 0
                        ? `${(p * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
              {history.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-[var(--color-ink-2)]"
                  >
                    No history yet — governor flag is off or no settlements have
                    landed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  const cls =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-300"
        : "text-[var(--color-ink-0)]";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-[var(--color-ink-2)]">
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg ${cls}`}>{value}</div>
    </div>
  );
}
