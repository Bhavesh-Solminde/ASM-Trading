import { formatMoney } from "@asm/db";
import { Icon } from "@/components/shell/Icon";
import type { LeaderboardResultDto, LeaderboardEntryDto } from "@asm/contracts";

/** ISO-3166 alpha-2 → flag emoji; empty string for anything unexpected. */
function flag(country: string | null): string {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return "🌐";
  const cp = [...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...cp);
}

/** A stable, non-identifying handle for a user with no nickname. */
function maskedId(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `#${(h % 100_000_000).toString().padStart(8, "0")}`;
}

function displayName(entry: LeaderboardEntryDto): string {
  return entry.nickname?.trim() || maskedId(entry.userId);
}

const RANK_BADGE = ["bg-[#e8b923] text-black", "bg-[#c9ccd1] text-black", "bg-[#cd7f32] text-black"];

function signedMoney(minor: number, currency: string): string {
  return `${minor >= 0 ? "+" : "−"}${formatMoney(Math.abs(minor), currency)}`;
}

function Row({ rank, entry, highlight }: { rank: number; entry: LeaderboardEntryDto; highlight?: boolean }) {
  const badge = RANK_BADGE[rank - 1] ?? "bg-tile text-ink-2";
  return (
    <li
      className={`grid grid-cols-[34px_28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-rule px-3.5 py-3 ${
        highlight ? "bg-brand/10" : ""
      }`}
    >
      <span className={`grid size-[26px] place-items-center justify-self-center rounded-full text-xs font-black ${badge}`}>
        {rank}
      </span>
      <span aria-hidden className="justify-self-center text-lg leading-none">
        {flag(entry.country)}
      </span>
      <span className="truncate font-semibold">{displayName(entry)}</span>
      <span className={`justify-self-end font-bold tabular-nums ${entry.pnlMinor >= 0 ? "text-up" : "text-down"}`}>
        {signedMoney(entry.pnlMinor, entry.currency)}
      </span>
    </li>
  );
}

export function LeaderboardView({ result }: { result: LeaderboardResultDto }) {
  const { entries, you } = result;
  return (
    <section aria-label="Daily standings" className="grid gap-4">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 rounded border border-rule bg-panel px-3.5 py-3">
        <div>
          <div className="font-semibold">
            {you.entry ? displayName(you.entry) : "You"}
          </div>
          <div className="text-xs text-ink-2">Your position: {you.rank ?? "—"}</div>
        </div>
        <div className={`font-bold tabular-nums ${(you.entry?.pnlMinor ?? 0) >= 0 ? "text-up" : "text-down"}`}>
          {you.entry ? formatMoney(you.entry.pnlMinor, you.entry.currency) : formatMoney(0, "INR")}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="grid justify-items-center gap-1 rounded border border-rule bg-panel px-4 py-10 text-center">
          <span className="mb-2 grid size-11 place-items-center rounded-full bg-tile text-ink-3">
            <Icon name="cup" className="size-5" />
          </span>
          <p className="text-balance text-base font-semibold">No ranked traders yet today.</p>
          <p className="text-balance text-sm text-ink-2">Settle a live trade to get on the board.</p>
        </div>
      ) : (
        <ol className="m-0 list-none overflow-hidden rounded border border-rule bg-panel">
          {entries.map((entry, i) => (
            <Row key={entry.accountId} rank={i + 1} entry={entry} highlight={entry.userId === you.entry?.userId} />
          ))}
        </ol>
      )}
    </section>
  );
}
