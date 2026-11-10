import { requireAdmin } from "@/lib/admin-auth";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { Card, PageHead, Pill, StatCard } from "../../_components/ui";
import { num } from "../../_lib/format";
import { DailyTargetForm } from "./DailyTargetForm";
import { readDailyOtcTarget, readDailyOtcVault } from "./report";

export const dynamic = "force-dynamic";

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function money(minor: number) {
  return rupees.format(minor / 100);
}

export default async function HousePnlDashboard() {
  await requireAdmin();
  const [history, dailyTargetMinor] = await Promise.all([readDailyOtcVault(), readDailyOtcTarget()]);
  const today = history[0]!;
  const targetMet = today.profit >= dailyTargetMinor;
  const remaining = Math.max(0, dailyTargetMinor - today.profit);
  const progress = (minor: number) => (minor / dailyTargetMinor) * 100;

  return (
    <>
      <PageHead
        title="Daily OTC Vault"
        desc="Track settled LIVE OTC trading P&L against your daily target."
        actions={<AutoRefresh />}
      />

      <div className="admin-grid grid-cols-1 md:grid-cols-3">
        <StatCard
          label="Today's settled P&L"
          value={money(today.profit)}
          icon="trend"
          foot={`${today.date} IST`}
          warn={today.profit < 0}
        />
        <StatCard
          label="Daily profit target"
          value={money(dailyTargetMinor)}
          icon="ledger"
          foot={
            <>
              New reporting day at midnight IST
              <DailyTargetForm dailyTargetMinor={dailyTargetMinor} />
            </>
          }
        />
        <StatCard
          label="Remaining to target"
          value={money(remaining)}
          icon="clock"
          foot={`${num(today.settled)} settled trades today`}
        />
      </div>

      <Card
        title="Today's target progress"
        sub="Settled stakes minus payouts and refunds"
        action={
          <Pill tone={targetMet ? "pos" : today.profit < 0 ? "warn" : "info"}>
            {targetMet ? "Target met" : today.profit < 0 ? "Below zero" : "Tracking"}
          </Pill>
        }
      >
        <div className="flex items-center gap-4">
          <progress
            aria-label="Today's profit target progress"
            className="h-3 flex-1 overflow-hidden rounded-full accent-[var(--admin-pos)] [&::-webkit-progress-bar]:bg-[var(--admin-border)] [&::-webkit-progress-value]:bg-[var(--admin-pos)]"
            max={100}
            value={Math.max(0, Math.min(100, progress(today.profit)))}
          />
          <strong className="tabular-nums">{progress(today.profit).toFixed(1)}%</strong>
        </div>
        <p className="mt-3 text-sm text-[var(--admin-muted)]">
          This benchmark tracks settled USER trades in LIVE accounts. Amounts include bonus funds,
          and USD trades are shown in INR at the platform conversion rate.
        </p>
      </Card>

      <Card title="Last 30 IST days" sub="Trades count on the day they settle. Percentages use the current target." noBody>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Date (IST)</th>
                <th scope="col" className="admin-num-right">Settled trades</th>
                <th scope="col" className="admin-num-right">Settled stakes</th>
                <th scope="col" className="admin-num-right">Payouts &amp; refunds</th>
                <th scope="col" className="admin-num-right">House P&amp;L</th>
                <th scope="col" className="admin-num-right">Target progress</th>
              </tr>
            </thead>
            <tbody>
              {history.map((day) => (
                <tr key={day.date}>
                  <td className="tabular-nums">{day.date}{day.date === today.date ? " · Today" : ""}</td>
                  <td className="admin-num-right">{num(day.settled)}</td>
                  <td className="admin-num-right">{money(day.stakes)}</td>
                  <td className="admin-num-right">{money(day.payouts)}</td>
                  <td className="admin-num-right" style={{ color: day.profit < 0 ? "var(--admin-neg)" : day.profit > 0 ? "var(--admin-pos)" : undefined }}>
                    {money(day.profit)}
                  </td>
                  <td className="admin-num-right">{progress(day.profit).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
