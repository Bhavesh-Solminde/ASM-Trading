import { describe, expect, it, vi } from "vitest";
import { invalidateMoneyOn, refetchWalletSettledOn, MONEY_QUERY_KEYS } from "./invalidate-money";

describe("invalidateMoneyOn", () => {
  it("invalidates every money query, then refreshes bootstrap through the shared helper", () => {
    const invalidateQueries = vi.fn();
    invalidateMoneyOn({ invalidateQueries });
    const keys = invalidateQueries.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey);
    expect(keys.slice(0, MONEY_QUERY_KEYS.length)).toEqual(MONEY_QUERY_KEYS.map((k) => [k]));
    // Bootstrap is invalidated only by refreshBootstrap (cancelRefetch: false), never as a plain money key.
    expect(MONEY_QUERY_KEYS).not.toContain("bootstrap");
    expect(invalidateQueries).toHaveBeenLastCalledWith({ queryKey: ["bootstrap"] }, { cancelRefetch: false });
  });

  it("covers wallet, payments, ledger, payment and deposit-config", () => {
    expect([...MONEY_QUERY_KEYS].sort()).toEqual(["deposit-config", "ledger", "payment", "payments", "wallet"]);
  });
});

describe("refetchWalletSettledOn", () => {
  it("refetches the wallet, joining a refetch already in flight instead of restarting it, and returns the promise", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await refetchWalletSettledOn({ invalidateQueries });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["wallet"] }, { cancelRefetch: false });
  });
});
