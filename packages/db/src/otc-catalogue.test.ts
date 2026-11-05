import { describe,it,expect } from "vitest";
import { OTC_MARKETS } from "./otc-catalogue";
import { MULTI_MARKETS } from "@asm/market-sim";
describe("website OTC catalogue",()=>{
  it("maps all 30 markets to valid 92-percent asset rows without users",()=>{
    expect(OTC_MARKETS).toHaveLength(30);
    expect(new Set(OTC_MARKETS.map(s=>s.symbol)).size).toBe(30);
    expect(Object.fromEntries(["CRYPTO","FOREX","INDEX","COMMODITY"].map(c=>[c,OTC_MARKETS.filter(m=>m.assetClass===c).length])))
      .toEqual({CRYPTO:10,FOREX:10,INDEX:6,COMMODITY:4});
    for(const row of OTC_MARKETS){expect(row.payoutPct).toBe(92);expect(row.tickSize).toBe(10**-row.precision);expect(row.displayName).toBe(MULTI_MARKETS.find(m=>m.symbol===row.symbol)!.name);}
  });
});
