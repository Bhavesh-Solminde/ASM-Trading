import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MarketWorld,MULTI_MARKETS } from "@asm/market-sim";
if(!process.argv[2])throw new Error("Provide a saved real-reference snapshot (no network requests)");
const quotes=JSON.parse(await readFile(process.argv[2],"utf8"));
if(quotes.length!==30||quotes.some(q=>q.kind==="ILLUSTRATIVE"))throw new Error("All 30 recorded reference quotes are required");
const start=Math.max(...quotes.map(q=>q.receivedAt)),rows=[];
for(const seed of [503,731,991]){
  const corrected=new MarketWorld(start,quotes,seed),old=new MarketWorld(start,[],seed);
  for(const q of quotes)old.reference(q);
  const initial=corrected.checkpoint();
  for(let minute=1;minute<=180;minute++){corrected.advance(start+minute*60000);old.advance(start+minute*60000);}
  const state=corrected.checkpoint();
  for(const spec of MULTI_MARKETS){
    const q=quotes.find(q=>q.symbol===spec.symbol),m=state.markets.find(m=>m.profile.symbol===spec.symbol),first=initial.markets.find(m=>m.profile.symbol===spec.symbol),bars=m.candles;
    const expectedInitial=q.price,initialGapPct=(first.candles[0].open/expectedInitial-1)*100;
    const all=bars.map(b=>b.close),maxGapPct=Math.max(...all.map(p=>Math.abs(p/q.price-1)*100));
    const stepReturns=bars.slice(1).map((b,i)=>Math.log(b.close/bars[i].close)),net=Math.abs(stepReturns.reduce((a,b)=>a+b,0)),travel=stepReturns.reduce((a,b)=>a+Math.abs(b),0);
    const row={seed,symbol:spec.symbol,reference:q.price,source:q.source,sampleBars:q.sampleBars,minuteBps:q.minuteBps,placeholder:spec.base,initialGapPct,maxGapPct,
      correctedLast:all.at(-1),oldLast:old.snapshot(spec.symbol).market.lastPrice,directionEfficiency:travel?net/travel:0,candles:bars.length};
    if(Math.abs(initialGapPct)>.5)throw new Error(`Initial history not anchored: ${spec.symbol}`);
    // The test inputs have <=11 bps/min volatility. This wide bound detects
    // the 20–60% placeholder trend without prescribing winning/losing candles.
    if(maxGapPct>8)throw new Error(`Unexpected excursion from frozen reference: ${spec.symbol} ${maxGapPct}%`);
    rows.push(row);
  }
}
const report={recordedAt:new Date().toISOString(),settings:{markets:30,botsPerMarket:200,tickSec:6,seeds:[503,731,991],warmupMinutes:45,runMinutes:180,
  referenceMode:"Recorded real quotes and measured movement calibration, frozen during each run",tobs:0,assertions:"Initial history within 0.5% of fetched price; every retained close within 8% over 3h. Limits detect placeholder drift, not profit/loss targets."},quotes,rows};
await writeFile(resolve("../../docs/verification/otc-reference-path-proof.json"),JSON.stringify(report,null,2));
console.log(`Passed ${rows.length} market/seed runs; maximum gap ${Math.max(...rows.map(r=>r.maxGapPct)).toFixed(3)}%; saved full inputs and comparisons.`);
