import { Worker } from "node:worker_threads";
import type { MarketWorld,OpenContractCommand,ReferenceQuote,SimulationCheckpoint,FixedContract,OpenContractResult } from "@asm/market-sim";
import type { OtcArchiveBatch } from "./archive";

/** The engine host serializes durable commands; the worker performs no IO. */
export class OtcWorker {
  private worker:Worker;
  readonly ready:Promise<void>;
  private dead:Error|null=null;
  private counter=0;
  private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(options:{start:number;references?:ReferenceQuote[];checkpoint?:SimulationCheckpoint}){
    this.worker=new Worker(new URL("./worker-entry.mjs",import.meta.url),{workerData:options});
    this.ready=new Promise((resolve,reject)=>{
      const fail=(error:Error)=>{this.dead=error;reject(error);for(const r of this.pending.values()){clearTimeout(r.timer);r.reject(error);}this.pending.clear();};
      this.worker.on("message",(m:{ready?:boolean;id:number;result:unknown;error?:string})=>{
        if(m.ready){resolve();return;}const r=this.pending.get(m.id);if(!r)return;
        clearTimeout(r.timer);this.pending.delete(m.id);if(m.error)r.reject(new Error(m.error));else r.resolve(m.result);
      });
      this.worker.on("error",fail);this.worker.on("exit",code=>fail(new Error(`OTC worker exited (${code})`)));
    });
  }
  private async request<T>(type:string,payload?:unknown):Promise<T>{
    await this.ready;if(this.dead)throw this.dead;if(this.pending.size>=256)throw new Error("OTC worker request queue is full");
    return new Promise<T>((resolve,reject)=>{
      const id=++this.counter,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error("OTC worker request timed out; outcome requires reconciliation"));},60000);
      this.pending.set(id,{resolve:value=>resolve(value as T),reject,timer});this.worker.postMessage({id,type,payload});
    });
  }
  advance(time:number,recordCommand=true){return this.request<{time:number;sequence:number}>("advance",{time,recordCommand});}
  open(input:OpenContractCommand){return this.request<OpenContractResult>("open",input);}
  reference(q:ReferenceQuote){return this.request<boolean>("reference",q);}
  snapshot(symbol:string,since?:number){return this.request<ReturnType<MarketWorld["snapshot"]>>("snapshot",{symbol,since});}
  summaries(){return this.request<ReturnType<MarketWorld["summaries"]>>("summaries");}
  leaderboard(){return this.request<ReturnType<MarketWorld["leaderboard"]>>("leaderboard");}
  checkpoint(){return this.request<SimulationCheckpoint>("checkpoint");}
  archive(){return this.request<OtcArchiveBatch>("archive");}
  settlements(){return this.request<FixedContract[]>("settlements");}
  acknowledge(id:string){return this.request<boolean>("ack",id);}
  async stop(){await this.worker.terminate();}
}
