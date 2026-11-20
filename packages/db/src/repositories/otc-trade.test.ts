import { describe,expect,it } from "vitest";
import { isRetryableConflict } from "./otc-trade";

// Shape captured from a real failure: a raw FOR SHARE fence check in a serializable
// ledger transaction raced a concurrent update of the checkpoint row.
const rawConflict=(originalCode:string)=>({code:"P2010",meta:{driverAdapterError:{name:"DriverAdapterError",
  cause:{originalCode,originalMessage:"could not serialize access due to concurrent update",kind:"TransactionWriteConflict"}}}});

describe("OTC ledger transaction retries",()=>{
  it("retries serialization conflicts and deadlocks raised by raw queries",()=>{
    expect(isRetryableConflict(rawConflict("40001"))).toBe(true);
    expect(isRetryableConflict(rawConflict("40P01"))).toBe(true);
  });
  it("retries Prisma's own write-conflict and unique-race codes",()=>{
    expect(isRetryableConflict({code:"P2034"})).toBe(true);
    expect(isRetryableConflict({code:"P2002"})).toBe(true);
  });
  it("does not retry other raw-query failures or unknown errors",()=>{
    expect(isRetryableConflict(rawConflict("23505"))).toBe(false);
    expect(isRetryableConflict({code:"P2010"})).toBe(false);
    expect(isRetryableConflict(new Error("OTC writer was fenced out"))).toBe(false);
    expect(isRetryableConflict(null)).toBe(false);
  });
});
