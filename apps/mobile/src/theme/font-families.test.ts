import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FONT_FAMILIES, figFamily, nearestWeight, scriptFor, uiFamily } from "./font-families";

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
  it("loads every family it hands out", () => {
    const src = readFileSync(fileURLToPath(new URL("./font-assets.ts", import.meta.url)), "utf8");
    expect(FONT_FAMILIES).toHaveLength(8);
    for (const name of FONT_FAMILIES) expect(src).toContain(`import { ${name} }`);
  });
});
