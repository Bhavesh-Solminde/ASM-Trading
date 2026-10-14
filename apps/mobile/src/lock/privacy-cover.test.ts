import { describe, expect, it } from "vitest";
import { lockRouteReached, shouldCover } from "./privacy-cover";

describe("shouldCover", () => {
  it("covers while backgrounded with the lock on, so the app-switcher snapshot is the cover", () => {
    expect(shouldCover({ appState: "background", lockEnabled: true, locked: false, onLockRoute: false })).toBe(true);
  });
  it("covers while inactive (an iOS switcher / system overlay) with the lock on", () => {
    expect(shouldCover({ appState: "inactive", lockEnabled: true, locked: false, onLockRoute: false })).toBe(true);
  });
  it("does not cover a backgrounded app whose lock is off (nothing would relock it)", () => {
    expect(shouldCover({ appState: "background", lockEnabled: false, locked: false, onLockRoute: false })).toBe(false);
  });
  it("drops at once on return when no relock is due", () => {
    expect(shouldCover({ appState: "active", lockEnabled: true, locked: false, onLockRoute: false })).toBe(false);
  });
  it("stays up on return when relocked but the lock screen has not been reached yet", () => {
    expect(shouldCover({ appState: "active", lockEnabled: true, locked: true, onLockRoute: false })).toBe(true);
  });
  it("drops once the lock screen is showing", () => {
    expect(shouldCover({ appState: "active", lockEnabled: true, locked: true, onLockRoute: true })).toBe(false);
  });
  it("covers a locked app that has no usable lock (fail-closed load) until /lock too", () => {
    expect(shouldCover({ appState: "active", lockEnabled: false, locked: true, onLockRoute: false })).toBe(true);
  });
});

describe("lockRouteReached", () => {
  it("is false while the gate is sending the app to /lock and it is somewhere else", () => {
    expect(lockRouteReached("/lock", "/trade")).toBe(false);
  });
  it("is true on /lock", () => {
    expect(lockRouteReached("/lock", "/lock")).toBe(true);
  });
  it("is true when the gate wants a different screen (signed out, maintenance, update): /lock is not coming", () => {
    expect(lockRouteReached("/login", "/trade")).toBe(true);
    expect(lockRouteReached("/maintenance", "/trade")).toBe(true);
    expect(lockRouteReached("/update-required", "/trade")).toBe(true);
    expect(lockRouteReached(null, "/trade")).toBe(true);
  });
  it("is true during splash", () => {
    expect(lockRouteReached("/splash", "/")).toBe(true);
  });
});
