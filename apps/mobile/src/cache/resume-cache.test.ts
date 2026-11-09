import { beforeEach, describe, expect, it, vi } from "vitest";

const data = new Map<string, string>();
let clearAll = vi.fn(() => data.clear());
const store = {
  set: (k: string, v: string) => void data.set(k, v),
  getString: (k: string) => data.get(k),
  remove: (k: string) => void data.delete(k),
  clearAll: () => clearAll(),
};
let available = true;
vi.mock("./mmkv", () => ({ openMmkv: () => (available ? store : null) }));

import { clearResume, loadLastNickname, saveLastNickname } from "./resume-cache";

describe("last nickname (lock screen greeting)", () => {
  beforeEach(() => {
    data.clear();
    available = true;
    clearAll = vi.fn(() => data.clear());
  });

  it("round-trips the nickname", () => {
    saveLastNickname("Asha");
    expect(loadLastNickname()).toBe("Asha");
  });

  it("trims the name it stores", () => {
    saveLastNickname("  Asha  ");
    expect(loadLastNickname()).toBe("Asha");
  });

  it("removes the stored name for null and for a blank name", () => {
    saveLastNickname("Asha");
    saveLastNickname(null);
    expect(loadLastNickname()).toBeNull();
    saveLastNickname("Asha");
    saveLastNickname("   ");
    expect(loadLastNickname()).toBeNull();
  });

  it("is wiped by clearResume, so a signed-out phone greets nobody", () => {
    saveLastNickname("Asha");
    clearResume();
    expect(loadLastNickname()).toBeNull();
  });

  it("reads null and never throws when storage is unavailable or fails", () => {
    available = false;
    expect(() => saveLastNickname("Asha")).not.toThrow();
    expect(loadLastNickname()).toBeNull();
    available = true;
    store.getString = () => {
      throw new Error("boom");
    };
    expect(loadLastNickname()).toBeNull();
  });
});
