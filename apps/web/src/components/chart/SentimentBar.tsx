export function SentimentBar({ upPct, downPct }: { upPct: number; downPct: number }) {
  return (
    <div
      className="flex w-10 shrink-0 flex-col items-center gap-1 py-1"
      aria-label={`Trader sentiment: ${upPct}% up, ${downPct}% down`}
    >
      <span className="text-[10px] font-bold tabular-nums text-[var(--color-up)]">{upPct}%</span>
      <div className="flex w-2 flex-1 flex-col overflow-hidden rounded-full bg-[var(--color-panel-2)]">
        <div
          className="w-full bg-[var(--color-up)] transition-[flex-grow] duration-500"
          style={{ flexGrow: upPct }}
        />
        <div
          className="w-full bg-[var(--color-down)] transition-[flex-grow] duration-500"
          style={{ flexGrow: downPct }}
        />
      </div>
      <span className="text-[10px] font-bold tabular-nums text-[var(--color-down)]">{downPct}%</span>
    </div>
  );
}
