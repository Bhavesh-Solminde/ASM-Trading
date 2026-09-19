"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

/** A continuous live candlestick series — the page's signature motion element.
 *  New candles arrive on the right every 1.2s and the whole series slides left
 *  by exactly one column, keeping a fixed 60-candle window. Respects
 *  prefers-reduced-motion (stops animating; still renders a still frame). */
export function LiveCandleBand() {
  const trackRef = useRef<SVGGElement | null>(null);
  const [candles, setCandles] = useState<Candle[]>(seedCandles);
  const [priceLabel, setPriceLabel] = useState<{ value: number; up: boolean }>({
    value: candles[candles.length - 1]!.close,
    up: true,
  });

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => {
      setCandles((prev) => {
        const next = stepCandles(prev);
        const last = next[next.length - 1]!;
        setPriceLabel({ value: last.close, up: last.close >= last.open });
        return next;
      });
      // Slide the whole track by one column-width to keep the newest candle
      // pinned on the right; then snap back to 0 when the state resets the DOM.
      if (trackRef.current) {
        gsap.fromTo(
          trackRef.current,
          { x: 0 },
          { x: -COL_W, duration: 1.2, ease: "none", onComplete: () => gsap.set(trackRef.current, { x: 0 }) },
        );
      }
    }, 1200);
    return () => clearInterval(id);
  }, []);

  const chart = (
    <>
      {/* Session strip label — top-left, anchors the widget as data. */}
      <div className="pointer-events-none absolute left-4 top-3 z-20 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-2 md:left-5 md:top-4 md:text-[11px]">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-up" />
        Live · AUD/NZD OTC · 1m
      </div>
      {/* Right-side price readout, tracks the newest candle. */}
      <div className="pointer-events-none absolute right-4 top-3 z-20 flex items-center gap-2 md:right-5 md:top-4">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2 md:text-[11px]">Last</span>
        <span
          className="led text-[13px] font-bold md:text-[15px]"
          style={{ color: priceLabel.up ? "var(--color-up)" : "var(--color-down)" }}
        >
          {priceLabel.value.toFixed(5)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="none"
        className="block h-24 w-full md:h-full"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={VIEWBOX_W}
            y1={VIEWBOX_H * f}
            y2={VIEWBOX_H * f}
            stroke="var(--color-rule)"
            strokeWidth={0.4}
            strokeDasharray="2 4"
          />
        ))}
        <g ref={trackRef}>
          {candles.map((c, i) => (
            <CandleBar key={i} c={c} i={i} candles={candles} />
          ))}
        </g>
      </svg>
    </>
  );

  return (
    <>
      {/* MOBILE: edge-to-edge horizontal band. Reads as a thin market strip. */}
      <div className="relative w-full overflow-hidden border-y border-rule bg-panel/60 md:hidden">
        {chart}
      </div>

      {/* DESKTOP: centered widget with a proper chart aspect + editorial side column. */}
      <div className="mx-auto hidden max-w-5xl gap-6 px-6 py-16 md:grid md:grid-cols-[minmax(0,1fr)_220px] md:items-stretch">
        <div className="relative h-[320px] overflow-hidden rounded-2xl border border-rule bg-panel/70 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.7)]">
          {chart}
        </div>
        <SessionSidebar priceLabel={priceLabel} />
      </div>
    </>
  );
}

function SessionSidebar({ priceLabel }: { priceLabel: { value: number; up: boolean } }) {
  return (
    <aside className="flex flex-col gap-3 rounded-2xl border border-rule bg-panel/50 p-5">
      <p className="text-[11px] font-bold uppercase tracking-widest text-ink-2">Session</p>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-ink-3">Last</span>
        <span
          className="led text-lg font-bold"
          style={{ color: priceLabel.up ? "var(--color-up)" : "var(--color-down)" }}
        >
          {priceLabel.value.toFixed(5)}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-ink-3">Payout</span>
        <span className="led text-lg font-bold text-brand">93%</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-ink-3">Expiry</span>
        <span className="led text-lg font-bold text-ink">00:60</span>
      </div>
      <hr className="border-rule" />
      <p className="text-[11px] font-bold uppercase tracking-widest text-ink-2">Recent</p>
      <ul className="flex flex-col gap-2 text-[12px] text-ink-2">
        <li className="flex justify-between">
          <span><span className="text-up">↑</span> 15s · $10</span>
          <span className="text-up tabular-nums">+$9.30</span>
        </li>
        <li className="flex justify-between">
          <span><span className="text-down">↓</span> 30s · $25</span>
          <span className="text-down tabular-nums">−$25.00</span>
        </li>
        <li className="flex justify-between">
          <span><span className="text-up">↑</span> 60s · $50</span>
          <span className="text-up tabular-nums">+$46.50</span>
        </li>
      </ul>
    </aside>
  );
}

const VIEWBOX_W = 1200;
const VIEWBOX_H = 120;
const COUNT = 60;
const COL_W = VIEWBOX_W / COUNT;
const PAD_Y = 8;

type Candle = { open: number; high: number; low: number; close: number };

function CandleBar({ c, i, candles }: { c: Candle; i: number; candles: Candle[] }) {
  const highs = candles.map((k) => k.high);
  const lows = candles.map((k) => k.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = max - min || 1;
  const y = (v: number) => PAD_Y + ((max - v) / range) * (VIEWBOX_H - PAD_Y * 2);
  const cx = COL_W * (i + 0.5);
  const up = c.close >= c.open;
  const color = up ? "var(--color-up)" : "var(--color-down)";
  const bodyTop = y(Math.max(c.open, c.close));
  const bodyBot = y(Math.min(c.open, c.close));
  return (
    <g>
      <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={0.8} />
      <rect
        x={cx - COL_W * 0.32}
        y={bodyTop}
        width={COL_W * 0.64}
        height={Math.max(1, bodyBot - bodyTop)}
        fill={color}
      />
    </g>
  );
}

/** Deterministic random walk — same output on SSR and first client render, so
 *  hydration stays byte-for-byte identical. mulberry32 seeded with a fixed
 *  constant, then the useEffect starts the real Math.random walk on top. */
function seedCandles(): Candle[] {
  const rand = mulberry32(0x9e3779b9);
  const out: Candle[] = [];
  let price = 1.0938;
  for (let i = 0; i < COUNT; i++) {
    const open = price;
    const delta = (rand() - 0.5) * 0.0016;
    const close = open + delta;
    const high = Math.max(open, close) + rand() * 0.0006;
    const low = Math.min(open, close) - rand() * 0.0006;
    out.push({ open, close, high, low });
    price = close;
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stepCandles(prev: Candle[]): Candle[] {
  const last = prev[prev.length - 1]!;
  const open = last.close;
  const delta = (Math.random() - 0.5) * 0.0015;
  const close = Math.max(0, open + delta);
  const high = Math.max(open, close) + Math.random() * 0.0006;
  const low = Math.min(open, close) - Math.random() * 0.0006;
  return [...prev.slice(1), { open, high, low, close }];
}
