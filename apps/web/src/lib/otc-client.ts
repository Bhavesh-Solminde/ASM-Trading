import type { EngineOtcOpenTradeInput,OpenTradeResult } from "@asm/contracts";
import { EngineRejected,EngineUnavailable } from "./engine-client";
export async function engineOtcOpen(input:EngineOtcOpenTradeInput):Promise<OpenTradeResult>{
  const secret=process.env.ENGINE_INTERNAL_SECRET??"";
  if(!secret)throw new EngineUnavailable("Missing engine secret");
  const response=await fetch(`${process.env.ENGINE_HTTP_URL??"http://127.0.0.1:4002"}/otc/trades`,{
    method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify(input),cache:"no-store",signal:AbortSignal.timeout(15000),
  }).catch(()=>null);
  if(!response)throw new EngineUnavailable("Engine response unavailable; retry with the same request key");
  if(response.status===201)return response.json();
  const body=await response.json().catch(()=>({error:"trading_unavailable"}));
  if(response.status===409)throw new EngineRejected(409,body.error);
  throw new EngineUnavailable("OTC engine unavailable");
}
