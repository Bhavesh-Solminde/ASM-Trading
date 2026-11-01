import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), account: vi.fn(), list: vi.fn(), open: vi.fn(), network: vi.fn(), transaction: vi.fn(), snapshotAccount: vi.fn() }));
vi.mock("@/lib/request-session", () => ({ getSession: mocks.session, unauthenticated: () => Response.json({ code: "unauthenticated" }, { status: 401 }) }));
vi.mock("@asm/logger", () => ({ childLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@asm/db", () => ({ formatMoney: () => "₹100.00", getAccountForActor: mocks.account, prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/network-guard/guard", () => ({ checkNetwork: mocks.network, vpnBlockedResponse: () => Response.json({}, { status: 403 }) }));
vi.mock("@/lib/request-context", () => ({ requestContext: () => ({ cid: "test", ip: "127.0.0.1" }) }));
vi.mock("@/lib/engine-client", () => ({ engineCfdOpen: mocks.open, EngineRejected: class extends Error {}, EngineUnavailable: class extends Error {} }));
import { GET, POST } from "./route";
const accountId = "0b405f2d-fc0e-49d8-8ac0-0a338667d432";
const order = { accountId, symbol: "EURUSD", direction: "LONG", stake: 10000, durationSec: 300, currency: "INR" };
const request = (body: unknown = order) => new NextRequest("http://localhost/api/cfd/trades", { method: "POST", headers: { authorization: "Bearer native-session" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ userId: "actor" }); mocks.account.mockResolvedValue({ currency: "INR" }); mocks.network.mockResolvedValue({ blocked: false }); mocks.open.mockResolvedValue({ trade: {}, balances: {} }); mocks.snapshotAccount.mockResolvedValue({ currency: "INR" }); mocks.transaction.mockImplementation(async fn => fn({ account: { findFirst: mocks.snapshotAccount }, trade: { findMany: mocks.list } })); });
describe("CFD native API", () => {
  it("uses the bearer-aware session resolver and stamps actorId from that session", async () => {
    const req = request(); expect((await POST(req)).status).toBe(201);
    expect(mocks.session).toHaveBeenCalledWith(req);
    expect(mocks.open).toHaveBeenCalledWith({ ...order, actorId: "actor" });
  });
  it("refuses unauthenticated and foreign accounts before the engine", async () => {
    mocks.session.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(401);
    mocks.account.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(404);
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("refuses stale client currency before evaluating or sending its investment", async () => {
    const response = await POST(request({ ...order, currency: "USD" }));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "currency_changed" }); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("preserves older clients and rejects untrusted execution prices", async () => {
    const old = { accountId, symbol: "EURUSD", direction: "LONG", stake: 10000, durationSec: 300 };
    expect((await POST(request(old))).status).toBe(201);
    mocks.open.mockClear(); expect((await POST(request({ ...order, entryPrice: 1 }))).status).toBe(400); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("returns full CFD DTOs, including account, epoch times, fee, leverage and close reason", async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "p1", accountId, asset: { symbol: "EURUSD" }, direction: "DOWN", stake: 10000, spreadFee: 500, leverage: 100, entryPrice: 100, entryTs: new Date(100000), expiryTs: new Date(400000), exitPrice: 99.9, stopLoss: null, takeProfit: null, trailingPct: null, liqPrice: 101, closeReason: "MANUAL", status: "CLOSED", pnl: 1000 }]);
    const response = await GET(new NextRequest(`http://localhost/api/cfd/trades?accountId=${accountId}`));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
    expect(mocks.snapshotAccount).toHaveBeenCalledWith({ where: { id: accountId, userId: "actor" }, select: { currency: true } });
    expect(mocks.list.mock.calls[0]?.[0]).toMatchObject({ where: { status: "OPEN" } });
    expect(mocks.list.mock.calls[0]?.[0]).not.toHaveProperty("take");
    expect(mocks.list.mock.calls[1]?.[0]).toMatchObject({ where: { status: "CLOSED" }, take: 50 });
    expect(await response.json()).toMatchObject({ trades: [{ accountId, direction: "SHORT", spreadFee: 500, leverage: 100, entryTs: 100, expiryTs: 400, closeReason: "MANUAL" }] });
  });
  it("takes ownership/currency and positions from the same repeatable snapshot during conversion", async () => {
    // The ordinary repository has already observed the converted account. This response must
    // still use the currency belonging to its transaction's older positions snapshot.
    mocks.account.mockResolvedValue({ currency: "USD" });
    mocks.snapshotAccount.mockResolvedValue({ currency: "INR" });
    mocks.list.mockResolvedValue([]);
    const response = await GET(new NextRequest(`http://localhost/api/cfd/trades?accountId=${accountId}`));
    expect(await response.json()).toEqual({ currency: "INR", trades: [] });
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  });
  it("does not read any positions if the actor does not own the account in the snapshot", async () => {
    mocks.snapshotAccount.mockResolvedValue(null);
    expect((await GET(new NextRequest(`http://localhost/api/cfd/trades?accountId=${accountId}`))).status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });

});
