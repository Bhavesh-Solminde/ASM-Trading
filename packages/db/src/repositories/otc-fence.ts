import type { DbTransaction } from "../client";
export interface OtcFence {worldId:string;generation:string;}
/** Shared row lock makes generation changes wait for an in-flight ledger commit. */
export async function assertOtcFence(tx:DbTransaction,fence?:OtcFence){
  if(!fence)return;
  const rows=await tx.$queryRaw<{generation:string}[]>`SELECT "generation" FROM "MarketWorldCheckpoint" WHERE "id"=${fence.worldId} FOR SHARE`;
  if(rows[0]?.generation!==fence.generation)throw new Error("OTC writer was fenced out");
}
