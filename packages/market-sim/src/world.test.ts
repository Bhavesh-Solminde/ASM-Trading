import { expect,it } from "vitest";
import { MarketWorld,type OpenContractCommand } from "./world";
const start=Date.parse("2026-11-05T10:00:00Z");
const trade:OpenContractCommand={id:"trade-1",actorId:"normal-user",accountId:"live-account",symbol:"BTCUSDT",direction:"UP",stake:10000,stakeInrMinor:10000,role:"USER",accountType:"LIVE",durationSec:60};
it("restores all 30 order books and outstanding contracts exactly",()=>{
  const world=new MarketWorld(start);expect(world.markets.size).toBe(30);world.open(trade);
  world.open({...trade,id:"paper-1",accountType:"DEMO",accountId:"demo-account"});
  const resumed=MarketWorld.restore(JSON.parse(JSON.stringify(world.checkpoint())));
  world.advance(start+120000);resumed.advance(start+120000);
  expect(resumed.checkpoint()).toEqual(world.checkpoint());expect(resumed.leaderboard()).toEqual(world.leaderboard());
  expect(resumed.contracts.pendingSettlements()).toHaveLength(2);expect(resumed.leaderboard()).toHaveLength(10);
});
it("rejects invalid protection before changing wallets or candles",()=>{
  const world=new MarketWorld(start),before=world.checkpoint();
  expect(()=>world.open({...trade,stopLoss:99999999})).toThrow("stop loss");
  expect(world.checkpoint()).toEqual(before);
});
it("opening DEMO positions does not alter any market path",()=>{
  const world=new MarketWorld(start),baseline=new MarketWorld(start);
  for(let i=0;i<10;i++)world.open({...trade,id:`paper-${i}`,accountType:"DEMO"});
  world.advance(start+120000);baseline.advance(start+120000);
  expect(world.checkpoint().markets).toEqual(baseline.checkpoint().markets);
  expect(world.contracts.pendingSettlements()).toHaveLength(10);
});
it("rejects duplicate trade identity before executing another order",()=>{
  const world=new MarketWorld(start);world.open(trade);const before=world.checkpoint();
  expect(()=>world.open(trade)).toThrow("Duplicate");expect(world.checkpoint()).toEqual(before);
});
