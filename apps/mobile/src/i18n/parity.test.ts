import { describe, expect, it } from "vitest";
import en from "./en.json";
import hi from "./hi.json";
import { flattenKeys, localeFromDevice } from "./keys";

describe("translations", () => {
  it("define exactly the same keys in English and Hindi", () => {
    expect(flattenKeys(hi).sort()).toEqual(flattenKeys(en).sort());
  });
  it("leave no Hindi string empty", () => {
    const empty = flattenKeys(hi).filter((k) => String(k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], hi)).trim() === "");
    expect(empty).toEqual([]);
  });
});

describe("localeFromDevice", () => {
  it("picks Hindi for a Hindi phone", () => {
    expect(localeFromDevice(["hi-IN", "en-IN"])).toBe("hi");
  });
  it("falls back to English otherwise", () => {
    expect(localeFromDevice(["en-IN"])).toBe("en");
    expect(localeFromDevice([])).toBe("en");
  });
});
