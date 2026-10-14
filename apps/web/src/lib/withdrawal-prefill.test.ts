import { describe, expect, it } from "vitest";
import { lastPayoutsFrom, type WithdrawalLike } from "./withdrawal-prefill";

const w = (over: Partial<WithdrawalLike>): WithdrawalLike => ({
  method: "UPI",
  accountHolder: null,
  accountNumber: null,
  ifsc: null,
  upiId: null,
  usdtNetwork: null,
  usdtAddress: null,
  ...over,
});

describe("lastPayoutsFrom", () => {
  it("keeps the newest complete destination per method and starts on the newest method", () => {
    const result = lastPayoutsFrom([
      w({ method: "UPI", upiId: "new@upi" }),
      w({ method: "BANK", accountHolder: "Asha", accountNumber: "123", ifsc: "SBIN0001234" }),
      w({ method: "UPI", upiId: "old@upi" }),
    ]);
    expect(result.initialMethod).toBe("UPI");
    expect(result.lastPayouts.UPI).toEqual({ upiId: "new@upi" });
    expect(result.lastPayouts.BANK).toEqual({ accountHolder: "Asha", accountNumber: "123", ifsc: "SBIN0001234" });
  });

  it("skips incomplete bank rows and unknown USDT networks", () => {
    const result = lastPayoutsFrom([
      w({ method: "BANK", accountHolder: "Asha", accountNumber: null, ifsc: "X" }),
      w({ method: "USDT", usdtNetwork: "doge", usdtAddress: "abc" }),
    ]);
    expect(result).toEqual({ lastPayouts: {}, initialMethod: null });
  });
});
