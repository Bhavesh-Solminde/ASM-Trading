"use client";
import { usePlatform } from "@/components/shell/PlatformProvider";
import { useMarket } from "@/components/shell/market-store";
const format=new Intl.NumberFormat("en-IN",{maximumFractionDigits:6});
export function OtcMarketPanel(){
  const {market}=usePlatform(),data=useMarket(market,s=>s.otc);
  return <details className="rounded border border-rule bg-panel px-3 py-2 text-xs phone:mx-2">
    <summary className="cursor-pointer text-ink-2">Order book & market flow · {data?.phase??"Connecting"} · {data?.openTobs??0} Tobs with open positions</summary>
    <p className="my-2 text-ink-3">Synthetic order-book market · USER + LIVE trades move the book; DEMO is paper only.</p>
    <p className="my-2 text-ink-3">{data?.activeTobs??0} Tobs submitted market flow in the last minute.</p>
    <p className="my-2 text-ink-3">{data?.reference?`${data.reference.source} · ${data.reference.status} · quote ${new Date(data.reference.quoteTime).toLocaleString()}`:"Reference unavailable · using the last simulation anchor"}</p>
    <div className="grid max-h-52 grid-cols-2 gap-4 overflow-auto">
      <div><h3 className="mb-2 font-semibold">Order book · lots</h3>{(["asks","bids"] as const).map(side=><div key={side} className={side==="asks"?"text-down":"text-up"}>
        {Array.from({length:4},(_,i)=>{const level=data?.depth[side][i];return <div key={i} className="flex justify-between tabular-nums"><span>{level?format.format(level.price):"—"}</span><span>{level?.quantity??"—"}</span></div>;})}
      </div>)}</div>
      <div><h3 className="mb-2 font-semibold">Recent executions</h3>{Array.from({length:8},(_,i)=>{const fill=data?.tape[i];return <div key={i} className="flex justify-between gap-2 tabular-nums"><span className={fill?.side==="BUY"?"text-up":"text-down"}>{fill?format.format(fill.price):"—"}</span><span className="text-ink-3">{fill?`${fill.quantity} · ${fill.origin}`:"—"}</span></div>;})}</div>
    </div>
  </details>;
}
export function OtcBotLeaderboard(){
  const {market}=usePlatform(),rows=useMarket(market,s=>s.bots);
  return <div className="overflow-auto rounded border border-rule bg-panel p-4">
    <h2 className="mb-2 text-lg font-semibold">Top 10 market bots</h2>
    <p className="mb-4 text-xs text-ink-3">Ranked by total return. Quote P&L includes inventory at the latest matched price.</p>
    <table className="w-full text-left text-sm tabular-nums"><thead className="text-xs text-ink-3"><tr><th>Rank</th><th>Bot</th><th>Market</th><th>Quote P&L</th><th>Return</th></tr></thead>
      <tbody>{Array.from({length:10},(_,i)=>{const row=rows[i];return <tr key={i} className="border-t border-rule"><td className="py-3">{i+1}</td><td>{row?.id.split(":")[1]??"—"}</td><td>{row?.symbol??"—"}</td><td className={row&&row.pnl<0?"text-down":"text-up"}>{row?format.format(row.pnl):"—"}</td><td>{row?`${row.returnPct.toFixed(4)}%`:"—"}</td></tr>;})}</tbody></table>
  </div>;
}
