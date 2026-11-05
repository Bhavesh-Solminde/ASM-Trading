import { marketReferenceRepository,type DbClient } from "@asm/db";
import { MULTI_MARKETS } from "@asm/market-sim";

/** Explicit frozen input for isolated tests/benchmarks only; never engine boot. */
export async function seedTestReferences(client:DbClient){
  const now=Date.now();
  for(const m of MULTI_MARKETS)await marketReferenceRepository(client).save({symbol:m.symbol,price:m.base,quoteTime:now,receivedAt:now,
    source:"Isolated test fixture (not a fetched market quote)",url:"fixture://frozen",kind:"PUBLIC_QUOTE",minuteBps:m.minuteBps,calibration:"Frozen test input",sampleBars:0,session:"UNKNOWN"});
}
