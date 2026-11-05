import { mkdir,readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { prisma } from "@asm/db";
import { runCrowd } from "./otc-crowd.mjs";
import { stagingTarget } from "./otc-staging-target.mjs";
const target=stagingTarget(),measurements=[],measurementErrors=[];
if(!process.argv[2])throw new Error("Existing normally registered acceptance credentials required");
const credentials=JSON.parse(await readFile(process.argv[2],"utf8"));
let busy=false;
async function measure(){
  if(busy)return;busy=true;
  try{
    const begin=performance.now();await prisma.$queryRaw`SELECT 1`;const databaseProbeMs=performance.now()-begin,sent=performance.now();
    const response=await fetch(target.metrics,{headers:{Authorization:`Bearer ${process.env.ENGINE_INTERNAL_SECRET}`},signal:AbortSignal.timeout(5000)});
    if(response.status!==200)throw new Error(`Metrics HTTP ${response.status}`);
    const metrics=await response.json();
    measurements.push({time:new Date().toISOString(),databaseProbeMs,metricsHttpMs:performance.now()-sent,process:metrics.process.samples.at(-1),transport:metrics.transport});
  }catch(error){measurementErrors.push({time:new Date().toISOString(),error:String(error)});}finally{busy=false;}
}
const timer=setInterval(()=>void measure(),5000);
try{
  await mkdir(target.output,{recursive:true});await measure();
  const report=await runCrowd({base:target.base,ws:target.ws,credentials,counts:[100],durationSec:30,roundSpacingMs:6500,liquidityRetries:3,loginSpacingMs:0,onProgress:m=>{if(!m.startsWith("Signed in"))console.log(m);}});
  await writeFile(resolve(target.output,"otc-website-performance-crowd.json"),JSON.stringify(report,null,2));
  if(report.scenarios[0].totals.open||report.scenarios[0].failures.some(f=>f.status!==409||f.code!=="Liquidity unavailable"))throw new Error("Unexpected performance-run trade failure");
  if(measurements.length<3||measurementErrors.length||!measurements.some(s=>s.transport.authenticated===100))throw new Error("Missing or failed 100-client performance measurements");
  console.log(`Saved ${measurements.length} actual engine/DB/HTTP/transport samples; observed 100 authenticated clients`);
}finally{
  clearInterval(timer);while(busy)await wait(20);
  await mkdir(target.output,{recursive:true});await writeFile(resolve(target.output,"otc-website-performance-followup.json"),JSON.stringify({scope:target.scope,measurementErrors,measurements},null,2));
  await prisma.$disconnect();
}
