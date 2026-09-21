import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isMuted, setMuted, soundForSettled } from "./sound";

describe("soundForSettled", () => {
  it("maps WON to win and LOST to lose", () => {
    expect(soundForSettled("WON")).toBe("win");
    expect(soundForSettled("LOST")).toBe("lose");
  });

  it("returns null for statuses with no sound", () => {
    expect(soundForSettled("REFUNDED")).toBeNull();
    expect(soundForSettled("OPEN")).toBeNull();
  });
});

// The web vitest environment is "node" — there's no window/localStorage, so
// each test installs a minimal fake before exercising the mute helpers.
describe("isMuted / setMuted", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("defaults to unmuted", () => {
    expect(isMuted()).toBe(false);
  });

  it("round-trips true then false", () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
    setMuted(false);
    expect(isMuted()).toBe(false);
  });

  it("returns false, never throws, when storage access fails", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      },
    };
    expect(() => isMuted()).not.toThrow();
    expect(isMuted()).toBe(false);
  });
});
