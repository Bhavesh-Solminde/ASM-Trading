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

it.each([
  ["XAUUSD", "0 0 512 512", "#b68e46"],
  ["EURUSD", "0 0 32 32", "#003399"],
])("fills the countdown ring with the primary badge for %s", (symbol, viewBox, fill) => {
  const html = renderToStaticMarkup(createElement(PositionStrip, {
    trades: [{ ...base, symbol, mode: "OTC_FIXED" }], assets: [], currency: "INR", onOpen: () => {},
  }));
  expect(html).toContain("border-chart-tool");
  const layers = html.match(/place-items-center">(<span[^>]+>.*?<\/span>)(<svg width="34" height="34".*?<\/svg>)/);
  expect(layers?.[1]).toContain("size-[26px]");
  expect(layers?.[1]).toContain("overflow-hidden rounded-full");
  expect(layers?.[1]).toContain(`viewBox="${viewBox}"`);
  expect(layers?.[1]).toContain(`fill="${fill}"`);
  expect(layers?.[1]?.match(/<svg /g)).toHaveLength(1);
  expect(layers?.[2]).toMatch(/text-up.*r="14".*stroke-width="3".*stroke-dashoffset="[^"]+"/);
});

it("shows the symbol initials inside the ring when the market has no badge", () => {
  const html = renderToStaticMarkup(createElement(PositionStrip, {
    trades: [{ ...base, symbol: "WTI", direction: "DOWN", mode: "OTC_FIXED" }],
    assets: [], currency: "INR", onOpen: () => {},
  }));
  expect(html).toMatch(/size-\[26px\][^"]*overflow-hidden rounded-full bg-panel[^"]*"><span[^>]+>WT<\/span><\/span><svg[^>]*text-down/);
});
