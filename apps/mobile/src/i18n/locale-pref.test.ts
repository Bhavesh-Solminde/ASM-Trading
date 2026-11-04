import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let broken = false;
vi.mock("@/cache/mmkv", () => ({
  openMmkv: (id: string) => {
    if (broken) throw new Error("native module unavailable");
    return {
      getString: (k: string) => store.get(`${id}:${k}`),
      set: (k: string, v: string) => void store.set(`${id}:${k}`, v),
    };
  },
}));

import { loadLocale, saveLocale } from "./locale-pref";

describe("locale-pref", () => {
  beforeEach(() => {
    store.clear();
    broken = false;
  });
  it("is null until the user picks a language", () => {
    expect(loadLocale()).toBeNull();
  });
  it("remembers the picked language in the prefs store", () => {
    saveLocale("hi");
    expect(loadLocale()).toBe("hi");
    expect(store.get("ixt-prefs:locale")).toBe("hi");
    saveLocale("en");
    expect(loadLocale()).toBe("en");
  });
  it("never throws when the store is unavailable", () => {
    broken = true;
    expect(() => saveLocale("hi")).not.toThrow();
    expect(loadLocale()).toBeNull();
  });
});
