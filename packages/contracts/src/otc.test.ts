import { expect,it } from "vitest";
import { OtcOpenTradeSchema,EngineOtcOpenTradeSchema, OtcSetStopsSchema, EngineOtcSetStopsSchema } from "./otc";
const input={symbol:"BTCUSDT",accountId:"1296cdd9-e2c4-48a2-98ce-f0c508b3d5a6",idempotencyKey:"1804d515-243f-46b1-98cc-4af6c71a13a7",quoteToken:"1804d515-243f-46b1-98cc-4af6c71a13a8",direction:"UP",stake:10000,durationSec:60,stopLoss:70000,takeProfit:90000};
it("accepts fixed-payout protection but rejects client authority and prices",()=>{
  expect(OtcOpenTradeSchema.safeParse(input).success).toBe(true);
  for(const extra of [{actorId:input.accountId},{role:"USER"},{accountType:"LIVE"},{payoutPct:92},{entryPrice:80000},{isTob:true}])expect(OtcOpenTradeSchema.safeParse({...input,...extra}).success).toBe(false);
  expect(EngineOtcOpenTradeSchema.safeParse({...input,actorId:input.accountId}).success).toBe(true);
});
it("requires a stable request key and rejects invalid protection values",()=>{
  expect(OtcOpenTradeSchema.safeParse({...input,idempotencyKey:undefined}).success).toBe(false);
  expect(OtcOpenTradeSchema.safeParse({...input,quoteToken:undefined}).success).toBe(false);
  expect(OtcOpenTradeSchema.safeParse({...input,stopLoss:Infinity}).success).toBe(false);
});
it("requires a stable key and both nullable levels for post-trade protection", () => {
  const stops = { requestId: input.idempotencyKey, stopLoss: null, takeProfit: 90000 };
  expect(OtcSetStopsSchema.safeParse(stops).success).toBe(true);
  for (const invalid of [
    { requestId: "bad" }, { stopLoss: undefined }, { takeProfit: undefined }, { stopLoss: 0 },
    { takeProfit: Infinity }, { actorId: input.accountId }, { entryPrice: 80000 },
  ]) {
    expect(OtcSetStopsSchema.safeParse({ ...stops, ...invalid }).success).toBe(false);
  }
  expect(EngineOtcSetStopsSchema.safeParse({ ...stops, actorId: input.accountId }).success).toBe(true);
});
it("accepts trade:open on the engine socket only without client-chosen authority",async()=>{
  const { OtcClientMessageSchema }=await import("./otc");
  expect(OtcClientMessageSchema.safeParse({type:"trade:open",...input}).success).toBe(true);
  for(const extra of [{actorId:input.accountId},{role:"USER"},{entryPrice:80000}])expect(OtcClientMessageSchema.safeParse({type:"trade:open",...input,...extra}).success).toBe(false);
  expect(OtcClientMessageSchema.safeParse({type:"subscribe",symbol:"BTCUSDT",timeframe:"1m"}).success).toBe(true);
});
