import { expect,it } from "vitest";
import { DisplayQuotes } from "./display-quotes";

it("keeps the displayed, rounded price after the market issues a newer quote",()=>{
  const quotes=new DisplayQuotes();
  const shown=quotes.issue("AUDUSD",0.6870644,6,10000)!;
  quotes.issue("AUDUSD",0.68707945,6,11000);
  expect(shown.price).toBe(0.687064);
  expect(quotes.resolve(shown.token,"AUDUSD",11001)).toBe(shown.price);
  expect(quotes.issue("AUDUSD",null,6,11001)).toBeNull();
});

it("rejects fabricated, cross-market, expired and future quotes",()=>{
  const quotes=new DisplayQuotes(),shown=quotes.issue("AUDUSD",0.687064,6,10000)!;
  for(const [token,symbol,time] of [
    ["unknown","AUDUSD",10001],[shown.token,"EURUSD",10001],
    [shown.token,"AUDUSD",15001],[shown.token,"AUDUSD",9999],
  ] as const) expect(()=>quotes.resolve(token,symbol,time)).toThrow("display_quote_expired");
  expect(()=>new DisplayQuotes().resolve(shown.token,"AUDUSD",10001)).toThrow("display_quote_expired");
});

it("bounds retained quote IDs and reuses a current unchanged price",()=>{
  const quotes=new DisplayQuotes(),first=quotes.issue("BTCUSDT",100,2,10000)!;
  expect(quotes.issue("BTCUSDT",100,2,10001)).toBe(first);
  for(let i=0;i<4100;i++)quotes.issue("BTCUSDT",101+i,2,10002);
  expect(()=>quotes.resolve(first.token,"BTCUSDT",10003)).toThrow("display_quote_expired");
});
