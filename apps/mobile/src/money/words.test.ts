import { describe, expect, it } from "vitest";
import { amountInWords } from "./words";

describe("amountInWords (English, Indian scale)", () => {
  it.each([
    [1, "One rupee only"],
    [100, "One hundred rupees only"],
    [2500, "Two thousand five hundred rupees only"],
    [125000, "One lakh twenty-five thousand rupees only"],
    [999600, "Nine lakh ninety-nine thousand six hundred rupees only"],
    [10000000, "One crore rupees only"],
    [1234567890, "One hundred twenty-three crore forty-five lakh sixty-seven thousand eight hundred ninety rupees only"],
  ])("%i", (n, words) => {
    expect(amountInWords(n, "en")).toBe(words);
  });
  it("is empty for zero", () => {
    expect(amountInWords(0, "en")).toBe("");
  });
});

describe("amountInWords (Hindi)", () => {
  it.each([
    [1, "एक रुपया मात्र"],
    [100, "एक सौ रुपये मात्र"],
    [2500, "दो हज़ार पाँच सौ रुपये मात्र"],
    [125000, "एक लाख पच्चीस हज़ार रुपये मात्र"],
    [999600, "नौ लाख निन्यानवे हज़ार छह सौ रुपये मात्र"],
    [10000000, "एक करोड़ रुपये मात्र"],
    [1234567890, "एक सौ तेईस करोड़ पैंतालीस लाख सड़सठ हज़ार आठ सौ नब्बे रुपये मात्र"],
  ])("%i", (n, words) => {
    expect(amountInWords(n, "hi")).toBe(words);
  });
});

describe.each(["en", "hi"] as const)("amountInWords (%s) with an input that is not a usable amount", (locale) => {
  it.each([
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["NaN", NaN],
    ["1e308", 1e308],
    ["0", 0],
  ])("is empty for %s (no crash, no stray words)", (_label, n) => {
    expect(amountInWords(n, locale)).toBe("");
  });
});
