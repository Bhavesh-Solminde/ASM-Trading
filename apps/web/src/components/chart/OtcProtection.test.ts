// @vitest-environment jsdom
import { createElement as h,useState } from "react";
import { act,cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import { OtcProtection } from "./OtcProtection";
import { EMPTY_OTC_PROTECTION,protectionError,type OtcProtectionDraft } from "./otc-protection";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("keeps Buy/Sell protection on the correct side and never requires typed prices",()=>{
  const draft={enabled:true,direction:"UP" as const,stopLoss:95,takeProfit:105};
  expect(protectionError(draft,"UP",100)).toBeNull();expect(protectionError(draft,"DOWN",100)).toMatch(/direction/);
  expect(protectionError(draft,"UP",106)).toMatch(/moved/);
  expect(protectionError({...draft,direction:"DOWN",stopLoss:105,takeProfit:95},"DOWN",100)).toBeNull();
  expect(protectionError(EMPTY_OTC_PROTECTION,"UP",null)).toBeNull();
});
it("initializes chart lines, drags a snapped level and restores navigation after release",async()=>{
  let frame=0;const frames=new Map<number,FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>{frames.set(++frame,fn);return frame;});
  vi.stubGlobal("cancelAnimationFrame",(id:number)=>frames.delete(id));
  vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
  vi.stubGlobal("PointerEvent",MouseEvent);
  let draft:OtcProtectionDraft={...EMPTY_OTC_PROTECTION,enabled:true};
  const nativeLines:any[]=[],scale={width:()=>60,options:()=>({autoScale:true}),applyOptions:vi.fn()};
  const series={coordinateToPrice:(y:number)=>200-y/2,priceToCoordinate:(p:number)=>(200-p)*2,
    createPriceLine:vi.fn(options=>{const line={options,applyOptions:vi.fn(),};nativeLines.push(line);return line;}),removePriceLine:vi.fn()};
  const time={height:()=>25,subscribeVisibleLogicalRangeChange:vi.fn(),unsubscribeVisibleLogicalRangeChange:vi.fn()};
  const chart={priceScale:()=>scale,timeScale:()=>time,subscribeCrosshairMove:vi.fn(),unsubscribeCrosshairMove:vi.fn()};
  const el=document.createElement("div");Object.defineProperty(el,"clientHeight",{value:400});el.getBoundingClientRect=()=>({top:0} as DOMRect);
  const market={getSnapshot:()=>({chart:{lastPrice:100}}),subscribe:()=>()=>{}};
  function Harness(){const [state,setState]=useState(draft);draft=state;return h(OtcProtection,{draft:state,onChange:setState,seriesRef:{current:series} as any,chartRef:{current:chart} as any,containerRef:{current:el},market:market as any,chartVersion:1,precision:2,tickSize:.01});}
  async function flush(){await act(async()=>{for(let i=0;i<4;i++){const pending=[...frames];frames.clear();for(const [,fn] of pending)fn(0);}});}
  render(h(Harness));await flush();await flush();
  expect(draft.stopLoss).toBeLessThan(100);expect(draft.takeProfit).toBeGreaterThan(100);
  const sl=screen.getByRole("slider",{name:"Drag stop loss"});
  sl.setPointerCapture=vi.fn();sl.hasPointerCapture=()=>true;sl.releasePointerCapture=vi.fn();
  await act(async()=>fireEvent.pointerDown(sl,{button:0,clientY:210,pointerId:1}));
  await act(async()=>fireEvent.pointerMove(sl,{clientY:220,pointerId:1}));
  expect(draft.stopLoss).toBe(90);
  await act(async()=>fireEvent.pointerUp(sl,{pointerId:1}));
  expect(scale.applyOptions).toHaveBeenLastCalledWith({autoScale:true});
  expect(series.createPriceLine).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(sl,{key:"ArrowUp",shiftKey:true});expect(draft.stopLoss).toBe(90.1);
  expect(screen.queryByRole("spinbutton")).toBeNull();
});
