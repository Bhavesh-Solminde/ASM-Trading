import { describe,it,expect } from "vitest";
import { mkdtemp,rm,readFile,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnchoredMarket } from "./anchored-market";
import { CheckpointStore } from "./checkpoint-store";

describe("atomic checkpoint file",()=>{
  it("restores a durable world and refuses corrupted bytes",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"asm-checkpoint-"));
    try{
      const path=join(directory,"world.json"),store=new CheckpointStore(path);expect(await store.load()).toBeNull();
      const m=new AnchoredMarket({symbol:"BTCUSDT",price:80000,tickSize:.01,minuteBps:7,group:"Crypto"},1000);m.advance(61000);
      const state={version:1 as const,time:61000,sequence:1,markets:[m.checkpoint()]};await store.save(state);
      expect(await store.load()).toEqual(state);
      // Simulate disk damage, not a valid new save.
      const raw=await readFile(path,"utf8");await writeFile(path,raw.replace("80000","80001"));
      await expect(store.load()).rejects.toThrow("checksum");
    }finally{await rm(directory,{recursive:true});}
  });
});
