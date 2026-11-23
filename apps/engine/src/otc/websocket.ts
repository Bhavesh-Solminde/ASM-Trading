import { WebSocketServer,type WebSocket } from "ws";
import { OtcClientMessageSchema,tradeRejectionMessage,tradeViewFrom,type OtcClientMessage,type Timeframe,type ServerMessage,type TradeView } from "@asm/contracts";
import { OtcRejected,prisma } from "@asm/db";
import { logger } from "@asm/logger";
import { MULTI_MARKETS } from "@asm/market-sim";
import type { OtcRuntime } from "./runtime";
import { publicMarket } from "./public-market";
interface Client {socket:WebSocket;userId:string|null;selected:{symbol:string;timeframe:Timeframe;since?:number}|null;watch:Set<string>;budget:number;busy:boolean;queue:Promise<void>;}

export class OtcWebSocketServer {
  private server:WebSocketServer;
  private clients=new Set<Client>();
  private timer:ReturnType<typeof setInterval>;
  private budget:ReturnType<typeof setInterval>;
  private cache=new Map<string,{at:number;value:ReturnType<OtcRuntime["snapshot"]>}>();
  private bytes=0;
  private messages=0;
  private slowCloses=0;
  private counts:{at:number;value:Promise<Record<string,number>>}|null=null;
  metrics(){return {connected:this.clients.size,authenticated:[...this.clients].filter(c=>c.userId).length,bytesSent:this.bytes,messagesSent:this.messages,slowClientCloses:this.slowCloses,snapshotCacheEntries:this.cache.size};}
  readonly ready:Promise<void>;
  constructor(private runtime:OtcRuntime,port:number,private authenticate:(ticket:string)=>Promise<string|null>,private onSettlement?:(userId:string,trade:TradeView)=>void,
    private limitTrade?:(userId:string)=>Promise<boolean>){
    this.server=new WebSocketServer({port,maxPayload:16384});
    this.ready=new Promise((resolve,reject)=>{this.server.once("listening",resolve);this.server.once("error",reject);});
    this.server.on("connection",socket=>this.connect(socket));
    this.timer=setInterval(()=>{void this.publish();},1000);
    this.budget=setInterval(()=>{for(const c of this.clients)c.budget=60;},10000);
    runtime.setNotifier((tradeId,actorId,updatedTrade)=>this.notify(tradeId,actorId,updatedTrade));
  }
  isUserOnline(userId:string){return [...this.clients].some(c=>c.userId===userId&&c.socket.readyState===c.socket.OPEN);}
  port(){return (this.server.address() as {port:number}).port;}
  private send(c:Client,message:ServerMessage){
    if(c.socket.readyState!==c.socket.OPEN)return;
    if(c.socket.bufferedAmount>262144){this.slowCloses++;c.socket.close(1013,"Slow chart connection");return;}
    const serialized=JSON.stringify(message);this.bytes+=Buffer.byteLength(serialized);this.messages++;
    c.socket.send(serialized);
  }
  private connect(socket:WebSocket){
    const c:Client={socket,userId:null,selected:null,watch:new Set(),budget:60,busy:false,queue:Promise.resolve()};this.clients.add(c);
    const authTimer=setTimeout(()=>{if(!c.userId)socket.close(1008,"Authentication required");},10000);
    socket.on("close",()=>{clearTimeout(authTimer);this.clients.delete(c);});socket.on("error",()=>this.clients.delete(c));
    this.send(c,{type:"ready",serverTs:Date.now(),model:"OTC_FIXED",generation:this.runtime.generation});
    socket.on("message",raw=>{
      if(--c.budget<0){socket.close(1008,"Too many requests");return;}
      c.queue=c.queue.then(async()=>{
        const parsed=OtcClientMessageSchema.safeParse(JSON.parse(raw.toString()));if(!parsed.success){this.send(c,{type:"error",message:"Invalid chart request"});return;}
        const m=parsed.data;
        if(m.type==="auth"){
          if(c.userId)return;const userId=await this.authenticate(m.token);if(!userId){socket.close(1008,"Unauthorised");return;}
          c.userId=userId;clearTimeout(authTimer);
          const own=[...this.clients].filter(x=>x.userId===userId);for(const old of own.slice(0,Math.max(0,own.length-5)))old.socket.close(1008,"Too many connections");
          this.send(c,{type:"authed"});return;
        }
        if(!c.userId){socket.close(1008,"Authenticate first");return;}
        // Detached so a trade never holds this socket's chart requests behind it.
        if(m.type==="trade:open"){void this.openTrade(c,c.userId,m);return;}
        if(m.type==="watchlist:subscribe"){c.watch=new Set(m.symbols.filter(s=>MULTI_MARKETS.some(spec=>spec.symbol===s)));return;}
        if(!MULTI_MARKETS.some(s=>s.symbol===m.symbol)){this.send(c,{type:"error",message:"Unknown market"});return;}
        if(m.type==="unsubscribe"){if(c.selected?.symbol===m.symbol)c.selected=null;return;}
        if(m.type==="candles:loadOlder"){
          const all=await this.runtime.history(m.symbol,m.timeframe,m.before,m.limit);
          this.send(c,{type:"candles:older",symbol:m.symbol,timeframe:m.timeframe,candles:all,reachedStart:all.length<m.limit});return;
        }
        c.selected={symbol:m.symbol,timeframe:m.timeframe,...(m.generation===this.runtime.generation&&m.since!==undefined?{since:m.since}:{})};
        await this.selected(c);
      }).catch(()=>socket.close(1011,"Chart request failed"));
    });
  }
  /**
   * The same ledger path as POST /otc/trades, over a connection that is already open and authenticated.
   * The actor is this socket's user, never the message. The idempotency key makes a retry over HTTP safe.
   */
  private async openTrade(c:Client,actorId:string,m:Extract<OtcClientMessage,{type:"trade:open"}>){
    const request:Omit<typeof m,"type">={...m},started=performance.now(),idempotencyKey=m.idempotencyKey;
    delete (request as {type?:string}).type;
    const reject=(code:string)=>this.send(c,{type:"trade:open:rejected",idempotencyKey,code,error:tradeRejectionMessage(code)});
    try{
      if(this.limitTrade&&!await this.limitTrade(actorId)){reject("rate_limited");return;}
      const trade=await this.runtime.open({...request,actorId,stopLoss:request.stopLoss??null,takeProfit:request.takeProfit??null});
      const account=await prisma.account.findUniqueOrThrow({where:{id:trade.accountId}});
      this.send(c,{type:"trade:open:result",idempotencyKey,trade:tradeViewFrom(trade,request.symbol),balances:{realBalance:account.realBalance,bonusBalance:account.bonusBalance}});
      try{logger.info({evt:"otc.open_timing",channel:"ws",symbol:request.symbol,ms:Math.round(performance.now()-started)},"OTC trade opened");}catch{/* best effort */}
    }catch(error){
      if(error instanceof OtcRejected){reject(error.message);return;}
      try{logger.error({evt:"otc.ws_open_failed",reason:error instanceof Error?error.message:String(error)},"OTC trade over socket failed");}catch{/* best effort */}
      reject("trading_unavailable");
    }
  }
  private snapshot(symbol:string){
    const cached=this.cache.get(symbol);if(cached&&Date.now()-cached.at<250)return cached.value;
    const value=this.runtime.snapshot(symbol);this.cache.set(symbol,{at:Date.now(),value});return value;
  }
  private async selected(c:Client){
    const selected=c.selected;if(!selected)return;
    if(!this.counts||Date.now()-this.counts.at>=1000)this.counts={at:Date.now(),value:this.runtime.openTobs()};
    const [state,counts]=await Promise.all([this.snapshot(selected.symbol),this.counts.value]);if(c.selected!==selected)return;
    const message=publicMarket(state,selected.timeframe,this.runtime.generation,selected.since,counts[selected.symbol]??0);
    this.send(c,message);const last=message.candles.at(-1);if(last)selected.since=last.openTs;
    this.send(c,{type:"payout:update",symbol:selected.symbol,payoutPct:92});
  }
  private publishing=false;
  private async publish(){
    if(this.publishing||!this.clients.size)return;this.publishing=true;
    try{
      const [summaries,leaders]=await Promise.all([this.runtime.summaries(),this.runtime.leaderboard()]);
      await Promise.all([...this.clients].map(async c=>{
        if(!c.userId||c.busy)return;c.busy=true;
        try{await this.selected(c);
          this.send(c,{type:"otc:watchlist",rows:summaries.filter(s=>c.watch.has(s.symbol)).map(s=>({symbol:s.symbol,price:s.lastPrice,payoutPct:92}))});
          this.send(c,{type:"otc:bots",rows:leaders});
        }finally{c.busy=false;}
      }));
    }catch{for(const c of this.clients)c.socket.close(1013,"Market reconnect required");}
    finally{this.publishing=false;}
  }
  private async notify(tradeId:string,actorId:string,updatedTrade?:TradeView){
    if (updatedTrade) {
      for (const client of this.clients) if (client.userId === actorId) this.send(client, { type: "trade:opened", trade: updatedTrade });
      return;
    }
    const row=await prisma.trade.findUniqueOrThrow({where:{id:tradeId},include:{asset:{select:{symbol:true}},account:true}});
    const trade=tradeViewFrom(row,row.asset.symbol);
    if(trade.status!=="OPEN")this.onSettlement?.(actorId,trade);
    for(const c of this.clients)if(c.userId===actorId){this.send(c,{type:trade.status==="OPEN"?"trade:opened":"trade:settled",trade});
      this.send(c,{type:"balance:update",accountId:row.accountId,realBalance:row.account.realBalance,bonusBalance:row.account.bonusBalance});}
  }
  async stop(){clearInterval(this.timer);clearInterval(this.budget);this.runtime.setNotifier(null);for(const c of this.clients)c.socket.close(1001,"Engine restarting");
    await new Promise<void>((resolve,reject)=>this.server.close(error=>error?reject(error):resolve()));}
}
