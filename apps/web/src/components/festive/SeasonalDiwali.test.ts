// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({path:"/trade",reduced:false,stop:vi.fn(),played:vi.fn()}));
vi.mock("next/navigation",()=>({usePathname:()=>state.path}));
vi.mock("next/dynamic",()=>({default:()=>()=>h("div",null,"Video greeting")}));
vi.mock("@/lib/festive-sound",()=>({prepareFireworkSound:async()=>true,playFireworkSound:()=>{state.played();return state.stop;}}));
import { SeasonalDiwali, DiwaliEntry, WinDiwaliFireworks } from "./SeasonalDiwali";
import { celebrateFestivalSettlement } from "@/lib/festive-settlement";
import { setMuted } from "@/lib/sound";
import { DIWALI_END } from "@/lib/diwali";
const win={id:"",status:"WON",pnl:100};let counter=0;
function fixture(id:string) { return h(SeasonalDiwali,null,h(DiwaliEntry),h(WinDiwaliFireworks,{tradeId:id})); }
beforeEach(()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T13:00:00+05:30"));state.path="/trade";state.reduced=false;vi.clearAllMocks();localStorage.clear();sessionStorage.clear();
  vi.stubGlobal("matchMedia",()=>({matches:state.reduced,addEventListener(){},removeEventListener(){}}));
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
function nextWin(){return {...win,id:`test-win-${++counter}`};}
describe("seasonal controller",()=>{
  it("decorates eligible routes and opens the approved video",()=>{
    render(fixture("none"));fireEvent.click(screen.getByRole("button",{name:"Play Diwali greeting"}));expect(screen.getByText("Video greeting")).toBeTruthy();
  });
  it.each(["/deposit","/withdrawal","/account/verify","/admin","/login"])("stays inactive on %s",path=>{
    state.path=path;render(fixture("none"));expect(screen.queryByRole("button",{name:"Play Diwali greeting"})).toBeNull();
  });
  it("decorates a new confirmed win once and keeps duplicate/remount messages quiet",()=>{
    const trade=nextWin();const view=render(fixture(trade.id));
    act(()=>{celebrateFestivalSettlement(trade);});expect(screen.getByText("Happy Diwali")).toBeTruthy();
    act(()=>vi.advanceTimersByTime(2500));expect(screen.queryByText("Happy Diwali")).toBeNull();
    view.unmount();render(fixture(trade.id));act(()=>{celebrateFestivalSettlement(trade);});expect(screen.queryByText("Happy Diwali")).toBeNull();expect(state.played).not.toHaveBeenCalled();
  });
  it("plays the win sound after a user gesture when site sounds are on", async () => {
    const trade=nextWin(); render(fixture(trade.id));
    await act(async()=>{fireEvent.pointerDown(window);});
    act(()=>{expect(celebrateFestivalSettlement(trade)).toBe(true);});
    expect(state.played).toHaveBeenCalledTimes(1);
  });
  it("keeps win fireworks silent when site sounds are muted", async () => {
    localStorage.setItem("asm.sound","off");const trade=nextWin();render(fixture(trade.id));
    await act(async()=>{fireEvent.pointerDown(window);});
    act(()=>{expect(celebrateFestivalSettlement(trade)).toBe(false);});
    expect(screen.getByText("Happy Diwali")).toBeTruthy();expect(state.played).not.toHaveBeenCalled();
  });
  it("stops win sound immediately when site mute changes", async () => {
    const trade=nextWin();render(fixture(trade.id));
    await act(async()=>{fireEvent.pointerDown(window);});
    act(()=>{celebrateFestivalSettlement(trade);});state.stop.mockClear();
    act(()=>{setMuted(true);});expect(state.stop).toHaveBeenCalled();
  });
  it("ignores losses, flat and pending results",()=>{
    const trade=nextWin();render(fixture(trade.id));
    for(const t of [{...trade,status:"LOST",pnl:-100},{...trade,status:"OPEN"},{...trade,status:"CLOSED",pnl:0}])act(()=>{expect(celebrateFestivalSettlement(t)).toBe(false);});
    expect(screen.queryByText("Happy Diwali")).toBeNull();
  });
  it("suppresses a win behind another dialog without replaying it later",()=>{
    const trade=nextWin();render(fixture(trade.id));const modal=document.createElement("dialog");modal.open=true;document.body.append(modal);
    act(()=>{celebrateFestivalSettlement(trade);});modal.remove();act(()=>{celebrateFestivalSettlement(trade);});expect(screen.queryByText("Happy Diwali")).toBeNull();
  });
  it("respects reduced motion",()=>{
    state.reduced=true;const trade=nextWin();render(fixture(trade.id));act(()=>{celebrateFestivalSettlement(trade);});expect(screen.queryByText("Happy Diwali")).toBeNull();
  });
  it("expires an already open video",()=>{
    vi.setSystemTime(DIWALI_END-100);render(fixture("none"));fireEvent.click(screen.getByRole("button",{name:"Play Diwali greeting"}));act(()=>vi.advanceTimersByTime(101));expect(screen.queryByText("Video greeting")).toBeNull();expect(screen.queryByRole("button",{name:"Play Diwali greeting"})).toBeNull();
  });
});
