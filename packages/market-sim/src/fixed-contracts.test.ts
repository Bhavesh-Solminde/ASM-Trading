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

const stops = { tradeId: input.id, actorId: input.actorId, stopLoss: null, takeProfit: null };
it.each([
  ["UP", 90, 95, null, "stop_loss_invalid"],
  ["UP", 110, 100, null, "stop_loss_invalid"],
  ["UP", 110, null, 105, "take_profit_invalid"],
  ["UP", 90, null, 100, "take_profit_invalid"],
  ["DOWN", 110, 105, null, "stop_loss_invalid"],
  ["DOWN", 90, 100, null, "stop_loss_invalid"],
  ["DOWN", 90, null, 95, "take_profit_invalid"],
  ["DOWN", 110, null, 100, "take_profit_invalid"],
] as const)("%s rejects stops on the wrong side of either price (%i, %s, %s)", (direction, price, stopLoss, takeProfit, code) => {
  const book = new FixedContracts();
  book.open({ ...input, direction });
  book.observe({ symbol: input.symbol, price, time: 2000, sequence: 11 });
  const before = book.checkpoint();
  expect(() => book.setStops({ ...stops, stopLoss, takeProfit }, 2000)).toThrow(code);
  expect(book.checkpoint()).toEqual(before);
});

it.each(["UP", "DOWN"] as const)("sets and clears levels on an open %s contract and preserves them on restore", (direction) => {
  const book = new FixedContracts();
  const up = direction === "UP";
  const levels = { stopLoss: up ? 90 : 110, takeProfit: up ? 110 : 90 };
  book.open({ ...input, direction });
  const initial = FixedContracts.restore(JSON.parse(JSON.stringify(book.checkpoint())));
  expect(initial.setStops({ ...stops, ...levels }, 2000)).toEqual({ tradeId: input.id, ...levels, stopChanges: 1 });
  const restored = FixedContracts.restore(JSON.parse(JSON.stringify(initial.checkpoint())));
  expect(restored.get(input.id)).toMatchObject({ ...levels, stopChanges: 1 });
  expect(restored.setStops({ ...stops, takeProfit: levels.takeProfit }, 3000)).toMatchObject({ stopLoss: null, takeProfit: levels.takeProfit });
  expect(restored.setStops(stops, 4000)).toMatchObject({ stopLoss: null, takeProfit: null, stopChanges: 3 });
});

it("enforces ownership, expiry, settlement and the persisted 20-change cap", () => {
  const book = new FixedContracts();
  book.open(input);
  expect(() => book.setStops({ ...stops, actorId: "someone-else" }, 2000)).toThrow("not_found");
  expect(() => book.setStops(stops, input.expiryTime)).toThrow("trade_not_open");
  for (let i = 0; i < 19; i++) book.setStops({ ...stops, stopLoss: 90 - i }, 2000);
  const restored = FixedContracts.restore(JSON.parse(JSON.stringify(book.checkpoint())));
  expect(restored.setStops(stops, 2500).stopChanges).toBe(20);
  expect(() => restored.setStops({ ...stops, takeProfit: 102 }, 3000)).toThrow("stops_limit");
  restored.advance(input.expiryTime);
  expect(() => restored.setStops(stops, input.expiryTime)).toThrow("trade_not_open");
});
