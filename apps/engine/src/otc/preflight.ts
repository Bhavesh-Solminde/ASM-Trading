import type { DbClient } from "@asm/db";
/** The new desk cannot silently abandon contracts owned by the legacy engine. */
export async function assertLegacyDrained(client:DbClient){
  const count=await client.trade.count({where:{status:"OPEN",mode:{in:["LEGACY_BINARY","CFD"]}}});
  if(count)throw new Error(`OTC activation refused: ${count} legacy positions are still OPEN. Pause new legacy entries and let the existing engine settle them first.`);
}
