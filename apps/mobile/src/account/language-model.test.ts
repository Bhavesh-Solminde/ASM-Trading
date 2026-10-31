import { describe, expect, it } from "vitest";
import { LANGUAGE_OPTIONS, languageSelected } from "./language-model";

describe("LANGUAGE_OPTIONS", () => {
  it("offers English then Hindi, each labelled in its own script", () => {
    expect(LANGUAGE_OPTIONS).toEqual([
      { locale: "en", labelKey: "lang.en", script: "latin" },
      { locale: "hi", labelKey: "lang.hi", script: "devanagari" },
    ]);
  });
});

describe("languageSelected", () => {
  it("reads regional codes as their language", () => {
    expect(languageSelected("hi-IN", "hi")).toBe(true);
    expect(languageSelected("hi", "en")).toBe(false);
    expect(languageSelected("en-IN", "en")).toBe(true);
    expect(languageSelected("fr", "en")).toBe(true);
  });
});
