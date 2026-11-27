import { formatMoney } from "@asm/db";
import type { LeaderboardResultDto } from "@asm/contracts";

/** A stable, non-identifying handle for a user with no nickname. */
function maskedId(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `#${(h % 100_000_000).toString().padStart(8, "0")}`;
}

function TraderRow({ entry, rank }: { entry: LeaderboardResultDto["entries"][number]; rank?: number }) {
  return (
    <tr className="border-t border-rule">
      <td className="py-3">{rank ?? "—"}</td>
      <td>
        {entry.nickname?.trim() || maskedId(entry.userId)}
        {rank === undefined ? <span className="block text-[10px] text-ink-3">Example</span> : null}
      </td>
      <td>{entry.market || "—"}</td>
      <td className={`whitespace-nowrap ${entry.pnlMinor < 0 ? "text-down" : "text-up"}`}>{formatMoney(entry.pnlMinor, entry.currency)}</td>
      <td>{entry.returnPct == null ? "—" : `${entry.returnPct.toFixed(4)}%`}</td>
    </tr>
  );
}

export function LeaderboardView({ entries, examples }: {
  entries: LeaderboardResultDto["entries"];
  examples: LeaderboardResultDto["entries"];
}) {
  return (
    <section aria-labelledby="leaderboard-live" className="overflow-auto rounded border border-rule bg-panel p-4 phone:p-3">
      <h2 id="leaderboard-live" className="mb-2 text-lg font-semibold">Top live traders</h2>
      <p className="mb-4 text-xs text-ink-3">Ranked by today's profit and loss. Return is profit and loss as a percentage of settled stakes.</p>
      <table aria-labelledby="leaderboard-live" className="w-full text-left text-sm tabular-nums phone:text-xs [&_td]:pr-2 [&_th]:pr-2 [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
        <thead className="text-xs text-ink-3">
          <tr>{["Rank", "Trader", "Market", "Quote P&L", "Return"].map((label) => <th key={label} scope="col">{label}</th>)}</tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <TraderRow key={entry.accountId} entry={entry} rank={index + 1} />
          ))}
          {entries.length === 0 ? <tr className="border-t border-rule"><td colSpan={5} className="py-8 text-center text-ink-3">No ranked traders yet today.</td></tr> : null}
        </tbody>
        {examples.length > 0 ? (
          <tbody aria-labelledby="leaderboard-examples">
            <tr className="border-y border-rule bg-tile">
              <th id="leaderboard-examples" colSpan={5} scope="rowgroup" className="p-3 font-semibold">
                Example traders
                <span className="mt-1 block text-xs font-normal text-ink-2">Fictional results. Examples change daily and repeat every 60 days.</span>
              </th>
            </tr>
            {examples.map((entry) => <TraderRow key={entry.accountId} entry={entry} />)}
          </tbody>
        ) : null}
      </table>
    </section>
  );
}
