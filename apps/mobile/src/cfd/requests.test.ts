import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: "s1", currency: "INR", api: vi.fn(), merged: vi.fn(), generation: 0, preparedCurrency: "", last: null, refresh: vi.fn() }));
vi.mock("@/push/push", () => ({ askPermissionAt: vi.fn() }));
vi.mock("react-native", () => ({ AppState: {} }));
vi.mock("@/api/client", () => ({ api: mocks.api }));
vi.mock("@/auth/use-session-live", () => ({ useSessionLive: () => true }));
vi.mock("@/auth/session-store", () => ({ useSession: { getState: () => ({ token: mocks.token }) } }));
vi.mock("@/api/queries", () => ({ queryClient: { getQueryData: () => ({ accounts: [{ id: "a1", currency: mocks.currency }] }) } }));
vi.mock("@/api/refresh-bootstrap", () => ({ refreshBootstrap: mocks.refresh }));
vi.mock("@/ui/Toast", () => ({ toast: vi.fn() }));
vi.mock("@/socket/socket-store", () => ({ useSocket: { getState: () => ({
  cfdGeneration: { a1: mocks.generation }, lastCfdSettled: mocks.last,
  prepareCfdAccount: (_account: string, currency: string) => { if (currency !== mocks.preparedCurrency) { mocks.preparedCurrency = currency; mocks.generation++; } return mocks.generation; },
  mergeCfdTrades: mocks.merged,
}) } }));
import { refreshCfd } from "./useCfd";
beforeEach(() => { vi.resetAllMocks(); mocks.token = "s1"; mocks.currency = "INR"; mocks.generation = 0; mocks.preparedCurrency = ""; });
describe("CFD request ownership", () => {
  it("drops an old response arriving after a currency switch under the same session", async () => {
    let finish!: (response: unknown) => void;
    mocks.api.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const old = refreshCfd("a1", "INR");
    mocks.currency = "USD"; mocks.api.mockResolvedValueOnce({ currency: "USD", trades: ["new"] });
    await refreshCfd("a1", "USD");
    finish({ currency: "INR", trades: ["old"] });
    expect(await old).toBe(false);
    expect(mocks.merged.mock.calls).toEqual([["a1", ["new"]]]);
  });
  it("also drops an old response after INR→USD→INR (same units, obsolete generation)", async () => {
    let finish!: (response: unknown) => void;
    mocks.api.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const old = refreshCfd("a1", "INR");
    mocks.currency = "USD"; mocks.api.mockResolvedValueOnce({ currency: "USD", trades: [] }); await refreshCfd("a1", "USD");
    mocks.currency = "INR"; mocks.api.mockResolvedValueOnce({ currency: "INR", trades: ["latest"] }); await refreshCfd("a1", "INR");
    finish({ currency: "INR", trades: ["old"] });
    expect(await old).toBe(false);
    expect(mocks.merged.mock.calls.at(-1)).toEqual(["a1", ["latest"]]);
  });
  it("drops a response after sign-out even if its account and currency still match", async () => {
    let finish!: (response: unknown) => void;
    mocks.api.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const request = refreshCfd("a1", "INR"); mocks.token = "s2";
    finish({ currency: "INR", trades: ["secret"] });
    expect(await request).toBe(false); expect(mocks.merged).not.toHaveBeenCalled();
  });
  it("joins duplicate fetches for the same account, session, currency and generation", async () => {
    mocks.api.mockResolvedValueOnce({ currency: "INR", trades: [] });
    const first = refreshCfd("a1", "INR"), second = refreshCfd("a1", "INR");
    expect(first).toBe(second); await first; expect(mocks.api).toHaveBeenCalledTimes(1);
  });
});
