import { beforeEach, describe, expect, it, vi } from "vitest";

const data = new Map<string, string>();
const store = { set: (k: string, v: string) => void data.set(k, v), getString: (k: string) => data.get(k), remove: (k: string) => void data.delete(k) };
let available = true;
vi.mock("@/cache/mmkv", () => ({ openMmkv: () => (available ? store : null) }));

import { clearPendingCheckout, loadPendingCheckout, savePendingCheckout } from "./pending-checkout";

describe("pending checkout", () => {
  beforeEach(() => {
    data.clear();
    available = true;
  });

  it("round-trips the token and expiry for one user", () => {
    savePendingCheckout("u1", { token: "tok-1", expiresAt: null });
    expect(loadPendingCheckout("u1")).toEqual({ token: "tok-1", expiresAt: null });
    savePendingCheckout("u1", { token: "tok-1", expiresAt: 1_800_000_000_000 });
    expect(loadPendingCheckout("u1")).toEqual({ token: "tok-1", expiresAt: 1_800_000_000_000 });
  });

  it("keeps each user's checkout apart", () => {
    savePendingCheckout("u1", { token: "a", expiresAt: null });
    savePendingCheckout("u2", { token: "b", expiresAt: null });
    expect(loadPendingCheckout("u1")?.token).toBe("a");
    expect(loadPendingCheckout("u2")?.token).toBe("b");
  });

  it("a newer deposit replaces the older one", () => {
    savePendingCheckout("u1", { token: "old", expiresAt: null });
    savePendingCheckout("u1", { token: "new", expiresAt: null });
    expect(loadPendingCheckout("u1")?.token).toBe("new");
  });

  it("clears one user's checkout only", () => {
    savePendingCheckout("u1", { token: "a", expiresAt: null });
    savePendingCheckout("u2", { token: "b", expiresAt: null });
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
    expect(() => savePendingCheckout("u1", { token: "a", expiresAt: null })).not.toThrow();
    expect(() => clearPendingCheckout("u1")).not.toThrow();
    expect(loadPendingCheckout("u1")).toBeNull();
  });
});
