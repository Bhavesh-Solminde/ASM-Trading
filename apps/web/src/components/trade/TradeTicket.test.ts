// @vitest-environment jsdom
import { createElement as h } from "react";
import { act,cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
vi.mock("@/components/shell/PlatformProvider",()=>({usePlatform:()=>({balances:{demo:{realBalance:10000000,bonusBalance:0}},accounts:[{id:"demo",type:"DEMO"}]})}));
vi.mock("@/lib/use-now",()=>({useNowSec:()=>100,useMarketClosed:()=>false}));
vi.mock("./StakeSheet",()=>({StakeSheet:()=>null}));
import { TradeTicket } from "./TradeTicket";
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});
it("retries an ambiguous OTC request with its original duration and key as clock time changes",async()=>{
  const now=1800000000000,clock=vi.spyOn(Date,"now").mockReturnValue(now);
  localStorage.setItem("asm_ticket_expiry",JSON.stringify({durationSec:300,mode:"time",targetMs:now+300000}));
  const post=vi.fn().mockResolvedValueOnce({ok:false,status:503,json:async()=>({error:"Temporarily unavailable"})})
    .mockResolvedValueOnce({ok:true,status:201,json:async()=>({trade:{id:"original"},balances:{realBalance:9990000,bonusBalance:0}})});
  let quoteToken="original-quote";
  vi.stubGlobal("fetch",post);const onOpened=vi.fn(),props={otc:true,symbol:"BTCUSDT",pair:"BTC/USDT",accountId:"demo",currency:"INR",payoutPct:92,onOpened,
    market:{getDisplayedQuote:()=>({price:100,token:quoteToken})} as any};
  let view:ReturnType<typeof render>;await act(async()=>{view=render(h(TradeTicket,props));});
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/^Buy/i})));
  quoteToken="future-quote";clock.mockReturnValue(now+100000);await act(async()=>view.rerender(h(TradeTicket,props)));
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/^Buy/i})));
  expect(post).toHaveBeenCalledTimes(2);
  const first=JSON.parse(post.mock.calls[0]![1].body),retry=JSON.parse(post.mock.calls[1]![1].body);
  expect(first.durationSec).toBe(300);expect(retry).toEqual(first);expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(first.quoteToken).toBe("original-quote");
  expect(onOpened).toHaveBeenCalledTimes(1);
});
it("submits chart-picked levels and retries the same intent even after price crosses a line",async()=>{
  let price=100;
  const post=vi.fn().mockResolvedValueOnce({ok:false,status:503,json:async()=>({error:"Try again"})})
    .mockResolvedValueOnce({ok:true,status:201,json:async()=>({trade:{id:"protected"},balances:{realBalance:9990000,bonusBalance:0}})});
  vi.stubGlobal("fetch",post);
  const onProtectionChange=vi.fn(),props={otc:true,symbol:"BTCUSDT",pair:"BTC/USDT",accountId:"demo",currency:"INR",payoutPct:92,onOpened:vi.fn(),
    protectionDraft:{enabled:true,direction:"UP" as const,stopLoss:95,takeProfit:105},onProtectionChange,market:{getDisplayedQuote:()=>({price,token:"displayed-quote"})} as any};
  await act(async()=>render(h(TradeTicket,props)));
  expect(screen.queryByLabelText("Stop loss price")).toBeNull();
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/^Sell(?! levels)/i})));
  expect(post).not.toHaveBeenCalled();expect(screen.getByRole("alert").textContent).toMatch(/direction/);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/^Buy(?! levels)/i})));
  price=110;
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:/^Buy(?! levels)/i})));
  const body=JSON.parse(post.mock.calls[0]![1].body);
  expect(body.stopLoss).toBe(95);expect(body.takeProfit).toBe(105);
  expect(JSON.parse(post.mock.calls[1]![1].body)).toEqual(body);
  expect(onProtectionChange).toHaveBeenLastCalledWith(expect.objectContaining({enabled:false}));
});
