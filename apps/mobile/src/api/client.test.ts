import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-device", () => ({ modelName: "Test Phone" }));
vi.mock("@/config", () => ({ appConfig: () => ({ apiUrl: "https://api.test", version: "1.0.0" }) }));
vi.mock("@/gate/gate-store", () => ({ useGate: { getState: () => ({ gate: "ok", setGate: vi.fn() }) } }));

import { api, configureApi } from "./client";

const logout = vi.fn();
const toast = vi.fn();
let current: string | null = null;
const sent: (string | undefined)[] = [];

/** Every fetch answers 401 unauthenticated, after `beforeReply` runs (to change the session mid-flight). */
function replyUnauthenticated(beforeReply: () => void = () => {}) {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent.push((init.headers as Record<string, string>).Authorization);
    beforeReply();
    return new Response(JSON.stringify({ code: "unauthenticated", error: "Not signed in." }), { status: 401 });
  });
}

beforeEach(() => {
  logout.mockReset();
  toast.mockReset();
  sent.length = 0;
  current = null;
  configureApi({ token: () => current, logout, toast });
});

afterEach(() => vi.unstubAllGlobals());

describe("api() session-loss path", () => {
  it("logs out when the session token it sent is rejected", async () => {
    current = "tok-a";
    replyUnauthenticated();
    await expect(api("/api/v1/bootstrap")).rejects.toMatchObject({ code: "unauthenticated" });
    expect(sent).toEqual(["Bearer tok-a"]);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("does not log out when the request carried no token (sent before the session hydrated)", async () => {
    replyUnauthenticated(() => {
      current = "tok-a"; // hydrate() finished while the request was in flight
    });
    await expect(api("/api/auth/ws-ticket", { method: "POST" })).rejects.toMatchObject({ status: 401 });
    expect(sent).toEqual([undefined]);
    expect(logout).not.toHaveBeenCalled();
  });

  it("does not log out a newer session when an older token's request is rejected", async () => {
    current = "tok-a";
    replyUnauthenticated(() => {
      current = "tok-b"; // user A signed out, user B signed in while A's request was in flight
    });
    await expect(api("/api/v1/wallet")).rejects.toMatchObject({ status: 401 });
    expect(logout).not.toHaveBeenCalled();
  });

  it("never logs out for auth:false calls such as a wrong password", async () => {
    current = "tok-a";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Email or password is incorrect." }), { status: 401 }));
    await expect(api("/api/auth/login", { method: "POST", body: {}, auth: false })).rejects.toMatchObject({
      message: "Email or password is incorrect.",
    });
    expect(logout).not.toHaveBeenCalled();
  });

  it("returns null for a 204 without parsing a body", async () => {
    current = "tok-a";
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    await expect(api("/api/v1/account/preferences", { method: "PATCH", body: { locale: "hi" } })).resolves.toBeNull();
  });
});
