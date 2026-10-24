"use client";

import { useState } from "react";
import styles from "@/app/start/start.module.css";

const markets = [
  { category: "Forex", symbol: "EUR / USD", name: "Euro / US Dollar", mark: "€", others: ["GBP / USD", "USD / JPY"], points: [182,173,188,163,150,159,143,119,133,141,114,100,115,89,72,85,67,78,55,69,48,64,46,58] },
  { category: "Crypto", symbol: "BTC / USDT", name: "Bitcoin / Tether", mark: "₿", others: ["ETH / USDT", "SOL / USDT"], points: [145,120,136,105,125,151,166,148,131,152,122,94,110,85,103,119,93,70,88,63,80,59,72,54] },
  { category: "India indices", symbol: "NIFTY 50", name: "India market index", mark: "N", others: ["BANK NIFTY", "SENSEX"], points: [180,163,170,151,138,150,130,144,122,112,127,140,116,103,119,97,83,101,90,73,87,69,78,59] },
] as const;

export function MarketPreview() {
  const [selected, setSelected] = useState(0);
  const market = markets[selected]!;
  return (
    <div className={styles.visualStage}>
      <div className={styles.stageBackdrop} aria-hidden="true"><span /></div>
      <figure className={styles.preview}>
        <div className={styles.previewBar}>
          <span className={styles.workspaceLabel}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 11V5m4 8V3m4 8V5m4 8V3" stroke="currentColor" strokeWidth="2" /></svg> IndianxTrade <span>/ Workspace</span></span>
          <span className={styles.demoTag}>Demo</span>
        </div>
        <div className={styles.marketTabs} role="group" aria-label="Preview a market">
          {markets.map((item, index) => <button key={item.category} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.category}</button>)}
        </div>
        <div className={styles.marketHeader} aria-live="polite">
          <div className={styles.marketIdentity}><span className={styles.marketIcon} data-market={selected}>{market.mark}</span><div><strong>{market.symbol}</strong><span>{market.name}</span></div></div>
          <span className={styles.interval}>Candles <span>1m</span></span>
        </div>
        <div className={styles.chartWrap}>
          <div className={styles.chartTools} aria-hidden="true"><span>⌖</span><span>╱</span><span>≋</span><span>＋</span></div>
          <svg key={selected} viewBox="0 0 510 260" className={styles.chart} role="img" aria-label={`Illustrative ${market.symbol} candlestick chart. Not live market data.`}>
            {[40,90,140,190,240].map(y => <line key={y} x1="0" x2="510" y1={y} y2={y} stroke="#263247" strokeWidth=".7" />)}
            {[60,160,260,360,460].map(x => <line key={x} x1={x} x2={x} y1="10" y2="250" stroke="#263247" strokeWidth=".7" />)}
            {market.points.map((close, index) => {
              const open = market.points[Math.max(index - 1, 0)]! + (index === 0 ? 12 : 0);
              const x = 16 + index * 20;
              const color = close < open ? "#61c7b0" : "#dd8b91";
              return <g key={index} fill={color} stroke={color}>
                <line x1={x} x2={x} y1={Math.min(open, close) - 8 - index % 5} y2={Math.max(open, close) + 9} />
                <rect x={x - 4} y={Math.min(open, close)} width="8" height={Math.max(Math.abs(open - close), 3)} rx="1" stroke="none" />
                <rect x={x - 5} y={240 - (index * 7 % 28)} width="10" height={20 + index * 7 % 28} opacity=".16" stroke="none" />
              </g>;
            })}
            <path d="M0 202 C60 209 70 160 130 169 S210 118 270 139 S390 90 505 84" fill="none" stroke="#629afa" strokeWidth="1.5" opacity=".7" />
          </svg>
        </div>
        <div className={styles.chartLabels}><span>09:00</span><span>09:15</span><span>09:30</span><span>09:45</span></div>
        <div className={styles.watchlist}><span>Also explore</span>{market.others.map(name => <span key={name}>{name}<span aria-hidden="true">↗</span></span>)}</div>
        <figcaption>Interactive illustration · No live prices or trade recommendations</figcaption>
      </figure>
      <div className={styles.practiceCard}>
        <span className={styles.practiceIcon} aria-hidden="true"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3 4 7v5c0 4.5 8 9 8 9s8-4.5 8-9V7l-8-4Z" /><path d="m8 12 3 3 5-6" /></svg></span>
        <div><span>Your first move</span><strong>Practice. Then progress.</strong><p>Explore with virtual funds.</p></div>
      </div>
      <p className={styles.previewHint}><span aria-hidden="true">↖</span> Choose a market. Get a feel for the workspace.</p>
    </div>
  );
}
