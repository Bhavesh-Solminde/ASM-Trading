import { expect, it } from "vitest";
import { marketSessionOpen, marketStatus } from "./market-session";
it("keeps crypto open at weekends",()=>expect(marketSessionOpen("BTCUSDT",new Date("2026-10-24T12:00Z"))).toBe(true));
it.each(["BANKNIFTY","EURUSD","XAUUSD"])("closes %s on Saturday",s=>expect(marketSessionOpen(s,new Date("2026-10-24T12:00Z"))).toBe(false));
it("uses IST index session boundaries",()=>{
 expect(marketSessionOpen("NIFTY50",new Date("2026-10-26T03:44:59Z"))).toBe(false);
 expect(marketSessionOpen("NIFTY50",new Date("2026-10-26T03:45Z"))).toBe(true);
 expect(marketSessionOpen("NIFTY50",new Date("2026-10-26T10:00Z"))).toBe(false);
});
it("uses New York DST for FX weekend boundaries and gold daily break",()=>{
 expect(marketSessionOpen("EURUSD",new Date("2026-10-25T20:59Z"))).toBe(false);
 expect(marketSessionOpen("EURUSD",new Date("2026-10-25T21:00Z"))).toBe(true);
 expect(marketSessionOpen("EURUSD",new Date("2026-11-08T21:59Z"))).toBe(false);
 expect(marketSessionOpen("EURUSD",new Date("2026-11-08T22:00Z"))).toBe(true);
 expect(marketSessionOpen("XAUUSD",new Date("2026-10-26T21:30Z"))).toBe(false);
});
it("fails closed on absent/stale/future quotes including holidays",()=>{
 const now=Date.parse("2026-10-26T05:00Z");
 expect(marketStatus("NIFTY50",undefined,now)).toBe("unavailable");
 expect(marketStatus("NIFTY50",now/1000-4,now)).toBe("unavailable");
 expect(marketStatus("NIFTY50",now/1000+10,now)).toBe("unavailable");
 expect(marketStatus("NIFTY50",now/1000-1,now)).toBe("open");
});
