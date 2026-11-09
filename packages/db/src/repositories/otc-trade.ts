import { randomUUID } from "node:crypto";
import type { FixedContract,OpenContractCommand,OpenContractResult } from "@asm/market-sim";
import { splitSettlementCredit } from "@asm/trading";
import { prisma,type DbClient,type DbTransaction } from "../client";
import { convertMinorBetween } from "./account";
import { assertOtcFence,type OtcFence } from "./otc-fence";

export interface OtcTradeRequest {
  actorId:string;accountId:string;idempotencyKey:string;symbol:string;
  direction:"UP"|"DOWN";stake:number;durationSec:number;stopLoss?:number|null;takeProfit?:number|null;
  quoteToken?:string;currency?:string|undefined;
}
export interface OtcOpenIntent {
  version:1;kind:"open";time:number;assetId:string;fromReal:number;fromBonus:number;fingerprint:string;currency?:string;
  contract:OpenContractCommand;
}
export class OtcRejected extends Error {}
const fingerprint=(r:OtcTradeRequest)=>JSON.stringify({symbol:r.symbol,direction:r.direction,stake:r.stake,durationSec:r.durationSec,stopLoss:r.stopLoss??null,takeProfit:r.takeProfit??null,...(r.quoteToken?{quoteToken:r.quoteToken}:{}),...(r.currency?{currency:r.currency}:{})});
const json=<T>(v:T)=>JSON.parse(JSON.stringify(v));
async function serial<T>(client:DbClient,work:(tx:DbTransaction)=>Promise<T>):Promise<T>{
  for(let attempt=0;attempt<5;attempt++){
    try{return await client.$transaction(work,{isolationLevel:"Serializable"});}
    catch(error){const code=(error as {code?:string}).code;if(attempt<4&&["P2034","P2002"].includes(code??""))continue;throw error;}
  }
  throw new Error("Unreachable transaction retry");
}

/** Reserves actual account funds and writes the immutable worker input atomically. */
export async function reserveOtcTrade(request:OtcTradeRequest,client:DbClient=prisma,now=Date.now(),fence?:OtcFence,resolveEntryPrice?:()=>number){
  if(!Number.isSafeInteger(request.stake)||request.stake<1||request.stake>100000000
    ||!request.idempotencyKey||request.idempotencyKey.length>128||!["UP","DOWN"].includes(request.direction)
    ||![5,10,15,30,60,120,300,600,900,1800,3600,7200,14400].includes(request.durationSec))throw new OtcRejected("invalid_trade");
  for(const price of [request.stopLoss,request.takeProfit])if(price!=null&&(!Number.isFinite(price)||price<=0))throw new OtcRejected("invalid_stops");
  return serial(client,async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(4281165,2)::text`;
    await assertOtcFence(tx,fence);
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${request.accountId} AND "userId"=${request.actorId} FOR UPDATE`;
    const account=await tx.account.findFirst({where:{id:request.accountId,userId:request.actorId},include:{user:{select:{role:true,status:true}}}});
    if(!account)throw new OtcRejected("account_not_found");
    const existing=await tx.marketCommand.findUnique({where:{accountId_idempotencyKey:{accountId:account.id,idempotencyKey:request.idempotencyKey}}});
    if(existing){const intent=existing.input as unknown as OtcOpenIntent;if(intent.fingerprint!==fingerprint(request))throw new OtcRejected("idempotency_conflict");return existing;}
    if(request.currency && request.currency !== account.currency)throw new OtcRejected("currency_changed");
    const displayedPrice=resolveEntryPrice?.();
    if(["FROZEN","BANNED"].includes(account.user.status))throw new OtcRejected("account_not_active");
    if(!["INR","USD"].includes(account.currency)||request.stake<(account.currency==="INR"?10000:100))throw new OtcRejected("stake_below_minimum");
    const asset=await tx.asset.findFirst({where:{symbol:request.symbol,isOpen:true}});if(!asset)throw new OtcRejected("unknown_asset");
    if(account.realBalance+account.bonusBalance<request.stake)throw new OtcRejected("insufficient_funds");
    const fromReal=Math.min(account.realBalance,request.stake),fromBonus=request.stake-fromReal,id=randomUUID();
    const claimed=await tx.account.updateMany({where:{id:account.id,version:account.version},data:{realBalance:{decrement:fromReal},bonusBalance:{decrement:fromBonus},version:{increment:1}}});
    if(claimed.count!==1)throw new OtcRejected("account_changed");
    const contract:OpenContractCommand={id,accountId:account.id,actorId:request.actorId,symbol:asset.symbol,direction:request.direction,
      stake:request.stake,stakeInrMinor:convertMinorBetween(request.stake,account.currency,"INR"),durationSec:request.durationSec,
      role:account.user.role,accountType:account.type,stopLoss:request.stopLoss??null,takeProfit:request.takeProfit??null,
      ...(displayedPrice!==undefined?{displayedPrice}:{})};
    const intent:OtcOpenIntent={version:1,kind:"open",time:now,assetId:asset.id,fromReal,fromBonus,fingerprint:fingerprint(request),currency:account.currency,contract};
    const command=await tx.marketCommand.create({data:{id,worldId:"otc-main",accountId:account.id,actorId:request.actorId,idempotencyKey:request.idempotencyKey,input:json(intent)}});
    await tx.transaction.create({data:{accountId:account.id,kind:"TRADE_STAKE",amount:-request.stake,balanceAfter:account.realBalance+account.bonusBalance-request.stake,refType:"Trade",refId:id}});
    return command;
  });
}

