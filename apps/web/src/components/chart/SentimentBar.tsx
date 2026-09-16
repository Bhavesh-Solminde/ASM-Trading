export function SentimentBar({ upPct, downPct }: { upPct: number; downPct: number }) {
  return (
    <div
      className="grid grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center gap-1.5 pb-9"
      aria-label={`Trader sentiment: ${upPct}% up, ${downPct}% down`}
    >
      <span className="text-[11px] font-bold text-up">{upPct}%</span>
      <div className="relative w-1 overflow-hidden rounded-sm bg-down">
        <div
          className="absolute inset-x-0 bottom-0 bg-up transition-[height] duration-[600ms] ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ height: `${upPct}%` }}
        />
      </div>
      <span className="text-[11px] font-bold text-down">{downPct}%</span>
    </div>
  );
}
