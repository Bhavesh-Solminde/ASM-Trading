// @vitest-environment jsdom
import { createElement as h } from "react";
import { act,cleanup,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import type { OtcMarketMessage } from "@asm/contracts";
import { MarketStore } from "@/components/shell/market-store";
import { useDisplayedPrice } from "./use-displayed-price";

afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it("captures the DOM price at the click, even with a newer market packet awaiting render",()=>{
  const frames:FrameRequestCallback[]=[];
  vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>{frames.push(fn);return frames.length;});
  const market=new MarketStore("AUDUSD","1m",[]);
  const packet=(price:number,token:string,sequence:number):OtcMarketMessage=>({
    type:"otc:market",symbol:"AUDUSD",timeframe:"1m",generation:"worker",sequence,time:1800000001000,
    reset:true,retainedFrom:1800000000,candles:[{openTs:1800000000,o:price,h:price,l:price,c:price}],
    reference:null,depth:{bids:[],asks:[]},tape:[],phase:"Bots only",activeTobs:0,
    displayQuote:{price:Number(price.toFixed(6)),token,expiresAt:1800000006000},
  });
  function Price(){const price=useDisplayedPrice(market,"AUDUSD",6);return h("span",{"data-testid":"price"},price?.toFixed(6));}
  market.apply(packet(.6870644,"shown",1));
  render(h(Price));
  expect(screen.getByTestId("price").textContent).toBe("0.687064");
  market.apply(packet(.68707945,"future",2));
  expect(screen.getByTestId("price").textContent).toBe("0.687064");
  expect(market.getDisplayedQuote("AUDUSD")).toMatchObject({price:.687064,token:"shown"});
  act(()=>{frames.splice(0).forEach(fn=>fn(0));});
  expect(screen.getByTestId("price").textContent).toBe("0.687079");
  expect(market.getDisplayedQuote("AUDUSD")).toMatchObject({price:.687079,token:"future"});
  market.selectSymbol("EURUSD");
  expect(market.getDisplayedQuote("AUDUSD")).toBeNull();
});
