import { beforeEach, expect, it, vi } from "vitest";

const mmkv = vi.hoisted(() => ({ getBoolean: vi.fn(), set: vi.fn() }));
vi.mock("@/cache/mmkv", () => ({ openMmkv: () => mmkv }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

it("starts unchecked and remembers the checkbox across loads on this device", async () => {
  const { useProtection } = await import("./protection-store");
  expect(useProtection.getState().enabled).toBe(false);
  useProtection.getState().toggle();
  expect(useProtection.getState().enabled).toBe(true);
  expect(mmkv.set).toHaveBeenLastCalledWith("post-trade-stops", true);

  vi.resetModules();
  mmkv.getBoolean.mockReturnValue(true);
  const { useProtection: reloaded } = await import("./protection-store");
  expect(reloaded.getState().enabled).toBe(true);
  reloaded.getState().toggle();
  expect(mmkv.set).toHaveBeenLastCalledWith("post-trade-stops", false);
});

it("still toggles if persistence fails", async () => {
  mmkv.set.mockImplementation(() => { throw new Error("MMKV unavailable"); });
  const { useProtection } = await import("./protection-store");
  expect(() => useProtection.getState().toggle()).not.toThrow();
  expect(useProtection.getState().enabled).toBe(true);
});
