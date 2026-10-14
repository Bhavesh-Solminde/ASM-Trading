import { describe, expect, it } from "vitest";
import { ApiError, classifyResponse, clearsGate, shouldRetry } from "./errors";

describe("classifyResponse", () => {
  it("passes successful responses through", () => {
    expect(classifyResponse(200, {})).toEqual({ kind: "ok" });
  });
  it("sends an expired session to login", () => {
    expect(classifyResponse(401, { code: "unauthenticated" })).toEqual({ kind: "logout" });
  });
  it("shows the login 401 as a form error instead of logging out", () => {
    expect(classifyResponse(401, { error: "Email or password is incorrect." })).toEqual({
      kind: "error",
      status: 401,
      code: null,
      message: "Email or password is incorrect.",
    });
  });
  it("shows a failed Google sign-in as a form error", () => {
    expect(classifyResponse(401, { error: "Google sign-in failed.", code: "google_failed" })).toEqual({
      kind: "error",
      status: 401,
      code: "google_failed",
      message: "Google sign-in failed.",
    });
  });
  it("never logs out an unauthenticated (auth:false) call", () => {
    expect(classifyResponse(401, { error: "Nope.", code: "unauthenticated" }, { authed: false })).toEqual({
      kind: "error",
      status: 401,
      code: "unauthenticated",
      message: "Nope.",
    });
  });
  it("maps maintenance, VPN and outdated-app codes to gate screens", () => {
    expect(classifyResponse(503, { code: "maintenance" })).toEqual({ kind: "gate", gate: "maintenance" });
    expect(classifyResponse(403, { code: "vpn_blocked" })).toEqual({ kind: "gate", gate: "blocked" });
    expect(classifyResponse(426, { code: "upgrade_required" })).toEqual({ kind: "gate", gate: "upgrade" });
  });
  it("turns rate limits into a toast", () => {
    expect(classifyResponse(429, { error: "Too many requests.", code: "rate_limited" })).toEqual({
      kind: "toast",
      message: "Too many requests.",
    });
  });
  it("keeps other errors with their message and code for the screen to show", () => {
    expect(classifyResponse(409, { error: "KYC is locked." })).toEqual({
      kind: "error",
      status: 409,
      code: null,
      message: "KYC is locked.",
    });
  });
  it("survives a non-JSON error body", () => {
    expect(classifyResponse(500, null)).toMatchObject({ kind: "error", status: 500, message: "Something went wrong." });
  });
});

describe("clearsGate", () => {
  it("clears only on /api/v1 calls", () => {
    expect(clearsGate("/api/v1/bootstrap")).toBe(true);
    expect(clearsGate("/api/v1/app/config")).toBe(true);
  });
  it("leaves /api/auth calls alone so maintenance survives a ws-ticket or logout", () => {
    expect(clearsGate("/api/auth/ws-ticket")).toBe(false);
    expect(clearsGate("/api/auth/logout")).toBe(false);
    expect(clearsGate("/api/v1")).toBe(false);
  });
});

describe("shouldRetry", () => {
  it("retries a network failure once", () => {
    expect(shouldRetry(0, new ApiError("No connection.", 0, "offline"))).toBe(true);
    expect(shouldRetry(1, new ApiError("No connection.", 0, "offline"))).toBe(false);
  });
  it("retries a 5xx once", () => {
    expect(shouldRetry(0, new ApiError("Boom", 502, null))).toBe(true);
    expect(shouldRetry(1, new ApiError("Boom", 502, null))).toBe(false);
  });
  it("never retries a 4xx, which would repeat its side effects", () => {
    for (const status of [400, 401, 409, 426, 429, 499]) {
      expect(shouldRetry(0, new ApiError("No", status, null))).toBe(false);
    }
  });
  it("does not re-hit a maintenance gate that arrived as a 503", () => {
    expect(shouldRetry(0, new ApiError("maintenance", 503, "maintenance"))).toBe(false);
  });
  it("retries unknown (non-ApiError) failures once", () => {
    expect(shouldRetry(0, new Error("parse failed"))).toBe(true);
    expect(shouldRetry(1, new Error("parse failed"))).toBe(false);
  });
});
