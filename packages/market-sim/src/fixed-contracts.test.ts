import { expect,it } from "vitest";
import { FixedContracts } from "./fixed-contracts";
const input={id:"trade-1",accountId:"account-1",actorId:"user-1",symbol:"BTCUSDT",direction:"UP" as const,stake:10000,entryPrice:100,entryTime:1000,expiryTime:61000,entrySequence:10};
it.each(["UP","DOWN"] as const)("pays fixed 92%% on %s TP at the actual printed price",direction=>{
  const c=new FixedContracts(),up=direction==="UP";c.open({...input,direction,stopLoss:up?90:110,takeProfit:up?110:90});
  c.observe({symbol:input.symbol,price:up?112:88,time:2000,sequence:11});
  expect(c.get(input.id)).toMatchObject({status:"WON",reason:"TAKE_PROFIT",credit:19200,pnl:9200,exitPrice:up?112:88});
});
it("settles only the first executed threshold and survives duplicate events and restart",()=>{
  const c=new FixedContracts();c.open({...input,stopLoss:90,takeProfit:110});
  c.observe({symbol:input.symbol,price:89,time:2000,sequence:11});c.observe({symbol:input.symbol,price:112,time:2000,sequence:12});
  const resumed=FixedContracts.restore(JSON.parse(JSON.stringify(c.checkpoint())));
  expect(resumed.pendingSettlements()).toEqual(c.pendingSettlements());expect(resumed.get(input.id)).toMatchObject({status:"LOST",credit:0,pnl:-10000});
  resumed.acknowledge(input.id);expect(resumed.pendingSettlements()).toEqual([]);
});
it("uses the last execution at or before expiry, never the next price",()=>{
  const c=new FixedContracts();c.open(input);c.observe({symbol:input.symbol,price:99,time:60000,sequence:11});c.observe({symbol:input.symbol,price:120,time:62000,sequence:12});
  expect(c.get(input.id)).toMatchObject({status:"LOST",exitPrice:99,settledTime:61000,reason:"DURATION"});
});
it("refunds a tie and tracks several simultaneous independent trades",()=>{
  const c=new FixedContracts();c.open(input);c.open({...input,id:"trade-2",symbol:"EURUSD"});
  c.observe({symbol:input.symbol,price:101,time:61000,sequence:11});c.advance(61000);
  expect(c.get(input.id)).toMatchObject({status:"WON",credit:19200});expect(c.get("trade-2")).toMatchObject({status:"REFUNDED",credit:10000,pnl:0});
});
it("ignores entry fills and rejects invalid protection levels",()=>{
  const c=new FixedContracts();c.open(input);c.observe({symbol:input.symbol,price:1000,time:1000,sequence:10});expect(c.get(input.id)!.lastPrice).toBe(100);
  expect(()=>c.open({...input,id:"bad",stopLoss:101})).toThrow("stop loss");expect(()=>c.open({...input,id:"bad",takeProfit:99})).toThrow("take profit");
  expect(FixedContracts.restore(c.checkpoint()).get(input.id)).toEqual(c.get(input.id));
});
