import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ account: { userId: "u", user: { status: "ACTIVE" }, currency: "USD", realBalance: 100000, bonusBalance: 0 }, create: vi.fn() }));
vi.mock("@asm/db", () => ({ prisma: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ account: { findUniqueOrThrow: async () => state.account }, trade: { create: state.create } }) } }));
import { CfdDesk } from "./cfd-desk";
const input = { symbol: "EURUSD", accountId: "a", actorId: "u", direction: "LONG" as const, stake: 10000, durationSec: 300, currency: "INR" as const };
const asset = { id: "asset", symbol: "EURUSD", spreadBps: 1 };
const risk = { treasuryMinor: 10000000, netExposure: 0, exposureCap: 10000000, userDailyPnl: 0, dailyWinCap: 1000000, dynamicMaxStake: 1000000, isCircuitBroken: false };
beforeEach(() => { state.account.userId = "u"; state.account.user.status = "ACTIVE"; state.create.mockClear(); });
it("checks currency inside the debit transaction, even when a switch landed after the HTTP route's read", async () => {
  await expect(new CfdDesk().open(input, 100, asset, risk)).rejects.toThrow("CURRENCY_CHANGED");
  expect(state.create).not.toHaveBeenCalled();
});
it.each(["FROZEN", "BANNED"])("refuses new CFD exposure for a %s owner with a surviving session", async status => {
  state.account.user.status = status;
  await expect(new CfdDesk().open(input, 100, asset, risk)).rejects.toThrow("ACCOUNT_NOT_ACTIVE");
  expect(state.create).not.toHaveBeenCalled();
});
it("refuses an actor who does not own the account inside the transaction", async () => {
  state.account.userId = "other";
  await expect(new CfdDesk().open(input, 100, asset, risk)).rejects.toThrow("ACCOUNT_NOT_FOUND");
  expect(state.create).not.toHaveBeenCalled();
});
