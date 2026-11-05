import { createServer,type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { EngineOtcOpenTradeSchema,tradeViewFrom } from "@asm/contracts";
import { prisma,OtcRejected } from "@asm/db";
import type { OtcRuntime } from "./runtime";
import { otcProcessMetrics } from "./metrics";

export function createOtcHttp(runtime:OtcRuntime,secret:string,port:number,transportMetrics:()=>unknown=()=>null){
  if(secret.length<16)throw new Error("Set ENGINE_INTERNAL_SECRET before starting OTC");
  const metrics=otcProcessMetrics();
  const reply=(res:ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(body));};
  const server=createServer(async(req,res)=>{
    const given=Buffer.from(req.headers.authorization??""),expected=Buffer.from(`Bearer ${secret}`);
    if(given.length!==expected.length||!timingSafeEqual(given,expected)){reply(res,401,{error:"unauthorised"});return;}
    try{
      const url=new URL(req.url??"/","http://localhost");
      if(req.method==="GET"&&url.pathname==="/otc/metrics"){reply(res,200,{process:metrics.read(),transport:transportMetrics()});return;}
      if(req.method==="GET"&&url.pathname==="/otc/health"){reply(res,200,{model:"OTC_FIXED",generation:runtime.generation,markets:(await runtime.summaries()).length});return;}
      if(req.method!=="POST"||url.pathname!=="/otc/trades"){reply(res,404,{error:"not_found"});return;}
      if(!req.headers["content-type"]?.startsWith("application/json")){reply(res,415,{error:"json_required"});return;}
      let body="";for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096){reply(res,413,{error:"too_large"});return;}}
      const input=EngineOtcOpenTradeSchema.safeParse(JSON.parse(body));if(!input.success){reply(res,400,{error:"invalid_trade"});return;}
      const trade=await runtime.open({...input.data,stopLoss:input.data.stopLoss??null,takeProfit:input.data.takeProfit??null}),account=await prisma.account.findUniqueOrThrow({where:{id:trade.accountId}});
      reply(res,201,{trade:tradeViewFrom(trade,input.data.symbol),balances:{realBalance:account.realBalance,bonusBalance:account.bonusBalance}});
    }catch(error){if(error instanceof OtcRejected){reply(res,409,{error:error.message});return;}
      if(error instanceof SyntaxError){reply(res,400,{error:"invalid_json"});return;}
      reply(res,503,{error:"trading_unavailable"});
    }
  });
  return {server,async listen(){await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(port,process.env.ENGINE_HTTP_HOST??"127.0.0.1",resolve);});return (server.address() as {port:number}).port;},
    async close(){metrics.stop();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
