import { describe, expect, it, vi } from "vitest";
import { fillCountryFromIp, type CountryFillDeps } from "./country";

const PUBLIC_IP = "203.0.113.41";

function deps(over: Partial<CountryFillDeps> = {}) {
  return {
    enabled: () => true,
    lookup: vi.fn(async () => ({ verdict: "clean" as const, country: "IN" })),
    setIfMissing: vi.fn(async () => true),
    ...over,
  };
}

describe("fillCountryFromIp", () => {
  it("stores the located country for a user who has none", async () => {
    const d = deps();
    expect(await fillCountryFromIp("u1", PUBLIC_IP, d)).toBe("IN");
    expect(d.setIfMissing).toHaveBeenCalledWith("u1", "IN");
  });

  it("does nothing when the guard is off, the address is private, or there is no ip", async () => {
    const off = deps({ enabled: () => false });
    expect(await fillCountryFromIp("u1", PUBLIC_IP, off)).toBeNull();
    const d = deps();
    expect(await fillCountryFromIp("u1", "192.168.1.4", d)).toBeNull();
    expect(await fillCountryFromIp("u1", undefined, d)).toBeNull();
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it("reports nothing when the user already had a country or the lookup has none", async () => {
    expect(await fillCountryFromIp("u1", PUBLIC_IP, deps({ setIfMissing: vi.fn(async () => false) }))).toBeNull();
    const noCc = deps({ lookup: vi.fn(async () => ({ verdict: "unknown" as const, country: null })) });
    expect(await fillCountryFromIp("u1", PUBLIC_IP, noCc)).toBeNull();
    expect(noCc.setIfMissing).not.toHaveBeenCalled();
  });

  it("swallows provider and database errors", async () => {
    const boom = deps({ lookup: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await fillCountryFromIp("u1", PUBLIC_IP, boom)).toBeNull();
  });
});
