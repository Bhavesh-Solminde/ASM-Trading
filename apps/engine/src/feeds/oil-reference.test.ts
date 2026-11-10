import { afterEach, expect, it, vi } from "vitest";
import { createOilReferenceFeed } from "./oil-reference";
afterEach(()=>vi.unstubAllGlobals());
it("keeps the provider's delayed timestamp and stops polling cleanly",async()=>{
 const ts=Math.floor(Date.now()/1000)-600;
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({chart:{result:[{meta:{regularMarketPrice:65.5,regularMarketTime:ts}}]}})}));
 const feed=createOilReferenceFeed({WTI:"CL=F"}),quote=vi.fn();await feed.start(quote);
 await vi.waitFor(()=>expect(quote).toHaveBeenCalledWith({symbol:"WTI",price:65.5,ts}));await feed.stop();
});
it("rejects invalid and future-dated values",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({chart:{result:[{meta:{regularMarketPrice:65.5,regularMarketTime:Math.floor(Date.now()/1000)+600}}]}})}));
 const feed=createOilReferenceFeed({WTI:"CL=F"}),quote=vi.fn();await feed.start(quote);await Promise.resolve();await Promise.resolve();await feed.stop();expect(quote).not.toHaveBeenCalled();
});
