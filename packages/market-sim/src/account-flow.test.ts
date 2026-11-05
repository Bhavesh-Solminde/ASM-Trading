import { expect,it } from "vitest";
import { AnchoredMarket } from "./anchored-market";
import { submitAccountFlow } from "./account-flow";
function market(){const m=new AnchoredMarket({symbol:"BTCUSDT",price:80000,tickSize:.01,minuteBps:7,group:"Crypto"},1000,71,0,true);m.advance(601000);return m;}
it.each(["USER","ADMIN","AFFILIATE"] as const)("DEMO %s trades preserve the entire market and future path",role=>{
  const m=market(),baseline=AnchoredMarket.restore(m.checkpoint());
  const result=submitAccountFlow(m,{actorId:"test-user",role,accountType:"DEMO",side:"BUY",stakeInrMinor:10000});
  expect(result.origin).toBe("PAPER");expect(m.checkpoint()).toEqual(baseline.checkpoint());
  m.advance(1201000);baseline.advance(1201000);expect(m.checkpoint()).toEqual(baseline.checkpoint());
});
it("USER LIVE consumes real finite book liquidity and persists the same wallet",()=>{
  const m=market(),before=m.executionAudit().length;
  const result=submitAccountFlow(m,{actorId:"normal-signup",role:"USER",accountType:"LIVE",side:"BUY",stakeInrMinor:10000});
  expect(result.origin).toBe("Tob");expect(result.filledLots).toBeGreaterThan(0);expect(result.entryPrice).toBeGreaterThan(0);
  expect(m.executionAudit().slice(before)).toEqual(result.fills);
  expect(m.snapshot().tobs.activeTobs).toBe(1);expect(m.snapshot().executions[0]!.origin).toBe("Tobs");
  const wallet=m.book.wallet("tobs-user:normal-signup"),resumed=AnchoredMarket.restore(JSON.parse(JSON.stringify(m.checkpoint())));
  expect(resumed.book.wallet(wallet.id)).toEqual(wallet);
  submitAccountFlow(resumed,{actorId:"normal-signup",role:"USER",accountType:"LIVE",side:"SELL",stakeInrMinor:10000});
  expect(resumed.checkpoint().externalIds).toEqual([wallet.id]);
});
it.each(["ADMIN","AFFILIATE"] as const)("LIVE %s is not Tob market flow",role=>{
  const m=market(),before=m.checkpoint();submitAccountFlow(m,{actorId:"other",role,accountType:"LIVE",side:"BUY",stakeInrMinor:10000});
  expect(m.checkpoint()).toEqual(before);
});
