import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { tradeRejectionMessage } from "@asm/contracts";
import { EngineRejected, EngineUnavailable } from "@/lib/engine-client";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  rateLimit: vi.fn(),
  network: vi.fn(),
  setStops: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ readSession: mocks.readSession }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/network-guard/guard", () => ({
  checkNetwork: mocks.network,
  vpnBlockedResponse: () => new Response(null, { status: 403 }),
}));
vi.mock("@/lib/otc-client", () => ({ engineOtcSetStops: mocks.setStops }));

const actorId = randomUUID();
const tradeId = randomUUID();
const cookie = { cookie: `${SESSION_COOKIE}=${randomUUID()}` };
const bearer = `Bearer ${randomUUID()}`;
const stops = { requestId: randomUUID(), stopLoss: 95, takeProfit: null };
const trade = { id: tradeId, status: "OPEN", stopLoss: 95, takeProfit: null };

function post(body: unknown = stops, headers: Record<string, string> = cookie, id: string = tradeId) {
  return POST(new NextRequest(`http://localhost/api/trades/${id}/stops`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSession.mockImplementation((token) => token ? { userId: actorId } : null);
  mocks.rateLimit.mockResolvedValue(true);
  mocks.network.mockResolvedValue({ blocked: false });
  mocks.setStops.mockResolvedValue({ trade });
});

it("requires a session and does not fall back to a cookie for a malformed bearer", async () => {
  expect((await post(stops, {})).status).toBe(401);
  expect((await post(stops, { ...cookie, authorization: "Bearer bad" })).status).toBe(401);
  expect(mocks.setStops).not.toHaveBeenCalled();
});

it.each([cookie, { authorization: bearer }])("authenticates the cookie or bearer and forwards its actor", async (headers) => {
  const result = await post(stops, headers);
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.json()).toEqual({ trade });
  expect(mocks.setStops).toHaveBeenCalledWith(tradeId, { ...stops, actorId });
});

it("rejects malformed levels, request IDs and client authority", async () => {
  expect((await post({ ...stops, stopLoss: 0 })).status).toBe(400);
  expect((await post({ ...stops, takeProfit: undefined })).status).toBe(400);
  expect((await post({ ...stops, requestId: "bad" })).status).toBe(400);
  expect((await post({ ...stops, actorId })).status).toBe(400);
  expect(mocks.setStops).not.toHaveBeenCalled();
});

it("returns 404 for a malformed trade ID without calling the engine", async () => {
  const result = await post(stops, cookie, "bad");
  expect(result.status).toBe(404);
  expect(await result.json()).toEqual({ code: "not_found", error: tradeRejectionMessage("not_found") });
  expect(mocks.setStops).not.toHaveBeenCalled();
});

it.each(["stop_loss_invalid", "take_profit_invalid", "trade_not_open", "stops_limit", "not_found"])("returns the shared 409 message for %s", async (code) => {
  mocks.setStops.mockRejectedValueOnce(new EngineRejected(409, code));
  const result = await post();
  expect(result.status).toBe(409);
  expect(await result.json()).toEqual({ code, error: tradeRejectionMessage(code) });
});

it("uses the network guard and rate limit and reports engine outages", async () => {
  mocks.network.mockResolvedValueOnce({ blocked: true });
  expect((await post()).status).toBe(403);
  mocks.rateLimit.mockResolvedValueOnce(false);
  expect((await post()).status).toBe(429);
  expect(mocks.setStops).not.toHaveBeenCalled();
  mocks.setStops.mockRejectedValueOnce(new EngineUnavailable("offline"));
  const result = await post();
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ code: "trading_unavailable", error: tradeRejectionMessage("trading_unavailable") });
});
