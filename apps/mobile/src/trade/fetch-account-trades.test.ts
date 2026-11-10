import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ api: vi.fn() }));
const merge = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ token: "tok-A" as string | null }));

vi.mock("@/api/client", () => apiMock);
vi.mock("@/socket/socket-store", () => ({ useSocket: { getState: () => ({ mergeFetchedTrades: merge }) } }));
vi.mock("@/auth/session-store", () => ({ useSession: { getState: () => session } }));

import { fetchAccountTrades } from "./fetch-account-trades";

beforeEach(() => {
  vi.clearAllMocks();
  session.token = "tok-A";
});

describe("fetchAccountTrades", () => {
  it("fetches the account's trades and folds them into the store", async () => {
    apiMock.api.mockResolvedValue({ trades: [{ id: "t1" }] });
    await expect(fetchAccountTrades("live 1")).resolves.toBe(true);
    expect(apiMock.api.mock.calls[0]?.[0]).toBe("/api/trades?accountId=live%201");
    expect(merge).toHaveBeenCalledWith("live 1", [{ id: "t1" }]);
  });

  it("drops a response that lands after the session changed (sign-out, or another user signed in)", async () => {
    apiMock.api.mockImplementation(async () => {
      session.token = "tok-B";
      return { trades: [{ id: "t1" }] };
    });
    await expect(fetchAccountTrades("a2")).resolves.toBe(false);
    expect(merge).not.toHaveBeenCalled();
  });

  it("drops a response that lands after sign-out", async () => {
    apiMock.api.mockImplementation(async () => {
      session.token = null;
      return { trades: [] };
    });
    await expect(fetchAccountTrades("a2")).resolves.toBe(false);
    expect(merge).not.toHaveBeenCalled();
  });

  it("rejects when the request fails, so the caller can stay hidden or retry", async () => {
    apiMock.api.mockRejectedValue(new Error("offline"));
    await expect(fetchAccountTrades("a2")).rejects.toThrow();
    expect(merge).not.toHaveBeenCalled();
  });
});
