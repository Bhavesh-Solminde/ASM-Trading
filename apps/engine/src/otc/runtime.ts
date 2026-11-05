import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { prisma,reserveOtcTrade,finalizeOtcOpen,settleOtcTrade,assertOtcFence,OtcRejected,
  marketReferenceRepository,type DbClient,type OtcFence,type OtcOpenIntent,type OtcTradeRequest } from "@asm/db";
import type { OpenContractResult,ReferenceQuote,SimulationCheckpoint } from "@asm/market-sim";
import { MULTI_MARKETS } from "@asm/market-sim";
import { OtcWorker } from "./worker";
import { OtcWriterLock } from "./writer-lock";
import { persistOtcArchive,readOtcCandles,retainOtcHistory } from "./archive";
import type { Timeframe } from "@asm/contracts";

type SystemIntent={version:1;kind:"advance";time:number}|{version:1;kind:"reference";time:number;quote:ReferenceQuote};
type Command=Awaited<ReturnType<DbClient["marketCommand"]["findUniqueOrThrow"]>>;
const json=(value:unknown)=>JSON.parse(JSON.stringify(value));
const BUSINESS_ERRORS=new Set(["Invalid stop loss","Invalid take profit","Liquidity unavailable","Market price unavailable","Invalid fixed contract","Invalid duration","Invalid stake scale","Unknown market"]);

