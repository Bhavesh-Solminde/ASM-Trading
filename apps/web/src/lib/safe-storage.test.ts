import { afterEach, describe, expect, it, vi } from "vitest";
import { readFlag, readNumber, writeFlag, writeNumber } from "./safe-storage";
afterEach(() => vi.unstubAllGlobals());
describe("prompt storage", () => {
  it("handles blocked storage", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw Error();
      },
      setItem() {
        throw Error();
      },
    });
    expect(readNumber("a")).toBeNull();
    expect(readFlag("a")).toBe(false);
    expect(() => {
      writeFlag("a");
      writeNumber("b", 1);
    }).not.toThrow();
  });
  it("round trips and rejects bad timestamps", () => {
    const m = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => m.set(k, v),
    });
    writeNumber("a", 42);
    expect(readNumber("a")).toBe(42);
    for (const v of ["", "NaN", "Infinity", "-3"]) {
      m.set("a", v);
      expect(readNumber("a")).toBeNull();
    }
    writeFlag("b");
    expect(readFlag("b")).toBe(true);
  });
});
