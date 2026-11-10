import { marketReferenceRepository,prisma,type DbClient } from "@asm/db";
import { ReferencePoller,fetchReferenceJson,type ReferenceTransport } from "@asm/market-sim";
import { OtcRuntime } from "./runtime";

/** Long-lived market process: clock and provider requests continue with no viewers. */
export async function startOtcService(options:{client?:DbClient;databaseUrl?:string;transport?:ReferenceTransport;onFatal:(error:unknown)=>void;timers?:boolean}){
  const client=options.client??prisma,runtime=new OtcRuntime(client,options.databaseUrl??process.env.DATABASE_URL??"");
  let stopping=false,advancing=false,checkpointing=false;
  let running=false;
  let pollTask:Promise<void>|null=null;
  const repository=marketReferenceRepository(client);
  let nextCalibration=(await repository.loadSchedule?.()??[]).find(s=>s.group==="calibration")?.nextDueAt??0;
  const poller=new ReferencePoller({...repository,save:async q=>{if(stopping)throw new Error("OTC service stopped");await repository.save(q);if(running)await runtime.reference(q);}},
    async url=>{if(stopping)throw new Error("OTC service stopped");return (options.transport??fetchReferenceJson)(url);},Date.now,undefined,
    {keylessRates:process.env.OTC_YAHOO_RATES_ONLY!=="true"});
  await poller.initialize();
  // A fresh book must never warm up at illustrative catalogue prices and then
  // spend hours converging to its first real quote. Poll BEFORE creating it.
  await runtime.start(Date.now(),async()=>{
    await poller.poll();
    if(Date.now()>=nextCalibration){
      const attemptedAt=Date.now();nextCalibration=attemptedAt+3600000;
      await repository.saveSchedule?.({group:"calibration",attemptedAt,nextDueAt:nextCalibration,failures:0});
      await poller.calibrate();
    }
  });running=true;
  // A crash may occur between quote persistence and WAL insertion; replay any
  // cached reference not yet reflected in the restored world's metadata.
  for(const q of poller.all()){
    const state=await runtime.snapshot(q.symbol);
    if(!state.reference||state.reference.quoteTime<q.quoteTime||state.reference.price!==q.price||state.reference.minuteBps!==q.minuteBps)await runtime.reference(q);
  }
  const timers:ReturnType<typeof setInterval>[]=[];
  const fatal=(error:unknown)=>{if(!stopping)options.onFatal(error);};
  async function poll(){
    if(stopping)return;if(pollTask)return pollTask;
    pollTask=(async()=>{try{await poller.poll();if(Date.now()>=nextCalibration){
      const attemptedAt=Date.now();nextCalibration=attemptedAt+3600000;
      await repository.saveSchedule?.({group:"calibration",attemptedAt,nextDueAt:nextCalibration,failures:0});
      await poller.calibrate();
    }}catch(error){fatal(error);}})();
    try{await pollTask;}finally{pollTask=null;}
  }
  if(options.timers!==false){
    timers.push(setInterval(()=>{if(stopping||advancing)return;advancing=true;void runtime.advance().catch(fatal).finally(()=>{advancing=false;});},1000));
    timers.push(setInterval(()=>{void poll();},15000));
    timers.push(setInterval(()=>{if(stopping||checkpointing)return;checkpointing=true;void runtime.checkpoint().catch(fatal).finally(()=>{checkpointing=false;});},30000));
    for(const timer of timers)timer.unref();void poll();
  }
  return {runtime,poller,poll,
    async stop(){stopping=true;for(const timer of timers)clearInterval(timer);await pollTask;await runtime.stop();},
  };
}