/** Durable, single-writer command coordinator. Timers and public APIs are attached by its host. */
export class OtcRuntime {
  readonly generation=randomUUID();
  readonly worldId="otc-main";
  private fence:OtcFence={worldId:this.worldId,generation:this.generation};
  private worker:OtcWorker|null=null;
  private lock:OtcWriterLock|null=null;
  private tail=Promise.resolve();
  private failure:Error|null=null;
  private closing=false;
  private watermark=0n;
  private time=0;
  private retainedAt=0;
  private notify:((tradeId:string,actorId:string)=>Promise<void>)|null=null;
  setNotifier(notify:((tradeId:string,actorId:string)=>Promise<void>)|null){this.notify=notify;}
  constructor(private client:DbClient=prisma,private databaseUrl=process.env.DATABASE_URL??"",
    private hook?:(stage:"applied"|"finalized"|"settled",id:string)=>Promise<void>){}
  private fail(error:unknown){if(this.closing)return;this.failure=error instanceof Error?error:new Error(String(error));void this.worker?.stop();}
  private assertActive(){if(this.closing)throw new Error("OTC runtime is stopped");if(this.failure)throw this.failure;this.lock?.assertActive();}
  private enqueue<T>(fn:()=>Promise<T>):Promise<T>{
    const result=this.tail.then(()=>{this.assertActive();return fn();});
    this.tail=result.then(()=>{},error=>{if(!(error instanceof OtcRejected))this.fail(error);});
    return result;
  }
  async start(now=Date.now(),prepareReferences?:()=>Promise<void>){
    if(this.lock)throw new Error("OTC runtime already started");
    this.lock=new OtcWriterLock(this.databaseUrl,error=>this.fail(error));
    try{
      await this.lock.acquire();
      const saved=await this.client.marketWorldCheckpoint.findUnique({where:{id:this.worldId}});
      if(saved){
        if(saved.version!==1)throw new Error("Unsupported OTC checkpoint version");
        const checkpoint=saved.state as unknown as SimulationCheckpoint;
        this.worker=new OtcWorker({start:checkpoint.time,checkpoint});this.time=checkpoint.time;this.watermark=saved.sequence;
        await this.worker.ready;
        await this.client.marketWorldCheckpoint.update({where:{id:this.worldId},data:{generation:this.generation}});
      }else{
        const history=await Promise.all([
          this.client.marketCommand.findFirst({where:{worldId:this.worldId},select:{id:true}}),
          this.client.otcCandle.findFirst({where:{worldId:this.worldId},select:{symbol:true}}),
          this.client.marketExecution.findFirst({where:{worldId:this.worldId},select:{symbol:true}}),
        ]);
        if(history.some(Boolean))throw new Error("OTC checkpoint missing while durable market history exists; restore a matching backup instead of reseeding");
        await prepareReferences?.();
        const references=await marketReferenceRepository(this.client).load();
        const missing=MULTI_MARKETS.filter(m=>!references.some(q=>q.symbol===m.symbol&&q.kind!=="ILLUSTRATIVE"&&Number.isFinite(q.price)&&q.price>0
          &&Number.isFinite(q.minuteBps)&&q.minuteBps>0&&Number.isSafeInteger(q.quoteTime)&&q.quoteTime>0&&q.quoteTime<=Date.now()+60000&&q.receivedAt>=q.quoteTime));
        if(missing.length)throw new Error(`OTC startup awaits verified references: ${missing.map(m=>m.symbol).join(", ")}`);
        const seedTime=Math.max(now,...references.map(q=>q.receivedAt));
        this.worker=new OtcWorker({start:seedTime,references});await this.worker.ready;this.time=seedTime;
        const state=await this.worker.checkpoint();
        await this.client.marketWorldCheckpoint.create({data:{id:this.worldId,version:1,generation:this.generation,sequence:0n,state:json(state)}});
      }
      await persistOtcArchive(this.client,this.fence,await this.worker.archive());
      await this.drain();
      return this;
    }catch(error){this.fail(error);await this.worker?.stop();await this.lock.close().catch(()=>{});throw error;}
  }
  private async append(input:SystemIntent){
    return this.client.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(4281165,2)::text`;
      await assertOtcFence(tx,this.fence);
      return tx.marketCommand.create({data:{worldId:this.worldId,input:json(input)}});
    });
  }
  private async process(row:Command){
    this.assertActive();
    const input=row.input as unknown as OtcOpenIntent|SystemIntent;
    if(input.version!==1||!Number.isSafeInteger(input.time)||!["open","advance","reference"].includes(input.kind))throw new Error("Invalid durable OTC input");
    if(input.time>this.time){
      // Bound archive memory during catch-up without skipping ticks or adding commands.
      while(this.time<input.time){
        const end=Math.min(input.time,this.time+60000);
        await this.worker!.advance(end,end===input.time);this.time=end;
        await persistOtcArchive(this.client,this.fence,await this.worker!.archive());
      }
    }
    if(input.kind==="open"){
      let result:OpenContractResult|null=null,rejection:string|null=null;
      try{result=await this.worker!.open(input.contract);}
      catch(error){const message=error instanceof Error?error.message:String(error);if(!BUSINESS_ERRORS.has(message))throw error;rejection=message;}
      await this.hook?.("applied",row.id);
      const expected=result??{error:rejection};
      if(row.status!=="ACCEPTED"&&!isDeepStrictEqual(row.result,expected))throw new Error("OTC replay result differs from durable result");
      await finalizeOtcOpen(row.id,result,rejection,this.client,this.fence);
      if(result)await this.notify?.(row.id,input.contract.actorId).catch(()=>{});
    }else{
      if(input.kind==="reference")await this.worker!.reference(input.quote);
      await this.hook?.("applied",row.id);
      await this.client.$transaction(async tx=>{
        await assertOtcFence(tx,this.fence);
        await tx.marketCommand.updateMany({where:{id:row.id,status:"ACCEPTED"},data:{status:"APPLIED",result:{ok:true}}});
      });
    }
    await this.hook?.("finalized",row.id);
    for(const settlement of await this.worker!.settlements()){
      await settleOtcTrade(settlement,this.client,this.fence);
      await this.notify?.(settlement.id,settlement.actorId).catch(()=>{});
      await this.hook?.("settled",settlement.id);
      await this.worker!.acknowledge(settlement.id);
    }
    await persistOtcArchive(this.client,this.fence,await this.worker!.archive());
    this.watermark=row.sequence;
  }
  private async drain(){
    while(true){
      const commands=await this.client.marketCommand.findMany({where:{worldId:this.worldId,sequence:{gt:this.watermark}},orderBy:{sequence:"asc"},take:100});
      if(!commands.length)return;
      for(const command of commands)await this.process(command);
    }
  }
  open(request:OtcTradeRequest){return this.enqueue(async()=>{
    const command=await reserveOtcTrade(request,this.client,Date.now(),this.fence);
    await this.drain();
    const final=await this.client.marketCommand.findUniqueOrThrow({where:{id:command.id}});
    if(final.status==="REJECTED")throw new OtcRejected(String((final.result as {error:string}).error));
    if(final.status!=="APPLIED")throw new Error("OTC command has not finalized");
    return this.client.trade.findUniqueOrThrow({where:{id:command.id}});
  });}
  advance(time=Date.now()){return this.enqueue(async()=>{await this.append({version:1,kind:"advance",time});await this.drain();});}
  reference(quote:ReferenceQuote){return this.enqueue(async()=>{await this.append({version:1,kind:"reference",time:Math.max(Date.now(),quote.receivedAt),quote});await this.drain();});}
  checkpoint(){return this.enqueue(async()=>{
    await this.drain();const state=await this.worker!.checkpoint();
    await this.client.$transaction(async tx=>{
      await assertOtcFence(tx,this.fence);
      await tx.marketWorldCheckpoint.update({where:{id:this.worldId},data:{sequence:this.watermark,state:json(state)}});
    });
    if(this.time-this.retainedAt>=3600000){
      await retainOtcHistory(this.client,this.fence,this.watermark,this.time);this.retainedAt=this.time;
    }
    return state;
  });}
  history(symbol:string,timeframe:Timeframe,before:number,limit:number){return readOtcCandles(this.client,this.worldId,symbol,timeframe,before,limit);}
  /** Dashboard count only. Position data never feeds the price-making worker. */
  async openTobs(){
    const rows=await this.client.$queryRaw<{symbol:string;count:bigint}[]>`
      SELECT a.symbol, count(DISTINCT c."userId") AS count FROM "Trade" t
      JOIN "Account" c ON c.id=t."accountId" JOIN "User" u ON u.id=c."userId"
      JOIN "Asset" a ON a.id=t."assetId"
      WHERE t.mode='OTC_FIXED' AND t.status='OPEN' AND t."flowLots">0 AND c.type='LIVE' AND u.role='USER'
      GROUP BY a.symbol`;
    return Object.fromEntries(rows.map(r=>[r.symbol,Number(r.count)]));
  }
  snapshot(symbol:string,since?:number){return this.enqueue(()=>this.worker!.snapshot(symbol,since));}
  summaries(){return this.enqueue(()=>this.worker!.summaries());}
  leaderboard(){return this.enqueue(()=>this.worker!.leaderboard());}
  async stop(save=true){
    if(this.closing)return;
    try{await this.tail;if(save&&!this.failure&&this.worker)await this.checkpoint();}
    finally{this.closing=true;await this.worker?.stop();await this.lock?.close().catch(()=>{});}
  }
}
