import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FONT_FAMILIES, figFamily, inputFamily, inputWeight, nearestWeight, scriptFor, uiFamily } from "./font-families";

describe("font families", () => {
  it("picks Devanagari for Hindi and Latin otherwise", () => {
    expect(scriptFor("hi")).toBe("devanagari");
    expect(scriptFor("hi-IN")).toBe("devanagari");
    expect(scriptFor("en")).toBe("latin");
    expect(scriptFor(undefined)).toBe("latin");
  });
  it("maps weights to bundled files", () => {
    expect(uiFamily(400, "latin")).toBe("AnekLatin_400Regular");
    expect(uiFamily(500, "latin")).toBe("AnekLatin_500Medium");
    expect(uiFamily(600, "latin")).toBe("AnekLatin_600SemiBold");
    expect(uiFamily(500, "devanagari")).toBe("AnekDevanagari_400Regular");
    expect(uiFamily(600, "devanagari")).toBe("AnekDevanagari_600SemiBold");
    expect(figFamily(500)).toBe("MartianMono_500Medium");
  });
  it("rounds canvas CSS weights to the nearest bundled weight", () => {
    expect(nearestWeight(400)).toBe(400);
    expect(nearestWeight(500)).toBe(500);
    expect(nearestWeight(620)).toBe(600);
    expect(nearestWeight(650)).toBe(600);
  });
  it("inputs use the system sans for Latin (family undefined, weight set) and Anek for Devanagari", () => {
    expect(inputFamily(400, "latin")).toBeUndefined();
    expect(inputWeight(inputFamily(400, "latin"), 400)).toBe("400");
    expect(inputWeight(inputFamily(600, "latin"), 600)).toBe("600");
    expect(inputFamily(400, "devanagari")).toBe("AnekDevanagari_400Regular");
    expect(inputWeight(inputFamily(400, "devanagari"), 400)).toBeUndefined();
  });
  it("loads every family it hands out", () => {
    const src = readFileSync(fileURLToPath(new URL("./font-assets.ts", import.meta.url)), "utf8");
    expect(FONT_FAMILIES).toHaveLength(8);
    for (const name of FONT_FAMILIES) expect(src).toContain(`import { ${name} }`);
  });
});
