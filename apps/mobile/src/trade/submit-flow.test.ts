import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { createSubmitter, type SubmitDeps } from "./submit-flow";

const ACCOUNT = "0b7d7e6e-5f0e-4c43-9a4f-2d3c1b0a9e11";
const req = { accountId: ACCOUNT, symbol: "EURUSD", direction: "UP", stakeMinor: 10_000, durationSec: 30 } as const;
const trade = {
  id: "t1", accountId: ACCOUNT, symbol: "EURUSD", direction: "UP", stake: 10000, payoutPct: 85,
  entryPrice: 1.1, entryTs: 100, expiryTs: 160, exitPrice: null, status: "OPEN", pnl: 0,
};
const okResult = { trade, balances: { realBalance: 1, bonusBalance: 2 } };

function setup(openTrade: SubmitDeps["openTrade"]) {
  const deps = {
    openTrade: vi.fn(openTrade),
    applyOpenResult: vi.fn(),
    toast: vi.fn(),
    haptic: vi.fn(),
    invalidateBootstrap: vi.fn(),
    setBusy: vi.fn(),
    t: (k: string) => `<${k}>`,
  };
  return { deps, submit: createSubmitter(deps) };
}

describe("createSubmitter", () => {
  it("sends the contract body, applies the parsed result, and toggles busy", async () => {
    const { deps, submit } = setup(async () => okResult);
    await submit(req);
    expect(deps.openTrade).toHaveBeenCalledWith({ symbol: "EURUSD", direction: "UP", stake: 10_000, durationSec: 30, accountId: ACCOUNT });
    expect(deps.applyOpenResult).toHaveBeenCalledWith(okResult);
    expect(deps.haptic).toHaveBeenCalledTimes(1);
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("ignores a second call while one is in flight", async () => {
    let release!: (v: unknown) => void;
    let calls = 0;
    const { deps, submit } = setup(() => (calls++ === 0 ? new Promise((r) => (release = r)) : Promise.resolve(okResult)));
    const first = submit(req);
    await submit(req);
    expect(deps.openTrade).toHaveBeenCalledTimes(1);
    release(okResult);
    await first;
    await submit(req);
    expect(deps.openTrade).toHaveBeenCalledTimes(2);
  });

  it.each(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"])(
    "does not toast the %s error (the api layer or a gate screen already handled it)",
    async (code) => {
      const { deps, submit } = setup(async () => {
        throw new ApiError("whatever", 429, code);
      });
      await submit(req);
      expect(deps.toast).not.toHaveBeenCalled();
      expect(deps.setBusy.mock.calls.at(-1)).toEqual([false]);
    },
  );

  it("translates a known server refusal instead of showing the server's English text", async () => {
    const { deps, submit } = setup(async () => {
      throw new ApiError("Not enough balance for that stake.", 409, "insufficient_funds");
    });
    await submit(req);
    expect(deps.toast).toHaveBeenCalledWith("<trade.insufficient>", "down");
  });

  it("an unknown server refusal reads trade.failed", async () => {
    const { deps, submit } = setup(async () => {
      throw new ApiError("Could not place that trade.", 400, "something_new");
    });
    await submit(req);
    expect(deps.toast).toHaveBeenCalledWith("<trade.failed>", "down");
  });

  it("translates the offline and generic errors", async () => {
    const offline = setup(async () => {
      throw new ApiError("No connection.", 0, "offline");
    });
    await offline.submit(req);
    expect(offline.deps.toast).toHaveBeenCalledWith("<common.noConnection>", "down");
  });

  it("falls back to trade.failed for an unknown error", async () => {
    const { deps, submit } = setup(async () => {
      throw new Error("boom");
    });
    await submit(req);
    expect(deps.toast).toHaveBeenCalledWith("<trade.failed>", "down");
  });

  it("an unreadable 2xx reconciles from bootstrap instead of claiming failure", async () => {
    const { deps, submit } = setup(async () => ({ nope: true }));
    await submit(req);
    expect(deps.applyOpenResult).not.toHaveBeenCalled();
    expect(deps.invalidateBootstrap).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledWith("<common.genericError>", "down");
  });

  it("a request the contract would reject never reaches the network", async () => {
    const { deps, submit } = setup(async () => okResult);
    await submit({ ...req, durationSec: 31 });
    expect(deps.openTrade).not.toHaveBeenCalled();
    expect(deps.toast).toHaveBeenCalledWith("<trade.failed>", "down");
  });
});
