import { describe, expect, it } from "vitest";
import { sessionLive } from "./session-live";

describe("sessionLive", () => {
  const live = { ready: true, token: "tok", lockLoaded: true, locked: false };

  it("is true only for a hydrated, signed-in, unlocked session whose lock state is known", () => {
    expect(sessionLive(live)).toBe(true);
  });

  it("is false before the session has hydrated (cold-start deep link)", () => {
    expect(sessionLive({ ...live, ready: false, token: null })).toBe(false);
    expect(sessionLive({ ...live, ready: false })).toBe(false);
  });

  it("is false when signed out (sign-out must not trigger an unauthenticated refetch)", () => {
    expect(sessionLive({ ...live, token: null })).toBe(false);
  });

  it("is false until the lock state has loaded, because `locked` is only a guess until then", () => {
    expect(sessionLive({ ...live, lockLoaded: false })).toBe(false);
  });

  it("is false while the app is locked", () => {
    expect(sessionLive({ ...live, locked: true })).toBe(false);
  });

  it("covers every combination: exactly one of the 16 is live", () => {
    const bools = [true, false];
    const liveCount = bools.flatMap((ready) => bools.flatMap((hasToken) => bools.flatMap((lockLoaded) => bools.map((locked) => sessionLive({ ready, token: hasToken ? "t" : null, lockLoaded, locked }))))).filter(Boolean).length;
    expect(liveCount).toBe(1);
  });
});