/** Idempotent open finalization. A rejected fill restores the exact original balance split. */
export async function finalizeOtcOpen(commandId:string,result:OpenContractResult|null,rejection:string|null=null,client:DbClient=prisma,fence?:OtcFence){
  return serial(client,async tx=>{
    await assertOtcFence(tx,fence);
    await tx.$queryRaw`SELECT "id" FROM "MarketCommand" WHERE "id"=${commandId} FOR UPDATE`;
    const row=await tx.marketCommand.findUniqueOrThrow({where:{id:commandId}});
    if(row.status!=="ACCEPTED")return tx.trade.findUnique({where:{id:commandId}});
    const intent=row.input as unknown as OtcOpenIntent;
    if(intent.version!==1||intent.kind!=="open")throw new Error("Not an OTC open intent");
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${intent.contract.accountId} FOR UPDATE`;
    const currentAccount=await tx.account.findUniqueOrThrow({where:{id:intent.contract.accountId}}),currency=intent.currency??currentAccount.currency;
    if(!result){
      const credit=convertMinorBetween(intent.contract.stake,currency,currentAccount.currency);
      const {toReal,toBonus}=splitSettlementCredit(credit,intent.contract.stake,intent.fromBonus);
      const account=await tx.account.update({where:{id:intent.contract.accountId},data:{realBalance:{increment:toReal},bonusBalance:{increment:toBonus},version:{increment:1}}});
      await tx.transaction.create({data:{accountId:account.id,kind:"TRADE_REFUND",amount:credit,balanceAfter:account.realBalance+account.bonusBalance,refType:"Trade",refId:commandId}});
      await tx.marketCommand.update({where:{id:commandId},data:{status:"REJECTED",result:{error:rejection??"liquidity_unavailable"}}});return null;
    }
    const p=result.contract;
    if(p.id!==row.id||p.accountId!==intent.contract.accountId||p.actorId!==intent.contract.actorId||p.stake!==intent.contract.stake||p.symbol!==intent.contract.symbol||p.status!=="OPEN"
      ||p.direction!==intent.contract.direction||p.payoutPct!==92||p.expiryTime-p.entryTime!==intent.contract.durationSec*1000
      ||(p.stopLoss??null)!==(intent.contract.stopLoss??null)||(p.takeProfit??null)!==(intent.contract.takeProfit??null))throw new Error("Worker open does not match reserved intent");
    if(intent.contract.displayedPrice!==undefined&&p.entryPrice!==intent.contract.displayedPrice)throw new Error("Worker entry differs from the displayed quote");
    const trade=await tx.trade.create({data:{id:row.id,accountId:p.accountId,assetId:intent.assetId,mode:"OTC_FIXED",currency,direction:p.direction,
      stake:p.stake,stakeFromBonus:intent.fromBonus,payoutPct:92,entryPrice:p.entryPrice,entryTs:new Date(p.entryTime),expiryTs:new Date(p.expiryTime),
      durationSec:intent.contract.durationSec,stopLoss:p.stopLoss??null,takeProfit:p.takeProfit??null,entrySequence:BigInt(p.entrySequence),
      flowLots:result.flowLots,filledLots:result.filledLots,marketCommandId:row.id,idempotencyKey:row.idempotencyKey,status:"OPEN"}});
    await tx.marketCommand.update({where:{id:row.id},data:{status:"APPLIED",result:json(result)}});return trade;
  });
}

/** Retries/replayed settlement deliveries cannot credit a position twice. */
export async function settleOtcTrade(position:FixedContract,client:DbClient=prisma,fence?:OtcFence){
  if(position.status==="OPEN"||position.exitPrice==null||position.settledTime==null||position.reason==null)throw new Error("Contract is not settled");
  const {exitPrice,settledTime,reason}=position;
  return serial(client,async tx=>{
    await assertOtcFence(tx,fence);
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${position.accountId} FOR UPDATE`;
    const currentAccount=await tx.account.findUniqueOrThrow({where:{id:position.accountId}});
    const trade=await tx.trade.findUniqueOrThrow({where:{id:position.id},include:{asset:{select:{symbol:true}}}});
    if(trade.mode!=="OTC_FIXED"||trade.accountId!==position.accountId||trade.stake!==position.stake
      ||trade.direction!==position.direction||trade.entryPrice!==position.entryPrice||trade.asset.symbol!==position.symbol
      ||trade.expiryTs.getTime()!==position.expiryTime||trade.entryTs.getTime()!==position.entryTime)throw new Error("Settlement identity mismatch");
    if(trade.status!=="OPEN")return trade;
    const credit=position.status==="WON"?Number(BigInt(trade.stake)*192n/100n):position.status==="REFUNDED"?trade.stake:0;
    if(credit!==position.credit||position.pnl!==credit-trade.stake)throw new Error("Settlement payout mismatch");
    const claimed=await tx.trade.updateMany({where:{id:trade.id,status:"OPEN"},data:{status:position.status,exitPrice,
      pnl:credit-trade.stake,closeReason:reason,closedAt:new Date(settledTime),settlementSequence:BigInt(position.lastSequence)}});
    if(claimed.count!==1)throw new Error("Settlement concurrent claim");
    if(credit){
      const creditedAmount=convertMinorBetween(credit,trade.currency??currentAccount.currency,currentAccount.currency);
      const {toReal,toBonus}=splitSettlementCredit(creditedAmount,trade.stake,trade.stakeFromBonus);
      const account=await tx.account.update({where:{id:trade.accountId},data:{realBalance:{increment:toReal},bonusBalance:{increment:toBonus},version:{increment:1}}});
      await tx.transaction.create({data:{accountId:account.id,kind:position.status==="REFUNDED"?"TRADE_REFUND":"TRADE_PAYOUT",amount:creditedAmount,balanceAfter:account.realBalance+account.bonusBalance,refType:"Trade",refId:trade.id}});}
    return tx.trade.findUniqueOrThrow({where:{id:trade.id}});
  });
}
