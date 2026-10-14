import { describe, expect, it } from "vitest";
import { failsafeRoute, redirectFor, routeFor } from "./route-for";

const base = { ready: true, token: "t", locked: false, lockChosen: true, gate: "ok" as const, belowMin: false };

describe("routeFor", () => {
  it("waits on the splash until storage is read", () => {
    expect(routeFor({ ...base, ready: false })).toBe("/splash");
  });
  it("forces an update before anything else", () => {
    expect(routeFor({ ...base, token: null, belowMin: true })).toBe("/update-required");
    expect(routeFor({ ...base, gate: "upgrade" })).toBe("/update-required");
  });
  it("shows maintenance and VPN screens over everything but the update screen", () => {
    expect(routeFor({ ...base, gate: "maintenance" })).toBe("/maintenance");
    expect(routeFor({ ...base, gate: "blocked" })).toBe("/blocked");
    expect(routeFor({ ...base, gate: "maintenance", belowMin: true })).toBe("/update-required");
  });
  it("sends a signed-out user to login", () => {
    expect(routeFor({ ...base, token: null })).toBe("/login");
  });
  it("asks a signed-in user to unlock before trading", () => {
    expect(routeFor({ ...base, locked: true })).toBe("/lock");
  });
  it("offers lock setup when no lock was chosen yet", () => {
    expect(routeFor({ ...base, lockChosen: false })).toBe("/lock-setup");
  });
  it("lets an unlocked user stay where they are", () => {
    expect(routeFor(base)).toBeNull();
  });
  it("ignores the offline gate state", () => {
    expect(routeFor({ ...base, gate: "offline" })).toBeNull();
  });
});

describe("redirectFor", () => {
  it("never moves while the splash is up", () => {
    expect(redirectFor("/splash", "/trade")).toBeNull();
  });
  it("sends the user to the gate screen they are not on", () => {
    expect(redirectFor("/lock", "/trade")).toBe("/lock");
    expect(redirectFor("/maintenance", "/lock")).toBe("/maintenance");
    expect(redirectFor("/lock", "/lock")).toBeNull();
  });
  it("lets a signed-out user move between the auth screens", () => {
    expect(redirectFor("/login", "/register")).toBeNull();
    expect(redirectFor("/login", "/forgot")).toBeNull();
    expect(redirectFor("/login", "/trade")).toBe("/login");
  });
  it("moves an unlocked user off any gate screen into the app", () => {
    for (const p of ["/", "/login", "/lock", "/lock-setup", "/maintenance", "/blocked", "/update-required"]) {
      expect(redirectFor(null, p)).toBe("/trade");
    }
  });
  it("resolves the entry route to wherever the state says", () => {
    expect(redirectFor(null, "/")).toBe("/trade");
    expect(redirectFor("/login", "/")).toBe("/login");
    expect(redirectFor("/lock", "/")).toBe("/lock");
    expect(redirectFor("/splash", "/")).toBeNull();
  });
  it("leaves an unlocked user on an app screen", () => {
    expect(redirectFor(null, "/history")).toBeNull();
    expect(redirectFor(null, "/trade")).toBeNull();
  });
});

describe("failsafeRoute", () => {
  it("sends a boot that never finished to the blank ground route before the splash is hidden", () => {
    // Otherwise a deep-linked /trade (or any tab) would sit mounted, unlocked, under the lifted splash.
    expect(failsafeRoute(false)).toBe("/");
  });
  it("leaves a finished boot to the normal redirects", () => {
    expect(failsafeRoute(true)).toBeNull();
  });
});
