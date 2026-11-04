import { describe, expect, it } from "vitest";
import { heldWithdrawalsFrom, lastPayoutsFrom, type WithdrawalLike } from "./withdrawal-prefill";

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

describe("heldWithdrawalsFrom", () => {
  const row = (over: Partial<Parameters<typeof heldWithdrawalsFrom>[0][number]>) => ({
    id: "w-1",
    status: "HELD",
    amount: 500_000,
    createdAt: new Date("2026-10-20T08:00:00.000Z"),
    cancelableUntil: new Date("2026-10-20T20:00:00.000Z") as Date | null,
    ...over,
  });

  it("keeps only HELD rows and carries each one's cancel deadline as an ISO string", () => {
    expect(
      heldWithdrawalsFrom([row({}), row({ id: "w-2", status: "REQUESTED" }), row({ id: "w-3", status: "PAID" })]),
    ).toEqual([
      { id: "w-1", amountMinor: 500_000, createdAt: "2026-10-20T08:00:00.000Z", cancelableUntil: "2026-10-20T20:00:00.000Z" },
    ]);
  });

  it("sends null for a held row with no deadline, as the web does (it can no longer be cancelled)", () => {
    expect(heldWithdrawalsFrom([row({ cancelableUntil: null })])[0]?.cancelableUntil).toBeNull();
  });
});
