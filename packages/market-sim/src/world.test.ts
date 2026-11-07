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

it.each(["UP","DOWN"] as const)("opens %s at the verified displayed price despite a processing delay across candles",direction=>{
  const world=new MarketWorld(start);
  world.advance(start+59000);
  const displayedPrice=Number(world.snapshot("BTCUSDT").market.lastPrice!.toFixed(2));
  world.advance(start+61000);
  const result=world.open({...trade,direction,displayedPrice});
  expect(result.contract.entryPrice).toBe(displayedPrice);
  expect(result.filledLots).toBeGreaterThan(0);
  expect(result.contract.entryTime).toBe(start+61000);
  const resumed=MarketWorld.restore(JSON.parse(JSON.stringify(world.checkpoint())));
  resumed.advance(start+121000);world.advance(start+121000);
  expect(resumed.contracts.get(trade.id)).toEqual(world.contracts.get(trade.id));
  const contract=world.contracts.get(trade.id)!;
  expect(contract.entryPrice).toBe(displayedPrice);
  expect(contract.status).toBe(contract.exitPrice===displayedPrice?"REFUNDED":((direction==="UP")===(contract.exitPrice!>displayedPrice)?"WON":"LOST"));
});
