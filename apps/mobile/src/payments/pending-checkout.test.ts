import { beforeEach, describe, expect, it, vi } from "vitest";

const data = new Map<string, string>();
const store = {
  set: (k: string, v: string) => void data.set(k, v),
  getString: (k: string) => data.get(k),
  remove: (k: string) => void data.delete(k),
  clearAll: () => data.clear(),
};
let available = true;
vi.mock("@/cache/mmkv", () => ({ openMmkv: () => (available ? store : null) }));

import { clearAllPendingCheckouts, clearPendingCheckout, loadPendingCheckout, savePendingCheckout } from "./pending-checkout";

describe("pending checkout", () => {
  beforeEach(() => {
    data.clear();
    available = true;
  });

  it("round-trips the token and expiry for one user", () => {
    savePendingCheckout("u1", { token: "tok-1", expiresAt: null, amountInr: null });
    expect(loadPendingCheckout("u1")).toEqual({ token: "tok-1", expiresAt: null, amountInr: null });
    savePendingCheckout("u1", { token: "tok-1", expiresAt: 1_800_000_000_000, amountInr: 200_037 });
    expect(loadPendingCheckout("u1")).toEqual({ token: "tok-1", expiresAt: 1_800_000_000_000, amountInr: 200_037 });
  });

  it("still reads a record saved before the amount was kept, as an unknown amount", () => {
    data.set("pending:u1", JSON.stringify({ token: "old", expiresAt: 1_800_000_000_000 }));
    expect(loadPendingCheckout("u1")).toEqual({ token: "old", expiresAt: 1_800_000_000_000, amountInr: null });
  });

  it("reads a record with an amount that is not a whole positive number as an unknown amount, not a wrong one", () => {
    for (const amountInr of ["200", -5, 0, 12.5, null]) {
      data.set("pending:u1", JSON.stringify({ token: "t", expiresAt: null, amountInr }));
      expect(loadPendingCheckout("u1")?.amountInr).toBeNull();
    }
  });

  it("clears every user's checkout at once (sign-out leaves nothing of the last person on the phone)", () => {
    savePendingCheckout("u1", { token: "a", expiresAt: null, amountInr: null });
    savePendingCheckout("u2", { token: "b", expiresAt: null, amountInr: null });
    clearAllPendingCheckouts();
    expect(loadPendingCheckout("u1")).toBeNull();
    expect(loadPendingCheckout("u2")).toBeNull();
  });

  it("keeps each user's checkout apart", () => {
    savePendingCheckout("u1", { token: "a", expiresAt: null, amountInr: null });
    savePendingCheckout("u2", { token: "b", expiresAt: null, amountInr: null });
    expect(loadPendingCheckout("u1")?.token).toBe("a");
    expect(loadPendingCheckout("u2")?.token).toBe("b");
  });

  it("a newer deposit replaces the older one", () => {
    savePendingCheckout("u1", { token: "old", expiresAt: null, amountInr: null });
    savePendingCheckout("u1", { token: "new", expiresAt: null, amountInr: null });
    expect(loadPendingCheckout("u1")?.token).toBe("new");
  });

  it("clears one user's checkout only", () => {
    savePendingCheckout("u1", { token: "a", expiresAt: null, amountInr: null });
    savePendingCheckout("u2", { token: "b", expiresAt: null, amountInr: null });
    clearPendingCheckout("u1");
    expect(loadPendingCheckout("u1")).toBeNull();
    expect(loadPendingCheckout("u2")?.token).toBe("b");
  });

  it("reads null for nothing stored, corrupt JSON, or a record of the wrong shape", () => {
    expect(loadPendingCheckout("u1")).toBeNull();
    data.set("pending:u1", "{not json");
    expect(loadPendingCheckout("u1")).toBeNull();
    data.set("pending:u1", JSON.stringify({ token: 5, expiresAt: null }));
    expect(loadPendingCheckout("u1")).toBeNull();
    data.set("pending:u1", JSON.stringify({ token: "", expiresAt: null }));
    expect(loadPendingCheckout("u1")).toBeNull();
    data.set("pending:u1", JSON.stringify({ token: "t", expiresAt: "soon" }));
    expect(loadPendingCheckout("u1")).toBeNull();
  });

  it("never throws, and reads null, when storage is unavailable", () => {
    available = false;
    expect(() => savePendingCheckout("u1", { token: "a", expiresAt: null, amountInr: null })).not.toThrow();
    expect(() => clearPendingCheckout("u1")).not.toThrow();
    expect(() => clearAllPendingCheckouts()).not.toThrow();
    expect(loadPendingCheckout("u1")).toBeNull();
  });
});
