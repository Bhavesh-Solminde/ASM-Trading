import { describe, expect, it } from "vitest";
import { cfdSpreadFeeMinor, cfdSpreadFeePct } from "./cfd-fees";
describe("100x opening fee", () => {
  it.each([[5,5,500],[2,2,200],[10,10,1000]])("base %i bps displays %i percent and charges %i minor on ₹100", (bps,pct,fee) => {
    expect(cfdSpreadFeePct(bps)).toBe(pct);
    expect(cfdSpreadFeeMinor(10000,bps)).toBe(fee);
  });
  it("rounds once in minor units and preserves zero spread", () => {
    expect(cfdSpreadFeeMinor(101,5)).toBe(5);
    expect(cfdSpreadFeeMinor(10000,0)).toBe(0);
  });
  it("caps the fee at ₹50 however large the stake", () => {
    expect(cfdSpreadFeeMinor(100000,5)).toBe(5000);
    expect(cfdSpreadFeeMinor(10000000,10)).toBe(5000);
    expect(cfdSpreadFeeMinor(99000,5)).toBe(4950);
  });
});
