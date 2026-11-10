import { parentPort,workerData } from "node:worker_threads";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { MarketWorld,type OpenContractCommand,type ReferenceQuote,type SimulationCheckpoint } from "@asm/market-sim";
import type { OtcArchiveBatch } from "./archive";
interface Options {start:number;references?:ReferenceQuote[];checkpoint?:SimulationCheckpoint;}
const options=workerData as Options;
const world=options.checkpoint?MarketWorld.restore(options.checkpoint):new MarketWorld(options.start,options.references);
const archived=new Map<string,number>();
let executions:OtcArchiveBatch["executions"]=[];
world.observeExecutions((symbol,fill,tickSize)=>{
  executions.push({symbol,...fill,price:fill.price*tickSize});
});
let queue=Promise.resolve();
parentPort!.postMessage({ready:true});
parentPort!.on("message",(request:{id:number;type:string;payload:unknown})=>{
  queue=queue.then(async()=>{
    try{
      let result:unknown;
      switch(request.type){
        case "advance":{
          const {time:end,recordCommand}=request.payload as {time:number;recordCommand:boolean};
          if(!Number.isSafeInteger(end)||end<world.time)throw new Error("Invalid world time");
          while(world.time<end){world.advance(Math.min(end,world.time+60000),false);await yieldLoop();}
          if(recordCommand)world.sequence++;result={time:world.time,sequence:world.sequence};break;
        }
        case "open":result=world.open(request.payload as OpenContractCommand);break;
        case "reference":world.reference(request.payload as ReferenceQuote);result=true;break;
        case "snapshot":{const p=request.payload as {symbol:string;since?:number};result=world.snapshot(p.symbol,p.since);break;}
        case "summaries":result=world.summaries();break;
        case "leaderboard":result=world.leaderboard();break;
        case "checkpoint":result=world.checkpoint();break;
        case "archive":{
          const candles:OtcArchiveBatch["candles"]=[];
          for(const [symbol,market] of world.markets){
            const bars=market.closedCandlesAfter(archived.get(symbol));
            for(const bar of bars)candles.push({symbol,...bar});
            if(bars.length)archived.set(symbol,bars.at(-1)!.time);
          }
          result={candles,executions};executions=[];break;
        }
        case "settlements":result=world.contracts.pendingSettlements();break;
        case "ack":world.contracts.acknowledge(request.payload as string);result=true;break;
        default:throw new Error("Unknown OTC worker request");
      }
      parentPort!.postMessage({id:request.id,result});
    }catch(error){parentPort!.postMessage({id:request.id,error:error instanceof Error?error.message:"Worker operation failed"});}
  });
});
