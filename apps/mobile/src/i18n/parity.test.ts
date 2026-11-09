import { describe, expect, it } from "vitest";
import en from "./en.json";
import hi from "./hi.json";
import { flattenKeys, localeFromDevice, resolveLocale } from "./keys";

describe("translations", () => {
  it("define exactly the same keys in English and Hindi", () => {
    expect(flattenKeys(hi).sort()).toEqual(flattenKeys(en).sort());
  });
  it("use the same {{placeholders}} in every key, in English and Hindi", () => {
    const placeholders = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
    const mismatched = flattenKeys(en).filter((k) => {
      const at = (o: unknown) => String(k.split(".").reduce<unknown>((acc, p) => (acc as Record<string, unknown>)[p], o));
      return placeholders(at(en)).join() !== placeholders(at(hi)).join();
    });
    expect(mismatched).toEqual([]);
  });
  it("keep `count` on the plural and counted lock strings the components pass it to", () => {
    expect(en.lock.wrongPin_one).toContain("{{count}}");
    expect(en.lock.wrongPin_other).toContain("{{count}}");
    expect(en.lock.pinEntered).toContain("{{count}}");
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

describe("resolveLocale", () => {
  it("prefers the language the user picked", () => {
    expect(resolveLocale("hi", ["en-IN"])).toBe("hi");
    expect(resolveLocale("en", ["hi-IN"])).toBe("en");
  });
  it("falls back to the device language for nothing or junk", () => {
    expect(resolveLocale(null, ["hi-IN"])).toBe("hi");
    expect(resolveLocale("fr", ["en-IN"])).toBe("en");
  });
});

describe("language switch strings", () => {
  it("label each language in its own script, the same in both languages", () => {
    expect(en.lang).toEqual({ en: "English", hi: "हिन्दी" });
    expect(hi.lang).toEqual(en.lang);
  });
});
