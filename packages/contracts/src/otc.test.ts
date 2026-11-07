import { expect,it } from "vitest";
import { OtcOpenTradeSchema,EngineOtcOpenTradeSchema } from "./otc";
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
