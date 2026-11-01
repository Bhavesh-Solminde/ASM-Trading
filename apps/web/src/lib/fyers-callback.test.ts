import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ session: vi.fn(), exchange: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/admin-session", () => ({ ADMIN_SESSION_COOKIE: "asm_admin_session", readAdminSession: m.session }));
vi.mock("@asm/db", () => ({ prisma: { integrationToken: { upsert: m.upsert } } }));
vi.mock("@asm/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/fyers-oauth", () => ({
  buildAuthorizeUrl: () => "https://api-t1.fyers.in/authorize",
  exchangeAuthCode: m.exchange,
  nextFyersExpiry: () => new Date("2026-10-25T00:30:00Z"),
}));
import { GET as authorize } from "@/app/api/integrations/fyers/authorize/route";
import { GET as callback } from "@/app/api/integrations/fyers/callback/route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FYERS_APP_ID", "test-app"); vi.stubEnv("FYERS_APP_SECRET", "test-secret");
  vi.stubEnv("FYERS_REDIRECT_URI", "https://example.com/api/integrations/fyers/callback");
  m.session.mockImplementation(async (token) => token === "valid-session");
  m.exchange.mockResolvedValue({s:"ok",access_token:"test-access"});
});
it("issues a short-lived callback-only Lax cookie after admin authentication", async () => {
  const res = await authorize(new NextRequest("https://example.com/api/integrations/fyers/authorize", { headers: {cookie:"asm_admin_session=valid-session"} }));
  expect(res.status).toBe(302);
  expect(res.cookies.get("fyers_oauth_admin")).toMatchObject({value:"valid-session",httpOnly:true,sameSite:"lax",maxAge:600,path:"/api/integrations/fyers/callback"});
});
it("does not issue OAuth cookies to unauthenticated callers", async () => {
  const res = await authorize(new NextRequest("https://example.com/api/integrations/fyers/authorize"));
  expect(res.status).toBe(404); expect(res.cookies.get("fyers_oauth_admin")).toBeUndefined();
});
function request(cookie:string,state="nonce") {
  return new NextRequest(`https://example.com/api/integrations/fyers/callback?s=ok&auth_code=test&state=${state}`, {headers:{cookie}});
}
it("accepts the FYERS return without the strict cookie and clears both OAuth cookies at their original paths", async () => {
  const res=await callback(request("fyers_oauth_admin=valid-session; fyers_oauth_state=nonce"));
  expect(res.status).toBe(200); expect(m.upsert).toHaveBeenCalledOnce();
  expect(res.cookies.get("fyers_oauth_admin")).toMatchObject({maxAge:0,path:"/api/integrations/fyers/callback"});
  expect(res.cookies.get("fyers_oauth_state")).toMatchObject({maxAge:0,path:"/api/integrations/fyers"});
});
it("rejects mismatched state before exchange", async () => {
  expect((await callback(request("fyers_oauth_admin=valid-session; fyers_oauth_state=wrong"))).status).toBe(400);
  expect(m.exchange).not.toHaveBeenCalled();
});
it.each(["", "fyers_oauth_admin=revoked-session; fyers_oauth_state=nonce"])("rejects missing or revoked admin sessions", async cookie => {
  expect((await callback(request(cookie))).status).toBe(404); expect(m.exchange).not.toHaveBeenCalled();
});
