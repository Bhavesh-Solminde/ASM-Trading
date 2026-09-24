"use client";

import { useEffect, useState } from "react";

type Candle = { open: number; high: number; low: number; close: number };

/** Fixed sample used for the SSR pass so hydration matches; client swaps it via useEffect. */
const deterministicCandles: Candle[] = (() => {
  const seeded = [
    1.0938, 1.0942, 1.0937, 1.094, 1.0946, 1.0951, 1.0948, 1.0944, 1.0947,
    1.0953, 1.0958, 1.0955, 1.0949, 1.0943, 1.0946, 1.0951, 1.0956, 1.096,
    1.0964, 1.0961, 1.0958, 1.0954, 1.0951, 1.0956, 1.096, 1.0965,
  ];
  return seeded.slice(0, -1).map((open, i) => {
    const close = seeded[i + 1]!;
    return { open, close, high: Math.max(open, close) + 0.0003, low: Math.min(open, close) - 0.0003 };
  });
})();

/** A tight, self-contained mock of the trade screen inside a phone bezel.
 *  Draws a mini candle series client-side; respects prefers-reduced-motion. */
export function HeroDevice({ tone = "quiet" }: { tone?: "quiet" | "bold" }) {
  const [candles, setCandles] = useState<Candle[]>(deterministicCandles);
  const [seconds, setSeconds] = useState(87);

  useEffect(() => {
    setCandles(seedCandles());
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const tickId = setInterval(() => setSeconds((s) => (s <= 1 ? 87 : s - 1)), 1000);
    const priceId = setInterval(() => setCandles((c) => stepCandles(c)), 1200);
    return () => {
      clearInterval(tickId);
      clearInterval(priceId);
    };
  }, []);

  const last = candles[candles.length - 1]!;
  const price = last.close;
  const first = candles[0]!.open;
  const up = price >= first;

  const bezelBorder =
    tone === "bold"
      ? "border-[color:color-mix(in_srgb,var(--color-brand)_30%,var(--color-rule))]"
      : "border-rule";
  const bezelGlow =
    tone === "bold"
      ? "shadow-[0_40px_80px_-30px_color-mix(in_srgb,var(--color-brand)_30%,transparent),0_0_0_1px_color-mix(in_srgb,var(--color-brand)_18%,transparent)_inset]"
      : "shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]";

  return (
    <div className={`relative mx-auto aspect-[9/19] w-[280px] rounded-[38px] border ${bezelBorder} bg-black p-2 ${bezelGlow}`}>
      {/* screen */}
      <div className="relative h-full w-full overflow-hidden rounded-[30px] bg-ground">
        {/* status bar */}
        <div className="flex h-6 items-center justify-between px-4 pt-1.5 text-[10px] font-semibold text-ink-2">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-up" /> Live
          </span>
        </div>

        {/* top bar */}
        <div className="flex items-center justify-between border-b border-rule px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-brand text-[8px] font-bold text-brand-ink">N</span>
            <span className="text-[11px] font-bold tracking-tight">NIFTY 50</span>
            <span className="text-[9px] font-bold text-brand">93%</span>
          </div>
          <span className="text-[10px] font-semibold text-ink-2">$10,000.00</span>
        </div>

        {/* chart */}
        <div className="chartbox-bg relative h-[220px] w-full">
          <MiniChart candles={candles} tone={tone} />
          <div className="pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-between py-2 pr-1.5 text-[8px] tabular-nums text-ink-3">
            <span>1.0952</span>
            <span>1.0938</span>
            <span>1.0924</span>
          </div>
          {/* current price pill */}
          <div
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold text-ink"
            style={{ background: up ? "var(--color-up)" : "var(--color-down)", color: up ? "var(--color-up-ink)" : "var(--color-down-ink)" }}
          >
            {price.toFixed(5)}
          </div>
        </div>

        {/* time + investment */}
        <div className="grid grid-cols-2 gap-2 border-t border-rule p-3">
          <div>
            <p className="legend text-[8px]">Time</p>
            <p className="led text-[15px] font-bold">
              00:{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
            </p>
          </div>
          <div>
            <p className="legend text-[8px]">Investment</p>
            <p className="led text-[15px] font-bold">$10</p>
          </div>
        </div>

        {/* payout */}
        <div className="mx-3 flex items-center justify-between rounded border border-rule bg-panel px-2 py-1.5">
          <span className="text-[9px] font-semibold text-ink-2">PAYOUT</span>
          <span className="text-[11px] font-bold text-brand">$19.30</span>
        </div>

        {/* up/down */}
        <div className="absolute bottom-3 left-3 right-3 grid grid-cols-2 gap-2">
          <button
            className="grid h-11 place-items-center rounded-lg text-sm font-bold"
            style={{ background: "var(--color-up)", color: "var(--color-up-ink)" }}
          >
            UP ↑
          </button>
          <button
            className="grid h-11 place-items-center rounded-lg text-sm font-bold"
            style={{ background: "var(--color-down)", color: "var(--color-down-ink)" }}
          >
            DOWN ↓
          </button>
        </div>
      </div>

      {/* notch */}
      <div className="pointer-events-none absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />
    </div>
  );
}

function seedCandles(): Candle[] {
  let p = 1.0938;
  return Array.from({ length: 26 }, () => {
    const open = p;
    const delta = (Math.random() - 0.5) * 0.0012;
    const close = Math.max(0, open + delta);
    const high = Math.max(open, close) + Math.random() * 0.0006;
    const low = Math.min(open, close) - Math.random() * 0.0006;
    p = close;
    return { open, high, low, close };
  });
}

function stepCandles(prev: Candle[]): Candle[] {
  const last = prev[prev.length - 1]!;
  const open = last.close;
  const delta = (Math.random() - 0.5) * 0.0014;
  const close = Math.max(0, open + delta);
  const high = Math.max(open, close) + Math.random() * 0.0006;
  const low = Math.min(open, close) - Math.random() * 0.0006;
  return [...prev.slice(1), { open, high, low, close }];
}

function MiniChart({ candles, tone }: { candles: Candle[]; tone: "quiet" | "bold" }) {
  const w = 260;
  const h = 220;
  const paddingX = 12;
  const paddingY = 16;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = max - min || 1;
  const colW = (w - paddingX * 2) / candles.length;
  const yFor = (v: number) => paddingY + ((max - v) / range) * (h - paddingY * 2);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full">
      {tone === "bold" && (
        <defs>
          <radialGradient id="chartGlow" cx="50%" cy="60%" r="60%">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </radialGradient>
        </defs>
      )}
      {tone === "bold" && <rect x="0" y="0" width={w} height={h} fill="url(#chartGlow)" />}

      {candles.map((c, i) => {
        const cx = paddingX + colW * (i + 0.5);
        const isUp = c.close >= c.open;
        const color = isUp ? "var(--color-up)" : "var(--color-down)";
        const bodyTop = yFor(Math.max(c.open, c.close));
        const bodyBot = yFor(Math.min(c.open, c.close));
        const wickTop = yFor(c.high);
        const wickBot = yFor(c.low);
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={wickTop} y2={wickBot} stroke={color} strokeWidth={1} />
            <rect
              x={cx - colW * 0.32}
              y={bodyTop}
              width={colW * 0.64}
              height={Math.max(1, bodyBot - bodyTop)}
              fill={color}
            />
          </g>
        );
      })}
    </svg>
  );
}
