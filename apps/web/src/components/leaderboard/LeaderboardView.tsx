import { formatMoney } from "@asm/db";
import type { LeaderboardResultDto } from "@asm/contracts";

/** A stable, non-identifying handle for a user with no nickname. */
function maskedId(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `#${(h % 100_000_000).toString().padStart(8, "0")}`;
}

export function LeaderboardView({ result }: { result: LeaderboardResultDto; currency: string }) {
  return (
    <div className="overflow-auto rounded border border-rule bg-panel p-4">
      <h2 className="mb-2 text-lg font-semibold">Top 10 traders{result.source === "demo" ? " · Demo" : ""}</h2>
      <p className="mb-4 text-xs text-ink-3">{result.source === "demo"
        ? "Simulated daily profits for development. Fictional profiles, not customer results."
        : "Ranked by today's realized profit and loss. Return is profit and loss as a percentage of settled stakes."}</p>
      <table className="w-full text-left text-sm tabular-nums">
        <thead className="text-xs text-ink-3">
          <tr>{["Rank", "Trader", "Market", "Quote P&L", "Return"].map((label) => <th key={label} scope="col" >{label}</th>)}</tr>
        </thead>
        <tbody>
          {result.entries.map((entry, index) => (
            <tr key={entry.accountId} className="border-t border-rule">
              <td className="py-3">{index + 1}</td>
              <td >{entry.nickname?.trim() || maskedId(entry.userId)}</td>
              <td >{entry.market || "—"}</td>
              <td className={`whitespace-nowrap ${entry.pnlMinor < 0 ? "text-down" : "text-up"}`}>{formatMoney(entry.pnlMinor, entry.currency)}</td>
              <td>{entry.returnPct == null ? "—" : `${entry.returnPct.toFixed(4)}%`}</td>
            </tr>
          ))}
          {result.entries.length === 0 && <tr className="border-t border-rule"><td colSpan={5} className="py-8 text-center text-ink-3">No ranked human traders yet today.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
