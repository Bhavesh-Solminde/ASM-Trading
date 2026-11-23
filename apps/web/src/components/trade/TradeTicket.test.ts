// @vitest-environment jsdom
import { createElement as h } from "react";
import { act,cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
const placeholders=vi.hoisted(()=>[] as {id:string;pending?:boolean;entryPrice:number}[]);
// Behaves like the provider with its socket down: the order goes to POST /api/trades.
vi.mock("@/components/shell/PlatformProvider",()=>({usePlatform:()=>({balances:{demo:{realBalance:10000000,bonusBalance:0}},accounts:[{id:"demo",type:"DEMO"}],
  placeOtcTrade:async(order:object,placeholder:{id:string;pending?:boolean;entryPrice:number})=>{placeholders.push(placeholder);
    const res=await fetch("/api/trades",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(order)}),data=await res.json();
    return res.ok?{ok:true,result:data,viaSocket:false}:{ok:false,status:res.status,error:data.error};}})}));
vi.mock("@/lib/use-now",()=>({useNowSec:()=>100,useMarketClosed:()=>false}));
vi.mock("./StakeSheet",()=>({StakeSheet:()=>null}));
import { TradeTicket } from "./TradeTicket";
afterEach(()=>{placeholders.length=0;cleanup();localStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});
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
  // Each press shows "Opening…" at once, at the displayed price, keyed by the request.
  expect(placeholders.slice(-2)).toEqual([0,1].map(()=>expect.objectContaining({id:`pending:${first.idempotencyKey}`,pending:true,entryPrice:100})));
});
it("remembers the inline SL / TP tick and opens an OTC trade without stops", async () => {
  localStorage.setItem("asm_chart_protection", "on");
  const post = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({
    trade: { id: "new-trade", mode: "OTC_FIXED" }, balances: { realBalance: 9990000, bonusBalance: 0 },
  }) });
  vi.stubGlobal("fetch", post);
  const props = { otc: true, symbol: "BTCUSDT", pair: "BTC/USDT", accountId: "demo", currency: "INR", payoutPct: 92, onOpened: vi.fn(),
    market: { getDisplayedQuote: () => ({ price: 100, token: "displayed-quote" }) } as any };
  const view = render(h(TradeTicket, props));
  const tick = screen.getByRole<HTMLInputElement>("checkbox", { name: "SL / TP" });
  expect(tick.checked).toBe(false);
  expect(screen.getByText("Investment", { selector: "label" }).parentElement?.contains(tick)).toBe(true);
  fireEvent.click(tick);
  expect(localStorage.getItem("asm_otc_sltp")).toBe("on");
  expect(screen.queryByText(/Buy levels|Reset chart levels|SL loses stake/)).toBeNull();
  view.unmount();
  render(h(TradeTicket, props));
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "SL / TP" }).checked).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Sell/i })));
  expect(post).toHaveBeenCalledTimes(1);
  const body = JSON.parse(post.mock.calls[0]![1].body);
  expect(body).toMatchObject({ direction: "DOWN", quoteToken: "displayed-quote" });
  expect(body).not.toHaveProperty("stopLoss");
  expect(body).not.toHaveProperty("takeProfit");
  expect(props.onOpened).toHaveBeenCalledTimes(1);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "SL / TP" }).checked).toBe(true);
});
