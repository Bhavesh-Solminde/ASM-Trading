"use client";

import { useEffect, useState } from "react";
import { marketingAssets, type MarketingAsset } from "./marketing-data";

type TickState = { price: number; flash: "up" | "down" | null };

/** A standalone landing-page ticker: no engine required, drifts each price on a timer. */
export function MarketingTicker({ speedSec = 42 }: { speedSec?: number }) {
  const [state, setState] = useState<Record<string, TickState>>(() =>
    Object.fromEntries(marketingAssets.map((a) => [a.symbol, { price: a.price, flash: null }])),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setState((prev) => {
        const next = { ...prev };
        for (const a of marketingAssets) {
          const cur = prev[a.symbol]!;
          const drift = (Math.random() - 0.5) * cur.price * 0.0004;
          const p = Math.max(0, cur.price + drift);
          next[a.symbol] = { price: p, flash: drift >= 0 ? "up" : "down" };
        }
        return next;
      });
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const half = [...marketingAssets, ...marketingAssets];
  const items = [...half, ...half];

  return (
    <div
      aria-label="Live prices"
      className="ticker relative w-full overflow-hidden border-y border-rule bg-panel/60 backdrop-blur"
    >
      <div
        className="ticker-track flex h-11 w-max items-center"
        style={{ animationDuration: `${speedSec}s` }}
      >
        {items.map((a, i) => (
          <TickerCell key={`${a.symbol}-${i}`} asset={a} tick={state[a.symbol]!} hidden={i >= marketingAssets.length} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-panel to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-panel to-transparent" />
    </div>
  );
}

function TickerCell({ asset, tick, hidden }: { asset: MarketingAsset; tick: TickState; hidden: boolean }) {
  const up = asset.changePct >= 0;
  const color = up ? "var(--color-up)" : "var(--color-down)";
  return (
    <span
      aria-hidden={hidden || undefined}
      className="flex items-center gap-2 whitespace-nowrap border-r border-rule px-5 text-[12px]"
    >
      <span className="font-semibold tracking-[0.02em] text-ink">{asset.name}</span>
      <span
        key={tick.price}
        className={`led rounded-[2px] px-1 py-px text-ink ${tick.flash ? `tick-${tick.flash}` : ""}`}
      >
        {tick.price.toFixed(asset.precision)}
      </span>
      <span aria-hidden className="dir-mark" data-dir={up ? "up" : "down"} style={{ color, width: 8, height: 8 }} />
      <span className="font-semibold" style={{ color }}>
        {up ? "+" : "−"}
        {Math.abs(asset.changePct).toFixed(2)}%
      </span>
      <span className="rounded-[2px] bg-brand/15 px-1.5 py-px text-[10px] font-bold tracking-wider text-brand">
        {asset.payoutPct}%
      </span>
    </span>
  );
}
