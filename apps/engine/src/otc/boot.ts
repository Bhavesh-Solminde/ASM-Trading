import Redis from "ioredis";
import { config } from "@asm/config";
import { logger } from "@asm/logger";
import { prisma } from "@asm/db";
import { createTicketAuthenticator } from "../auth/ws-ticket";
import { startOtcService } from "./service";
import { createOtcHttp } from "./http";
import { OtcWebSocketServer } from "./websocket";
import { startBankFeedRunner } from "../bank-feed/runner";
import { startChainWatcher } from "../chain-watcher/runner";
import { startBscWatcher } from "../chain-watcher/bsc-runner";
import { startReconciliationRunner } from "../chain-watcher/reconciliation-runner";
import { startTatumRunner } from "../tatum-runner";
import { usdtProviderFor } from "@asm/tatum";
import { assertLegacyDrained } from "./preflight";

export async function startOtcEngine(){
  const secret=process.env.ENGINE_INTERNAL_SECRET??"";
  if(secret.length<16)throw new Error("Set ENGINE_INTERNAL_SECRET before starting OTC");
  await assertLegacyDrained(prisma);
  let shuttingDown=false;
  const cleanups:(()=>Promise<unknown>)[]=[];
  const fatal=(error:unknown)=>{logger.error({evt:"otc.fatal",reason:error instanceof Error?error.message:String(error)},"OTC engine stopped accepting work");void shutdown(1);};
  const service=await startOtcService({onFatal:error=>{setImmediate(()=>fatal(error));}});
  cleanups.push(()=>service.stop());
  const redis=new Redis(config.redisUrl,{maxRetriesPerRequest:2});
  cleanups.push(()=>redis.quit());
  const sockets=new OtcWebSocketServer(service.runtime,Number(process.env.ENGINE_WS_PORT??4001),createTicketAuthenticator(redis));
  const http=createOtcHttp(service.runtime,secret,Number(process.env.ENGINE_HTTP_PORT??4002),()=>sockets.metrics());
  await sockets.ready;cleanups.push(()=>sockets.stop());await http.listen();cleanups.push(()=>http.close());
  // Keep the website's existing account funding/reconciliation workers running.
  const bank=await startBankFeedRunner(),idle={stop:async()=>{}};
  cleanups.push(()=>bank.stop());
  const chain=usdtProviderFor("tron")==="manual"?await startChainWatcher():idle;
  cleanups.push(()=>chain.stop());
  const bsc=usdtProviderFor("bsc")==="manual"?await startBscWatcher():idle;
  cleanups.push(()=>bsc.stop());
  const tatum=startTatumRunner(),reconciliation=startReconciliationRunner();
  cleanups.push(()=>tatum.stop(),()=>reconciliation.stop());
  async function shutdown(code:number){
    if(shuttingDown)return;shuttingDown=true;
    for(const close of cleanups.reverse())await close().catch(error=>logger.error({evt:"otc.shutdown_error",reason:String(error)},"OTC shutdown step failed"));
    await prisma.$disconnect();process.exit(code);
  }
  process.once("SIGINT",()=>void shutdown(0));process.once("SIGTERM",()=>void shutdown(0));
  process.on("unhandledRejection",fatal);process.on("uncaughtException",fatal);
  logger.info({evt:"otc.started",markets:30,bots:6000},"OTC order-book engine ready");
}
