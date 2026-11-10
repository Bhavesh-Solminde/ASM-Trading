import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect,it,vi } from "vitest";
import type { TradeView } from "@asm/contracts";
vi.mock("@/components/shell/PlatformProvider",()=>({useQuote:()=>({price:110})}));
vi.mock("@/lib/use-now",()=>({useNowSec:()=>100}));
import { PositionStrip } from "./PositionStrip";
const base:TradeView={id:"t",accountId:"a",symbol:"BTCUSDT",direction:"UP",stake:10000,payoutPct:92,entryPrice:100,entryTs:90,expiryTs:120,durationSec:30,exitPrice:null,status:"OPEN",pnl:0};
it("shows fixed OTC total return and expiry wording on the phone strip",()=>{
  const html=renderToStaticMarkup(createElement(PositionStrip,{trades:[{...base,mode:"OTC_FIXED"}],assets:[],currency:"INR",onOpen:()=>{}}));
  expect(html).toContain("+₹192.00");expect(html).toContain("if price stays here at expiry");expect(html).not.toContain("if it closed now");
});
it("keeps proportional historical CFD display",()=>{
  const html=renderToStaticMarkup(createElement(PositionStrip,{trades:[{...base,mode:"CFD"}],assets:[],currency:"INR",onOpen:()=>{}}));
  expect(html).toContain("+₹10.00");expect(html).toContain("if it closed now");
});
it("uses the OTC opening currency after the account switches currency",()=>{
  const html=renderToStaticMarkup(createElement(PositionStrip,{trades:[{...base,mode:"OTC_FIXED",currency:"INR"}],assets:[],currency:"USD",onOpen:()=>{}}));
  expect(html).toContain("+₹192.00");expect(html).not.toContain("$192.00");
});
