import { expect, it } from "vitest";
import { MARKET_COUNT, TRADABLE_MARKETS } from "./markets";
import { marketSessionOpen } from "./market-session";
it("keeps the verified bot catalogue at 30 unique instruments",()=>{
 expect(MARKET_COUNT).toBe(30);expect(new Set(TRADABLE_MARKETS.map(m=>m.symbol)).size).toBe(30);
 expect(TRADABLE_MARKETS.filter(m=>m.assetClass==="CRYPTO")).toHaveLength(10);
 expect(TRADABLE_MARKETS.filter(m=>m.assetClass==="FOREX")).toHaveLength(10);
 expect(TRADABLE_MARKETS.filter(m=>m.assetClass==="INDEX")).toHaveLength(6);
 expect(TRADABLE_MARKETS.filter(m=>m.assetClass==="COMMODITY")).toHaveLength(4);
});
it("recognizes added markets without changing quote freshness rules",()=>{
 for(const symbol of ["ADAUSDT","NZDUSD","XAGUSD","WTI","BRENT"])expect(marketSessionOpen(symbol,new Date("2026-11-10T12:00:00Z"))).toBe(true);
});
